import * as THREE from 'three'
import type { MotionClip } from '../../contract/types'
import type { MotionPlayer } from './MotionPlayer'
import type { CharInstance } from './types'

/**
 * K3 "Đảo chân": lật trái <-> phải toàn bộ một clip (xương hoán đổi theo cặp L/R, phép quay phản chiếu qua mặt phẳng
 * dọc giữa thân, đường đi/hướng root cũng bị lật). Làm trên AnimationClip đã bake theo rig đích nên mọi nơi dùng clip
 * (viewport, sampler, film, kế hoạch trộn, quỹ đạo root) đều thấy cùng một clip đã lật.
 */

export type BoneSide = 'left' | 'right'

const SEPARATORS = '[_.\\- :|]'
const WORD_LEFT = /Left(?![a-z])/
const WORD_RIGHT = /Right(?![a-z])/
const LOWER_LEFT = new RegExp(`(^|${SEPARATORS})left(?=$|${SEPARATORS})`)
const LOWER_RIGHT = new RegExp(`(^|${SEPARATORS})right(?=$|${SEPARATORS})`)
const TOKEN = new RegExp(`(^|${SEPARATORS})([LRlr])(?=$|${SEPARATORS}|[0-9])`)

/** Tên xương đối xứng và phía của `name`; null cho xương giữa thân (Hips, Spine, Head...). */
export function mirrorBoneName(name: string): { partner: string; side: BoneSide } | null {
  if (WORD_LEFT.test(name)) return { partner: name.replace(WORD_LEFT, 'Right'), side: 'left' }
  if (WORD_RIGHT.test(name)) return { partner: name.replace(WORD_RIGHT, 'Left'), side: 'right' }
  if (LOWER_LEFT.test(name)) return { partner: name.replace(LOWER_LEFT, '$1right'), side: 'left' }
  if (LOWER_RIGHT.test(name)) return { partner: name.replace(LOWER_RIGHT, '$1left'), side: 'right' }
  const token = TOKEN.exec(name)
  if (token) {
    const letter = token[2]
    const left = letter === 'L' || letter === 'l'
    const swapped = left ? (letter === 'L' ? 'R' : 'r') : (letter === 'R' ? 'L' : 'l')
    return { partner: name.replace(TOKEN, `$1${swapped}`), side: left ? 'left' : 'right' }
  }
  return null
}

/**
 * Quaternion của phép quay sau khi phản chiếu qua mặt phẳng qua gốc có pháp tuyến đơn vị `n`:
 * M·R·M tương ứng (−M·v, w) với v là phần vector (giả vector đổi dấu khi phản chiếu).
 */
export function reflectQuaternion(q: THREE.Quaternion, n: THREE.Vector3, out = new THREE.Quaternion()): THREE.Quaternion {
  const dot = q.x * n.x + q.y * n.y + q.z * n.z
  return out.set(-q.x + 2 * dot * n.x, -q.y + 2 * dot * n.y, -q.z + 2 * dot * n.z, q.w)
}

export function reflectPoint(p: THREE.Vector3, n: THREE.Vector3, out = new THREE.Vector3()): THREE.Vector3 {
  const d = p.dot(n)
  return out.set(p.x - 2 * d * n.x, p.y - 2 * d * n.y, p.z - 2 * d * n.z)
}

interface Sampler { track: THREE.KeyframeTrack; interpolant: { evaluate(time: number): ArrayLike<number> } }
const mirrorCache = new WeakMap<CharInstance, WeakMap<THREE.AnimationClip, THREE.AnimationClip>>()

const sampler = (track: THREE.KeyframeTrack | undefined): Sampler | null => track
  ? { track, interpolant: (track as THREE.KeyframeTrack & { createInterpolant(): Sampler['interpolant'] }).createInterpolant() }
  : null

/** Clip bake sẵn cho `ch`; đã lật khi clip có `blendIn.mirror`. Giữ nguyên danh tính đối tượng giữa các lần gọi. */
export function directAnimationFor(player: MotionPlayer, ch: CharInstance, clip: MotionClip): THREE.AnimationClip | null {
  const base = player.getClipForDirectBind(clip.motion.assetId, ch.inner, ch.restPose, ch.restPos, clip.motion.clipIndex ?? 0)
  if (!base || !clip.playback.blendIn?.mirror) return base
  return mirroredAnimation(ch, base)
}

export function mirroredAnimation(ch: CharInstance, base: THREE.AnimationClip): THREE.AnimationClip {
  let perChar = mirrorCache.get(ch)
  if (!perChar) { perChar = new WeakMap(); mirrorCache.set(ch, perChar) }
  const hit = perChar.get(base)
  if (hit) return hit
  const result = buildMirrored(ch, base)
  perChar.set(base, result)
  return result
}

