import * as THREE from 'three'
import type { MotionClip } from '../../contract/types'
import { motionBlendInOf, motionBlendPartner, motionBlendWeight, motionPhaseOffsetSeconds, motionSourceLengthSeconds, motionTimeSeconds } from '../../evaluate/clips'
import { directAnimationFor } from './clipMirror'
import { isFbxBoneAlias } from '../../evaluate/retarget/fbxSourceBones'
import {
  alignmentMatrix, alignRoot, isFootPlanted, isIdentityAlignment, lockStrength, plantedRuns, solveKnee, yawOf,
  type PlantOptions, type RootAlignment, type RootPoint,
} from './footLockMath'
import { setBlendStatus, type BlendLockRun, type BlendStatus, type FootLead } from './blendStatus'
import { sampledTransform } from './rootMotion'
import type { StageGraph } from './graph'
import type { CharInstance } from './types'

/** Tốc độ ngang tối đa (m/s thế giới) và độ cao tối đa (m) để coi bàn chân là đang chạm đất. */
export const PLANT_MAX_SPEED_MPS = 0.3
export const PLANT_MAX_HEIGHT_M = 0.1
/** Nhả khóa tối thiểu 0,125 s (2–3 tick 20 Hz) khi bàn chân nhấc lên trong lúc trộn. */
export const LOCK_EASE_SECONDS = 0.125
/**
 * K3: bàn chân còn chạm đất tới hết vùng trộn (đứng ở cả hai clip nhưng lệch nhau) thì giữ khóa 100% tới điểm này
 * (tỉ lệ của vùng trộn) rồi nhả smootherstep suốt phần còn lại của vùng, thay vì chỉ 0,125 s cuối vùng.
 */
export const LOCK_RELEASE_FRACTION = 0.35
/** Giữ khóa 100% tối thiểu số khung này trước khi bắt đầu nhả. */
export const LOCK_MIN_HOLD_FRAMES = 2
/** Hai bàn chân lệch nhau dưới ngưỡng này (mét) theo hướng đi thì coi là không có chân trước. */
export const LEAD_MIN_DIFF_M = 0.03
/** Khớp nhịp: tìm trong tối đa chừng này giây (hoặc một vòng động tác gốc nếu ngắn hơn). */
export const PHASE_SEARCH_SECONDS = 1.5
export const PHASE_SEARCH_STEP_SECONDS = 0.02

interface Parts { p: THREE.Vector3; q: THREE.Quaternion; s: THREE.Vector3 }
type LocalFn = (object: THREE.Object3D) => Parts

interface FootRig {
  side: 'left' | 'right'
  thigh: THREE.Object3D
  shin: THREE.Object3D
  foot: THREE.Object3D
  toe: THREE.Object3D | null
}

interface RigInfo {
  feet: FootRig[]
  hips: THREE.Object3D | null
  /** Nút con trực tiếp của `inner` chứa xương: nơi áp phép căn cứng. */
  top: Set<THREE.Object3D>
  /** Giá trị rest của nút trên cùng (nút không tên không có trong restPos nên phải nhớ lúc dựng). */
  topRest: Map<THREE.Object3D, Parts>
}

interface LockPlan {
  side: 'left' | 'right'
  startFrame: number
  /** Khung cuối còn khóa 100% (đã kẹp để độ mạnh về 0 đúng cuối vùng trộn). */
  endFrame: number
  ease: number
  hold: THREE.Vector3
}

export interface BlendPlan {
  sig: string
  /** Phép căn cứng của clip sau trong không gian actor; null khi không căn được. */
  matrix: THREE.Matrix4 | null
  alignment: RootAlignment | null
  locks: LockPlan[]
  status: BlendStatus
}

const rigCache = new WeakMap<CharInstance, RigInfo>()
const planCache = new WeakMap<CharInstance, Map<string, BlendPlan>>()
const restClip = new THREE.AnimationClip('rest', 0, [])

const canonical = (name: string) => name.split(':').pop()!.replace(/^mixamorig[0-9]*/i, '').replace(/[^a-z0-9]/gi, '').toLowerCase()

