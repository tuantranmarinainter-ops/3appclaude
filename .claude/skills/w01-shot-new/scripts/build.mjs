// One command for the whole shot sequence, driven by "build" in shot.json. Short report, logs in <work>/build/.
//   node build.mjs <shot.json> [--from <n|name>] [--only <n|name>] [--dry] [--verbose]
// shot.build = [ { "step": "rhythm", "file": "rhythm.json" }, { "step": "vfx", "cmd": "add", "effect": "bonk", "start": 101, "at": "go:head@101" },
//                { "run": "my-script.mjs", "args": ["x"] } ]   (optional "label" on every step)
// Steps: continue{frame} place{file} rhythm{file} prop-follow{gripFrame} align{frame,target,offset} ground{char,hit,land,knock,from,until,clear,userKeys}
//        flat{char,in,hold:[B,C],out} camera{file} vfx{cmd,effect,start,at,pos,dy,scale,end,every,overlap} audio{file,keep}
//        voice{who,text,out,rate,force} sfx{outDir,names:[..]} gates
// Env W01_SHOT_SCRIPTS_DIR overrides the folder holding the step scripts (tests).
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { loadShot, here } from './lib.mjs'

const argv = process.argv.slice(2)
const flag = (n) => argv.includes(n)
const opt = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined }
const DRY = flag('--dry'), VERBOSE = flag('--verbose')
const scriptsDir = process.env.W01_SHOT_SCRIPTS_DIR || here

let shot
try { shot = loadShot(argv[0]) } catch (e) { console.error(e.message); process.exit(2) }
const plan = shot.build
if (!Array.isArray(plan) || !plan.length) { console.error('shot.json has no "build" array'); process.exit(2) }
const W = (p) => path.resolve(shot.work, String(p))
const num = (v) => String(v)

/** Each step kind: required params, and a function giving { script, args, py? , display }. */
const KINDS = {
  continue: { args: (s) => [...(s.frame != null ? ['--frame', num(s.frame)] : [])], script: 'continue-from.mjs' },
  place: { req: ['file'], script: 'place.mjs', args: (s) => [W(s.file)] },
  rhythm: { req: ['file'], script: 'rhythm.mjs', args: (s) => [W(s.file)] },
  'prop-follow': { script: 'prop-follow.mjs', args: (s) => (s.gripFrame != null ? ['--grip-frame', num(s.gripFrame)] : []) },
  align: { req: ['frame', 'target'], script: 'align-contact.mjs', args: (s) => ['--frame', num(s.frame), '--target', s.target, ...(s.offset != null ? ['--offset', num(s.offset)] : [])] },
  ground: {
    req: ['char'], script: 'ground.mjs',
    args: (s) => [s.char, ...[['hit', '--hit'], ['land', '--land'], ['knock', '--knock'], ['from', '--from'], ['until', '--until'], ['clear', '--clear']].flatMap(([k, f]) => (s[k] != null ? [f, num(s[k])] : [])), ...(s.userKeys ? ['--user-keys'] : [])],
  },
  flat: {
    req: ['char', 'in', 'hold', 'out'], script: 'flat.mjs', probeFirst: true,
    check: (s) => (Array.isArray(s.hold) && s.hold.length === 2 ? null : '"hold" must be [B, C]'),
    args: (s) => [s.char, '--in', num(s.in), '--hold', num(s.hold[0]), num(s.hold[1]), '--out', num(s.out)],
  },
  camera: { req: ['file'], script: 'camera.mjs', args: (s) => [W(s.file)] },
  vfx: {
    req: ['cmd'], script: 'vfx.mjs',
    check: (s) => {
      if (!['add', 'keep', 'remove'].includes(s.cmd)) return '"cmd" must be add|keep|remove'
      if (s.cmd === 'add') return ['effect', 'start'].filter((k) => s[k] == null).map((k) => `missing "${k}"`).join(', ') || null
      return s.effect == null ? 'missing "effect"' : null
    },
    args: (s) => {
      if (s.cmd === 'remove') return ['remove', s.effect]
      if (s.cmd === 'keep') return ['keep', s.effect, ...(s.every != null ? ['--every', num(s.every)] : []), ...(s.overlap != null ? ['--overlap', num(s.overlap)] : [])]
      const pos = s.pos == null ? [] : ['--pos', Array.isArray(s.pos) ? s.pos.join(',') : String(s.pos)]
      return ['add', s.effect, num(s.start), ...(s.at ? ['--at', s.at] : []), ...pos, ...[['dy', '--dy'], ['scale', '--scale'], ['end', '--end']].flatMap(([k, f]) => (s[k] != null ? [f, num(s[k])] : []))]
    },
    display: (s) => `vfx ${s.cmd} ${s.effect ?? ''}`.trim(),
    // vfx.mjs takes <shot.json> then the sub-command
  },
  audio: { req: ['file'], script: 'audio.mjs', args: (s) => [W(s.file), ...(s.keep ? ['--keep'] : [])] },
  voice: {
    req: ['who', 'text', 'out'], script: 'voice.py', py: true, noShot: true,
    args: (s) => [s.who, s.text, W(s.out), ...(s.rate != null ? ['--rate', num(s.rate)] : [])],
  },
  sfx: {
    req: ['outDir', 'names'], script: 'sfx.py', py: true, noShot: true,
    check: (s) => (Array.isArray(s.names) && s.names.length ? null : '"names" must be a non-empty array'),
    args: (s) => [W(s.outDir), ...s.names.map(String)],
  },
  gates: { script: 'gates.mjs', args: () => [] },
}

