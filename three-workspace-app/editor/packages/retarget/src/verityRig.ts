import { Euler, Matrix4, Quaternion, Vector3 } from 'three'
import { MIXAMO65_BONE_PARENTS } from './mixamo65'
import { createMixamo65MappingPreset, type Mixamo65MappingPreset } from './mappingPreset'
import type { MappingSkeleton } from './mapping'

/** Physical scale shared with the BOBJ model loader; keep the preset decimal exact to avoid applying two near-equal wrappers. */
export const VERITY_METRES_PER_UNIT = 0.4915394

/** Raw Verity bone name → canonical Mixamo65 joint. Helpers and extras are intentionally absent. */
export const VERITY_TO_MIXAMO: Readonly<Record<string, string>> = (() => {
  const mapping: Record<string, string> = {
    COG: 'Hips',
    Spine_01: 'Spine',
    Spine_02: 'Spine1',
    Chest: 'Spine2',
    Neck: 'Neck',
    Head: 'Head',
    Head_end: 'HeadTop_End',
  }
  for (const [suffix, side] of [['L', 'Left'], ['R', 'Right']] as const) {
    Object.assign(mapping, {
      [`Clavicle_${suffix}`]: `${side}Shoulder`,
      [`Upper_Arm_${suffix}`]: `${side}Arm`,
      [`Lower_Arm_${suffix}`]: `${side}ForeArm`,
      [`Hand_${suffix}`]: `${side}Hand`,
      [`Upper_Leg_${suffix}`]: `${side}UpLeg`,
      [`Lower_Leg_${suffix}`]: `${side}Leg`,
      [`Foot_${suffix}`]: `${side}Foot`,
      [`Toe_${suffix}`]: `${side}ToeBase`,
      [`Toe_${suffix}_end`]: `${side}Toe_End`,
    })
    for (const finger of ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky']) {
      for (const index of [1, 2, 3]) mapping[`${finger}_0${index}_${suffix}`] = `${side}Hand${finger}${index}`
      mapping[`${finger}_03_${suffix}_end`] = `${side}Hand${finger}4`
    }
  }
  return Object.freeze(mapping)
})()

export const MIXAMO_TO_VERITY: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(Object.entries(VERITY_TO_MIXAMO).map(([source, target]) => [target, source])),
)

/** Existing Workbench projection predates HeadTop_End; kept separate so extraction cannot alter its output. */
export const VERITY_WORKBENCH_TO_MIXAMO: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(Object.entries(VERITY_TO_MIXAMO).filter(([source]) => source !== 'Head_end')),
)

export function createVerityMixamo65Preset(source: MappingSkeleton, target: MappingSkeleton): Mixamo65MappingPreset {
  const byName = new Map(source.bones.map((bone) => [bone.name, bone.id]))
  const assignments = Object.fromEntries(Object.entries(VERITY_TO_MIXAMO)
    .flatMap(([sourceName, targetName]) => byName.has(sourceName) ? [[targetName, byName.get(sourceName)!]] : []))
  return createMixamo65MappingPreset(source, target, assignments)
}

export interface VerityInverseTransform {
  metresPerUnit: number
  groundUnits: number
  sourceFacingInverse: Quaternion
  rootActionDelta: Matrix4
  restScale: Vector3
}

/** Converts one solver world transform (metres, +Z) back to Verity native world space. */
export function solverWorldToVerity(world: Matrix4, options: VerityInverseTransform): Matrix4 {
  if (!(options.metresPerUnit > 0) || !Number.isFinite(options.metresPerUnit) || !Number.isFinite(options.groundUnits)) {
    throw new RangeError('Verity inverse transform requires a positive finite unit and finite ground')
  }
  const position = new Vector3()
  const rotation = new Quaternion()
  world.decompose(position, rotation, new Vector3())
  position.multiplyScalar(1 / options.metresPerUnit)
    .applyQuaternion(options.sourceFacingInverse)
    .add(new Vector3(0, options.groundUnits, 0))
  rotation.premultiply(options.sourceFacingInverse).normalize()
  return options.rootActionDelta.clone().multiply(new Matrix4().compose(position, rotation, options.restScale))
}

export interface VerityInfluence { bone: string; weight: number }
export type VerityLocals = Map<string, Matrix4>
export interface VerityBoneTransform { name: string; parent: string | null; restWorld: Matrix4; restLocal: Matrix4 }
export interface VerityAddedAction { name: string; ticks: number; frames: VerityLocals[] }

