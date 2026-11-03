import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { PropertyBinding } from 'three'
import { makeEmptyDraft } from '@topview/3d-builder'
import { executeUnifiedCommand, readUnifiedProject } from '../src/unifiedProjectStore'
import { stageAssetUpload } from '../src/unifiedAssetFiles'
import { sampleProjectSkeletonRange } from '../src/unifiedSkeletonEvaluation'

// App 3 scene mode, wave S1 (docs/APP3-SCENE-MODE-TASK-2026-11-03.md): contract, widening, F2 match, multi-character import.
const editor = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const temp = mkdtempSync(path.join(tmpdir(), 'app3-scene-s1-'))
process.env.BBS_UNIFIED_PROJECTS_DIR = path.join(temp, 'projects')
process.env.W01_LIBRARY = path.join(temp, 'w01-library')
test.after(() => rmSync(temp, { recursive: true, force: true }))

const fixtureDir = path.join(editor, 'apps/studio/public/retarget/v9.12')
const targetGlb = path.join(editor, '../builtin-assets/characters/a3d_char_30ec53c93eae4173946b38639691ebe0.glb')
let glbBytes: Buffer, glbManifest: any
function generate() {
  if (glbBytes) return
  const out = path.join(temp, 'normalized')
  const run = spawnSync(process.execPath, ['--import', 'tsx', '../retarget/cli/normalize.ts', '--src', path.join(fixtureDir, 'minecraft-actions.bobj'), '--armature', path.join(fixtureDir, 'minecraft20-armature.bobj'), '--target', targetGlb, '--out', out, '--action', '0,27'], { cwd: path.join(editor, 'packages/builder'), encoding: 'utf8', timeout: 120000 })
  assert.equal(run.status, 0, run.stdout + run.stderr)
  const files = readdirSync(out)
  glbBytes = readFileSync(path.join(out, files.find((x) => x.endsWith('.glb'))!))
  glbManifest = JSON.parse(readFileSync(path.join(out, files.find((x) => x.endsWith('.manifest.json'))!), 'utf8'))
  assert.equal(glbManifest.actions.length, 2)
}
const upload = (data: Buffer | Uint8Array, name = 'upload.bin') => stageAssetUpload(name, new ReadableStream({ start(c) { c.enqueue(data); c.close() } }))
const sha = (data: Uint8Array) => createHash('sha256').update(data).digest('hex')
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')

interface CharacterSpec { name: string; clips: Array<{ action: 0 | 1; start: number }>; x: number; z: number }
type Fixture = Awaited<ReturnType<typeof buildScene>>
/** Synthetic scene: one imported two-Action GLB (Actions 0 = 28 frames, 1 = 47 frames), N duplicates of the builtin model. */
async function buildScene(specs: CharacterSpec[]) {
  generate()
  const created = await executeUnifiedCommand({ requestId: randomUUID(), command: 'project.create', args: { name: 'SceneS1', scene: makeEmptyDraft('SceneS1', 30, 180, { fov: 50, position: { x: 0, y: 2, z: 8 }, rotation: { x: 0, y: 0, z: 0 }, lookAt: { x: 0, y: 1, z: 0 } }) } })
  const projectId = created.projectId
  let revision = 0
  const send = async (command: string, args: Record<string, unknown>) => { const result = await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: revision, command, args }); revision = result.revision; return result }
  await send('asset.import', { files: [(await upload(glbBytes, 'actions.glb')).id], format: 'glb', manifest: glbManifest })
  const model = await send('asset.import', { files: [(await upload(readFileSync(targetGlb), 'target.glb')).id], format: 'glb' })
  const characters: string[] = []
  for (const spec of specs) {
    const character = await send('character.add', { assetId: (model.result.assetIds as string[])[0], skeletonId: (model.result.skeletonIds as string[])[0], name: spec.name })
    const id = String(character.result.characterId)
    characters.push(id)
    for (const clip of spec.clips) await send('motion.place', { characterId: id, motionId: glbManifest.actions[clip.action].uuid, frameStart: clip.start })
  }
  await send('scene.layout.apply', { frame: 0, placements: specs.map((spec, i) => ({ characterId: characters[i], position: { x: spec.x, z: spec.z }, lookAt: { point: { x: spec.x + 1, z: spec.z + 0.5 } } })) })
  const project = await readUnifiedProject(projectId)
  const cameraNodeId = project.scene.content.nodes.find((node) => node.type === 'camera')!.id
  const clipsOf = (characterId: string) => project.scene.content.timeline.animation.motionClips.filter((clip) => clip.target.nodeId === project.characters[characterId]!.nodeId)
  return { projectId, send, characters, cameraNodeId, clipsOf, current: () => readUnifiedProject(projectId) }
}
/** A: Action0 [0,28] + Action1 adjacent [29,76] (a chain); B: Action1 [40,87]. */
const TWO: CharacterSpec[] = [
  { name: 'A', clips: [{ action: 0, start: 0 }, { action: 1, start: 29 }], x: 0, z: 0 },
  { name: 'B', clips: [{ action: 1, start: 40 }], x: 2.5, z: 1 },
]
const twoScene = () => buildScene(TWO)

