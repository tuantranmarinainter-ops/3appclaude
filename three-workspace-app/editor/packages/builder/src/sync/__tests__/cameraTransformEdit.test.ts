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
import { FCurveSet } from '../../evaluate/curves/FCurveSet'
import { focalLengthToFov, fovToFocalLength } from '../../evaluate/camera/focalLength'
import { resolveSubjectCameraPose } from '../../evaluate/camera/subjectBinding'

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

function fixture(adapter: HostAdapter<DirectorDocument> = {} as unknown as HostAdapter<DirectorDocument>) {
  const model = new DirectorDoc()
  const doc = makeEmptyDraft('cam-xform-test', 30, 120)
  doc.content.nodes.push(camNode())
  model.replace(doc)
  const editor = new EditorStore('cam-xform-test')
  editor.autoKeyframe = false
  editor.setActiveCamera('cam')
  const history = new History()
  const engineState = { currentFrame: 0 }
  const engine = {
    get currentFrame() { return engineState.currentFrame },
    set currentFrame(frame: number) { engineState.currentFrame = frame },
    setFcurves() {},
    syncPathNodes() {},
    invalidate() {},
    syncCameraMotionGuide() {},
    applyLiveCameraPose() {},
    setStagedTransform() {},
    clearStagedTransforms() {},
    hasStagedTransform() { return false },
    applyLiveCameraFov() {},
    applyLiveNodeTransform() {},
    seek(frame: number) {
      engineState.currentFrame = frame
    },
    getNodeSnapshot() {
      return null
    },
  } as unknown as DirectorEngine
  const session = new StudioSession(
    engine,
    model,
    editor,
    history,
    adapter,
  )
  return { model, doc, session, engine, history, editor }
}

function aimedFixture(follow = false) {
  const f = fixture()
  const cam = f.doc.content.nodes.find((node) => node.id === 'cam')!
  const actor: DraftNode = {
    id: 'actor', name: 'Actor', type: 'primitive', visible: true, locked: false,
    transform: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
  }
  f.doc.content.nodes.push(actor)
  cam.camera!.lookAt = { x: 0, y: 1.6, z: 0 }
  cam.camera!.lookAtTarget = { nodeId: actor.id, offset: { x: 0, y: 1.6, z: 0 } }
  cam.camera!.subject = {
    nodeId: actor.id, follow, followRotation: false,
    offset: { ...cam.transform.position }, lookAtOffset: { ...cam.camera!.lookAt }, distance: 4,
  }
  return { ...f, cam, actor }
}

test('手动转向解除看点：连续拖动、撤销和重做保持绑定与角度一致', () => {
  const { session, cam, model, history } = aimedFixture()
  const original = structuredClone(cam)
  session.beginInteraction()
  session.writeCameraRotation('cam', { x: 0, y: 15, z: 0 }, false)
  session.writeCameraRotation('cam', { x: 0, y: 30, z: 0 }, true)
  assert.equal(session.cameraAimReleaseVersion, 0, '拖动和最终写入期间不提示')
  session.endInteraction('旋转相机')
  assert.equal(session.cameraAimReleaseVersion, 1, '松手结束交互后提示')
  assert.equal(cam.camera!.lookAtTarget, undefined)
  assert.equal(cam.camera!.subject, undefined)
  assert.equal(cam.transform.rotation.y, 30)
  assert.equal(history.undoStack.length, 1)
  const final = structuredClone(cam)
  session.undo()
  assert.deepEqual(model.snapshot!.content.nodes.find((node) => node.id === 'cam'), original)
  session.redo()
  assert.deepEqual(model.snapshot!.content.nodes.find((node) => node.id === 'cam'), final)
})

