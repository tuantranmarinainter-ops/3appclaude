// shot_measure: answers measuring questions from probe.json (floor / height / distance / contact / continuity / gates).
// Pure metric functions are exported for tests; run() ensures a fresh probe.json (re-runs probe.mts only when stale).
import { existsSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { getShot } from '../util.mjs'
import { runProbe } from '../../scripts/lib.mjs'

export const name = 'shot_measure'
export const description = 'Measures a shot from its sampled skeletons: floor (chui dat), height, distance, contact (prop tip vs head), continuity (vs previous shot), gates (non-PASS only). Output in cm, <= 20 lines.'
export const inputSchema = {
  type: 'object',
  properties: {
    shot: { type: 'string', description: 'shot.json path, folder or slug' },
    metric: { type: 'string', enum: ['floor', 'contact', 'distance', 'height', 'continuity', 'gates'] },
    char: { type: 'string', description: 'character key (shot.json chars); default: all (floor/continuity) or prop holder (contact)' },
    other: { type: 'string', description: 'second character key (distance, contact target head)' },
    bone: { type: 'string', description: 'bone name (height/distance); default: head/hip/feet' },
    frames: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2, description: '[from, to]' },
    step: { type: 'number', description: 'sampling step in frames (height/distance), default 10' },
  },
  required: ['shot', 'metric'],
}

const cm = (m) => Math.round(m * 100)
const frameList = (data, frames) => Object.keys(data).map(Number).sort((a, b) => a - b)
  .filter((f) => !frames || (f >= frames[0] && f <= frames[1]))
/** nearest sampled frame within 12 frames that has `key` */
export function nearRow(data, f, key) {
  for (let d = 0; d < 12; d++) for (const g of [f - d, f + d]) if (data[g]?.[key]) return [g, data[g][key]]
  return null
}
function ranges(fs) {
  const out = []
  for (const f of fs) { const l = out.at(-1); if (l && f - l[1] <= 3) l[1] = f; else out.push([f, f]) }
  return out.map(([a, b]) => (a === b ? `${a}` : `${a}-${b}`))
}
function sampleFrames(data, frames, step) {
  const all = frameList(data, frames); if (!all.length) return []
  const from = frames?.[0] ?? all[0], to = frames?.[1] ?? all.at(-1), out = []
  for (let f = from; f <= to; f += Math.max(1, step || 10)) out.push(f)
  if (out.at(-1) !== to) out.push(to)
  return out
}

/** Lowest point (min of limbs/torso) per frame; reports min, max and ranges below -2 cm. */
export function floorMetric(data, keys, frames, limit = -0.02) {
  return keys.map((k) => {
    let min = Infinity, max = -Infinity, fmin = 0, fmax = 0; const below = []
    for (const f of frameList(data, frames)) {
      const d = data[f][k]; if (!d) continue
      const v = Math.min(d.low[0], d.torso[0])
      if (v < min) { min = v; fmin = f }
      if (v > max) { max = v; fmax = f }
      if (v < limit) below.push([f, v])
    }
    if (min === Infinity) return `${k}: no data`
    let s = `${k}: min ${cm(min)} cm @${fmin}, max ${cm(max)} cm @${fmax}`
    if (below.length) {
      const worst = below.reduce((a, b) => (b[1] < a[1] ? b : a))
      s += `; ${ranges(below.map((x) => x[0])).join(',')} below floor, worst ${cm(worst[1])} cm @${worst[0]}`
    } else s += '; never below -2 cm'
    return s
  })
}

const point = (row, bone, what) => (bone ? row.bones?.[bone] : row[what ?? 'hip'] ?? null)

/** Y of a point sampled every `step` frames, one compact row per char. */
export function heightMetric(data, keys, { bone, point: what = 'hip', frames, step }) {
  return keys.map((k) => {
    const cells = []
    for (const f of sampleFrames(data, frames, step)) {
      const r = nearRow(data, f, k); const p = r && point(r[1], bone, what)
      if (p) cells.push(`${f}:${cm(p[1])}`)
    }
    return `${k} ${bone ?? what} Y cm: ${cells.join(' ') || 'no data'}`
  })
}

/** Horizontal (x,z) distance between two chars sampled every step; min/max with frames. */
export function distanceMetric(data, a, b, { bone, point: what = 'hip', frames, step }) {
  const rows = []
  for (const f of sampleFrames(data, frames, step)) {
    const ra = nearRow(data, f, a), rb = nearRow(data, f, b)
    const pa = ra && point(ra[1], bone, what), pb = rb && point(rb[1], bone, what)
    if (pa && pb) rows.push([f, Math.hypot(pa[0] - pb[0], pa[2] - pb[2])])
  }
  if (!rows.length) return [`${a}-${b}: no data${bone ? ` (bone ${bone} missing)` : ''}`]
  const mn = rows.reduce((x, y) => (y[1] < x[1] ? y : x)), mx = rows.reduce((x, y) => (y[1] > x[1] ? y : x))
  return [`${a} to ${b} ${bone ?? what} horizontal cm: ${rows.map(([f, d]) => `${f}:${cm(d)}`).join(' ')}`,
    `min ${cm(mn[1])} cm @${mn[0]}, max ${cm(mx[1])} cm @${mx[0]}`]
}

