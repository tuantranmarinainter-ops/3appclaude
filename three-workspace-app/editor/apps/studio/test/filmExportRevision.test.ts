import assert from 'node:assert/strict'
import test from 'node:test'
import type { UnifiedProject } from '@bbs/animation-workspace-shared'
import { filmExportContentKey, prepareFilmExportRevision } from '../app/workbench/components/film-export/utils.ts'
const project = () => ({ projectId: 'p', revision: 1, name: 'Draft', scene: { content: { nodes: [{ camera: { fov: 60 } }] } }, characters: {}, assets: {}, motions: {}, bindings: {}, extensions: {}, skeletons: {}, mappings: {} } as unknown as UnifiedProject)
function setup() {
  const fresh = project()
  const checked: number[] = []
  const options = { contentKey: filmExportContentKey(fresh), selectionUnchanged: () => true, load: async () => fresh,
    preflight: async (revision: number): Promise<{ revision: number; sourceRevision: unknown; errors: unknown[] }> => { checked.push(revision); return { revision, sourceRevision: revision, errors: [] } },
    changedMessage: 'content changed', failedMessage: 'preflight failed' }
  return { fresh, checked, options }
}
test('bookkeeping changes use fresh revision and fresh preflight', async () => {
  const { fresh, checked, options } = setup()
  fresh.revision = 9; fresh.name = 'Renamed'
  assert.equal(await prepareFilmExportRevision(options), 9)
  assert.deepEqual(checked, [9])
})
test('camera content changes stop export before preflight', async () => {
  const { fresh, checked, options } = setup()
  fresh.scene.content.nodes[0]!.camera!.fov = 80
  await assert.rejects(prepareFilmExportRevision(options), /content changed/)
  assert.deepEqual(checked, [])
})
test('source frame aspect changes stop export because they change camera projection', async () => {
  const { fresh, options } = setup()
  fresh.scene.content.aspectRatio = '9:16'
  await assert.rejects(prepareFilmExportRevision(options), /content changed/)
})
test('selection changing during preflight stops export', async () => {
  const { options } = setup()
  let unchanged = true
  options.selectionUnchanged = () => unchanged
  options.preflight = async (revision) => { unchanged = false; return { revision, sourceRevision: revision, errors: [] } }
  await assert.rejects(prepareFilmExportRevision(options), /content changed/)
})
test('failed or mismatched preflight cannot authorize export', async () => {
  for (const result of [{ revision: 2, sourceRevision: 1, errors: [] }, { revision: 1, sourceRevision: 0, errors: [] }, { revision: 1, sourceRevision: 1, errors: ['blocked'] }]) {
    const { options } = setup()
    options.preflight = async () => result
    await assert.rejects(prepareFilmExportRevision(options), /preflight failed/)
  }
})
test('record insertion order is stable', () => {
  const a = project(), b = project()
  a.extensions = { topview: { fcurves: { a: 1, b: 2 } } }; b.extensions = { topview: { fcurves: { b: 2, a: 1 } } }
  assert.equal(filmExportContentKey(a), filmExportContentKey(b))
})

test('viewport and selection preferences do not cancel a pending export', async () => {
  const { fresh, options } = setup()
  fresh.scene.content.activeShotCameraNodeId = 'preview-only'
  fresh.scene.content.environment = { display: { groundVisible: false } } as UnifiedProject['scene']['content']['environment']
  fresh.extensions.workbench = { selectedNodeId: 'other' }
  fresh.extensions.topview = { viewMode: 'free' }
  assert.equal(await prepareFilmExportRevision(options), 1)
})
