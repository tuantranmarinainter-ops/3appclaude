import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { LocalHostAdapter } from '../src/LocalHostAdapter'
import type { UnifiedProject } from '@bbs/animation-workspace-shared'

class DetailEvent extends Event {
  detail: unknown
  constructor(type: string, init?: { detail?: unknown }) { super(type); this.detail = init?.detail }
}

// A full-document save may only use the revision belonging to the scene delivered
// to the editor, even if a host command has already committed a newer revision.
test('external host commit cannot authorize replacement by the old editor scene', async () => {
  const originalFetch = globalThis.fetch
  const originalWindow = globalThis.window
  const originalCustomEvent = globalThis.CustomEvent
  const projectId = randomUUID()
  const project = { projectId, type: 'three-workspace-project', revision: 4,
    scene: { type: 'biz/scene3d-director-document', content: { nodes: [] } }, extensions: { topview: { fcurves: null } } } as unknown as UnifiedProject
  const commands: Array<{ expectedRevision: number }> = []
  globalThis.window = new EventTarget() as unknown as Window & typeof globalThis
  globalThis.CustomEvent = DetailEvent as unknown as typeof CustomEvent
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url) === '/api/unified/session') return Response.json({})
    if (String(url) === '/api/library') { project.revision = 5; return Response.json({ revision: 5 }) }
    if (String(url) === '/api/unified/commands') {
      commands.push(JSON.parse(String(init?.body)))
      return Response.json({ ok: true, revision: ++project.revision, result: {} })
    }
    return Response.json({ project: structuredClone(project), history: {} })
  }) as typeof fetch
  try {
    const adapter = new LocalHostAdapter('unified')
    const oldScene = await adapter.loadDocument(projectId)
    await adapter.addLibraryCharacter(projectId, 'new-character')
    await assert.rejects(adapter.saveDocumentState!(projectId, oldScene, null), /đã thay đổi sau khi mở/)
    assert.equal(commands.length, 0, 'stale scene must never reach document.replace')
    const freshScene = await adapter.loadDocument(projectId)
    await adapter.saveDocumentState!(projectId, freshScene, null)
    assert.equal(commands.length, 0, 'unchanged saves do not create history entries')
    const changedScene = structuredClone(freshScene)
    changedScene.content.nodes.push({ id: 'new' } as never)
    await adapter.saveDocumentState!(projectId, changedScene, null)
    await adapter.saveDocumentState!(projectId, changedScene, null)
    assert.deepEqual(commands.map(command => command.expectedRevision), [5])

    let releaseRead!: (value: Response) => void
    let startedRead!: () => void
    const started = new Promise<void>(resolve => { startedRead = resolve })
    globalThis.fetch = (async () => {
      startedRead()
      return new Promise<Response>(resolve => { releaseRead = resolve })
    }) as typeof fetch
    const oldLoad = adapter.loadDocument(projectId)
    const rejectedOldLoad = assert.rejects(oldLoad, /đã thay đổi trong khi tải/)
    await started
    const newerProject = structuredClone(project)
    newerProject.revision = 8
    let loadedScene: unknown
    await adapter.withProjectSnapshot(newerProject, async () => { loadedScene = await adapter.loadDocument(projectId) })
    releaseRead(Response.json({ project: structuredClone(project), history: {} }))
    await rejectedOldLoad
    assert.deepEqual(loadedScene, newerProject.scene)

  } finally {
    globalThis.fetch = originalFetch
    globalThis.window = originalWindow
    globalThis.CustomEvent = originalCustomEvent
  }
})

