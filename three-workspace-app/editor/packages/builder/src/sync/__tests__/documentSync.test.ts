import { test } from 'vitest'
import assert from 'node:assert/strict'
import { reaction } from 'mobx'
import { makeEmptyDraft } from '../../contract/emptyDraft'
import type { DirectorDocument } from '../../contract/types'
import { DirectorDoc } from '../../document/DirectorDoc'
import { History } from '../../document/History'
import { EditorStore } from '../../stores/EditorStore'
import type { DirectorEngine } from '../../engine/DirectorEngine'
import type { HostAdapter } from '../../host/types'
import { DocumentSync } from '../DocumentSync'
import { StudioSession } from '../StudioSession'

function engineStub(): DirectorEngine {
  return {
    currentFrame: 0,
    ready: false,
    reset() {},
    invalidate() {},
    setPlayRange() {},
    load: async () => undefined,
    seek() {},
    setEvalContext() {},
    setFcurves() {},
    pause() {},
    play() {},
    startAmbient() {},
    stopAmbient() {},
    removeNode() {},
    hasNode() { return false },
    addRuntimeNode: async () => undefined,
    setPoseEditingId() {},
    syncGizmo() {},
    syncPathSelection() {},
    syncPathNodes() {},
    syncCameraMotionGuide() {},
  } as unknown as DirectorEngine
}

test('重新加载宿主文档后 dirty 会通知为 false', async () => {
  const documentId = 'host-reload'
  const adapter = {
    loadDocument: async () => makeEmptyDraft(documentId, 24, 120),
    loadFCurves: async () => null,
  } as unknown as HostAdapter<DirectorDocument>
  const session = new StudioSession(
    engineStub(),
    new DirectorDoc(),
    new EditorStore(documentId),
    new History(),
    adapter,
  )
  const dirtyStates: boolean[] = []
  const dispose = reaction(
    () => session.dirty,
    (dirty) => dirtyStates.push(dirty),
    { fireImmediately: true },
  )

  await session.loadDraft(documentId)

  assert.deepEqual(dirtyStates, [false, true, false])
  dispose()
})

test('writeLocked 时 revision 变化不通知宿主', () => {
  const changes: number[] = []
  const adapter = {
    onDocumentChange: () => { changes.push(Date.now()) },
  } as unknown as HostAdapter<DirectorDocument>
  const open = (readOnly: boolean) => {
    const model = new DirectorDoc()
    model.replace(makeEmptyDraft('sync-lock', 24, 120))
    const session = new StudioSession(
      engineStub(),
      model,
      new EditorStore('sync-lock'),
      new History(),
      adapter,
      { readOnly },
    )
    return { model, sync: new DocumentSync(session) }
  }

  const locked = open(true)
  locked.model.touch()
  assert.equal(changes.length, 0)
  locked.sync.dispose()

  const unlocked = open(false)
  unlocked.model.touch()
  assert.equal(changes.length, 1)
  unlocked.sync.dispose()
})

test('hostReadOnly 只阻止草稿写入，仍允许选择和面板浏览', () => {
  const documentId = 'host-read-only'
  const model = new DirectorDoc()
  const doc = makeEmptyDraft(documentId, 24, 120, {
    fov: 35,
    position: { x: 0, y: 1.6, z: 4 },
    rotation: { x: 0, y: 0, z: 0 },
    lookAt: { x: 0, y: 1, z: 0 },
  })
  model.replace(doc)
  const session = new StudioSession(
    engineStub(),
    model,
    new EditorStore(documentId),
    new History(),
    {} as HostAdapter<DirectorDocument>,
    { readOnly: true },
  )
  assert.equal(session.hostReadOnly, true)
  assert.equal(session.writeLocked, true)
  const camera = doc.content.nodes.find((node) => node.type === 'camera')
  if (!camera) throw new Error('测试草稿缺少默认相机')
  const lockedRevision = model.revision
  const inspectorOpen = session.inspectorOpen

  session.select({ kind: 'node', nodeId: camera.id })
  session.toggleInspector()
  session.setPxPerFrame(3)

  assert.equal(session.selection?.kind, 'node')
  assert.equal(session.inspectorOpen, !inspectorOpen)
  assert.equal(session.pxPerFrame, 3)

  session.undo()
  session.setAspectRatio('9:16')
  session.setTimelineRange(10, 90)
  session.updateEnvironment({ skyColor: '#ffffff' })
  session.setNodeFlags(camera.id, { visible: false })
  session.writeNodeTransform(camera.id, { position: { x: 9, y: 9, z: 9 } })
  session.addPrimitive('blocked', 'cube', { width: 1, height: 1, depth: 1 })
  session.deleteNode(camera.id)

  assert.equal(JSON.stringify(model.snapshot), JSON.stringify(doc))
  assert.equal(model.revision, lockedRevision)
})

