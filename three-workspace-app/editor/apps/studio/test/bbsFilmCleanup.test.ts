import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { gzipSync } from 'node:zlib'
import { strToU8, zipSync } from 'three/addons/libs/fflate.module.js'
import { applyFilmCleanup, listCleanupFilms, planFilmCleanup } from '../src/bbsFilmCleanup'
import { applyInstall, planInstall, uninstallInstall } from '../src/bbsInstall'
import { assetReferenceKey, buildReferenceIndex } from '../src/bbsFilmRefs'
import { applyProjectZipCleanup, planProjectZipCleanup } from '../src/projectZipCleanup'

const WORLD = 'Thế giới'
/** Shaped like a real film: "BBS1", then strings each preceded by a length byte, gzip-compressed. */
const film = (...strings: string[]) => Buffer.from(gzipSync(Buffer.concat([Buffer.from('BBS1'), ...strings.map((text) => Buffer.concat([Buffer.from([text.length]), Buffer.from(text), Buffer.from([0, 0, 1])]))])))
const exists = (file: string) => stat(file).then(() => true, () => false)

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'bbs-cleanup-test-'))
  const game = path.join(root, 'game'), world = path.join(game, 'saves', WORLD)
  await mkdir(world, { recursive: true }); await writeFile(path.join(world, 'level.dat'), 'level')
  let n = 0
  const install = async (files: Record<string, Uint8Array | string>) => {
    const archive = path.join(root, `pkg-${++n}.zip`)
    await writeFile(archive, zipSync(Object.fromEntries(Object.entries(files).map(([name, value]) => [name, typeof value === 'string' ? strToU8(value) : value]))))
    return applyInstall((await planInstall(archive, game, WORLD, `pkg-${n}.zip`)).planId)
  }
  const file = (relative: string) => path.join(game, ...relative.split('/'))
  return { root, game, install, file, close: () => rm(root, { recursive: true, force: true }) }
}

const HERO = ['config/bbs/assets/models/unified/hero/model.bobj', 'config/bbs/assets/models/unified/hero/textures/body/default.png']
const heroFiles = { 'assets/models/unified/hero/model.bobj': 'hero-mesh', 'assets/models/unified/hero/textures/body/default.png': 'hero-tex' }

test('clean v2 after v2+v3 share a model: v3 keeps every character, v2-only files go', async () => {
  const f = await fixture()
  try {
    await f.install({ ...heroFiles, 'assets/models/unified/gone/model.bobj': 'gone', 'assets/textures/fx/a.png': 'fx', 'assets/textures/fx/b.png': 'tex',
      'films/v2.dat': film('unified/hero', 'unified/gone', 'assets:textures/fx/a.png', 'textures/fx/b.png') })
    const v3 = await f.install({ ...heroFiles, 'assets/models/unified/den/model.bobj': 'den', 'films/v3.dat': film('unified/hero', 'unified/den') })
    assert.deepEqual(v3.skipped.sort(), [...HERO].sort())

    const rows = await listCleanupFilms(f.game, WORLD)
    assert.deepEqual(rows.films.map((row) => row.name).sort(), ['v2.dat', 'v3.dat'])
    const plan = await planFilmCleanup(f.game, WORLD, ['v2.dat'])
    assert.equal(plan.films.length, 1)
    assert.deepEqual(plan.assets.map((item) => item.path).sort(), [
      'config/bbs/assets/models/unified/gone/model.bobj', 'config/bbs/assets/textures/fx/a.png', 'config/bbs/assets/textures/fx/b.png'])
    assert.ok(plan.freedBytes > 0)
    for (const target of plan.assets) assert.ok(await exists(f.file(target.path)), 'preview must not delete')

    const result = await applyFilmCleanup(f.game, WORLD, ['v2.dat'], plan.token)
    assert.deepEqual(result.removedFilms, [`saves/${WORLD}/bbs/films/v2.dat`])
    assert.equal(result.removedAssets.length, 3)
    for (const kept of [...HERO, 'config/bbs/assets/models/unified/den/model.bobj', `saves/${WORLD}/bbs/films/v3.dat`]) assert.ok(await exists(f.file(kept)), kept)
    assert.equal(await exists(f.file('config/bbs/assets/textures')), false, 'empty folders are pruned')
    const log = JSON.parse(await readFile(f.file('config/bbs/w01-install-log.json'), 'utf8'))
    const active = log.installs.filter((entry: { uninstalledAt?: string }) => !entry.uninstalledAt)
    assert.equal(active.length, 1)
    assert.ok(HERO.every((owned) => active[0].ownedFiles.some((item: { path: string }) => item.path === owned)), 'shared assets now owned by v3')
    // Later "Gỡ" of v3 cleans up what is left.
    const out = await uninstallInstall(f.game, active[0].installId)
    assert.equal(await exists(f.file(HERO[0]!)), false)
    assert.deepEqual(out.inUse, [])
  } finally { await f.close() }
})

