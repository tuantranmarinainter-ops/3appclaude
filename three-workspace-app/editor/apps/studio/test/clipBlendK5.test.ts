/**
 * K5 integration: Go Xua blend chain -> shot.export (baked) -> return as ONE merged clip -> library -> Undo.
 * Uses COPIES only: a temp project folder (project.json + assets) and a temp copy of the small library fixture.
 * Fixtures live outside the repo (S:\Claude\w01-samples); the tests skip when they are absent.
 */
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { Matrix4, Quaternion, Vector3 } from 'three'
import { createFrameSnapshot, evaluateFrame } from '@topview/3d-builder/evaluate'
import type { UnifiedProject } from '@bbs/animation-workspace-shared'
import { getAction, resolveCharacter, resolveLibraryPath } from '../../../packages/library/index'
import { createShotPackage, saveShotExport } from '../src/shotExchange'
import { jsonBytes, sha256, zipPackage } from '../src/shotPackage'
import { sampleChainFrames } from '../src/shotBake'
import { unpackLibraryGlb } from '../src/libraryModels'
import { stageAssetUpload } from '../src/unifiedAssetFiles'
import { executeUnifiedCommand, readUnifiedProject } from '../src/unifiedProjectStore'
import { projectEvaluationScene, sampleProjectSkeletonRange } from '../src/unifiedSkeletonEvaluation'

const projectId = 'e901aadb-453f-4f69-b6f7-8eceda1f41f3'
const characterId = '49199c34-e125-4c4b-8f35-baf6a1945a5d'
const libraryCharacterId = '3bc37c74-0209-4413-90f4-c69302a43625'
const cameraNodeId = 'user_cam_uf9phu05'
const projectFixture = process.env.K5_PROJECT_FIXTURE || path.join('S:/Claude/w01-samples/clip-blend-k2-projects', projectId)
const libraryFixture = process.env.K5_LIBRARY_FIXTURE || 'S:/Claude/w01-samples/clip-blend-lib'
const available = existsSync(path.join(projectFixture, 'project.json')) && existsSync(path.join(libraryFixture, 'library.json'))
const skip = available ? false : `Fixtures absent: ${projectFixture} / ${libraryFixture}`

const run = mkdtempSync(path.join(os.tmpdir(), 'k5-'))
const oldLibrary = process.env.W01_LIBRARY, oldProjects = process.env.BBS_UNIFIED_PROJECTS_DIR
process.env.W01_LIBRARY = path.join(run, 'library')
process.env.BBS_UNIFIED_PROJECTS_DIR = path.join(run, 'projects')
if (available) {
  cpSync(libraryFixture, process.env.W01_LIBRARY, { recursive: true, dereference: true })
  mkdirSync(path.join(process.env.BBS_UNIFIED_PROJECTS_DIR, projectId), { recursive: true })
  cpSync(path.join(projectFixture, 'project.json'), path.join(process.env.BBS_UNIFIED_PROJECTS_DIR, projectId, 'project.json'))
  cpSync(path.join(projectFixture, 'assets'), path.join(process.env.BBS_UNIFIED_PROJECTS_DIR, projectId, 'assets'), { recursive: true, dereference: true })
  // Undo needs the history index and the record of the current revision only (the rest of the 190 MB history is not read).
  const project = JSON.parse(readFileSync(path.join(projectFixture, 'project.json'), 'utf8')) as { revision: number }
  mkdirSync(path.join(process.env.BBS_UNIFIED_PROJECTS_DIR, projectId, '.history'), { recursive: true })
  for (const file of ['index.json', `${project.revision}.json`]) cpSync(path.join(projectFixture, '.history', file), path.join(process.env.BBS_UNIFIED_PROJECTS_DIR, projectId, '.history', file))
}
test.after(() => {
  if (oldLibrary === undefined) delete process.env.W01_LIBRARY; else process.env.W01_LIBRARY = oldLibrary
  if (oldProjects === undefined) delete process.env.BBS_UNIFIED_PROJECTS_DIR; else process.env.BBS_UNIFIED_PROJECTS_DIR = oldProjects
  rmSync(run, { recursive: true, force: true })
})

const hashProject = (project: unknown) => {
  const copy = JSON.parse(JSON.stringify(project)) as Record<string, unknown>
  delete copy.revision; delete copy.updatedAt
  return createHash('sha256').update(JSON.stringify(copy)).digest('hex')
}
const clipsOf = (project: UnifiedProject) => project.scene.content.timeline.animation.motionClips.filter((c) => c.target.nodeId === project.characters[characterId]!.nodeId)

