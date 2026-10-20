import { Euler, Matrix4, Quaternion, Vector3 } from 'three'
import type { SkeletonFrameSample } from '@topview/3d-builder/skeleton'

interface SourceBone { id: string; name: string; parentId: string | null; rest: unknown }
interface BobjBone { name: string; sourceName?: string; parent: string | null; bobjRestMatrixRowMajor: number[] }
interface ProfileBone { name: string; parentId: string | null }
interface FilmPoseKey {
  tick: number
  t: [number, number, number]
  s: [number, number, number]
  r: [number, number, number]
  r2: [0, 0, 0]
  fix: 0
  color: -1
  lighting: 0
}
interface FilmPoseTrack { boneName: string; keyframes: FilmPoseKey[] }
interface FilmModelProfile { modelId: string; bones: BobjBone[] }

const MATRIX_TOLERANCE = 2e-5

function matrixClose(a: Matrix4, b: Matrix4): boolean {
  return a.elements.every((value, index) => Math.abs(value - b.elements[index]!) <= MATRIX_TOLERANCE * Math.max(1, Math.abs(value), Math.abs(b.elements[index]!)))
}

function sourceLocal(bone: SourceBone): Matrix4 {
  if (!bone.rest || typeof bone.rest !== 'object') throw new TypeError(`Missing source rest transform: ${bone.name}`)
  const rest = bone.rest as { position?: unknown; rotation?: unknown; scale?: unknown }
  const vector = (value: unknown, size: number, label: string): number[] => {
    if (!Array.isArray(value) || value.length !== size || value.some((item) => typeof item !== 'number' || !Number.isFinite(item))) throw new TypeError(`Invalid ${label}: ${bone.name}`)
    return value
  }
  const p = vector(rest.position, 3, 'source rest position')
  const q = vector(rest.rotation, 4, 'source rest rotation')
  const s = vector(rest.scale, 3, 'source rest scale')
  const quaternion = new Quaternion(q[0], q[1], q[2], q[3])
  if (quaternion.lengthSq() < 1e-12 || s.some((value) => Math.abs(value) < 1e-10)) throw new TypeError(`Singular source rest transform: ${bone.name}`)
  return new Matrix4().compose(new Vector3(...p), quaternion.normalize(), new Vector3(...s))
}

function sourceBasis(values: number[]): Matrix4 {
  if (!Array.isArray(values) || values.length !== 9 || values.some((value) => !Number.isFinite(value))) throw new TypeError('Film pose bake requires a finite source basis')
  const rows = [values.slice(0, 3), values.slice(3, 6), values.slice(6, 9)]
  if (rows.some((a, i) => rows.some((b, j) => Math.abs(a.reduce((sum, value, k) => sum + value * b[k]!, 0) - (i === j ? 1 : 0)) > MATRIX_TOLERANCE))) throw new TypeError('Film pose bake requires an orthonormal source basis')
  return new Matrix4().set(values[0]!, values[1]!, values[2]!, 0, values[3]!, values[4]!, values[5]!, 0,
    values[6]!, values[7]!, values[8]!, 0, 0, 0, 0, 1)
}

function bobjWorld(bones: BobjBone[]): Map<string, Matrix4> {
  const output = new Map<string, Matrix4>()
  for (const bone of bones) {
    const values = bone.bobjRestMatrixRowMajor
    if (!Array.isArray(values) || values.length !== 16 || values.some((value) => typeof value !== 'number' || !Number.isFinite(value))) throw new TypeError(`Invalid BOBJ rest matrix: ${bone.name}`)
    const m = values
    const local = new Matrix4().set(m[0]!, m[1]!, m[2]!, m[3]!, m[4]!, m[5]!, m[6]!, m[7]!, m[8]!, m[9]!, m[10]!, m[11]!, m[12]!, m[13]!, m[14]!, m[15]!)
    if (bone.parent !== null) {
      const parent = output.get(bone.parent)
      if (!parent) throw new TypeError(`BOBJ parent must precede its child: ${bone.name}`)
      const rest = parent.clone().invert().multiply(local)
      output.set(bone.name, local)
      if (!rest.elements.every(Number.isFinite) || Math.abs(rest.determinant()) < 1e-12) throw new TypeError(`Singular BOBJ rest transform: ${bone.name}`)
    } else output.set(bone.name, local)
  }
  return output
}