test('hydrating 时改节点 id 不 addRuntimeNode', async () => {
  const added: string[] = []
  const engine = {
    ...engineStub(),
    ready: true,
    addRuntimeNode: async (node: { id: string }) => { added.push(node.id) },
  } as unknown as DirectorEngine
  const model = new DirectorDoc()
  const draft = makeEmptyDraft('sync-hydrate', 24, 120, {
    fov: 35,
    position: { x: 0, y: 1.6, z: 4 },
    rotation: { x: 0, y: 0, z: 0 },
    lookAt: { x: 0, y: 1, z: 0 },
  })
  model.replace(draft)
  const session = new StudioSession(
    engine,
    model,
    new EditorStore('sync-hydrate'),
    new History(),
    {} as HostAdapter<DirectorDocument>,
  )
  const sync = new DocumentSync(session)
  session.hydrating = true
  const live = model.toContract()
  if (!live) throw new Error('expected draft')
  live.content.nodes.push({
    id: 'prop_hydrate',
    type: 'prop',
    name: 'hydrate',
    visible: true,
    locked: false,
    transform: {
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    },
  })
  model.touch()
  await Promise.resolve()
  assert.equal(added.length, 0)
  sync.dispose()
})

test('时间轴面板打开后预览不再自行循环，关掉后恢复', () => {
  let ambientStarts = 0
  let ambientStops = 0
  const engine = {
    ...engineStub(),
    startAmbient() { ambientStarts += 1 },
    stopAmbient() { ambientStops += 1 },
  } as unknown as DirectorEngine
  const editor = new EditorStore('sync-ambient')
  const session = new StudioSession(
    engine,
    new DirectorDoc(),
    editor,
    new History(),
    {} as HostAdapter<DirectorDocument>,
  )
  const sync = new DocumentSync(session)
  assert.equal(ambientStarts, 1)
  assert.equal(ambientStops, 0)

  editor.toggleTimelinePanel()
  assert.equal(ambientStops, 1)

  editor.toggleTimelinePanel()
  assert.equal(ambientStarts, 2)
  sync.dispose()
})

test('时间轴打开后点播放会驱动引擎', () => {
  const calls: string[] = []
  const engine = {
    ...engineStub(),
    play() { calls.push('play') },
    pause() { calls.push('pause') },
    startAmbient() { calls.push('startAmbient') },
    stopAmbient() { calls.push('stopAmbient') },
  } as unknown as DirectorEngine
  const editor = new EditorStore('sync-timeline-play')
  const session = new StudioSession(
    engine,
    new DirectorDoc(),
    editor,
    new History(),
    {} as HostAdapter<DirectorDocument>,
  )
  const sync = new DocumentSync(session)
  editor.toggleTimelinePanel()
  calls.length = 0
  editor.setPlaying(true)
  assert.deepEqual(calls, ['stopAmbient', 'play'])
  sync.dispose()
})


test('B44/B46: saves and camera edits are blocked while a host reload awaits its sidecar', async () => {
  const model = new DirectorDoc()
  const doc = makeEmptyDraft('reload-save-race', 30, 150, {
    fov: 120, position: { x: 0, y: 2, z: 4 }, rotation: { x: 0, y: 0, z: 0 }, lookAt: { x: 0, y: 1, z: 0 },
  })
  model.replace(doc)
  const fresh = structuredClone(doc)
  fresh.content.nodes[0]!.camera!.fov = 78.83
  let finishCurves!: (raw: unknown) => void
  let writes = 0
  const session = new StudioSession(engineStub(), model, new EditorStore('reload-save-race'), new History(), {
    loadDocument: async () => fresh,
    loadFCurves: () => new Promise((resolve) => { finishCurves = resolve }),
    saveDocumentState: async () => { writes++ },
  } as unknown as HostAdapter<DirectorDocument>)
  const reloading = session.reloadFromHost()
  while (!finishCurves) await Promise.resolve()
  assert.equal(session.writeLocked, true)
  session.setCameraFov(35, doc.content.nodes[0]!.id)
  await session.save({ captureCover: false })
  assert.equal(writes, 0)
  assert.equal(doc.content.nodes[0]!.camera!.fov, 120)
  finishCurves(null)
  await reloading
  assert.equal(session.writeLocked, false)
  assert.equal(session.doc!.content.nodes[0]!.camera!.fov, 78.83)
  assert.equal(session.dirty, false)
})

test('B44: an in-flight save cannot drain old work across a newer host reload', async () => {
  const model = new DirectorDoc()
  model.replace(makeEmptyDraft('save-generation', 30, 150))
  let finishSave!: () => void
  const writes: DirectorDocument[] = []
  const fresh = makeEmptyDraft('save-generation', 30, 300)
  const session = new StudioSession(engineStub(), model, new EditorStore('save-generation'), new History(), {
    loadDocument: async () => fresh,
    loadFCurves: async () => null,
    saveDocumentState: async (_id: string, doc: DirectorDocument) => {
      writes.push(doc)
      await new Promise<void>((resolve) => { finishSave = resolve })
    },
  } as unknown as HostAdapter<DirectorDocument>)
  const saving = session.save({ captureCover: false })
  await session.reloadFromHost()
  session.setTimelineRange(0, 350)
  finishSave()
  await saving
  assert.equal(writes.length, 1)
  assert.equal(session.doc!.content.timeline.frameEnd, 350)
  assert.equal(session.dirty, true)
})


