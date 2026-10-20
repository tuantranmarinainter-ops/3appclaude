import { AnimationClip, Bone, Group, Matrix4, Quaternion, QuaternionKeyframeTrack, Vector3, VectorKeyframeTrack, type KeyframeTrack } from 'three'
import { evaluateBobjAction, parseBobjActions } from '../src/index.ts'
import { parseBobjArmature } from '../src/reverse.ts'

const BOBJ_TICKS_PER_SECOND = 20
const BAKE_FPS = 30

/** Three.js track names use '.' as the node/property separator, so `low_left_arm.end` becomes `low_left_arm_end`. */
export const bobjNodeName = (name: string) => name.replace(/\./g, '_')

/**
 * Minecraft20 BOBJ (BBS/Blockbuster V9.12) → Object3D rig with baked clips, so `.bobj` actions go through the same
 * normalize pipeline as FBX/glTF. Poses come from `evaluateBobjAction` (the V9.12 reference evaluator, ticks at 20/s)
 * sampled at 30 FPS — the library's keys sit on 30 FPS frames (1 frame = 2/3 tick).
 *
 * Several V9.12 rest matrices are mirrored (`body`, `low_body`: determinant −1, a Blender bone-roll artefact) and the
 * solver only accepts orientation-preserving matrices. Bone axes are arbitrary for retargeting, so every bone gets a
 * translation-only rest frame C and each pose W is re-expressed as W·R⁻¹·C (R = original rest). World deltas
 * (W·R⁻¹) and joint positions are unchanged; only the arbitrary — here mirrored — axis convention is dropped.
 */
export function loadBobj(actionsText: string, armatureText: string): Group {
  const armature = parseBobjArmature(armatureText), actions = parseBobjActions(actionsText)
  const rest = new Map(armature.bones.map((bone) => [bone.name, new Matrix4().fromArray([...bone.restWorld])]))
  const frame = new Map(armature.bones.map((bone) => [bone.name, new Matrix4().copyPosition(rest.get(bone.name)!)]))
  const rebase = new Map(armature.bones.map((bone) => [bone.name, rest.get(bone.name)!.clone().invert().multiply(frame.get(bone.name)!)]))
  const parent = new Map(armature.bones.map((bone) => [bone.name, bone.parent]))

  const root = new Group(), nodes = new Map<string, Bone>()
  root.name = 'minecraft20'
  for (const bone of armature.bones) {
    const node = new Bone(); node.name = bobjNodeName(bone.name)
    const parentFrame = bone.parent ? frame.get(bone.parent)! : new Matrix4()
    parentFrame.clone().invert().multiply(frame.get(bone.name)!).decompose(node.position, node.quaternion, node.scale)
    ;(bone.parent ? nodes.get(bone.parent)! : root).add(node)
    nodes.set(bone.name, node)
  }

  root.animations = [...actions.values()].map((action) => {
    const duration = action.durationTicks / BOBJ_TICKS_PER_SECOND
    const times = Array.from({ length: Math.ceil(duration * BAKE_FPS - 1e-9) + 1 }, (_, index) => Math.min(index / BAKE_FPS, duration))
    const values = new Map(armature.bones.map((bone) => [bone.name, { position: [] as number[], quaternion: [] as number[], scale: [] as number[] }]))
    for (const time of times) {
      const worlds = new Map(evaluateBobjAction(armature, action, time * BOBJ_TICKS_PER_SECOND)
        .map((bone) => [bone.name, new Matrix4().fromArray([...bone.worldMatrix]).multiply(rebase.get(bone.name)!)]))
      for (const bone of armature.bones) {
        const parentName = parent.get(bone.name)
        const local = parentName ? worlds.get(parentName)!.clone().invert().multiply(worlds.get(bone.name)!) : worlds.get(bone.name)!
        const position = new Vector3(), quaternion = new Quaternion(), scale = new Vector3()
        local.decompose(position, quaternion, scale)
        const entry = values.get(bone.name)!
        entry.position.push(...position.toArray()); entry.quaternion.push(...quaternion.normalize().toArray()); entry.scale.push(...scale.toArray())
      }
    }
    const tracks: KeyframeTrack[] = armature.bones.flatMap((bone) => {
      const name = bobjNodeName(bone.name), entry = values.get(bone.name)!
      return [new VectorKeyframeTrack(`${name}.position`, times, entry.position), new QuaternionKeyframeTrack(`${name}.quaternion`, times, entry.quaternion),
        ...(entry.scale.some((value) => Math.abs(value - 1) > 1e-6) ? [new VectorKeyframeTrack(`${name}.scale`, times, entry.scale)] : [])]
    })
    return new AnimationClip(action.name, duration, tracks)
  })
  return root
}
