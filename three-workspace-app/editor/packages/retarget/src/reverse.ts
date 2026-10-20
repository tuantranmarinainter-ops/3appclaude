import { Box3, Matrix4, Quaternion, Vector3 } from 'three'

export type Vec3 = readonly [number, number, number]
export type Quat = readonly [number, number, number, number]
export type Matrix = readonly [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number]

export interface BobjArmatureBone {
  name: string
  parent: string | null
  head: Vec3
  tail: Vec3
  restWorld: Matrix
  restLocal: Matrix
  localTail: Vec3
}

export interface BobjArmature { bones: BobjArmatureBone[] }

export interface MixamoPoseBone {
  name: string
  restWorldPosition: Vec3
  restWorldQuaternion: Quat
  worldQuaternion: Quat
  worldPosition: Vec3
}

export interface ReverseRetargetSettings {
  intensity: number
  stride: number
  vertical: number
  mirror: boolean
  proportionSide: 'both' | 'left' | 'right'
  motionSide: 'both' | 'left' | 'right'
  rootMotion: boolean
  rootTravelMode: 'inPlace' | 'follow'
  shoulderWidth: number
  upperArm: number
  forearm: number
  legLength: number
  armSpace: number
}

export interface RetargetedBone {
  name: string
  position: Vec3
  rotation: Quat
  scale: Vec3
  worldMatrix: Matrix
}

const specs: Record<string, [string, string?]> = {
  body: ['hips'], low_body: ['spine2'], head: ['head'],
  left_arm: ['leftarm', 'leftforearm'], low_left_arm: ['leftforearm', 'lefthand'], 'low_left_arm.end': ['lefthand'],
  right_arm: ['rightarm', 'rightforearm'], low_right_arm: ['rightforearm', 'righthand'], 'low_right_arm.end': ['righthand'],
  left_leg: ['leftupleg', 'leftleg'], low_left_leg: ['leftleg', 'leftfoot'],
  right_leg: ['rightupleg', 'rightleg'], low_leg_right: ['rightleg', 'rightfoot'],
}

const semanticRoleByTargetBone: Record<string, string> = {
  body: 'pelvis', low_body: 'spine', head: 'head',
  left_arm: 'leftUpperArm', low_left_arm: 'leftForearm', 'low_left_arm.end': 'leftHand',
  right_arm: 'rightUpperArm', low_right_arm: 'rightForearm', 'low_right_arm.end': 'rightHand',
  left_leg: 'leftThigh', low_left_leg: 'leftShin', right_leg: 'rightThigh', low_leg_right: 'rightShin',
}
const nextSemanticRole: Record<string, string> = {
  leftUpperArm: 'leftForearm', leftForearm: 'leftHand', leftThigh: 'leftShin', leftShin: 'leftFoot',
  rightUpperArm: 'rightForearm', rightForearm: 'rightHand', rightThigh: 'rightShin', rightShin: 'rightFoot',
}
const oppositeSemanticRole: Record<string, string> = {
  leftUpperArm: 'rightUpperArm', rightUpperArm: 'leftUpperArm', leftForearm: 'rightForearm', rightForearm: 'leftForearm',
  leftHand: 'rightHand', rightHand: 'leftHand', leftThigh: 'rightThigh', rightThigh: 'leftThigh',
  leftShin: 'rightShin', rightShin: 'leftShin', leftFoot: 'rightFoot', rightFoot: 'leftFoot',
}
const knownSemanticRoles = new Set(['root', 'pelvis', 'spine', 'chest', 'neck', 'head', 'leftToe', 'rightToe', ...Object.keys(oppositeSemanticRole)])

export const defaultReverseRetargetSettings: Readonly<ReverseRetargetSettings> = {
  intensity: 1, stride: 1, vertical: 1, mirror: false, proportionSide: 'both', motionSide: 'both',
  rootMotion: true, rootTravelMode: 'inPlace', shoulderWidth: 1, upperArm: 1, forearm: 1, legLength: 1, armSpace: 0,
}

function matrixFromRowMajor(values: number[]): Matrix4 {
  return new Matrix4().set(...values as [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number])
}