interface BoneInfo {
  object: THREE.Object3D
  parent: BoneInfo | null
  partner: BoneInfo
  restP: THREE.Vector3
  restQ: THREE.Quaternion
  restS: THREE.Vector3
}

function buildMirrored(ch: CharInstance, base: THREE.AnimationClip): THREE.AnimationClip {
  const stop = ch.motionRoot ?? ch.root
  const infos = new Map<THREE.Object3D, BoneInfo>()
  const ordered: BoneInfo[] = []
  const byName = new Map<string, THREE.Object3D>()
  ch.inner.traverse((object) => {
    if (object === ch.inner || (object as THREE.Mesh).isMesh || !object.name) return
    if (!byName.has(object.name)) byName.set(object.name, object)
  })
  ch.inner.traverse((object) => {
    if (object === ch.inner || (object as THREE.Mesh).isMesh || !object.name || byName.get(object.name) !== object) return
    const info = {
      object, parent: null, partner: null as unknown as BoneInfo,
      restP: (ch.restPos.get(object.name) ?? object.position).clone(),
      restQ: (ch.restPose.get(object.name) ?? object.quaternion).clone(),
      restS: (ch.restScale?.get(object.name) ?? object.scale).clone(),
    } as BoneInfo
    infos.set(object, info)
    ordered.push(info)
  })
  let pairs = 0
  const leftMinusRight = new THREE.Vector3()
  for (const info of ordered) {
    let parent: THREE.Object3D | null = info.object.parent
    while (parent && parent !== ch.inner && !infos.has(parent)) parent = parent.parent
    info.parent = parent && infos.has(parent) ? infos.get(parent)! : null
    const m = mirrorBoneName(info.object.name)
    const partnerObject = m ? byName.get(m.partner) : undefined
    info.partner = (partnerObject && infos.get(partnerObject)) || info
    if (info.partner !== info) pairs += 1
  }
  if (!pairs) return base

  // Ancestors above the skeleton nodes (inner and up to the actor root): constant.
  const ancestor = new THREE.Matrix4()
  const tmp = new THREE.Matrix4()
  for (let o: THREE.Object3D | null = ch.inner; o && o !== stop; o = o.parent) {
    const p = o === ch.inner ? new THREE.Vector3() : (ch.restPos.get(o.name) ?? o.position)
    const q = ch.restPose.get(o.name) ?? o.quaternion
    const s = ch.restScale?.get(o.name) ?? o.scale
    ancestor.premultiply(tmp.compose(p, q, s))
  }
  const ancestorQ = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().extractRotation(ancestor))

  const tracks = new Map(base.tracks.map((track) => [track.name, track]))
  const get = (info: BoneInfo, property: 'position' | 'quaternion' | 'scale') => sampler(tracks.get(`${info.object.name}.${property}`))
  const samplers = new Map<BoneInfo, { p: Sampler | null; q: Sampler | null; s: Sampler | null }>()
  const times = new Set<number>()
  for (const info of ordered) {
    const entry = { p: get(info, 'position'), q: get(info, 'quaternion'), s: get(info, 'scale') }
    samplers.set(info, entry)
    for (const item of [entry.p, entry.q, entry.s]) if (item) for (const t of item.track.times) times.add(t)
  }
  if (!times.size) return base
  const timeList = [...times].sort((a, b) => a - b)

  const local = (info: BoneInfo, time: number) => {
    const entry = samplers.get(info)!
    const p = info.restP.clone(), q = info.restQ.clone(), s = info.restS.clone()
    if (entry.p) p.fromArray(Array.from(entry.p.interpolant.evaluate(time)))
    if (entry.q) q.fromArray(Array.from(entry.q.interpolant.evaluate(time))).normalize()
    if (entry.s) s.fromArray(Array.from(entry.s.interpolant.evaluate(time)))
    return { p, q, s }
  }

  // Mirror plane normal: average (left - right) of the rest pairs, horizontal; sagittal plane of the actor.
  const restWorld = new Map<BoneInfo, { m: THREE.Matrix4; q: THREE.Quaternion }>()
  for (const info of ordered) {
    const parent = info.parent ? restWorld.get(info.parent)! : { m: ancestor, q: ancestorQ }
    const m = parent.m.clone().multiply(tmp.compose(info.restP, info.restQ, info.restS))
    restWorld.set(info, { m, q: parent.q.clone().multiply(info.restQ) })
  }
  for (const info of ordered) {
    const side = mirrorBoneName(info.object.name)?.side
    if (side !== 'left' || info.partner === info) continue
    const a = new THREE.Vector3().setFromMatrixPosition(restWorld.get(info)!.m)
    const b = new THREE.Vector3().setFromMatrixPosition(restWorld.get(info.partner)!.m)
    leftMinusRight.add(a.sub(b))
  }
  leftMinusRight.y = 0
  const normal = leftMinusRight.lengthSq() > 1e-12 ? leftMinusRight.normalize() : new THREE.Vector3(1, 0, 0)

  const emitP = new Map<BoneInfo, number[]>(), emitQ = new Map<BoneInfo, number[]>(), emitS = new Map<BoneInfo, number[]>()
  const wantsP = new Set<BoneInfo>(), wantsQ = new Set<BoneInfo>(), wantsS = new Set<BoneInfo>()
  for (const info of ordered) {
    const own = samplers.get(info)!, other = samplers.get(info.partner)!
    if (own.p || other.p) { wantsP.add(info); emitP.set(info, []) }
    if (own.q || other.q) { wantsQ.add(info); emitQ.set(info, []) }
    if (own.s || other.s) { wantsS.add(info); emitS.set(info, []) }
  }

  const last = new Map<BoneInfo, THREE.Quaternion>()
  for (const time of timeList) {
    const animated = new Map<BoneInfo, { m: THREE.Matrix4; q: THREE.Quaternion; p: THREE.Vector3; l: ReturnType<typeof local> }>()
    for (const info of ordered) {
      const l = local(info, time)
      const parent = info.parent ? animated.get(info.parent)! : { m: ancestor, q: ancestorQ }
      const m = parent.m.clone().multiply(tmp.compose(l.p, l.q, l.s))
      animated.set(info, { m, q: parent.q.clone().multiply(l.q), p: new THREE.Vector3().setFromMatrixPosition(m), l })
    }
    const mirroredWorldQ = new Map<BoneInfo, THREE.Quaternion>()
    for (const info of ordered) {
      const source = animated.get(info.partner)!
      const delta = source.q.clone().multiply(restWorld.get(info.partner)!.q.clone().invert())
      mirroredWorldQ.set(info, reflectQuaternion(delta, normal).multiply(restWorld.get(info)!.q))
    }
    const mirroredM = new Map<BoneInfo, THREE.Matrix4>()
    for (const info of ordered) {
      const parentM = info.parent ? mirroredM.get(info.parent)! : ancestor
      const parentQ = info.parent ? mirroredWorldQ.get(info.parent)! : ancestorQ
      const q = parentQ.clone().invert().multiply(mirroredWorldQ.get(info)!).normalize()
      const source = animated.get(info.partner)!
      const hasPosition = !!samplers.get(info.partner)!.p
      let p = info.restP.clone()
      if (hasPosition) p = reflectPoint(source.p, normal).applyMatrix4(parentM.clone().invert())
      const s = (samplers.get(info.partner)!.s ? source.l.s : info.restS).clone()
      mirroredM.set(info, parentM.clone().multiply(tmp.compose(p, q, s)))
      if (wantsQ.has(info)) {
        const prev = last.get(info)
        if (prev && prev.dot(q) < 0) q.set(-q.x, -q.y, -q.z, -q.w)
        last.set(info, q.clone())
        emitQ.get(info)!.push(q.x, q.y, q.z, q.w)
      }
      if (wantsP.has(info)) emitP.get(info)!.push(p.x, p.y, p.z)
      if (wantsS.has(info)) emitS.get(info)!.push(s.x, s.y, s.z)
    }
  }

  const bones = new Set(ordered.map((info) => info.object.name))
  const out: THREE.KeyframeTrack[] = base.tracks.filter((track) => !bones.has(track.name.slice(0, track.name.lastIndexOf('.')))).map((track) => track.clone())
  const times32 = Array.from(timeList)
  for (const info of ordered) {
    const name = info.object.name
    if (wantsP.has(info)) out.push(new THREE.VectorKeyframeTrack(`${name}.position`, times32, emitP.get(info)!))
    if (wantsQ.has(info)) out.push(new THREE.QuaternionKeyframeTrack(`${name}.quaternion`, times32, emitQ.get(info)!))
    if (wantsS.has(info)) out.push(new THREE.VectorKeyframeTrack(`${name}.scale`, times32, emitS.get(info)!))
  }
  const clip = new THREE.AnimationClip(`${base.name}#mirror`, base.duration, out)
  return clip
}