async function worldPoses(project: UnifiedProject, start: number, end: number) {
  const out: Array<Array<{ name: string; position: Vector3; rotation: Quaternion }>> = []
  for await (const sample of sampleProjectSkeletonRange(project, { startFrame: start, endFrame: end, sampleFps: 30 }, [characterId])) {
    if (sample.side !== 'right') continue
    out.push(sample.skeletonSamples[0]!.bones.map((bone) => {
      const position = new Vector3(), rotation = new Quaternion()
      new Matrix4().fromArray(bone.worldMatrix).decompose(position, rotation, new Vector3())
      return { name: bone.name, position, rotation }
    }))
  }
  return out
}

/** shot.export -> App 3 returns the baked animation unedited -> shot.result.import (optionally with merge info). */
async function exportAndReturn(project: UnifiedProject, merge: unknown, range = { frameStart: 10, frameEnd: 100 }) {
  const built = await createShotPackage(project, { cameraNodeId, ...range, editableCharacterIds: [characterId] })
  await saveShotExport(project, built)
  const shotCharacter = built.shot.characters[0]!
  const bytes = Buffer.from(built.files[shotCharacter.glb]!), id = randomUUID(), hash = sha256(bytes)
  const manifest = JSON.parse(Buffer.from(built.files[shotCharacter.manifest]!).toString())
  manifest.glbSha256 = hash
  manifest.actions = [{ ...manifest.actions[0], uuid: id, originalActionUuid: shotCharacter.actionUuid }]
  const result = { version: '1.0.0', shotId: built.shot.shotId, baseShotSha256: sha256(built.files['shot.json']!), edits: [{ characterId, originalActionUuid: shotCharacter.actionUuid, newActionUuid: id, glb: 'edit.glb', manifest: 'edit.json', glbSha256: hash,
    placementKeys: [{ frame: built.shot.frameRange[0], position: shotCharacter.placement.position, yawDegrees: shotCharacter.placement.yawDegrees }] }] }
  const zip = zipPackage({ 'result.json': jsonBytes(result), 'edit.glb': bytes, 'edit.json': jsonBytes(manifest) })
  const upload = await stageAssetUpload('result.zip', new ReadableStream({ start(controller) { controller.enqueue(zip); controller.close() } }))
  const run = () => executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: project.revision, command: 'shot.result.import',
    args: { file: upload.id, shotId: built.shot.shotId, ...(merge === undefined ? {} : { merge }) } })
  return { built, newActionUuid: id, run }
}

test('library writes in these tests go to the temp copy, never the real library', { skip }, () => {
  assert.equal(path.resolve(resolveLibraryPath()), path.resolve(process.env.W01_LIBRARY!))
  assert.ok(path.resolve(process.env.W01_LIBRARY!).startsWith(path.resolve(os.tmpdir())))
  assert.ok(!/w01-library/i.test(process.env.W01_LIBRARY!))
})

