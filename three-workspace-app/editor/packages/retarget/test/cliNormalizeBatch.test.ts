import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { appendFileSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const cliPath = resolve(here, '../cli/normalizeBatch.ts'), tsxHome = resolve(here, '../../builder')
const bobjDir = resolve(here, '../../../apps/studio/public/retarget/v9.12')
const actionsPath = join(bobjDir, 'minecraft-actions.bobj'), armaturePath = join(bobjDir, 'minecraft20-armature.bobj')
const targetPath = resolve(here, '../../../../builtin-assets/characters/a3d_char_30ec53c93eae4173946b38639691ebe0.glb')
const dir = mkdtempSync(join(tmpdir(), 'w01-normalize-batch-')), sourceDir = join(dir, 'src'), outDir = join(dir, 'out')
for (const folder of ['a', 'b']) {
  mkdirSync(join(sourceDir, folder), { recursive: true })
  copyFileSync(actionsPath, join(sourceDir, folder, 'walk.bobj'))
}
writeFileSync(join(sourceDir, 'broken.glb'), 'not a GLB')
writeFileSync(join(sourceDir, 'ignored.txt'), 'not an input')
after(() => rmSync(dir, { recursive: true, force: true }))

interface Entry { path: string; stem: string; sha256: string; status: string; exitCode: number | null; actions: number; warnings: string[]; elapsedMs: number; error: string | null }
interface Summary { entries: Entry[]; totals: Record<string, number> }
const summary = (out = outDir): Summary => JSON.parse(readFileSync(join(out, 'summary.json'), 'utf8'))
const artifact = (stem: string, suffix: string) => join(outDir, stem, `${stem}${suffix}`)
const run = (out = outDir, flags = ['--recursive'], forwarded = ['--action', '0'], source = sourceDir) => spawnSync(process.execPath,
  ['--import', 'tsx', cliPath, '--src-dir', source, '--target', targetPath, '--out', out,
    '--armature', armaturePath, ...flags, '--', ...forwarded],
  { cwd: tsxHome, encoding: 'utf8', timeout: 120_000 })

test('recursive batch normalizes duplicate stems, continues after broken input and writes both summaries', () => {
  const result = run()
  assert.equal(result.status, 1, result.stderr + result.stdout)
  const data = summary()
  assert.deepEqual(data.entries.map((entry) => [entry.path, entry.stem]), [['a/walk.bobj', 'walk'], ['b/walk.bobj', 'walk-2'], ['broken.glb', 'broken']])
  for (const entry of data.entries.slice(0, 2)) {
    assert.equal(entry.status, 'PASS', JSON.stringify(entry))
    assert.equal(entry.exitCode, 0)
    assert.equal(entry.actions, 1, 'the --action 0 argument reaches normalize.ts')
    assert.equal(entry.sha256, createHash('sha256').update(readFileSync(actionsPath)).digest('hex'))
    assert.ok(Array.isArray(entry.warnings))
    assert.ok(entry.elapsedMs >= 0)
    assert.ok(existsSync(artifact(entry.stem, '.glb')))
    const manifest = JSON.parse(readFileSync(artifact(entry.stem, '.manifest.json'), 'utf8'))
    assert.equal(manifest.source.sha256, entry.sha256)
    const report = JSON.parse(readFileSync(artifact(entry.stem, '.report.json'), 'utf8'))
    assert.deepEqual(entry.warnings, report.quality?.warnings?.map((item: { code: string }) => item.code) ?? [])
  }
  const broken = data.entries[2]!
  assert.ok(['ERROR', 'FAIL'].includes(broken.status), JSON.stringify(broken))
  assert.equal(broken.exitCode, 1)
  if (broken.status === 'ERROR') assert.ok(broken.error)
  assert.deepEqual(data.totals, { PASS: 2, FAIL: broken.status === 'FAIL' ? 1 : 0, BLOCKED: 0, ERROR: broken.status === 'ERROR' ? 1 : 0, SKIPPED: 0 })
  const lines = readFileSync(join(outDir, 'summary.tsv'), 'utf8').trimEnd().split('\n')
  assert.equal(lines.length, 5, 'header, three inputs and totals comment')
  assert.deepEqual(lines.slice(1, 4).map((line) => line.split('\t')[0]), data.entries.map((entry) => entry.path))
  assert.ok(lines[4]!.startsWith('# totals\tPASS=2'))
  assert.equal(result.stdout.trim().split('\n').length, 3, 'one console progress line per input')
})

test('--skip-existing keeps both GLBs untouched and counts Actions from the cached manifests', () => {
  const old = new Date('2001-01-01T00:00:00Z')
  for (const stem of ['walk', 'walk-2']) utimesSync(artifact(stem, '.glb'), old, old)
  const before = ['walk', 'walk-2'].map((stem) => statSync(artifact(stem, '.glb')).mtimeMs)
  const result = run(outDir, ['--recursive', '--skip-existing'])
  assert.equal(result.status, 1, 'broken input is still retried')
  const data = summary()
  assert.deepEqual(data.entries.slice(0, 2).map((entry) => [entry.status, entry.actions, entry.exitCode]), [['SKIPPED', 1, null], ['SKIPPED', 1, null]])
  assert.deepEqual(['walk', 'walk-2'].map((stem) => statSync(artifact(stem, '.glb')).mtimeMs), before)
  assert.equal(data.totals.SKIPPED, 2)
})

test('output inside or equal to the source is rejected before processing or creating output', () => {
  for (const out of [sourceDir, join(sourceDir, 'nested', 'out')]) {
    const result = run(out)
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /--out must be outside --src-dir/)
    assert.equal(result.stdout, '')
    assert.ok(!existsSync(join(out, 'summary.json')))
  }
  assert.ok(!existsSync(join(sourceDir, 'nested')))
})