test('移动操作轴松手不提交派生旋转，不解除看向也不通知', () => {
  const { session, cam } = aimedFixture()
  session.beginInteraction()
  session.writeCameraWorldPos('cam', { x: 2, y: 1.6, z: 4 }, false)
  session.commitNodeTransforms(0, [{ nodeId: 'cam', position: [2, 1.6, 4] }])
  session.endInteraction('移动相机')
  assert.equal(cam.camera!.lookAtTarget?.nodeId, 'actor')
  assert.equal(session.cameraAimReleaseVersion, 0)
  assert.deepEqual(cam.camera!.lookAt, { x: 0, y: 1.6, z: 0 })
})

test('只有旋转解除绑定通知一次，手动取消目标与撤销不通知', () => {
  const { session } = aimedFixture()
  session.setCameraLookAtTarget('cam', null)
  assert.equal(session.cameraAimReleaseVersion, 0)
  session.undo()
  session.beginInteraction()
  session.commitNodeTransforms(0, [{ nodeId: 'cam', position: [0, 1.6, 4], rotation: [0, 25, 0] }])
  session.writeCameraRotation('cam', { x: 0, y: 30, z: 0 }, true)
  session.endInteraction('旋转相机')
  assert.equal(session.cameraAimReleaseVersion, 1)
  session.undo()
  assert.equal(session.cameraAimReleaseVersion, 1)
})

test('解除看向后保留位置跟随：目标移动时机位与自由看点等量平移', () => {
  const { session, cam, actor } = aimedFixture(true)
  session.writeCameraRotation('cam', { x: 0, y: 45, z: 0 }, true)
  assert.equal(cam.camera!.lookAtTarget, undefined)
  const binding = cam.camera!.subject!
  assert.equal(binding.follow, true)
  assert.equal(binding.nodeId, actor.id)
  const start = resolveSubjectCameraPose(binding, actor.transform.position, actor.transform.rotation)
  const moved = resolveSubjectCameraPose(binding, { x: 3, y: 0, z: 0 }, actor.transform.rotation)
  assert.deepEqual(moved.position, { ...start.position, x: start.position.x + 3 })
  assert.deepEqual(moved.lookAt, { ...start.lookAt, x: start.lookAt.x + 3 })
  assert.deepEqual(start.lookAt, cam.camera!.lookAt)
})

test('绕视线倾斜和等价欧拉角保留看向；移动与调整距离也保留看向', () => {
  const { session, cam } = aimedFixture()
  const target = structuredClone(cam.camera!.lookAtTarget)
  session.writeCameraRotation('cam', { x: 0, y: 0, z: 25 }, true)
  assert.deepEqual(cam.camera!.lookAtTarget, target)
  session.writeCameraRotation('cam', { x: 0, y: 360, z: 25 }, true)
  assert.deepEqual(cam.camera!.lookAtTarget, target)
  session.writeCameraWorldPos('cam', { x: 2, y: 1.6, z: 4 }, true)
  session.setCameraSubjectDistance(3, 'cam')
  assert.deepEqual(cam.camera!.lookAtTarget, target)
})

test('自动关键帧旋转与解除绑定只需一次撤销', () => {
  const { session, cam, editor, model, history } = aimedFixture()
  const original = structuredClone(cam)
  editor.autoKeyframe = true
  session.writeCameraRotation('cam', { x: 0, y: 30, z: 0 }, true)
  assert.equal(cam.camera!.lookAtTarget, undefined)
  assert.equal(model.userKeys.cam!.rotation![0].value[1], 30)
  assert.equal(history.undoStack.length, 1)
  session.undo()
  assert.deepEqual(model.snapshot!.content.nodes.find((node) => node.id === 'cam'), original)
  assert.equal(model.userKeys.cam, undefined)
})

test('已有关键帧时旋转暂存仍解除看向，撤销恢复绑定', () => {
  const { session, cam, model } = aimedFixture()
  model.setUserKeys({ cam: { rotation: [makeKeyframe(0, [0, 0, 0])] } })
  session.writeCameraRotation('cam', { x: 0, y: 30, z: 0 }, true)
  assert.equal(cam.camera!.lookAtTarget, undefined)
  assert.deepEqual(session.pendingKeyframe?.rotation, [0, 30, 0])
  assert.deepEqual(model.userKeys.cam!.rotation![0].value, [0, 0, 0])
  session.undo()
  assert.equal(model.snapshot!.content.nodes.find((node) => node.id === 'cam')!.camera!.lookAtTarget?.nodeId, 'actor')
  assert.equal(session.pendingKeyframe, null)
})

