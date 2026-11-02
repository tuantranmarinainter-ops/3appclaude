/**
 * K2 measurement (docs/CLIP-BLEND-TASK-2026-11-02.md section 8) on a COPY of the Go Xua project.
 *
 *   BBS_UNIFIED_PROJECTS_DIR=S:\Claude\w01-samples\clip-blend-k2-projects \
 *   pnpm --filter @topview/3d-builder exec tsx <abs>/apps/studio/scripts/measureClipBlendK2.mts \
 *     [--project e901aadb-...] [--out report.json] [--hashes-only]
 *
 * Reads project.json directly (never writes). Samples through the studio skeleton sampler at 20 Hz.
 */
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { Matrix4, Quaternion, Vector3 } from 'three'
import { getBlendStatus } from '@topview/3d-builder/skeleton'
import type { UnifiedProject } from '@bbs/animation-workspace-shared'

const { values } = parseArgs({ options: { project: { type: 'string' }, out: { type: 'string' }, 'hashes-only': { type: 'boolean' }, dir: { type: 'string' } } })
const projectId = values.project ?? 'e901aadb-453f-4f69-b6f7-8eceda1f41f3'
const dir = values.dir ?? process.env.BBS_UNIFIED_PROJECTS_DIR
if (!dir) throw new TypeError('Set BBS_UNIFIED_PROJECTS_DIR to a COPY of the projects folder')
process.env.BBS_UNIFIED_PROJECTS_DIR = dir
const { sampleProjectSkeletonRange } = await import('../src/unifiedSkeletonEvaluation.ts')

const project = JSON.parse(readFileSync(path.join(dir, projectId, 'project.json'), 'utf8')) as UnifiedProject
const content = project.scene.content
const nodeId = 'user_chr_tazf97vk'
const characterId = Object.values(project.characters).find((c) => c.nodeId === nodeId)!.id
const clipA = 'user_mc_ma65pzdz'
const clipB = 'user_mc_osedj00q'
const fps = content.timeline.fps
const SAMPLE_FPS = 20

type Variant = (clips: any[]) => any[]
function variant(name: string, edit: Variant): UnifiedProject {
  const copy = structuredClone(project)
  const animation = copy.scene.content.timeline.animation
  animation.motionClips = edit(animation.motionClips).filter((c) => c.target.nodeId === nodeId)
  void name
  return copy
}
const blended = variant('blended', (c) => c)
const aOnly = variant('A only', (c) => c.filter((x) => x.id === clipA))
// B alone, same placement and no blend: the raw (un-aligned) B path.
const bOnly = variant('B only', (c) => c.filter((x) => x.id === clipB).map((x) => { delete x.playback.blendIn; return x }))
// Same two clips without blendIn at the original 59 placement: a "no blend" project.
const noBlend = variant('no blend', (c) => c.map((x) => { if (x.id === clipB) { delete x.playback.blendIn; x.frameStart = 59; x.frameEnd = 149 } return x }))

const B = blended.scene.content.timeline.animation.motionClips.find((c) => c.id === clipB)!
const zoneStart = B.frameStart
const zoneFrames = B.playback.blendIn!.frames
const zoneEnd = zoneStart + zoneFrames
const lastFrame = Math.min(content.timeline.frameEnd ?? 149, 149)

interface Sample { frame: number; bones: Map<string, { q: Quaternion; m: Matrix4 }>; actor: number[] }
async function sampleAll(p: UnifiedProject, startFrame: number, endFrame: number): Promise<Sample[]> {
  const out: Sample[] = []
  for await (const sample of sampleProjectSkeletonRange(p, { startFrame, endFrame, sampleFps: SAMPLE_FPS }, [characterId])) {
    if (sample.side === 'left') continue
    const skeleton = sample.skeletonSamples[0]!
    const bones = new Map<string, { q: Quaternion; m: Matrix4 }>()
    for (const bone of skeleton.bones) bones.set(bone.name, { q: new Quaternion().fromArray(bone.rotation), m: new Matrix4().fromArray(bone.worldMatrix) })
    out.push({ frame: sample.frame, bones, actor: skeleton.actorWorldMatrix })
  }
  return out
}

function hashSamples(samples: Sample[]): string {
  const hash = createHash('sha256')
  for (const s of samples) {
    hash.update(Buffer.from(Float64Array.from([s.frame]).buffer))
    for (const [name, bone] of [...s.bones].sort((a, b) => a[0].localeCompare(b[0]))) {
      hash.update(name)
      hash.update(Buffer.from(Float64Array.from(bone.m.elements).buffer))
      hash.update(Buffer.from(Float64Array.from(bone.q.toArray()).buffer))
    }
  }
  return hash.digest('hex')
}

