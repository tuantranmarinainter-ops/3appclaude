import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { MIXAMO65_BONE_PARENTS } from '../../../packages/retarget/src/mixamo65'
import { decodeGlb, encodeGlb } from '../../../packages/retarget/cli/glb'
import { parseBobjActions } from '../../../packages/retarget/src/index'
import { createCharacter, registerBaseModel } from '../../../packages/library/characters'
import { getAction, importPack } from '../../../packages/library/library'
import { createLibraryMotionConversion, materializeLibraryMotionConversion } from '../src/libraryMotionConversion'
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
function syntheticMixamo(): Uint8Array {
  const indices = new Map(MIXAMO65_BONE_PARENTS.map(([name], index) => [name, index]))
  const nodes = MIXAMO65_BONE_PARENTS.map(([name, parent]) => ({ name, children: [] as number[], translation: !parent ? [0, 1, 0] : name.includes('UpLeg') ? [name.startsWith('Left') ? .1 : -.1, -.1, 0] : name.includes('Leg') || name.includes('Foot') ? [0, -.2, 0] : name.includes('Arm') || name.includes('Hand') ? [name.startsWith('Left') ? .15 : -.15, 0, 0] : [0, .05, 0] }))
  for (const [name, parent] of MIXAMO65_BONE_PARENTS) if (parent) nodes[indices.get(parent)!]!.children.push(indices.get(name)!)
  const data = new Float32Array([0, .2, 0, 0, 0, 1, 0, 0, Math.sin(.2), Math.cos(.2)])
  return encodeGlb({ asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes, skins: [{ joints: nodes.map((_, index) => index), skeleton: 0 }], buffers: [{ byteLength: data.byteLength }], bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 8 }, { buffer: 0, byteOffset: 8, byteLength: 32 }], accessors: [{ bufferView: 0, componentType: 5126, count: 2, type: 'SCALAR', min: [0], max: [.2] }, { bufferView: 1, componentType: 5126, count: 2, type: 'VEC4' }], animations: [{ name: 'Wave', samplers: [{ input: 0, output: 1, interpolation: 'LINEAR' }], channels: [{ sampler: 0, target: { node: indices.get('LeftArm'), path: 'rotation' } }] }] }, new Uint8Array(data.buffer))
}
function fixture(t: { after(fn: () => void): void }) {
  const workspace = mkdtempSync(join(tmpdir(), 'b34-conversion-'))
  t.after(() => rmSync(workspace, { recursive: true, force: true }))
  const root = join(workspace, 'library'), cacheRoot = join(workspace, 'cache'), sourceDirectory = join(workspace, 'source')
  mkdirSync(sourceDirectory)
  const bytes = syntheticMixamo(), uuid = randomUUID()
  writeFileSync(join(sourceDirectory, 'source.glb'), bytes)
  writeFileSync(join(sourceDirectory, 'source.manifest.json'), JSON.stringify({ version: '1.0.0', rig: 'mixamo65', glbSha256: sha(bytes), actions: [{ uuid, name: 'Wave', durationSeconds: .2, fps: 20, glbAnimationIndex: 0 }] }))
  writeFileSync(join(sourceDirectory, 'source.report.json'), JSON.stringify({ status: 'PASS' }))
  importPack({ root, sourceDirectory })
  const armature = readFileSync(resolve(__dirname, '../public/retarget/v9.12/minecraft20-armature.bobj'), 'utf8')
  const modelFile = join(workspace, 'minecraft.bobj')
  writeFileSync(modelFile, `${armature}\no Body\no_arm minecraft20\nv 0 0 0\nvw body 1\nv 0 2 0\nvw head 1\nv 1 0 0\nvw body 1\nf 1 2 3\n`)
  const registered = registerBaseModel({ root, name: 'Synthetic MC20', rig: 'minecraft20', modelFile })
  createCharacter({ root, charId: 'den', name: 'Đen', baseModelId: registered.modelId })
  return { root, cacheRoot, uuid, options: { libraryRoot: root, cacheRoot }, bytes }
}
test('real reverse solver produces MC20 motion and cache deletion regenerates without adding packs', async (t) => {
  const f = fixture(t), before = readdirSync(join(f.root, 'packs'))
  const recipe = await createLibraryMotionConversion({ ...f.options, actionUuid: f.uuid, targetCharId: 'den' })
  assert.equal(recipe.sourceSha256, sha(f.bytes))
  const first = await materializeLibraryMotionConversion(recipe, f.options), glb = decodeGlb(first.glb).json
  assert.equal(glb.skins.at(-1).joints.length, 20)
  assert.equal(glb.animations.length, 1)
  assert.ok(glb.animations[0].channels.length > 0)
  assert.equal(parseBobjActions(first.bobj).size, 1)
  assert.ok(parseBobjActions(first.bobj).has(first.actionName))
  const decodedOutput = decodeGlb(first.glb)
  const varied = glb.animations[0].samplers.some((sampler: { output: number }) => {
    const accessor = glb.accessors[sampler.output], view = glb.bufferViews[accessor.bufferView]
    const values = new Float32Array(decodedOutput.bin.buffer, decodedOutput.bin.byteOffset + (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0), accessor.count * (accessor.type === 'VEC4' ? 4 : 3))
    const size = accessor.type === 'VEC4' ? 4 : 3
    return Array.from(values).some((value, index) => index >= size && Math.abs(value - values[index % size]!) > 1e-5)
  })
  assert.ok(varied, 'converted native animation must move, rather than only contain static channels')
  const again = await materializeLibraryMotionConversion(recipe, f.options)
  assert.equal(again.cacheKey, first.cacheKey)
  assert.equal(sha(again.glb), sha(first.glb))
  writeFileSync(first.glbPath, 'corrupt disposable cache')
  assert.equal(sha((await materializeLibraryMotionConversion(recipe, f.options)).glb), sha(first.glb))
  rmSync(f.cacheRoot, { recursive: true })
  assert.equal(sha((await materializeLibraryMotionConversion(recipe, f.options)).glb), sha(first.glb))
  assert.deepEqual(readdirSync(join(f.root, 'packs')), before)
  assert.deepEqual(await createLibraryMotionConversion({ ...f.options, actionUuid: f.uuid, targetCharId: 'den' }), recipe)
  console.log(`B34 bones=20 animations=1 channels=${glb.animations[0].channels.length} source=${recipe.sourceSha256} output=${sha(first.glb)}`)
})
test('source/version/target drift and output symlinks cannot hide behind cache', async (t) => {
  const f = fixture(t), recipe = await createLibraryMotionConversion({ ...f.options, actionUuid: f.uuid, targetCharId: 'den' })
  const result = await materializeLibraryMotionConversion(recipe, f.options)
  await assert.rejects(materializeLibraryMotionConversion({ ...recipe, converterVersion: 'old' }, f.options), /Bộ chuyển đã đổi/)
  await assert.rejects(materializeLibraryMotionConversion({ ...recipe, targetBaseModelSha256: 'old' }, f.options), /Model nhân vật đã đổi/)
  await assert.rejects(materializeLibraryMotionConversion({ ...recipe, sourceAnimationIndex: 1 }, f.options), /Động tác gốc đã đổi/)
  rmSync(result.glbPath)
  symlinkSync(getAction({ root: f.root, actionUuid: f.uuid }).glbPath, result.glbPath)
  await assert.rejects(materializeLibraryMotionConversion(recipe, f.options), /symbolic links/)
  const path = getAction({ root: f.root, actionUuid: f.uuid }).glbPath
  writeFileSync(path, Buffer.concat([readFileSync(path), Buffer.from('changed')]))
  await assert.rejects(materializeLibraryMotionConversion(recipe, f.options), (error: unknown) => (error as { code: string }).code === 'CONVERSION_REQUIRED' && /Động tác gốc đã đổi/.test(String(error)))
})
test('Mixamo label cannot make native 85-joint source convertible', async (t) => {
  const f = fixture(t), path = getAction({ root: f.root, actionUuid: f.uuid }).glbPath, decoded = decodeGlb(readFileSync(path))
  for (let i = 0; i < 20; i++) { decoded.json.nodes.push({ name: `VerityExtra${i}` }); decoded.json.skins[0].joints.push(65 + i) }
  writeFileSync(path, encodeGlb(decoded.json, decoded.bin))
  await assert.rejects(createLibraryMotionConversion({ ...f.options, actionUuid: f.uuid, targetCharId: 'den' }), /khung xương Mixamo65 thực/)
})