test('shot.export accepts a range covered by a blend chain and bakes the whole chain', { skip }, async () => {
  const project = await readUnifiedProject(projectId)
  const clips = clipsOf(project)
  assert.equal(clips.length, 2)
  const built = await createShotPackage(project, { cameraNodeId, frameStart: 10, frameEnd: 100, editableCharacterIds: [characterId] })
  assert.deepEqual(built.shot.frameRange, [0, 134], 'range widens to the whole chain')
  assert.equal(built.shot.camera.keys.length, 135)
  const character = built.shot.characters[0]!
  assert.deepEqual(character.clip, { sourceStartSeconds: 0, sourceEndSeconds: 134 / 30, speed: 1, loop: false, reverse: false })
  assert.equal(character.rootPolicy, 'skeletal')
  const saved = built.clips[characterId]!
  assert.equal(saved.motionId, character.actionUuid)
  assert.deepEqual(saved.chain!.map((c) => [c.clipId, c.frameStart, c.frameEnd]), clips.map((c) => [c.id, c.frameStart, c.frameEnd]).sort((a, b) => (a[1] as number) - (b[1] as number)))
  const { json } = unpackLibraryGlb(Buffer.from(built.files[character.glb]!))
  assert.equal(json.animations.length, 1)
  const rotationChannels = json.animations[0].channels.filter((c: { target: { path: string } }) => c.target.path === 'rotation')
  assert.ok(rotationChannels.length >= 84, `rotation channel per joint (${rotationChannels.length})`)
  const manifest = JSON.parse(Buffer.from(built.files[character.manifest]!).toString())
  assert.equal(manifest.actions[0].uuid, character.actionUuid)
  assert.ok(Math.abs(manifest.actions[0].durationSeconds - 134 / 30) < 1e-9)
  // The baked animation is exactly the sampler output of App 2 (same blend path): spot check COG at three frames.
  const frames = await sampleChainFrames(project, characterId, [0, 134])
  assert.equal(frames.length, 135)
  const cog = json.nodes.findIndex((n: { name?: string }) => n.name === 'COG')
  const channel = json.animations[0].channels.find((c: { target: { node: number; path: string } }) => c.target.node === cog && c.target.path === 'translation')
  assert.ok(channel, 'COG carries the root/hip motion')
  const { binary } = unpackLibraryGlb(Buffer.from(built.files[character.glb]!))
  const accessor = json.accessors[json.animations[0].samplers[channel.sampler].output], view = json.bufferViews[accessor.bufferView]
  for (const frame of [0, 50, 134]) {
    const expected = frames[frame]!.bones.find((b) => b.name === 'COG')!.position
    for (let k = 0; k < 3; k++) assert.ok(Math.abs(binary.readFloatLE((view.byteOffset ?? 0) + (frame * 3 + k) * 4) - expected[k]!) < 1e-5)
  }
})

test('shot.export still rejects ranges across unconnected clips, with a clear Vietnamese message', { skip }, async () => {
  const project = structuredClone(await readUnifiedProject(projectId))
  const [a, b] = clipsOf(project).sort((x, y) => x.frameStart - y.frameStart)
  delete b!.playback.blendIn
  b!.frameStart = 59; b!.frameEnd = 149
  await assert.rejects(createShotPackage(project, { cameraNodeId, frameStart: 10, frameEnd: 100, editableCharacterIds: [characterId] }), (error: Error) => {
    assert.match(error.message, /Gỗ Xưa · Shot 01 cần đúng một MotionClip phủ hết frame 10–100/)
    assert.match(error.message, /LocSpellPrecastBoth \(ID 920 variation 0\) \(0–58\)/)
    assert.match(error.message, /DruReadySpellCast \(ID 940 variation 0\) \(59–149\)/)
    assert.match(error.message, /Khoảng hợp lệ: 0–58, 59–149/)
    return true
  })
  // Each single clip still exports through the unchanged one-clip path.
  const single = await createShotPackage(project, { cameraNodeId, frameStart: a!.frameStart, frameEnd: a!.frameEnd, editableCharacterIds: [characterId] })
  assert.equal(single.clips[characterId]!.chain, undefined)
})

