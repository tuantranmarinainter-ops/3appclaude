import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { Matrix4, Quaternion, Vector3 } from 'three'
import { makeEmptyDraft } from '@topview/3d-builder'
import type { UnifiedProject } from '@bbs/animation-workspace-shared'
import {
  buildVfxEffectsForFilm, evaluateAttachedVfxCue, evaluateVfxCuesAtFrame, evaluateVfxNodeWorldMatrix, frameToFilmTick, makeVfxCue, readVfxCueExtension,
  updateVfxCue, validateAttachedBone,
} from '../src/vfxCues.ts'

function projectFixture(fps = 30): UnifiedProject {
  const scene = makeEmptyDraft('VFX cues', fps, 90, { fov: 50, position: { x: 0, y: 2, z: 4 }, rotation: { x: 0, y: 0, z: 0 }, lookAt: { x: 0, y: 1, z: 0 } })
  scene.content.nodes.push({ id: 'fx-node', type: 'primitive', name: 'FX Node', visible: true, locked: false,
    transform: { position: { x: 2, y: 1, z: -3 }, rotation: { x: 0, y: 90, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
    primitive: { kind: 'BoxGeometry', parameters: { width: 1, height: 1, depth: 1 } } })
  return { type: 'three-workspace-project', version: 1, projectId: randomUUID(), name: 'VFX cues', revision: 0,
    scene, assets: {}, characters: {}, skeletons: {}, mappings: {}, motions: {}, bindings: {}, retargetSessions: {}, extensions: {}, origins: [] }
}

const cueInput = { effect: 'aura01', frameStart: 15, frameEnd: 30, position: { x: 1, y: 0, z: 0 }, yaw: 10, scale: 1.5 }

test('cue validators enforce safe effect references, timeline bounds, attach nodes, and actual profile bones', () => {
  const project = projectFixture()
  const cue = makeVfxCue(project, { ...cueInput, attachNodeId: 'fx-node' }, 'cue:1')
  assert.equal(cue.id, 'cue:1')
  assert.throws(() => makeVfxCue(project, { ...cueInput, effect: '../aura' }, 'cue:2'), /Cue values/)
  assert.throws(() => makeVfxCue(project, { ...cueInput, frameEnd: 91 }, 'cue:2'), /Cue values/)
  assert.throws(() => makeVfxCue(project, { ...cueInput, attachNodeId: 'missing' }, 'cue:2'), /Cue values/)

  const characterProject = projectFixture()
  characterProject.scene.content.nodes.push({ id: 'character-node', type: 'character', name: 'Actor', visible: true, locked: false,
    transform: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
    character: { placeholder: false, gender: 'neutral', motionId: null, appearance: { color: '#fff' }, label: { showLabel: false, scale: 1, yOffset: 0 },
      animation: { mode: 'direct', controlValues: {} } }, metadata: { rig: 'direct' } })
  characterProject.characters.actor = { id: 'actor', assetId: 'asset', nodeId: 'character-node', skeletonId: 'skeleton', name: 'Actor' }
  characterProject.skeletons.skeleton = { id: 'skeleton', family: 'custom-preserved', bones: [
    { id: 'root', name: 'mixamorig:Hips', parentId: null, rest: {}, deform: true },
    { id: 'hand', name: 'LeftHand', parentId: 'root', rest: {}, deform: true },
  ], rootBoneId: 'root', metersPerUnit: 1, basisToScene: [1, 0, 0, 0, 1, 0, 0, 0, 1], fingerprint: 'fp', nativeFingerprint: null,
    provenance: { sourceKey: 'test', sourceVersion: '1', sourceHash: 'hash', original: { path: 'model.glb', sha256: '0'.repeat(64), mediaType: 'model/gltf-binary', byteLength: 0 } } }
  assert.doesNotThrow(() => validateAttachedBone(characterProject, 'character-node', 'LeftHand'))
  assert.throws(() => validateAttachedBone(characterProject, 'character-node', 'LeftFoot'), /real bone/)
  assert.throws(() => validateAttachedBone(project, 'fx-node', 'LeftHand'), /Character/)
})

test('attached cue position and yaw follow evaluated root matrices at different frames', () => {
  const project = projectFixture()
  const cue = makeVfxCue(project, { ...cueInput, attachNodeId: 'fx-node' }, 'cue:follow')
  const first = new Matrix4().compose(new Vector3(2, 1, -3), new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2), new Vector3(1, 1, 1))
  const second = new Matrix4().compose(new Vector3(4, 2, -1), new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI), new Vector3(1, 1, 1))
  assert.deepEqual(evaluateAttachedVfxCue(cue, first.toArray()), { position: { x: 2, y: 1, z: -4 }, yaw: 100, scale: 1.5 })
  const followed = evaluateAttachedVfxCue(cue, second.toArray())
  assert.ok(Math.abs(followed.position.x - 3) < 1e-10)
  assert.ok(Math.abs(followed.position.z + 1) < 1e-10)
  assert.equal(followed.yaw, -170)
})