async function exportShot(fx: Fixture, range: [number, number], editable: string[], sceneMode = true) {
  const { getUnifiedJob, readUnifiedJobFile } = await import('../src/unifiedJobs')
  const { unzipPackage } = await import('../src/shotPackage')
  const started = Date.now()
  const response = await fx.send('shot.export', { cameraNodeId: fx.cameraNodeId, frameStart: range[0], frameEnd: range[1], editableCharacterIds: editable, ...(sceneMode ? { sceneMode: true } : {}) })
  const elapsedMs = Date.now() - started
  const job = await getUnifiedJob(String(response.result.jobId), fx.projectId)
  const artifact = await readUnifiedJobFile(job.jobId, fx.projectId, '0'); assert.ok(artifact)
  const files = unzipPackage(artifact.bytes)
  return { response, files, shot: JSON.parse(Buffer.from(files['shot.json']!).toString()) as any, elapsedMs }
}
function writeFiles(files: Record<string, Uint8Array>, label: string) {
  const folder = path.join(temp, `${label}-${randomUUID()}`)
  for (const [name, data] of Object.entries(files)) { mkdirSync(path.dirname(path.join(folder, name)), { recursive: true }); writeFileSync(path.join(folder, name), data) }
  return folder
}
const python = (...args: string[]) => spawnSync('python3', ['-m', 'agent.shot_package', ...args], { cwd: path.join(editor, '..'), encoding: 'utf8' })