function matrixTuple(value: Matrix4): Matrix { return value.toArray() as unknown as Matrix }
function vectorTuple(value: Vector3): Vec3 { return [value.x, value.y, value.z] }
function quaternionTuple(value: Quaternion): Quat { return [value.x, value.y, value.z, value.w] }
function finite(value: number, field: string): number {
  if (!Number.isFinite(value)) throw new Error(`${field} must be finite`)
  return value
}
function vector(value: Vec3): Vector3 {
  if (value.length !== 3 || value.some((part) => !Number.isFinite(part))) throw new Error('Invalid vector')
  return new Vector3(...value)
}
function quaternion(value: Quat): Quaternion {
  if (value.length !== 4 || value.some((part) => !Number.isFinite(part))) throw new Error('Invalid quaternion')
  const result = new Quaternion(...value)
  if (result.lengthSq() < 1e-12) throw new Error('Quaternion must not be zero')
  return result.normalize()
}
function canonicalBoneName(name: string): string {
  return name.split(':').pop()!.replace(/^mixamorig\d*/i, '').replace(/[|]/g, '').replace(/[^A-Za-z0-9]/g, '').toLowerCase()
}

/** Parses V9.12's embedded Minecraft20 rest rig, including its native multi-root structure. */
export function parseBobjArmature(text: string): BobjArmature {
  const records: Array<{ name: string; parent: string | null; tail: Vector3; world: Matrix4 }> = []
  const names = new Set<string>()
  for (const [index, raw] of text.split(/\r?\n/).entries()) {
    if (!raw.startsWith('arm_bone ')) continue
    const parts = raw.trim().split(/\s+/)
    const name = parts[1]
    if (!name || names.has(name)) throw new Error(`BOBJ line ${index + 1}: missing or duplicate bone`)
    names.add(name)
    const parent = parts.length === 22 ? parts[2] : null
    const start = parent ? 3 : 2
    const values = parts.slice(start).map(Number)
    if (values.length !== 19 || values.some((value) => !Number.isFinite(value))) throw new Error(`BOBJ line ${index + 1}: invalid arm_bone record`)
    records.push({ name, parent, tail: new Vector3(values[0], values[1], values[2]), world: matrixFromRowMajor(values.slice(3)) })
  }
  if (!records.length) throw new Error('BOBJ contains no arm_bone records')
  const bones: BobjArmatureBone[] = []
  const worldByName = new Map<string, Matrix4>()
  for (const record of records) {
    const parentWorld = record.parent ? worldByName.get(record.parent) : undefined
    if (record.parent && !parentWorld) throw new Error(`BOBJ bone ${record.name}: parent must precede child`)
    const local = parentWorld ? parentWorld.clone().invert().multiply(record.world) : record.world.clone()
    const head = new Vector3().setFromMatrixPosition(record.world)
    const localTail = record.tail.clone().applyMatrix4(record.world.clone().invert())
    bones.push({ name: record.name, parent: record.parent, head: vectorTuple(head), tail: vectorTuple(record.tail), restWorld: matrixTuple(record.world), restLocal: matrixTuple(local), localTail: vectorTuple(localTail) })
    worldByName.set(record.name, record.world)
  }
  return { bones }
}

function scaleDeltaQuat(value: Quaternion, factor: number): Quaternion {
  const q = value.clone().normalize()
  if (q.w < 0) q.set(-q.x, -q.y, -q.z, -q.w)
  const w = Math.max(-1, Math.min(1, q.w))
  const angle = 2 * Math.acos(w)
  if (angle < 1e-7) return new Quaternion()
  const s = Math.sqrt(Math.max(1e-12, 1 - w * w))
  return new Quaternion().setFromAxisAngle(new Vector3(q.x / s, q.y / s, q.z / s).normalize(), angle * factor).normalize()
}

function mirrorQuatX(value: Quaternion): Quaternion {
  const scale = new Matrix4().makeScale(-1, 1, 1)
  const rotation = new Matrix4().makeRotationFromQuaternion(value)
  rotation.premultiply(scale).multiply(scale)
  return new Quaternion().setFromRotationMatrix(rotation).normalize()
}

function sideOf(name: string): 'left' | 'right' | null {
  if (name.includes('left')) return 'left'
  if (name.includes('right')) return 'right'
  return null
}