test('机位数值连续拖动作为一次操作撤销，并可重做', () => {
  const { session, model, history } = fixture()
  const original = structuredClone(model.snapshot!.content.nodes.find((n) => n.id === 'cam')!)
  session.beginInteraction()
  for (const x of [1, 2, 3]) session.writeCameraWorldPos('cam', { x, y: 1.6, z: 4 }, false)
  session.writeCameraWorldPos('cam', { x: 3, y: 1.6, z: 4 }, true)
  session.endInteraction('移动相机')
  const read = () => model.snapshot!.content.nodes.find((n) => n.id === 'cam')!
  const final = structuredClone(read())
  assert.equal(history.undoStack.length, 1)
  session.undo()
  assert.deepEqual(read(), original)
  assert.equal(history.canUndo, false)
  session.redo()
  assert.deepEqual(read(), final)
})

test('机位旋转拖动支持一次撤销；取消位移拖动不产生历史', () => {
  const { session, model, history } = fixture()
  const original = structuredClone(model.snapshot!.content.nodes.find((n) => n.id === 'cam')!)
  session.beginInteraction()
  session.writeCameraRotation('cam', { x: 0, y: 15, z: 0 }, false)
  session.writeCameraRotation('cam', { x: 0, y: 30, z: 0 }, false)
  session.writeCameraRotation('cam', { x: 0, y: 30, z: 0 }, true)
  session.endInteraction('旋转相机')
  assert.equal(history.undoStack.length, 1)
  session.undo()
  assert.deepEqual(model.snapshot!.content.nodes.find((n) => n.id === 'cam'), original)
  session.beginInteraction()
  session.writeCameraWorldPos('cam', { x: 5, y: 1.6, z: 4 }, false)
  session.writeCameraWorldPos('cam', original.transform.position, false)
  session.endInteraction('移动相机')
  assert.equal(history.undoStack.length, 0)
  assert.equal(history.interactionActive, false)
})

test('机位改位移不自动打关键帧：无键只写静态 transform', () => {
  const { session, model, doc } = fixture()
  session.writeCameraWorldPos('cam', { x: 3, y: 1.6, z: 4 }, true)
  assert.equal(model.userKeys.cam, undefined)
  assert.equal(model.fcurves, null)
  assert.equal(doc.content.nodes.find((n) => n.id === 'cam')!.transform.position.x, 3)
})



test('未绑定看点目标：平移机位为刚体——看点等量位移、旋转冻结', () => {
  const { session, doc } = fixture()
  const err = session.writeCameraWorldPos('cam', { x: 3, y: 1.6, z: 4 }, true)
  assert.equal(err, null)
  const cam = doc.content.nodes.find((n) => n.id === 'cam')!
  assert.deepEqual(cam.transform.position, { x: 3, y: 1.6, z: 4 })
  // 原 lookAt (0,1.2,0)，位移 +3 on X → (3,1.2,0)
  assert.deepEqual(cam.camera!.lookAt, { x: 3, y: 1.2, z: 0 })
  assert.deepEqual(cam.transform.rotation, { x: 0, y: 0, z: 0 })
})

test('已绑定 lookAtTarget：平移不拖动世界看点（保持瞄准约束）', () => {
  const { session, doc } = fixture()
  const cam0 = doc.content.nodes.find((n) => n.id === 'cam')!
  cam0.camera!.lookAtTarget = { nodeId: 'actor', offset: { x: 0, y: 1.2, z: 0 } }
  cam0.camera!.lookAt = { x: 0, y: 1.2, z: 0 }
  session.writeCameraWorldPos('cam', { x: 3, y: 1.6, z: 4 }, true)
  const cam = doc.content.nodes.find((n) => n.id === 'cam')!
  assert.deepEqual(cam.transform.position, { x: 3, y: 1.6, z: 4 })
  // 世界看点不跟移
  assert.deepEqual(cam.camera!.lookAt, { x: 0, y: 1.2, z: 0 })
})