function tweakGlb(bytes: Uint8Array, label: string) {
  const source = Buffer.from(bytes), length = source.readUInt32LE(12), document = JSON.parse(source.subarray(20, 20 + length).toString())
  document.asset.generator = `Scene S1 edit ${label}`
  const json = Buffer.from(JSON.stringify(document)), padded = Buffer.alloc(Math.ceil(json.length / 4) * 4, 32); json.copy(padded)
  const edited = Buffer.concat([source.subarray(0, 12), Buffer.alloc(8), padded, source.subarray(20 + length)])
  edited.writeUInt32LE(edited.length, 8); edited.writeUInt32LE(padded.length, 12); edited.writeUInt32LE(0x4e4f534a, 16)
  return edited
}
/** Result package that edits `editedIds` (each gets a fresh Action UUID and a tweaked copy of its baked GLB). */
async function buildResult(shot: any, shotFiles: Record<string, Uint8Array>, editedIds: string[]) {
  const { jsonBytes, zipPackage } = await import('../src/shotPackage')
  const files: Record<string, Uint8Array> = {}, edits: any[] = [], newIds: Record<string, string> = {}
  for (const characterId of editedIds) {
    const character = shot.characters.find((c: any) => c.characterId === characterId); assert.ok(character, characterId)
    const edited = tweakGlb(shotFiles[character.glb]!, characterId), actionId = randomUUID(), base = JSON.parse(Buffer.from(shotFiles[character.manifest]!).toString())
    const manifest = { ...base, glbSha256: sha(edited), actions: [{ ...base.actions[0], uuid: actionId, originalActionUuid: character.actionUuid }] }
    files[`edits/${characterId}.glb`] = edited; files[`edits/${characterId}.manifest.json`] = jsonBytes(manifest)
    newIds[characterId] = actionId
    edits.push({ characterId, originalActionUuid: character.actionUuid, newActionUuid: actionId, glb: `edits/${characterId}.glb`, manifest: `edits/${characterId}.manifest.json`, glbSha256: sha(edited), placementKeys: [{ frame: shot.frameRange[0], position: character.placement.position, yawDegrees: character.placement.yawDegrees }, { frame: shot.frameRange[1], position: character.placement.position, yawDegrees: character.placement.yawDegrees }] })
  }
  files['result.json'] = jsonBytes({ version: '1.0.0', shotId: shot.shotId, baseShotSha256: sha(shotFiles['shot.json']!), edits })
  return { files, zip: Buffer.from(zipPackage(files)), newIds }
}
const characterState = (project: any, characterId: string) => {
  const nodeId = project.characters[characterId].nodeId
  const clips = project.scene.content.timeline.animation.motionClips.filter((clip: any) => clip.target.nodeId === nodeId)
  return { clips, bindings: clips.map((clip: any) => project.bindings[clip.id]), motions: clips.map((clip: any) => project.motions[clip.motion.assetId]) }
}
const fullyInside = (clips: any[], range: [number, number]) => clips.every((clip) => clip.frameStart >= range[0] && clip.frameEnd <= range[1])
const touching = (clips: any[], range: [number, number]) => clips.filter((clip) => clip.frameStart <= range[1] && clip.frameEnd >= range[0])

test('1. two-character scene export: both editable, sceneMode, first editing character first, TS + Python validators accept', async () => {
  const { validateShot } = await import('../src/shotPackage')
  const fx = await twoScene(), before = await fx.current()
  const [a, b] = fx.characters as [string, string]
  const union: [number, number] = [0, Math.max(...[...fx.clipsOf(a), ...fx.clipsOf(b)].map((clip) => clip.frameEnd))]
  for (const order of [[b, a], [a, b]]) {
    const { response, files, shot } = await exportShot(fx, union, order)
    assert.equal(shot.sceneMode, true)
    assert.equal(shot.characters.length, 2)
    assert.ok(shot.characters.every((c: any) => c.editable === true))
    assert.equal(shot.characters[0].characterId, order[0], 'first editing character is characters[0]')
    assert.deepEqual(shot.frameRange, union)
    assert.deepEqual(validateShot(files), [])
    assert.equal(response.result.sceneMode, true)
    assert.deepEqual(response.result.frameRange, union)
    assert.equal(new Set(response.result.characterIds as string[]).size, 2)
    assert.equal((response.result.characterIds as string[])[0], order[0])
    assert.equal(response.result.widened, false)
    const folder = writeFiles(files, 'shot')
    const checked = python('validate-shot', folder)
    assert.equal(checked.status, 0, checked.stdout + checked.stderr)
    assert.ok(validateShot({ ...files, 'shot.json': Buffer.from(JSON.stringify({ ...shot, sceneMode: 'yes' })) }).some((i) => i.code === 'INVALID_TYPE'))
    assert.equal(python('validate-shot', writeFiles({ ...files, 'shot.json': Buffer.from(JSON.stringify({ ...shot, sceneMode: 'yes' })) }, 'shot-bad')).status, 1)
  }
  assert.deepEqual(await fx.current(), before, 'export must not change the project')
})