function nameSets(side: 'left' | 'right') {
  const w = side, s = side === 'left' ? 'l' : 'r'
  return {
    thigh: [`${w}upleg`, `upperleg${s}`, `${w}thigh`, `thigh${s}`, `${w}upperleg`],
    shin: [`${w}leg`, `lowerleg${s}`, `${w}calf`, `calf${s}`, `${w}shin`, `shin${s}`, `${w}lowerleg`],
    foot: [`${w}foot`, `foot${s}`],
    toe: [`${w}toebase`, `toe${s}`, `${w}toe`],
  }
}

function hasBone(object: THREE.Object3D): boolean {
  if ((object as THREE.Bone).isBone) return true
  return object.children.some(hasBone)
}

function rigInfo(ch: CharInstance): RigInfo {
  const cached = rigCache.get(ch)
  if (cached) return cached
  const byName = new Map<string, THREE.Object3D>()
  ch.inner.traverse((object) => {
    if (!object.name || isFbxBoneAlias(object)) return
    const key = canonical(object.name)
    const before = byName.get(key)
    if (!before || (!(before as THREE.Bone).isBone && (object as THREE.Bone).isBone)) byName.set(key, object)
  })
  const pick = (names: string[]) => { for (const name of names) { const hit = byName.get(name); if (hit) return hit } return null }
  const feet: FootRig[] = []
  for (const side of ['left', 'right'] as const) {
    const sets = nameSets(side)
    const thigh = pick(sets.thigh), shin = pick(sets.shin), foot = pick(sets.foot)
    if (thigh && shin && foot && shin.parent === thigh && foot.parent === shin) feet.push({ side, thigh, shin, foot, toe: pick(sets.toe) })
  }
  const top = ch.inner.children.filter((child) => !(child as THREE.Mesh).isMesh && hasBone(child))
  const info: RigInfo = {
    feet,
    hips: pick(['hips', 'pelvis', 'cog']),
    top: new Set(top),
    topRest: new Map(top.map((object) => [object, { p: object.position.clone(), q: object.quaternion.clone(), s: object.scale.clone() }])),
  }
  rigCache.set(ch, info)
  return info
}

const fromTransform = (t: { position: THREE.Vector3; rotation: THREE.Quaternion; scale: THREE.Vector3 }): Parts => ({ p: t.position, q: t.rotation, s: t.scale })

function composeParts(parts: Parts, out = new THREE.Matrix4()): THREE.Matrix4 {
  return out.compose(parts.p, parts.q, parts.s)
}

function partsOfMatrix(matrix: THREE.Matrix4): Parts {
  const parts: Parts = { p: new THREE.Vector3(), q: new THREE.Quaternion(), s: new THREE.Vector3() }
  matrix.decompose(parts.p, parts.q, parts.s)
  return parts
}

/** Đặt `actor` lên thế giới: tích các ma trận cục bộ từ `object` lên tới gốc (motionRoot hoặc root). */
function actorMatrix(ch: CharInstance, object: THREE.Object3D | null, local: LocalFn): THREE.Matrix4 {
  const stop = ch.motionRoot ?? ch.root
  const result = new THREE.Matrix4()
  const tmp = new THREE.Matrix4()
  for (let o = object; o && o !== stop; o = o.parent) result.premultiply(composeParts(local(o), tmp))
  return result
}

interface PoseSource { animation: THREE.AnimationClip; time: number; align: THREE.Matrix4 | null }

/** Cục bộ gốc của một nút: track/rest; nút trên cùng không tên dùng rest đã nhớ (restPos không có nó). */
function baseParts(ch: CharInstance, rig: RigInfo, animation: THREE.AnimationClip, object: THREE.Object3D, time: number): Parts {
  const rest = rig.topRest.get(object)
  if (rest && !object.name) return { p: rest.p.clone(), q: rest.q.clone(), s: rest.s.clone() }
  return fromTransform(sampledTransform(ch, animation, object, time))
}

