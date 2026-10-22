import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile, symlink, lstat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { strToU8, zipSync } from 'three/addons/libs/fflate.module.js'
import { applyInstall, listInstallWorlds, planInstall, uninstallInstall } from '../src/bbsInstall'

type ZipInput = Record<string, string>

async function fixture(files: ZipInput): Promise<{ root: string; game: string; archive: string }> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'bbs-install-test-'))
  const game = path.join(root, 'game'), world = path.join(game, 'saves', 'World Ω')
  await mkdir(world, { recursive: true }); await writeFile(path.join(world, 'level.dat'), 'level')
  const archive = path.join(root, 'episode.zip')
  await writeFile(archive, zipSync(Object.fromEntries(Object.entries(files).map(([name, value]) => [name, strToU8(value)]))))
  return { root, game, archive }
}

async function close(root: string) { await rm(root, { recursive: true, force: true }) }

test('plans, explicitly applies, skips identical content, and uninstalls logged files', async () => {
  const f = await fixture({ 'assets/characters/hero.png': 'asset', 'films/episode-01.dat': 'film', 'README.txt': 'ignored' })
  try {
    const worlds = await listInstallWorlds(f.game)
    assert.deepEqual(worlds.map((world) => world.name), ['World Ω'])
    const plan = await planInstall(f.archive, f.game, 'World Ω', 'Tập 01.zip')
    assert.equal(plan.packageName, 'Tập 01.zip')
    assert.deepEqual(plan.files.map((file) => file.target).sort(), [
      'config/bbs/assets/characters/hero.png', 'saves/World Ω/bbs/films/episode-01.dat',
    ])
    assert.ok(plan.files.every((file) => file.status === 'install'))
    assert.equal(await lstat(path.join(f.game, 'config')).then(() => true, () => false), false)

    const applied = await applyInstall(plan.planId)
    assert.equal(applied.installed.length, 2)
    assert.equal(await readFile(path.join(f.game, 'config/bbs/assets/characters/hero.png'), 'utf8'), 'asset')
    const second = await planInstall(f.archive, f.game, 'World Ω')
    assert.ok(second.files.every((file) => file.status === 'skip'))
    const appliedAgain = await applyInstall(second.planId)
    assert.equal(appliedAgain.skipped.length, 2)
    assert.equal(appliedAgain.installed.length, 0)
    const log = JSON.parse(await readFile(path.join(f.game, 'config/bbs/w01-install-log.json'), 'utf8'))
    assert.equal(log.installs[0].packageName, 'Tập 01.zip')
    const result = await uninstallInstall(f.game, applied.installId)
    assert.equal(result.removed.length, 2)
    assert.deepEqual(result.preserved, [])
    await assert.rejects(readFile(path.join(f.game, 'config/bbs/assets/characters/hero.png')))
  } finally { await close(f.root) }
})

test('different existing files are conflicts and never overwritten', async () => {
  const f = await fixture({ 'assets/same.txt': 'package', 'films/one.dat': 'new film' })
  try {
    const target = path.join(f.game, 'config/bbs/assets/same.txt')
    await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, 'user file')
    const plan = await planInstall(f.archive, f.game, 'World Ω')
    assert.equal(plan.files.find((file) => file.source === 'assets/same.txt')?.status, 'conflict')
    const result = await applyInstall(plan.planId)
    assert.deepEqual(result.conflicts, ['config/bbs/assets/same.txt'])
    assert.equal(await readFile(target, 'utf8'), 'user file')
    assert.equal(await readFile(path.join(f.game, 'saves/World Ω/bbs/films/one.dat'), 'utf8'), 'new film')
  } finally { await close(f.root) }
})

test('apply rechecks targets created or changed after preview and keeps them', async () => {
  const f = await fixture({ 'assets/race.bin': 'package bytes' })
  try {
    const plan = await planInstall(f.archive, f.game, 'World Ω')
    const target = path.join(f.game, 'config/bbs/assets/race.bin')
    await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, 'created after preview')
    const result = await applyInstall(plan.planId)
    assert.deepEqual(result.conflicts, ['config/bbs/assets/race.bin'])
    assert.equal(await readFile(target, 'utf8'), 'created after preview')
  } finally { await close(f.root) }
})

