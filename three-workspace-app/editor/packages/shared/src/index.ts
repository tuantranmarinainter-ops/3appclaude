import type { DirectorDocument } from '@topview/3d-builder'
import { directorDocumentSchema, fcurvesCompactV1Schema } from '@topview/3d-builder/evaluate'
export { validateFeatureTree, type FeatureNode, type FeatureWorkspace } from './featureNavigation'

export type ID = string
export type AssetID = `sha256:${string}`
export type CharacterID = ID
export type ClipID = string
export type Vec3 = [number, number, number]
export type Quaternion = [number, number, number, number]
export type TransformXYZ = DirectorDocument['content']['nodes'][number]['transform']
export type Timeline = DirectorDocument['content']['timeline']
export type SceneGraph = Pick<DirectorDocument['content'], 'nodes'>

export function findRootMotionConflict(scene: DirectorDocument): { clipId: string; pathClipId: string } | null {
  const animation = scene.content.timeline.animation
  for (const clip of animation.motionClips) {
    if (clip.motion.rootMotion?.policy !== 'trajectory') continue
    const path = animation.pathMotionClips.find((path) => path.target.nodeId === clip.target.nodeId &&
      path.frameStart <= clip.frameEnd && path.frameEnd >= clip.frameStart && isRecord(path.derivedSource) &&
      (path.derivedSource.motionClipId === clip.id || path.derivedSource.motionId === clip.motion.assetId))
    if (path) return { clipId: clip.id, pathClipId: path.id }
  }
  return null
}
export type RootMotionPolicy = 'in-place' | 'skeletal' | 'trajectory'

export interface Asset {
  id: AssetID
  kind: 'model' | 'motion' | 'texture' | 'pose' | 'other'
  displayName: string
  source: BlobRef
  derivatives: Record<string, BlobRef>
  provenance: Provenance
  license: string | null
  dependencies: AssetID[]
}

export interface Character {
  id: CharacterID
  assetId: AssetID
  nodeId: string
  skeletonId: ID
  name: string
}

export interface Provenance {
  sourceKey: string
  sourceVersion: string
  sourceHash: string
  original: BlobRef
  legacyId?: string
  nativeFingerprint?: string
}

export interface BlobRef {
  path: string
  sha256: string
  mediaType: string
  byteLength: number
}

export interface SkeletonProfile {
  id: ID
  family: 'metarig' | 'mixamo65' | 'minecraft20' | 'custom-preserved'
  bones: Array<{ id: string; name: string; parentId: string | null; rest: unknown; deform: boolean }>
  rootBoneId: string
  metersPerUnit: number
  basisToScene: number[]
  fingerprint: string
  nativeFingerprint: string | null
  provenance: Provenance
}

export interface MotionBinding {
  clipId: ClipID
  characterId: CharacterID
  motionId: ID
  sourceStartSeconds: number
  sourceLengthSeconds: number
  reverse: boolean
  fadeInSeconds: number
  fadeOutSeconds: number
  rootPolicy: RootMotionPolicy
  alignment: 'origin' | 'continue'
}

export interface Motion {
  id: ID
  assetId: AssetID
  skeletonId: ID
  durationSeconds: number
  sourceFps: number
  sourceClip: BlobRef
  evaluator: 'animation-1.31.8' | 'retarget-9.12' | 'topview-0.1.8'
  edit: BlobRef | null
  derivedFrom: ID | null
}

export interface SkeletonMapping {
  id: ID
  sourceProfileId: ID
  targetProfileId: ID
  sourceFingerprint: string
  targetFingerprint: string
  pairs: Array<{ sourceBoneId: string; sourceBoneIds?: string[]; sourceBoneWeights?: number[]; chainComposition?: 'world-average' | 'local-compose'; targetBoneId: string; role: string; enabled: boolean }>
  ignored: Array<{ side: 'source' | 'target'; boneId: string; reason: string }>
  calibration: BlobRef
  referencePose: BlobRef | null
  confirmed: boolean
}

export interface RetargetSession {
  id: ID
  sourceMotionId: ID
  targetCharacterId: CharacterID
  mappingId: ID
  nativeProject: BlobRef
  generatedMotionId: ID | null
}

export interface CameraShot {
  id: string
  cameraNodeId: string
  sourceFrameStart: number
  sourceFrameEnd: number
}