/** Cục bộ lấy mẫu từ track của clip, có áp phép căn cứng `align` lên các nút trên cùng. */
function sourceLocal(ch: CharInstance, rig: RigInfo, source: PoseSource): LocalFn {
  let inverseInner: THREE.Matrix4 | null = null
  let inner: THREE.Matrix4 | null = null
  return (object) => {
    const parts = baseParts(ch, rig, source.animation, object, source.time)
    if (!source.align || !rig.top.has(object)) return parts
    if (!inner) {
      inner = composeParts(fromTransform(sampledTransform(ch, source.animation, ch.inner, source.time)))
      inverseInner = inner.clone().invert()
    }
    const matrix = inverseInner!.clone().multiply(source.align).multiply(inner).multiply(composeParts(parts))
    return partsOfMatrix(matrix)
  }
}

function blendLocal(a: LocalFn, b: LocalFn, weight: number): LocalFn {
  return (object) => {
    const x = a(object), y = b(object)
    return { p: x.p.clone().lerp(y.p, weight), q: x.q.clone().slerp(y.q, weight), s: x.s.clone().lerp(y.s, weight) }
  }
}

const restLocal = (ch: CharInstance, rig: RigInfo): LocalFn => (object) => baseParts(ch, rig, restClip, object, 0)

const positionOf = (matrix: THREE.Matrix4) => new THREE.Vector3().setFromMatrixPosition(matrix)

function unitScale(ch: CharInstance): number {
  const scale = ch.node.transform?.scale
  const modelUnit = (ch.node.metadata as { modelUnitMeters?: unknown } | undefined)?.modelUnitMeters
  return Math.abs(scale?.y ?? 1) * (typeof modelUnit === 'number' && modelUnit > 0 ? modelUnit : 1)
}

function isSkeletal(clip: MotionClip): boolean {
  const policy = clip.motion.rootMotion?.policy
  return policy === undefined || policy === 'skeletal'
}

function rootPoint(ch: CharInstance, rig: RigInfo, local: LocalFn): RootPoint | null {
  if (rig.feet.length === 2) {
    const l = positionOf(actorMatrix(ch, rig.feet.find((f) => f.side === 'left')!.thigh, local))
    const r = positionOf(actorMatrix(ch, rig.feet.find((f) => f.side === 'right')!.thigh, local))
    return { x: (l.x + r.x) / 2, z: (l.z + r.z) / 2, yaw: yawOf(l.x - r.x, l.z - r.z) }
  }
  if (rig.hips) {
    const matrix = actorMatrix(ch, rig.hips, local)
    const parts = partsOfMatrix(matrix)
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(parts.q)
    return { x: parts.p.x, z: parts.p.z, yaw: yawOf(forward.x, forward.z) }
  }
  return null
}

function animationOf(graph: StageGraph, ch: CharInstance, clip: MotionClip): THREE.AnimationClip | null {
  return directAnimationFor(graph.motionPlayer, ch, clip)
}

function clipSig(clip: MotionClip): string {
  return JSON.stringify([clip.id, clip.frameStart, clip.frameEnd, clip.sourceDuration, clip.motion.assetId, clip.motion.clipIndex ?? 0,
    clip.motion.time, clip.motion.sourceLengthSeconds ?? null, clip.motion.reverse ?? false, clip.motion.rootMotion?.policy ?? null, clip.playback])
}