/** Bake same-rig CPU samples into the pinned BOBJ pose_transform convention. */
export function bakeFilmPoseTracks(
  sourceBones: SourceBone[],
  metersPerUnit: number,
  model: FilmModelProfile,
  samples: Array<{ tick: number; skeleton: SkeletonFrameSample }>,
  basisToScene = [1, 0, 0, 0, 1, 0, 0, 0, 1],
): FilmPoseTrack[] {
  if (!Array.isArray(sourceBones) || !sourceBones.length || sourceBones.length > 512 || !Number.isFinite(metersPerUnit) || metersPerUnit <= 0) throw new TypeError('Film pose bake requires a bounded source skeleton and positive unit scale')
  if (!model || typeof model.modelId !== 'string' || !Array.isArray(model.bones) || model.bones.length !== sourceBones.length) throw new TypeError('Film BOBJ profile does not match the source skeleton')
  if (!Array.isArray(samples) || samples.length < 1 || samples.length > 256 || samples.some((sample, index) => !Number.isSafeInteger(sample.tick) || sample.tick !== index)) throw new TypeError('Film pose samples must use consecutive integer ticks including endpoints')

  const sourceById = new Map(sourceBones.map((bone) => [bone.id, bone]))
  const sourceParent = new Map<string, string | null>()
  const sourceRest = new Map<string, Matrix4>()
  for (const bone of sourceBones) {
    if (!bone.id || !bone.name || sourceRest.has(bone.name) || bone.parentId !== null && !sourceById.has(bone.parentId)) throw new TypeError(`Invalid source bone hierarchy: ${bone.name}`)
    const parent = bone.parentId === null ? null : sourceById.get(bone.parentId)?.name
    if (bone.parentId !== null && !parent) throw new TypeError(`Missing source parent: ${bone.name}`)
    sourceParent.set(bone.name, parent ?? null)
    const local = sourceLocal(bone)
    const world = parent ? sourceRest.get(parent)?.clone().multiply(local) : local
    if (!world) throw new TypeError(`Source parents must precede children: ${bone.name}`)
    sourceRest.set(bone.name, world)
  }
  const sourceNameByTarget = new Map(model.bones.map((bone) => [bone.name, bone.sourceName ?? bone.name]))
  const targetBySource = new Map(model.bones.map((bone) => [bone.sourceName ?? bone.name, bone]))
  if (sourceNameByTarget.size !== sourceBones.length || targetBySource.size !== sourceBones.length || model.bones.some((bone) => {
    const sourceName = bone.sourceName ?? bone.name
    const sourceParentName = sourceParent.get(sourceName) ?? null
    const targetParentSourceName = bone.parent === null ? null : sourceNameByTarget.get(bone.parent)
    return !sourceRest.has(sourceName) || sourceParentName !== targetParentSourceName
  })) throw new TypeError('Source and BOBJ bone names or parents differ')
  const targetRest = bobjWorld(model.bones)
  const roots = sourceBones.filter((bone) => bone.parentId === null)
  if (roots.length !== 1) throw new TypeError('Film pose bake requires one connected skeleton root')
  const rootName = roots[0]!.name
  const targetRoot = model.bones.find((bone) => bone.parent === null)!
  const sceneBasis = sourceBasis(basisToScene)
  const sourceUnit = new Matrix4().makeScale(metersPerUnit, metersPerUnit, metersPerUnit)
  for (const [name, rest] of sourceRest) sourceRest.set(name, sourceUnit.clone().multiply(rest))
  for (const [name, rest] of sourceRest) sourceRest.set(name, sceneBasis.clone().multiply(rest))
  const rootSourceRest = sourceRest.get(rootName)!
  const basis = targetRest.get(targetRoot.name)!.clone().multiply(rootSourceRest.clone().invert())
  const basisInverse = basis.clone().invert()
  const boneBasis = new Map<string, Matrix4>()
  for (const bone of model.bones) {
    const name = bone.name, sourceName = bone.sourceName ?? bone.name, parent = bone.parent === null ? undefined : bone.parent
    const sourceParentName = parent ? sourceNameByTarget.get(parent)! : undefined
    const sourceParentRest = sourceParentName ? sourceRest.get(sourceParentName) : undefined
    const targetParentRest = parent ? targetRest.get(parent) : undefined
    const sourceLocalRest = sourceParentRest ? sourceParentRest.clone().invert().multiply(sourceRest.get(sourceName)!) : sourceRest.get(sourceName)!
    const targetLocalRest = targetParentRest ? targetParentRest.clone().invert().multiply(targetRest.get(name)!) : targetRest.get(name)!
    const parentBasis = parent ? boneBasis.get(parent) : basis
    if (!parentBasis) throw new TypeError(`BOBJ parent must precede its child: ${name}`)
    const conversion = targetLocalRest.clone().invert().multiply(parentBasis).multiply(sourceLocalRest)
    const position = new Vector3(), rotation = new Quaternion(), scale = new Vector3()
    conversion.decompose(position, rotation, scale)
    if (!conversion.elements.every(Number.isFinite) || Math.abs(conversion.determinant()) < 1e-12 ||
        scale.toArray().some((value) => Math.abs(value - 1) > MATRIX_TOLERANCE) || !matrixClose(conversion, new Matrix4().compose(position, rotation, scale))) {
      throw new TypeError(`Source/BOBJ bind frame must be rigid: ${name}`)
    }
    boneBasis.set(name, conversion)
  }

  const previousEuler = new Map<string, Euler>()
  const tracks = new Map(model.bones.map((bone) => [bone.name, { boneName: bone.name, keyframes: [] as FilmPoseKey[] }]))
  for (const sample of samples) {
    const { skeleton } = sample
    if (!skeleton || !Array.isArray(skeleton.actorWorldMatrix) || skeleton.actorWorldMatrix.length !== 16 || !skeleton.actorWorldMatrix.every(Number.isFinite) || !Number.isFinite(skeleton.metersPerUnit) || Math.abs(skeleton.metersPerUnit - metersPerUnit) > 1e-9) throw new TypeError('Film pose sample has invalid actor transform or units')
    const sampled = new Map((skeleton.bones ?? []).map((bone) => [bone.name, bone]))
    if (sampled.size !== sourceBones.length || model.bones.some((bone) => !sampled.has(bone.sourceName ?? bone.name))) throw new TypeError('Film pose sample is missing BOBJ bones')
    const actorInverse = new Matrix4().fromArray(skeleton.actorWorldMatrix).invert()
    if (!actorInverse.elements.every(Number.isFinite) || Math.abs(actorInverse.determinant()) < 1e-12) throw new TypeError('Film actor transform is singular')
    const worldCurrent = new Map<string, Matrix4>()
    for (const bone of model.bones) {
      const sourceName = bone.sourceName ?? bone.name
      const current = new Matrix4().fromArray(sampled.get(sourceName)!.worldMatrix)
      if (!current.elements.every(Number.isFinite)) throw new TypeError(`Non-finite sampled bone: ${bone.name}`)
      worldCurrent.set(bone.name, basis.clone().multiply(actorInverse).multiply(current))
    }
    for (const bone of model.bones) {
      const currentWorld = worldCurrent.get(bone.name)!
      const parent = bone.parent === null ? undefined : worldCurrent.get(bone.parent)
      const currentLocal = parent ? parent.clone().invert().multiply(currentWorld) : basisInverse.clone().multiply(currentWorld)
      const sourceName = bone.sourceName ?? bone.name
      const sourceParentName = bone.parent === null ? undefined : sourceNameByTarget.get(bone.parent)
      const sourceParentRest = sourceParentName ? sourceRest.get(sourceParentName) : undefined
      const sourceRestWorld = sourceRest.get(sourceName)!
      const sourceRestLocal = sourceParentRest ? sourceParentRest.clone().invert().multiply(sourceRestWorld) : sourceRestWorld
      const sourceDelta = sourceRestLocal.clone().invert().multiply(currentLocal)
      const conversion = boneBasis.get(bone.name)!
      // Bone-local axes may differ even when the skeletons share one global basis.
      const delta = conversion.clone().multiply(sourceDelta).multiply(conversion.clone().invert())
      if (!delta.elements.every(Number.isFinite) || Math.abs(delta.determinant()) < 1e-12) throw new TypeError(`Singular pose transform: ${bone.name}`)
      const position = new Vector3(), quaternion = new Quaternion(), scale = new Vector3()
      delta.decompose(position, quaternion, scale)
      const reconstructed = new Matrix4().compose(position, quaternion, scale)
      if (!matrixClose(delta, reconstructed) || scale.toArray().some((value) => value <= 0)) throw new TypeError(`Pose contains shear or unsupported scale at ${bone.name}`)
      const prior = previousEuler.get(bone.name)
      const euler = new Euler().setFromQuaternion(quaternion.normalize(), 'ZYX')
      if (prior) {
        euler.x += 2 * Math.PI * Math.round((prior.x - euler.x) / (2 * Math.PI))
        euler.y += 2 * Math.PI * Math.round((prior.y - euler.y) / (2 * Math.PI))
        euler.z += 2 * Math.PI * Math.round((prior.z - euler.z) / (2 * Math.PI))
      }
      euler.x = Math.abs(euler.x) < 1e-12 ? 0 : euler.x
      euler.y = Math.abs(euler.y) < 1e-12 ? 0 : euler.y
      euler.z = Math.abs(euler.z) < 1e-12 ? 0 : euler.z
      previousEuler.set(bone.name, euler.clone())
      const clean = (value: number) => Math.abs(value) < 1e-12 ? 0 : value
      tracks.get(bone.name)!.keyframes.push({ tick: sample.tick, t: position.toArray().map(clean) as [number, number, number], s: scale.toArray().map(clean) as [number, number, number],
        r: [euler.x, euler.y, euler.z], r2: [0, 0, 0], fix: 0, color: -1, lighting: 0 })
    }
  }
  return [...tracks.values()]
}