test('a failed checkpoint retries the identical request before newer edits', async () => {
  const originalFetch = globalThis.fetch
  const originalWindow = globalThis.window
  const originalCustomEvent = globalThis.CustomEvent
  const projectId = randomUUID()
  const project = { projectId, type: 'three-workspace-project', revision: 1,
    scene: { type: 'biz/scene3d-director-document', content: { nodes: [] } }, extensions: { topview: { fcurves: null } } } as unknown as UnifiedProject
  const commands: Array<{ requestId: string; expectedRevision: number; args: unknown }> = []
  globalThis.window = new EventTarget() as unknown as Window & typeof globalThis
  globalThis.CustomEvent = DetailEvent as unknown as typeof CustomEvent
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url) === '/api/unified/commands') {
      commands.push(JSON.parse(String(init?.body)))
      if (commands.length === 1 || commands.length === 3) throw new TypeError('connection lost')
      return Response.json({ ok: true, revision: commands.at(-1)!.expectedRevision + 1, result: {} })
    }
    if (String(url) === '/api/unified/session') return Response.json({})
    return Response.json({ project: structuredClone(project), history: {} })
  }) as typeof fetch
  try {
    const adapter = new LocalHostAdapter('unified')
    const scene = await adapter.loadDocument(projectId)
    scene.content.nodes.push({ id: 'one' } as never)
    await assert.rejects(adapter.saveDocumentState!(projectId, scene, null), /connection lost/)
    const newer = structuredClone(scene)
    newer.content.nodes.push({ id: 'two' } as never)
    await assert.rejects(adapter.saveDocumentState!(projectId, newer, null), /previous scene save/)
    await adapter.saveDocumentState!(projectId, scene, null)
    assert.deepEqual(commands[1], commands[0])
    await assert.rejects(adapter.saveDocumentState!(projectId, newer, null), /connection lost/)
    project.revision = 3
    await adapter.loadDocument(projectId)
    await assert.rejects(adapter.saveDocumentState!(projectId, newer, null), /revision changed while a scene save was pending/)
    adapter.confirmHostReload(projectId)
    await adapter.saveDocumentState!(projectId, newer, null)
    assert.notEqual(commands[3]!.requestId, commands[2]!.requestId)
    adapter.invalidateLoadedRevision(projectId)
    await assert.rejects(adapter.saveDocumentState!(projectId, newer, null), /revision is unavailable/)
  } finally {
    globalThis.fetch = originalFetch
    globalThis.window = originalWindow
    globalThis.CustomEvent = originalCustomEvent
  }
})

test('a 409 without a commit event reports failure and retains the rejected request', async () => {
  const originalFetch = globalThis.fetch
  const originalWindow = globalThis.window
  const originalCustomEvent = globalThis.CustomEvent
  const projectId = randomUUID()
  const project = { projectId, type: 'three-workspace-project', revision: 1,
    scene: { type: 'biz/scene3d-director-document', content: { nodes: [] } }, extensions: { topview: { fcurves: null } } } as unknown as UnifiedProject
  const commands: Array<{ requestId: string }> = []
  const events: string[] = []
  globalThis.window = new EventTarget() as unknown as Window & typeof globalThis
  globalThis.CustomEvent = DetailEvent as unknown as typeof CustomEvent
  window.addEventListener('bbs-unified-project-save-failed', () => events.push('failed'))
  window.addEventListener('bbs-unified-project-commit', () => events.push('commit'))
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url) === '/api/unified/commands') {
      commands.push(JSON.parse(String(init?.body)))
      return Response.json({ error: { code: 'REVISION_CONFLICT', message: 'Revision conflict' } }, { status: 409 })
    }
    if (String(url) === '/api/unified/session') return Response.json({})
    return Response.json({ project: structuredClone(project), history: {} })
  }) as typeof fetch
  try {
    const adapter = new LocalHostAdapter('unified')
    const scene = await adapter.loadDocument(projectId)
    scene.content.nodes.push({ id: 'local' } as never)
    await assert.rejects(adapter.saveDocumentState!(projectId, scene, null), /Revision conflict/)
    await assert.rejects(adapter.saveDocumentState!(projectId, scene, null), /Revision conflict/)
    assert.deepEqual(events, ['failed', 'failed'])
    assert.equal(commands[0]!.requestId, commands[1]!.requestId)
  } finally {
    globalThis.fetch = originalFetch
    globalThis.window = originalWindow
    globalThis.CustomEvent = originalCustomEvent
  }
})
