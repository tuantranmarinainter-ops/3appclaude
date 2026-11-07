/**
 * Measure a sandbox shot from the skeletons App 2 evaluates (no writes). Run through lib.runProbe() or directly:
 *   cd <shot.editor> && W01_LIBRARY=<lib> pnpm --filter @topview/3d-builder exec tsx <skill>/scripts/probe.mts <shot.json> [--prev <projectsDir> <projectId> <frame>]
 * Optional `--bones a,b` adds data[f][char].bones[name] = [x,y,z] (world position) and `bonesArg` to probe.json; probe.json also keeps `gates`.
 * Writes <work>/probe.json: data[frame][charKey] = { head, hip, torso, low, feet, bone? } and prints gates:
 *   CONTINUITY  max bone offset vs the previous shot's frame  (PASS <= 2 cm)
 *   SEAM_JUMP   world-rotation change per frame at clip seams (±3 frames), fingers ignored (PASS <= 20°)
 *   FLOOR       [char, from, grounded, maxUp=0.1]: lowest limb/torso point per frame (PASS >= -8 cm, and <= maxUp when grounded;
 *               Minecraft20 bones sit inside the body blocks: use maxUp 0.25 for MC20 characters)
 *   CONTACT     prop tip to target bone (+10 cm above it) at shot.contact.frame (PASS <= 15 cm)
 */
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
const shotFile = process.argv[2]
const shot = JSON.parse(readFileSync(shotFile, 'utf8')); shot.work ??= path.dirname(path.resolve(shotFile))
const { Matrix4, Quaternion, Vector3 } = await import(`file:///${shot.editor}/node_modules/.pnpm/node_modules/three/build/three.module.js`)
const studio = `${shot.editor}/apps/studio/src`
const store = await import(`file:///${studio}/unifiedProjectStore.ts`)
const ev = await import(`file:///${studio}/unifiedSkeletonEvaluation.ts`)
const argPrev = process.argv.indexOf('--prev')
const prev = argPrev > 0 ? { dir: process.argv[argPrev + 1]!, id: process.argv[argPrev + 2]!, frame: Number(process.argv[argPrev + 3]) } : shot.prev ?? null
const argBones = process.argv.indexOf('--bones')
const BONES: string[] = argBones > 0 ? process.argv[argBones + 1]!.split(',').filter(Boolean) : []
const END = (shot.end ?? 300) - 1
type Frames = Map<number, Map<string, number[]>>

async function sample(dir: string, id: string, start: number, end: number, charIds: string[]) {
  process.env.BBS_UNIFIED_PROJECTS_DIR = dir
  const project = await store.readUnifiedProject(id)
  const out = new Map<string, Frames>()
  for (const cid of charIds) {
    if (!project.characters[cid]) continue
    const frames: Frames = new Map()
    for await (const s of ev.sampleProjectSkeletonRange(project, { startFrame: start, endFrame: end, sampleFps: 30 }, [cid])) {
      const m = new Map(s.skeletonSamples[0]!.bones.map((b: { name: string; worldMatrix: number[] }) => [b.name, b.worldMatrix]))
      if (s.side === 'left') { if (!frames.has(s.frame)) frames.set(s.frame, m); continue }
      frames.set(s.frame, m)
    }
    out.set(cid, frames)
  }
  return { project, out }
}
const pos = (m: number[]) => new Vector3().setFromMatrixPosition(new Matrix4().fromArray(m))
const quat = (m: number[]) => { const q = new Quaternion(); new Matrix4().fromArray(m).decompose(new Vector3(), q, new Vector3()); return q }
const keys = Object.keys(shot.chars)
const ids = keys.map((k) => shot.chars[k].char)
const { project, out } = await sample(shot.projectsDir, shot.project, 0, END, ids)
const gates: Array<[string, string, string]> = []