const position = (m: Matrix4) => new Vector3().setFromMatrixPosition(m)
function rootPoint(s: Sample) {
  const l = position(s.bones.get('Upper_Leg_L')!.m), r = position(s.bones.get('Upper_Leg_R')!.m)
  const d = l.clone().sub(r)
  return { x: (l.x + r.x) / 2, z: (l.z + r.z) / 2, yaw: Math.atan2(d.x, d.z) }
}
const wrap = (a: number) => { let v = a % (2 * Math.PI); if (v > Math.PI) v -= 2 * Math.PI; if (v <= -Math.PI) v += 2 * Math.PI; return v }

const nearest = (samples: Sample[], frame: number) => samples.reduce((best, s) => Math.abs(s.frame - frame) < Math.abs(best.frame - frame) ? s : best)

const result: Record<string, unknown> = { project: projectId, zone: { startFrame: zoneStart, frames: zoneFrames, endFrame: zoneEnd, fps, sampleFps: SAMPLE_FPS } }

const GRID_START = 2 // 44 = 2 + 28 * 1.5, so zone start and end fall exactly on the 20 Hz grid
const noBlendSamples = await sampleAll(noBlend, GRID_START, lastFrame)
result.noBlendHash = hashSamples(noBlendSamples)
const blendedSamples = await sampleAll(blended, GRID_START, lastFrame)
result.preZoneHash = hashSamples(blendedSamples.filter((s) => s.frame < zoneStart - 1e-9))
result.preZoneSamples = blendedSamples.filter((s) => s.frame < zoneStart - 1e-9).length
result.noBlendSamples = noBlendSamples.length
if (values['hashes-only']) {
  console.log(JSON.stringify(result, null, 2))
  if (values.out) writeFileSync(values.out, JSON.stringify(result, null, 2))
  process.exit(0)
}

// 1. Jerk: max local-rotation angular velocity per bone in the zone vs the 10 ticks (0.5 s) before and after.
const preFrames = (10 / SAMPLE_FPS) * fps
function angularVelocity(samples: Sample[], from: number, to: number, bone: string): number {
  let max = 0
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1]!, b = samples[i]!
    if (a.frame < from - 1e-9 || b.frame > to + 1e-9) continue
    const dt = (b.frame - a.frame) / fps
    const angle = 2 * Math.acos(Math.min(1, Math.abs(a.bones.get(bone)!.q.dot(b.bones.get(bone)!.q))))
    max = Math.max(max, angle / dt)
  }
  return max
}
const boneNames = [...blendedSamples[0]!.bones.keys()].filter((n) => !/_end/.test(n))
const jerk = boneNames.map((name) => {
  const zone = angularVelocity(blendedSamples, zoneStart, zoneEnd, name)
  const pre = angularVelocity(blendedSamples, zoneStart - preFrames, zoneStart, name)
  const post = angularVelocity(blendedSamples, zoneEnd, zoneEnd + preFrames, name)
  const reference = Math.max(pre, post)
  return { name, zone, pre, post, reference, ratio: reference > 1e-9 ? zone / reference : (zone > 1e-9 ? Infinity : 0) }
})
const significant = jerk.filter((j) => j.reference >= 0.5) // rad/s: ignore bones that hardly move outside the zone
const worst = [...significant].sort((a, b) => b.ratio - a.ratio).slice(0, 5)
result.jerk = {
  rule: 'zone max angular velocity <= 1.5 x max(pre 10 ticks, post 10 ticks), bones with reference >= 0.5 rad/s',
  consideredBones: significant.length, totalBones: jerk.length,
  worstRatio: worst[0]?.ratio ?? 0, worst,
  failing: significant.filter((j) => j.ratio > 1.5).map((j) => ({ name: j.name, ratio: j.ratio })),
  pass: significant.every((j) => j.ratio <= 1.5),
}

