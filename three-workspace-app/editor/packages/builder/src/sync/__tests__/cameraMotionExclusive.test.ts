import { test } from 'vitest'
import assert from 'node:assert/strict'
import { makeEmptyDraft } from '../../contract/emptyDraft'
import type { DirectorDocument, DraftNode } from '../../contract/types'
import { makeKeyframe } from '../../evaluate/curves/KeyframeTrack'
import { EditorStore } from '../../stores/EditorStore'
import { StudioSession } from '../../sync/StudioSession'
import { DirectorDoc } from '../../document/DirectorDoc'
import { History } from '../../document/History'
import type { DirectorEngine } from '../../engine/DirectorEngine'
import type { HostAdapter } from '../../host/types'
import { evaluateCameraPose } from '../../evaluate/camera/CameraRig'
import {
  cameraMotionActiveAtFrame,
  cameraMotionOwnsKeyframes,
  cameraPositionDragMoved,
} from '../../evaluate/camera/cameraMotionExclusive'
import { translateCameraMotionClips } from '../../evaluate/camera/rebaseCameraMotion'
import { manualCameraLookAt, sameCameraAim } from '../../evaluate/camera/cameraAim'

function camNode(): DraftNode {
  return {
    id: 'cam',
    type: 'camera',
    name: '机位',
    visible: true,
    locked: false,
    transform: {
      position: { x: 0, y: 1.6, z: 4 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    },
    camera: {
      projection: 'perspective',
      fov: 50,
      fovAxis: 'vertical',
      near: 0.1,
      far: 2000,
      isPrimary: true,
      lookAt: { x: 0, y: 1.2, z: 0 },
    },
  }
}

function motionClip(cameraId: string): DirectorDocument['content']['timeline']['animation']['cameraMotionClips'][number] {
  return {
    id: 'm1',
    target: { type: 'camera', nodeId: cameraId },
    frameStart: 0,
    frameEnd: 30,
    trimStartMs: 0,
    trimEndMs: 1000,
    playback: { version: 1, speed: 1, loop: false, loopMode: 'none', baseDurationFrames: 30 },
    motion: {
      id: 'static_shot',
      version: 1,
      presetId: 'static_shot',
      label: 'static',
      timeUnit: 'ms',
      durationMs: 1000,
      curves: [],
    },
  }
}

function fixture(
  withMotion = false,
  pilotEnd?: { position: { x: number; y: number; z: number }; forward: { x: number; y: number; z: number } },
) {
  const model = new DirectorDoc()
  const doc = makeEmptyDraft('motion-excl-test', 30, 120)
  doc.content.nodes.push(camNode())
  if (withMotion) {
    doc.content.timeline.animation.cameraMotionClips.push(motionClip('cam'))
  }
  model.replace(doc)
  const editor = new EditorStore('motion-excl-test')
  editor.autoKeyframe = false
  editor.setActiveCamera('cam')
  const history = new History()
  const engine = {
    currentFrame: 0,
    setFcurves() {},
    syncPathNodes() {},
    syncCameraMotionGuide() {},
    applyLiveCameraPose() {},
    setStagedTransform() {},
    clearStagedTransforms() {},
    hasStagedTransform() { return false },
    applyLiveCameraFov() {},
    getNodeSnapshot() {
      return null
    },
    beginCameraPilot() { return true },
    endCameraPilot() {
      return pilotEnd ?? {
        position: { x: 1, y: 1.6, z: 6 },
        forward: { x: 0, y: 0, z: -1 },
      }
    },
    setPoseEditingId() {},
    setPathEditing() {},
    syncGizmo() {},
    syncPathSelection() {},
  } as unknown as DirectorEngine
  const session = new StudioSession(
    engine,
    model,
    editor,
    history,
    {} as HostAdapter<DirectorDocument>,
  )
  return { model, doc, session, engine: engine as unknown as { currentFrame: number } }
}

test('cameraMotionOwnsKeyframes：无运镜为 false，有运镜为 true', () => {
  const bare = makeEmptyDraft('x', 30, 60)
  bare.content.nodes.push(camNode())
  assert.equal(cameraMotionOwnsKeyframes(bare, 'cam'), false)
  bare.content.timeline.animation.cameraMotionClips.push(motionClip('cam'))
  assert.equal(cameraMotionOwnsKeyframes(bare, 'cam'), true)
})

test('cameraMotionActiveAtFrame：只在片段覆盖的帧上为 true', () => {
  const bare = makeEmptyDraft('x', 30, 60)
  bare.content.nodes.push(camNode())
  assert.equal(cameraMotionActiveAtFrame(bare, 'cam', 0), false)
  bare.content.timeline.animation.cameraMotionClips.push(motionClip('cam'))
  assert.equal(cameraMotionActiveAtFrame(bare, 'cam', 0), true)
  assert.equal(cameraMotionActiveAtFrame(bare, 'cam', 30), true)
  assert.equal(cameraMotionActiveAtFrame(bare, 'cam', 31), false)
  assert.equal(cameraMotionActiveAtFrame(bare, 'other', 10), false)
})

test('cameraPositionDragMoved：微小抖动不算位移', () => {
  assert.equal(cameraPositionDragMoved([0, 1.6, 4], [0, 1.6, 4]), false)
  assert.equal(cameraPositionDragMoved([0, 1.6, 4], [0, 1.6, 4.00001]), false)
  assert.equal(cameraPositionDragMoved([0, 1.6, 4], [0.2, 1.6, 4]), true)
  assert.equal(cameraPositionDragMoved(null, [0.2, 1.6, 4]), false)
})

test('notifyCameraMotionDragBlocked 递增提示版本', () => {
  const { session } = fixture(true)
  assert.equal(session.cameraMotionDragNoticeVersion, 0)
  session.notifyCameraMotionDragBlocked()
  assert.equal(session.cameraMotionDragNoticeVersion, 1)
})

test('有运镜时退出操控相机不再提示删除预设，机位跟着平移', () => {
  const blocked = fixture(true)
  blocked.session.setCameraPilot('cam')
  assert.equal(blocked.session.cameraMotionDragNoticeVersion, 0)
  blocked.session.setCameraPilot(null)
  assert.equal(blocked.session.cameraMotionDragNoticeVersion, 0)
  const cam = blocked.model.snapshot!.content.nodes.find((node) => node.id === 'cam')
  assert.equal(cam?.transform.position.x, 1)
  assert.equal(cam?.transform.position.y, 1.6)
  assert.equal(cam?.transform.position.z, 6)

  const open = fixture(false)
  open.session.setCameraPilot('cam')
  open.session.setCameraPilot(null)
  assert.equal(open.session.cameraMotionDragNoticeVersion, 0)
})

test('有运镜时退出操控相机保留最后朝向，不再按路径切线盖回去', () => {
  const { session, model } = fixture(false, {
    position: { x: 0, y: 1.6, z: 4 },
    forward: { x: -1, y: 0, z: 0 },
  })
  const cam = model.snapshot!.content.nodes.find((node) => node.id === 'cam')!
  cam.transform.position = { x: 0, y: 1.6, z: 4 }
  cam.transform.rotation = { x: 0, y: 0, z: 0 }
  cam.camera!.lookAt = { x: 0, y: 1.6, z: 0 }
  model.snapshot!.content.timeline.animation.cameraMotionClips.push({
    ...motionClip('cam'),
    motion: {
      ...motionClip('cam').motion,
      presetId: 'dolly_in',
      curves: [
        axisCurve('px', 'position', 0, 0, 0),
        axisCurve('py', 'position', 1, 1.6, 1.6),
        axisCurve('pz', 'position', 2, 4, 1),
        axisCurve('lx', 'lookAt', 0, 0, 0),
        axisCurve('ly', 'lookAt', 1, 1.6, 1.6),
        axisCurve('lz', 'lookAt', 2, 0, -3),
      ],
    },
  })
  model.snapshot!.content.timeline.animation.pathMotionClips.push({
    id: 'path-cam',
    status: 'active',
    locked: false,
    source: 'semantic',
    target: { type: 'node', nodeId: 'cam' },
    pathNodeId: 'path1',
    pathName: '走位',
    pathLength: 3,
    pathStartPercent: 0,
    pathEndPercent: 100,
    direction: 'forward',
    facing: 'path-tangent',
    frameStart: 0,
    frameEnd: 30,
    playback: { version: 1, speed: 1, loop: false, loopMode: 'none', baseDurationFrames: 30 },
  })
  session.setCameraPilot('cam')
  session.setCameraPilot(null)
  const node = model.snapshot!.content.nodes.find((item) => item.id === 'cam')!
  const pose = evaluateCameraPose(node, model.snapshot!.content.timeline.animation.cameraMotionClips, 0, 30)
  const end = evaluateCameraPose(node, model.snapshot!.content.timeline.animation.cameraMotionClips, 30, 30)
  assert.ok(Math.abs(pose.position[0]) < 1e-4)
  assert.ok(Math.abs(pose.position[1] - 1.6) < 1e-4)
  assert.ok(Math.abs(pose.position[2] - 4) < 1e-4)
  assert.equal(sameCameraAim(
    { x: pose.position[0], y: pose.position[1], z: pose.position[2] },
    { x: -4, y: 1.6, z: 4 },
    { x: pose.lookAt[0], y: pose.lookAt[1], z: pose.lookAt[2] },
  ), true)
  assert.ok(Math.abs(end.position[0] - -3) < 1e-4)
  assert.ok(Math.abs(end.position[1] - 1.6) < 1e-4)
  assert.ok(Math.abs(end.position[2] - 4) < 1e-4)
  assert.equal(model.snapshot!.content.timeline.animation.cameraMotionClips[0].motion.presetId, 'dolly_in')
  assert.equal(model.snapshot!.content.timeline.animation.pathMotionClips[0].facing, 'none')
  session.undo()
  const restored = evaluateCameraPose(
    model.snapshot!.content.nodes.find((item) => item.id === 'cam')!,
    model.snapshot!.content.timeline.animation.cameraMotionClips,
    30,
    30,
  )
  assert.ok(Math.abs(restored.position[2] - 1) < 1e-4)
  assert.equal(model.snapshot!.content.timeline.animation.pathMotionClips[0].facing, 'path-tangent')
})

test('有运镜时 addKeyframes 被拦截', () => {
  const { session, model } = fixture(true)
  session.addKeyframes('cam', [{ prop: 'position', value: [1, 1.6, 4] }])
  assert.equal(model.userKeys.cam, undefined)
})

test('无运镜时 addKeyframes 正常', () => {
  const { session, model } = fixture(false)
  session.addKeyframes('cam', [{ prop: 'position', value: [1, 1.6, 4] }])
  assert.equal(model.userKeys.cam?.position?.length, 1)
})

test('有运镜时 moveKeyframes / removeKeyframes 被拦截', () => {
  const { session, model, doc } = fixture(true)
  model.setUserKeys({
    cam: { position: [makeKeyframe(0, [0, 1.6, 4])] },
  })
  const keyId = model.userKeys.cam!.position![0].id
  session.moveKeyframes([{ nodeId: 'cam', prop: 'position', keyId, newFrame: 10 }])
  assert.equal(model.userKeys.cam!.position![0].frame, 0)
  session.removeKeyframes([{ nodeId: 'cam', prop: 'position', keyId }])
  assert.equal(model.userKeys.cam?.position?.length, 1)
  // 机位仍可平移（静态）
  session.writeCameraWorldPos('cam', { x: 2, y: 1.6, z: 4 }, true)
  assert.equal(doc.content.nodes.find((n) => n.id === 'cam')!.transform.position.x, 2)
  // 残留 userKeys 不被改写
  assert.deepEqual(model.userKeys.cam!.position![0].value, [0, 1.6, 4])
})

test('applyCameraMotion 保留已有关键帧（挂起而非删除）', () => {
  const { session, model } = fixture(false)
  model.setUserKeys({
    cam: { position: [makeKeyframe(0, [0, 1.6, 4]), makeKeyframe(20, [2, 1.6, 2])] },
  })
  const before = model.userKeys.cam!.position!.map((k) => ({ id: k.id, frame: k.frame, value: [...k.value] }))
  // static_shot 在 CAMERA_MOTIONS 里；失败则跳过 bake 断言但至少不该清键
  const err = session.applyCameraMotion('static_shot')
  assert.equal(model.userKeys.cam?.position?.length, 2)
  assert.deepEqual(
    model.userKeys.cam!.position!.map((k) => ({ id: k.id, frame: k.frame, value: [...k.value] })),
    before,
  )
  if (err === null) {
    assert.equal(model.snapshot!.content.timeline.animation.cameraMotionClips.length >= 1, true)
  }
})

test('空场景点击运镜会按当前视口自动建机并挂上预设，不再返回 missing-camera', () => {
  const model = new DirectorDoc()
  const doc = makeEmptyDraft('auto-cam-motion', 30, 120)
  model.replace(doc)
  const editor = new EditorStore('auto-cam-motion')
  editor.autoKeyframe = false
  const history = new History()
  const engine = {
    currentFrame: 0,
    captureEditorView() {
      return {
        position: { x: 3, y: 2, z: 5 },
        rotation: { x: -10, y: 25, z: 0 },
        lookAt: { x: 0, y: 1.2, z: 0 },
        fov: 48,
      }
    },
    setFcurves() {},
    syncPathNodes() {},
    syncCameraMotionGuide() {},
    applyLiveCameraPose() {},
    setStagedTransform() {},
    clearStagedTransforms() {},
    hasStagedTransform() { return false },
    applyLiveCameraFov() {},
    getNodeSnapshot() {
      return null
    },
  } as unknown as DirectorEngine
  const session = new StudioSession(
    engine,
    model,
    editor,
    history,
    {} as HostAdapter<DirectorDocument>,
  )
  const err = session.applyCameraMotion('dolly_in')
  assert.equal(err, null, String(err))
  const live = model.snapshot!
  const cams = live.content.nodes.filter((n) => n.type === 'camera')
  assert.equal(cams.length, 1)
  assert.deepEqual(cams[0].transform.position, { x: 3, y: 2, z: 5 })
  assert.equal(cams[0].camera?.fov, 48)
  const clips = live.content.timeline.animation.cameraMotionClips
  assert.ok(clips.length >= 1)
  assert.equal(clips[0].target.nodeId, cams[0].id)
  assert.equal(editor.activeCameraId, cams[0].id)
})

test('连点两次运镜：第二段接在第一段之后并贴紧，不叠在同一帧', () => {
  const { session, model } = fixture(false)
  model.snapshot!.content.timeline.frameEnd = 10
  assert.equal(session.applyCameraMotion('dolly_in'), null)
  assert.equal(session.applyCameraMotion('dolly_in'), null)
  const clips = model.snapshot!.content.timeline.animation.cameraMotionClips
  assert.equal(clips.length, 2)
  const [first, second] = [...clips].sort((a, b) => a.frameStart - b.frameStart)
  assert.equal(first.frameStart, 0)
  assert.equal(second.frameStart, first.frameEnd)
  assert.ok(second.frameEnd > second.frameStart)
  assert.equal(model.snapshot!.content.timeline.frameEnd, 10)
  assert.equal(session.updateCameraMotionConfig(first.id, { durationMs: 4000 }), null)
  assert.equal(model.snapshot!.content.timeline.frameEnd, 10, 'rebaking and ripple shifts preserve the playback end')
})

test('移动机位把升降运镜整段平移，幅度和预设不变', () => {
  const { session, model, engine } = fixture(false)
  assert.equal(session.applyCameraMotion('crane_up'), null)
  const clips = model.snapshot!.content.timeline.animation.cameraMotionClips
  assert.equal(clips.length, 1)
  const poseAt = (frame: number) => {
    const cam = model.snapshot!.content.nodes.find((n) => n.id === 'cam')!
    const live = model.snapshot!.content.timeline.animation.cameraMotionClips
    return evaluateCameraPose(cam, live, frame, 30)
  }
  const start = poseAt(clips[0].frameStart)
  const end = poseAt(clips[0].frameEnd)
  const rise = end.position[1] - start.position[1]
  const lookRise = end.lookAt[1] - start.lookAt[1]
  assert.ok(Math.abs(rise) > 0.1)
  const mid = Math.round((clips[0].frameStart + clips[0].frameEnd) / 2)
  engine.currentFrame = mid
  const midPose = poseAt(mid)
  session.writeCameraWorldPos('cam', {
    x: midPose.position[0] + 2,
    y: midPose.position[1],
    z: midPose.position[2],
  }, true)
  const start2 = poseAt(clips[0].frameStart)
  const end2 = poseAt(clips[0].frameEnd)
  const mid2 = poseAt(mid)
  assert.ok(Math.abs(mid2.position[0] - (midPose.position[0] + 2)) < 1e-6)
  assert.ok(Math.abs(mid2.position[1] - midPose.position[1]) < 1e-6)
  assert.ok(Math.abs(mid2.position[2] - midPose.position[2]) < 1e-6)
  assert.ok(Math.abs((end2.position[1] - start2.position[1]) - rise) < 1e-6)
  assert.ok(Math.abs((end2.lookAt[1] - start2.lookAt[1]) - lookRise) < 1e-6)
  assert.ok(Math.abs(end2.position[0] - start2.position[0]) < 1e-6)
  assert.equal(model.snapshot!.content.timeline.animation.cameraMotionClips[0].motion.presetId, 'crane_up')
  assert.equal(session.cameraMotionDragNoticeVersion, 0)
  session.undo()
  const restored = poseAt(mid)
  assert.ok(Math.abs(restored.position[0] - midPose.position[0]) < 1e-6)
})

test('环绕运镜的枢轴和曲线一起平移，fov 不动', () => {
  const { doc } = fixture(false)
  doc.content.timeline.animation.cameraMotionClips.push({
    ...motionClip('cam'),
    motion: {
      ...motionClip('cam').motion,
      presetId: 'orbit_180',
      curves: [
        {
          id: 'p',
          group: 'position',
          dataPath: 'camera.position',
          arrayIndex: 0,
          extrapolation: 'constant',
          keyframes: [
            { id: 'a', time: 0, value: 4, interpolation: 'linear' },
            { id: 'b', time: 1000, value: -4, interpolation: 'linear' },
          ],
        },
        {
          id: 'f',
          group: 'lens',
          dataPath: 'camera.lens.fov',
          arrayIndex: 0,
          extrapolation: 'constant',
          keyframes: [
            { id: 'fa', time: 0, value: 50, interpolation: 'linear' },
            { id: 'fb', time: 1000, value: 40, interpolation: 'linear' },
          ],
        },
      ],
      source: {
        type: 'orbit',
        startPosition: { x: 4, y: 2, z: 0 },
        pivot: { x: 0, y: 1.2, z: 0 },
        startLookAt: { x: 0, y: 1.2, z: 0 },
        lookAtTarget: { x: 0, y: 1.2, z: 0 },
        yawDeg: 180,
        fov: 50,
      },
    },
  })
  translateCameraMotionClips(doc, 'cam', { x: 1, y: 0, z: -2 })
  const clip = doc.content.timeline.animation.cameraMotionClips[0]
  const xs = clip.motion.curves.find((c) => c.group === 'position')!
  assert.deepEqual(xs.keyframes.map((k) => k.value), [5, -3])
  const fov = clip.motion.curves.find((c) => c.group === 'lens')!
  assert.deepEqual(fov.keyframes.map((k) => k.value), [50, 40])
  const source = clip.motion.source as {
    startPosition: { x: number; z: number }
    pivot: { x: number; z: number }
    yawDeg: number
  }
  assert.equal(source.startPosition.x, 5)
  assert.equal(source.startPosition.z, -2)
  assert.equal(source.pivot.x, 1)
  assert.equal(source.pivot.z, -2)
  assert.equal(source.yawDeg, 180)
  assert.equal(clip.motion.presetId, 'orbit_180')
})

function axisCurve(
  id: string,
  group: 'position' | 'lookAt' | 'lens',
  arrayIndex: number,
  a: number,
  b: number,
) {
  return {
    id,
    group,
    dataPath: group === 'lens' ? 'camera.lens.fov' : `camera.${group}`,
    arrayIndex,
    extrapolation: 'constant',
    keyframes: [
      { id: `${id}a`, time: 0, value: a, interpolation: 'linear' as const },
      { id: `${id}b`, time: 1000, value: b, interpolation: 'linear' as const },
    ],
  }
}

test('旋转机位把运镜轨迹绕当前朝向转，运动方式不变', () => {
  const { session, model, engine } = fixture(false)
  const cam = model.snapshot!.content.nodes.find((node) => node.id === 'cam')!
  cam.transform.position = { x: 0, y: 1.6, z: 4 }
  cam.transform.rotation = { x: 0, y: 0, z: 0 }
  cam.camera!.lookAt = { x: 0, y: 1.6, z: 0 }
  model.snapshot!.content.timeline.animation.cameraMotionClips.push({
    ...motionClip('cam'),
    motion: {
      ...motionClip('cam').motion,
      presetId: 'dolly_in',
      curves: [
        axisCurve('px', 'position', 0, 0, 0),
        axisCurve('py', 'position', 1, 1.6, 1.6),
        axisCurve('pz', 'position', 2, 4, 1),
        axisCurve('lx', 'lookAt', 0, 0, 0),
        axisCurve('ly', 'lookAt', 1, 1.6, 1.6),
        axisCurve('lz', 'lookAt', 2, 0, -3),
        axisCurve('fov', 'lens', 0, 50, 40),
      ],
    },
  })
  const poseAt = (frame: number) => {
    const node = model.snapshot!.content.nodes.find((item) => item.id === 'cam')!
    return evaluateCameraPose(node, model.snapshot!.content.timeline.animation.cameraMotionClips, frame, 30)
  }
  const start = poseAt(0)
  const end = poseAt(30)
  session.beginInteraction()
  session.writeCameraRotation('cam', { x: 0, y: 45, z: 0 }, false)
  session.writeCameraRotation('cam', { x: 0, y: 90, z: 0 }, true)
  session.endInteraction('旋转相机')
  const start2 = poseAt(0)
  const end2 = poseAt(30)
  assert.ok(Math.abs(start2.position[0] - start.position[0]) < 1e-6)
  assert.ok(Math.abs(start2.position[1] - start.position[1]) < 1e-6)
  assert.ok(Math.abs(start2.position[2] - start.position[2]) < 1e-6)
  assert.ok(Math.abs(end2.position[0] - -3) < 1e-4)
  assert.ok(Math.abs(end2.position[1] - 1.6) < 1e-4)
  assert.ok(Math.abs(end2.position[2] - 4) < 1e-4)
  assert.ok(Math.abs(start2.lookAt[0] - -4) < 1e-4)
  assert.ok(Math.abs(start2.lookAt[1] - 1.6) < 1e-4)
  assert.ok(Math.abs(start2.lookAt[2] - 4) < 1e-4)
  assert.ok(Math.abs(end2.lookAt[0] - -7) < 1e-4)
  const aim = {
    x: start2.position[0],
    y: start2.position[1],
    z: start2.position[2],
  }
  const expected = manualCameraLookAt(aim, { x: 0, y: 90, z: 0 }, 4)
  assert.equal(sameCameraAim(aim, expected, {
    x: start2.lookAt[0],
    y: start2.lookAt[1],
    z: start2.lookAt[2],
  }), true)
  const fov = model.snapshot!.content.timeline.animation.cameraMotionClips[0].motion.curves.find((curve) => curve.group === 'lens')!
  assert.deepEqual(fov.keyframes.map((key) => key.value), [50, 40])
  assert.equal(model.snapshot!.content.timeline.animation.cameraMotionClips[0].motion.presetId, 'dolly_in')
  assert.ok(Math.abs(end.position[2] - 1) < 1e-6)
  session.undo()
  const restored = poseAt(30)
  assert.ok(Math.abs(restored.position[0] - end.position[0]) < 1e-6)
  assert.ok(Math.abs(restored.position[2] - end.position[2]) < 1e-6)

  engine.currentFrame = 15
  session.writeCameraRotation('cam', { x: 0, y: 90, z: 0 }, true)
  const mid = poseAt(15)
  const spunStart = poseAt(0)
  const spunEnd = poseAt(30)
  assert.ok(Math.abs(mid.position[0] - 0) < 1e-4)
  assert.ok(Math.abs(mid.position[1] - 1.6) < 1e-4)
  assert.ok(Math.abs(mid.position[2] - 2.5) < 1e-4)
  assert.ok(Math.abs(spunStart.position[0] - 1.5) < 1e-4)
  assert.ok(Math.abs(spunStart.position[2] - 2.5) < 1e-4)
  assert.ok(Math.abs(spunEnd.position[0] - -1.5) < 1e-4)
  assert.ok(Math.abs(spunEnd.position[2] - 2.5) < 1e-4)
})

test('只滚转相机时运镜轨迹不动', () => {
  const { session, model } = fixture(false)
  const cam = model.snapshot!.content.nodes.find((node) => node.id === 'cam')!
  cam.transform.position = { x: 0, y: 1.6, z: 4 }
  cam.camera!.lookAt = { x: 0, y: 1.6, z: 0 }
  model.snapshot!.content.timeline.animation.cameraMotionClips.push({
    ...motionClip('cam'),
    motion: {
      ...motionClip('cam').motion,
      curves: [
        axisCurve('px', 'position', 0, 0, 0),
        axisCurve('py', 'position', 1, 1.6, 1.6),
        axisCurve('pz', 'position', 2, 4, 1),
        axisCurve('lx', 'lookAt', 0, 0, 0),
        axisCurve('ly', 'lookAt', 1, 1.6, 1.6),
        axisCurve('lz', 'lookAt', 2, 0, -3),
      ],
    },
  })
  session.writeCameraRotation('cam', { x: 0, y: 0, z: 40 }, true)
  const node = model.snapshot!.content.nodes.find((item) => item.id === 'cam')!
  const end = evaluateCameraPose(node, model.snapshot!.content.timeline.animation.cameraMotionClips, 30, 30)
  assert.ok(Math.abs(end.position[0]) < 1e-6)
  assert.ok(Math.abs(end.position[2] - 1) < 1e-6)
  assert.equal(node.transform.rotation.z, 40)
})

test('环绕运镜的枢轴和转轴跟着相机朝向转，张角不变', () => {
  const { session, model } = fixture(false)
  const cam = model.snapshot!.content.nodes.find((node) => node.id === 'cam')!
  cam.transform.position = { x: 0, y: 2, z: 5 }
  cam.transform.rotation = { x: 0, y: 0, z: 0 }
  cam.camera!.lookAt = { x: 0, y: 2, z: 0 }
  model.snapshot!.content.timeline.animation.cameraMotionClips.push({
    ...motionClip('cam'),
    motion: {
      ...motionClip('cam').motion,
      presetId: 'orbit_180',
      source: {
        type: 'orbit',
        startPosition: { x: 0, y: 2, z: 5 },
        pivot: { x: 0, y: 2, z: 0 },
        startLookAt: { x: 0, y: 2, z: 0 },
        lookAtTarget: { x: 0, y: 2, z: 0 },
        axis: { x: 0, y: 1, z: 0 },
        yawDeg: 180,
        fov: 50,
      },
    },
  })
  session.writeCameraRotation('cam', { x: 0, y: 90, z: 0 }, true)
  const source = model.snapshot!.content.timeline.animation.cameraMotionClips[0].motion.source as {
    startPosition: { x: number; y: number; z: number }
    pivot: { x: number; y: number; z: number }
    axis: { x: number; y: number; z: number }
    yawDeg: number
    fov: number
  }
  assert.ok(Math.abs(source.startPosition.x) < 1e-4)
  assert.ok(Math.abs(source.startPosition.y - 2) < 1e-4)
  assert.ok(Math.abs(source.startPosition.z - 5) < 1e-4)
  assert.ok(Math.abs(source.pivot.x - -5) < 1e-4)
  assert.ok(Math.abs(source.pivot.y - 2) < 1e-4)
  assert.ok(Math.abs(source.pivot.z - 5) < 1e-4)
  assert.ok(Math.abs(source.axis.x) < 1e-4)
  assert.ok(Math.abs(source.axis.y - 1) < 1e-4)
  assert.ok(Math.abs(source.axis.z) < 1e-4)
  assert.equal(source.yawDeg, 180)
  assert.equal(source.fov, 50)
  assert.equal(model.snapshot!.content.timeline.animation.cameraMotionClips[0].motion.presetId, 'orbit_180')
})

test('播放头已越过整条轨道时，新运镜从播放头开始', () => {
  const { session, model, doc, engine } = fixture(true)
  doc.content.timeline.animation.cameraMotionClips[0].frameEnd = 30
  engine.currentFrame = 60
  assert.equal(session.applyCameraMotion('dolly_in'), null)
  const clips = model.snapshot!.content.timeline.animation.cameraMotionClips
  const added = clips.find((c) => c.id !== 'm1')!
  assert.equal(added.frameStart, 60)
})