const steps = []
const errors = []
plan.forEach((s, i) => {
  const n = i + 1, where = `build[${n}]`
  if (s.run) {
    steps.push({ n, name: s.label || s.run, kind: 'run', script: s.run, py: /\.py$/.test(s.run), args: (s.args ?? []).map(String), shotArg: s.noShot ? false : true })
    return
  }
  const k = KINDS[s.step]
  if (!k) { errors.push(`${where}: unknown step "${s.step}" (known: ${Object.keys(KINDS).join(', ')})`); return }
  const missing = (k.req ?? []).filter((p) => s[p] == null)
  if (missing.length) { errors.push(`${where} (${s.step}): missing ${missing.map((m) => `"${m}"`).join(', ')}`); return }
  const bad = k.check?.(s)
  if (bad) { errors.push(`${where} (${s.step}): ${bad}`); return }
  steps.push({ n, name: s.label || (k.display ? k.display(s) : s.step), kind: s.step, spec: s, script: k.script, py: !!k.py, args: k.args(s), shotArg: !k.noShot, probeFirst: !!k.probeFirst })
})
if (errors.length) { for (const e of errors) console.error('ERROR ' + e); process.exit(2) }

const find = (key) => {
  if (key == null) return null
  if (/^\d+$/.test(key)) return Number(key)
  const st = steps.find((s) => s.name === key || s.kind === key || s.spec?.step === key)
  return st ? st.n : -1
}
let sel = steps
const fromN = find(opt('--from')), onlyN = find(opt('--only'))
if (fromN === -1 || onlyN === -1) { console.error('ERROR --from/--only: no such step'); process.exit(2) }
if (onlyN) sel = steps.filter((s) => s.n === onlyN)
else if (fromN) sel = steps.filter((s) => s.n >= fromN)

