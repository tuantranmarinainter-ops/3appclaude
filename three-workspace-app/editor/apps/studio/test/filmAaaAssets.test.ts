import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { strToU8, zipSync } from 'three/addons/libs/fflate.module.js'
import { FILM_SERIES_ARCHIVE_SCRIPT } from '../src/filmSeries'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { aaaEffectDependencies, collectFilmAaaAssets, writeFilmAaaAssets } from '../src/filmAaaAssets'
import { filmAaaEffects } from '../src/unifiedJobs'
function int(value: number) { const bytes = Buffer.alloc(4); bytes.writeInt32LE(value); return bytes }
function string(value: string) { return Buffer.concat([int(value.length + 1), Buffer.from(`${value}\0`, 'utf16le')]) }
function effect(deps: Array<[number, string]>, version = 1810): Buffer {
  const info = version <= 1610
    ? Buffer.concat([int(version), ...[1, 1, 1, 3, 2, 4, 5].map((kind, index) => { const items = deps.filter(([type]) => type === kind && (kind !== 1 || index === 0)); return Buffer.concat([int(items.length), ...items.map(([, name]) => string(name))]) })])
    : Buffer.concat([int(version), int(deps.length), ...deps.map(([kind, name]) => Buffer.concat([int(kind), int(0), string(name)]))])
  const chunk = (name: string, bytes: Buffer) => Buffer.concat([Buffer.from(name), int(bytes.length), bytes])
  return Buffer.concat([Buffer.from('EFKE'), int(0), chunk('INFO', info), chunk('EDIT', Buffer.from('synthetic-editor')), chunk('BIN_', Buffer.from('synthetic-runtime'))])
}
async function put(root: string, relative: string, bytes: string | Buffer) { const file = path.join(root, relative); await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, bytes) }
async function fixture() { const root = await mkdtemp(path.join(os.tmpdir(), 'film-aaa-assets-')); const source = path.join(root, 'source'); await mkdir(path.join(source, 'effects'), { recursive: true }); return { root, source } }

test('two cues package shared texture once, all model/material/curve dependencies and exact namespaced replay paths', async () => {
  const f = await fixture()
  try {
    const deps: Array<[number, string]> = [[1, '../textures/shared.png'], [3, '../models/mesh.efkmodel'], [4, '../materials/glow.efkmat'], [5, '../curves/path.efkcurve']]
    const bytes = effect(deps)
    await put(f.source, 'Effects/Laser.efkefc', bytes); await put(f.source, 'effects/ring.efkefc', bytes)
    for (const [, file] of deps) await put(f.source, path.posix.normalize(`effects/${file}`), file)
    await put(f.source, 'unused.png', 'unused')
    const assets = await collectFilmAaaAssets('project-1', [{ effect: 'Laser' }, { effect: 'ring' }, { effect: 'Laser' }], f.source)
    assert.match(assets.namespace, /^project-[a-f0-9]{24}$/); assert.equal(assets.files.length, 6)
    assert.equal(assets.files.filter((file) => file.path.endsWith('/textures/shared.png')).length, 1)
    assert.ok(!assets.files.some((file) => file.path.endsWith('/unused.png')))
    const output = path.join(f.root, 'package'); await mkdir(output); await writeFilmAaaAssets(output, assets)
    const cues = ['Laser', 'ring'].map((effect) => ({ effect, x: 1, y: 64, z: 2, yaw: 0, scale: 1, startTick: 0, endTick: 20 }))
    for (const replay of filmAaaEffects(cues, 20, assets.effectPaths)) {
      const document = path.join(output, 'assets', replay.effect)
      assert.deepEqual(await readFile(document), bytes)
      for (const dependency of aaaEffectDependencies(bytes)) assert.ok((await readFile(path.resolve(path.dirname(document), dependency))).length)
    }
    assert.deepEqual(await readFile(path.join(f.source, 'Effects/Laser.efkefc')), bytes)
    const manifest = JSON.parse(await readFile(path.join(output, 'aaa-assets.json'), 'utf8'))
    assert.equal(manifest.files.length, 6); assert.equal(manifest.effects.Laser, assets.effectPaths.get('Laser'))
    assert.notEqual((await collectFilmAaaAssets('project-2', [{ effect: 'Laser' }], f.source)).namespace, assets.namespace)
  } finally { await rm(f.root, { recursive: true, force: true }) }
})
test('legacy INFO reads correctly; runtime exports, truncation, unknown versions and unsupported sound reject', () => {
  assert.deepEqual(aaaEffectDependencies(effect([[1, 'tex.png'], [3, 'mesh.efkmodel']], 1610)), ['tex.png', 'mesh.efkmodel'])
  assert.throws(() => aaaEffectDependencies(Buffer.from('SKFE runtime export')), /không đổi đuôi/)
  const bytes = effect([[1, 'tex.png']]); assert.throws(() => aaaEffectDependencies(bytes.subarray(0, -1)), /chunk/)
  assert.throws(() => aaaEffectDependencies(effect([], 9999)), /phiên bản/)
  assert.throws(() => aaaEffectDependencies(effect([[2, 'sound.wav']])), /âm thanh/)
  assert.throws(() => aaaEffectDependencies(effect([[255, 'unknown']])), /loại tài nguyên/)
})
test('omission requires no source; missing and ambiguous documents or missing dependencies stop export', async () => {
  const f = await fixture()
  try {
    assert.deepEqual((await collectFilmAaaAssets('p', [])).files, [])
    await assert.rejects(collectFilmAaaAssets('p', [{ effect: 'laser' }], ''), /W01_AAA_ASSETS/)
    await assert.rejects(collectFilmAaaAssets('p', [{ effect: 'laser' }], f.source), /thiếu laser/)
    await put(f.source, 'laser.efkefc', effect([[1, 'missing.png']]))
    await assert.rejects(collectFilmAaaAssets('p', [{ effect: 'laser' }], f.source), /ENOENT/)
    await put(f.source, 'effects/laser.efkefc', effect([]))
    await assert.rejects(collectFilmAaaAssets('p', [{ effect: 'laser' }], f.source), /trùng tên/)
    assert.throws(() => filmAaaEffects([{ effect: 'missing', x: 0, y: 0, z: 0, yaw: 0, scale: 1, startTick: 0, endTick: 1 }], 20, new Map()), /not packaged/)
  } finally { await rm(f.root, { recursive: true, force: true }) }
})
test('escaping, absolute, linked dependencies and portable case collisions reject', async () => {
  const f = await fixture()
  try {
    for (const dep of ['../../outside.png', '/etc/passwd', 'C:\\outside.png']) {
      await put(f.source, 'effects/laser.efkefc', effect([[1, dep]]))
      await assert.rejects(collectFilmAaaAssets('p', [{ effect: 'laser' }], f.source), /vượt ngoài|tuyệt đối/)
    }
    await put(f.root, 'outside.png', 'private'); await symlink(path.join(f.root, 'outside.png'), path.join(f.source, 'linked.png'))
    await put(f.source, 'effects/laser.efkefc', effect([[1, '../linked.png']]))
    await assert.rejects(collectFilmAaaAssets('p', [{ effect: 'laser' }], f.source), /liên kết/)
    await put(f.source, 'effects/laser.efkefc', effect([[1, '../textures/Shared.png'], [1, '../textures/shared.png']]))
    await put(f.source, 'textures/Shared.png', 'a'); await put(f.source, 'textures/shared.png', 'b')
    // Case-insensitive file systems (Windows/macOS) cannot hold both names; the realpath case check rejects it instead.
    await assert.rejects(collectFilmAaaAssets('p', [{ effect: 'laser' }], f.source), /trùng|không phải file an toàn/)
  } finally { await rm(f.root, { recursive: true, force: true }) }
})