/** Tính (và nhớ) kế hoạch căn chỗ đứng + khóa chân cho clip sau `clip` có blendIn. Null nếu chưa tính được. */
export function blendPlanFor(graph: StageGraph, ch: CharInstance, clip: MotionClip): BlendPlan | null {
  if (ch.rig !== 'direct' || !graph.doc) return null
  const blend = motionBlendInOf(clip)
  if (!blend) return null
  const content = graph.doc.content
  const nodeClips = content.timeline.animation.motionClips.filter((c) => c.target.nodeId === clip.target.nodeId)
  const partner = motionBlendPartner(nodeClips, clip)
  if (!partner) return null
  const animB = animationOf(graph, ch, clip)
  const animA = animationOf(graph, ch, partner)
  if (!animA || !animB) return null
  const planA = blendPlanFor(graph, ch, partner)
  const fps = content.timeline.fps
  const unit = unitScale(ch)
  const sig = JSON.stringify([clipSig(clip), clipSig(partner), blend.frames, blend.curve, fps, unit, planA?.sig ?? null])
  let cache = planCache.get(ch)
  if (!cache) { cache = new Map(); planCache.set(ch, cache) }
  const hit = cache.get(clip.id)
  if (hit && hit.sig === sig) return hit

  const plan = computePlan({ ch, clip, partner, animA, animB, planA, fps, unit, blend, sig })
  cache.set(clip.id, plan)
  setBlendStatus(clip.id, plan.status)
  return plan
}

/** Chân trước = bàn chân xa hơn về phía trước (theo hướng mặt suy từ hai đùi) so với trung điểm hai đùi. */
function leadOf(ch: CharInstance, rig: RigInfo, local: LocalFn, unit: number): { lead: FootLead | null; diff: number } | null {
  const left = rig.feet.find((foot) => foot.side === 'left'), right = rig.feet.find((foot) => foot.side === 'right')
  if (!left || !right) return null
  const tl = positionOf(actorMatrix(ch, left.thigh, local)), tr = positionOf(actorMatrix(ch, right.thigh, local))
  const dx = tl.x - tr.x, dz = tl.z - tr.z
  const length = Math.hypot(dx, dz)
  if (!(length > 1e-9)) return null
  const fx = -dz / length, fz = dx / length
  const mx = (tl.x + tr.x) / 2, mz = (tl.z + tr.z) / 2
  const al = positionOf(actorMatrix(ch, left.foot, local)), ar = positionOf(actorMatrix(ch, right.foot, local))
  const diff = ((al.x - mx) * fx + (al.z - mz) * fz) - ((ar.x - mx) * fx + (ar.z - mz) * fz)
  return { lead: Math.abs(diff) < LEAD_MIN_DIFF_M / unit ? null : diff > 0 ? 'left' : 'right', diff }
}