test('机位改位移：已有 userKey 则进入 pending，不改文档', () => {
  const { session, model, doc } = fixture()
  model.setUserKeys({ cam: { position: [makeKeyframe(0, [0, 1.6, 4])] } })
  session.writeCameraWorldPos('cam', { x: 5, y: 1.6, z: 4 }, true)
  const track = model.userKeys.cam?.position ?? []
  assert.equal(track.length, 1)
  assert.deepEqual(track[0].value, [0, 1.6, 4])
  assert.equal(doc.content.nodes.find((n) => n.id === 'cam')!.transform.position.x, 0)
  assert.equal(model.fcurves, null)
  assert.deepEqual(session.pendingKeyframe?.position, [5, 1.6, 4])
})

test('机位改 FOV 不自动打关键帧：无键只写静态 fov', () => {
  const { session, model, doc } = fixture()
  session.setCameraFov(35, 'cam')
  assert.equal(model.userKeys.cam, undefined)
  assert.equal(model.fcurves, null)
  assert.equal(doc.content.nodes.find((n) => n.id === 'cam')!.camera!.fov, 35)
})

test('机位视场角钻石打键：addKeyframe 写入 userKeys.fov', () => {
  const { session, model } = fixture()
  session.addKeyframe('cam', 'fov', [50])
  assert.equal(model.userKeys.cam?.fov?.length, 1)
  assert.deepEqual(model.userKeys.cam?.fov?.[0].value, [50])
})

test('机位改 FOV：已有键则进入 pending，不改文档', () => {
  const { session, model, doc } = fixture()
  model.setUserKeys({ cam: { fov: [makeKeyframe(0, [50])] } })
  session.setCameraFov(24, 'cam')
  const track = model.userKeys.cam?.fov ?? []
  assert.equal(track.length, 1)
  assert.deepEqual(track[0].value, [50])
  assert.equal(doc.content.nodes.find((n) => n.id === 'cam')!.camera!.fov, 50)
  assert.equal(model.fcurves, null)
  assert.deepEqual(session.pendingKeyframe?.fov, [24])
})

test('机位变换主轨手工添加：一次写入位移/旋转/看点/FOV', () => {
  const { session, model } = fixture()
  session.addKeyframes('cam', [
    { prop: 'position', value: [0, 1.6, 4] },
    { prop: 'rotation', value: [0, 0, 0] },
    { prop: 'lookAt', value: [0, 1.2, 0] },
    { prop: 'fov', value: [50] },
  ])
  assert.equal(model.userKeys.cam?.position?.length, 1)
  assert.equal(model.userKeys.cam?.rotation?.length, 1)
  assert.equal(model.userKeys.cam?.lookAt?.length, 1)
  assert.equal(model.userKeys.cam?.fov?.length, 1)
})

test('自由点改距离：沿看点射线缩放，俯仰角不变', () => {
  const { session, doc } = fixture()
  const err = session.setCameraSubjectDistance(2, 'cam')
  assert.equal(err, null)
  const cam = doc.content.nodes.find((n) => n.id === 'cam')!
  const scale = 2 / Math.hypot(0, 0.4, 4)
  assert.equal(cam.transform.position.x, 0)
  assert.ok(Math.abs(cam.transform.position.y - (1.2 + 0.4 * scale)) < 1e-9)
  assert.ok(Math.abs(cam.transform.position.z - 4 * scale) < 1e-9)
  assert.deepEqual(cam.camera!.lookAt, { x: 0, y: 1.2, z: 0 })
  assert.equal(cam.camera!.subject, undefined)
})