export function validateReverseRetargetSettings(settings: ReverseRetargetSettings): void {
  for (const key of ['intensity', 'stride', 'vertical', 'shoulderWidth', 'upperArm', 'forearm', 'legLength', 'armSpace'] as const) finite(settings[key], key)
  if (settings.intensity < 0 || settings.intensity > 2 || settings.stride < 0 || settings.stride > 2 || settings.vertical < 0 || settings.vertical > 2) throw new RangeError('Intensity, stride and vertical must be in [0, 2]')
  if (settings.shoulderWidth < 0.7 || settings.shoulderWidth > 1.4 || settings.upperArm < 0.7 || settings.upperArm > 1.4 || settings.forearm < 0.7 || settings.forearm > 1.4 || settings.legLength < 0.8 || settings.legLength > 1.25 || settings.armSpace < -0.5 || settings.armSpace > 1) throw new RangeError('Body proportions are outside V9.12 control limits')
}

/** Mixamo65→Minecraft20 port of V9.12. Public poses contain numeric tuples, never Three.js objects. */
// shortcut: semantic overrides target the fixed V9.12 Minecraft20 armature; switch when evaluation consumes arbitrary target profiles.
export function createReverseRetargeter(input: string | BobjArmature, sourceBonesByRole?: Readonly<Record<string, string>>, sourceReferencePose?: Readonly<Record<string, Quat>>) {
  if (sourceBonesByRole) {
    for (const [role, name] of Object.entries(sourceBonesByRole)) {
      if (!knownSemanticRoles.has(role) || typeof name !== 'string' || !name.trim()) throw new TypeError(`Invalid source bone mapping for role ${role}`)
    }
    if (!sourceBonesByRole.pelvis) throw new TypeError('Semantic mapping requires a pelvis source bone')
  }
  const sourceReferenceByName = new Map<string, Quaternion>()
  if (sourceReferencePose !== undefined) {
    if (!sourceReferencePose || typeof sourceReferencePose !== 'object' || Array.isArray(sourceReferencePose)) throw new TypeError('Invalid source reference pose')
    for (const [name, value] of Object.entries(sourceReferencePose)) {
      const canonical = canonicalBoneName(name)
      if (!canonical || sourceReferenceByName.has(canonical) || !Array.isArray(value)) throw new TypeError(`Invalid or ambiguous source reference bone ${name}`)
      sourceReferenceByName.set(canonical, quaternion(value))
    }
  }
  const armature = typeof input === 'string' ? parseBobjArmature(input) : input
  const bones = armature.bones.map((bone) => {
    const restWorld = new Matrix4().fromArray([...bone.restWorld])
    const restLocal = new Matrix4().fromArray([...bone.restLocal])
    const restWorldQ = new Quaternion()
    const head = vector(bone.head)
    const tail = vector(bone.tail)
    restWorld.decompose(new Vector3(), restWorldQ, new Vector3())
    return { ...bone, restWorld, restLocal, restWorldQ, head, tail, restDir: tail.clone().sub(head).normalize() }
  })
  const bounds = new Box3()
  for (const bone of bones) bounds.expandByPoint(bone.head).expandByPoint(bone.tail)
  const heightRatio = bounds.getSize(new Vector3()).y / 1.8
  const boneByName = new Map(bones.map((bone) => [bone.name, bone]))
  const entries = bones.map((bone) => {
    const spec = specs[bone.name]
    const source = spec ? { bone: canonicalBoneName(spec[0]), end: spec[1] ? canonicalBoneName(spec[1]) : null } : null
    const opposite = (name: string) => name.replace(/left|right/g, (side) => side === 'left' ? 'right' : 'left')
    return { bone, parent: bone.parent ? boneByName.get(bone.parent) ?? null : null, source, mirrored: source ? { bone: opposite(source.bone), end: source.end ? opposite(source.end) : null } : null, role: semanticRoleByTargetBone[bone.name] }
  })
  if (!boneByName.has('body') || !boneByName.has('anchor')) throw new Error('Expected V9.12 Minecraft20 armature')

  return {
    armature,
    evaluate(sourceBones: readonly MixamoPoseBone[], overrides: Partial<ReverseRetargetSettings> = {}): RetargetedBone[] {
      const settings = { ...defaultReverseRetargetSettings, ...overrides }
      validateReverseRetargetSettings(settings)
      const source = new Map<string, { restQ: Quaternion; worldQ: Quaternion; restPos: Vector3; worldPos: Vector3 }>()
      for (const item of sourceBones) {
        const name = canonicalBoneName(item.name)
        if (!name || source.has(name)) throw new Error(`Duplicate or invalid Mixamo bone ${item.name}`)
        source.set(name, { restQ: sourceReferenceByName.get(name) ?? quaternion(item.restWorldQuaternion), worldQ: quaternion(item.worldQuaternion), restPos: vector(item.restWorldPosition), worldPos: vector(item.worldPosition) })
      }
      for (const [role, name] of Object.entries(sourceBonesByRole ?? {})) {
        if (!source.has(canonicalBoneName(name))) throw new Error(`FBX is missing mapped source bone ${name} for role ${role}`)
      }
      const pelvisName = sourceBonesByRole?.pelvis ?? 'hips'
      const pelvis = source.get(canonicalBoneName(pelvisName))
      if (!pelvis) throw new Error(sourceBonesByRole ? `FBX is missing mapped pelvis ${pelvisName}` : 'FBX is missing Mixamo Hips')
      const rootDelta = pelvis.worldPos.clone().sub(pelvis.restPos).multiplyScalar(heightRatio)
      const hipDy = settings.rootMotion ? rootDelta.y * settings.vertical : 0
      if (settings.mirror) rootDelta.x *= -1

      const worldByName = new Map<string, Matrix4>()
      return entries.map(({ bone, parent, source: mapping, mirrored, role }) => {
        let selected = settings.mirror ? mirrored : mapping
        if (sourceBonesByRole && role) {
          const selectedRole = settings.mirror ? oppositeSemanticRole[role] ?? role : role
          const sourceName = sourceBonesByRole[selectedRole]
          const endRole = nextSemanticRole[selectedRole]
          selected = sourceName ? { bone: canonicalBoneName(sourceName), end: endRole ? canonicalBoneName(sourceBonesByRole[endRole] ?? '') || null : null } : null
        } else if (sourceBonesByRole) selected = null
        const local = new Matrix4()
        if (!selected || !source.has(selected.bone)) local.copy(bone.restLocal)
        else {
          const side = sideOf(bone.name)
          const sideOK = !side || settings.proportionSide === 'both' || settings.proportionSide === side
          const leg = bone.name.includes('leg')
          const factor = settings.intensity * (leg && (settings.motionSide === 'both' || settings.motionSide === side) ? settings.stride : 1)
          const mapped = source.get(selected.bone)!
          let q: Quaternion
          if (selected.end && source.has(selected.end)) {
            const direction = source.get(selected.end)!.worldPos.clone().sub(mapped.worldPos).normalize()
            if (settings.mirror) direction.x *= -1
            if (!leg && side && sideOK) direction.x += (side === 'left' ? 1 : -1) * settings.armSpace * 0.55
            q = new Quaternion().setFromUnitVectors(bone.restDir, direction.normalize())
          } else {
            q = mapped.worldQ.clone().multiply(mapped.restQ.clone().invert()).normalize()
            if (settings.mirror) q = mirrorQuatX(q)
          }
          q = scaleDeltaQuat(q, factor).multiply(bone.restWorldQ).normalize()
          const parentWorld = parent ? worldByName.get(parent.name) : undefined
          const parentQ = new Quaternion()
          parentWorld?.decompose(new Vector3(), parentQ, new Vector3())
          q.premultiply(parentQ.invert()).normalize()
          const position = new Vector3()
          const restRotation = new Quaternion()
          const restScale = new Vector3()
          bone.restLocal.decompose(position, restRotation, restScale)
          if (sideOK) {
            if (bone.name === 'left_arm' || bone.name === 'right_arm') position.x *= settings.shoulderWidth
            if (bone.name === 'low_left_arm' || bone.name === 'low_right_arm') position.multiplyScalar(settings.upperArm)
            if (bone.name === 'low_left_arm.end' || bone.name === 'low_right_arm.end') position.multiplyScalar(settings.forearm)
            if (bone.name === 'low_left_leg' || bone.name === 'low_leg_right') position.multiplyScalar(settings.legLength)
          }
          if (bone.name === 'body') {
            position.copy(bone.head)
            position.y += hipDy
            if (settings.rootTravelMode === 'follow') position.add(new Vector3(rootDelta.x, 0, rootDelta.z))
            if (parentWorld) position.applyMatrix4(parentWorld.clone().invert())
          }
          local.compose(position, q, restScale)
        }
        const world = parent ? worldByName.get(parent.name)!.clone().multiply(local) : local.clone()
        worldByName.set(bone.name, world)
        const position = new Vector3()
        const rotation = new Quaternion()
        const scale = new Vector3()
        local.decompose(position, rotation, scale)
        return { name: bone.name, position: vectorTuple(position), rotation: quaternionTuple(rotation), scale: vectorTuple(scale), worldMatrix: matrixTuple(world) }
      })
    },
  }
}