export interface ProjectRevision {
  projectId: ID
  revision: number
  requestId: string
  changedIds: string[]
}

export interface UnifiedProject {
  type: 'three-workspace-project'
  version: 1
  projectId: ID
  name: string
  revision: number
  scene: DirectorDocument
  assets: Record<AssetID, Asset>
  characters: Record<CharacterID, Character>
  skeletons: Record<ID, SkeletonProfile>
  mappings: Record<ID, SkeletonMapping>
  motions: Record<ID, Motion>
  bindings: Record<ClipID, MotionBinding>
  retargetSessions: Record<ID, RetargetSession>
  extensions: Record<string, Record<string, unknown>>
  origins: Provenance[]
}

export interface CommandEnvelope {
  requestId: string
  projectId?: string
  expectedRevision?: number
  command: string
  args: Record<string, unknown>
  dryRun?: boolean
}

export interface CommandSuccess {
  ok: true
  requestId: string
  projectId: string
  revision: number
  result: Record<string, unknown>
  warnings: Array<{ code: string; path: string; message: string }>
  changedIds: string[]
}

export interface HistorySummary {
  canUndo: boolean
  canRedo: boolean
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function validateJson(value: unknown, depth = 0): string | null {
  if (depth > 64) return 'JSON depth exceeds 64'
  if (typeof value === 'number' && !Number.isFinite(value)) return 'Numbers must be finite'
  if (Array.isArray(value)) {
    for (const child of value) {
      const error = validateJson(child, depth + 1)
      if (error) return error
    }
  } else if (isRecord(value)) {
    for (const [key, child] of Object.entries(value)) {
      if (key === '__proto__' || key === 'prototype' || key === 'constructor') return `Forbidden key: ${key}`
      const error = validateJson(child, depth + 1)
      if (error) return error
    }
  } else if (value !== null && !['string', 'number', 'boolean'].includes(typeof value)) {
    return 'Value is not JSON-compatible'
  }
  return null
}

export function validateJsonPayload(value: unknown, maxBytes = 64 * 1024 * 1024): boolean {
  if (validateJson(value) !== null) return false
  try { return new TextEncoder().encode(JSON.stringify(value)).byteLength <= maxBytes } catch { return false }
}

export function validateFCurves(value: unknown): boolean {
  return value === null || validateJsonPayload(value) && fcurvesCompactV1Schema.safeParse(value).success
}

export function validateDirectorDocument(value: unknown): value is DirectorDocument {
  if (!isRecord(value) || value.type !== 'biz/scene3d-director-document' || !validateJsonPayload(value)) return false
  const parsed = directorDocumentSchema.safeParse(value)
  if (!parsed.success) return false
  const ids = new Set<string>()
  for (const node of parsed.data.content.nodes) {
    if (ids.has(node.id)) return false
    ids.add(node.id)
  }
  return true
}

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SHA256 = /^[0-9a-f]{64}$/

function hasKeys(value: Record<string, unknown>, required: string[], allowed = required): boolean {
  return required.every((key) => Object.prototype.hasOwnProperty.call(value, key)) && Object.keys(value).every((key) => allowed.includes(key))
}

function nonEmptyString(value: unknown): value is string { return typeof value === 'string' && value.trim().length > 0 }
function isUuid(value: unknown): value is string { return typeof value === 'string' && UUID_V4.test(value) }
function isSha256(value: unknown): value is string { return typeof value === 'string' && SHA256.test(value) }
function isFiniteNumber(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value) }

function numberTuple(value: unknown, length: number): value is number[] {
  return Array.isArray(value) && value.length === length && value.every(isFiniteNumber)
}

function validOrthonormalBasis(value: unknown): value is number[] {
  if (!numberTuple(value, 9)) return false
  const m = value
  const rows = [[m[0]!, m[1]!, m[2]!], [m[3]!, m[4]!, m[5]!], [m[6]!, m[7]!, m[8]!]]
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    const dot = rows[i]!.reduce((sum, n, k) => sum + n * rows[j]![k]!, 0)
    if (Math.abs(dot - (i === j ? 1 : 0)) > 1e-6) return false
  }
  const determinant = m[0]! * (m[4]! * m[8]! - m[5]! * m[7]!) - m[1]! * (m[3]! * m[8]! - m[5]! * m[6]!) + m[2]! * (m[3]! * m[7]! - m[4]! * m[6]!)
  return Math.abs(Math.abs(determinant) - 1) <= 1e-6
}

