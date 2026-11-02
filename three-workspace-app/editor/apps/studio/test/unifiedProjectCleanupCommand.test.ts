import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { makeEmptyDraft } from '@topview/3d-builder'
import { executeUnifiedCommand, readUnifiedProject } from '../src/unifiedProjectStore'
import { stageAssetUpload, resolveUnifiedAssetFile } from '../src/unifiedAssetFiles'
import { GET } from '../app/api/unified/projects/[id]/assets/[assetId]/[variant]/route'
import { issueLocalSession } from '../src/unifiedSession'

test('confirmed cleanup is undoable, retains historic blobs, and authenticated asset GET revalidates by hash', async () => {
  const temporary = await mkdtemp(path.join(tmpdir(), 'project-cleanup-'))
  const previous = process.env.BBS_UNIFIED_PROJECTS_DIR
  process.env.BBS_UNIFIED_PROJECTS_DIR = temporary
  try {
    const json = Buffer.from(JSON.stringify({ asset: { version: '2.0' }, nodes: [{ name: 'unused_prop' }] }))
    const chunk = Buffer.concat([json, Buffer.alloc((4 - json.length % 4) % 4, 0x20)])
    const bytes = Buffer.alloc(20 + chunk.length)
    bytes.write('glTF'); bytes.writeUInt32LE(2, 4); bytes.writeUInt32LE(bytes.length, 8)
    bytes.writeUInt32LE(chunk.length, 12); bytes.writeUInt32LE(0x4e4f534a, 16); chunk.copy(bytes, 20)
    const created = await executeUnifiedCommand({ requestId: randomUUID(), command: 'project.create', args: { name: 'cleanup', scene: makeEmptyDraft('cleanup', 30, 90) } })
    const projectId = created.projectId
    const send = (expectedRevision: number, command: string, args: Record<string, unknown>) => executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision, command, args })
    const upload = await stageAssetUpload('unused.glb', new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close() } }))
    const imported = await send(created.revision, 'asset.import', { files: [upload.id], format: 'glb' })
    const before = await readUnifiedProject(projectId)
    const assetId = Object.keys(before.assets)[0]!
    const url = `http://localhost/api/unified/projects/${projectId}/assets/${encodeURIComponent(assetId)}/source`
    const session = issueLocalSession(new Request(url))
    const cookie = session.headers.get('set-cookie')!.split(';')[0]!
    const params = Promise.resolve({ id: projectId, assetId, variant: 'source' })
    const response = await GET(new Request(url, { headers: { cookie } }), { params })
    assert.equal(response.status, 200)
    const cached = await GET(new Request(url, { headers: { cookie, 'If-None-Match': `W/${response.headers.get('etag')}` } }), { params })
    assert.equal(cached.status, 304)
    assert.equal(await cached.text(), '')
    await assert.rejects(send(imported.revision, 'project.cleanup', {}), /confirmation/)
    const cleaned = await send(imported.revision, 'project.cleanup', { confirmed: true })
    assert.deepEqual(Object.keys((await readUnifiedProject(projectId)).assets), [])
    assert.deepEqual((await resolveUnifiedAssetFile(before, assetId, 'source')).bytes, bytes, 'old blobs remain readable by history snapshots')
    const undone = await send(cleaned.revision, 'history.undo', {})
    assert.ok((await readUnifiedProject(projectId)).assets[assetId as keyof typeof before.assets])
    await send(undone.revision, 'history.redo', {})
    assert.deepEqual(Object.keys((await readUnifiedProject(projectId)).assets), [])
  } finally {
    if (previous === undefined) delete process.env.BBS_UNIFIED_PROJECTS_DIR; else process.env.BBS_UNIFIED_PROJECTS_DIR = previous
    await rm(temporary, { recursive: true, force: true })
  }
})
