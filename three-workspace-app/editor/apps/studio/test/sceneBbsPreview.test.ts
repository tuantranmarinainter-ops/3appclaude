import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { makeEmptyDraft } from '@topview/3d-builder'
import { FCurveSet } from '@topview/3d-builder/evaluate'
import { bbsActorToThree, bbsCameraToThree } from '../src/bbsPreview.ts'
import { cameraSamplesToFilm } from '../src/filmCamera.ts'
import { executeUnifiedCommand, readUnifiedProject, readUnifiedProjectState, UnifiedStoreError } from '../src/unifiedProjectStore.ts'
import { projectEvaluationScene, sampleProjectCameraSequence, sampleProjectSkeletonRange } from '../src/unifiedSkeletonEvaluation.ts'
import { turnFilmSkeletonsByRotationKeys } from '../src/unifiedFilmSampling.ts'
import { stageAssetUpload } from '../src/unifiedAssetFiles.ts'

const root = mkdtempSync(path.join(tmpdir(), 'bbs-preview-command-'))
process.env.BBS_UNIFIED_PROJECTS_DIR = path.join(root, 'projects')
test.after(() => rmSync(root, { recursive: true, force: true }))

function animatedGlb(animation: boolean): Buffer {
  const binary = Buffer.alloc(animation ? 32 : 0)
  if (animation) {
    binary.writeFloatLE(0, 0); binary.writeFloatLE(2, 4)
    binary.writeFloatLE(0, 8); binary.writeFloatLE(1, 12); binary.writeFloatLE(0, 16)
    binary.writeFloatLE(0, 20); binary.writeFloatLE(2, 24); binary.writeFloatLE(0, 28)
  }
  const document: Record<string, unknown> = {
    asset: { version: '2.0' },
    nodes: [{ name: 'root', children: [1] }, { name: 'spine', translation: [0, 1, 0] }],
    scenes: [{ nodes: [0] }], scene: 0, ...(animation ? {} : { skins: [{ joints: [0, 1], skeleton: 0 }] }),
  }
  if (animation) Object.assign(document, {
    buffers: [{ byteLength: binary.length }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 8 }, { buffer: 0, byteOffset: 8, byteLength: 24 }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 2, type: 'SCALAR', min: [0], max: [2] },
      { bufferView: 1, componentType: 5126, count: 2, type: 'VEC3', min: [0, 1, 0], max: [0, 2, 0] },
    ],
    animations: [{ name: 'Walk', samplers: [{ input: 0, output: 1, interpolation: 'LINEAR' }],
      channels: [{ sampler: 0, target: { node: 1, path: 'translation' } }] }],
  })
  const json = Buffer.from(JSON.stringify(document)), jsonPad = (4 - json.length % 4) % 4, binPad = (4 - binary.length % 4) % 4
  const jsonChunk = Buffer.concat([json, Buffer.alloc(jsonPad, 0x20)]), binChunk = Buffer.concat([binary, Buffer.alloc(binPad)])
  const total = 20 + jsonChunk.length + (animation ? 8 + binChunk.length : 0), out = Buffer.alloc(total)
  out.write('glTF', 0, 'ascii'); out.writeUInt32LE(2, 4); out.writeUInt32LE(total, 8)
  out.writeUInt32LE(jsonChunk.length, 12); out.writeUInt32LE(0x4e4f534a, 16); jsonChunk.copy(out, 20)
  if (animation) {
    const offset = 20 + jsonChunk.length
    out.writeUInt32LE(binChunk.length, offset); out.writeUInt32LE(0x004e4942, offset + 4); binChunk.copy(out, offset + 8)
  }
  return out
}

function treeSnapshot(dir: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name), relative = path.relative(root, full)
    if (statSync(full).isDirectory()) Object.assign(result, treeSnapshot(full))
    else result[relative] = readFileSync(full).toString('base64')
  }
  return result
}