function validBlobRef(value: unknown): value is BlobRef {
  if (!isRecord(value) || !hasKeys(value, ['path', 'sha256', 'mediaType', 'byteLength']) ||
    !isSha256(value.sha256) || !nonEmptyString(value.mediaType) || !Number.isSafeInteger(value.byteLength) || (value.byteLength as number) < 0) return false
  const path = value.path
  if (typeof path !== 'string' || !path || path.startsWith('/') || path.includes('\\') || /^[a-z]:/i.test(path)) return false
  return path.split('/').every((part) => part !== '' && part !== '.' && part !== '..')
}

function validProvenance(value: unknown): value is Provenance {
  if (!isRecord(value) || !hasKeys(value, ['sourceKey', 'sourceVersion', 'sourceHash', 'original'], ['sourceKey', 'sourceVersion', 'sourceHash', 'original', 'legacyId', 'nativeFingerprint']) ||
    !nonEmptyString(value.sourceKey) || !nonEmptyString(value.sourceVersion) || !nonEmptyString(value.sourceHash) || !validBlobRef(value.original)) return false
  return (value.legacyId === undefined || nonEmptyString(value.legacyId)) &&
    (value.nativeFingerprint === undefined || value.nativeFingerprint === null || nonEmptyString(value.nativeFingerprint))
}

function validAsset(value: unknown, key: string): value is Asset {
  return isRecord(value) && hasKeys(value, ['id', 'kind', 'displayName', 'source', 'derivatives', 'provenance', 'license', 'dependencies']) &&
    value.id === key && key.startsWith('sha256:') && isSha256(key.slice(7)) &&
    ['model', 'motion', 'texture', 'pose', 'other'].includes(String(value.kind)) && nonEmptyString(value.displayName) &&
    validBlobRef(value.source) && value.source.sha256 === key.slice(7) && isRecord(value.derivatives) &&
    Object.values(value.derivatives).every(validBlobRef) && validProvenance(value.provenance) &&
    (value.license === null || typeof value.license === 'string') && Array.isArray(value.dependencies) &&
    value.dependencies.every((id) => typeof id === 'string' && id.startsWith('sha256:') && isSha256(id.slice(7)))
}

function validBoneTransform(value: unknown): boolean {
  if (!isRecord(value) || !hasKeys(value, ['position', 'rotation', 'scale']) ||
    !numberTuple(value.position, 3) || !numberTuple(value.rotation, 4) || !numberTuple(value.scale, 3) || value.scale.some((n) => n === 0)) return false
  const norm = Math.hypot(...value.rotation)
  return Math.abs(norm - 1) <= 1e-6
}

function validSkeleton(value: unknown, key: string): value is SkeletonProfile {
  if (!isRecord(value) || !hasKeys(value, ['id', 'family', 'bones', 'rootBoneId', 'metersPerUnit', 'basisToScene', 'fingerprint', 'nativeFingerprint', 'provenance']) ||
    value.id !== key || !isUuid(key) || !['metarig', 'mixamo65', 'minecraft20', 'custom-preserved'].includes(String(value.family)) ||
    !Array.isArray(value.bones) || value.bones.length === 0 || value.bones.length > 200_000 || !nonEmptyString(value.rootBoneId) ||
    !isFiniteNumber(value.metersPerUnit) || value.metersPerUnit <= 0 || !validOrthonormalBasis(value.basisToScene) ||
    !isSha256(value.fingerprint) || !(value.nativeFingerprint === null || nonEmptyString(value.nativeFingerprint)) || !validProvenance(value.provenance)) return false
  const ids = new Set<string>()
  let roots = 0
  for (const bone of value.bones) {
    if (!isRecord(bone) || !hasKeys(bone, ['id', 'name', 'parentId', 'rest', 'deform']) || !nonEmptyString(bone.id) || !nonEmptyString(bone.name) ||
      !(bone.parentId === null || typeof bone.parentId === 'string' && ids.has(bone.parentId)) || !validBoneTransform(bone.rest) || typeof bone.deform !== 'boolean' ||
      ids.has(bone.id)) return false
    if (bone.parentId === null) roots++
    ids.add(bone.id)
  }
  if (roots !== 1 || !ids.has(value.rootBoneId) || value.bones.find((bone) => isRecord(bone) && bone.id === value.rootBoneId)?.parentId !== null) return false
  return true
}

