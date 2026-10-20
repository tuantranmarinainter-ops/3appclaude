import * as THREE from 'three'
import type { MotionClip } from '../../contract/types'
import type { MotionPlayer } from './MotionPlayer'
import type { CharInstance } from './types'

const interpolants = new WeakMap<THREE.KeyframeTrack, { evaluate(time: number): ArrayLike<number> }>()
const trackMaps = new WeakMap<THREE.AnimationClip, Map<string, THREE.KeyframeTrack>>()

function sample(track: THREE.KeyframeTrack, time: number): ArrayLike<number> {
  let interpolant = interpolants.get(track)
  if (!interpolant) {
    // Three selects its native quaternion/discrete/linear interpolant on the track at runtime.
    interpolant = (track as THREE.KeyframeTrack & { createInterpolant(): { evaluate(time: number): ArrayLike<number> } }).createInterpolant()
    interpolants.set(track, interpolant)
  }
  return interpolant.evaluate(time)
}

function sampledTransform(character: CharInstance, animation: THREE.AnimationClip, object: THREE.Object3D, time: number) {
  let tracks = trackMaps.get(animation)
  if (!tracks) { tracks = new Map(animation.tracks.map((track) => [track.name, track])); trackMaps.set(animation, tracks) }
  const position = (character.restPos.get(object.name) ?? object.position).clone()
  const rotation = (character.restPose.get(object.name) ?? object.quaternion).clone()
  const scale = (character.restScale?.get(object.name) ?? object.scale).clone()
  const p = tracks.get(`${object.name}.position`)
  const q = tracks.get(`${object.name}.quaternion`)
  const s = tracks.get(`${object.name}.scale`)
  if (p) position.fromArray(Array.from(sample(p, time)))
  if (q) rotation.fromArray(Array.from(sample(q, time))).normalize()
  if (s) scale.fromArray(Array.from(sample(s, time)))
  if (object === character.inner) position.set(0, 0, 0)
  return { position, rotation, scale }
}

/** Root delta in actor coordinates, including the source model hierarchy and unit wrapper. */
export function sampleRootDelta(character: CharInstance, animation: THREE.AnimationClip, name: string, time: number): THREE.Matrix4 | null {
  const bone = character.inner.getObjectByName(name)
  const restPosition = character.restPos.get(name)
  const restRotation = character.restPose.get(name)
  if (!bone || !restPosition || !restRotation) return null
  const { position, rotation, scale } = sampledTransform(character, animation, bone, time)
  const parent = new THREE.Matrix4()
  for (let object = bone.parent; object && object !== (character.motionRoot ?? character.root); object = object.parent) {
    const value = sampledTransform(character, animation, object, time)
    parent.premultiply(new THREE.Matrix4().compose(value.position, value.rotation, value.scale))
  }
  const rest = new THREE.Matrix4().compose(restPosition, restRotation, scale)
  return parent.clone().multiply(new THREE.Matrix4().compose(position, rotation, scale))
    .multiply(rest.invert()).multiply(parent.invert())
}

function power(matrix: THREE.Matrix4, count: number): THREE.Matrix4 {
  if (!Number.isSafeInteger(count) || count < 0) throw new RangeError('Root-motion loop count exceeds numerical precision')
  const result = new THREE.Matrix4()
  const factor = matrix.clone()
  while (count > 0) {
    if (count % 2 === 1) result.multiply(factor)
    count = Math.floor(count / 2)
    if (count) factor.multiply(factor.clone())
  }
  return result
}

/** Absolute seek: evaluate predecessors at their end-exclusive boundary, never from the previous rendered frame. */
export function evaluateRootTrajectory(character: CharInstance, clips: readonly MotionClip[], player: MotionPlayer, frame: number, fps: number, boundary?: 'left' | 'right'): THREE.Matrix4 | null {
  if (!clips.some((clip) => clip.target.nodeId === character.node.id && clip.motion.rootMotion?.policy === 'trajectory')) return null
  const ordered = clips.filter((clip) => clip.target.nodeId === character.node.id && (boundary === 'left' ? clip.frameStart < frame : clip.frameStart <= frame))
    .sort((a, b) => a.frameStart - b.frameStart)
  let endpoint: THREE.Matrix4 | null = null
  let result: THREE.Matrix4 | null = null
  for (const clip of ordered) {
    const root = clip.motion.rootMotion
    result = null
    if (!root) { endpoint = null; continue }
    if (root.policy === 'in-place') { endpoint = new THREE.Matrix4(); continue }
    const animation = player.getClipForDirectBind(clip.motion.assetId, character.inner, character.restPose, character.restPos, clip.motion.clipIndex ?? 0)
    if (!animation) return null
    const start = clip.motion.time
    const length = clip.motion.sourceLengthSeconds ?? clip.sourceDuration - start
    const reverse = clip.motion.reverse ?? false
    const sourceStart = reverse ? start + length : start
    const sourceEnd = reverse ? start : start + length
    const first = sampleRootDelta(character, animation, root.boneName, sourceStart)
    const last = sampleRootDelta(character, animation, root.boneName, sourceEnd)
    if (!first || !last || !(length > 0)) return null
    const duration = (clip.frameEnd - clip.frameStart + 1) / fps
    const elapsed = Math.min(Math.max(0, (frame - clip.frameStart) / fps), duration) * clip.playback.speed
    const cycles = clip.playback.loop ? Math.floor(elapsed / length) : 0
    const offset = clip.playback.loop ? elapsed % length : Math.min(elapsed, length)
    const current = sampleRootDelta(character, animation, root.boneName, reverse ? sourceStart - offset : sourceStart + offset)!
    if (root.policy === 'skeletal') { endpoint = current; continue }
    const inverseFirst = first.clone().invert()
    const anchor: THREE.Matrix4 = root.alignment !== 'origin' && endpoint ? endpoint : first
    const trajectory: THREE.Matrix4 = anchor.clone().multiply(power(inverseFirst.clone().multiply(last), cycles)).multiply(inverseFirst).multiply(current)
    if (!trajectory.elements.every(Number.isFinite)) throw new RangeError('Root-motion trajectory exceeds numerical range')
    result = trajectory
    endpoint = result
  }
  return result
}
