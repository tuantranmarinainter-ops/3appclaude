import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, existsSync, readFileSync, rmSync, writeFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { AnimationClip, Bone, Group, QuaternionKeyframeTrack, VectorKeyframeTrack } from 'three'
import { decodeGlb, encodeGlb } from '../cli/glb.ts'
import { ParsedAssetCache } from '../workbench/parsedAssetCache.ts'
import { pruneToMappedRig, runNormalize } from '../cli/normalizeCore.ts'
import { loadAsset } from '../cli/loadAsset.ts'
import { describeSource, inspect, parseOptions, runPipeline, sha256, buildPreset } from '../workbench/pipeline.ts'

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'c9-cache-'))
  const path = join(dir, 'asset.glb'), armature = join(dir, 'armature.bobj')
  writeFileSync(path, 'first'); writeFileSync(armature, 'rig')
  let calls = 0
  const parse: typeof loadAsset = async (bytes) => {
    calls++
    const root = new Group(), bone = new Bone(); bone.name = 'Hips'; root.add(bone)
    root.name = Buffer.from(bytes).toString()
    root.animations = [new AnimationClip('first', 1, [new QuaternionKeyframeTrack('Hips.quaternion', [0], [0, 0, 0, .9]),
      new VectorKeyframeTrack('Other.position', [0], [1, 2, 3])]), new AnimationClip('second', 2, [])]
    return root
  }
  return { dir, path, armature, parse, calls: () => calls }
}

test('deduplicates loads; pruning and hierarchy changes never mutate cached templates or action indices', async () => {
  const f = fixture()
  try {
    const cache = new ParsedAssetCache(2, 100000, f.parse)
    const [a, b] = await Promise.all([cache.load(f.path, 'glb'), cache.load(f.path, 'glb')])
    assert.equal(f.calls(), 1); assert.notEqual(a.scene, b.scene)
    assert.equal(a.scene.animations[0], b.scene.animations[0], 'no deep copy of the action library')
    a.scene.children[0]!.position.y = 9
    pruneToMappedRig(a.scene, { mapped: new Set(['Hips']), retained: new Set(['Hips']) })
    const c = await cache.load(f.path, 'glb')
    assert.equal(c.scene.children[0]!.position.y, 0)
    assert.deepEqual(c.scene.animations.map(c => [c.name, c.duration]), [['first', 1], ['second', 2]])
    assert.equal(c.scene.animations[0]!.tracks.length, 2)
    assert.ok(Math.abs(c.scene.animations[0]!.tracks[0]!.values[3]! - .9) < 1e-6)
    assert.equal(a.scene.animations[0]!.tracks[0]!.values[3], 1)
    assert.equal(f.calls(), 1)
  } finally { rmSync(f.dir, { recursive: true, force: true }) }
})

test('invalidates source and bobj armature stats, retries failures', async () => {
  const f = fixture()
  try {
    const cache = new ParsedAssetCache(2, 100000, f.parse)
    await cache.load(f.path, 'bobj', f.armature)
    writeFileSync(f.path, 'changed source')
    assert.equal((await cache.load(f.path, 'bobj', f.armature)).scene.name, 'changed source')
    writeFileSync(f.armature, 'changed armature')
    await cache.load(f.path, 'bobj', f.armature)
    assert.equal(f.calls(), 3)
    let attempts = 0
    const retry = new ParsedAssetCache(2, 100000, async (...args) => { if (++attempts === 1) throw Error('bad'); return f.parse(...args) })
    await assert.rejects(retry.load(f.path, 'glb'), /bad/)
    await retry.load(f.path, 'glb'); assert.equal(attempts, 2)
  } finally { rmSync(f.dir, { recursive: true, force: true }) }
})