function validCharacter(value: unknown, key: string, project: UnifiedProject, nodeIds: Set<string>): value is Character {
  return isRecord(value) && hasKeys(value, ['id', 'assetId', 'nodeId', 'skeletonId', 'name']) && value.id === key && isUuid(key) &&
    typeof value.assetId === 'string' && !!project.assets[value.assetId as AssetID] && project.assets[value.assetId as AssetID].kind === 'model' &&
    typeof value.nodeId === 'string' && nodeIds.has(value.nodeId) &&
    project.scene.content.nodes.some((node) => node.id === value.nodeId && node.type === 'character') &&
    typeof value.skeletonId === 'string' && !!project.skeletons[value.skeletonId] && nonEmptyString(value.name)
}

function validMapping(value: unknown, key: string, project: UnifiedProject): value is SkeletonMapping {
  if (!isRecord(value) || !hasKeys(value, ['id', 'sourceProfileId', 'targetProfileId', 'sourceFingerprint', 'targetFingerprint', 'pairs', 'ignored', 'calibration', 'referencePose', 'confirmed']) ||
    value.id !== key || !isUuid(key) || typeof value.sourceProfileId !== 'string' || typeof value.targetProfileId !== 'string' ||
    !project.skeletons[value.sourceProfileId] || !project.skeletons[value.targetProfileId] ||
    value.sourceFingerprint !== project.skeletons[value.sourceProfileId].fingerprint || value.targetFingerprint !== project.skeletons[value.targetProfileId].fingerprint ||
    !Array.isArray(value.pairs) || !Array.isArray(value.ignored) || !validBlobRef(value.calibration) ||
    !(value.referencePose === null || validBlobRef(value.referencePose)) || typeof value.confirmed !== 'boolean') return false
  const sourceProfile = project.skeletons[value.sourceProfileId]
  const sourceById = new Map(sourceProfile.bones.map((bone) => [bone.id, bone]))
  const sourceBones = new Set(sourceById.keys())
  const targetBones = new Set(project.skeletons[value.targetProfileId].bones.map((bone) => bone.id))
  const usedSources = new Set<string>()
  const usedTargets = new Set<string>()
  const roles = new Set<string>()
  for (const pair of value.pairs) {
    if (!isRecord(pair) || !hasKeys(pair, ['sourceBoneId', 'targetBoneId', 'role', 'enabled'], ['sourceBoneId', 'sourceBoneIds', 'sourceBoneWeights', 'chainComposition', 'targetBoneId', 'role', 'enabled']) || typeof pair.sourceBoneId !== 'string' || !sourceBones.has(pair.sourceBoneId) ||
      typeof pair.targetBoneId !== 'string' || !targetBones.has(pair.targetBoneId) || !nonEmptyString(pair.role) || typeof pair.enabled !== 'boolean' || roles.has(pair.role) || pair.enabled && usedTargets.has(pair.targetBoneId)) return false
    const sourceIds = pair.sourceBoneIds === undefined ? [pair.sourceBoneId] : pair.sourceBoneIds
    if (!Array.isArray(sourceIds) || !sourceIds.length || sourceIds[0] !== pair.sourceBoneId || new Set(sourceIds).size !== sourceIds.length || sourceIds.some((id) => typeof id !== 'string' || !sourceBones.has(id))) return false
    const weights = pair.sourceBoneWeights
    if (weights !== undefined && (!Array.isArray(weights) || weights.length !== sourceIds.length || weights.some((weight) => typeof weight !== 'number' || !Number.isFinite(weight) || weight < 0) || !weights.some((weight) => typeof weight === 'number' && weight > 0))) return false
    if (pair.chainComposition !== undefined && pair.chainComposition !== 'world-average' && pair.chainComposition !== 'local-compose' || pair.chainComposition === 'local-compose' && (sourceIds.length < 2 || (weights ?? []).some((weight) => typeof weight !== 'number' || weight > 1))) return false
    for (let index = 1; index < sourceIds.length; index += 1) {
      let ancestor = sourceById.get(sourceIds[index] as string)?.parentId ?? null
      while (ancestor && ancestor !== sourceIds[index - 1]) ancestor = sourceById.get(ancestor)?.parentId ?? null
      if (ancestor !== sourceIds[index - 1]) return false
    }
    roles.add(pair.role)
    if (pair.enabled) { for (const sourceId of sourceIds) usedSources.add(sourceId); usedTargets.add(pair.targetBoneId) }
  }
  const ignored = new Set<string>()
  for (const item of value.ignored) {
    if (!isRecord(item) || !hasKeys(item, ['side', 'boneId', 'reason']) || !nonEmptyString(item.boneId) || !nonEmptyString(item.reason) ||
      (item.side !== 'source' && item.side !== 'target')) return false
    const validBones = item.side === 'source' ? sourceBones : targetBones
    const usedBones = item.side === 'source' ? usedSources : usedTargets
    const key = `${item.side}:${item.boneId}`
    if (!validBones.has(item.boneId) || usedBones.has(item.boneId) || ignored.has(key)) return false
    ignored.add(key)
  }
  return [...sourceBones].every((id) => usedSources.has(id) || ignored.has(`source:${id}`)) &&
    [...targetBones].every((id) => usedTargets.has(id) || ignored.has(`target:${id}`))
}

