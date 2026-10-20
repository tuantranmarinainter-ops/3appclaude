import assert from 'node:assert/strict'
import { test } from 'vitest'
import * as THREE from 'three'
import { makeEmptyDraft } from '../../contract/emptyDraft'
import type { CameraMotionClip } from '../../contract/types'
import type { FrameSnapshot } from '../../evaluate/FrameSnapshot'
import { sampleCameraSequence } from '../sampleCameraSequence'
import { evaluateCameraPose, evaluateCameraPoseInto, type CamPose } from '../../evaluate/camera/CameraRig'

function fixture() {
  const doc = makeEmptyDraft('Camera sequence', 30, 90, { fov: 50, position: { x: 0, y: 1, z: 5 }, rotation: { x: 0, y: 0, z: 0 }, lookAt: { x: 0, y: 1, z: 0 } })
  doc.content.aspectRatio = '16:9'
  doc.content.editorial = { version: 1, activeSequenceId: 'main', sequences: [{ id: 'main', clips: [
    { id: 'first', cameraNodeId: 'camera_1', sourceFrameStart: 0, sourceFrameEnd: 29 },
    { id: 'second', cameraNodeId: 'camera_1', sourceFrameStart: 30, sourceFrameEnd: 59 },
  ] }] }
  function motion(id: string, start: number, end: number, x0: number, x1: number): CameraMotionClip {
    return { id, target: { type: 'camera', nodeId: 'camera_1' }, frameStart: start, frameEnd: end, trimStartMs: 0, trimEndMs: 1000,
      playback: { version: 1, speed: 1, loop: false, loopMode: 'none', baseDurationFrames: end - start },
      motion: { id, version: 1, presetId: 'custom', label: id, timeUnit: 'ms', durationMs: 1000, curves: [{ id: id + '-x', group: 'position', dataPath: 'position', arrayIndex: 0, extrapolation: 'constant',
        keyframes: [{ id: id + '-a', time: 0, value: x0, interpolation: 'linear' }, { id: id + '-b', time: 1000, value: x1, interpolation: 'linear' }] }] } }
  }
  doc.content.timeline.animation.cameraMotionClips = [motion('a', 0, 29, 0, 10), motion('b', 30, 59, 20, 30)]
  return doc
}

test('camera sequence keeps previous-left and next-right poses at a cut with explicit source aspect', () => {
  const doc = fixture()
  const samples = [...sampleCameraSequence(doc, 'main', 20, 4 / 3)]
  assert.equal(samples.length, 42)
  assert.equal(samples[20]!.side, 'left'); assert.equal(samples[21]!.side, 'right')
  assert.equal(samples[20]!.sequenceTimeSeconds, 1); assert.equal(samples[21]!.sequenceTimeSeconds, 1)
  assert.equal(samples[20]!.sourceFrame, 30); assert.equal(samples[21]!.sourceFrame, 30)
  assert.equal(samples[20]!.position[0], 10); assert.equal(samples[21]!.position[0], 20)
  assert.equal(samples.at(-1)!.position[0], 30)
  assert.ok(samples.every((sample) => sample.aspect === 16 / 9 && sample.verticalFov === 50))
  assert.ok(samples.every((sample) => Math.abs(new THREE.Quaternion().fromArray(sample.quaternion).length() - 1) < 1e-9))
  assert.equal(doc.content.timeline.animation.cameraMotionClips[0]!.frameEnd, 29)
})

test('camera loop endpoint uses source end while export right uses source start and preview remains unchanged', () => {
  const doc = fixture(), clip = doc.content.timeline.animation.cameraMotionClips[0]!
  clip.playback.loop = true
  const samples = [...sampleCameraSequence(doc, 'main', 20, 16 / 9)]
  assert.equal(samples[20]!.position[0], 10)
  assert.equal(evaluateCameraPose(doc.content.nodes[0]!, [clip], 29, 30).position[0], 0)
  const pose: CamPose = { position: [0, 0, 0], lookAt: [0, 0, 0], fov: 50, clipId: null }
  evaluateCameraPoseInto(doc.content.nodes[0]!, doc.content.timeline.animation.cameraMotionClips, 30, 30, false, pose, 'right')
  assert.equal(pose.position[0], 20)
  evaluateCameraPoseInto(doc.content.nodes[0]!, doc.content.timeline.animation.cameraMotionClips, 30, 30, false, pose, 'left')
  assert.equal(pose.position[0], 10)
})