/** Collapses helper/extra weights to the nearest mapped ancestor for the 65-joint solver skin. */
export function remapVerityInfluences(
  influences: readonly VerityInfluence[],
  parents: Readonly<Record<string, string | null>>,
): VerityInfluence[] {
  const weights = new Map<string, number>()
  for (const influence of influences) {
    if (!Number.isFinite(influence.weight) || influence.weight <= 0) continue
    let bone: string | null | undefined = influence.bone
    const visited = new Set<string>()
    while (bone && !VERITY_TO_MIXAMO[bone]) {
      if (visited.has(bone)) throw new Error(`Verity parent cycle at ${bone}`)
      visited.add(bone)
      bone = parents[bone]
    }
    const target = bone && VERITY_TO_MIXAMO[bone]
    if (target) weights.set(target, (weights.get(target) ?? 0) + influence.weight)
  }
  const total = [...weights.values()].reduce((sum, weight) => sum + weight, 0)
  return total > 0 ? [...weights].map(([bone, weight]) => ({ bone, weight: weight / total })) : []
}

/** Projects a complete Mixamo solver frame back through the original helper hierarchy. */
export function projectVerityFrame(
  solverWorlds: ReadonlyMap<string, Matrix4>,
  bones: readonly VerityBoneTransform[],
  inverse: Omit<VerityInverseTransform, 'restScale'>,
  rootName: string,
  rootLocal: Matrix4,
  wingLocals: ReadonlyMap<string, Matrix4> | null,
  mapping: Readonly<Record<string, string>> = VERITY_TO_MIXAMO,
): VerityLocals {
  const worlds = new Map<string, Matrix4>()
  const locals: VerityLocals = new Map()
  for (const bone of bones) {
    const parentWorld = bone.parent ? worlds.get(bone.parent) : new Matrix4()
    if (!parentWorld) throw new Error(`Verity parent ${bone.parent} must precede ${bone.name}`)
    const solver = mapping[bone.name] ? solverWorlds.get(mapping[bone.name]!) : undefined
    const restScale = new Vector3()
    bone.restWorld.decompose(new Vector3(), new Quaternion(), restScale)
    const world = solver
      ? solverWorldToVerity(solver, { ...inverse, restScale })
      : parentWorld.clone().multiply(bone.name === rootName ? rootLocal :
        bone.name.startsWith('Wing') && wingLocals?.has(bone.name) ? wingLocals.get(bone.name)! : bone.restLocal)
    worlds.set(bone.name, world)
    locals.set(bone.name, parentWorld.clone().invert().multiply(world))
  }
  return locals
}

/** Appends new BOBJ actions without decoding or reserializing a single byte of the original prefix. */
export function appendVerityActions(rawPrefix: string, bones: readonly Pick<VerityBoneTransform, 'name' | 'restLocal'>[], actions: readonly VerityAddedAction[]): string {
  const fmt = (value: number) => (Math.abs(value) < 5e-7 ? 0 : value).toFixed(6)
  const lines: string[] = []
  for (const action of actions) {
    lines.push(`an ${action.name}`)
    for (const bone of bones) {
      const location: number[][] = [[], [], []], rotation: number[][] = [[], [], []], scale: number[][] = [[], [], []]
      for (const frame of action.frames) {
        const position = new Vector3(), quaternion = new Quaternion(), size = new Vector3()
        bone.restLocal.clone().invert().multiply(frame.get(bone.name)!).decompose(position, quaternion, size)
        const euler = new Euler().setFromQuaternion(quaternion, 'ZYX')
        ;[position.x, position.y, position.z].forEach((value, index) => location[index]!.push(value))
        ;[size.x, size.y, size.z].forEach((value, index) => scale[index]!.push(value))
        ;[euler.x, euler.y, euler.z].forEach((value, index) => {
          const previous = rotation[index]![rotation[index]!.length - 1]
          rotation[index]!.push(previous === undefined ? value : value + Math.round((previous - value) / (2 * Math.PI)) * 2 * Math.PI)
        })
      }
      const groups: string[] = []
      const channel = (path: string, values: number[][], rest: number) => values.forEach((series, index) => {
        if (series.every((value) => Math.abs(value - rest) < 1e-6)) return
        groups.push(`ag ${path} ${index}`, ...series.map((value, tick) => `kf ${tick} ${fmt(value)} LINEAR ${tick} ${fmt(value)} ${tick} ${fmt(value)}`))
      })
      channel('location', location, 0); channel('rotation', rotation, 0); channel('scale', scale, 1)
      if (groups.length) lines.push(`ao ${bone.name}`, ...groups)
    }
  }
  return rawPrefix + (rawPrefix.endsWith('\n') ? '' : '\n') + (lines.length ? lines.join('\n') + '\n' : '')
}

if (Object.keys(VERITY_TO_MIXAMO).length !== MIXAMO65_BONE_PARENTS.length) {
  throw new Error('Verity preset must map exactly 65 canonical joints')
}
