import { Matrix4, Quaternion, Vector3 } from 'three'
import type { UniversalCalibrationRuntime } from './universalCalibration'

export interface RetargetRigBone { id: string; name?: string; parentId: string | null; restWorld: number[] }
export interface RetargetRig { fingerprint: string; bones: RetargetRigBone[] }
export interface RetargetBonePair { sourceBoneId: string; sourceBoneIds?: string[]; sourceBoneWeights?: number[]; chainComposition?: 'world-average' | 'local-compose'; targetBoneId: string; enabled: boolean }
export interface RetargetPoseBone { id: string; world: number[] }
export interface UniversalRetargetFrame { targetBoneId: string; targetBoneName: string; position: number[]; rotation: number[]; scale: number[]; world: number[] }
export interface UniversalMappingSuggestion { normalizedName: string; sourceBoneId: string | null; targetBoneId: string | null; ambiguousSource: boolean; ambiguousTarget: boolean }
export interface UniversalMappingReport { errors: Array<{ code: string; boneId?: string }>; unmappedSourceBoneIds: string[]; unmappedTargetBoneIds: string[]; missingRequiredTargetBoneIds: string[] }

function matrix(values: number[], label: string): Matrix4 {
  if (values.length !== 16 || values.some((value) => !Number.isFinite(value))) throw new TypeError(`${label} must be a finite 4x4 matrix`)
  const result = new Matrix4().fromArray(values)
  if ([3, 7, 11].some((index) => Math.abs(values[index]!) > 1e-9) || Math.abs(values[15]! - 1) > 1e-9 || !(result.determinant() > 0)) throw new TypeError(`${label} requires an invertible orientation-preserving affine transform`)
  const position = new Vector3(), rotation = new Quaternion(), scale = new Vector3()
  result.decompose(position, rotation, scale)
  const reconstructed = new Matrix4().compose(position, rotation, scale)
  // Imported rigs can carry a large uniform node scale with float32-sized basis noise; keep translation checks strict.
  const scaleMagnitude = Math.max(1, ...scale.toArray().map((value) => Math.abs(value)))
  if (reconstructed.elements.some((value, index) => Math.abs(value - values[index]!) > (index < 12 && index % 4 < 3 ? 1e-5 * scaleMagnitude : 1e-6 * Math.max(1, Math.abs(values[index]!))))) throw new TypeError(`${label} contains unsupported shear`)
  return result
}

function indexRig(rig: RetargetRig, label: string): Map<string, RetargetRigBone> {
  if (!rig.fingerprint || !rig.bones.length) throw new TypeError(`${label} rig is empty`)
  const bones = new Map<string, RetargetRigBone>()
  for (const bone of rig.bones) {
    if (!bone.id || bones.has(bone.id)) throw new TypeError(`${label} rig has an empty or duplicate bone ID`)
    matrix(bone.restWorld, `${label} rest matrix for ${bone.id}`)
    bones.set(bone.id, bone)
  }
  for (const bone of rig.bones) if (bone.parentId && !bones.has(bone.parentId)) throw new TypeError(`${label} bone ${bone.id} has missing parent ${bone.parentId}`)
  return bones
}

function topological(bones: Map<string, RetargetRigBone>): RetargetRigBone[] {
  const children = new Map<string, RetargetRigBone[]>()
  const ready = [...bones.values()].filter((bone) => !bone.parentId)
  for (const bone of bones.values()) if (bone.parentId) {
    const siblings = children.get(bone.parentId)
    if (siblings) siblings.push(bone)
    else children.set(bone.parentId, [bone])
  }
  const result: RetargetRigBone[] = []
  for (let index = 0; index < ready.length; index += 1) {
    const bone = ready[index]!
    result.push(bone)
    ready.push(...(children.get(bone.id) ?? []))
  }
  if (result.length !== bones.size) throw new TypeError('Target rig contains a hierarchy cycle')
  return result
}

function canonicalName(name: string): string { return name.split(':').pop()!.replace(/^mixamorig\d*/i, '').replace(/[^a-z0-9]/gi, '').toLowerCase() }

export function buildUniversalMappingSuggestions(source: RetargetRig, target: RetargetRig): UniversalMappingSuggestion[] {
  const names = (rig: RetargetRig, label: string) => {
    const result = new Map<string, string[]>()
    for (const bone of indexRig(rig, label).values()) {
      const name = canonicalName(bone.name ?? bone.id)
      if (name) {
        const matches = result.get(name)
        if (matches) matches.push(bone.id)
        else result.set(name, [bone.id])
      }
    }
    return result
  }
  const sources = names(source, 'Source'), targets = names(target, 'Target')
  return [...new Set([...sources.keys(), ...targets.keys()])].map((name) => {
    const sourceIds = sources.get(name) ?? [], targetIds = targets.get(name) ?? []
    return { normalizedName: name, sourceBoneId: sourceIds.length === 1 ? sourceIds[0]! : null, targetBoneId: targetIds.length === 1 ? targetIds[0]! : null,
      ambiguousSource: sourceIds.length > 1, ambiguousTarget: targetIds.length > 1 }
  })
}