test('return as merged clip: one clip, poses unchanged, library Action under the character, one Undo', { skip }, async () => {
  const before = await readUnifiedProject(projectId)
  const hashBefore = hashProject(before)
  const scene = projectEvaluationScene(before)
  const placement = (project: UnifiedProject, frame: number) => {
    const snapshot = createFrameSnapshot()
    evaluateFrame(projectEvaluationScene(project), frame, snapshot)
    const t = snapshot.transforms.get(project.characters[characterId]!.nodeId)!
    return [t.position.x, t.position.y, t.position.z, t.rotation.y]
  }
  void scene
  const placements = [0, 60, 134].map((frame) => placement(before, frame))
  const posesBefore = await worldPoses(before, 0, 134)
  const localBefore = await sampleChainFrames(before, characterId, [0, 134])

  const name = 'Gộp thử K5', description = 'Gộp thử từ hai clip Gỗ Xưa, trộn 15 khung, khóa chân'
  const flow = await exportAndReturn(before, { name, description })
  const imported = await flow.run()
  assert.deepEqual(imported.result.motionIds, [flow.newActionUuid])
  assert.deepEqual(imported.result.libraryActionUuids, [flow.newActionUuid])

  const after = await readUnifiedProject(projectId)
  const merged = clipsOf(after)
  assert.equal(merged.length, 1)
  assert.deepEqual([merged[0]!.frameStart, merged[0]!.frameEnd], [0, 134])
  assert.equal(merged[0]!.playback.blendIn, undefined)
  assert.equal(merged[0]!.motion.assetId, flow.newActionUuid)
  assert.equal(merged[0]!.motion.name, name)
  assert.equal(after.bindings[merged[0]!.id]!.motionId, flow.newActionUuid)
  assert.deepEqual(Object.keys(after.bindings).filter((id) => after.bindings[id]!.characterId === characterId), [merged[0]!.id])
  for (const clip of clipsOf(before)) assert.ok(after.motions[before.bindings[clip.id]!.motionId], 'original Actions stay in the project')
  assert.equal(after.motions[flow.newActionUuid]!.derivedFrom, before.bindings[merged[0]!.id]!.motionId)

  // Library: the Action sits under the current character with the chosen name and description (temp copy only).
  const saved = getAction({ actionUuid: flow.newActionUuid })
  assert.equal(saved.ownerCharId, libraryCharacterId)
  assert.equal(resolveCharacter(libraryCharacterId).character.name, 'Gỗ Xưa')
  assert.equal(saved.name, name); assert.equal(saved.nameVi, name); assert.equal(saved.notes, description)
  assert.equal(saved.status, 'edited'); assert.ok((saved.version ?? 0) >= 2)

  // Pose equality (<= 0.5 deg, <= 2 mm) over the whole range, scene placement unchanged, root stored as the first clip's.
  const posesAfter = await worldPoses(after, 0, 134)
  let maxMm = 0, maxDeg = 0
  posesBefore.forEach((frame, i) => frame.forEach((bone, b) => {
    const other = posesAfter[i]![b]!
    maxMm = Math.max(maxMm, bone.position.distanceTo(other.position) * 1000)
    maxDeg = Math.max(maxDeg, 2 * Math.acos(Math.min(1, Math.abs(bone.rotation.dot(other.rotation)))) * 180 / Math.PI)
  }))
  t_diag(`merged vs pre-merge: ${posesBefore.length} frames, max ${maxMm.toExponential(2)} mm, ${maxDeg.toFixed(4)} deg`)
  assert.ok(maxMm <= 2, `position error ${maxMm} mm`)
  assert.ok(maxDeg <= 0.5, `angle error ${maxDeg} deg`)
  assert.deepEqual([0, 60, 134].map((frame) => placement(after, frame)), placements, 'scene placement unchanged')
  const localAfter = await sampleChainFrames(after, characterId, [0, 134])
  for (const bone of localBefore[0]!.bones.filter((x) => ['Root', 'COG', 'Pelvis'].includes(x.name))) {
    const other = localAfter[0]!.bones.find((x) => x.name === bone.name)!
    for (let k = 0; k < 3; k++) assert.ok(Math.abs(bone.position[k]! - other.position[k]!) < 1e-5, `first-frame ${bone.name} root offset unchanged`)
  }

  // One Undo restores A, B and blendIn exactly.
  await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: after.revision, command: 'history.undo', args: {} })
  const undone = await readUnifiedProject(projectId)
  assert.equal(hashProject(undone), hashBefore)
  assert.deepEqual(clipsOf(undone).map((c) => [c.id, c.frameStart, c.frameEnd, c.playback.blendIn ?? null]), clipsOf(before).map((c) => [c.id, c.frameStart, c.frameEnd, c.playback.blendIn ?? null]))
})

test('merged clip defaults and invalid merge arguments', { skip }, async () => {
  const project = await readUnifiedProject(projectId)
  const hash = hashProject(project)
  const bad = await exportAndReturn(project, { name: '   ', description: 'x' })
  await assert.rejects(bad.run(), /Tên clip gộp/)
  assert.equal(hashProject(await readUnifiedProject(projectId)), hash, 'a rejected merge changes nothing')
  const extra = await exportAndReturn(project, { name: 'x', description: 'y', clipId: 'z' })
  await assert.rejects(extra.run(), /merge requires name and description/)
  // No merge argument: the dialog defaults (names + frames of the chain) are used.
  const flow = await exportAndReturn(project, undefined)
  await flow.run()
  const saved = getAction({ actionUuid: flow.newActionUuid })
  assert.equal(saved.name, 'LocSpellPrecastBoth (ID 920 variation 0) + DruReadySpellCast (ID 940 variation 0)')
  assert.equal(saved.notes, 'Gộp từ LocSpellPrecastBoth (ID 920 variation 0) (khung 0–58) + DruReadySpellCast (ID 940 variation 0) (khung 44–134), trộn 15 khung, khóa chân')
})

function t_diag(message: string) { console.log(`# ${message}`) }
