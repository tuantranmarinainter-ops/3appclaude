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
    await adapter.saveDocumentState!(projectId, freshScene, null)
    assert.deepEqual(commands.map(command => command.expectedRevision), [5, 6])

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