function computePlan(args: {
  ch: CharInstance; clip: MotionClip; partner: MotionClip; animA: THREE.AnimationClip; animB: THREE.AnimationClip
  planA: BlendPlan | null; fps: number; unit: number; blend: NonNullable<ReturnType<typeof motionBlendInOf>>; sig: string
}): BlendPlan {
  const { ch, clip, partner, animA, animB, planA, fps, unit, blend, sig } = args
  const rig = rigInfo(ch)
  const zoneStart = clip.frameStart
  const frames = blend.frames
  const zoneEnd = zoneStart + frames
  const skeletal = isSkeletal(clip) && isSkeletal(partner)
  const timeOf = (c: MotionClip, frame: number) => motionTimeSeconds(c, frame, fps, false, false)
  const sourceA = (frame: number): PoseSource => ({ animation: animA, time: timeOf(partner, frame), align: planA?.matrix ?? null })
  const rawB = (frame: number): PoseSource => ({ animation: animB, time: timeOf(clip, frame), align: null })

  // 1. Nối tiếp chỗ đứng: B (cả clip) dời + xoay yaw cứng sao cho tại khung bắt đầu trộn gốc B trùng gốc A.
  let alignment: RootAlignment | null = null
  let matrix: THREE.Matrix4 | null = null
  if (skeletal) {
    const pa = rootPoint(ch, rig, sourceLocal(ch, rig, sourceA(zoneStart)))
    const pb = rootPoint(ch, rig, sourceLocal(ch, rig, rawB(zoneStart)))
    if (pa && pb) {
      alignment = alignRoot(pa, pb)
      if (!isIdentityAlignment(alignment)) matrix = alignmentMatrix(alignment)
    }
  }
  const sourceB = (frame: number): PoseSource => ({ animation: animB, time: timeOf(clip, frame), align: matrix })

  // 2. Khóa chân: phát hiện chân chạm đất trong từng nguồn (theo thời gian đã áp speed/lặp), giữ vị trí actor.
  const locks: LockPlan[] = []
  if (blend.footLock && skeletal && rig.feet.length) {
    const rest = restLocal(ch, rig)
    const restAnkle = rig.feet.map((foot) => positionOf(actorMatrix(ch, foot.foot, rest)))
    const restToe = rig.feet.map((foot) => foot.toe ? positionOf(actorMatrix(ch, foot.toe, rest)) : null)
    const floorY = Math.min(...restAnkle.map((p) => p.y), ...restToe.filter((p): p is THREE.Vector3 => !!p).map((p) => p.y))
    const options: PlantOptions = { maxSpeed: PLANT_MAX_SPEED_MPS / unit, maxHeight: PLANT_MAX_HEIGHT_M / unit }
    const count = frames + 1
    const sampleFrames = Array.from({ length: count }, (_, i) => zoneStart + i)
    const weights = sampleFrames.map((_, i) => i >= frames ? 1 : motionBlendWeight(blend.curve, i / frames))
    const poseA = sampleFrames.map((f) => sourceLocal(ch, rig, sourceA(f)))
    const poseB = sampleFrames.map((f) => sourceLocal(ch, rig, sourceB(f)))
    const poseMix = sampleFrames.map((_, i) => blendLocal(poseA[i], poseB[i], weights[i]))
    const secondsPerStep = 1 / fps

    rig.feet.forEach((foot, footIndex) => {
      const ankleOf = (locals: LocalFn[]) => locals.map((local) => positionOf(actorMatrix(ch, foot.foot, local)))
      const lowOf = (locals: LocalFn[], ankles: THREE.Vector3[]) => locals.map((local, i) => {
        const ankleHeight = restAnkle[footIndex].y - floorY
        let low = ankles[i].y - ankleHeight
        if (foot.toe) low = Math.min(low, positionOf(actorMatrix(ch, foot.toe, local)).y)
        return low - floorY
      })
      const speedsOf = (ankles: THREE.Vector3[]) => ankles.map((_, i) => {
        const a = ankles[Math.max(0, i - 1)], b = ankles[Math.min(ankles.length - 1, i + 1)]
        const span = (Math.min(ankles.length - 1, i + 1) - Math.max(0, i - 1)) * secondsPerStep
        return span > 0 ? Math.hypot(b.x - a.x, b.z - a.z) / span : 0
      })
      const ankleA = ankleOf(poseA), ankleB = ankleOf(poseB), ankleMix = ankleOf(poseMix)
      const lowA = lowOf(poseA, ankleA), lowB = lowOf(poseB, ankleB)
      const speedA = speedsOf(ankleA), speedB = speedsOf(ankleB)
      const flags = sampleFrames.map((_, i) => weights[i] < 0.5
        ? isFootPlanted(speedA[i], lowA[i], options)
        : isFootPlanted(speedB[i], lowB[i], options))
      const shortEase = LOCK_EASE_SECONDS * fps
      for (const [first, last] of plantedRuns(flags)) {
        if (last - first < 1) continue
        const runStart = zoneStart + first
        let end: number, ease: number
        if (last >= count - 1 && frames > shortEase) {
          // Chân còn chạm đất tới hết vùng trộn nhưng lệch chỗ giữa A và B: nhả smootherstep suốt phần còn lại của vùng.
          end = Math.min(Math.max(zoneStart + LOCK_RELEASE_FRACTION * frames, runStart + LOCK_MIN_HOLD_FRAMES), zoneEnd - shortEase)
          ease = zoneEnd - end
        } else {
          ease = shortEase
          end = Math.min(zoneStart + last, zoneEnd - ease)
        }
        if (end <= runStart) continue
        locks.push({ side: foot.side, startFrame: runStart, endFrame: end, ease, hold: ankleMix[first].clone() })
      }
    })
  }

  // 3. Nhịp bước: chân trước của A (tại khung bắt đầu trộn) so với chân trước của B (đã lật/dời nhịp, đã căn).
  let leadA: FootLead | null = null, leadB: FootLead | null = null
  let suggested: number | null = null
  const phase = motionPhaseOffsetSeconds(clip)
  if (skeletal && rig.feet.length === 2) {
    const a = leadOf(ch, rig, sourceLocal(ch, rig, sourceA(zoneStart)), unit)
    const b = leadOf(ch, rig, sourceLocal(ch, rig, sourceB(zoneStart)), unit)
    leadA = a?.lead ?? null
    leadB = b?.lead ?? null
    if (leadA) {
      const window = Math.min(PHASE_SEARCH_SECONDS, motionSourceLengthSeconds(clip))
      const steps = Math.floor(window / PHASE_SEARCH_STEP_SECONDS + 1e-9)
      for (let i = 0; i <= steps; i++) {
        const offset = Math.round(i * PHASE_SEARCH_STEP_SECONDS * 1000) / 1000
        const test: MotionClip = { ...clip, playback: { ...clip.playback, blendIn: { ...blend, phaseOffsetSeconds: offset } } }
        const pose = sourceLocal(ch, rig, { animation: animB, time: timeOf(test, zoneStart), align: null })
        if (leadOf(ch, rig, pose, unit)?.lead === leadA) { suggested = offset; break }
      }
    }
  }

  const status: BlendStatus = {
    leadA, leadB, leadMismatch: !!leadA && !!leadB && leadA !== leadB,
    mirror: !!blend.mirror, phaseOffsetSeconds: phase, suggestedPhaseSeconds: suggested,
    offsetMeters: alignment ? alignment.distance * unit : 0,
    yawDegrees: alignment ? alignment.yawDegrees : 0,
    aligned: !!alignment,
    locks: locks.map((lock): BlendLockRun => ({ side: lock.side, startFrame: lock.startFrame, endFrame: lock.endFrame, easeFrames: lock.ease })),
  }
  return { sig, matrix, alignment, locks, status }
}