test('claims each preview once and serializes concurrent writes to one game log', async () => {
  const f = await fixture({ 'assets/first.bin': 'first' })
  try {
    const secondArchive = path.join(f.root, 'second.zip')
    await writeFile(secondArchive, zipSync({ 'assets/second.bin': strToU8('second') }))
    const first = await planInstall(f.archive, f.game, 'World Ω')
    const second = await planInstall(secondArchive, f.game, 'World Ω')
    const results = await Promise.all([applyInstall(first.planId), applyInstall(second.planId)])
    assert.equal(results.length, 2)
    const logPath = path.join(f.game, 'config/bbs/w01-install-log.json')
    const log = JSON.parse(await readFile(logPath, 'utf8'))
    assert.equal(log.installs.length, 2)
    assert.equal(log.installs.flatMap((entry: { ownedFiles: unknown[] }) => entry.ownedFiles).length, 2)

    const thirdArchive = path.join(f.root, 'third.zip')
    await writeFile(thirdArchive, zipSync({ 'assets/third.bin': strToU8('third') }))
    const duplicatePlan = await planInstall(thirdArchive, f.game, 'World Ω')
    const duplicateResults = await Promise.allSettled([applyInstall(duplicatePlan.planId), applyInstall(duplicatePlan.planId)])
    assert.equal(duplicateResults.filter((item) => item.status === 'fulfilled').length, 1)
    assert.equal(duplicateResults.filter((item) => item.status === 'rejected').length, 1)
    const finalLog = JSON.parse(await readFile(logPath, 'utf8'))
    assert.equal(finalLog.installs.length, 3)
  } finally { await close(f.root) }
})

test('uninstall preserves changed files and removes only unchanged owned files', async () => {
  const f = await fixture({ 'assets/changed.bin': 'original', 'films/unchanged.dat': 'original film' })
  try {
    const installed = await applyInstall((await planInstall(f.archive, f.game, 'World Ω')).planId)
    const changed = path.join(f.game, 'config/bbs/assets/changed.bin')
    await writeFile(changed, 'user edit')
    const result = await uninstallInstall(f.game, installed.installId)
    assert.deepEqual(result.removed, ['saves/World Ω/bbs/films/unchanged.dat'])
    assert.deepEqual(result.preserved, ['config/bbs/assets/changed.bin'])
    assert.equal(await readFile(changed, 'utf8'), 'user edit')
  } finally { await close(f.root) }
})

test('rejects ZIP slip, backslash, ADS, case-fold collisions, and symlinks', async () => {
  const f = await fixture({ 'assets/ok.bin': 'safe' })
  try {
    const malicious = [
      { 'assets/../../outside.dat': 'escape' },
      { 'assets\\..\\outside.dat': 'escape' },
      { 'assets/file:stream': 'ads' },
      { 'assets/Name.txt': 'one', 'assets/name.txt': 'two' },
    ]
    for (const files of malicious) {
      const archive = path.join(f.root, `bad-${Math.random()}.zip`)
      await writeFile(archive, zipSync(Object.fromEntries(Object.entries(files).map(([name, value]) => [name, strToU8(value)]))))
      await assert.rejects(planInstall(archive, f.game, 'World Ω'))
    }
    const symlinkArchive = path.join(f.root, 'symlink.zip')
    const python = process.env.BBS_PYTHON?.trim() || (process.platform === 'win32' ? 'python' : 'python3')
    const made = spawnSync(python, ['-c', "import stat,sys,zipfile; z=zipfile.ZipFile(sys.argv[1],'w'); i=zipfile.ZipInfo('assets/link'); i.create_system=3; i.external_attr=(stat.S_IFLNK|0o777)<<16; z.writestr(i,'../../outside'); z.close()", symlinkArchive], { encoding: 'utf8' })
    assert.equal(made.status, 0, made.stderr)
    await assert.rejects(planInstall(symlinkArchive, f.game, 'World Ω'), /symlink|special file/i)
  } finally { await close(f.root) }
})

test('rechecks containment after preview and rejects a replaced target directory symlink', async () => {
  const f = await fixture({ 'films/one.dat': 'film' })
  try {
    const outside = path.join(f.root, 'outside'); await mkdir(outside)
    const plan = await planInstall(f.archive, f.game, 'World Ω')
    const filmDir = path.join(f.game, 'saves/World Ω/bbs/films')
    await mkdir(path.dirname(filmDir), { recursive: true }); await symlink(outside, filmDir, process.platform === 'win32' ? 'junction' : 'dir')
    await assert.rejects(applyInstall(plan.planId), /symbolic link|escaped/i)
    assert.equal(await readdirSafe(outside), 0)
  } finally { await close(f.root) }
})

test('rejects a malformed install log instead of following logged paths', async () => {
  const f = await fixture({ 'assets/a': 'a' })
  try {
    const logPath = path.join(f.game, 'config/bbs/w01-install-log.json')
    await mkdir(path.dirname(logPath), { recursive: true })
    await writeFile(logPath, JSON.stringify({ version: 1, installs: [{ installId: '11111111-1111-4111-8111-111111111111', installedAt: new Date().toISOString(), packageName: 'bad.zip', packageSha256: 'a'.repeat(64), ownedFiles: [{ path: '../outside', sha256: 'b'.repeat(64) }] }] }))
    await assert.rejects(uninstallInstall(f.game, '11111111-1111-4111-8111-111111111111'), /unsafe owned-file/i)
  } finally { await close(f.root) }
})

async function readdirSafe(folder: string): Promise<number> { return (await import('node:fs/promises')).readdir(folder).then((entries) => entries.length) }
