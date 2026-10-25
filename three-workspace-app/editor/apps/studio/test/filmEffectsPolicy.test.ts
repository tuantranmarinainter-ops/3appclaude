import assert from 'node:assert/strict'
import test from 'node:test'
import { filmEffectsForExport, filmRequiredMods, resolveFilmEffectsPolicy } from '../src/filmEffectsPolicy'

test('server defaults and explicit omission never evaluate malformed or moving project effects', async () => {
  for (const policy of [undefined, { mode: 'omit' }]) {
    assert.deepEqual(await filmEffectsForExport(policy, async () => { throw new Error('must not evaluate omitted project cues') }), [])
  }
  assert.deepEqual(resolveFilmEffectsPolicy(undefined), { mode: 'omit' })
  assert.deepEqual(filmRequiredMods(0).requiredMods, ['BBS FS 2.7'])
})
test('inclusion requires explicit compatible runtime and renderer confirmation; playback stays unverified', async () => {
  for (const policy of [null, 'include', {}, { mode: 'include' }, { mode: 'include', target: { runtime: 'forge-connector', aaaRendererAvailable: true, compatibleAddonConfirmed: true } }, { mode: 'include', target: { runtime: 'bbs-fs-2.7', aaaRendererAvailable: true } }, { mode: 'omit', target: {} }]) assert.throws(() => resolveFilmEffectsPolicy(policy))
  const policy = { mode: 'include', target: { runtime: 'bbs-fs-2.7', aaaRendererAvailable: true, compatibleAddonConfirmed: true } }
  const cues = [{ effect: 'aura01' }]
  assert.deepEqual(await filmEffectsForExport(policy, async () => cues), cues)
  assert.equal(filmRequiredMods(1).effectPlayback, 'UNVERIFIED')
  assert.equal(filmRequiredMods(1).requiredMods.length, 2)
  assert.equal(filmRequiredMods(0).requiredMods.length, 1, 'include mode without actual content needs no AAA addon')
})

test('series omission keeps ordinary files and emits only base runtime requirements', async () => {
  const { spawnSync } = await import('node:child_process')
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const path = await import('node:path')
  const { FILM_SERIES_ARCHIVE_SCRIPT } = await import('../src/filmSeries')
  const root = mkdtempSync(path.join(tmpdir(), 'effects-omit-series-'))
  const python = process.env.BBS_PYTHON?.trim() || (process.platform === 'win32' ? 'python' : 'python3')
  try {
    const zip = path.join(root, 'film.zip'), spec = path.join(root, 'spec.json'), readme = path.join(root, 'README.txt'), archive = path.join(root, 'episode.zip')
    const fixture = spawnSync(python, ['-c', "import sys,zipfile; z=zipfile.ZipFile(sys.argv[1],'w'); z.writestr('films/plain.dat',b'ordinary-film'); z.writestr('assets/models/ordinary/model.bobj',b'ordinary-model'); z.close()", zip], { encoding: 'utf8' })
    assert.equal(fixture.status, 0, fixture.stderr)
    writeFileSync(spec, JSON.stringify({ segments: [{ zip, film: 'episode-01.dat' }], series: [] }))
    writeFileSync(readme, 'Effects omitted')
    const merged = spawnSync(python, ['-c', FILM_SERIES_ARCHIVE_SCRIPT, spec, path.join(root, 'output'), readme, archive], { encoding: 'utf8' })
    assert.equal(merged.status, 0, merged.stderr)
    const inspect = spawnSync(python, ['-c', "import sys,json,zipfile; z=zipfile.ZipFile(sys.argv[1]); print(json.dumps({'names':z.namelist(),'mods':json.loads(z.read('required-mods.json')),'dat':z.read('films/episode-01.dat').decode()}))", archive], { encoding: 'utf8' })
    assert.equal(inspect.status, 0, inspect.stderr)
    const value = JSON.parse(inspect.stdout)
    assert.ok(!value.names.includes('effects.json'))
    assert.equal(value.dat, 'ordinary-film')
    assert.deepEqual(value.mods.requiredMods, ['BBS FS 2.7'])
    assert.equal(value.mods.effectPlayback, 'OMITTED')
  } finally { rmSync(root, { recursive: true, force: true }) }
})