test('删除机位变换组合键会一并去掉看点与 FOV', () => {
  const { session, model } = fixture()
  model.setUserKeys({
    cam: {
      position: [makeKeyframe(0, [0, 1.6, 4])],
      lookAt: [makeKeyframe(0, [0, 1.2, 0])],
      fov: [makeKeyframe(0, [50])],
    },
  })
  session.removeTransformKeysAtFrame('cam', 0)
  assert.equal(model.userKeys.cam, undefined)
})


test('打帧后拖动只暂存：I 才覆写当前帧关键帧', () => {
  const { session, model } = fixture()
  model.setUserKeys({ cam: { position: [makeKeyframe(0, [0, 1.6, 4])] } })
  session.writeCameraWorldPos('cam', { x: 5, y: 1.6, z: 4 }, true)
  assert.deepEqual(model.userKeys.cam!.position![0].value, [0, 1.6, 4])
  assert.deepEqual(session.pendingKeyframe?.position, [5, 1.6, 4])
  session.addKeyframes('cam', [{ prop: 'position', value: [0, 1.6, 4] }])
  assert.deepEqual(model.userKeys.cam!.position![0].value, [5, 1.6, 4])
})


test('B46: releasing the lens and round trips do not create more revisions or saves', async () => {
  const writes: DirectorDocument[] = []
  const { session, model, doc } = fixture({
    saveDocumentState: async (_id: string, saved: DirectorDocument) => { writes.push(saved) },
  } as unknown as HostAdapter<DirectorDocument>)
  for (const fov of [120, 78.83]) {
    session.setCameraFov(fov, 'cam')
    await session.save({ captureCover: false })
    const revision = model.revision
    const count = writes.length
    for (let i = 0; i < 1000; i++) session.setCameraFov(focalLengthToFov(fovToFocalLength(fov)), 'cam')
    session.setCameraFov(NaN, 'cam')
    await session.save({ captureCover: false })
    assert.equal(model.revision, revision)
    assert.equal(writes.length, count)
    assert.equal(doc.content.nodes.find((node) => node.id === 'cam')!.camera!.fov, fov)
  }
})

test('B32/B44: document updates and timeline saves preserve baked camera keys and shots', async () => {
  let savedCurves: unknown
  let savedDoc: DirectorDocument | undefined
  const { session, model, doc } = fixture({
    saveDocumentState: async (_id: string, saved: DirectorDocument, curves: unknown) => { savedDoc = saved; savedCurves = curves },
  } as unknown as HostAdapter<DirectorDocument>)
  doc.content.editorial = {
    version: 1, activeSequenceId: 'tap15',
    sequences: [{ id: 'tap15', clips: [{ id: 'shot01', cameraNodeId: 'cam', sourceFrameStart: 0, sourceFrameEnd: 149 }] }],
  }
  const keys = { cam: {
    position: Array.from({ length: 150 }, (_, f) => makeKeyframe(f, [f, 1.6, 4])),
    rotation: Array.from({ length: 150 }, (_, f) => makeKeyframe(f, [0, f / 10, 0])),
    scale: Array.from({ length: 150 }, (_, f) => makeKeyframe(f, [1, 1, 1])),
    lookAt: Array.from({ length: 150 }, (_, f) => makeKeyframe(f, [f, 1.2, 0])),
    fov: Array.from({ length: 150 }, (_, f) => makeKeyframe(f, [50 + f / 10])),
  } }
  model.setUserKeys(keys)
  for (let i = 0; i < 5; i++) {
    session.setDoc(structuredClone(session.doc!))
    session.setTimelineRange(0, 160 + i)
    await session.save({ captureCover: false })
    assert.deepEqual(model.userKeys, keys)
    assert.deepEqual(FCurveSet.parseUserKeys(savedCurves), keys)
    assert.ok(savedDoc?.content.nodes.some((node) => node.id === 'cam'))
    assert.equal(savedDoc?.content.editorial?.sequences[0].clips[0].cameraNodeId, 'cam')
  }
  session.setDoc(structuredClone(session.doc!), null)
  assert.deepEqual(model.userKeys, {})
})