test('static camera export retains manual roll, own aspect and saved rotation keys', () => {
  const doc = fixture(), node = doc.content.nodes[0]!
  doc.content.timeline.animation.cameraMotionClips = []
  node.transform.rotation.z = 30
  node.camera!.aspectRatio = '9:16'
  const samples = [...sampleCameraSequence(doc, 'main', 20, 16 / 9)]
  const expected = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, Math.PI / 6))
  assert.ok(expected.angleTo(new THREE.Quaternion().fromArray(samples[0]!.quaternion)) < 1e-7)
  assert.equal(samples[0]!.aspect, 9 / 16)
  const keyed = [...sampleCameraSequence(doc, 'main', 20, 16 / 9, { userKeysEnabled: true, userKeys: { camera_1: {
    rotation: [{ id: 'roll-key', frame: 0, value: [0, 0, 45], interpolation: 'linear' }],
  } } })]
  assert.ok(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, Math.PI / 4)).angleTo(new THREE.Quaternion().fromArray(keyed[0]!.quaternion)) < 1e-7)
})

test('camera sequence validates all shots before yielding and requires effective-world trajectory transforms', () => {
  const doc = fixture()
  assert.throws(() => [...sampleCameraSequence(doc, 'missing', 20, 16 / 9)], RangeError)
  assert.throws(() => [...sampleCameraSequence(doc, 'main', 0, 16 / 9)], RangeError)
  assert.throws(() => [...sampleCameraSequence(doc, 'main', 20, Infinity)], RangeError)
  doc.content.nodes[0]!.camera!.projection = 'orthographic'
  assert.throws(() => sampleCameraSequence(doc, 'main', 20, 16 / 9).next(), /perspective/)
  doc.content.nodes[0]!.camera!.projection = 'perspective'
  doc.content.nodes[0]!.camera!.lookAtTarget = { nodeId: 'actor', offset: { x: 0, y: 1, z: 0 } }
  doc.content.nodes[0]!.camera!.subject = { nodeId: 'actor', distance: 5, offset: { x: 0, y: 2, z: 5 }, lookAtOffset: { x: 0, y: 1, z: 0 }, follow: true, followRotation: true }
  doc.content.timeline.animation.motionClips.push({ target: { nodeId: 'actor' }, motion: { rootMotion: { policy: 'trajectory' } } } as never)
  assert.throws(() => sampleCameraSequence(doc, 'main', 20, 16 / 9).next(), /effective-world/)
  const samples = [...sampleCameraSequence(doc, 'main', 20, 16 / 9, { resolveEffectiveWorldSubjects(snapshot: FrameSnapshot) {
    snapshot.transforms.set('actor', { position: { x: (snapshot.frame ?? 0) / 10, y: 2, z: 3 }, rotation: { x: 0, y: 90, z: 0 }, scale: { x: 1, y: 1, z: 1 } })
  } })]
  assert.equal(samples[0]!.position[0], 5)
  assert.equal(samples[0]!.position[1], 4)
  assert.ok(Math.abs(samples[0]!.position[2] - 3) < 1e-9)
  assert.equal(samples[21]!.position[0], 8)
  assert.equal(samples[21]!.lookAt[0], 3)
})

test('camera export preserves its independent path endpoint and procedural orbit endpoint', () => {
  const doc = fixture(), node = doc.content.nodes[0]!
  doc.content.editorial!.sequences[0]!.clips.pop()
  doc.content.timeline.animation.cameraMotionClips = []
  doc.content.nodes.push({ id: 'path', type: 'path', name: 'Camera path', visible: true, locked: false,
    transform: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
    path: { source: 'transform-keyframes', curve: 'polyline', parameterization: 'time-ratio', smoothing: 0, closed: false, groundSnap: false,
      points: [{ id: 'p0', timeRatio: 0, position: { x: 0, y: 1, z: 5 } }, { id: 'p1', timeRatio: 1, position: { x: 5, y: 1, z: 5 } }] } })
  doc.content.timeline.animation.pathMotionClips.push({ id: 'camera-path', target: { type: 'camera', nodeId: node.id }, source: 'user', status: 'active', locked: true, lockedReason: 'derived-from-keyframes',
    pathNodeId: 'path', pathName: 'Path', pathLength: 5, pathStartPercent: 0, pathEndPercent: 100, direction: 'forward', facing: 'none', frameStart: 0, frameEnd: 30,
    playback: { version: 1, speed: 1, loop: false, loopMode: 'none', baseDurationFrames: 30 } })
  assert.equal([...sampleCameraSequence(doc, 'main', 20, 16 / 9)].at(-1)!.position[0], 5)
  doc.content.timeline.animation.pathMotionClips = []
  const orbit = fixture().content.timeline.animation.cameraMotionClips[0]!
  orbit.motion.source = { type: 'orbit', startPosition: { x: 0, y: 1, z: 5 }, pivot: { x: 0, y: 1, z: 0 }, yawDeg: 90 }
  doc.content.timeline.animation.cameraMotionClips = [orbit]
  const last = [...sampleCameraSequence(doc, 'main', 20, 16 / 9)].at(-1)!
  assert.ok(Math.abs(last.position[0]! - 5) < 1e-6)
  assert.ok(Math.abs(last.position[2]!) < 1e-6)
})