test('2. range widening: a range cutting clips of another character widens to cover them fully', async () => {
  const fx = await twoScene()
  const [a, b] = fx.characters as [string, string]
  const request: [number, number] = [20, 50]
  const { response, shot } = await exportShot(fx, request, [a])
  const range = shot.frameRange as [number, number]
  assert.ok(range[0] <= request[0] && range[1] >= request[1])
  const all = [...fx.clipsOf(a), ...fx.clipsOf(b)]
  for (const clip of touching(all, range)) assert.ok(fullyInside([clip], range), `clip ${clip.frameStart}-${clip.frameEnd} must lie inside ${range}`)
  // B's single clip [40,87] is cut by 20-50 and A's two adjacent clips [0,28],[29,76] both touch it, so the fixpoint is [0,87].
  assert.deepEqual(range, [0, Math.max(...all.map((c) => c.frameEnd))])
  assert.equal(response.result.widened, true)
  assert.deepEqual(response.result.frameRange, range)
  assert.deepEqual([...(response.result.characterIds as string[])].sort(), [a, b].sort())
  assert.equal(shot.characters.length, 2)
  // §10.1: the widening unit is the CHAIN. Range 35-50 touches only A's second clip, but A's clips 0-28 + 29-76 are one
  // adjacent chain, so the whole chain is pulled in and the joint 28->29 is never cut: [0,87].
  const narrow = await exportShot(fx, [35, 50], [a])
  for (const clip of touching(all, narrow.shot.frameRange)) assert.ok(fullyInside([clip], narrow.shot.frameRange))
  assert.deepEqual(narrow.shot.frameRange, [0, Math.max(...all.map((c) => c.frameEnd))])
  // A request that only touches B (after A's chain) still pulls in everything B touches.
  const second = await exportShot(fx, [85, 87], [b])
  assert.ok(touching([...fx.clipsOf(b)], second.shot.frameRange).every((clip) => fullyInside([clip], second.shot.frameRange)))
  assert.equal(second.shot.characters[0].characterId, b)
})

// ----- F2 match (§8): App 2 sampler vs. the baked GLB animation in the package -----------------------------------
function readGlb(bytes: Uint8Array) {
  const buffer = Buffer.from(bytes), jsonLength = buffer.readUInt32LE(12), json = JSON.parse(buffer.subarray(20, 20 + jsonLength).toString())
  const binOffset = 20 + jsonLength + 8
  return { json, bin: buffer.subarray(binOffset, binOffset + buffer.readUInt32LE(20 + jsonLength)) }
}
function accessor(glb: ReturnType<typeof readGlb>, index: number): { values: Float32Array; size: number } {
  const acc = glb.json.accessors[index], view = glb.json.bufferViews[acc.bufferView]
  const size = { SCALAR: 1, VEC3: 3, VEC4: 4 }[acc.type as 'SCALAR' | 'VEC3' | 'VEC4']
  const start = (view.byteOffset ?? 0) + (acc.byteOffset ?? 0)
  const copy = Buffer.from(glb.bin.subarray(start, start + acc.count * size * 4))
  return { values: new Float32Array(copy.buffer, copy.byteOffset, acc.count * size), size }
}
const angleDegrees = (p: ArrayLike<number>, q: ArrayLike<number>) => 2 * Math.acos(Math.min(1, Math.abs(p[0]! * q[0]! + p[1]! * q[1]! + p[2]! * q[2]! + p[3]! * q[3]!))) * 180 / Math.PI

