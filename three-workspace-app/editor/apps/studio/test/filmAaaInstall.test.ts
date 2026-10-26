import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { strToU8, zipSync } from 'three/addons/libs/fflate.module.js'
import { applyInstall, planInstall, uninstallInstall } from '../src/bbsInstall'

test('AAA assets use film install ownership: deduplicated texture installs once, unrelated and edited files survive uninstall', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'film-aaa-install-')), game = path.join(root, 'game')
  try {
    await mkdir(path.join(game, 'saves/world'), { recursive: true }); await writeFile(path.join(game, 'saves/world/level.dat'), 'level')
    // Generated metadata only, never a real mod/game jar; also keeps this fixture usable with V3 preflight.
    await mkdir(path.join(game, 'mods'), { recursive: true }); await mkdir(path.join(game, 'libraries/net/fabricmc/fabric-loader/0.19.5'), { recursive: true })
    for (const [id, version] of [['bbs', '2.7'], ['aaa_particles', '2.2.3'], ['bbs-aaaddon', '2.0'], ['fabric-api', '0.92.6+1.20.1'], ['architectury', '9.2.14'], ['forgeconfigapiport', '8.0.0']]) {
      await writeFile(path.join(game, 'mods', `${id}.jar`), zipSync({ 'fabric.mod.json': strToU8(JSON.stringify({ schemaVersion: 1, id, version, depends: { fabricloader: '>=0.15' } })) }))
    }
    const prefix = 'assets/effeks/project-abcdef0123456789abcdef01/'
    const members = { [`${prefix}laser.efkefc`]: 'synthetic laser', [`${prefix}ring.efkefc`]: 'synthetic ring', [`${prefix}textures/shared.png`]: 'shared', 'films/two-cues.dat': 'synthetic film' }
    const archive = path.join(root, 'film.zip'); await writeFile(archive, zipSync(Object.fromEntries(Object.entries(members).map(([key, value]) => [key, strToU8(value)]))))
    const unrelated = path.join(game, 'config/bbs/assets/effeks/samples/user.efkefc')
    await mkdir(path.dirname(unrelated), { recursive: true }); await writeFile(unrelated, 'user sample')
    const plan = await planInstall(archive, game, 'world')
    assert.equal(plan.files.length, 4); assert.equal(plan.files.filter((file) => file.target.endsWith('shared.png')).length, 1)
    const applied = await applyInstall(plan.planId); assert.equal(applied.installed.length, 4)
    const repeat = await applyInstall((await planInstall(archive, game, 'world')).planId)
    assert.equal(repeat.skipped.length, 4); assert.equal(repeat.installed.length, 0)
    assert.deepEqual((await uninstallInstall(game, repeat.installId)).removed, [])
    const texture = path.join(game, 'config/bbs', prefix, 'textures/shared.png')
    await writeFile(texture, 'user edit')
    const removed = await uninstallInstall(game, applied.installId)
    assert.equal(removed.removed.length, 3); assert.deepEqual(removed.preserved, [`config/bbs/${prefix}textures/shared.png`])
    assert.equal(await readFile(texture, 'utf8'), 'user edit'); assert.equal(await readFile(unrelated, 'utf8'), 'user sample')
  } finally { await rm(root, { recursive: true, force: true }) }
})