test('LRU evicts by entry count and estimated parsed bytes; oversized assets are not retained', async () => {
  const f = fixture()
  try {
    const second = join(f.dir, 'second.glb'), third = join(f.dir, 'third.glb')
    writeFileSync(second, 'two'); writeFileSync(third, 'three')
    const cache = new ParsedAssetCache(2, 100000, f.parse)
    await cache.load(f.path, 'glb'); await cache.load(second, 'glb'); await cache.load(f.path, 'glb')
    await cache.load(third, 'glb'); await cache.load(f.path, 'glb'); assert.equal(f.calls(), 3)
    await cache.load(second, 'glb'); assert.equal(f.calls(), 4)
    const bounded = new ParsedAssetCache(20, 4000, f.parse)
    await bounded.load(f.path, 'glb'); await bounded.load(second, 'glb'); await bounded.load(f.path, 'glb')
    assert.equal(f.calls(), 7, 'parsed tracks/nodes count toward byte eviction')
    const oversized = new ParsedAssetCache(20, 1, f.parse)
    await oversized.load(f.path, 'glb'); await oversized.load(f.path, 'glb'); assert.equal(f.calls(), 9)
  } finally { rmSync(f.dir, { recursive: true, force: true }) }
})

test('older pending parse cannot replace a newer file version', async () => {
  const f = fixture()
  try {
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    let calls = 0
    const cache = new ParsedAssetCache(2, 100000, async (...args) => {
      if (++calls === 1) await gate
      return f.parse(...args)
    })
    const old = cache.load(f.path, 'glb')
    writeFileSync(f.path, 'new version')
    assert.equal((await cache.load(f.path, 'glb')).scene.name, 'new version')
    release()
    assert.equal((await old).scene.name, 'first')
    assert.equal((await cache.load(f.path, 'glb')).scene.name, 'new version')
    assert.equal(calls, 2)
  } finally { rmSync(f.dir, { recursive: true, force: true }) }
})

test('external glTF buffer stat invalidates parsed scene', async () => {
  const f = fixture()
  try {
    const path = join(f.dir, 'source.gltf'), bin = join(f.dir, 'action.bin')
    writeFileSync(path, JSON.stringify({ buffers: [{ uri: 'action.bin' }] })); writeFileSync(bin, 'one')
    const cache = new ParsedAssetCache(2, 100000, f.parse)
    await cache.load(path, 'gltf'); writeFileSync(bin, 'two changed'); await cache.load(path, 'gltf')
    assert.equal(f.calls(), 2)
  } finally { rmSync(f.dir, { recursive: true, force: true }) }
})

