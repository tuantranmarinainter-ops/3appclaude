import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { strToU8, zipSync } from 'three/addons/libs/fflate.module.js'

// B27: "Xuất và cài vào game" plans the install from the finished export job, without re-uploading the ZIP.
test('plan-job previews a succeeded film job ZIP into the chosen world and apply installs it', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'bbs-install-job-'))
  const previous = process.env.BBS_UNIFIED_PROJECTS_DIR
  process.env.BBS_UNIFIED_PROJECTS_DIR = path.join(root, 'projects')
  try {
    const game = path.join(root, 'game'), world = path.join(game, 'saves', 'Thế giới mới (1)')
    await mkdir(world, { recursive: true }); await writeFile(path.join(world, 'level.dat'), 'level')
    const projectId = randomUUID(), jobId = randomUUID(), base = path.join(root, 'projects', projectId, '.jobs', jobId)
    const bytes = Buffer.from(zipSync({ 'films/Tap15-Shot01.dat': strToU8('film'), 'assets/models/unified/a/model.bobj': strToU8('model') }))
    await mkdir(path.join(base, 'files'), { recursive: true }); await writeFile(path.join(base, 'files', 'Tap15-Shot01.zip'), bytes)
    const file = { id: '0', name: 'Tap15-Shot01.zip', mimeType: 'application/zip', sizeBytes: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex'), path: 'files/Tap15-Shot01.zip' }
    await writeFile(path.join(base, 'job.json'), JSON.stringify({ jobId, projectId, type: 'film.export', state: 'succeeded', progress: 1, sourceRevision: 1, result: { files: [file] } }))

    const { POST } = await import('../app/api/unified/bbs-install/plan-job/route')
    const { POST: APPLY } = await import('../app/api/unified/bbs-install/apply/route')
    const { issueLocalSession } = await import('../src/unifiedSession')
    const cookie = issueLocalSession(new Request('http://localhost/api/unified/session')).headers.get('Set-Cookie')!.split(';')[0]!
    const post = (handler: (request: Request) => Promise<Response>, body: unknown) => handler(new Request('http://localhost/x', { method: 'POST', headers: { cookie, origin: 'http://localhost', 'Content-Type': 'application/json' }, body: JSON.stringify(body) }))

    const planned = await post(POST, { projectId, jobId, gameDir: game, worldName: 'Thế giới mới (1)' })
    assert.equal(planned.status, 200)
    const { plan } = await planned.json()
    assert.equal(plan.packageName, 'Tap15-Shot01.zip')
    assert.deepEqual(plan.files.map((item: { target: string }) => item.target).sort(), ['config/bbs/assets/models/unified/a/model.bobj', 'saves/Thế giới mới (1)/bbs/films/Tap15-Shot01.dat'])
    assert.equal((await post(APPLY, { planId: plan.planId })).status, 200)
    assert.equal(await readFile(path.join(world, 'bbs', 'films', 'Tap15-Shot01.dat'), 'utf8'), 'film')

    assert.equal((await post(POST, { projectId, jobId: randomUUID(), gameDir: game, worldName: 'Thế giới mới (1)' })).status, 404)
    assert.equal((await post(POST, { projectId, jobId })).status, 400)
    assert.equal((await POST(new Request('http://localhost/x', { method: 'POST', headers: { origin: 'http://localhost' }, body: '{}' }))).status, 401)
  } finally {
    if (previous === undefined) delete process.env.BBS_UNIFIED_PROJECTS_DIR; else process.env.BBS_UNIFIED_PROJECTS_DIR = previous
    await rm(root, { recursive: true, force: true })
  }
})