test('uppercase parents and ../../ references resolve; film series preserves shared dependencies', async () => {
  const f = await fixture()
  try {
    const deps: Array<[number, string]> = [[1, '../../TestData/Textures/Shared.png'], [3, 'Model/Cube.efkmodel']]
    await put(f.source, 'Examples/Resources/Laser.efkefc', effect(deps))
    await put(f.source, 'TestData/Textures/Shared.png', 'texture'); await put(f.source, 'Examples/Resources/Model/Cube.efkmodel', 'model')
    const assets = await collectFilmAaaAssets('project', [{ effect: 'Laser' }], f.source)
    const document = assets.effectPaths.get('Laser')!
    assert.ok(document.endsWith('/examples/resources/laser.efkefc'))
    const names = new Map(assets.files.map((file) => [file.path, file.bytes]))
    for (const [, ref] of deps) assert.ok(names.has(path.posix.normalize(path.posix.join('assets', path.posix.dirname(document), ref))))
    const segments = []
    for (let index = 1; index <= 2; index++) {
      const archive = path.join(f.root, `segment-${index}.zip`)
      await writeFile(archive, zipSync({ ...Object.fromEntries(assets.files.map((file) => [file.path, file.bytes])), 'films/source.dat': strToU8(`film-${index}`), 'effects.json': strToU8(JSON.stringify([{ effect: 'Laser', startTick: 0, endTick: 20 }])) }))
      segments.push({ zip: archive, film: `part-${index}.dat` })
    }
    const spec = path.join(f.root, 'spec.json'), readme = path.join(f.root, 'readme.txt'), output = path.join(f.root, 'series'), archive = path.join(f.root, 'series.zip')
    await writeFile(spec, JSON.stringify({ segments, series: [] })); await writeFile(readme, 'synthetic series')
    const result = spawnSync(process.env.BBS_PYTHON || (process.platform === 'win32' ? 'python' : 'python3'), ['-c', FILM_SERIES_ARCHIVE_SCRIPT, spec, output, readme, archive], { encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
    for (const file of assets.files) assert.deepEqual(await readFile(path.join(output, file.path)), file.bytes)
    assert.equal((JSON.parse(await readFile(path.join(output, 'required-mods.json'), 'utf8'))).includedEffectCount, 2)
  } finally { await rm(f.root, { recursive: true, force: true }) }
})