const rigLocalNow = (ch: CharInstance): LocalFn => (object) => ({
  p: object === ch.inner ? new THREE.Vector3() : object.position.clone(), q: object.quaternion.clone(), s: object.scale.clone(),
})

/** Nhân vật có nút trên cùng đã bị dời bởi phép căn: nút không có track sẽ giữ giá trị đó nên phải trả về rest ở đầu khung kế. */
const alignedDirty = new Set<CharInstance>()

export function resetBlendAlignment(): void {
  if (!alignedDirty.size) return
  for (const ch of alignedDirty) {
    for (const [object, rest] of rigInfo(ch).topRest) {
      object.position.copy(rest.p); object.quaternion.copy(rest.q); object.scale.copy(rest.s)
    }
  }
  alignedDirty.clear()
}

/**
 * Sau khi clip sau đã lấy mẫu vào xương: áp phép căn cứng lên các nút trên cùng (không đổi gì nếu không có phép căn).
 * Giá trị gốc của nút trên cùng lấy từ track/rest (không từ trạng thái hiện tại) để phép căn không cộng dồn qua các khung.
 */
export function applyBlendAlignment(graph: StageGraph, ch: CharInstance, clip: MotionClip, timeSeconds: number): void {
  if (!motionBlendInOf(clip)) return
  const plan = blendPlanFor(graph, ch, clip)
  if (!plan?.matrix) return
  const animation = animationOf(graph, ch, clip)
  if (!animation) return
  const rig = rigInfo(ch)
  const bones: THREE.Object3D[] = []
  // Mọi nút không phải mesh dưới inner: stopAll khôi phục cả nút không phải xương có track.
  ch.inner.traverse((object) => { if (object !== ch.inner && !(object as THREE.Mesh).isMesh) bones.push(object) })
  const targets = [...new Set([...bones, ...rig.top])]
  const inner = composeParts(fromTransform(sampledTransform(ch, animation, ch.inner, timeSeconds)))
  const inverseInner = inner.clone().invert()
  const saved = targets.map((object) => ({ object, p: object.position.clone(), q: object.quaternion.clone(), s: object.scale.clone() }))
  for (const item of saved) {
    if (!rig.top.has(item.object)) continue
    const base = baseParts(ch, rig, animation, item.object, timeSeconds)
    const next = partsOfMatrix(inverseInner.clone().multiply(plan.matrix).multiply(inner).multiply(composeParts(base)))
    item.p = next.p; item.q = next.q; item.s = next.s
  }
  // AnimationMixer chỉ ghi xương khi mẫu đổi và dừng action sẽ khôi phục trạng thái gốc: dừng trước, ghi sau.
  ch.animator.stopAll()
  for (const item of saved) { item.object.position.copy(item.p); item.object.quaternion.copy(item.q); item.object.scale.copy(item.s) }
  alignedDirty.add(ch)
}