test('scene.preview.bbs samples film camera and actors read-only on the shot 20 Hz grid', async () => {
  const draft = makeEmptyDraft('BBS preview', 30, 90, { fov: 50, position: { x: 1, y: 2, z: 4 }, rotation: { x: 0, y: 0, z: 0 }, lookAt: { x: 0, y: 1, z: 0 } })
  const created = await executeUnifiedCommand({ requestId: randomUUID(), command: 'project.create', args: { name: 'BBS preview', scene: draft } })
  const projectId = String(created.result.projectId)
  const modelUpload = await stageAssetUpload('preview-model.glb', new ReadableStream({ start(controller) { controller.enqueue(animatedGlb(false)); controller.close() } }))
  const model = await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: 0, command: 'asset.import', args: { files: [modelUpload.id], format: 'glb' } })
  const assetId = (model.result.assetIds as string[])[0]!, skeletonId = (model.result.skeletonIds as string[])[0]!
  const character = await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: model.revision, command: 'character.add', args: { assetId, skeletonId, name: 'Preview actor' } })
  const characterId = String(character.result.characterId), nodeId = String(character.result.nodeId)
  const motionUpload = await stageAssetUpload('preview-motion.glb', new ReadableStream({ start(controller) { controller.enqueue(animatedGlb(true)); controller.close() } }))
  const motionImport = await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: character.revision, command: 'asset.import', args: { files: [motionUpload.id], format: 'glb', skeletonProfileId: skeletonId } })
  const motionId = (motionImport.result.motionIds as string[])[0]!
  const placed = await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: motionImport.revision, command: 'motion.place', args: { motionId, characterId, frameStart: 30, sourceLengthSeconds: 2 } })

  const project = await readUnifiedProject(projectId), scene = structuredClone(project.scene)
  const secondCamera = structuredClone(scene.content.nodes.find((node) => node.id === 'camera_1')!)
  secondCamera.id = 'camera_2'; secondCamera.name = 'Second camera'; secondCamera.camera!.isPrimary = false
  secondCamera.transform.position.x += 2
  scene.content.nodes.push(secondCamera)
  scene.content.editorial = { version: 1, activeSequenceId: 'seq', sequences: [{ id: 'seq', clips: [
    { id: 'shot-1', cameraNodeId: 'camera_1', sourceFrameStart: 30, sourceFrameEnd: 59 },
    { id: 'shot-2', cameraNodeId: 'camera_2', sourceFrameStart: 60, sourceFrameEnd: 89 },
  ] }] }
  const backdrop = { id: 'backdrop', type: 'prop' as const, name: 'Backdrop', visible: true, locked: false,
    transform: { position: { x: 2, y: 0.5, z: -1 }, rotation: { x: 0, y: 30, z: 0 }, scale: { x: 1, y: 1, z: 1 } } }
  const tiltedProp = { id: 'tilted-prop', type: 'prop' as const, name: 'Tilted prop', visible: true, locked: false,
    transform: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 5, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } } }
  const scaledProp = { id: 'scaled-prop', type: 'prop' as const, name: 'Scaled prop', visible: true, locked: false,
    transform: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 2, y: 1, z: 1 } } }
  scene.content.nodes.push(backdrop, tiltedProp, scaledProp)
  const curves = FCurveSet.empty()
  curves.upsertKey(nodeId, 'transform.rotation', 1, 30, 0)
  curves.upsertKey(nodeId, 'transform.rotation', 1, 90, 90)
  const saved = await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: placed.revision, command: 'scene.apply', args: {
    operations: [{ type: 'document.replace', document: scene, fcurves: curves.encode() }],
  } })
  const evaluated = await executeUnifiedCommand({ requestId: randomUUID(), projectId, command: 'scene.evaluate', args: { frame: 58.5 } })
  assert.equal((evaluated.result.transforms as Record<string, { rotation: { y: number } }>)[nodeId]!.rotation.y, 0)

  const before = treeSnapshot(path.join(root, 'projects'))
  const response = await executeUnifiedCommand({ requestId: randomUUID(), projectId, command: 'scene.preview.bbs', args: {
    sequenceId: 'seq', frames: [31, 59, 60, 90], viewportAspect: 16 / 9, characterIds: [characterId], propIds: ['backdrop'],
  } })
  const after = treeSnapshot(path.join(root, 'projects'))
  assert.deepEqual(after, before, 'preview did not write a project, history, staged asset, or request-cache file')
  assert.equal(response.revision, saved.revision)
  assert.deepEqual((await readUnifiedProjectState(projectId)).history, { canUndo: true, canRedo: false })
  const resultFrames = response.result.frames as Array<{ frame: number; tick: number; sourceFrame: number; side: string; shot: string; camera: { position: number[]; quaternion: number[] }; actors: Array<{ characterId?: string; propId?: string; worldMatrix: number[]; bones: Array<{ name: string; worldMatrix: number[] }> }> }>
  assert.deepEqual(resultFrames.map((frame) => [frame.frame, frame.tick, frame.sourceFrame, frame.side, frame.shot]), [
    [31, 1, 31.5, 'right', 'shot-1'], [59, 19, 58.5, 'right', 'shot-1'],
    [60, 0, 60, 'right', 'shot-2'], [90, 20, 90, 'left', 'shot-2'],
  ])

  const rawCameras = []
  for await (const sample of sampleProjectCameraSequence(await readUnifiedProject(projectId), 'seq', 20, 16 / 9)) rawCameras.push(sample)
  const cameraFilm = cameraSamplesToFilm(rawCameras)
  for (const item of resultFrames) {
    const source = rawCameras.find((sample) => sample.shotId === item.shot && Math.round(sample.shotTimeSeconds * 20) === item.tick && sample.side === item.side)!
    const key = cameraFilm.cameras.find((camera) => camera.id === source.shotId)!.keyframes[item.tick]!
    const expected = bbsCameraToThree(key, cameraFilm.aspect)
    assert.deepEqual(item.camera.position, expected.position.toArray())
    assert.deepEqual(item.camera.quaternion, expected.quaternion.toArray())
  }

  const skeleton = []
  for await (const sample of sampleProjectSkeletonRange(await readUnifiedProject(projectId), { startFrame: 60, endFrame: 89, sampleFps: 20 }, [characterId])) skeleton.push(sample)
  const actorAtTerminal = skeleton.find((sample) => Math.round(sample.timeSeconds * 20) === 20 && sample.side === 'left')!
  const unturnedActorMatrix = actorAtTerminal.skeletonSamples[0]!.actorWorldMatrix.slice()
  turnFilmSkeletonsByRotationKeys(projectEvaluationScene(await readUnifiedProject(projectId)), actorAtTerminal)
  const actor = resultFrames[3]!.actors.find((item) => item.characterId === characterId)!
  assert.deepEqual(actor.worldMatrix, actorAtTerminal.skeletonSamples[0]!.actorWorldMatrix)
  assert.deepEqual(actor.bones.map((bone) => bone.worldMatrix), actorAtTerminal.skeletonSamples[0]!.bones.map((bone) => bone.worldMatrix))
  assert.ok(Math.abs(actor.worldMatrix[8]! - 1) < 1e-6, 'the final left-limit preview actor includes the 90 degree turn key')
  assert.ok(actor.worldMatrix.some((value, index) => Math.abs(value - unturnedActorMatrix[index]!) > 1e-6))

  const prop = resultFrames[0]!.actors.find((item) => item.propId === 'backdrop')!
  assert.deepEqual(prop.worldMatrix, bbsActorToThree({ x: 2, y: 0.5, z: -1, yaw: 150 }).toArray())
  for (const args of [
    { sequenceId: 'seq', frames: [31, 31], viewportAspect: 16 / 9 },
    { sequenceId: 'seq', frames: [31.5], viewportAspect: 16 / 9 },
    { sequenceId: 'seq', frames: Array.from({ length: 61 }, (_, index) => 30 + index), viewportAspect: 16 / 9 },
    { sequenceId: 'seq', frames: [91], viewportAspect: 16 / 9 },
    { sequenceId: 'missing', frames: [31], viewportAspect: 16 / 9 },
    { sequenceId: 'seq', frames: [31], viewportAspect: Number.NaN },
    { sequenceId: 'seq', frames: [31], viewportAspect: 16 / 9, characterIds: ['missing'] },
    { sequenceId: 'seq', frames: [31], viewportAspect: 16 / 9, propIds: ['tilted-prop'] },
    { sequenceId: 'seq', frames: [31], viewportAspect: 16 / 9, propIds: ['scaled-prop'] },
  ]) await assert.rejects(executeUnifiedCommand({ requestId: randomUUID(), projectId, command: 'scene.preview.bbs', args }),
    (error: unknown) => error instanceof UnifiedStoreError && error.code === 'VALIDATION_FAILED')
  assert.deepEqual(treeSnapshot(path.join(root, 'projects')), before, 'invalid previews also leave storage untouched')
})