// 2. Foot drift during lock windows (full-strength part) from the sampler output.
const status = getBlendStatus(clipB)
result.status = status
const footBone = { left: 'Foot_L', right: 'Foot_R' } as const
const drifts: Array<{ side: string; startFrame: number; endFrame: number; samples: number; driftCm: number; verticalCm: number }> = []
for (const lock of status?.locks ?? []) {
  const window = blendedSamples.filter((s) => s.frame >= lock.startFrame - 1e-9 && s.frame <= lock.endFrame + 1e-9)
  if (window.length < 2) continue
  const p0 = position(window[0]!.bones.get(footBone[lock.side])!.m)
  let drift = 0, vertical = 0
  for (const s of window) {
    const p = position(s.bones.get(footBone[lock.side])!.m)
    drift = Math.max(drift, Math.hypot(p.x - p0.x, p.z - p0.z))
    vertical = Math.max(vertical, Math.abs(p.y - p0.y))
  }
  drifts.push({ side: lock.side, startFrame: lock.startFrame, endFrame: lock.endFrame, samples: window.length, driftCm: drift * 100, verticalCm: vertical * 100 })
}
result.footDrift = { rule: 'locked foot horizontal drift <= 1 cm over the lock window', locks: drifts, maxCm: Math.max(0, ...drifts.map((d) => d.driftCm)), pass: !!status?.locks.length && drifts.length > 0 && drifts.every((d) => d.driftCm <= 1) }

// 3. Root continuity: independent T from A-only and B-only variants, compare against the blended project after the zone.
const aSamples = await sampleAll(aOnly, GRID_START, lastFrame)
const bSamples = await sampleAll(bOnly, GRID_START, lastFrame)
const rA = rootPoint(nearest(aSamples, zoneStart))
const rB = rootPoint(nearest(bSamples, zoneStart))
const yawT = wrap(rA.yaw - rB.yaw)
const cos = Math.cos(yawT), sin = Math.sin(yawT)
const tx = rA.x - (rB.x * cos + rB.z * sin), tz = rA.z - (-rB.x * sin + rB.z * cos)
const afterZone = blendedSamples.filter((s) => s.frame >= zoneEnd - 1e-9 && s.frame <= B.frameEnd)
const rootErrors = afterZone.map((s) => {
  const raw = rootPoint(nearest(bSamples, s.frame))
  const expected = { x: raw.x * cos + raw.z * sin + tx, z: -raw.x * sin + raw.z * cos + tz, yaw: wrap(raw.yaw + yawT) }
  const got = rootPoint(s)
  return { frame: s.frame, posCm: Math.hypot(got.x - expected.x, got.z - expected.z) * 100, yawDeg: Math.abs(wrap(got.yaw - expected.yaw)) * 180 / Math.PI }
})
const first = rootErrors[0]!
if (process.env.K2DBG) console.error("RERR", JSON.stringify(rootErrors.filter((e) => e.posCm > 1).slice(0, 12)))
if (process.env.K2DBG) for (const frame of [44, 50, 58.5, 59, 60.5, 80]) console.error("DBG", frame, JSON.stringify({ blended: rootPoint(nearest(blendedSamples, frame)), bRaw: rootPoint(nearest(bSamples, frame)), aRaw: rootPoint(nearest(aSamples, frame)) }), JSON.stringify({ T: [tx, tz, yawT] }))
const atStart = rootPoint(nearest(blendedSamples, zoneStart))
result.rootContinuity = {
  rule: 'root after zone vs aligned B (independent T from A-only/B-only variants): <= 1 cm and <= 1 deg',
  appliedAlignment: { translateWorldM: Math.hypot(rA.x - rB.x, rA.z - rB.z), yawDeg: yawT * 180 / Math.PI, statusText: status ? { offsetMeters: status.offsetMeters, yawDegrees: status.yawDegrees } : null },
  zoneStartVsA: { posCm: Math.hypot(atStart.x - rA.x, atStart.z - rA.z) * 100, yawDeg: Math.abs(wrap(atStart.yaw - rA.yaw)) * 180 / Math.PI },
  firstAfterZone: first,
  maxAfterZone: { posCm: Math.max(...rootErrors.map((e) => e.posCm)), yawDeg: Math.max(...rootErrors.map((e) => e.yawDeg)) },
  pass: first.posCm <= 1 && first.yawDeg <= 1 && rootErrors.every((e) => e.posCm <= 1 && e.yawDeg <= 1),
}

// 4. Continuity of the root point across the zone: largest per-tick jump vs. the same quantity in A/B alone.
function stepJump(samples: Sample[], from: number, to: number) {
  let max = 0
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1]!, b = samples[i]!
    if (a.frame < from - 1e-9 || b.frame > to + 1e-9) continue
    const pa = rootPoint(a), pb = rootPoint(b)
    max = Math.max(max, Math.hypot(pb.x - pa.x, pb.z - pa.z))
  }
  return max * 100
}
result.rootStepCm = { zone: stepJump(blendedSamples, zoneStart - 2, zoneEnd + 2), a: stepJump(aSamples, 0, zoneStart), b: stepJump(bSamples, zoneEnd, lastFrame) }

console.log(JSON.stringify(result, null, 2))
if (values.out) writeFileSync(values.out, JSON.stringify(result, null, 2))