test('3. F2 match: baked package animation and placement equal the App 2 sampler / scene.evaluate (0.5 deg bones, 1 cm root, 1 deg yaw)', async () => {
  const fx = await twoScene()
  const [a, b] = fx.characters as [string, string]
  const { shot, files } = await exportShot(fx, [0, 87], [a])
  const range = shot.frameRange as [number, number], span = range[1] - range[0] + 1
  const project = await fx.current()
  const frames = [0, Math.floor(span / 2), span - 1]
  let maxBoneDegrees = 0, maxRootCm = 0, maxPlacementCm = 0, maxYawDegrees = 0
  const evaluate = await fx.send('scene.evaluate', { frame: range[0] })
  for (const characterId of [a, b]) {
    const entry = shot.characters.find((c: any) => c.characterId === characterId); assert.ok(entry)
    const glb = readGlb(files[entry.glb]!), animation = glb.json.animations[0]
    const nodeByName = new Map<string, number>()
    glb.json.nodes.forEach((node: any, index: number) => { if (typeof node.name === 'string') { nodeByName.set(node.name, index); nodeByName.set(PropertyBinding.sanitizeNodeName(node.name), index) } })
    const channels = new Map<string, { values: Float32Array; size: number }>()
    for (const channel of animation.channels) channels.set(`${channel.target.node}.${channel.target.path}`, accessor(glb, animation.samplers[channel.sampler].output))
    const samples: any[] = []
    for await (const sample of sampleProjectSkeletonRange(project, { startFrame: range[0], endFrame: range[1], sampleFps: 30 }, [characterId])) if (sample.side === 'right') samples.push(sample)
    assert.equal(samples.length, span)
    for (const k of frames) {
      for (const bone of samples[k].skeletonSamples[0].bones) {
        const node = nodeByName.get(bone.name); assert.notEqual(node, undefined, bone.name)
        const rotation = channels.get(`${node}.rotation`), restRotation = glb.json.nodes[node!].rotation ?? [0, 0, 0, 1]
        const baked = rotation ? Array.from(rotation.values.subarray(k * 4, k * 4 + 4)) : restRotation
        maxBoneDegrees = Math.max(maxBoneDegrees, angleDegrees(baked, bone.rotation))
        if (/hips$/i.test(bone.name)) {
          const translation = channels.get(`${node}.translation`), rest = glb.json.nodes[node!].translation ?? [0, 0, 0]
          const t = translation ? Array.from(translation.values.subarray(k * 3, k * 3 + 3)) : rest
          maxRootCm = Math.max(maxRootCm, 100 * Math.hypot(t[0]! - bone.position[0]!, t[1]! - bone.position[1]!, t[2]! - bone.position[2]!))
        }
      }
    }
    const transform = (evaluate.result.transforms as any)[project.characters[characterId]!.nodeId]
    const p = entry.placement.position as number[]
    maxPlacementCm = Math.max(maxPlacementCm, 100 * Math.hypot(p[0]! - transform.position.x, p[1]! - transform.position.y, p[2]! - transform.position.z))
    const dyaw = ((entry.placement.yawDegrees - transform.rotation.y) % 360 + 540) % 360 - 180
    maxYawDegrees = Math.max(maxYawDegrees, Math.abs(dyaw))
  }
  console.log(`S1 F2 match (frames ${frames.map((k) => range[0] + k).join('/')}): max bone rotation error ${maxBoneDegrees.toFixed(4)} deg, max Hips translation error ${maxRootCm.toFixed(4)} cm, max placement position error ${maxPlacementCm.toFixed(4)} cm, max placement yaw error ${maxYawDegrees.toFixed(4)} deg`)
  assert.ok(maxBoneDegrees <= 0.5, `bone ${maxBoneDegrees}`)
  assert.ok(maxRootCm <= 1, `root ${maxRootCm}`)
  assert.ok(maxPlacementCm <= 1, `placement ${maxPlacementCm}`)
  assert.ok(maxYawDegrees <= 1, `yaw ${maxYawDegrees}`)
})

const mergesFor = (ids: string[]) => Object.fromEntries(ids.map((id, i) => [id, { name: `Merged ${i + 1} ${id.slice(0, 4)}`, description: `scene edit ${i + 1}` }]))

