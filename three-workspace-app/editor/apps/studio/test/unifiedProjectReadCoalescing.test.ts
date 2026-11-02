import assert from 'node:assert/strict'
import test from 'node:test'
import type { UnifiedProject } from '@bbs/animation-workspace-shared'
import { invalidateUnifiedProjectReads, loadUnifiedProject, sendUnifiedCommand } from '../src/unifiedApi'
import { LocalHostAdapter } from '../src/LocalHostAdapter'

function state(projectId: string, revision = 1) {
  return { project: { projectId, revision, type: 'three-workspace-project', scene: {
    type: 'biz/scene3d-director-document', content: { nodes: [{ id: 'camera', name: `revision-${revision}` }] },
  }, extensions: { topview: { fcurves: { revision } } } } as unknown as UnifiedProject,
  history: { canUndo: true, canRedo: false } }
}
const response = (value: unknown) => new Response(JSON.stringify(value), { status: 200 })
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

// Shared fetch/session module state makes these intentionally sequential.
test('overlapping readers share one request, own their snapshot, and later reads fetch fresh data', async () => {
  const original = globalThis.fetch
  const gate = deferred<Response>()
  let gets = 0
  globalThis.fetch = async (url) => {
    if (String(url).includes('/session')) return response({})
    gets++
    return gets === 1 ? gate.promise : response(state('coalesce', gets))
  }
  try {
    const first = loadUnifiedProject('coalesce')
    const second = loadUnifiedProject('coalesce')
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(gets, 1)
    gate.resolve(response(state('coalesce')))
    const [a, b] = await Promise.all([first, second])
    assert.notEqual(a, b)
    a.project.scene.content.nodes[0]!.name = 'edited locally'
    assert.equal(b.project.scene.content.nodes[0]!.name, 'revision-1')
    assert.equal((await loadUnifiedProject('coalesce')).project.revision, 2)
    assert.equal(gets, 2)
  } finally { globalThis.fetch = original }
})

test('project IDs remain isolated and failed reads do not poison the next request', async () => {
  const original = globalThis.fetch
  let failed = false
  globalThis.fetch = async (url) => {
    const id = String(url).split('/').pop()!
    if (id === 'retry' && !failed) { failed = true; return new Response('', { status: 503 }) }
    return response(state(id, id === 'two' ? 2 : 1))
  }
  try {
    const [one, two] = await Promise.all([loadUnifiedProject('one'), loadUnifiedProject('two')])
    assert.equal(one.project.projectId, 'one')
    assert.equal(two.project.revision, 2)
    await assert.rejects(loadUnifiedProject('retry'), /503/)
    assert.equal((await loadUnifiedProject('retry')).project.projectId, 'retry')
  } finally { globalThis.fetch = original }
})

test('a pre-mutation read resolving last retries instead of publishing an older revision', async () => {
  const original = globalThis.fetch
  const old = deferred<Response>()
  let gets = 0
  globalThis.fetch = async (url) => {
    if (String(url).includes('/commands')) return response({ ok: true, revision: 2, result: {} })
    gets++
    return gets === 1 ? old.promise : response(state('racing', 2))
  }
  try {
    const before = loadUnifiedProject('racing')
    await new Promise((resolve) => setImmediate(resolve))
    await sendUnifiedCommand({ projectId: 'racing', expectedRevision: 1, requestId: 'race', command: 'history.undo', args: {} })
    const after = await loadUnifiedProject('racing')
    old.resolve(response(state('racing', 1)))
    assert.equal(after.project.revision, 2)
    assert.equal((await before).project.revision, 2)
  } finally { globalThis.fetch = original }
})

test('revision collision invalidates in-flight reads and permits a fresh retry', async () => {
  const original = globalThis.fetch
  globalThis.fetch = async (url) => String(url).includes('/commands')
    ? new Response(JSON.stringify({ error: { code: 'REVISION_CONFLICT', message: 'Reload revision 3' } }), { status: 409 })
    : response(state('collision', 3))
  try {
    await assert.rejects(sendUnifiedCommand({ projectId: 'collision', expectedRevision: 1, requestId: 'collision', command: 'history.undo', args: {} }), /Reload revision 3/)
    assert.equal((await loadUnifiedProject('collision')).project.revision, 3)
  } finally { globalThis.fetch = original }
})

test('adapter consumes one exact committed snapshot and shares its curves without mutating the owner', async () => {
  const original = globalThis.fetch
  let gets = 0
  globalThis.fetch = async (url) => { gets++; return response(state(String(url).split('/').pop()!, 8)) }
  const adapter = new LocalHostAdapter('unified')
  const committed = state('handoff', 7)
  try {
    await adapter.withProjectSnapshot(committed.project, async () => {
      const doc = await adapter.loadDocument('handoff')
      doc.content.nodes[0]!.name = 'local edit'
      assert.deepEqual(await adapter.loadFCurves('handoff'), { revision: 7 })
    })
    assert.equal(gets, 0)
    assert.equal(committed.project.scene.content.nodes[0]!.name, 'revision-7')
    assert.equal((await adapter.loadDocument('handoff')).content.nodes[0]!.name, 'revision-8')
    assert.equal(gets, 1)
    // A discarded/deferred reload must not leak its snapshot into a later open.
    await adapter.withProjectSnapshot(state('other', 4).project, async () => {})
    await adapter.loadDocument('other')
    assert.equal(gets, 2)
    // An older handoff cannot roll the adapter's optimistic revision backwards.
    await adapter.withProjectSnapshot(state('handoff', 6).project, async () => {
      assert.equal((await adapter.loadDocument('handoff')).content.nodes[0]!.name, 'revision-8')
    })
    assert.equal(gets, 3)
  } finally { globalThis.fetch = original }
})


test('a commit from a direct host write invalidates earlier reads before they fetch', async () => {
  const original = globalThis.fetch
  let gets = 0
  globalThis.fetch = async () => { gets++; return response(state('direct-host', 9)) }
  try {
    const oldReader = loadUnifiedProject('direct-host')
    invalidateUnifiedProjectReads('direct-host')
    const committedReader = loadUnifiedProject('direct-host')
    assert.equal((await oldReader).project.revision, 9)
    assert.equal((await committedReader).project.revision, 9)
    assert.equal(gets, 1)
  } finally { globalThis.fetch = original }
})