if (prev) {
  const { out: before } = await sample(prev.dir, prev.id, prev.frame, prev.frame, ids)
  for (const k of keys) {
    const a = before.get(shot.chars[k].char)?.get(prev.frame), b = out.get(shot.chars[k].char)?.get(0)
    if (!a || !b) { gates.push(['CONTINUITY ' + k, 'NOT_RUN', 'character missing in one project']); continue }
    let worst = 0, name = ''
    for (const [n, m] of a) { const mb = b.get(n); if (!mb) continue; const d = pos(m).distanceTo(pos(mb)); if (d > worst) { worst = d; name = n } }
    gates.push(['CONTINUITY ' + k, worst <= 0.02 ? 'PASS' : 'FAIL', `${(worst * 100).toFixed(1)} cm (${name || '-'})`])
  }
}
const TORSO = /^(pelvis|spine_0[12]|chest|neck|head|body)$/i
const LIMB = /foot|toe|hand|head|pelvis|leg|arm|spine|neck|chest|clavicle|body/i
const pick = (m: Map<string, number[]>, re: RegExp) => [...m.entries()].find(([n]) => re.test(n))
const data: Record<number, Record<string, Record<string, number[]>>> = {}
for (let f = 0; f <= END; f++) {
  const row: Record<string, Record<string, number[]>> = {}
  for (const k of keys) {
    const m = out.get(shot.chars[k].char)?.get(f); if (!m) continue
    let torso = Infinity, low = Infinity
    for (const [n, w] of m) { const y = pos(w).y; if (TORSO.test(n)) torso = Math.min(torso, y); if (LIMB.test(n) && !/_end/i.test(n)) low = Math.min(low, y) }
    const head = pick(m, /^head$/i) ?? pick(m, /head/i), hip = pick(m, /^(cog|pelvis|hips?|body)$/i)
    const feetV = [pick(m, /^foot_l$|^low_left_leg$/i), pick(m, /^foot_r$|^low_leg_right$/i)].filter(Boolean).map((x) => pos(x![1]))
    const feet = feetV.length ? feetV.reduce((a, b) => a.clone().add(b)).multiplyScalar(1 / feetV.length).toArray() : [0, low, 0]
    row[k] = { head: pos(head![1]).toArray(), hip: hip ? pos(hip[1]).toArray() : pos(head![1]).toArray(), torso: [torso], low: [low], feet }
    const bone = shot.prop?.follow === k ? shot.prop.bone : shot.chars[k].hand
    if (bone && m.get(bone)) row[k].bone = m.get(bone)!
    if (BONES.length) { const bs: Record<string, number[]> = {}; for (const n of BONES) { const w = m.get(n); if (w) bs[n] = pos(w).toArray() } ;(row[k] as any).bones = bs }
  }
  if (Object.keys(row).length) data[f] = row
}
// seam jumps: frames within ±3 of any clip start
const seams = new Map<string, Set<number>>()
for (const c of project.scene.content.timeline.animation.motionClips) {
  const k = keys.find((x) => shot.chars[x].node === c.target.nodeId); if (!k || c.frameStart <= 0 || c.frameStart > END) continue
  const s = seams.get(k) ?? new Set<number>(); for (let f = c.frameStart - 1; f <= c.frameStart + (c.playback.blendIn?.frames ?? 0) + 3; f++) s.add(f); seams.set(k, s)
}
const fast = new Set<number>((shot.fastFrames ?? []).flatMap(([a, b]: number[]) => Array.from({ length: b - a + 1 }, (_, i) => a + i)))
for (const k of keys) {
  const frames = out.get(shot.chars[k].char)!; let prevQ: Map<string, Quaternion> | null = null, prevF = -1; const bad: string[] = []
  for (let f = 0; f <= END; f++) {
    const m = frames.get(f); if (!m) continue
    const cur = new Map<string, Quaternion>(); for (const [n, w] of m) cur.set(n, quat(w))
    const gap = Math.max(1, f - prevF)   // the sampler skips a few frames at seams: compare per frame
    if (prevQ && seams.get(k)?.has(f) && !fast.has(f)) {
      let worst = 0, wn = ''
      for (const [n, q] of cur) { if (/index|thumb|ring|middle|pinky|_end/i.test(n)) continue; const p = prevQ.get(n); if (!p) continue; const d = 2 * Math.acos(Math.min(1, Math.abs(q.dot(p)))) * 180 / Math.PI / gap; if (d > worst) { worst = d; wn = n } }
      if (worst > 20) bad.push(`${f}:${worst.toFixed(0)}°${wn}`)
    }
    prevQ = cur; prevF = f
  }
  gates.push(['SEAM_JUMP ' + k, bad.length ? 'FAIL' : 'PASS', bad.length ? bad.slice(0, 8).join(' ') : 'all seams <= 20°/frame (fast frames excluded: ' + (shot.fastFrames ?? []).map((r: number[]) => r.join('-')).join(',') + ')'])
}
for (const [k, from, grounded, maxUp] of (shot.floor ?? []) as Array<[string, number, boolean?, number?]>) {
  const lim = maxUp ?? 0.1
  if (!shot.chars[k]) { gates.push([`FLOOR ${k}`, 'NOT_RUN', 'unknown character key (see shot.json chars)']); continue }
  let min = Infinity, max = -Infinity, fmin = 0, fmax = 0
  for (let f = from; f <= END; f++) { const d = data[f]?.[k]; if (!d) continue; const v = Math.min(d.low[0]!, d.torso[0]!); if (v < min) { min = v; fmin = f } if (v > max) { max = v; fmax = f } }
  const ok = min >= -0.08 && (!grounded || max <= lim)
  gates.push([`FLOOR ${k} ${from}+`, ok ? 'PASS' : 'FAIL', `lowest point ${(min * 100).toFixed(0)} cm @${fmin}, highest ${(max * 100).toFixed(0)} cm @${fmax}${grounded ? ' (must stay on the floor)' : ''}`])
}
if (shot.contact && shot.prop) {
  let grip: number[] | null = null
  try { grip = JSON.parse(readFileSync(path.join(shot.work, 'grip.json'), 'utf8')) } catch { /* prop-follow not run yet */ }
  const f = shot.contact.frame, d = data[f]
  if (!grip || !d?.[shot.prop.follow]?.bone) { gates.push(['CONTACT', 'NOT_RUN', 'run prop-follow.mjs first']) } else {
    const tip = new Vector3(...(shot.prop.tip ?? [0, 1, 0])).applyMatrix4(new Matrix4().fromArray(d[shot.prop.follow]!.bone!).multiply(new Matrix4().fromArray(grip)))
    const target = new Vector3(...d[shot.contact.char]!.head).add(new Vector3(0, 0.1, 0))
    const dist = tip.distanceTo(target)
    gates.push([`CONTACT f${f}`, dist <= 0.15 ? 'PASS' : 'FAIL', `prop tip to ${shot.contact.char} head top ${(dist * 100).toFixed(1)} cm`])
  }
}
writeFileSync(path.join(shot.work, 'probe.json'), JSON.stringify({ revision: project.revision, data, ...(BONES.length ? { bonesArg: BONES } : {}), gates }))
console.log(`probe rev ${project.revision}, ${Object.keys(data).length} frames`)
for (const [g, s, msg] of gates) console.log(`${s.padEnd(7)} ${g.padEnd(24)} ${msg}`)