test('4+9. result import with 2 edited characters: one merged clip each, one revision, one undo; Python validates the result', async () => {
  const { unzipPackage } = await import('../src/shotPackage')
  const fx = await twoScene(), [a, b] = fx.characters as [string, string]
  const { response, files, shot } = await exportShot(fx, [20, 60], [a])
  const range = shot.frameRange as [number, number]
  const before = await fx.current()
  const { files: resultFiles, zip, newIds } = await buildResult(shot, files, [a, b])
  const { validateResult } = await import('../src/shotPackage')
  assert.deepEqual(validateResult(resultFiles, files), [])
  // 9: Python validates the same result package against the exported shot.
  const python9 = python('validate-result', writeFiles(unzipPackage(zip), 'result'), '--shot', writeFiles(files, 'shot-for-result'))
  assert.equal(python9.status, 0, python9.stdout + python9.stderr)
  const merges = mergesFor([a, b])
  const imported = await fx.send('shot.result.import', { file: (await upload(zip, 'result.zip')).id, shotId: shot.shotId, merges })
  const after = await fx.current()
  assert.equal(after.revision, before.revision + 1, 'whole import is one revision')
  assert.deepEqual(Object.keys(imported.result.mergedClipIds as object).sort(), [a, b].sort())
  for (const id of [a, b]) {
    const clips = fx.clipsOf(id).length // stale project snapshot; re-read below
    void clips
    const state = characterState(after, id)
    assert.equal(state.clips.length, 1, `character ${id} has exactly one clip`)
    assert.equal(state.clips[0].frameStart, range[0]); assert.equal(state.clips[0].frameEnd, range[1])
    assert.equal(state.clips[0].id, (imported.result.mergedClipIds as any)[id])
    assert.ok([state.clips[0].motion.name, after.motions[state.clips[0].motion.assetId]?.name].includes(merges[id]!.name), 'merged clip carries the given name')
    assert.equal(after.bindings[state.clips[0].id]!.characterId, id)
  }
  assert.ok(after.motions[newIds[a]!] || Object.keys(after.motions).length > Object.keys(before.motions).length, 'new Motions were registered')
  assert.ok(response.result.widened === true || response.result.widened === false)
  await fx.send('history.undo', {})
  const undone = await fx.current()
  assert.deepEqual(undone.scene, before.scene); assert.deepEqual(undone.extensions, before.extensions)
  assert.deepEqual(undone.motions, before.motions); assert.deepEqual(undone.bindings, before.bindings)
})

test('5. result import with only 1 of 2 edited: the unedited character is untouched (clip/binding/motion hash)', async () => {
  const fx = await twoScene(), [a, b] = fx.characters as [string, string]
  const { files, shot } = await exportShot(fx, [20, 60], [a])
  const before = await fx.current(), untouchedBefore = hash(characterState(before, b)), editedBefore = hash(characterState(before, a))
  const { zip } = await buildResult(shot, files, [a])
  const merges = mergesFor([a])
  const imported = await fx.send('shot.result.import', { file: (await upload(zip, 'result.zip')).id, shotId: shot.shotId, merges })
  const after = await fx.current()
  assert.deepEqual(Object.keys(imported.result.mergedClipIds as object), [a])
  assert.equal(hash(characterState(after, b)), untouchedBefore, 'unedited character hash unchanged')
  assert.notEqual(hash(characterState(after, a)), editedBefore)
  const state = characterState(after, a)
  assert.equal(state.clips.length, 1); assert.deepEqual([state.clips[0].frameStart, state.clips[0].frameEnd], shot.frameRange)
  assert.equal(after.revision, before.revision + 1)
  await fx.send('history.undo', {})
  const undone = await fx.current()
  assert.equal(hash(characterState(undone, a)), editedBefore); assert.equal(hash(characterState(undone, b)), untouchedBefore)
  assert.deepEqual(undone.scene, before.scene)
})