function validMotion(value: unknown, key: string, project: UnifiedProject): value is Motion {
  return isRecord(value) && hasKeys(value, ['id', 'assetId', 'skeletonId', 'durationSeconds', 'sourceFps', 'sourceClip', 'evaluator', 'edit', 'derivedFrom']) &&
    value.id === key && isUuid(key) && typeof value.assetId === 'string' && !!project.assets[value.assetId as AssetID] &&
    ['model', 'motion'].includes(project.assets[value.assetId as AssetID].kind) &&
    typeof value.skeletonId === 'string' && !!project.skeletons[value.skeletonId] && isFiniteNumber(value.durationSeconds) && value.durationSeconds > 0 &&
    isFiniteNumber(value.sourceFps) && value.sourceFps > 0 && validBlobRef(value.sourceClip) &&
    ['animation-1.31.8', 'retarget-9.12', 'topview-0.1.8'].includes(String(value.evaluator)) &&
    (value.edit === null || validBlobRef(value.edit)) && (value.derivedFrom === null || typeof value.derivedFrom === 'string' && !!project.motions[value.derivedFrom])
}

function validSceneHierarchy(nodes: DirectorDocument['content']['nodes']): boolean {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  for (const node of nodes) {
    if (node.parentId !== undefined && byId.get(node.parentId)?.type !== 'group') return false
    if (node.children !== undefined && (node.type !== 'group' || new Set(node.children).size !== node.children.length || node.children.includes(node.id) || node.children.some((id) => !byId.has(id)))) return false
  }
  const resolved = new Set<string>()
  for (const node of nodes) {
    let current: (typeof nodes)[number] | undefined = node
    const path = new Set<string>()
    while (current && !resolved.has(current.id)) {
      if (path.has(current.id)) return false
      path.add(current.id)
      current = current.parentId ? byId.get(current.parentId) : undefined
    }
    for (const id of path) resolved.add(id)
  }
  return true
}

