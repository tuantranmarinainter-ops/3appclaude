import { Matrix4, Quaternion, Vector3 } from 'three'
import type { RetargetBonePair, RetargetPoseBone, RetargetRig, UniversalRetargetFrame } from './universal'

/** Solver consistency only: semantic mapping accuracy and contact quality need independent references. */
export function createNormalizationMetrics(source: RetargetRig, target: RetargetRig, pairs: readonly RetargetBonePair[], rootPolicy: 'preserve' | 'in-place', rootScale: number) {
  const sourceRest = new Map(source.bones.map((bone) => [bone.id, new Matrix4().fromArray(bone.restWorld)]))
  const targetRest = new Map(target.bones.map((bone) => [bone.id, new Matrix4().fromArray(bone.restWorld)]))
  const enabled = pairs.filter((pair) => pair.enabled), byTarget = new Map(enabled.map((pair) => [pair.targetBoneId, pair]))
  let angularCount = 0, angularSquared = 0, maxAngular = 0, maxRoot = 0, maxSegment = 0, frames = 0
  const rotation = (matrix: Matrix4) => { const q = new Quaternion(); matrix.decompose(new Vector3(), q, new Vector3()); return q.normalize() }
  return {
    observe(sample: readonly RetargetPoseBone[], result: readonly UniversalRetargetFrame[]) {
      const posed = new Map(sample.map((bone) => [bone.id, new Matrix4().fromArray(bone.world)]))
      const worlds = new Map(result.map((bone) => [bone.targetBoneId, new Matrix4().fromArray(bone.world)]))
      for (const pair of enabled) {
        const sourceIds = pair.sourceBoneIds ?? [pair.sourceBoneId]
        const deltas = sourceIds.map((id) => rotation(posed.get(id)!).multiply(rotation(sourceRest.get(id)!).invert()).normalize())
        const weights = pair.sourceBoneWeights ?? sourceIds.map(() => 1), maxWeight = weights.reduce((max, weight) => Math.max(max, weight), 0)
        const reference = deltas[weights.findIndex((weight) => weight > 0)]!, sum = new Quaternion(0, 0, 0, 0)
        for (const [index, delta] of deltas.entries()) { const sign = reference.dot(delta) < 0 ? -1 : 1, weight = weights[index]! / maxWeight; sum.x += delta.x * sign * weight; sum.y += delta.y * sign * weight; sum.z += delta.z * sign * weight; sum.w += delta.w * sign * weight }
        const expected = sum.normalize().multiply(rotation(targetRest.get(pair.targetBoneId)!))
        const angle = expected.angleTo(rotation(worlds.get(pair.targetBoneId)!)) * 180 / Math.PI
        angularCount++; angularSquared += angle * angle; maxAngular = Math.max(maxAngular, angle)
      }
      const root = result.find((bone) => byTarget.has(bone.targetBoneId))!
      const rootPair = byTarget.get(root.targetBoneId)!
      const expectedRoot = new Vector3().setFromMatrixPosition(targetRest.get(root.targetBoneId)!)
      if (rootPolicy === 'preserve') {
        const displacement = new Vector3().setFromMatrixPosition(posed.get(rootPair.sourceBoneId)!).sub(new Vector3().setFromMatrixPosition(sourceRest.get(rootPair.sourceBoneId)!)).multiplyScalar(rootScale)
        expectedRoot.add(displacement)
      }
      maxRoot = Math.max(maxRoot, expectedRoot.distanceTo(new Vector3().setFromMatrixPosition(worlds.get(root.targetBoneId)!)))
      for (const bone of target.bones) if (bone.parentId) {
        const restLength = new Vector3().setFromMatrixPosition(targetRest.get(bone.id)!).distanceTo(new Vector3().setFromMatrixPosition(targetRest.get(bone.parentId)!))
        const length = new Vector3().setFromMatrixPosition(worlds.get(bone.id)!).distanceTo(new Vector3().setFromMatrixPosition(worlds.get(bone.parentId)!))
        maxSegment = Math.max(maxSegment, Math.abs(length - restLength))
      }
      frames++
    },
    report() { return { scope: 'solver-consistency' as const, sampledFrames: frames, mappedJointSamples: angularCount,
      mappedRotationMaxDegrees: maxAngular, mappedRotationRmsDegrees: angularCount ? Math.sqrt(angularSquared / angularCount) : null,
      rootTranslationMaxErrorMeters: maxRoot, segmentLengthMaxErrorMeters: maxSegment,
      contactDrift: null, semanticMappingAccuracy: null, meshDeformation: null } },
  }
}