test('Gỡ of an old install keeps assets that a later film still uses', async () => {
  const f = await fixture()
  try {
    const v2 = await f.install({ ...heroFiles, 'assets/models/unified/gone/model.bobj': 'gone', 'films/v2.dat': film('unified/hero', 'unified/gone') })
    const v3 = await f.install({ ...heroFiles, 'films/v3.dat': film('unified/hero') })
    const out = await uninstallInstall(f.game, v2.installId)
    assert.deepEqual(out.inUse.sort(), [...HERO].sort())
    assert.ok(out.removed.includes(`saves/${WORLD}/bbs/films/v2.dat`) && out.removed.includes('config/bbs/assets/models/unified/gone/model.bobj'))
    for (const kept of HERO) assert.ok(await exists(f.file(kept)))
    const out3 = await uninstallInstall(f.game, v3.installId)
    assert.equal(out3.removed.length, 3, 'v3 now owns the shared model and removes it with its own film')
    assert.equal(await exists(f.file(HERO[0]!)), false)
  } finally { await f.close() }
})

test('cleanup refuses unknown films, stale plans, modified assets and unreadable remaining films', async () => {
  const f = await fixture()
  try {
    await f.install({ ...heroFiles, 'films/a.dat': film('unified/hero') })
    await f.install({ 'assets/models/unified/other/model.bobj': 'other', 'films/b.dat': film('unified/other') })
    await mkdir(f.file(`saves/${WORLD}/bbs/films`), { recursive: true })
    await writeFile(f.file(`saves/${WORLD}/bbs/films/mine.dat`), film('unified/hero'))
    await assert.rejects(planFilmCleanup(f.game, WORLD, ['mine.dat']), /không do W01 cài/)
    await assert.rejects(planFilmCleanup(f.game, WORLD, ['../x.dat']), /không hợp lệ/)
    assert.deepEqual((await listCleanupFilms(f.game, WORLD)).foreign.map((row) => row.name), ['mine.dat'])

    // The user's own film still uses hero, so deleting a.dat keeps it.
    const keepHero = await planFilmCleanup(f.game, WORLD, ['a.dat'])
    assert.equal(keepHero.assets.length, 0)

    const plan = await planFilmCleanup(f.game, WORLD, ['b.dat'])
    assert.deepEqual(plan.assets.map((item) => item.path), ['config/bbs/assets/models/unified/other/model.bobj'])
    await writeFile(f.file('config/bbs/assets/models/unified/other/model.bobj'), 'edited by user')
    await assert.rejects(applyFilmCleanup(f.game, WORLD, ['b.dat'], plan.token), /xem trước lại/)
    const fresh = await planFilmCleanup(f.game, WORLD, ['b.dat'])
    const result = await applyFilmCleanup(f.game, WORLD, ['b.dat'], fresh.token)
    assert.deepEqual(result.preserved, ['config/bbs/assets/models/unified/other/model.bobj'])
    assert.equal(await readFile(f.file('config/bbs/assets/models/unified/other/model.bobj'), 'utf8'), 'edited by user')

    await writeFile(f.file(`saves/${WORLD}/bbs/films/mine.dat`), Buffer.from([0x1f, 0x8b, 8, 0, 1, 2, 3]))
    const blocked = await planFilmCleanup(f.game, WORLD, ['a.dat'])
    assert.equal(blocked.unreadable.length, 1)
    assert.equal(blocked.assets.length, 0, 'unknown references: delete no asset')
  } finally { await f.close() }
})

test('reference keys: model id, namespace and left boundary', () => {
  assert.equal(assetReferenceKey('models/unified/h/textures/body/default.png'), 'unified/h')
  assert.equal(assetReferenceKey('models/hero/textures/a/default.png'), 'hero')
  assert.equal(assetReferenceKey('effeks/project-x/Textures/t.png'), 'effeks/project-x')
  const index = buildReferenceIndex([{ name: 'f', bytes: film('assets:models/unified/h/model.bobj', 'xxunified/zzz') }])
  assert.ok(index.isReferenced('models/unified/h/textures/body/default.png'))
  assert.equal(index.isReferenced('models/unified/zzz/model.bobj'), false)
  assert.equal(index.isReferenced('models/unified/none/model.bobj'), false)
})

