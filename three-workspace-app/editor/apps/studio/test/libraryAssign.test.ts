import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { MIXAMO65_BONE_PARENTS } from '../../../packages/retarget/src/mixamo65'
import { createCharacter, registerBaseModel } from '../../../packages/library/characters'
import { importPack, listCharacterActions } from '../../../packages/library/library'
import { GET, POST } from '../app/api/library/assign/route'

function makeGlb(): Buffer {
  const indices = new Map(MIXAMO65_BONE_PARENTS.map(([name], index) => [name, index]))
  const nodes: Array<{ name: string; children: number[]; mesh?: number; translation?: number[] }> = MIXAMO65_BONE_PARENTS.map(([name, parent]) => ({ name, ...(parent ? {} : { translation: [0, 1, 0] }), children: [] }))
  for (const [name, parent] of MIXAMO65_BONE_PARENTS) if (parent) nodes[indices.get(parent)!]!.children.push(indices.get(name)!)
  nodes.push({ name: 'Body', mesh: 0, children: [] })
  const json = Buffer.from(JSON.stringify({ asset: { version: '2.0' }, nodes, meshes: [{ name: 'Body', primitives: [{ attributes: {} }] }], skins: [{ joints: nodes.slice(0, 65).map((_, index) => index) }], animations: [] }))
  const padded = Buffer.concat([json, Buffer.alloc((4 - json.length % 4) % 4, 0x20)]), header = Buffer.alloc(20)
  header.write('glTF', 0, 'ascii'); header.writeUInt32LE(2, 4); header.writeUInt32LE(20 + padded.length, 8)
  header.writeUInt32LE(padded.length, 12); header.writeUInt32LE(0x4e4f534a, 16)
  return Buffer.concat([header, padded])
}

test('library assign API returns a job, progress, and per-action result', async (t) => {
  const workspace = mkdtempSync(join(tmpdir(), 'library-assign-api-'))
  const previous = process.env.W01_LIBRARY
  t.after(() => { process.env.W01_LIBRARY = previous; rmSync(workspace, { recursive: true, force: true }) })
  const root = join(workspace, 'library'); process.env.W01_LIBRARY = root
  const bytes = makeGlb(), model = join(workspace, 'character.glb'); writeFileSync(model, bytes)
  const base = registerBaseModel({ name: 'API synthetic Mixamo', rig: 'mixamo65', modelFile: model })
  const character = createCharacter({ charId: 'api-mixamo', name: 'API Mixamo', baseModelId: base.modelId })
  const source = join(workspace, 'source'); mkdirSync(source)
  const actionUuid = randomUUID(), digest = createHash('sha256').update(bytes).digest('hex')
  writeFileSync(join(source, 'source.glb'), bytes)
  writeFileSync(join(source, 'source.manifest.json'), JSON.stringify({ version: '1.0.0', rig: 'mixamo65', glbSha256: digest, actions: [{ uuid: actionUuid, name: 'Walk', durationSeconds: 1, fps: 30, glbAnimationIndex: 0 }] }))
  writeFileSync(join(source, 'source.report.json'), JSON.stringify({ status: 'PASS' }))
  importPack({ root, sourceDirectory: source })

  const posted = await POST(new Request('http://localhost/api/library/assign', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ actionUuids: [actionUuid], charId: character.charId }) }))
  assert.equal(posted.status, 202)
  const { job: initial } = await posted.json() as { job: { jobId: string; status: string; completed: number; total: number } }
  assert.equal(initial.total, 1)
  let job: { jobId: string; status: string; completed: number; total: number; results: Array<{ status: string; assignedUuid?: string }> }
  do {
    await new Promise(resolve => setTimeout(resolve, 10))
    const response = await GET(new Request(`http://localhost/api/library/assign?jobId=${initial.jobId}`))
    assert.equal(response.status, 200)
    job = (await response.json() as { job: typeof job }).job
  } while (job!.status === 'queued' || job!.status === 'running')
  assert.equal(job!.status, 'completed')
  assert.equal(job!.completed, 1)
  assert.equal(job!.results[0]?.status, 'ok')
  assert.equal(listCharacterActions({ root, charId: character.charId }).length, 1)
})
