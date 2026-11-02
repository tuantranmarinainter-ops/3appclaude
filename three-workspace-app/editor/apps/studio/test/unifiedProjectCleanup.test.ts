import assert from 'node:assert/strict'
import test from 'node:test'
import type { UnifiedProject } from '@bbs/animation-workspace-shared'
import { cleanupUnusedProjectResources } from '../src/unifiedProjectCleanup'
import { immutableAssetResponse } from '../src/immutableAssetResponse'

test('immutable asset response uses representation hashes, weak/list/wildcard matching and empty 304 bodies', async () => {
  const request = (value?: string) => new Request('http://localhost/asset', { headers: value ? { 'If-None-Match': value } : {} })
  const source = immutableAssetResponse(request(), Buffer.from('source'), 'model/gltf-binary')
  assert.equal(source.status, 200)
  assert.equal(source.headers.get('cache-control'), 'private, max-age=31536000, immutable')
  assert.equal(source.headers.get('content-length'), '6')
  const etag = source.headers.get('etag')!
  for (const condition of [etag, `W/${etag}`, `"other,tag", W/${etag}`, '*']) {
    const response = immutableAssetResponse(request(condition), Buffer.from('source'), 'model/gltf-binary')
    assert.equal(response.status, 304)
    assert.equal(await response.text(), '')
    assert.equal(response.headers.get('etag'), etag)
    assert.equal(response.headers.get('content-length'), null)
  }
  assert.equal(immutableAssetResponse(request(etag), Buffer.from('derivative'), 'model/gltf-binary').status, 200)
  assert.equal(immutableAssetResponse(request('"wrong"'), Buffer.from('source'), 'model/gltf-binary').status, 200)
})

test('cleanup traces clips, edits, characters, props, audio, dependencies and conversion inputs transitively', () => {
  const project = {
    assets: Object.fromEntries(['model', 'prop', 'audio', 'dependency', 'clipAsset', 'parentAsset', 'conversionAsset', 'orphanAsset'].map(id => [id, { id, dependencies: id === 'prop' ? ['dependency'] : [] }])),
    motions: { clip: { id: 'clip', assetId: 'clipAsset', derivedFrom: 'parent' }, parent: { id: 'parent', assetId: 'parentAsset' }, conversionSource: { id: 'conversionSource', assetId: 'conversionAsset' }, orphan: { id: 'orphan', assetId: 'orphanAsset' } },
    scene: { content: { asset: { motionPath: [{ id: 'clip', path: '/assets/clipAsset/source' }, { id: 'orphan', path: '/assets/orphanAsset/source' }] }, nodes: [{ metadata: { modelUrl: '/api/unified/projects/id/assets/prop/source' } }], timeline: { animation: { motionClips: [{ libraryId: 'clip' }] } } } },
    characters: { character: { assetId: 'model' } },
    extensions: { audioCues: { cues: [{ assetId: 'audio' }] }, libraryMotionConversions: { used: { motionId: 'clip', sourceMotionId: 'conversionSource' }, unused: { motionId: 'orphan', sourceMotionId: 'conversionSource' } }, retargetMotionMetadata: { clip: { sourceMotionId: 'parent' }, orphan: {} } },
  } as unknown as UnifiedProject
  const original = structuredClone(project)
  assert.deepEqual(cleanupUnusedProjectResources(project), { removedMotionIds: ['orphan'], removedAssetIds: ['orphanAsset'], removedConversionKeys: ['unused'] })
  assert.deepEqual(Object.keys(project.motions).sort(), ['clip', 'conversionSource', 'parent'])
  assert.deepEqual(project.scene.content.asset.motionPath.map((entry) => entry.id), ['clip'])
  assert.ok(original.motions.orphan, 'history snapshot stays intact')
  assert.deepEqual(cleanupUnusedProjectResources(project), { removedMotionIds: [], removedAssetIds: [], removedConversionKeys: [] })
})