test('B32/B44: failed host sidecar reload keeps old scene locked until a complete retry', async () => {
  const model = new DirectorDoc()
  const previous = makeEmptyDraft('failed-reload', 30, 150)
  model.replace(previous)
  const fresh = makeEmptyDraft('failed-reload', 30, 300)
  let fail = true
  let writes = 0
  const session = new StudioSession(engineStub(), model, new EditorStore('failed-reload'), new History(), {
    loadDocument: async () => fresh,
    loadFCurves: async () => { if (fail) throw new Error('sidecar unavailable'); return null },
    saveDocumentState: async () => { writes++ },
  } as unknown as HostAdapter<DirectorDocument>)
  await assert.rejects(session.reloadFromHost(), /sidecar unavailable/)
  assert.equal(session.hydrating, false)
  assert.equal(session.writeLocked, true)
  assert.equal(session.doc!.content.timeline.frameEnd, 150)
  await session.save({ captureCover: false })
  assert.equal(writes, 0)
  fail = false
  await session.reloadFromHost()
  assert.equal(session.writeLocked, false)
  assert.equal(session.doc!.content.timeline.frameEnd, 300)
})


test('B32: initial draft sidecar failure cannot save an empty key layer', async () => {
  let writes = 0
  const session = new StudioSession(engineStub(), new DirectorDoc(), new EditorStore('failed-open'), new History(), {
    loadDocument: async () => makeEmptyDraft('failed-open', 30, 150),
    loadFCurves: async () => { throw new Error('sidecar unavailable') },
    saveDocumentState: async () => { writes++ },
  } as unknown as HostAdapter<DirectorDocument>)
  await assert.rejects(session.loadDraft('failed-open'), /sidecar unavailable/)
  assert.equal(session.writeLocked, true)
  await session.save({ captureCover: false })
  assert.equal(writes, 0)
})


test('B44/B58: a pilot preview is cancelled across reload and cannot write while loading', async () => {
  const model = new DirectorDoc()
  const doc = makeEmptyDraft('pilot-load', 30, 150, {
    fov: 50, position: { x: 0, y: 2, z: 4 }, rotation: { x: 0, y: 0, z: 0 }, lookAt: { x: 0, y: 1, z: 0 },
  })
  model.replace(doc)
  const editor = new EditorStore('pilot-load')
  const cameraId = doc.content.nodes[0]!.id
  let ended = 0
  const engine = {
    ...engineStub(),
    getNodeSnapshot: () => null,
    applyLiveCameraPose() {},
    endCameraPilot: () => { ended++; return { position: { x: 99, y: 99, z: 99 }, forward: { x: 0, y: 0, z: -1 } } },
  } as unknown as DirectorEngine
  const session = new StudioSession(engine, model, editor, new History(), {
    loadDocument: async () => structuredClone(doc),
    loadFCurves: async () => null,
  } as unknown as HostAdapter<DirectorDocument>)
  editor.setCameraPilotId(cameraId)
  session.hydrating = true
  const before = JSON.stringify(session.doc)
  session.setCameraPilot(null)
  assert.equal(JSON.stringify(session.doc), before)
  assert.equal(editor.cameraPilotId, null)
  session.hydrating = false
  editor.setCameraPilotId(cameraId)
  await session.reloadFromHost()
  assert.equal(editor.cameraPilotId, null)
  assert.equal(session.doc!.content.nodes[0]!.transform.position.x, 0)
  editor.setCameraPilotId(cameraId)
  await session.loadDraft('pilot-load')
  assert.equal(editor.cameraPilotId, null)
  assert.equal(session.doc!.content.nodes[0]!.transform.position.x, 0)
  assert.equal(ended, 3)
})


test('B44: fresh save after reload waits for old request and then persists the new generation', async () => {
  const model = new DirectorDoc()
  model.replace(makeEmptyDraft('save-after-reload', 30, 150))
  let finishOld!: () => void
  const writes: DirectorDocument[] = []
  const session = new StudioSession(engineStub(), model, new EditorStore('save-after-reload'), new History(), {
    loadDocument: async () => makeEmptyDraft('save-after-reload', 30, 300),
    loadFCurves: async () => null,
    saveDocumentState: async (_id: string, doc: DirectorDocument) => {
      writes.push(doc)
      if (writes.length === 1) await new Promise<void>((resolve) => { finishOld = resolve })
    },
  } as unknown as HostAdapter<DirectorDocument>)
  const old = session.save({ captureCover: false })
  await session.reloadFromHost()
  session.setTimelineRange(0, 350)
  const fresh = session.save({ captureCover: false })
  assert.equal(writes.length, 1)
  finishOld()
  await Promise.all([old, fresh])
  assert.equal(writes.length, 2)
  assert.equal(writes[1]!.content.timeline.frameEnd, 350)
  assert.equal(session.dirty, false)
})