function validateProjectEntities(project: UnifiedProject): boolean {
  const assetEntries = Object.entries(project.assets)
  const skeletonEntries = Object.entries(project.skeletons)
  if (!assetEntries.every(([key, value]) => validAsset(value, key)) || !skeletonEntries.every(([key, value]) => validSkeleton(value, key))) return false
  if (assetEntries.some(([, asset]) => asset.dependencies.some((id) => !project.assets[id as AssetID]))) return false
  const assetVisiting = new Set<string>()
  const assetDone = new Set<string>()
  const visitAsset = (id: string): boolean => {
    if (assetVisiting.has(id)) return false
    if (assetDone.has(id)) return true
    assetVisiting.add(id)
    if (!project.assets[id as AssetID].dependencies.every(visitAsset)) return false
    assetVisiting.delete(id)
    assetDone.add(id)
    return true
  }
  if (!Object.keys(project.assets).every(visitAsset)) return false

  if (!validSceneHierarchy(project.scene.content.nodes)) return false
  const nodeIds = new Set(project.scene.content.nodes.map((node) => node.id))
  if (!Object.entries(project.characters).every(([key, value]) => validCharacter(value, key, project, nodeIds))) return false
  if (new Set(Object.values(project.characters).map((character) => character.nodeId)).size !== Object.keys(project.characters).length) return false
  const localAssetPrefix = `/api/unified/projects/${project.projectId}/assets/`
  for (const node of project.scene.content.nodes) {
    const modelUrl = isRecord(node.metadata) ? node.metadata.modelUrl : null
    if (typeof modelUrl === 'string' && modelUrl.startsWith('/api/unified/projects/')) {
      const assetId = isRecord(node.metadata) ? node.metadata.assetId : null
      if (typeof assetId !== 'string' || !modelUrl.startsWith(localAssetPrefix) ||
        modelUrl !== `${localAssetPrefix}${encodeURIComponent(assetId)}/source` ||
        !Object.prototype.hasOwnProperty.call(project.assets, assetId) || project.assets[assetId as AssetID]?.kind !== 'model') return false
      const metadata = node.metadata!
      const asset = project.assets[assetId as AssetID]!
      if (metadata.modelFormat !== undefined && metadata.modelFormat !== (asset.source.mediaType === 'application/vnd.autodesk.fbx' ? 'fbx' : 'gltf') ||
        metadata.modelUnitMeters !== undefined && (!isFiniteNumber(metadata.modelUnitMeters) || metadata.modelUnitMeters <= 0) ||
        metadata.modelBasisToScene !== undefined && !validOrthonormalBasis(metadata.modelBasisToScene) ||
        metadata.preserveMaterials !== undefined && typeof metadata.preserveMaterials !== 'boolean') return false
      const character = Object.values(project.characters).find((item) => item.nodeId === node.id)
      if (character && (character.assetId !== assetId || metadata.modelUnitMeters !== undefined && metadata.modelUnitMeters !== project.skeletons[character.skeletonId]!.metersPerUnit ||
        JSON.stringify(metadata.modelBasisToScene ?? [1, 0, 0, 0, 1, 0, 0, 0, 1]) !== JSON.stringify(project.skeletons[character.skeletonId]!.basisToScene))) return false
    }
  }
  if (!Object.entries(project.mappings).every(([key, value]) => validMapping(value, key, project))) return false

  if (!Object.entries(project.motions).every(([key, value]) => validMotion(value, key, project))) return false
  const motionVisiting = new Set<string>()
  const motionDone = new Set<string>()
  const visitMotion = (id: string): boolean => {
    if (motionVisiting.has(id)) return false
    if (motionDone.has(id)) return true
    motionVisiting.add(id)
    const parent = project.motions[id as ID].derivedFrom
    if (parent && !visitMotion(parent)) return false
    motionVisiting.delete(id)
    motionDone.add(id)
    return true
  }
  if (!Object.keys(project.motions).every(visitMotion)) return false

  const clips = project.scene.content.timeline.animation.motionClips
  const clipMap = new Map(clips.map((clip) => [clip.id, clip]))
  for (const [clipId, binding] of Object.entries(project.bindings)) {
    const clip = clipMap.get(clipId)
    const character = isRecord(binding) && typeof binding.characterId === 'string' ? project.characters[binding.characterId] : undefined
    const motion = isRecord(binding) && typeof binding.motionId === 'string' ? project.motions[binding.motionId] : undefined
    if (!isRecord(binding) || !hasKeys(binding, ['clipId', 'characterId', 'motionId', 'sourceStartSeconds', 'sourceLengthSeconds', 'reverse', 'fadeInSeconds', 'fadeOutSeconds', 'rootPolicy', 'alignment']) ||
      binding.clipId !== clipId || typeof clipId !== 'string' || !clip || !character || !motion || clip.target.nodeId !== character.nodeId ||
      !isFiniteNumber(binding.sourceStartSeconds) || binding.sourceStartSeconds < 0 || !isFiniteNumber(binding.sourceLengthSeconds) || binding.sourceLengthSeconds <= 0 ||
      binding.sourceStartSeconds + binding.sourceLengthSeconds > motion.durationSeconds + 1e-6 || typeof binding.reverse !== 'boolean' ||
      !isFiniteNumber(binding.fadeInSeconds) || binding.fadeInSeconds < 0 || !isFiniteNumber(binding.fadeOutSeconds) || binding.fadeOutSeconds < 0 ||
      !['in-place', 'skeletal', 'trajectory'].includes(String(binding.rootPolicy)) || !['origin', 'continue'].includes(String(binding.alignment))) return false
    const rootMotion = clip.motion.rootMotion
    if (rootMotion) {
      const profile = project.skeletons[character.skeletonId]
      const root = profile?.bones.find((bone) => bone.id === profile.rootBoneId)
      if (rootMotion.policy !== binding.rootPolicy || rootMotion.boneName !== root?.name || clip.motion.inPlace !== (rootMotion.policy === 'in-place')) return false
      if (rootMotion.alignment !== undefined && rootMotion.alignment !== binding.alignment) return false
      if (rootMotion.policy !== 'skeletal' && project.scene.content.nodes.find((node) => node.id === character.nodeId)?.metadata?.rig !== 'direct') return false
      if (rootMotion.policy === 'trajectory') {
        if (clips.some((other) => other.id !== clip.id && other.target.nodeId === clip.target.nodeId && other.frameStart <= clip.frameEnd && other.frameEnd >= clip.frameStart)) return false
        const length = clip.motion.sourceLengthSeconds ?? motion.durationSeconds - clip.motion.time
        const elapsed = (clip.frameEnd - clip.frameStart + 1) / project.scene.content.timeline.fps * clip.playback.speed
        if (clip.playback.loop && !Number.isSafeInteger(Math.floor(elapsed / length))) return false
      }
    }
  }

  for (const [key, session] of Object.entries(project.retargetSessions)) {
    if (!isRecord(session) || !hasKeys(session, ['id', 'sourceMotionId', 'targetCharacterId', 'mappingId', 'nativeProject', 'generatedMotionId']) ||
      session.id !== key || !isUuid(key) || typeof session.sourceMotionId !== 'string' || !project.motions[session.sourceMotionId] ||
      typeof session.targetCharacterId !== 'string' || !project.characters[session.targetCharacterId] || typeof session.mappingId !== 'string' ||
      !project.mappings[session.mappingId] || !validBlobRef(session.nativeProject) ||
      !(session.generatedMotionId === null || typeof session.generatedMotionId === 'string' && !!project.motions[session.generatedMotionId])) return false
    const source = project.motions[session.sourceMotionId]
    const target = project.characters[session.targetCharacterId]
    const mapping = project.mappings[session.mappingId]
    if (mapping.sourceProfileId !== source.skeletonId || mapping.targetProfileId !== target.skeletonId) return false
  }
  return true
}