const cmdOf = (st) => {
  const sc = path.join(scriptsDir, st.script)
  const rest = [sc, ...(st.shotArg ? [shot.file] : []), ...st.args]
  return st.py ? ['python', ['-I', ...rest]] : [process.execPath, rest]
}
const short = (x) => { const r = path.relative(shot.work, x); return path.isAbsolute(x) && !r.startsWith('..') && !path.isAbsolute(r) ? r.split(path.sep).join('/') : x }
const show = (st) => { const [, a] = cmdOf(st); const rest = a.slice(st.py ? 2 : 1); return [path.basename(a[st.py ? 1 : 0]), ...rest.map((x) => (/[\s"]/.test(x = short(x)) ? JSON.stringify(x) : x))].join(' ') }
const pad2 = (n) => String(n).padStart(2, '0')

if (DRY) {
  for (const st of sel) console.log(`${pad2(st.n)} ${st.name.padEnd(14)} ${show(st)}`)
  process.exit(0)
}

const logDir = path.join(shot.work, 'build')
mkdirSync(logDir, { recursive: true })
const logRel = (st) => path.posix.join('build', `${pad2(st.n)}-${st.name.replace(/[^\w.-]+/g, '-')}.log`)

function exec(st, logFile) {
  const [c, a] = cmdOf(st)
  const t0 = Date.now()
  const r = spawnSync(c, a, { cwd: shot.work, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, W01_API: shot.api } })
  const out = (r.stdout ?? '') + (r.stderr ?? '') + (r.error ? `\n${r.error.message}\n` : '')
  writeFileSync(logFile, out)
  return { out, code: r.status, sec: (Date.now() - t0) / 1000 }
}
const failed = (r) => r.code !== 0 || r.out.split(/\r?\n/).some((l) => { const t = l.trim(); return t.startsWith('FAIL') || t.includes('FAILED') })
const gateLines = (out) => out.split(/\r?\n/).map((l) => l.trim()).filter((l) => /^(PASS|FAIL|NOT_RUN|BLOCKED)\b/.test(l))
const summarize = (lines) => {
  const c = (k) => lines.filter((l) => l.startsWith(k)).length
  return { pass: c('PASS'), fail: c('FAIL'), notRun: c('NOT_RUN'), lines: lines.filter((l) => !l.startsWith('PASS')) }
}

const total = Math.max(...steps.map((s) => s.name.length), 6)
const results = []
let revision = null
let gatesOut = null
let vfxCues = null
let stopped = null

for (const st of sel) {
  const logFile = path.join(logDir, path.basename(logRel(st)))
  let res
  if (st.kind === 'vfx' && st.spec.cmd === 'add') {
    if (vfxCues == null) {
      const l = exec({ ...st, args: ['list'], name: st.name }, path.join(logDir, `${pad2(st.n)}-vfx-list.log`))
      vfxCues = l.out.split(/\r?\n/).map((x) => x.trim().split(/\s+/)).filter((t) => t.length >= 3)
    }
    const hit = vfxCues.find((t) => t[1] === String(st.spec.effect) && t[2] === String(st.spec.start))
    if (hit) {
      writeFileSync(logFile, `skipped: cue ${hit[0]} already exists\n`)
      const r = { n: st.n, name: st.name, status: 'SKIP', seconds: 0, warnings: 0, log: logRel(st) }
      results.push(r)
      console.log(`SKIP ${pad2(st.n)} ${st.name.padEnd(total)}  already at ${st.spec.start}`)
      continue
    }
  }
  if (st.kind === 'voice' && !st.spec.force) {
    const o = W(st.spec.out)
    if (existsSync(o) && statSync(o).mtimeMs > statSync(shot.file).mtimeMs) {
      writeFileSync(logFile, 'skipped: output newer than shot.json\n')
      results.push({ n: st.n, name: st.name, status: 'SKIP', seconds: 0, warnings: 0, log: logRel(st) })
      console.log(`SKIP ${pad2(st.n)} ${st.name.padEnd(total)}  ${st.spec.out} is up to date`)
      continue
    }
  }
  if (st.probeFirst) exec({ script: 'gates.mjs', args: [], shotArg: true, py: false }, path.join(logDir, `${pad2(st.n)}-probe-refresh.log`))
  res = exec(st, logFile)
  const rev = [...res.out.matchAll(/\brev\s+(\d+)/g)].pop()
  const warnings = res.out.split(/\r?\n/).filter((l) => l.includes('WARN')).length
  if (rev) revision = Number(rev[1])
  if (st.kind === 'gates') gatesOut = res.out
  const bad = failed(res)
  const r = { n: st.n, name: st.name, status: bad ? 'FAIL' : 'OK', seconds: +res.sec.toFixed(1), warnings, log: logRel(st) }
  results.push(r)
  console.log(`${bad ? 'FAIL' : 'OK  '} ${pad2(st.n)} ${st.name.padEnd(total)} ${res.sec.toFixed(1).padStart(5)}s${rev ? `  rev ${rev[1]}` : ''}${warnings ? `  WARN ${warnings}` : ''}`)
  if (VERBOSE) console.log(res.out.trimEnd())
  if (bad) {
    if (!VERBOSE && st.kind !== 'gates') console.log(res.out.trimEnd().split(/\r?\n/).slice(-12).join('\n'))
    console.log(`stopped at step ${st.n}; fix it, then resume with: --from ${st.n}`)
    stopped = st.n
    break
  }
}

// gates summary: from the gates step, or run once at the end
if (!stopped && gatesOut == null && !opt('--only')) {
  const st = { n: results.length ? Math.max(...results.map((r) => r.n)) + 1 : 1, name: 'gates', script: 'gates.mjs', args: [], shotArg: true, py: false }
  const res = exec(st, path.join(logDir, `${pad2(st.n)}-gates.log`))
  gatesOut = res.out
  results.push({ n: st.n, name: 'gates', status: res.code === 0 ? 'OK' : 'FAIL', seconds: +res.sec.toFixed(1), warnings: 0, log: logRel(st) })
}
if (gatesOut == null && stopped) {
  const last = results.at(-1)
  if (last?.name === 'gates' || steps.find((s) => s.n === last?.n)?.kind === 'gates') gatesOut = readFileSync(path.join(logDir, path.basename(last.log)), 'utf8')
}
const g = summarize(gatesOut ? gateLines(gatesOut) : [])
if (gatesOut != null) {
  console.log(`GATES PASS ${g.pass} · FAIL ${g.fail} · NOT_RUN ${g.notRun}`)
  for (const l of g.lines) console.log(l)
}
console.log('logs: ' + path.relative(shot.work, logDir).replace(/\\/g, '/') + '/')
writeFileSync(path.join(logDir, 'summary.json'), JSON.stringify({ revision, steps: results, gates: g }, null, 2))
process.exit(stopped ? 1 : g.fail ? 1 : 0)