/** Trong vùng trộn: giữ cổ chân đang chạm đất tại vị trí actor đã khóa, giải IK 2 xương (đùi–cẳng), giữ hướng bàn chân. */
export function applyBlendFootLock(graph: StageGraph, ch: CharInstance, clip: MotionClip, frame: number): boolean {
  const plan = blendPlanFor(graph, ch, clip)
  if (!plan?.locks.length) return false
  const rig = rigInfo(ch)
  const local = rigLocalNow(ch)
  let any = false
  for (const lock of plan.locks) {
    const strength = lockStrength(frame, lock.startFrame, lock.endFrame, lock.ease)
    if (strength <= 0) continue
    const foot = rig.feet.find((item) => item.side === lock.side)
    if (!foot) continue
    const ankle = positionOf(actorMatrix(ch, foot.foot, local))
    const target = ankle.clone().lerp(lock.hold, strength)
    any = ikLeg(ch, foot, target, local) || any
  }
  return any
}

function ikLeg(ch: CharInstance, foot: FootRig, target: THREE.Vector3, local: LocalFn): boolean {
  const thigh = actorMatrix(ch, foot.thigh, local), shin = actorMatrix(ch, foot.shin, local), ankle = actorMatrix(ch, foot.foot, local)
  const hip = positionOf(thigh), knee = positionOf(shin), ankleP = positionOf(ankle)
  const newKnee = solveKnee(hip, knee, ankleP, target)
  if (!newKnee) return false
  const qThigh = partsOfMatrix(thigh).q, qShin = partsOfMatrix(shin).q, qFoot = partsOfMatrix(ankle).q
  const q1 = new THREE.Quaternion().setFromUnitVectors(knee.clone().sub(hip).normalize(), newKnee.clone().sub(hip).normalize())
  const thighWorld = q1.clone().multiply(qThigh)
  const parentQ = partsOfMatrix(actorMatrix(ch, foot.thigh.parent, local)).q
  foot.thigh.quaternion.copy(parentQ.invert().multiply(thighWorld))
  const ankleAfter = newKnee.clone().add(ankleP.clone().sub(knee).applyQuaternion(q1))
  const current = ankleAfter.sub(newKnee), wanted = target.clone().sub(newKnee)
  if (current.lengthSq() < 1e-12 || wanted.lengthSq() < 1e-12) return true
  const q2 = new THREE.Quaternion().setFromUnitVectors(current.normalize(), wanted.normalize())
  const shinWorld = q2.multiply(q1).multiply(qShin)
  foot.shin.quaternion.copy(thighWorld.clone().invert().multiply(shinWorld))
  foot.foot.quaternion.copy(shinWorld.clone().invert().multiply(qFoot))
  return true
}

/** Tính sẵn kế hoạch mọi clip có blendIn để dải X có số liệu dù playhead chưa vào vùng trộn. */
export function ensureBlendPlans(graph: StageGraph): void {
  const clips = graph.doc?.content.timeline.animation.motionClips
  if (!clips) return
  for (const clip of clips) {
    if (!motionBlendInOf(clip)) { setBlendStatus(clip.id, null); continue }
    const ch = graph.characters.get(clip.target.nodeId)
    if (ch) blendPlanFor(graph, ch, clip)
  }
}