const sambaSource = process.env.C9_SAMBA_SOURCE ?? 'C:/w01-samples/Samba Dancing.fbx'
const expectedDefaultSambaSha = '68fcdb75d373b7338ecf58a9f2f8a2d3a12d3501615a88de9f06285254f644c4'
test('Samba cached inspect/preset/run preserves exact uncached GLB SHA', { skip: !existsSync(sambaSource) }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'c9-samba-'))
  try {
    const source = describeSource(sambaSource, 'Samba Dancing.fbx', false, 'samba')
    const characters = resolve(import.meta.dirname, '../../../../builtin-assets/characters')
    const path = join(characters, readdirSync(characters).filter(n => n.endsWith('.glb')).sort()[0]!)
    const target = { id: 'target', file: 'target.glb', path, sha256: sha256(readFileSync(path)), hipsHeightMeters: 1 }
    const options = parseOptions({ actions: [0] })
    const baseline = await runNormalize({ source: await loadAsset(readFileSync(source.path), 'fbx', { skeletonOnly: true }),
      target: await loadAsset(readFileSync(path), 'glb', { skeletonOnly: true }), sourceLabel: source.name, sourceSha256: source.sha256,
      targetLabel: target.file, targetSha256: target.sha256, ...options, unitMeters: .01 })
    assert.ok('glb' in baseline)
    if (!process.env.C9_SAMBA_SOURCE) assert.equal(sha256(baseline.glb!), expectedDefaultSambaSha)
    const first = await inspect(source, target, options, undefined)
    await buildPreset(source, target, {})
    const second = await inspect(source, target, parseOptions({ actions: [] }), undefined)
    assert.deepEqual(first.actions, second.actions)
    for (let i = 0; i < 3; i++) {
      const result = await runPipeline(source, target, i === 1 ? parseOptions({ actions: [0], review: true }) : options, undefined, undefined, dir, () => {})
      assert.equal(result.report.glbSha256, sha256(baseline.glb!))
      assert.deepEqual((await inspect(source, target, options, undefined)).loss, first.loss)
    }
    console.log('Samba exact SHA:', sha256(baseline.glb!))
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('review index 1 preserves exact GLB and indices; subsequent normal exports retain all action diagnostics', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'c9-review-'))
  try {
    const characters = resolve(import.meta.dirname, '../../../../builtin-assets/characters')
    const path = join(characters, readdirSync(characters).filter(n => n.endsWith('.glb')).sort()[0]!)
    const target = { id: 'target', file: 'target.glb', path, sha256: sha256(readFileSync(path)), hipsHeightMeters: 1 }
    const { json, bin } = decodeGlb(readFileSync(path))
    const hips = json.nodes.findIndex((n: any) => /(^|:)Hips$/.test(n.name ?? ''))
    assert.ok(hips >= 0)
    const offset = Math.ceil(bin.length / 4) * 4, extra = Buffer.alloc(offset - bin.length + 64)
    const values = [0, 1, 0, 0, 0, 1, 0, .1, 0, Math.sqrt(.99), 1, 1, 1, 1.1, 1, 1]
    values.forEach((value, i) => extra.writeFloatLE(value, offset - bin.length + i * 4))
    json.bufferViews ??= []; json.accessors ??= []
    const accessor = (start: number, length: number, type: string) => {
      const bufferView = json.bufferViews.push({ buffer: 0, byteOffset: offset + start, byteLength: length }) - 1
      return json.accessors.push({ bufferView, componentType: 5126, count: 2, type }) - 1
    }
    const time = accessor(0, 8, 'SCALAR'), rotation = accessor(8, 32, 'VEC4'), scale = accessor(40, 24, 'VEC3')
    json.animations = ['unused-scale', 'selected-index-one', 'third-action'].map((name, i) => ({ name,
      samplers: [{ input: time, output: i === 0 ? scale : rotation, interpolation: 'LINEAR' }],
      channels: [{ sampler: 0, target: { node: hips, path: i === 0 ? 'scale' : 'rotation' } }] }))
    const binary = Buffer.concat([Buffer.from(bin), extra]); json.buffers[0].byteLength = binary.length
    const sourcePath = join(dir, 'source-input.glb'); writeFileSync(sourcePath, encodeGlb(json, binary))
    const source = describeSource(sourcePath, 'multi.glb', false, 'multi')
    const run = (raw: any) => runPipeline(source, target, parseOptions(raw), undefined, undefined, dir, () => {})
    const before = await inspect(source, target, parseOptions({}), undefined)
    const normal = await run({ actions: [1] })
    const normalGlb = readFileSync(join(dir, normal.files.find(f => f.kind === 'glb')!.name))
    const review = await run({ actions: [1], review: true })
    assert.equal(review.status, 'PASS', JSON.stringify(review.report))
    assert.deepEqual(readFileSync(join(dir, review.files.find(f => f.kind === 'glb')!.name)), normalGlb)
    assert.equal(review.report.glbSha256, normal.report.glbSha256)
    assert.equal((review.manifest as any).actions[0].sourceActionIndex, 1)
    assert.equal((review.manifest as any).actions[0].name, 'selected-index-one')
    assert.deepEqual(review.report.actions.map((a: any) => [a.index, a.name, a.durationSeconds]),
      normal.report.actions.map((a: any) => [a.index, a.name, a.durationSeconds]))
    const after = await inspect(source, target, parseOptions({}), undefined)
    assert.deepEqual(after.actions, before.actions); assert.deepEqual(after.loss, before.loss)
    const exported = await run({})
    assert.equal(exported.report.exportedActions, 3)
    assert.deepEqual((exported.manifest as any).actions.map((a: any) => a.sourceActionIndex), [0, 1, 2])
    assert.equal(exported.report.loss.scaleTracks.dropped, 1, 'unselected scale diagnostics survive review')
    assert.equal(exported.report.actions.length, 3)
    await assert.rejects(run({ review: true }), /exactly one Action/)
    await assert.rejects(run({ review: true, actions: [0, 1] }), /exactly one Action/)
    assert.equal(parseOptions({ review: 'true' }).review, false)
    console.log('Review index 1 exact SHA:', review.report.glbSha256)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
