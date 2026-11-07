// node --test build.test.mjs  (no servers: step scripts are fakes found through W01_SHOT_SCRIPTS_DIR)
import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const build = path.join(path.dirname(fileURLToPath(import.meta.url)), 'build.mjs')
const root = mkdtempSync(path.join(tmpdir(), 'w01-build-'))
const fake = path.join(root, 'scripts')
const work = path.join(root, 'work')
const shotFile = path.join(work, 'shot.json')
import { mkdirSync } from 'node:fs'

before(() => {
  mkdirSync(fake, { recursive: true }); mkdirSync(work, { recursive: true })
  const w = (n, s) => writeFileSync(path.join(fake, n), s)
  w('rhythm.mjs', "console.log('rev 12'); console.log('WARN x')\n")
  w('place.mjs', "console.log('placed')\n")
  w('gates.mjs', "console.log('PASS  CONTINUITY hero 0.4 cm'); console.log('NOT_RUN CONTACT')\n")
  w('boom.mjs', "console.log('step one'); console.log('  FAIL SEAM_JUMP hero 9 cm'); console.log('tail line')\n")
  w('vfx.mjs', "if (process.argv[3]==='list') console.log('cue_1 bonk 101 120 (effect 20f) {}'); else console.log('rev 99 added', process.argv.slice(3).join(' '))\n")
})

const setShot = (build) => writeFileSync(shotFile, JSON.stringify({ api: 'http://127.0.0.1:3999', work, project: 'p', build }))
const run = (...a) => spawnSync(process.execPath, [build, shotFile, ...a], { encoding: 'utf8', env: { ...process.env, W01_SHOT_SCRIPTS_DIR: fake } })

test('dry prints resolved commands and runs nothing', () => {
  setShot([{ step: 'rhythm', file: 'r.json' }, { step: 'vfx', cmd: 'add', effect: 'bonk', start: 101, at: 'go:head@101', dy: 0.1 }])
  const r = run('--dry')
  assert.equal(r.status, 0)
  assert.match(r.stdout, /01 rhythm\s+rhythm\.mjs .*shot\.json .*r\.json/)
  assert.match(r.stdout, /vfx add bonk\s+vfx\.mjs .* add bonk 101 --at go:head@101 --dy 0\.1/)
  assert.ok(!existsSync(path.join(work, 'build', '01-rhythm.log')))
})

test('validation errors exit 2 before running', () => {
  setShot([{ step: 'nope' }, { step: 'align', frame: 1 }, { step: 'flat', char: 'go', in: 1, hold: [2], out: 5 }])
  const r = run()
  assert.equal(r.status, 2)
  assert.match(r.stderr, /unknown step "nope"/)
  assert.match(r.stderr, /align\): missing "target"/)
  assert.match(r.stderr, /"hold" must be \[B, C\]/)
})

test('OK run writes logs and summary.json', () => {
  setShot([{ step: 'place', file: 'p.json' }, { step: 'rhythm', file: 'r.json' }, { step: 'gates' }])
  const r = run()
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.match(r.stdout, /OK\s+02 rhythm\s+[\d.]+s\s+rev 12\s+WARN 1/)
  assert.match(r.stdout, /GATES PASS 1 · FAIL 0 · NOT_RUN 1\nNOT_RUN CONTACT\n/)
  const s = JSON.parse(readFileSync(path.join(work, 'build', 'summary.json'), 'utf8'))
  assert.equal(s.revision, 12)
  assert.deepEqual(s.steps.map((x) => [x.n, x.name, x.status, x.warnings]), [[1, 'place', 'OK', 0], [2, 'rhythm', 'OK', 1], [3, 'gates', 'OK', 0]])
  assert.deepEqual(s.gates, { pass: 1, fail: 0, notRun: 1, lines: ['NOT_RUN CONTACT'] })
  assert.ok(existsSync(path.join(work, 'build', '02-rhythm.log')))
})

test('gates run automatically when plan has none', () => {
  setShot([{ step: 'place', file: 'p.json' }])
  const r = run()
  assert.match(r.stdout, /GATES PASS 1/)
})

test('FAIL line with exit 0 stops the run and prints the tail', () => {
  setShot([{ step: 'place', file: 'p.json' }, { run: 'boom.mjs' }, { step: 'rhythm', file: 'r.json' }])
  const r = run()
  assert.equal(r.status, 1)
  assert.match(r.stdout, /FAIL 02 boom\.mjs/)
  assert.match(r.stdout, /FAIL SEAM_JUMP hero 9 cm\ntail line/)
  assert.match(r.stdout, /--from 2/)
  assert.doesNotMatch(r.stdout, /rhythm/)
})

test('--from resumes and --only runs one step', () => {
  setShot([{ step: 'place', file: 'p.json' }, { step: 'rhythm', file: 'r.json' }])
  let r = run('--from', 'rhythm')
  assert.doesNotMatch(r.stdout, /OK\s+01/)
  assert.match(r.stdout, /OK\s+02 rhythm/)
  r = run('--only', '1')
  assert.match(r.stdout, /OK\s+01 place/)
  assert.doesNotMatch(r.stdout, /02 rhythm/)
  assert.doesNotMatch(r.stdout, /GATES/)
})

test('vfx add is skipped when the cue already exists', () => {
  setShot([{ step: 'vfx', cmd: 'add', effect: 'bonk', start: 101 }, { step: 'vfx', cmd: 'add', effect: 'bonk', start: 150, scale: 0.4 }])
  const r = run()
  assert.match(r.stdout, /SKIP 01 vfx add bonk\s+already at 101/)
  assert.match(r.stdout, /OK\s+02 vfx add bonk\s+[\d.]+s\s+rev 99/)
})
