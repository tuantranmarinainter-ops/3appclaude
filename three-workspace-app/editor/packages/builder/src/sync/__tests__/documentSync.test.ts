import { test } from 'vitest'
import assert from 'node:assert/strict'
import { reaction } from 'mobx'
import { makeEmptyDraft } from '../../contract/emptyDraft'
import type { DirectorDocument } from '../../contract/types'
import { DirectorDoc } from '../../document/DirectorDoc'
import { FCurveSet } from '../../evaluate/curves/FCurveSet'
import { makeKeyframe } from '../../evaluate/curves/KeyframeTrack'
import { History } from '../../document/History'
import { EditorStore } from '../../stores/EditorStore'
import { makeTimelineBoxSelection } from '../../stores/types'
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

test('mixed key deletion notifies the host once with both layers removed', () => {
  const doc = makeEmptyDraft('mixed-delete-sync', 24, 120, {
    fov: 35, position: { x: 0, y: 1.6, z: 4 }, rotation: { x: 0, y: 0, z: 0 }, lookAt: { x: 0, y: 1, z: 0 },
  })
  const model = new DirectorDoc()
  model.replace(doc)
  const nodeId = doc.content.nodes[0]!.id
  const fc = FCurveSet.empty()
  fc.upsertKey(nodeId, 'transform.scale', 0, 10, 2)
  model.setFcurves(fc)
  const key = makeKeyframe(10, [1, 2, 3])
  model.setUserKeys({ [nodeId]: { position: [key] } })
  const editor = new EditorStore('mixed-delete-sync')
  const changes: string[] = []
  const session = new StudioSession(engineStub(), model, editor, new History(), {
    onDocumentChange: (_id: string, _doc: DirectorDocument, curves: unknown) => changes.push(JSON.stringify(curves)),
  } as unknown as HostAdapter<DirectorDocument>)
  const sync = new DocumentSync(session)
  editor.select(makeTimelineBoxSelection([], [{ nodeId, prop: 'position', keyId: key.id }], [
    { nodeId, propPath: 'transform.scale', frame: 10 },
  ]))
  session.deleteSelection()
  assert.equal(changes.length, 1)
  assert.equal(changes[0], JSON.stringify(FCurveSet.persist(model.fcurves, model.userKeys)))
  assert.equal(model.userKeys[nodeId]?.position?.length, 0)
  assert.equal(model.fcurves?.tracksForNode(nodeId).length, 0)
  session.undo()
  assert.equal(changes.length, 2)
  assert.equal(model.userKeys[nodeId]?.position?.length, 1)
  assert.equal(model.fcurves?.tracksForNode(nodeId).length, 1)
  sync.dispose()
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

test('timeline checkpoints keep prior edits and each gesture in FIFO order, even while first save waits', async () => {
  const initial = makeEmptyDraft('fifo', 30, 120, { fov: 35, position: { x: 0, y: 1, z: 4 }, rotation: { x: 0, y: 0, z: 0 }, lookAt: { x: 0, y: 0, z: 0 } })
  const nodeId = initial.content.nodes[0]!.id
  const fc = FCurveSet.empty(); fc.upsertKey(nodeId, 'transform.scale', 0, 10, 2)
  const writes: { id: string; frame: number; end: number }[] = []
  let release!: () => void
  const editor = new EditorStore('fifo')
  const session = new StudioSession(engineStub(), new DirectorDoc(), editor, new History(), {
    preserveTimelineHistory: true,
    loadDocument: async () => structuredClone(initial), loadFCurves: async () => fc.encode(),
    saveDocumentState: async (id: string, doc: DirectorDocument, curves: unknown) => {
      writes.push({ id, frame: FCurveSet.parse(curves).tracksForNode(nodeId)[0]!.keys[0]!.frame, end: doc.content.timeline.frameEnd })
      if (writes.length === 1) await new Promise<void>((resolve) => { release = resolve })
    },
  } as unknown as HostAdapter<DirectorDocument>)
  await session.loadDraft('fifo')
  session.setTimelineRange(0, 110)
  session.moveTimelineKeys([], [{ nodeId, propPath: 'transform.scale', frame: 10 }], 5)
  session.setTimelineRange(0, 115)
  session.moveTimelineKeys([], [{ nodeId, propPath: 'transform.scale', frame: 15 }], 5)
  const save = session.save({ captureCover: false })
  assert.deepEqual(writes, [{ id: 'fifo', frame: 10, end: 110 }])
  release()
  assert.equal(await save, null)
  assert.deepEqual(writes, [
    { id: 'fifo', frame: 10, end: 110 }, { id: 'fifo', frame: 15, end: 110 },
    { id: 'fifo', frame: 15, end: 115 }, { id: 'fifo', frame: 20, end: 115 },
  ])
  assert.equal(session.dirty, false)
})

test('failed checkpoint is retained and retried before a later gesture or document switch', async () => {
  const initial = makeEmptyDraft('old-id', 30, 120, { fov: 35, position: { x: 0, y: 1, z: 4 }, rotation: { x: 0, y: 0, z: 0 }, lookAt: { x: 0, y: 0, z: 0 } })
  const nodeId = initial.content.nodes[0]!.id
  const fc = FCurveSet.empty(); fc.upsertKey(nodeId, 'transform.scale', 0, 10, 2)
  const writes: Array<[string, number]> = []
  let fail = true
  const editor = new EditorStore('old-id')
  const session = new StudioSession(engineStub(), new DirectorDoc(), editor, new History(), {
    preserveTimelineHistory: true,
    loadDocument: async (id: string) => id === 'old-id' ? structuredClone(initial) : makeEmptyDraft(id, 30, 200),
    loadFCurves: async (id: string) => id === 'old-id' ? fc.encode() : null,
    saveDocumentState: async (id: string, _doc: DirectorDocument, curves: unknown) => {
      writes.push([id, FCurveSet.parse(curves).tracksForNode(nodeId)[0]!.keys[0]!.frame])
      if (fail) throw new Error('offline')
    },
  } as unknown as HostAdapter<DirectorDocument>)
  await session.loadDraft('old-id')
  session.moveTimelineKeys([], [{ nodeId, propPath: 'transform.scale', frame: 10 }], 5)
  await session.flushPendingUserWrites()
  assert.equal(session.saveState, 'error')
  session.moveTimelineKeys([], [{ nodeId, propPath: 'transform.scale', frame: 15 }], 5)
  await session.flushPendingUserWrites()
  editor.setDraftId('new-id')
  await assert.rejects(session.loadDraft('new-id'), /offline/)
  assert.equal(session.docModel.fcurves!.tracksForNode(nodeId)[0]!.keys[0]!.frame, 20)
  fail = false
  await session.loadDraft('new-id')
  assert.equal(session.doc!.content.timeline.frameEnd, 200)
  assert.deepEqual(writes.slice(-2), [['old-id', 15], ['old-id', 20]])
  assert.ok(writes.every(([id]) => id === 'old-id'))
})

test('external reload while timeline writes are pending preserves local changes', async () => {
  const initial = makeEmptyDraft('external', 30, 120, { fov: 35, position: { x: 0, y: 1, z: 4 }, rotation: { x: 0, y: 0, z: 0 }, lookAt: { x: 0, y: 0, z: 0 } })
  const nodeId = initial.content.nodes[0]!.id
  const fc = FCurveSet.empty(); fc.upsertKey(nodeId, 'transform.scale', 0, 10, 2)
  let release!: () => void
  let loads = 0
  const session = new StudioSession(engineStub(), new DirectorDoc(), new EditorStore('external'), new History(), {
    preserveTimelineHistory: true,
    loadDocument: async () => { loads++; return structuredClone(initial) }, loadFCurves: async () => fc.encode(),
    saveDocumentState: async () => { await new Promise<void>((resolve) => { release = resolve }) },
  } as unknown as HostAdapter<DirectorDocument>)
  await session.loadDraft('external')
  session.moveTimelineKeys([], [{ nodeId, propPath: 'transform.scale', frame: 10 }], 5)
  await assert.rejects(session.reloadFromHost(), /Unsaved local changes/)
  assert.equal(loads, 1)
  assert.equal(session.docModel.fcurves!.tracksForNode(nodeId)[0]!.keys[0]!.frame, 15)
  release()
  await session.flushPendingUserWrites()
})

test('failed periodic save retains its snapshot before later timeline gestures', async () => {
  const initial = makeEmptyDraft('autosave-retry', 30, 120, { fov: 35, position: { x: 0, y: 1, z: 4 }, rotation: { x: 0, y: 0, z: 0 }, lookAt: { x: 0, y: 0, z: 0 } })
  const nodeId = initial.content.nodes[0]!.id
  const fc = FCurveSet.empty(); fc.upsertKey(nodeId, 'transform.scale', 0, 10, 2)
  let fail = true
  const writes: Array<[number, number]> = []
  const session = new StudioSession(engineStub(), new DirectorDoc(), new EditorStore('autosave-retry'), new History(), {
    preserveTimelineHistory: true,
    loadDocument: async () => structuredClone(initial), loadFCurves: async () => fc.encode(),
    saveDocumentState: async (_id: string, doc: DirectorDocument, curves: unknown) => {
      writes.push([doc.content.timeline.frameEnd, FCurveSet.parse(curves).tracksForNode(nodeId)[0]!.keys[0]!.frame])
      if (fail) throw new Error('unknown response')
    },
  } as unknown as HostAdapter<DirectorDocument>)
  await session.loadDraft('autosave-retry')
  session.setTimelineRange(0, 110)
  assert.equal(await session.save({ captureCover: false }), 'unknown response')
  session.setTimelineRange(0, 115)
  session.moveTimelineKeys([], [{ nodeId, propPath: 'transform.scale', frame: 10 }], 5)
  await session.flushPendingUserWrites()
  fail = false
  assert.equal(await session.save({ captureCover: false }), null)
  assert.deepEqual(writes.slice(-3), [[110, 10], [115, 10], [115, 15]])
  assert.equal(session.dirty, false)
})

test('reload conflict keeps local edits editable, blocks save, and requires explicit recovery', async () => {
  const initial = makeEmptyDraft('conflict', 30, 120, { fov: 35, position: { x: 0, y: 1, z: 4 }, rotation: { x: 0, y: 0, z: 0 }, lookAt: { x: 0, y: 0, z: 0 } })
  const nodeId = initial.content.nodes[0]!.id
  const fc = FCurveSet.empty(); fc.upsertKey(nodeId, 'transform.scale', 0, 10, 2)
  let delayed = false
  let release!: (raw: unknown) => void
  let invalidated = 0
  let confirmed = 0
  const model = new DirectorDoc()
  const session = new StudioSession(engineStub(), model, new EditorStore('conflict'), new History(), {
    preserveTimelineHistory: true,
    loadDocument: async () => structuredClone(initial),
    loadFCurves: async () => delayed ? new Promise((resolve) => { release = resolve }) : fc.encode(),
    saveDocumentState: async () => undefined,
    invalidateLoadedRevision: () => { invalidated++ },
    confirmHostReload: () => { confirmed++ },
  } as unknown as HostAdapter<DirectorDocument>)
  await session.loadDraft('conflict')
  delayed = true
  const reload = session.reloadFromHost()
  while (!release) await Promise.resolve()
  model.toContract()!.content.timeline.frameEnd = 111
  model.touch()
  release(fc.encode())
  await assert.rejects(reload, /Local changes/)
  assert.equal(model.snapshot!.content.timeline.frameEnd, 111)
  assert.equal(session.hostReloadConflict, true)
  assert.equal(session.writeLocked, false)
  assert.match((await session.save({ captureCover: false }))!, /conflict/i)
  assert.equal(invalidated, 1)
  assert.equal(confirmed, 0)
  delayed = false
  await session.recoverHostReloadConflict()
  assert.equal(session.hostReloadConflict, false)
  assert.equal(model.snapshot!.content.timeline.frameEnd, 120)
  assert.equal(confirmed, 1)
})

test('conflict recovery refuses a concurrent reload and does not discard checkpoints', async () => {
  const initial = makeEmptyDraft('recover-race', 30, 120, { fov: 35, position: { x: 0, y: 1, z: 4 }, rotation: { x: 0, y: 0, z: 0 }, lookAt: { x: 0, y: 0, z: 0 } })
  let gate = false
  let release!: (raw: unknown) => void
  let confirmed = 0
  const session = new StudioSession(engineStub(), new DirectorDoc(), new EditorStore('recover-race'), new History(), {
    preserveTimelineHistory: true,
    loadDocument: async () => structuredClone(initial),
    loadFCurves: async () => gate ? new Promise((resolve) => { release = resolve }) : null,
    saveDocumentState: async () => undefined,
    confirmHostReload: () => { confirmed++ },
  } as unknown as HostAdapter<DirectorDocument>)
  await session.loadDraft('recover-race')
  gate = true
  const loading = session.reloadFromHost()
  while (!release) await Promise.resolve()
  session.offerHostReloadRecovery()
  await assert.rejects(session.recoverHostReloadConflict(), /already in progress/)
  assert.equal(confirmed, 0)
  release(null)
  await assert.rejects(loading, /Local changes/)
  assert.equal(session.hostReloadConflict, true)
  gate = false
  await session.recoverHostReloadConflict()
  assert.equal(confirmed, 1)
  assert.equal(session.hostReloadConflict, false)
})

test('setDraft waits for a pending checkpoint and never writes the old document to the new ID', async () => {
  const initial = makeEmptyDraft('old', 30, 120, { fov: 35, position: { x: 0, y: 1, z: 4 }, rotation: { x: 0, y: 0, z: 0 }, lookAt: { x: 0, y: 0, z: 0 } })
  const nodeId = initial.content.nodes[0]!.id
  const fc = FCurveSet.empty(); fc.upsertKey(nodeId, 'transform.scale', 0, 10, 2)
  let release!: () => void
  const ids: string[] = []
  const editor = new EditorStore('old')
  const engine = { ...engineStub(), clearDrawPreview() {}, endFollow() {}, setOrbitEnabled() {}, endProgramPreview() {} } as unknown as DirectorEngine
  const session = new StudioSession(engine, new DirectorDoc(), editor, new History(), {
    preserveTimelineHistory: true,
    loadDocument: async () => structuredClone(initial), loadFCurves: async () => fc.encode(),
    saveDocumentState: async (id: string) => { ids.push(id); await new Promise<void>((resolve) => { release = resolve }) },
  } as unknown as HostAdapter<DirectorDocument>)
  await session.loadDraft('old')
  session.moveTimelineKeys([], [{ nodeId, propPath: 'transform.scale', frame: 10 }], 5)
  session.setDraft('new')
  assert.equal(editor.draftId, 'old')
  release()
  await session.flushPendingUserWrites()
  assert.deepEqual(ids, ['old'])
  assert.equal(editor.draftId, 'new')
})

test('close waits for pending timeline checkpoints before reporting success', async () => {
  const initial = makeEmptyDraft('close-fifo', 30, 120, { fov: 35, position: { x: 0, y: 1, z: 4 }, rotation: { x: 0, y: 0, z: 0 }, lookAt: { x: 0, y: 0, z: 0 } })
  const nodeId = initial.content.nodes[0]!.id
  const fc = FCurveSet.empty(); fc.upsertKey(nodeId, 'transform.scale', 0, 10, 2)
  let release!: () => void
  const session = new StudioSession(engineStub(), new DirectorDoc(), new EditorStore('close-fifo'), new History(), {
    preserveTimelineHistory: true,
    loadDocument: async () => structuredClone(initial), loadFCurves: async () => fc.encode(),
    saveDocumentState: async () => { await new Promise<void>((resolve) => { release = resolve }) },
  } as unknown as HostAdapter<DirectorDocument>)
  await session.loadDraft('close-fifo')
  session.moveTimelineKeys([], [{ nodeId, propPath: 'transform.scale', frame: 10 }], 5)
  const close = await session.beginCloseSave()
  assert.ok(close.done)
  let settled = false
  void close.done.then(() => { settled = true })
  await Promise.resolve()
  assert.equal(settled, false)
  release()
  assert.equal(await close.done, null)
  assert.equal(session.dirty, false)
})

test('recovery preserves a newer change made while the confirmed reload is waiting', async () => {
  const initial = makeEmptyDraft('recovery-new-edit', 30, 120)
  let gate = false
  let release!: (raw: unknown) => void
  let confirmed = 0
  const model = new DirectorDoc()
  const session = new StudioSession(engineStub(), model, new EditorStore('recovery-new-edit'), new History(), {
    preserveTimelineHistory: true,
    loadDocument: async () => structuredClone(initial),
    loadFCurves: async () => gate ? new Promise((resolve) => { release = resolve }) : null,
    saveDocumentState: async () => undefined,
    confirmHostReload: () => { confirmed++ },
  } as unknown as HostAdapter<DirectorDocument>)
  await session.loadDraft('recovery-new-edit')
  session.offerHostReloadRecovery()
  gate = true
  const recovery = session.recoverHostReloadConflict()
  while (!release) await Promise.resolve()
  model.toContract()!.content.timeline.frameEnd = 111
  model.touch()
  release(null)
  await assert.rejects(recovery, /Local changes/)
  assert.equal(model.snapshot!.content.timeline.frameEnd, 111)
  assert.equal(session.hostReloadConflict, true)
  assert.equal(confirmed, 0)
})

test('reload does not mark edits during engine refresh as saved', async () => {
  const initial = makeEmptyDraft('refresh-race', 30, 120)
  const model = new DirectorDoc()
  let release!: () => void
  let gate = false
  let invalidated = 0
  const engine = { ...engineStub(), ready: true, refreshDocument: async () => { if (gate) await new Promise<void>((resolve) => { release = resolve }) } } as unknown as DirectorEngine
  const session = new StudioSession(engine, model, new EditorStore('refresh-race'), new History(), {
    preserveTimelineHistory: true,
    loadDocument: async () => structuredClone(initial), loadFCurves: async () => null,
    saveDocumentState: async () => undefined,
    invalidateLoadedRevision: () => { invalidated++ },
  } as unknown as HostAdapter<DirectorDocument>)
  await session.loadDraft('refresh-race')
  gate = true
  const reload = session.reloadFromHost()
  while (!release) await Promise.resolve()
  model.toContract()!.content.timeline.frameEnd = 111
  model.touch()
  release()
  await assert.rejects(reload, /Local changes/)
  assert.equal(model.snapshot!.content.timeline.frameEnd, 111)
  assert.equal(session.dirty, true)
  assert.equal(session.hostReloadConflict, true)
  assert.equal(invalidated, 1)
})