test('6. five characters: scene export includes all 5, import with 5 edits works and one undo restores', async () => {
  const { validateShot } = await import('../src/shotPackage')
  const specs: CharacterSpec[] = [
    { name: 'C0', clips: [{ action: 0, start: 0 }, { action: 1, start: 29 }], x: -4, z: 0 },
    { name: 'C1', clips: [{ action: 1, start: 10 }], x: -2, z: 1 },
    { name: 'C2', clips: [{ action: 0, start: 20 }], x: 0, z: 2 },
    { name: 'C3', clips: [{ action: 1, start: 30 }], x: 2, z: 1 },
    { name: 'C4', clips: [{ action: 0, start: 40 }, { action: 1, start: 69 }], x: 4, z: 0 },
  ]
  const fx = await buildScene(specs), ids = fx.characters
  const { response, files, shot, elapsedMs } = await exportShot(fx, [20, 60], [ids[2]!])
  console.log(`S1 five-character scene export: ${elapsedMs} ms, frameRange ${JSON.stringify(shot.frameRange)}, characters ${shot.characters.length}`)
  assert.equal(shot.characters.length, 5); assert.ok(shot.characters.every((c: any) => c.editable)); assert.equal(shot.characters[0].characterId, ids[2])
  assert.equal(new Set(response.result.characterIds as string[]).size, 5)
  assert.deepEqual(validateShot(files), [])
  const before = await fx.current()
  const { zip } = await buildResult(shot, files, ids)
  const merges = mergesFor(ids)
  const started = Date.now()
  const imported = await fx.send('shot.result.import', { file: (await upload(zip, 'result.zip')).id, shotId: shot.shotId, merges })
  console.log(`S1 five-character result import: ${Date.now() - started} ms`)
  const after = await fx.current()
  assert.equal(after.revision, before.revision + 1)
  assert.equal(Object.keys(imported.result.mergedClipIds as object).length, 5)
  for (const id of ids) { const state = characterState(after, id); assert.equal(state.clips.length, 1); assert.deepEqual([state.clips[0].frameStart, state.clips[0].frameEnd], shot.frameRange) }
  await fx.send('history.undo', {})
  const undone = await fx.current()
  assert.deepEqual(undone.scene, before.scene); assert.deepEqual(undone.extensions, before.extensions); assert.deepEqual(undone.motions, before.motions); assert.deepEqual(undone.bindings, before.bindings)
})

test('7. regression: single-character export (no sceneMode) has exactly one editable and no sceneMode key', async () => {
  const { validateShot } = await import('../src/shotPackage')
  const fx = await twoScene(), [a] = fx.characters as [string, string]
  const { shot, files, response } = await exportShot(fx, [0, 76], [a], false)
  assert.equal(shot.characters.filter((c: any) => c.editable).length, 1)
  assert.equal(shot.characters[0].characterId, a)
  assert.equal('sceneMode' in shot, false)
  assert.deepEqual(shot.frameRange, [0, 76])
  assert.deepEqual(validateShot(files), [])
  assert.notEqual(response.result.sceneMode, true)
})

test('8. bad merges (unknown characterId, empty name, extra key) are rejected without changing the project', async () => {
  const fx = await twoScene(), [a, b] = fx.characters as [string, string]
  const { files, shot } = await exportShot(fx, [20, 60], [a])
  const before = await fx.current()
  const { zip } = await buildResult(shot, files, [a, b])
  const attempts: Array<Record<string, unknown>> = [
    { ...mergesFor([a, b]), [randomUUID()]: { name: 'ghost', description: '' } },
    { ...mergesFor([a, b]), [b]: { name: '   ', description: 'x' } },
    { ...mergesFor([a, b]), [a]: { name: '', description: '' } },
    { ...mergesFor([a, b]), [a]: { name: 'ok', description: 'x', extra: true } },
  ]
  for (const merges of attempts) {
    await assert.rejects(executeUnifiedCommand({ requestId: randomUUID(), projectId: fx.projectId, expectedRevision: before.revision, command: 'shot.result.import', args: { file: (await upload(zip, 'result.zip')).id, shotId: shot.shotId, merges } }))
    assert.deepEqual(await fx.current(), before, 'rejected import must not change the project')
  }
})