// column-major 4x4
export const mul = (a, b) => { const o = new Array(16).fill(0); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k]; return o }
export const apply = (m, [x, y, z]) => [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]]
/** Prop tip (holder bone matrix * grip * tip) to the head top (head + 10 cm) of `other`. */
export function contactMetric(data, { holder, other, grip, tip = [0, 1, 0], frames, gateFrame, headUp = 0.1 }) {
  const rows = []
  for (const f of frameList(data, frames)) {
    const h = data[f][holder], o = data[f][other]; if (!h?.bone || !o) continue
    const t = apply(mul(h.bone, grip), tip)
    rows.push([f, Math.hypot(t[0] - o.head[0], t[1] - (o.head[1] + headUp), t[2] - o.head[2])])
  }
  if (!rows.length) return [`contact: no data for ${holder} bone / ${other} head`]
  const best = rows.reduce((x, y) => (y[1] < x[1] ? y : x))
  const out = [`prop tip (${holder}) to ${other} head top: closest ${cm(best[1])} cm @${best[0]}`]
  const g = gateFrame != null && rows.find((r) => r[0] === gateFrame)
  if (g) out.push(`at gate frame ${gateFrame}: ${cm(g[1])} cm`)
  return out
}

const gateLines = (gates) => (gates ?? []).map(([g, s, m]) => ({ g, s, m }))
export function gatesMetric(gates) {
  const l = gateLines(gates); const bad = l.filter((x) => x.s !== 'PASS')
  const cnt = {}; for (const x of l) cnt[x.s] = (cnt[x.s] ?? 0) + 1
  return [`gates: ${Object.entries(cnt).map(([s, n]) => `${n} ${s}`).join(', ') || 'none'}`, ...bad.map((x) => `${x.s} ${x.g}: ${x.m}`)]
}
export function continuityMetric(gates, keys) {
  const l = gateLines(gates).filter((x) => x.g.startsWith('CONTINUITY') && (!keys || keys.includes(x.g.split(' ')[1])))
  return l.length ? l.map((x) => `${x.g.split(' ')[1]}: frame 0 vs previous shot ${x.m} [${x.s}]`) : ['continuity: no data (shot.prev missing or probe has no CONTINUITY gate)']
}

/** Fresh probe.json: re-run probe.mts only when missing, older than project.json, or lacking the requested bones. */
export async function ensureProbe(shot, bones = []) {
  const pf = path.join(shot.work, 'probe.json')
  const pj = path.join(shot.projectsDir, shot.project, 'project.json')
  let cached = null
  if (existsSync(pf) && (!existsSync(pj) || statSync(pf).mtimeMs >= statSync(pj).mtimeMs)) {
    try { cached = JSON.parse(readFileSync(pf, 'utf8')) } catch { cached = null }
  }
  const have = cached?.bonesArg ?? []
  // an old probe.json without "gates" (written before this tool existed) is re-probed once
  if (cached?.gates && bones.every((b) => have.includes(b))) return { ...cached, ran: false }
  const all = [...new Set([...have, ...bones])]
  await runProbe(shot, all.length ? ['--bones', all.join(',')] : [])
  return { ...JSON.parse(readFileSync(pf, 'utf8')), ran: true }
}

export async function run(args) {
  const shot = getShot(args.shot)
  const { metric, char, other, bone, frames } = args
  const step = args.step ?? 10
  const keys = Object.keys(shot.chars)
  for (const c of [char, other]) if (c && !shot.chars[c]) throw new Error(`unknown char "${c}" (have: ${keys.join(', ')})`)
  if (!['floor', 'contact', 'distance', 'height', 'continuity', 'gates'].includes(metric)) throw new Error(`unknown metric "${metric}"`)
  if (frames && (frames.length !== 2 || frames[0] > frames[1])) throw new Error('frames must be [from, to]')
  const p = await ensureProbe(shot, bone ? [bone] : [])
  const sel = char ? [char] : keys
  let lines
  if (metric === 'floor') lines = floorMetric(p.data, sel, frames)
  else if (metric === 'height') lines = heightMetric(p.data, sel, { bone, frames, step })
  else if (metric === 'distance') {
    if (!char || !other) throw new Error('distance needs char and other')
    lines = distanceMetric(p.data, char, other, { bone, frames, step })
  } else if (metric === 'contact') {
    if (!shot.prop) throw new Error('shot.json has no prop')
    const gp = path.join(shot.work, 'grip.json')
    if (!existsSync(gp)) throw new Error('grip.json missing in work folder: run prop-follow.mjs first')
    const target = other ?? shot.contact?.char
    if (!target) throw new Error('contact needs "other" (or shot.contact.char)')
    lines = contactMetric(p.data, { holder: char ?? shot.prop.follow, other: target, grip: JSON.parse(readFileSync(gp, 'utf8')), tip: shot.prop.tip, frames, gateFrame: shot.contact?.frame })
  } else if (metric === 'continuity') lines = continuityMetric(p.gates, char ? [char] : null)
  else lines = gatesMetric(p.gates)
  return [`${metric} (probe rev ${p.revision}${p.ran ? ', re-probed' : ', cached'})`, ...lines].slice(0, 20).join('\n')
}