export function validateUniversalMapping(sourceRig: RetargetRig, targetRig: RetargetRig, pairs: readonly RetargetBonePair[], requiredTargetBoneIds: readonly string[] = []): UniversalMappingReport {
  const source = indexRig(sourceRig, 'Source'), target = indexRig(targetRig, 'Target')
  const errors: UniversalMappingReport['errors'] = []
  const usedSources = new Set<string>(), usedTargets = new Set<string>()
  for (const pair of pairs) {
    const sourceIds = pair.sourceBoneIds ?? [pair.sourceBoneId]
    if (!Array.isArray(sourceIds) || !sourceIds.length || sourceIds[0] !== pair.sourceBoneId || new Set(sourceIds).size !== sourceIds.length) errors.push({ code: 'SOURCE_CHAIN_INVALID', boneId: pair.sourceBoneId })
    const weights = pair.sourceBoneWeights
    if (weights !== undefined && (!Array.isArray(weights) || weights.length !== sourceIds.length || weights.some((weight) => !Number.isFinite(weight) || weight < 0) || !weights.some((weight) => weight > 0))) errors.push({ code: 'SOURCE_CHAIN_WEIGHTS_INVALID', boneId: pair.sourceBoneId })
    if (pair.chainComposition !== undefined && !['world-average', 'local-compose'].includes(pair.chainComposition) || pair.chainComposition === 'local-compose' && (sourceIds.length < 2 || (weights ?? []).some((weight) => weight > 1))) errors.push({ code: 'SOURCE_CHAIN_COMPOSITION_INVALID', boneId: pair.sourceBoneId })
    for (const sourceId of Array.isArray(sourceIds) ? sourceIds : []) if (!source.has(sourceId)) errors.push({ code: 'SOURCE_BONE_MISSING', boneId: sourceId })
    if (Array.isArray(sourceIds) && sourceIds.length > 1) for (let index = 1; index < sourceIds.length; index += 1) {
      let ancestor = source.get(sourceIds[index]!)?.parentId ?? null
      while (ancestor && ancestor !== sourceIds[index - 1]) ancestor = source.get(ancestor)?.parentId ?? null
      if (ancestor !== sourceIds[index - 1]) errors.push({ code: 'SOURCE_CHAIN_NOT_CONTIGUOUS', boneId: sourceIds[index] })
    }
    if (!target.has(pair.targetBoneId)) errors.push({ code: 'TARGET_BONE_MISSING', boneId: pair.targetBoneId })
    if (pair.enabled && target.has(pair.targetBoneId) && usedTargets.has(pair.targetBoneId)) errors.push({ code: 'DUPLICATE_TARGET_BONE', boneId: pair.targetBoneId })
    if (pair.enabled) for (const sourceId of Array.isArray(sourceIds) ? sourceIds : []) if (source.has(sourceId)) usedSources.add(sourceId)
    if (pair.enabled && target.has(pair.targetBoneId)) usedTargets.add(pair.targetBoneId)
  }
  const required = new Set(requiredTargetBoneIds)
  for (const id of required) if (!target.has(id)) errors.push({ code: 'REQUIRED_TARGET_BONE_MISSING', boneId: id })
  return {
    errors,
    unmappedSourceBoneIds: sourceRig.bones.filter((bone) => !usedSources.has(bone.id)).map((bone) => bone.id),
    unmappedTargetBoneIds: targetRig.bones.filter((bone) => !usedTargets.has(bone.id)).map((bone) => bone.id),
    missingRequiredTargetBoneIds: [...required].filter((id) => !usedTargets.has(id)),
  }
}

function worldRotation(value: Matrix4): Quaternion {
  const rotation = new Quaternion()
  value.decompose(new Vector3(), rotation, new Vector3())
  return rotation.normalize()
}

