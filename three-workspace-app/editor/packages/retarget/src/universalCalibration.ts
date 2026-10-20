import { Matrix4, Quaternion, Vector3 } from 'three'
import type { RetargetPoseBone } from './universal'

export interface UniversalPoseReferenceV1 {
  kind: 'rest' | 'action'
  actionIndex: number | null
  timeSeconds: number | null
  bones: RetargetPoseBone[]
}

export interface UniversalReferencePoseV1 {
  type: 'bbs.universal-reference-pose'
  version: 1
  coordinateSpace: 'scene-meters-v1'
  sourceFingerprint: string
  targetFingerprint: string
  source: UniversalPoseReferenceV1
  target: UniversalPoseReferenceV1
}

export interface UniversalCalibrationDraftV1 {
  type: 'bbs.universal-calibration'
  version: 1
  engine: 'universal'
  algorithmVersion: 'universal-1'
  sourceFingerprint: string
  targetFingerprint: string
  chainMode: 'world-average'
  alignmentRotation: [number, number, number, number]
  corrections: Array<{ targetBoneId: string; rotation: [number, number, number, number] }>
  rootTranslationPolicy: 'preserve' | 'in-place'
  rootTranslationScale: number
}

export interface UniversalCalibrationV1 extends UniversalCalibrationDraftV1 {
  sourceHash: string
  mappingDigest: string
  referencePoseSha256: string
}

export function sealUniversalCalibrationV1(
  draft: UniversalCalibrationDraftV1,
  hashes: { sourceHash: string; mappingDigest: string; referencePoseSha256: string },
): UniversalCalibrationV1 {
  if (!isUniversalCalibrationDraftV1(draft, draft.sourceFingerprint, draft.targetFingerprint) ||
    ![hashes.sourceHash, hashes.mappingDigest, hashes.referencePoseSha256].every((value) => SHA256.test(value))) throw new TypeError('Universal calibration requires a valid draft and source, mapping, and reference hashes')
  return { ...draft, ...hashes }
}

export interface UniversalCalibrationRuntime {
  sourceReference: readonly RetargetPoseBone[]
  targetReference: readonly RetargetPoseBone[]
  alignmentRotation: readonly [number, number, number, number]
  corrections: readonly { targetBoneId: string; rotation: readonly [number, number, number, number] }[]
}

const SHA256 = /^[a-f0-9]{64}$/
const DRAFT_KEYS = ['type', 'version', 'engine', 'algorithmVersion', 'sourceFingerprint', 'targetFingerprint', 'chainMode', 'alignmentRotation', 'corrections', 'rootTranslationPolicy', 'rootTranslationScale']

function validQuaternion(value: unknown): value is [number, number, number, number] {
  if (!Array.isArray(value) || value.length !== 4 || value.some((item) => typeof item !== 'number' || !Number.isFinite(item))) return false
  const length = Math.hypot(...value as number[])
  return Math.abs(length - 1) <= 1e-5
}

function validPose(value: unknown, fingerprint: string, expectedBoneIds?: ReadonlySet<string>): value is UniversalPoseReferenceV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const pose = value as Partial<UniversalPoseReferenceV1>
  if (Object.keys(value).some((key) => !['kind', 'actionIndex', 'timeSeconds', 'bones'].includes(key)) || Object.keys(value).length !== 4 ||
    !['rest', 'action'].includes(String(pose.kind)) || !Array.isArray(pose.bones) || !pose.bones.length) return false
  if (pose.kind === 'rest' ? pose.actionIndex !== null || pose.timeSeconds !== null :
    !Number.isInteger(pose.actionIndex) || (pose.actionIndex as number) < 0 || typeof pose.timeSeconds !== 'number' || !Number.isFinite(pose.timeSeconds) || pose.timeSeconds < 0) return false
  const ids = new Set<string>()
  for (const bone of pose.bones) {
    if (!bone || Object.keys(bone).length !== 2 || Object.keys(bone).some((key) => !['id', 'world'].includes(key)) ||
      typeof bone.id !== 'string' || !bone.id || ids.has(bone.id) || !Array.isArray(bone.world) || bone.world.length !== 16 ||
      bone.world.some((item) => typeof item !== 'number' || !Number.isFinite(item))) return false
    const matrix = new Matrix4().fromArray(bone.world)
    const determinant = matrix.determinant()
    if (!Number.isFinite(determinant) || !(determinant > 0) || [3, 7, 11].some((index) => Math.abs(bone.world[index]!) > 1e-9) || Math.abs(bone.world[15]! - 1) > 1e-9) return false
    const position = new Vector3(), rotation = new Quaternion(), scale = new Vector3()
    matrix.decompose(position, rotation, scale)
    const reconstructed = new Matrix4().compose(position, rotation, scale)
    if (reconstructed.elements.some((item, index) => Math.abs(item - bone.world[index]!) > 1e-6 * Math.max(1, Math.abs(bone.world[index]!)))) return false
    ids.add(bone.id)
  }
  if (expectedBoneIds && (ids.size !== expectedBoneIds.size || [...ids].some((id) => !expectedBoneIds.has(id)))) return false
  return SHA256.test(fingerprint)
}