test('film tick mapping uses exact 20 Hz arithmetic, clips overlap, and drops cues outside the segment', async () => {
  const project = projectFixture()
  project.extensions.vfxCues = { version: 1, cues: [
    { id: 'inside', ...cueInput, frameStart: 15, frameEnd: 30, position: { x: 4, y: 2, z: 1 }, yaw: 20, scale: 2 },
    { id: 'outside', effect: 'toonhit', frameStart: 0, frameEnd: 9, position: { x: 0, y: 0, z: 0 }, yaw: 0, scale: 1 },
    { id: 'partial', effect: 'light', frameStart: 0, frameEnd: 16, position: { x: 1, y: 2, z: 3 }, yaw: 5, scale: 0.5 },
  ] }
  assert.equal(frameToFilmTick(15, 0, 30), 10)
  assert.equal(frameToFilmTick(1, 0, 30), 2 / 3, 'non-grid frame boundaries retain exact fractional ticks')
  assert.deepEqual(await buildVfxEffectsForFilm(project, { range: { startFrame: 10, endFrame: 39 } }), [
    { effect: 'aura01', x: 4, y: 2, z: 1, yaw: 20, scale: 2, startTick: 10 / 3, endTick: 40 / 3 },
    { effect: 'light', x: 1, y: 2, z: 3, yaw: 5, scale: 0.5, startTick: 0, endTick: 4 },
  ])
})

test('moving node attachment follows in project evaluation but rejects the static BBS sidecar export', async () => {
  const project = projectFixture()
  project.extensions.topview = { fcurves: { version: 1, encoding: 'compact-v1', fcurves: [
    { id: 'move', t: ['node', 'fx-node'], p: 'transform.position', i: 0, k: [[0, 2, 'linear', 'start'], [29, 5, 'linear', 'end']] },
  ] } }
  project.extensions.vfxCues = { version: 1, cues: [{ id: 'moving', ...cueInput, frameStart: 0, frameEnd: 29, attachNodeId: 'fx-node' }] }
  const node = project.scene.content.nodes.find((item) => item.id === 'fx-node')!
  const cue = readVfxCueExtension(project).cues[0]!
  const start = evaluateVfxNodeWorldMatrix(project, 'fx-node', 0)
  const end = evaluateVfxNodeWorldMatrix(project, 'fx-node', 29)
  assert.notDeepEqual(evaluateAttachedVfxCue(cue, start).position, evaluateAttachedVfxCue(cue, end).position)
  assert.equal(new Matrix4().fromArray(start).elements[12], 2)
  assert.equal(new Matrix4().fromArray(end).elements[12], 5)
  assert.equal(node.id, 'fx-node')
  const startPose = await evaluateVfxCuesAtFrame(project, 0)
  const endPose = await evaluateVfxCuesAtFrame(project, 29)
  assert.deepEqual(startPose[0]?.position, { x: 2, y: 1, z: -4 })
  assert.ok(Math.abs(endPose[0]!.position.x - 5) < 1e-8)
  assert.ok(Math.abs(endPose[0]!.position.z + 4) < 1e-8)
  await assert.rejects(buildVfxEffectsForFilm(project, { range: { startFrame: 0, endFrame: 29 } }), /follows a moving attachment.*one transform per cue interval/)
})