function averageQuaternions(values: readonly Quaternion[], weights: readonly number[]): Quaternion {
  if (!values.length) throw new TypeError('Cannot average an empty source chain')
  const maxWeight = weights.reduce((max, weight) => Math.max(max, weight), 0)
  if (weights.length !== values.length || weights.some((weight) => !Number.isFinite(weight) || weight < 0) || !(maxWeight > 0)) throw new TypeError('Source-chain weights must match the chain and have a positive finite value')
  const reference = values[weights.findIndex((weight) => weight > 0)]!
  let x = 0, y = 0, z = 0, w = 0
  for (const [index, value] of values.entries()) {
    const sign = reference.dot(value) < 0 ? -1 : 1
    const weight = weights[index]! / maxWeight
    x += value.x * sign * weight; y += value.y * sign * weight; z += value.z * sign * weight; w += value.w * sign * weight
  }
  if (Math.hypot(x, y, z, w) < 1e-8) throw new TypeError('Source-chain rotations cancel and cannot be normalized')
  return new Quaternion(x, y, z, w).normalize()
}

/** Retargets normalized world-space samples; adapters must convert source units and basis before evaluation. */
export function createUniversalRetargeter(sourceRig: RetargetRig, targetRig: RetargetRig, pairs: readonly RetargetBonePair[], rootTranslationScale = 1, rootTranslationPolicy: 'preserve' | 'in-place' = 'preserve', calibration?: UniversalCalibrationRuntime) {
  const source = indexRig(sourceRig, 'Source')
  const target = indexRig(targetRig, 'Target')
  topological(source)
  if (!Number.isFinite(rootTranslationScale) || rootTranslationScale <= 0) throw new RangeError('Root translation scale must be positive and finite')
  if (!['preserve', 'in-place'].includes(rootTranslationPolicy)) throw new TypeError('Root translation policy must be preserve or in-place')
  const sourceByTarget = new Map<string, { bones: RetargetRigBone[]; weights: number[]; chainComposition: 'world-average' | 'local-compose' }>()
  for (const pair of pairs) {
    if (typeof pair.enabled !== 'boolean') throw new TypeError('Mapping enabled must be boolean')
    if (!pair.enabled) continue
    const sourceIds = pair.sourceBoneIds ?? [pair.sourceBoneId]
    if (!Array.isArray(sourceIds) || !sourceIds.length || sourceIds[0] !== pair.sourceBoneId || new Set(sourceIds).size !== sourceIds.length) throw new TypeError(`Mapping has an invalid source chain for ${pair.targetBoneId}`)
    const weights = pair.sourceBoneWeights ?? sourceIds.map(() => 1)
    if (!Array.isArray(weights) || weights.length !== sourceIds.length || weights.some((weight) => !Number.isFinite(weight) || weight < 0) || !weights.some((weight) => weight > 0)) throw new TypeError(`Mapping has invalid source-chain weights for ${pair.targetBoneId}`)
    const chainComposition = pair.chainComposition ?? 'world-average'
    if (!['world-average', 'local-compose'].includes(chainComposition) || chainComposition === 'local-compose' && (sourceIds.length < 2 || weights.some((weight) => weight > 1))) throw new TypeError(`Invalid local-compose weights or chain for ${pair.targetBoneId}`)
    const sourceBones = sourceIds.map((id) => source.get(id))
    if (sourceBones.some((bone) => !bone)) throw new TypeError(`Mapping references a missing source bone for ${pair.targetBoneId}`)
    for (let index = 1; index < sourceIds.length; index += 1) {
      let ancestor = source.get(sourceIds[index]!)?.parentId ?? null
      while (ancestor && ancestor !== sourceIds[index - 1]) ancestor = source.get(ancestor)?.parentId ?? null
      if (ancestor !== sourceIds[index - 1]) throw new TypeError(`Mapping source chain is not ancestor-ordered at ${sourceIds[index]}`)
    }
    if (!target.has(pair.targetBoneId)) throw new TypeError(`Mapping references missing target bone ${pair.targetBoneId}`)
    if (sourceByTarget.has(pair.targetBoneId)) throw new TypeError(`Target bone ${pair.targetBoneId} is mapped more than once`)
    sourceByTarget.set(pair.targetBoneId, { bones: sourceBones as RetargetRigBone[], weights, chainComposition })
  }
  if (!sourceByTarget.size) throw new TypeError('At least one enabled bone mapping is required')
  const order = topological(target)
  const root = order.find((bone) => sourceByTarget.has(bone.id))!
  const referenceMatrices = (rig: Map<string, RetargetRigBone>, reference: readonly RetargetPoseBone[] | undefined, label: string) => {
    if (!reference) return new Map([...rig].map(([id, bone]) => [id, matrix(bone.restWorld, `${label} rest ${id}`)]))
    const result = new Map<string, Matrix4>()
    for (const bone of reference) {
      if (!rig.has(bone.id) || result.has(bone.id)) throw new TypeError(`${label} reference contains an unknown or duplicate bone ${bone.id}`)
      result.set(bone.id, matrix(bone.world, `${label} reference ${bone.id}`))
    }
    if (result.size !== rig.size) throw new TypeError(`${label} reference must contain every rig bone (${result.size}/${rig.size})`)
    return result
  }
  const sourceRest = referenceMatrices(source, calibration?.sourceReference, 'Source')
  const targetRest = referenceMatrices(target, calibration?.targetReference, 'Target')
  const alignment = new Quaternion(...(calibration?.alignmentRotation ?? [0, 0, 0, 1])).normalize()
  if (calibration && Math.abs(Math.hypot(...calibration.alignmentRotation) - 1) > 1e-5) throw new TypeError('Calibration alignment must be a normalized quaternion')
  const corrections = new Map<string, Quaternion>()
  for (const correction of calibration?.corrections ?? []) {
    if (!target.has(correction.targetBoneId) || corrections.has(correction.targetBoneId) || Math.abs(Math.hypot(...correction.rotation) - 1) > 1e-5) throw new TypeError(`Calibration has an invalid or duplicate correction for ${correction.targetBoneId}`)
    corrections.set(correction.targetBoneId, new Quaternion(...correction.rotation))
  }

  return {
    evaluate(sample: readonly RetargetPoseBone[]): UniversalRetargetFrame[] {
      const pose = new Map<string, Matrix4>()
      for (const item of sample) {
        if (!source.has(item.id) || pose.has(item.id)) throw new TypeError(`Sample has unknown or duplicate source bone ${item.id}`)
        pose.set(item.id, matrix(item.world, `Source pose ${item.id}`))
      }
      for (const { bones, chainComposition } of sourceByTarget.values()) for (const bone of bones) {
        if (!pose.has(bone.id)) throw new TypeError(`Sample is missing mapped source bone ${bone.id}`)
        if (chainComposition === 'local-compose' && bone.parentId && !pose.has(bone.parentId)) throw new TypeError(`Sample is missing local-compose parent bone ${bone.parentId}`)
      }
      for (const { bones } of sourceByTarget.values()) for (const bone of bones) {
        const restScale = new Vector3().setFromMatrixScale(sourceRest.get(bone.id)!)
        const sampleScale = new Vector3().setFromMatrixScale(pose.get(bone.id)!)
        if (sampleScale.toArray().some((value, axis) => Math.abs(value / restScale.toArray()[axis]! - 1) > 1e-5)) throw new TypeError(`Source bone ${bone.id} has unsupported animated scale; bake or resolve its scale policy before retargeting`)
      }

      const worldByTarget = new Map<string, Matrix4>()
      return order.map((bone) => {
        const restWorld = targetRest.get(bone.id)!
        const parentWorld = bone.parentId ? worldByTarget.get(bone.parentId)! : null
        const parentRestWorld = bone.parentId ? targetRest.get(bone.parentId)! : null
        const restLocal = parentRestWorld ? parentRestWorld.clone().invert().multiply(restWorld) : restWorld
        const mapped = sourceByTarget.get(bone.id)
        let world = parentWorld ? parentWorld.clone().multiply(restLocal) : restWorld.clone()
        if (mapped) {
          const targetRestQ = worldRotation(restWorld)
          const correction = corrections.get(bone.id) ?? new Quaternion()
          let worldQ: Quaternion
          if (mapped.chainComposition === 'local-compose') {
            const localDeltas: Quaternion[] = []
            let previous = mapped.bones[0]!.parentId
            const sourceAnchorRestQ = previous ? worldRotation(sourceRest.get(previous)!) : new Quaternion()
            for (let index = 0; index < mapped.bones.length; index += 1) {
              const sourceBone = mapped.bones[index]!
              const path: RetargetRigBone[] = []
              let cursor: RetargetRigBone | undefined = sourceBone
              while (cursor && cursor.id !== previous) { path.unshift(cursor); cursor = cursor.parentId ? source.get(cursor.parentId) : undefined }
              if (previous && cursor?.id !== previous) throw new TypeError(`Local-compose chain is not ancestor-ordered at ${sourceBone.id}`)
              const weight = mapped.weights[index]!
              for (const contributor of path) {
                const sourceParentRest = contributor.parentId ? sourceRest.get(contributor.parentId)! : new Matrix4()
                const sourceParentPose = contributor.parentId ? pose.get(contributor.parentId)! : new Matrix4()
                const sourceRestLocal = worldRotation(sourceParentRest).invert().multiply(worldRotation(sourceRest.get(contributor.id)!)).normalize()
                const sourcePoseLocal = worldRotation(sourceParentPose).invert().multiply(worldRotation(pose.get(contributor.id)!)).normalize()
                const delta = sourcePoseLocal.multiply(sourceRestLocal.invert()).normalize()
                const targetParentRestQ = parentRestWorld ? worldRotation(parentRestWorld) : new Quaternion()
                const frame = targetParentRestQ.invert().multiply(alignment).multiply(correction).multiply(sourceAnchorRestQ).normalize()
                const mappedDelta = frame.clone().multiply(delta).multiply(frame.clone().invert()).normalize()
                localDeltas.push(new Quaternion().slerp(mappedDelta, weight).normalize())
              }
              previous = sourceBone.id
            }
            const aggregate = localDeltas.reduce((result, delta) => result.multiply(delta).normalize(), new Quaternion())
            const targetParentRestQ = parentRestWorld ? worldRotation(parentRestWorld) : new Quaternion()
            const targetLocalRestQ = targetParentRestQ.invert().multiply(targetRestQ).normalize()
            const targetParentPoseQ = parentWorld ? worldRotation(parentWorld) : new Quaternion()
            worldQ = targetParentPoseQ.multiply(aggregate).multiply(targetLocalRestQ).normalize()
          } else {
            const inverseFrame = alignment.clone().multiply(correction).invert()
            const deltas = mapped.bones.map((sourceBone) => {
              const delta = worldRotation(pose.get(sourceBone.id)!).multiply(worldRotation(sourceRest.get(sourceBone.id)!).invert()).normalize()
              return alignment.clone().multiply(correction).multiply(delta).multiply(inverseFrame).normalize()
            })
            worldQ = averageQuaternions(deltas, mapped.weights).multiply(targetRestQ).normalize()
          }
          const worldPosition = new Vector3().setFromMatrixPosition(world)
          if (bone.id === root.id && rootTranslationPolicy === 'preserve') {
            const rootSource = mapped.bones[0]!
            const displacement = new Vector3().setFromMatrixPosition(pose.get(rootSource.id)!).sub(new Vector3().setFromMatrixPosition(sourceRest.get(rootSource.id)!))
              .applyQuaternion(alignment).multiplyScalar(rootTranslationScale)
            worldPosition.add(displacement)
          }
          // A wrist may have an animated local translation (for example, an IK wrist or a hand control).
          // Preserve that effector motion without transferring finger translations or changing ordinary
          // rotation-only Mixamo clips. Express the source delta in the mapped forearm frame, then map it
          // into the target forearm frame so different rest-axis conventions do not skew the wrist offset.
          const handMatch = /^(Left|Right)Hand$/.exec(bone.name ?? '')
          const sourceParentId = mapped.bones[0]?.parentId
          if (handMatch && mapped.bones.length === 1 && sourceParentId) {
            const sourceHand = mapped.bones[0]!
            const sourceParentRest = sourceRest.get(sourceParentId)
            const sourceParentPose = pose.get(sourceParentId)
            if (sourceParentRest && sourceParentPose) {
              const sourceLocalRest = sourceParentRest.clone().invert().multiply(sourceRest.get(sourceHand.id)!)
              const sourceLocalPose = sourceParentPose.clone().invert().multiply(pose.get(sourceHand.id)!)
              const localDelta = new Vector3().setFromMatrixPosition(sourceLocalPose).sub(new Vector3().setFromMatrixPosition(sourceLocalRest))
              if (localDelta.lengthSq() > 1e-16) {
                const sourceParentRestQ = worldRotation(sourceParentRest)
                const targetParentRestQ = parentRestWorld ? worldRotation(parentRestWorld) : new Quaternion()
                const targetParentPoseQ = parentWorld ? worldRotation(parentWorld) : new Quaternion()
                const sourceToTargetFrame = targetParentRestQ.clone().invert().multiply(alignment).multiply(sourceParentRestQ)
                worldPosition.add(localDelta.applyQuaternion(sourceToTargetFrame).multiplyScalar(rootTranslationScale).applyQuaternion(targetParentPoseQ))
              }
            }
          }
          const worldScale = new Vector3().setFromMatrixScale(restWorld)
          world = new Matrix4().compose(worldPosition, worldQ, worldScale)
        }
        const local = parentWorld ? parentWorld.clone().invert().multiply(world) : world.clone()
        const position = new Vector3(), rotation = new Quaternion(), scale = new Vector3()
        local.decompose(position, rotation, scale)
        worldByTarget.set(bone.id, world)
        return { targetBoneId: bone.id, targetBoneName: bone.name ?? bone.id, position: position.toArray(), rotation: rotation.normalize().toArray(), scale: scale.toArray(), world: world.toArray() }
      })
    },
  }
}