export function isUniversalCalibrationDraftV1(value: unknown, sourceFingerprint: string, targetFingerprint: string): value is UniversalCalibrationDraftV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const calibration = value as Partial<UniversalCalibrationDraftV1>
  if (Object.keys(value).length !== DRAFT_KEYS.length || Object.keys(value).some((key) => !DRAFT_KEYS.includes(key)) ||
    calibration.type !== 'bbs.universal-calibration' || calibration.version !== 1 || calibration.engine !== 'universal' ||
    calibration.algorithmVersion !== 'universal-1' || calibration.sourceFingerprint !== sourceFingerprint || calibration.targetFingerprint !== targetFingerprint ||
    calibration.chainMode !== 'world-average' || !validQuaternion(calibration.alignmentRotation) ||
    !Array.isArray(calibration.corrections) || !['preserve', 'in-place'].includes(String(calibration.rootTranslationPolicy)) ||
    typeof calibration.rootTranslationScale !== 'number' || !Number.isFinite(calibration.rootTranslationScale) || calibration.rootTranslationScale < 0.01 || calibration.rootTranslationScale > 20) return false
  const ids = new Set<string>()
  for (const correction of calibration.corrections) {
    if (!correction || Object.keys(correction).length !== 2 || Object.keys(correction).some((key) => !['targetBoneId', 'rotation'].includes(key)) ||
      typeof correction.targetBoneId !== 'string' || !correction.targetBoneId || ids.has(correction.targetBoneId) || !validQuaternion(correction.rotation)) return false
    ids.add(correction.targetBoneId)
  }
  return true
}

export function isUniversalCalibrationV1(value: unknown, sourceFingerprint: string, targetFingerprint: string): value is UniversalCalibrationV1 {
  if (!isUniversalCalibrationDraftV1(value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).filter(([key]) => DRAFT_KEYS.includes(key))) : value, sourceFingerprint, targetFingerprint)) return false
  const calibration = value as Partial<UniversalCalibrationV1>
  return Object.keys(value as object).length === DRAFT_KEYS.length + 3 && Object.keys(value as object).every((key) => [...DRAFT_KEYS, 'sourceHash', 'mappingDigest', 'referencePoseSha256'].includes(key)) &&
    ['sourceHash', 'mappingDigest', 'referencePoseSha256'].every((key) => SHA256.test(String((calibration as Record<string, unknown>)[key])))
}

export function isUniversalReferencePoseV1(
  value: unknown,
  sourceFingerprint: string,
  targetFingerprint: string,
  sourceBoneIds?: ReadonlySet<string>,
  targetBoneIds?: ReadonlySet<string>,
): value is UniversalReferencePoseV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const snapshot = value as Partial<UniversalReferencePoseV1>
  return Object.keys(value).length === 7 && Object.keys(value).every((key) => ['type', 'version', 'coordinateSpace', 'sourceFingerprint', 'targetFingerprint', 'source', 'target'].includes(key)) &&
    snapshot.type === 'bbs.universal-reference-pose' && snapshot.version === 1 && snapshot.coordinateSpace === 'scene-meters-v1' &&
    snapshot.sourceFingerprint === sourceFingerprint && snapshot.targetFingerprint === targetFingerprint &&
    validPose(snapshot.source, sourceFingerprint, sourceBoneIds) && validPose(snapshot.target, targetFingerprint, targetBoneIds)
}

export function calibrationRuntime(value: UniversalCalibrationV1, reference: UniversalReferencePoseV1, referencePoseSha256: string): UniversalCalibrationRuntime {
  if (!SHA256.test(referencePoseSha256) || value.referencePoseSha256 !== referencePoseSha256) throw new TypeError('Universal calibration reference pose hash does not match')
  return { sourceReference: reference.source.bones, targetReference: reference.target.bones,
    alignmentRotation: value.alignmentRotation, corrections: value.corrections }
}