export function validateProject(value: unknown): value is UnifiedProject {
  if (!isRecord(value) || value.type !== 'three-workspace-project' || value.version !== 1 || typeof value.projectId !== 'string' ||
    !UUID_V4.test(value.projectId) ||
    typeof value.name !== 'string' || !value.name.trim() || value.name.length > 120 || !Number.isInteger(value.revision) || (value.revision as number) < 0 ||
    !validateDirectorDocument(value.scene) || findRootMotionConflict(value.scene as DirectorDocument)) return false
  const fields = ['type', 'version', 'projectId', 'name', 'revision', 'scene', 'assets', 'characters', 'skeletons', 'mappings', 'motions', 'bindings', 'retargetSessions', 'extensions', 'origins']
  if (Object.keys(value).some((key) => !fields.includes(key)) || !validateJsonPayload(value) || !Array.isArray(value.origins)) return false
  const records = ['assets', 'characters', 'skeletons', 'mappings', 'motions', 'bindings', 'retargetSessions', 'extensions']
  if (!records.every((key) => isRecord(value[key])) || !Object.values(value.extensions as Record<string, unknown>).every(isRecord)) return false
  const topview = (value.extensions as Record<string, Record<string, unknown>>).topview
  return value.origins.every(validProvenance) && (topview === undefined || !('fcurves' in topview) || validateFCurves(topview.fcurves)) &&
    validateProjectEntities(value as unknown as UnifiedProject)
}