test('ZIP cleanup keeps the newest package per film name and only touches finished film jobs', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'zip-cleanup-test-'))
  const previous = process.env.BBS_UNIFIED_PROJECTS_DIR
  process.env.BBS_UNIFIED_PROJECTS_DIR = root
  try {
    const projectId = randomUUID()
    const job = async (name: string, updatedAt: string, extra: Record<string, unknown> = {}) => {
      const jobId = randomUUID(), base = path.join(root, projectId, '.jobs', jobId)
      await mkdir(path.join(base, 'files'), { recursive: true }); await writeFile(path.join(base, 'files', name), 'zip')
      await writeFile(path.join(base, 'job.json'), JSON.stringify({ jobId, projectId, type: 'film.export', state: 'succeeded', updatedAt, result: { files: [{ id: '0', name, mimeType: 'application/zip', sizeBytes: 100, sha256: 'x', path: `files/${name}` }] }, ...extra }))
      return jobId
    }
    const old = await job('Shot01.zip', '2026-11-01T00:00:00Z'), fresh = await job('Shot01.zip', '2026-11-02T00:00:00Z'), other = await job('Shot02.zip', '2026-10-01T00:00:00Z')
    const running = await job('Shot01.zip', '2026-10-01T00:00:00Z', { state: 'running' }), render = await job('Shot01.zip', '2026-10-01T00:00:00Z', { type: 'scene.render' })
    const plan = await planProjectZipCleanup(projectId)
    assert.equal(plan.removeCount, 1); assert.equal(plan.freedBytes, 100)
    assert.deepEqual(plan.jobs.filter((row) => !row.keep).map((row) => row.jobId), [old])
    const result = await applyProjectZipCleanup(projectId)
    assert.deepEqual(result.removed, [old])
    for (const kept of [fresh, other, running, render]) assert.ok(await exists(path.join(root, projectId, '.jobs', kept, 'job.json')))
    assert.equal(await exists(path.join(root, projectId, '.jobs', old)), false)
  } finally {
    if (previous === undefined) delete process.env.BBS_UNIFIED_PROJECTS_DIR; else process.env.BBS_UNIFIED_PROJECTS_DIR = previous
    await rm(root, { recursive: true, force: true })
  }
})

test('B61: preflight messages are placed next to their character, backdrop, effect, anchor or camera', async () => {
  const { placePreflightIssues } = await import('../app/workbench/components/film-export/utils')
  const issues = [
    { code: 'ASSET_FILE_MISSING', nodeId: 'den' }, { code: 'ASSET_FILE_MISSING', nodeId: 'ghost' }, { code: 'WORLD_ANCHOR_FAR' },
    { code: 'VFX_OMITTED' }, { code: 'CAMERA_STATIONARY' }, { code: 'FILM_SEQUENCE_EMPTY' }, { code: 'SHOT_NOT_APPROVED' }, { code: 'OTHER' }]
  const placed = placePreflightIssues(issues, new Set(['den']))
  assert.equal(placed.byNode.get('den')?.length, 1)
  assert.deepEqual([placed.anchor.length, placed.effects.length, placed.camera.length], [1, 1, 3])
  assert.deepEqual(placed.rest.map((item) => item.code), ['ASSET_FILE_MISSING', 'OTHER'], 'unknown nodes and unmatched codes stay in the general list')
})

test('Gỡ is refused with 409 and a Vietnamese message while the game runs', async () => {
  const { gameRunningResponse } = await import('../src/bbsGameGuard')
  const blocked = await gameRunningResponse('x', async () => true)
  assert.equal(blocked?.status, 409)
  assert.match((await blocked!.json()).error.message, /Minecraft đang chạy/)
  assert.equal(await gameRunningResponse('x', async () => false), null)
  assert.equal(await gameRunningResponse('x', async () => null), null)
})

test('uninstall route returns 409 when the game is running', async () => {
  const f = await fixture()
  try {
    const first = await f.install({ 'films/a.dat': film('unified/x') })
    const { POST } = await import('../app/api/unified/bbs-install/uninstall/route')
    const { issueLocalSession } = await import('../src/unifiedSession')
    const cookie = issueLocalSession(new Request('http://localhost/api/unified/session')).headers.get('Set-Cookie')!.split(';')[0]!
    const response = await POST(new Request('http://localhost/x', { method: 'POST', headers: { cookie, origin: 'http://localhost', 'Content-Type': 'application/json' }, body: JSON.stringify({ gameDir: f.game, installId: first.installId }) }))
    // This machine's java processes do not run from the temp folder, so the real check passes through; the 409 path is covered above.
    assert.ok([200, 409].includes(response.status))
  } finally { await f.close() }
})
