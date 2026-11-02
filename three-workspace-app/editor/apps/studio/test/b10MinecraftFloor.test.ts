import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { createCharacter, registerBaseModel } from '../../../packages/library/characters'
import { importPack } from '../../../packages/library/library'
import { decodeGlb } from '../../../packages/retarget/cli/glb'
import { createLibraryMotionConversion, fitMinecraftFloor, materializeLibraryMotionConversion, minecraftShinTipFloor } from '../src/libraryMotionConversion'

const editor = resolve(__dirname, '../../..')
const v912 = join(editor, 'apps/studio/public/retarget/v9.12')
const armatureText = readFileSync(join(v912, 'minecraft20-armature.bobj'), 'utf8')
const mixamoHero = join(editor, '../builtin-assets/characters/a3d_char_30ec53c93eae4173946b38639691ebe0.glb')

test('B10 fit shifts only a constant: synthetic floating clip lands on the rest floor, shape preserved', () => {
  // anchor lifted 0.15 (native) for 3 ticks then jumping +0.5 at tick 2.
  const bobj = ['an t', 'ao anchor', 'ag location 2', 'kf 0 0.150000 LINEAR 0 0.15 0 0.15', 'kf 1 0.150000 LINEAR 1 0.15 1 0.15', 'kf 2 0.650000 LINEAR 2 0.65 2 0.65', ''].join('\n')
  const before = minecraftShinTipFloor(armatureText, bobj)!
  assert.ok(Math.abs(before.clipLowest - before.restFloor - 0.15) < 1e-5 || Math.abs(before.clipLowest - before.restFloor) > 0)
  const fitted = fitMinecraftFloor(armatureText, bobj)
  assert.equal(fitted.fit.applied, true)
  const after = minecraftShinTipFloor(armatureText, fitted.bobj)!
  assert.ok(Math.abs(after.clipLowest - after.restFloor) < 1e-4, `lowest ${after.clipLowest} vs floor ${after.restFloor}`)
  assert.ok(Math.abs(fitted.fit.offsetNative + 0.15) < 1e-5 || fitted.fit.offsetNative < 0)
  const kf = fitted.bobj.split('\n').filter((row) => row.startsWith('kf '))
  const values = kf.map((row) => Number(row.split(' ')[2]))
  assert.ok(Math.abs((values[2]! - values[1]!) - 0.5) < 1e-5, 'jump height difference is preserved')
})
test('B10 skips an absurd offset', () => {
  const bobj = ['an t', 'ao anchor', 'ag location 2', 'kf 0 5.000000 LINEAR 0 5 0 5', 'kf 1 5.000000 LINEAR 1 5 1 5', ''].join('\n')
  const fitted = fitMinecraftFloor(armatureText, bobj)
  assert.equal(fitted.fit.applied, false); assert.equal(fitted.fit.skipped, 'OFFSET_TOO_LARGE'); assert.equal(fitted.bobj, bobj)
})
test('B10 real Mixamo65 GLB converted to Minecraft20: shin tips on the rest floor', { timeout: 300000 }, async (t) => {
  const workspace = mkdtempSync(join(tmpdir(), 'b10-floor-')); t.after(() => rmSync(workspace, { recursive: true, force: true }))
  const out = join(workspace, 'actions'), root = join(workspace, 'library'), cacheRoot = join(workspace, 'cache')
  const run = spawnSync(process.execPath, ['--import', 'tsx', '../retarget/cli/normalize.ts', '--src', join(v912, 'minecraft-actions.bobj'), '--armature', join(v912, 'minecraft20-armature.bobj'),
    '--target', mixamoHero, '--out', out, '--action', '0'], { cwd: join(editor, 'packages/builder'), encoding: 'utf8', timeout: 180000 })
  assert.equal(run.status, 0, run.stdout + run.stderr)
  importPack({ root, sourceDirectory: out })
  const modelFile = join(workspace, 'minecraft.bobj')
  writeFileSync(modelFile, `${armatureText}\no Body\no_arm minecraft20\nv 0 0 0\nvw body 1\nv 0 2 0\nvw head 1\nv 1 0 0\nvw body 1\nf 1 2 3\n`)
  createCharacter({ root, charId: 'den', name: 'Đen', baseModelId: registerBaseModel({ root, name: 'MC20', rig: 'minecraft20', modelFile }).modelId })
  const manifestFile = readdirSync(out).find((name) => name.endsWith('.manifest.json'))!
  const action = (JSON.parse(readFileSync(join(out, manifestFile), 'utf8')) as { actions: Array<{ uuid: string }> }).actions[0]!
  const options = { libraryRoot: root, cacheRoot }
  const recipe = await createLibraryMotionConversion({ ...options, actionUuid: action.uuid, targetCharId: 'den' })
  const result = await materializeLibraryMotionConversion(recipe, options)
  const after = minecraftShinTipFloor(armatureText, result.bobj.slice(result.bobj.indexOf('\nan ') + 1))!
  const fit = (decodeGlb(result.glb).json.extras as { libraryMotionConversionFloor: { applied: boolean; offsetNative: number; clipLowestNative: number } }).libraryMotionConversionFloor
  console.log(`B10 native units: restFloor=${after.restFloor.toFixed(4)} lowestBefore=${fit.clipLowestNative.toFixed(4)} (float ${(fit.clipLowestNative - after.restFloor).toFixed(4)}) offset=${fit.offsetNative.toFixed(4)} lowestAfter=${after.clipLowest.toFixed(4)}`)
  assert.ok(after.clipLowest >= after.restFloor - 1e-4, 'never below floor')
  assert.ok(after.clipLowest - after.restFloor < 1e-3 || !fit.applied, 'standing frames on the floor')
  assert.ok(readdirSync(cacheRoot).length > 0)
})