test('single-frame attachment samples its exact source frame between native ticks', async () => {
  const project = projectFixture()
  project.extensions.topview = { fcurves: { version: 1, encoding: 'compact-v1', fcurves: [
    { id: 'move', t: ['node', 'fx-node'], p: 'transform.position', i: 0, k: [[0, 2, 'linear', 'start'], [29, 31, 'linear', 'end']] },
  ] } }
  project.extensions.vfxCues = { version: 1, cues: [{ id: 'instant', ...cueInput, frameStart: 1, frameEnd: 1,
    position: { x: 0, y: 0, z: 0 }, attachNodeId: 'fx-node' }] }
  const pose = (await evaluateVfxCuesAtFrame(project, 1))[0]!
  const [effect] = await buildVfxEffectsForFilm(project, { range: { startFrame: 0, endFrame: 29 } })
  assert.equal(effect?.startTick, 2 / 3)
  assert.equal(effect?.endTick, 2 / 3)
  assert.ok(Math.abs(effect!.x - pose.position.x) < 1e-8)
  assert.equal(effect?.x, 3)
})

test('static attachment spanning a 30 fps Film stays fixed across fractional native sample frames', async () => {
  const project = projectFixture()
  project.extensions.vfxCues = { version: 1, cues: [{ id: 'static-attached', ...cueInput,
    frameStart: 0, frameEnd: 29, attachNodeId: 'fx-node' }] }
  const effects = await buildVfxEffectsForFilm(project, { range: { startFrame: 0, endFrame: 29 } })
  assert.equal(effects.length, 1)
  assert.equal(effects[0]?.startTick, 0)
  assert.equal(effects[0]?.endTick, 58 / 3)
  assert.deepEqual(effects[0] && [effects[0].x, effects[0].y, effects[0].z], [2, 1, -4])
})

test('attachment export respects cancellation before evaluation', async () => {
  const project = projectFixture()
  project.extensions.vfxCues = { version: 1, cues: [{ id: 'cancelled', ...cueInput, frameStart: 0, frameEnd: 29,
    attachNodeId: 'fx-node' }] }
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(buildVfxEffectsForFilm(project, { range: { startFrame: 0, endFrame: 29 } }, controller.signal),
    { name: 'AbortError' })
})

test('attachment export rejects work above the host sample limit before sampling', async () => {
  const project = projectFixture()
  project.scene.content.timeline.frameEnd = 299
  const template = project.scene.content.nodes.find((node) => node.id === 'fx-node')!
  for (let i = 0; i < 200; i++) project.scene.content.nodes.push({ ...structuredClone(template), id: `fx-${i}` })
  project.extensions.vfxCues = { version: 1, cues: Array.from({ length: 200 }, (_, i) => ({
    id: `cue-${i}`, effect: 'aura01', frameStart: 0, frameEnd: 299,
    position: { x: 0, y: 0, z: 0 }, yaw: 0, scale: 1, attachNodeId: `fx-${i}`,
  })) }
  await assert.rejects(buildVfxEffectsForFilm(project, { range: { startFrame: 0, endFrame: 299 } }), /sample host limit/)
})

test('an empty VFX extension exports an empty schedule for an inclusive 0..29 Film', async () => {
  const project = projectFixture()
  assert.deepEqual(await buildVfxEffectsForFilm(project, { range: { startFrame: 0, endFrame: 29 } }), [])
})

test('cue updates keep the cue ID and reject invalid patches', () => {
  const project = projectFixture()
  const cue = makeVfxCue(project, cueInput, 'stable-id')
  assert.deepEqual(updateVfxCue(project, cue, { scale: 2 }), { ...cue, scale: 2 })
  const attached = { ...cue, attachNodeId: 'fx-node', attachBone: 'ignored-on-prop' }
  assert.deepEqual(updateVfxCue(project, attached, { attachNodeId: null, attachBone: null }), cue,
    'explicit null clears the optional attachment fields instead of retaining them through patch merging')
  assert.throws(() => updateVfxCue(project, cue, { id: 'replace-id' }), /editable fields/)
  assert.throws(() => updateVfxCue(project, cue, { scale: 0 }), /Cue values/)
})