test('changed source hash is rerun while the other cached source is skipped', () => {
  appendFileSync(join(sourceDir, 'a', 'walk.bobj'), '\n')
  const result = run(outDir, ['--recursive', '--skip-existing'])
  assert.equal(result.status, 1, result.stderr + result.stdout)
  const data = summary()
  assert.equal(data.entries[0]!.status, 'PASS')
  assert.equal(data.entries[1]!.status, 'SKIPPED')
  assert.notEqual(data.entries[0]!.sha256, data.entries[1]!.sha256)
  assert.ok(statSync(artifact('walk', '.glb')).mtimeMs > new Date('2001-01-01').getTime())
})

test('a malformed cached manifest is regenerated instead of aborting the batch', () => {
  writeFileSync(artifact('walk-2', '.manifest.json'), '{broken')
  const result = run(outDir, ['--recursive', '--skip-existing'])
  assert.equal(result.status, 1, result.stderr + result.stdout)
  assert.deepEqual(summary().entries.slice(0, 2).map((entry) => entry.status), ['SKIPPED', 'PASS'])
})

test('without --recursive only root inputs are processed', () => {
  const out = join(dir, 'flat'), result = run(out, [])
  assert.equal(result.status, 1, result.stderr + result.stdout)
  assert.deepEqual(summary(out).entries.map((entry) => entry.path), ['broken.glb'])
})

test('an empty folder produces zero totals and a successful exit', () => {
  const empty = join(dir, 'empty'), out = join(dir, 'empty-out')
  mkdirSync(empty)
  const result = spawnSync(process.execPath, ['--import', 'tsx', cliPath, '--src-dir', empty, '--target', targetPath, '--out', out, '--', '--action', '0'], { cwd: tsxHome, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr + result.stdout)
  assert.deepEqual(summary(out).entries, [])
  assert.ok(Object.values(summary(out).totals).every((count) => count === 0))
})

test('output through a directory symlink back into source is rejected', () => {
  const alias = join(dir, 'source-alias')
  symlinkSync(sourceDir, alias, process.platform === 'win32' ? 'junction' : 'dir')
  const result = run(join(alias, 'out'))
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /--out must be outside --src-dir/)
  assert.equal(result.stdout, '')
})

test('BLOCKED alone exits 2, while a broken input takes precedence with exit 1', () => {
  const source = join(dir, 'blocked-src'), out = join(dir, 'blocked-out')
  mkdirSync(source)
  copyFileSync(targetPath, join(source, 'no-actions.glb'))
  const result = run(out, [], ['--action', '0'], source)
  assert.equal(result.status, 2, result.stderr + result.stdout)
  assert.deepEqual(summary(out).entries.map((entry) => [entry.status, entry.exitCode, entry.actions]), [['BLOCKED', 2, 0]])
  assert.equal(summary(out).totals.BLOCKED, 1)
  writeFileSync(join(source, 'broken.glb'), 'invalid')
  assert.equal(run(out, [], ['--action', '0'], source).status, 1)
  assert.equal(summary(out).totals.BLOCKED, 1)
})

test('literal suffixed names remain unique and forwarded --bobj/--preview artifacts use allocated stems', () => {
  const source = join(dir, 'collision-src'), out = join(dir, 'collision-out')
  for (const [folder, name] of [['a', 'walk'], ['b', 'walk'], ['c', 'walk-2']]) {
    mkdirSync(join(source, folder!), { recursive: true })
    copyFileSync(actionsPath, join(source, folder!, `${name}.bobj`))
  }
  const result = run(out, ['--recursive'], ['--action', '0', '--bobj', '--preview'], source)
  assert.equal(result.status, 0, result.stderr + result.stdout)
  assert.deepEqual(summary(out).entries.map((entry) => entry.stem), ['walk', 'walk-2', 'walk-2-2'])
  for (const entry of summary(out).entries) {
    assert.equal(entry.status, 'PASS', JSON.stringify(entry))
    for (const suffix of ['.glb', '.manifest.json', '.report.json', '.preview.png', '.minecraft20.bobj', '.minecraft20.preview.png']) {
      assert.ok(existsSync(join(out, entry.stem, `${entry.stem}${suffix}`)), `${entry.stem}${suffix}`)
    }
  }
})
