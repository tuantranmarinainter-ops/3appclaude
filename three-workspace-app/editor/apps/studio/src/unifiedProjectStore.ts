import { planSplitShots, readEpisode } from './splitShots'
import { linkSplitShotAssets } from './splitShotAssets'
import { validateFilmEffectsDestination } from './filmEffectsDestination'
import { libraryHeightSnapshot, type LibraryHeightSnapshot } from './libraryHeight'
import { App3BridgeError } from './app3Bridge'
import { executeApp3Artifacts } from './app3Artifacts'
import { previewCameraFraming } from './cameraFraming'
import { sampleBbsPreview } from './bbsPreview'
import { previewCharacterLayout } from './sceneLayoutPlacement'
import { validateSceneConversionArgs, type SceneConversionArgs } from './sceneConversion'
import { startUnifiedSceneConversion } from './unifiedJobs'
import { readSceneLayout } from './sceneLayout'
import { exportSceneGlb, storeSceneGlb, validateSceneGlbArgs, type SceneGlbArgs } from './sceneGlb'
import { prepareShotResult, applyShotResult } from './shotResult'
import { createShotPackage, saveShotExport, type ShotExportArgs } from './shotExchange'
import { storeShotArtifact } from './unifiedJobs'
import { attachApp1Manifest } from './app1Manifest'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, open, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { evaluateProjectSkeletons, projectEvaluationScene, sampleProjectSkeletonRange } from './unifiedSkeletonEvaluation'
import { inspectProjectRig } from './unifiedRigInspection'
import { planProjectAssignment } from './unifiedAssignment'
import { planProjectNormalization } from './unifiedNormalizationPlan'
import * as THREE from 'three'
import type { Character, CommandEnvelope, CommandSuccess, HistorySummary, MotionBinding, RetargetSession, SkeletonMapping, UnifiedProject } from '@bbs/animation-workspace-shared'
import { findRootMotionConflict, isRecord, validateDirectorDocument, validateFCurves, validateJsonPayload, validateProject } from '@bbs/animation-workspace-shared'
import { FCurveSet, appendMotionClip, buildCharacterNode, buildPropNode, createFrameSnapshot, emptyEditorial, evaluateFrame, findEditClip, insertEditClip, patchNodeTransformInPlace, pruneMissingCameraClips, sceneBasisMatrix, updateEditClip, type EditSequenceClip } from '@topview/3d-builder/evaluate'
import { duplicateDocumentNodes } from '@topview/3d-builder/evaluate'
import { evaluateSceneChecks } from '@topview/3d-director-cli/scene-checks.mjs'
import { cancelUnifiedJob, getUnifiedJob, readUnifiedJobFile, startUnifiedFilmExport, startUnifiedFilmSeriesExport, startUnifiedSceneRender, startUnifiedNormalization, startUnifiedAssignment } from './unifiedJobs'
import { inspectProjectFilm, preflightProjectFilm, turnFilmSkeletonsByRotationKeys } from './unifiedFilmSampling'
import { resolveSceneBbsFilmArgs } from './sceneBbsFilm'
import { planFilmSeriesWithCameraSamples } from './filmSeries'
import { writeFilmAnchorLocation } from './filmAnchorLocations'
import { fitFilmFrameDimensions, readFilmFrameAspect, resolveFilmFrameAspect, writeFilmFrameAspect, type FilmFrameDimensions } from './filmFrame'
import { isMixamo65Topology, isRetargetCalibrationV1, isRetargetProjectV99, isUniversalCalibrationDraftV1, isUniversalReferencePoseV1, sealUniversalCalibrationV1, validateSemanticMapping, type MappingValidationReport, type RetargetCalibrationV1, type RetargetProjectV99, type SemanticBonePair, type UniversalCalibrationDraftV1, type UniversalCalibrationV1, type UniversalReferencePoseV1 } from '@bbs/retarget'
import { buildImportedAsset, canonicalJsonExact, glbAnimationBoneNames, glbAnimationCount, glbTargetFingerprint, normalizeAnimationGlbBoneNames, persistImportedAssetFiles, persistNativeAnimationMotion, persistNativeRetargetProject, persistRelinkedAssetFiles, persistRetargetCalibration, persistUniversalReferencePose, readStagedAssetUpload, removeStagedAssetUploads, resolveProjectBlob, resolveUnifiedAssetFile, sha256CanonicalJson, type ImportedAsset, type StagedAssetUpload } from './unifiedAssetFiles'
import { libraryBaseGlb, libraryCharacterModel, libraryNativeAction, libraryShotDisplayName } from './libraryModels'
import { getAction, listCharacterActions, resolveCharacter, resolveLibraryPath } from '../../../packages/library/index'
import { emptySceneReview, makeSceneReviewShot, planReviewFrames, reviewStatusForSequence, type SceneReviewStatus } from './sceneReview'
import { prepareCameraMotionAdd, prepareCameraMotionRemove, type CameraMotionCommandResult } from './cameraMotionCommand'
import { filmPreflight, filmSeriesPreflight, measureFilmFeet, type FilmPreflightArgs, type FilmPreflightIssue } from './filmPreflight'
import { resolveFilmEffectsPolicy } from './filmEffectsPolicy'
import { makeVfxCue, readVfxCueExtension, updateVfxCue, type VfxCue } from './vfxCues'
import { decodeAudio, MIX_RATE, makeAudioCue, readAudioCueExtension, updateAudioCue, type AudioCue } from './audioCues'

const MAX_HISTORY = 100
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const isUniqueStringIdList = (value: unknown): value is string[] => Array.isArray(value) && value.length <= 64 &&
  value.every((item) => typeof item === 'string' && item.length > 0) && new Set(value).size === value.length
const LIBRARY_ACTION_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const MOTION_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[48][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export class UnifiedStoreError extends Error {
  constructor(readonly code: string, message: string, readonly status: number, readonly details?: Record<string, unknown>) { super(message) }
}

interface LibraryLinkNodePlan {
  nodeId: string; characterId: string | null; displayName: string
  replacements: Array<{ clipId: string; actionUuid: string; name: string; frameStart: number; frameEnd: number }>
  unconverted: Array<{ clipId: string; name: string; reason: string }>
}
interface LibraryLinkPlan {
  modelImported: ImportedAsset
  actionImports: Map<string, { upload: StagedAssetUpload; imported: ImportedAsset }>
  library: LibraryHeightSnapshot & { libraryCharacterId: string; libraryModelFingerprint: string; libraryBaseModelId: string; librarySkin: Array<{ object: string; path: string; sha256: string; source: 'skin' | 'base' }> }
  nodes: LibraryLinkNodePlan[]
}

interface Snapshot { project: UnifiedProject }
interface HistoryIndex { revision: number; entries: number[]; cursor: number }
interface HistoryRecord {
  requestId: string
  hash: string
  before: Snapshot
  after: Snapshot
  nextIndex: HistoryIndex
  changedIds: string[]
  response: CommandSuccess
}
interface RequestRecord { hash: string; response?: CommandSuccess; projectId?: string; splitProjectIds?: string[] }
type MappingDraft = Omit<SkeletonMapping, 'calibration' | 'referencePose' | 'confirmed'>

function root(): string {
  return path.resolve(process.env.BBS_UNIFIED_PROJECTS_DIR?.trim() || path.join(process.cwd(), 'unified-projects'))
}

function projectPath(id: string): string { return path.join(root(), id, 'project.json') }
function historyDir(id: string): string { return path.join(root(), id, '.history') }
function historyPath(id: string, revision: number): string { return path.join(historyDir(id), `${revision}.json`) }
function requestPath(id: string): string { return path.join(root(), '.requests', `${id}.json`) }

async function readJson<T>(file: string): Promise<T | null> {
  try { return JSON.parse(await readFile(file, 'utf8')) as T } catch { return null }
}

async function atomicJson(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true })
  const temp = `${file}.${randomUUID()}.tmp`
  const handle = await open(temp, 'wx')
  let closed = false
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8')
    await handle.sync()
    await handle.close()
    closed = true
    for (let attempt = 0; ; attempt++) {
      try { await rename(temp, file); break }
      catch (error) {
        const code = (error as NodeJS.ErrnoException).code
        if (!['EPERM', 'EBUSY'].includes(code ?? '') || attempt === 3) throw error
        await new Promise((resolve) => setTimeout(resolve, 25 * 2 ** attempt))
      }
    }
  } catch (error) {
    if (!closed) await handle.close().catch(() => undefined)
    await rm(temp, { force: true })
    throw error
  }
}

function projectSnapshot(project: UnifiedProject): Snapshot { return { project: structuredClone(project) } }

function finiteSceneTransform(value: unknown): boolean {
  if (!isRecord(value) || Object.keys(value).some((key) => !['position', 'rotation', 'scale'].includes(key))) return false
  return ['position', 'rotation', 'scale'].every((key) => {
    const vector = value[key]
    return isRecord(vector) && ['x', 'y', 'z'].every((axis) => typeof vector[axis] === 'number' && Number.isFinite(vector[axis]))
  })
}

function canonicalJointName(value: string): string { return value.split(':').pop()!.replace(/^mixamorig\d*/i, '').replace(/[^a-z0-9]/gi, '').toLowerCase() }

function sameMixamo65Rest(a: NonNullable<ImportedAsset['skeleton']>, b: UnifiedProject['skeletons'][string]): boolean {
  if (!isMixamo65Topology(a.bones) || !isMixamo65Topology(b.bones) || a.bones.length !== b.bones.length) return false
  const target = new Map(b.bones.map((bone) => [canonicalJointName(bone.name), bone]))
  const okay = a.bones.every((bone) => {
    const other = target.get(canonicalJointName(bone.name))
    if (!other) return false
    const parent = a.bones.find((candidate) => candidate.id === bone.parentId)
    const otherParent = b.bones.find((candidate) => candidate.id === other.parentId)
    const restA = bone.rest as { position: number[]; rotation: number[]; scale: number[] }
    const restB = other.rest as { position: number[]; rotation: number[]; scale: number[] }
    const p = restA.position, q = restB.position, r = restA.rotation, s = restB.rotation, x = restA.scale, y = restB.scale
    const pointError = Math.hypot(...p.map((value, index) => value - q[index]!))
    const scaleError = Math.max(...x.map((value, index) => Math.abs(value - y[index]!)))
    const rotationDot = Math.abs(r.reduce((sum, value, index) => sum + value * s[index]!, 0))
    return (parent ? canonicalJointName(parent.name) : null) === (otherParent ? canonicalJointName(otherParent.name) : null) &&
      pointError <= 1e-5 && scaleError <= 1e-5 && rotationDot >= 0.999999
  })
  return okay
}

function sameRigTopology(a: NonNullable<ImportedAsset['skeleton']>, b: UnifiedProject['skeletons'][string]): boolean {
  if (a.family !== b.family) return false
  if (a.family === 'mixamo65') return isMixamo65Topology(a.bones) && isMixamo65Topology(b.bones)
  if (a.bones.length !== b.bones.length) return false
  const target = new Map(b.bones.map((bone) => [canonicalJointName(bone.name), bone]))
  return a.bones.every((bone) => {
    const other = target.get(canonicalJointName(bone.name))
    if (!other) return false
    const parent = a.bones.find((candidate) => candidate.id === bone.parentId)
    const otherParent = b.bones.find((candidate) => candidate.id === other.parentId)
    return (parent ? canonicalJointName(parent.name) : null) === (otherParent ? canonicalJointName(otherParent.name) : null)
  })
}

function isFiniteNumber(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value) }

interface ModelRebindMeshReport { mesh: string; vertices: number; droppedWeight: number; affectedVertices: number }
interface ModelRebindReport {
  schema: 'bbs-model-rebind-report'; version: 1; producer: 'studio-client'; outputSha256: string
  sourceAssetId: string; sourceSha256: string; sourceProfileId: string; sourceFingerprint: string
  targetProfileId: string; targetFingerprint: string; mappingId: string; motionId: string; actionName: string
  durationSeconds: number; weightedSourceJoints: number; ownerCount: number; vertices: number; targetJoints: 65; maxRestError: number
  meshes: ModelRebindMeshReport[]; renamedSourceNodes: Array<{ originalName: string; outputName: string }>
}

function attachModelRebindReport(value: unknown, project: UnifiedProject, upload: StagedAssetUpload, imported: ImportedAsset) {
  const keys = ['schema', 'version', 'producer', 'outputSha256', 'sourceAssetId', 'sourceSha256', 'sourceProfileId', 'sourceFingerprint', 'targetProfileId', 'targetFingerprint', 'mappingId', 'motionId', 'actionName', 'durationSeconds', 'weightedSourceJoints', 'ownerCount', 'vertices', 'targetJoints', 'maxRestError', 'meshes', 'renamedSourceNodes']
  if (!isRecord(value) || Object.keys(value).length !== keys.length || Object.keys(value).some((key) => !keys.includes(key)) ||
      value.schema !== 'bbs-model-rebind-report' || value.version !== 1 || value.producer !== 'studio-client' || value.outputSha256 !== upload.sha256 ||
      typeof value.sourceAssetId !== 'string' || typeof value.sourceSha256 !== 'string' || typeof value.sourceProfileId !== 'string' || typeof value.sourceFingerprint !== 'string' ||
      typeof value.targetProfileId !== 'string' || typeof value.targetFingerprint !== 'string' || typeof value.mappingId !== 'string' || typeof value.motionId !== 'string' ||
      typeof value.actionName !== 'string' || !value.actionName.trim() || !isFiniteNumber(value.durationSeconds) || value.durationSeconds <= 0 ||
      typeof value.weightedSourceJoints !== 'number' || !Number.isSafeInteger(value.weightedSourceJoints) || typeof value.ownerCount !== 'number' || !Number.isSafeInteger(value.ownerCount) ||
      typeof value.vertices !== 'number' || !Number.isSafeInteger(value.vertices) || value.vertices <= 0 ||
      value.targetJoints !== 65 || !isFiniteNumber(value.maxRestError) || value.maxRestError < 0 || !Array.isArray(value.meshes) || !value.meshes.length || value.meshes.length > 256 ||
      value.meshes.some((item) => !isRecord(item) || Object.keys(item).some((key) => !['mesh', 'vertices', 'droppedWeight', 'affectedVertices'].includes(key)) ||
        typeof item.mesh !== 'string' || typeof item.vertices !== 'number' || !Number.isSafeInteger(item.vertices) || item.vertices < 1 ||
        !isFiniteNumber(item.droppedWeight) || item.droppedWeight < 0 || typeof item.affectedVertices !== 'number' || !Number.isSafeInteger(item.affectedVertices) || item.affectedVertices < 0 || item.affectedVertices > item.vertices) ||
      !Array.isArray(value.renamedSourceNodes) || value.renamedSourceNodes.length > 10000 || value.renamedSourceNodes.some((item) => !isRecord(item) ||
        Object.keys(item).some((key) => !['originalName', 'outputName'].includes(key)) || typeof item.originalName !== 'string' || typeof item.outputName !== 'string')) {
    throw new UnifiedStoreError('VALIDATION_FAILED', 'Invalid Model+Rig+Animation rebind report', 400)
  }
  const report = value as unknown as ModelRebindReport
  const source = project.assets[report.sourceAssetId as keyof typeof project.assets], sourceProfile = project.skeletons[report.sourceProfileId], targetProfile = project.skeletons[report.targetProfileId]
  const mapping = project.mappings[report.mappingId], motion = project.motions[report.motionId]
  if (!source || source.kind !== 'model' || source.source.sha256 !== report.sourceSha256 || !sourceProfile || sourceProfile.provenance.sourceHash !== source.source.sha256 ||
      sourceProfile.fingerprint !== report.sourceFingerprint || !targetProfile || targetProfile.family !== 'mixamo65' || targetProfile.fingerprint !== report.targetFingerprint ||
      !mapping?.confirmed || mapping.sourceProfileId !== sourceProfile.id || mapping.targetProfileId !== targetProfile.id ||
      mapping.sourceFingerprint !== sourceProfile.fingerprint || mapping.targetFingerprint !== targetProfile.fingerprint || !motion || motion.skeletonId !== targetProfile.id ||
      imported.asset.kind !== 'model' || imported.skeleton?.family !== 'mixamo65' || imported.motions.length !== 1 ||
      imported.asset.id !== `sha256:${upload.sha256}` || imported.motions[0]!.boneNames?.some((name) => !imported.skeleton!.bones.some((bone) => bone.name === name)) ||
      report.weightedSourceJoints < 1 || report.weightedSourceJoints > sourceProfile.bones.length || report.ownerCount < report.weightedSourceJoints || report.ownerCount > sourceProfile.bones.length ||
      report.targetJoints !== imported.skeleton.bones.length || report.meshes.reduce((sum, item) => sum + item.vertices, 0) !== report.vertices) {
    throw new UnifiedStoreError('PROFILE_MISMATCH', 'Model rebind report does not match the imported source, mapping, target rig or output GLB', 422)
  }
  const bytes = Buffer.from(JSON.stringify(report)), sha256 = createHash('sha256').update(bytes).digest('hex')
  const ref = { path: `reports/model-rebind/${sha256}.json`, sha256, mediaType: 'application/json', byteLength: bytes.byteLength }
  imported.asset.derivatives[`modelRebindReport_${sha256}`] = ref
  imported.asset.dependencies = [...new Set([source.id, motion.assetId])]
  imported.motions[0]!.motion.derivedFrom = motion.id
  imported.modelRebindReport = { ref, bytes }
}

export async function readUnifiedProject(id: string): Promise<UnifiedProject> {
  if (!UUID.test(id)) throw new UnifiedStoreError('NOT_FOUND', 'Project not found', 404)
  const project = await readJson<UnifiedProject>(projectPath(id))
  if (!project || !validateProject(project) || project.projectId !== id) throw new UnifiedStoreError('NOT_FOUND', 'Project not found or invalid', 404)
  return project
}

function validHistoryIndex(value: unknown, revision: number): value is HistoryIndex {
  if (!isRecord(value) || value.revision !== revision || !Array.isArray(value.entries) || value.entries.length > MAX_HISTORY ||
    !Number.isInteger(value.cursor) || (value.cursor as number) < 0 || (value.cursor as number) > value.entries.length) return false
  let previous = 0
  for (const entry of value.entries) {
    if (!Number.isInteger(entry) || entry <= previous || entry > revision) return false
    previous = entry
  }
  return true
}

async function historyIndex(project: UnifiedProject, repair = true): Promise<HistoryIndex> {
  const file = path.join(historyDir(project.projectId), 'index.json')
  const current = await readJson<unknown>(file)
  if (validHistoryIndex(current, project.revision)) return current
  const committed = await readJson<HistoryRecord>(historyPath(project.projectId, project.revision))
  const recovered = committed?.nextIndex ?? (project.revision === 0 && current === null ? { revision: 0, entries: [], cursor: 0 } : null)
  if (!recovered || !validHistoryIndex(recovered, project.revision)) throw new UnifiedStoreError('IO_FAILED', 'Project history is missing or invalid', 500)
  if (repair) await atomicJson(file, recovered)
  return recovered
}

export async function readUnifiedProjectState(id: string): Promise<{ project: UnifiedProject; history: HistorySummary }> {
  const project = await readUnifiedProject(id)
  const index = await historyIndex(project, false)
  return { project, history: { canUndo: index.cursor > 0, canRedo: index.cursor < index.entries.length } }
}

export async function listUnifiedProjects(): Promise<Array<{ id: string; name: string; revision: number; updatedAt: string; nodeCount: number; fps: number; episode?: ReturnType<typeof readEpisode> }>> {
  await mkdir(root(), { recursive: true })
  const rows = []
  for (const id of await readdir(root())) {
    if (!UUID.test(id)) continue
    const project = await readJson<UnifiedProject>(projectPath(id))
    if (!project || !validateProject(project)) continue
    const fileInfo = await stat(projectPath(id))
    rows.push({ id, name: project.name, revision: project.revision, updatedAt: fileInfo.mtime.toISOString(), nodeCount: project.scene.content.nodes.length, fps: project.scene.content.timeline.fps, ...(readEpisode(project) ? { episode: readEpisode(project) } : {}) })
  }
  return rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

function requestHash(envelope: CommandEnvelope): string { return createHash('sha256').update(JSON.stringify(envelope)).digest('hex') }

async function previousRequest(envelope: CommandEnvelope, hash: string): Promise<CommandSuccess | null> {
  const previous = await readJson<RequestRecord>(requestPath(envelope.requestId))
  if (previous) {
    if (previous.hash !== hash) throw new UnifiedStoreError('REQUEST_ID_CONFLICT', 'Request ID was already used with a different payload', 409)
    if (previous.response) return previous.response
  }
  if (envelope.projectId) {
    const project = await readJson<UnifiedProject>(projectPath(envelope.projectId))
    const record = project && await readJson<HistoryRecord>(historyPath(envelope.projectId, project.revision))
    if (record?.requestId === envelope.requestId) {
      if (record.hash !== hash) throw new UnifiedStoreError('REQUEST_ID_CONFLICT', 'Request ID was already used with a different payload', 409)
      return record.response
    }
  }
  return null
}

async function saveRequest(envelope: CommandEnvelope, hash: string, response: CommandSuccess): Promise<void> {
  await atomicJson(requestPath(envelope.requestId), { hash, response } satisfies RequestRecord)
}

async function withRequestLock<T>(id: string, action: () => Promise<T>): Promise<T> {
  const lock = path.join(root(), '.requests', `${id}.lock`)
  await mkdir(path.dirname(lock), { recursive: true })
  let handle
  try { handle = await open(lock, 'wx') } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new UnifiedStoreError('WRITER_BUSY', 'Request is already being processed', 423)
    throw error
  }
  try { return await action() } finally { await handle.close(); await rm(lock, { force: true }) }
}

async function createNewProject(
  envelope: CommandEnvelope,
  hash: string,
  name: string,
  makeProject: (id: string) => UnifiedProject,
): Promise<CommandSuccess> {
  const pending = await readJson<RequestRecord>(requestPath(envelope.requestId))
  const projectId = pending?.projectId ?? randomUUID()
  await atomicJson(requestPath(envelope.requestId), { hash, projectId } satisfies RequestRecord)
  const proposed = makeProject(projectId)
  if (!validateProject(proposed)) throw new UnifiedStoreError('VALIDATION_FAILED', 'Project contract validation failed', 400)
  const existing = await readJson<UnifiedProject>(projectPath(projectId))
  if (!existing) {
    await atomicJson(projectPath(projectId), proposed)
  } else if (!validateProject(existing) || existing.projectId !== projectId || JSON.stringify(existing) !== JSON.stringify(proposed)) {
    throw new UnifiedStoreError('IO_FAILED', 'Previously created project is invalid', 500)
  }
  const response = success(envelope.requestId, projectId, 0, { projectId, manifestPath: `${projectId}/project.json` })
  await saveRequest(envelope, hash, response)
  return response
}

function success(requestId: string, projectId: string, revision: number, result: Record<string, unknown>, changedIds: string[] = []): CommandSuccess {
  return { ok: true, requestId, projectId, revision, result, warnings: [], changedIds }
}

function hasAirborneMotionAt(project: UnifiedProject, nodeId: string, frame: number): boolean {
  return project.scene.content.timeline.animation.motionClips.some((clip) => {
    if (clip.target.nodeId !== nodeId || frame < clip.frameStart || frame > clip.frameEnd) return false
    const assetId = project.motions[clip.motion.assetId]?.assetId
    const name = project.assets[assetId as keyof typeof project.assets]?.displayName ?? ''
    return /jump|fall|leap|hop|nhay|roi/i.test(name)
  })
}

async function collectFilmPreflightEvidence(project: UnifiedProject, args: FilmPreflightArgs) {
  const assetIds = new Set<string>()
  for (const characterId of Array.isArray(args.characterIds) ? args.characterIds : []) {
    const character = project.characters[characterId]
    if (!character) continue
    assetIds.add(character.assetId)
    for (const clip of project.scene.content.timeline.animation.motionClips) {
      if (clip.target.nodeId !== character.nodeId || !args.range || clip.frameEnd < args.range.startFrame || clip.frameStart > args.range.endFrame) continue
      const motion = project.motions[clip.motion.assetId]
      if (motion) assetIds.add(motion.assetId)
    }
  }
  for (const propId of Array.isArray(args.propIds) ? args.propIds : []) {
    const node = project.scene.content.nodes.find((item) => item.id === propId && item.type === 'prop')
    if (typeof node?.metadata?.assetId === 'string') assetIds.add(node.metadata.assetId)
  }
  const assetAvailability: Record<string, boolean> = {}
  await Promise.all([...assetIds].map(async (assetId) => {
    try {
      const motion = Object.values(project.motions).find((item) => item.assetId === assetId && item.evaluator === 'animation-1.31.8')
      if (motion) await resolveProjectBlob(project.projectId, motion.sourceClip)
      else await resolveUnifiedAssetFile(project, assetId, 'source')
      assetAvailability[assetId] = true
    } catch { assetAvailability[assetId] = false }
  }))
  const propBoneCounts: Record<string, number> = {}
  for (const propId of Array.isArray(args.propIds) ? args.propIds : []) {
    const node = project.scene.content.nodes.find((item) => item.id === propId && item.type === 'prop')
    const assetId = typeof node?.metadata?.assetId === 'string' ? node.metadata.assetId : undefined
    const asset = assetId ? project.assets[assetId as keyof typeof project.assets] : undefined
    if (!asset) continue
    const profiles = Object.values(project.skeletons).filter((profile) => profile.provenance.sourceHash === asset.source.sha256)
    const fingerprints = new Set(profiles.map((profile) => profile.fingerprint))
    if (profiles.length && fingerprints.size === 1) propBoneCounts[asset.id] = profiles[0]!.bones.length
  }
  const footSamples: NonNullable<FilmPreflightArgs['footSamples']> = {}
  const sampling = inspectProjectFilm(project, args, { propBoneCounts })
  const assetsAvailable = Object.values(assetAvailability).every(Boolean)
  const canSample = sampling.durationTicks !== undefined && sampling.durationTicks <= 255 &&
    sampling.models.length === (Array.isArray(args.characterIds) ? args.characterIds.length : -1) && assetsAvailable
  // When sampling cannot run, hand the preflight the real causes so it does not blame the Characters'
  // transforms; when it runs but throws, hand over the error instead of swallowing it silently.
  const samplingBlockers: string[] = []
  if (!canSample) {
    for (const blocker of sampling.issues.map((item) => item.code)) if (!samplingBlockers.includes(blocker)) samplingBlockers.push(blocker)
    if (sampling.durationTicks !== undefined && sampling.durationTicks > 255 && !samplingBlockers.includes('TICK_LIMIT')) samplingBlockers.push('TICK_LIMIT')
    if (!assetsAvailable && !samplingBlockers.includes('ASSET_FILE_MISSING')) samplingBlockers.push('ASSET_FILE_MISSING')
    if (!samplingBlockers.length) samplingBlockers.push('SAMPLING_PRECONDITIONS_UNMET')
  }
  let samplingError: string | undefined
  if (canSample && Array.isArray(args.characterIds) && args.characterIds.length) {
    try {
      const evaluationScene = projectEvaluationScene(project)
      for await (const sample of sampleProjectSkeletonRange(project, { ...args.range, sampleFps: 20 }, args.characterIds)) {
        turnFilmSkeletonsByRotationKeys(evaluationScene, sample)
        for (const skeleton of sample.skeletonSamples) {
          const character = Object.values(project.characters).find((item) => item.nodeId === skeleton.nodeId)
          if (!character) continue
          const feet = measureFilmFeet(skeleton, project.skeletons[character.skeletonId])
          const values = footSamples[character.id] ?? (footSamples[character.id] = [])
          values.push({ frame: sample.frame, ...feet,
            airborne: hasAirborneMotionAt(project, skeleton.nodeId, sample.frame), actorWorldMatrix: skeleton.actorWorldMatrix })
        }
      }
    } catch (error) { samplingError = error instanceof Error ? error.message : String(error) }
  }
  return { assetAvailability, propBoneCounts, footSamples, samplingBlockers, ...(samplingError ? { samplingError } : {}) }
}

function applyCameraShot(document: UnifiedProject['scene'], sequenceId: string, clip: EditSequenceClip): { document: UnifiedProject['scene']; shotId: string } {
  const next = structuredClone(document)
  const editorial = next.content.editorial ?? emptyEditorial()
  const existing = findEditClip(editorial, clip.id)
  if (existing && existing.sequence.id !== sequenceId) throw new UnifiedStoreError('VALIDATION_FAILED', 'Shot ID already belongs to another sequence', 400)
  const operation = existing
    ? updateEditClip(next, clip.id, { cameraNodeId: clip.cameraNodeId, sourceFrameStart: clip.sourceFrameStart, sourceFrameEnd: clip.sourceFrameEnd })
    : insertEditClip(next, { sequenceId, cameraNodeId: clip.cameraNodeId, sourceFrameStart: clip.sourceFrameStart, sourceFrameEnd: clip.sourceFrameEnd })
  if (!operation.ok) throw new UnifiedStoreError('VALIDATION_FAILED', `Invalid camera shot: ${operation.error}`, 400)
  if (!existing && operation.createdId) {
    const inserted = operation.editorial.sequences.find((sequence) => sequence.id === sequenceId)?.clips.find((item) => item.id === operation.createdId)
    if (!inserted) throw new UnifiedStoreError('VALIDATION_FAILED', 'Camera shot operation did not return the inserted clip', 400)
    inserted.id = clip.id
  }
  next.content.editorial = operation.editorial
  if (!validateDirectorDocument(next)) throw new UnifiedStoreError('VALIDATION_FAILED', 'Camera shot produced an invalid Topview document', 400)
  return { document: next, shotId: clip.id }
}

function validVec3Patch(value: unknown): value is { x?: number; y?: number; z?: number } {
  return isRecord(value) && Object.keys(value).length > 0 && Object.keys(value).every((key) => ['x', 'y', 'z'].includes(key)) && Object.values(value).every(isFiniteNumber)
}

function validTransformDelta(value: unknown): value is { position?: [number, number, number]; rotation?: [number, number, number]; scale?: [number, number, number] } {
  return isRecord(value) && Object.keys(value).every((key) => ['position', 'rotation', 'scale'].includes(key)) &&
    Object.values(value).every((tuple) => Array.isArray(tuple) && tuple.length === 3 && tuple.every(isFiniteNumber))
}

function sceneTransformMatrix(transform: UnifiedProject['scene']['content']['nodes'][number]['transform']): THREE.Matrix4 {
  const position = new THREE.Vector3(transform.position.x, transform.position.y, transform.position.z)
  const rotation = new THREE.Euler(
    THREE.MathUtils.degToRad(transform.rotation.x),
    THREE.MathUtils.degToRad(transform.rotation.y),
    THREE.MathUtils.degToRad(transform.rotation.z),
    'XYZ',
  )
  const scale = new THREE.Vector3(transform.scale.x, transform.scale.y, transform.scale.z)
  return new THREE.Matrix4().compose(position, new THREE.Quaternion().setFromEuler(rotation), scale)
}

function reparentStaticPrimitive(document: UnifiedProject['scene'], fcurves: unknown, nodeId: string, parentId: string | null): string[] {
  const nodes = document.content.nodes
  const node = nodes.find((item) => item.id === nodeId)
  if (!node) throw new UnifiedStoreError('VALIDATION_FAILED', `Scene node not found: ${nodeId}`, 400)
  if (node.type !== 'primitive') throw new UnifiedStoreError('VALIDATION_FAILED', 'Topview parenting is currently supported only for primitive nodes', 400)
  if (node.locked) throw new UnifiedStoreError('VALIDATION_FAILED', `Scene node is locked: ${nodeId}`, 400)
  const oldParent = node.parentId ? nodes.find((item) => item.id === node.parentId) : undefined
  const newParent = parentId ? nodes.find((item) => item.id === parentId) : undefined
  if (node.parentId && (!oldParent || oldParent.type !== 'group' || oldParent.parentId)) throw new UnifiedStoreError('VALIDATION_FAILED', 'Primitive parent must be a root group', 400)
  if (parentId && (!newParent || newParent.type !== 'group' || newParent.parentId)) throw new UnifiedStoreError('VALIDATION_FAILED', 'New primitive parent must be a root group', 400)
  if (oldParent?.locked || newParent?.locked) throw new UnifiedStoreError('VALIDATION_FAILED', 'Cannot reparent from or into a locked group', 400)
  if ((node.parentId ?? null) === parentId) return [nodeId]

  // shortcut: reparent rejects animated nodes until their keyed transforms can be rebased to the new parent.
  const curves = fcurves == null ? FCurveSet.empty() : FCurveSet.parse(fcurves)
  const userKeys = FCurveSet.parseUserKeys(fcurves)
  const relevantIds = new Set([node.id, oldParent?.id, newParent?.id].filter((id): id is string => Boolean(id)))
  const hasKeys = [...relevantIds].some((id) => curves.tracksForNode(id).length > 0 ||
    Object.values(userKeys[id] ?? {}).some((keys) => Array.isArray(keys) && keys.length > 0))
  const animation = document.content.timeline.animation
  const clips = [...animation.motionClips, ...animation.cameraMotionClips, ...animation.pathMotionClips]
  if (hasKeys || clips.some((clip) => relevantIds.has(clip.target.nodeId))) {
    throw new UnifiedStoreError('VALIDATION_FAILED', 'Cannot reparent nodes with keyed transforms or motion clips', 400)
  }

  const world = (oldParent ? sceneTransformMatrix(oldParent.transform) : new THREE.Matrix4()).multiply(sceneTransformMatrix(node.transform))
  const parentWorld = newParent ? sceneTransformMatrix(newParent.transform) : new THREE.Matrix4()
  if (Math.abs(parentWorld.determinant()) < 1e-12) throw new UnifiedStoreError('VALIDATION_FAILED', 'Cannot preserve world transform under a singular group transform', 400)
  const local = parentWorld.clone().invert().multiply(world)
  const position = new THREE.Vector3()
  const quaternion = new THREE.Quaternion()
  const scale = new THREE.Vector3()
  local.decompose(position, quaternion, scale)
  const rebuilt = parentWorld.clone().multiply(new THREE.Matrix4().compose(position, quaternion, scale))
  if (rebuilt.elements.some((value, index) => Math.abs(value - world.elements[index]!) > 1e-6)) {
    throw new UnifiedStoreError('VALIDATION_FAILED', 'Parent transform would require a non-TRS local transform', 400)
  }
  const rotation = new THREE.Euler().setFromQuaternion(quaternion, 'XYZ')
  node.transform = {
    position: { x: position.x, y: position.y, z: position.z },
    rotation: { x: THREE.MathUtils.radToDeg(rotation.x), y: THREE.MathUtils.radToDeg(rotation.y), z: THREE.MathUtils.radToDeg(rotation.z) },
    scale: { x: scale.x, y: scale.y, z: scale.z },
  }
  if (parentId) node.parentId = parentId
  else delete node.parentId
  for (const group of nodes.filter((item) => item.type === 'group')) {
    if (group.children?.includes(nodeId)) group.children = group.children.filter((childId) => childId !== nodeId)
    if (group.id === parentId) group.children = [...new Set([...(group.children ?? []), nodeId])]
  }
  return [...new Set([nodeId, oldParent?.id, newParent?.id].filter((id): id is string => Boolean(id)))]
}

function applySceneOperations(project: UnifiedProject, value: unknown): { document: UnifiedProject['scene']; fcurves: unknown; characters: Record<string, Character>; bindings: Record<string, MotionBinding>; changedNodeIds: string[]; cloneMaps: Array<Record<string, Record<string, string>>> } {
  // shortcut: reparent stays unsupported until Topview exposes transform-preserving parent edits for this transaction.
  if (!Array.isArray(value) || value.length < 1 || value.length > 64 || value.some((operation) => !isRecord(operation)) ||
    value.some((operation) => operation.type === 'document.replace') && value.length !== 1) {
    throw new UnifiedStoreError('VALIDATION_FAILED', 'scene.apply expects 1–64 operations; document.replace must be used alone', 400)
  }
  let document = structuredClone(project.scene)
  let fcurves = structuredClone(project.extensions.topview?.fcurves ?? null)
  const changedNodeIds = new Set<string>()
  const characters: Record<string, Character> = {}
  const bindings: Record<string, MotionBinding> = {}
  const characterByNode = new Map(Object.values(project.characters).map((character) => [character.nodeId, character]))
  const bindingByClip: Record<string, MotionBinding> = { ...project.bindings }
  const cloneMaps: Array<Record<string, Record<string, string>>> = []
  for (const operation of value as Record<string, unknown>[]) {
    const nodeId = operation.nodeId
    if (operation.type === 'document.replace') {
      if (Object.keys(operation).some((key) => !['type', 'document', 'fcurves'].includes(key)) || !validateDirectorDocument(operation.document) || !validateFCurves(operation.fcurves ?? null)) {
        throw new UnifiedStoreError('VALIDATION_FAILED', 'Invalid document.replace operation', 400)
      }
      document = structuredClone(operation.document)
      fcurves = structuredClone(operation.fcurves ?? null)
      const sourceNodeIds = new Set(project.scene.content.nodes.map((node) => node.id))
      const sourceMotionClipIds = new Set(project.scene.content.timeline.animation.motionClips.map((clip) => clip.id))
      const sourceNodeByCloneId = new Map<string, string>()
      // Topview duplicateNodes uses <sourceId>_copy_* IDs; autosave uses this to restore shared Character bindings.
      for (const node of document.content.nodes) {
        if (sourceNodeIds.has(node.id)) continue
        const copyAt = node.id.lastIndexOf('_copy_')
        const sourceNodeId = copyAt > 0 ? node.id.slice(0, copyAt) : ''
        if (!sourceNodeIds.has(sourceNodeId)) continue
        sourceNodeByCloneId.set(node.id, sourceNodeId)
        const sourceCharacter = characterByNode.get(sourceNodeId)
        if (node.type !== 'character' || !sourceCharacter) continue
        const characterId = randomUUID()
        characters[characterId] = { ...sourceCharacter, id: characterId, nodeId: node.id, name: node.name }
        characterByNode.set(node.id, characters[characterId]!)
        node.metadata = { ...(isRecord(node.metadata) ? node.metadata : {}), characterId }
        changedNodeIds.add(node.id)
      }
      for (const clip of document.content.timeline.animation.motionClips) {
        if (sourceMotionClipIds.has(clip.id)) continue
        const copyAt = clip.id.lastIndexOf('_copy_')
        const sourceClipId = copyAt > 0 ? clip.id.slice(0, copyAt) : ''
        if (!project.scene.content.timeline.animation.motionClips.some((source) => source.id === sourceClipId)) continue
        const sourceBinding = project.bindings[sourceClipId]
        if (!sourceBinding) continue
        const sourceClip = project.scene.content.timeline.animation.motionClips.find((source) => source.id === sourceClipId)
        const sourceCharacter = sourceClip ? characterByNode.get(sourceClip.target.nodeId) : undefined
        const cloneCharacter = characterByNode.get(clip.target.nodeId)
        if (!sourceCharacter || !cloneCharacter || sourceNodeByCloneId.get(clip.target.nodeId) !== sourceCharacter.nodeId || sourceBinding.characterId !== sourceCharacter.id) continue
        const binding: MotionBinding = { ...sourceBinding, clipId: clip.id, characterId: cloneCharacter.id }
        bindings[clip.id] = binding
        bindingByClip[clip.id] = binding
      }
      continue
    }
    if (operation.type === 'node.transform.patch') {
      const axes = ['position', 'rotation', 'scale'] as const
      if (Object.keys(operation).some((key) => !['type', 'nodeId', ...axes].includes(key)) || typeof nodeId !== 'string' ||
        !axes.some((key) => operation[key] !== undefined) || axes.some((key) => operation[key] !== undefined && !validVec3Patch(operation[key]))) {
        throw new UnifiedStoreError('VALIDATION_FAILED', 'Invalid node.transform.patch operation', 400)
      }
      const node = document.content.nodes.find((item) => item.id === nodeId)
      if (!node) throw new UnifiedStoreError('VALIDATION_FAILED', `Scene node not found: ${nodeId}`, 400)
      if (node.locked) throw new UnifiedStoreError('VALIDATION_FAILED', `Scene node is locked: ${nodeId}`, 400)
      patchNodeTransformInPlace(document, {
        type: 'patch-transform', nodeId,
        ...(operation.position !== undefined ? { position: operation.position as { x?: number; y?: number; z?: number } } : {}),
        ...(operation.rotation !== undefined ? { rotation: operation.rotation as { x?: number; y?: number; z?: number } } : {}),
        ...(operation.scale !== undefined ? { scale: operation.scale as { x?: number; y?: number; z?: number } } : {}),
      })
      changedNodeIds.add(nodeId)
      continue
    }
    if (operation.type === 'node.flags.set') {
      if (Object.keys(operation).some((key) => !['type', 'nodeId', 'visible', 'locked'].includes(key)) || typeof nodeId !== 'string' ||
        operation.visible === undefined && operation.locked === undefined ||
        operation.visible !== undefined && typeof operation.visible !== 'boolean' || operation.locked !== undefined && typeof operation.locked !== 'boolean') {
        throw new UnifiedStoreError('VALIDATION_FAILED', 'Invalid node.flags.set operation', 400)
      }
      const node = document.content.nodes.find((item) => item.id === nodeId)
      if (!node) throw new UnifiedStoreError('VALIDATION_FAILED', `Scene node not found: ${nodeId}`, 400)
      if (operation.visible !== undefined) node.visible = operation.visible
      if (operation.locked !== undefined) node.locked = operation.locked
      changedNodeIds.add(nodeId)
      continue
    }
    if (operation.type === 'node.rename') {
      if (Object.keys(operation).some((key) => !['type', 'nodeId', 'name'].includes(key)) || typeof nodeId !== 'string' ||
        typeof operation.name !== 'string' || !operation.name.trim() || operation.name.trim().length > 120) {
        throw new UnifiedStoreError('VALIDATION_FAILED', 'Invalid node.rename operation', 400)
      }
      const node = document.content.nodes.find((item) => item.id === nodeId)
      if (!node) throw new UnifiedStoreError('VALIDATION_FAILED', `Scene node not found: ${nodeId}`, 400)
      node.name = operation.name.trim()
      changedNodeIds.add(nodeId)
      continue
    }
    if (operation.type === 'node.clone') {
      if (Object.keys(operation).some((key) => !['type', 'nodeId', 'delta'].includes(key)) || typeof nodeId !== 'string' ||
        operation.delta !== undefined && !validTransformDelta(operation.delta)) {
        throw new UnifiedStoreError('VALIDATION_FAILED', 'Invalid node.clone operation', 400)
      }
      const source = document.content.nodes.find((item) => item.id === nodeId)
      if (!source) throw new UnifiedStoreError('VALIDATION_FAILED', `Scene node not found: ${nodeId}`, 400)
      if (source.locked) throw new UnifiedStoreError('VALIDATION_FAILED', `Scene node is locked: ${nodeId}`, 400)
      const duplicated = duplicateDocumentNodes({ document, fcurves, selectedIds: [nodeId], ...(operation.delta ? { delta: operation.delta as { position?: [number, number, number]; rotation?: [number, number, number]; scale?: [number, number, number] } } : {}) })
      if (!duplicated.newNodeIds.length) throw new UnifiedStoreError('VALIDATION_FAILED', `Scene node cannot be cloned: ${nodeId}`, 400)
      const characterIdMap: Record<string, string> = {}
      for (const [sourceNodeId, cloneNodeId] of Object.entries(duplicated.nodeIdMap)) {
        const sourceCharacter = characterByNode.get(sourceNodeId)
        const cloneNode = duplicated.document.content.nodes.find((item) => item.id === cloneNodeId)
        if (!cloneNode) throw new UnifiedStoreError('VALIDATION_FAILED', `Topview clone node is missing: ${cloneNodeId}`, 400)
        if (sourceCharacter) {
          const characterId = randomUUID()
          const character: Character = { ...sourceCharacter, id: characterId, nodeId: cloneNodeId, name: cloneNode.name }
          characters[characterId] = character
          characterByNode.set(cloneNodeId, character)
          characterIdMap[sourceCharacter.id] = characterId
          cloneNode.metadata = { ...(isRecord(cloneNode.metadata) ? cloneNode.metadata : {}), characterId }
        } else if (isRecord(cloneNode.metadata) && typeof cloneNode.metadata.characterId === 'string') {
          const metadata = { ...cloneNode.metadata }
          delete metadata.characterId
          cloneNode.metadata = metadata
        }
        changedNodeIds.add(cloneNodeId)
      }
      for (const [sourceClipId, cloneClipId] of Object.entries(duplicated.clipIdMap)) {
        const sourceBinding = bindingByClip[sourceClipId]
        if (!sourceBinding) continue
        const characterId = characterIdMap[sourceBinding.characterId]
        if (!characterId) throw new UnifiedStoreError('VALIDATION_FAILED', `Motion binding cannot be cloned without its Character: ${sourceClipId}`, 400)
        const binding: MotionBinding = { ...sourceBinding, clipId: cloneClipId, characterId }
        bindings[cloneClipId] = binding
        bindingByClip[cloneClipId] = binding
      }
      document = duplicated.document
      fcurves = duplicated.fcurves
      for (const cloneNodeId of duplicated.newNodeIds) changedNodeIds.add(cloneNodeId)
      cloneMaps.push({ nodeIdMap: duplicated.nodeIdMap, clipIdMap: duplicated.clipIdMap, characterIdMap })
      continue
    }
    if (operation.type === 'node.reparent') {
      if (Object.keys(operation).some((key) => !['type', 'nodeId', 'parentId'].includes(key)) || typeof nodeId !== 'string' ||
        !Object.hasOwn(operation, 'parentId') || operation.parentId !== null && typeof operation.parentId !== 'string') {
        throw new UnifiedStoreError('VALIDATION_FAILED', 'Invalid node.reparent operation', 400)
      }
      for (const changedId of reparentStaticPrimitive(document, fcurves, nodeId, operation.parentId as string | null)) changedNodeIds.add(changedId)
      continue
    }
    if (operation.type === 'node.delete') {
      if (Object.keys(operation).some((key) => !['type', 'nodeId'].includes(key)) || typeof nodeId !== 'string') {
        throw new UnifiedStoreError('VALIDATION_FAILED', 'Invalid node.delete operation', 400)
      }
      const root = document.content.nodes.find((item) => item.id === nodeId)
      if (!root) throw new UnifiedStoreError('VALIDATION_FAILED', `Scene node not found: ${nodeId}`, 400)
      if (root.locked) throw new UnifiedStoreError('VALIDATION_FAILED', `Scene node is locked: ${nodeId}`, 400)
      const removed = new Set<string>()
      const collect = (id: string): void => {
        if (removed.has(id)) return
        const node = document.content.nodes.find((item) => item.id === id)
        if (!node) return
        removed.add(id)
        if (node.type === 'group') for (const child of document.content.nodes) {
          if (child.parentId === id || (node.children ?? []).includes(child.id)) collect(child.id)
        }
        if (node.type === 'character' || node.type === 'camera') for (const clip of document.content.timeline.animation.pathMotionClips) {
          if (clip.target.nodeId === id && clip.lockedReason === 'derived-from-keyframes') collect(clip.pathNodeId)
        }
      }
      collect(nodeId)
      for (const id of removed) changedNodeIds.add(id)
      document.content.nodes = document.content.nodes.filter((node) => !removed.has(node.id))
      for (const node of document.content.nodes) if (node.children) node.children = node.children.filter((id) => !removed.has(id))
      const animation = document.content.timeline.animation
      animation.motionClips = animation.motionClips.filter((clip) => !removed.has(clip.target.nodeId))
      animation.cameraMotionClips = animation.cameraMotionClips.filter((clip) => !removed.has(clip.target.nodeId))
      animation.pathMotionClips = animation.pathMotionClips.filter((clip) => !removed.has(clip.target.nodeId) && !removed.has(clip.pathNodeId))
      if (removed.has(document.content.activeShotCameraNodeId)) {
        document.content.activeShotCameraNodeId = document.content.nodes.find((node) => node.type === 'camera')?.id ?? ''
      }
      const editorial = pruneMissingCameraClips(document)
      if (editorial) document.content.editorial = editorial
      continue
    }
    throw new UnifiedStoreError('VALIDATION_FAILED', `Unsupported scene operation: ${String(operation.type)}`, 400)
  }
  if (!validateDirectorDocument(document) || !validateFCurves(fcurves)) throw new UnifiedStoreError('VALIDATION_FAILED', 'Scene operations produced an invalid Topview document', 400)
  return { document, fcurves, characters, bindings, changedNodeIds: [...changedNodeIds], cloneMaps }
}

function reconcileSceneReplacement(previous: UnifiedProject, next: UnifiedProject): { removedCharacters: string[]; removedBindings: string[] } {
  const oldNodes = new Map(previous.scene.content.nodes.map((node) => [node.id, node]))
  const nodes = new Map(next.scene.content.nodes.map((node) => [node.id, node]))
  const removedNodeIds = new Set([...oldNodes.values()]
    .filter((node) => nodes.get(node.id)?.type !== node.type)
    .map((node) => node.id))
  const references = new Set<string>()
  const addReference = (id: string | undefined) => { if (id && removedNodeIds.has(id)) references.add(id) }
  for (const node of next.scene.content.nodes) {
    addReference(node.camera?.lookAtTarget?.nodeId)
    addReference(node.camera?.subject?.nodeId)
  }
  const timeline = next.scene.content.timeline
  for (const clip of timeline.animation.motionClips) addReference(clip.target.nodeId)
  for (const clip of timeline.animation.cameraMotionClips) addReference(clip.target.nodeId)
  for (const clip of timeline.animation.pathMotionClips) { addReference(clip.target.nodeId); addReference(clip.pathNodeId) }
  addReference(next.scene.content.activeShotCameraNodeId)
  for (const sequence of next.scene.content.editorial?.sequences ?? []) for (const clip of sequence.clips) addReference(clip.cameraNodeId)
  if (references.size) throw new UnifiedStoreError('VALIDATION_FAILED', 'Scene nodes still have camera, timeline, path, or shot references', 400, { nodeIds: [...references] })

  const rawFcurves = next.extensions.topview?.fcurves
  if (rawFcurves != null && removedNodeIds.size) {
    const curves = FCurveSet.parse(rawFcurves)
    const userKeys = FCurveSet.parseUserKeys(rawFcurves)
    for (const id of removedNodeIds) { curves.removeNode(id); delete userKeys[id] }
    next.extensions.topview = { ...(next.extensions.topview ?? {}), fcurves: FCurveSet.persist(curves, userKeys) }
  }

  const motionClipIds = new Set(timeline.animation.motionClips.map((clip) => clip.id))
  for (const clip of timeline.animation.motionClips) {
    const oldClip = previous.scene.content.timeline.animation.motionClips.find((item) => item.id === clip.id)
    if (oldClip?.motion.rootMotion && !clip.motion.rootMotion) {
      throw new UnifiedStoreError('VALIDATION_FAILED', 'Scene replacement cannot remove a shared root-motion policy; edit the binding instead', 400)
    }
  }
  const removedBindings: string[] = []
  for (const clipId of Object.keys(next.bindings)) {
    if (motionClipIds.has(clipId)) continue
    delete next.bindings[clipId]
    removedBindings.push(clipId)
  }
  const removedCharacters: string[] = []
  for (const [characterId, character] of Object.entries(next.characters)) {
    if (nodes.get(character.nodeId)?.type === 'character') continue
    const sessions = Object.values(next.retargetSessions).filter((session) => session.targetCharacterId === characterId)
    if (sessions.length) throw new UnifiedStoreError('VALIDATION_FAILED', 'Character cannot be removed while Retarget sessions reference it', 400, { characterId, sessionIds: sessions.map((session) => session.id) })
    delete next.characters[characterId]
    removedCharacters.push(characterId)
    const replacement = nodes.get(character.nodeId)
    if (replacement && isRecord(replacement.metadata) && replacement.metadata.characterId === characterId) {
      const metadata = { ...replacement.metadata }
      delete metadata.characterId
      replacement.metadata = metadata
    }
  }
  return { removedCharacters, removedBindings }
}

function reconcileMotionBindings(next: UnifiedProject): string[] {
  const changed: string[] = []
  for (const clip of next.scene.content.timeline.animation.motionClips) {
    const binding = next.bindings[clip.id]
    const motion = binding && next.motions[binding.motionId]
    if (!binding || !motion) continue
    const sourceStartSeconds = clip.motion.time
    const sourceLengthSeconds = clip.motion.sourceLengthSeconds ?? motion.durationSeconds - sourceStartSeconds
    const reverse = clip.motion.reverse ?? false
    if (binding.sourceStartSeconds === sourceStartSeconds && binding.sourceLengthSeconds === sourceLengthSeconds && binding.reverse === reverse) continue
    next.bindings[clip.id] = { ...binding, sourceStartSeconds, sourceLengthSeconds, reverse }
    changed.push(`binding:${clip.id}`)
  }
  return changed
}

function prepareMotionBindingEdit(project: UnifiedProject, args: Record<string, unknown>) {
  const { binding, clipPatch = {} } = args
  const fields = ['clipId', 'characterId', 'motionId', 'sourceStartSeconds', 'sourceLengthSeconds', 'reverse', 'fadeInSeconds', 'fadeOutSeconds', 'rootPolicy', 'alignment']
  if (Object.keys(args).some((key) => !['binding', 'clipPatch'].includes(key)) || !isRecord(binding) ||
    fields.some((key) => !(key in binding)) || Object.keys(binding).some((key) => !fields.includes(key)) ||
    !isRecord(clipPatch) || Object.keys(clipPatch).some((key) => !['frameStart', 'frameEnd', 'playback'].includes(key)) ||
    clipPatch.playback !== undefined && (!isRecord(clipPatch.playback) || Object.keys(clipPatch.playback).some((key) => !['speed', 'loop'].includes(key)))) {
    throw new UnifiedStoreError('VALIDATION_FAILED', 'Expected a complete MotionBinding and an optional frame/playback patch', 400)
  }
  const clip = project.scene.content.timeline.animation.motionClips.find((item) => item.id === binding.clipId)
  if (!clip || !project.bindings[clip.id]) throw new UnifiedStoreError('NOT_FOUND', 'Shared motion binding was not found', 404)
  if (project.scene.content.nodes.find((node) => node.id === clip.target.nodeId)?.locked) throw new UnifiedStoreError('VALIDATION_FAILED', 'The clip Character is locked', 400)
  const candidate = structuredClone(project)
  candidate.bindings[clip.id] = structuredClone(binding) as unknown as MotionBinding
  const character = typeof binding.characterId === 'string' ? candidate.characters[binding.characterId] : undefined
  const candidateClip = candidate.scene.content.timeline.animation.motionClips.find((item) => item.id === clip.id)!
  candidateClip.target.nodeId = character?.nodeId ?? ''
  if (binding.fadeInSeconds !== 0 || binding.fadeOutSeconds !== 0) {
    throw new UnifiedStoreError('UNSUPPORTED_CAPABILITY', 'Fade evaluation is not implemented yet', 422)
  }
  const profile = character && candidate.skeletons[character.skeletonId]
  const rootBone = profile?.bones.find((bone) => bone.id === profile.rootBoneId)
  if (rootBone) {
    candidateClip.motion.rootMotion = { policy: binding.rootPolicy as MotionBinding['rootPolicy'], boneName: rootBone.name, alignment: binding.alignment as MotionBinding['alignment'] }
    candidateClip.motion.inPlace = binding.rootPolicy === 'in-place'
  }
  const frameStart = 'frameStart' in clipPatch ? clipPatch.frameStart : clip.frameStart
  const frameEnd = 'frameEnd' in clipPatch ? clipPatch.frameEnd : clip.frameEnd + (Number(frameStart) - clip.frameStart)
  if (!Number.isSafeInteger(frameEnd) || (frameEnd as number) < (frameStart as number)) throw new UnifiedStoreError('VALIDATION_FAILED', 'Clip end must be an inclusive integer at or after its start', 400)
  candidateClip.frameStart = frameStart as number
  candidateClip.frameEnd = frameEnd as number
  const conflict = findRootMotionConflict(candidate.scene)
  if (conflict) throw new UnifiedStoreError('ROOT_MOTION_CONFLICT', 'Trajectory and path contain the same root-motion source', 422, conflict)
  if (!validateProject(candidate)) throw new UnifiedStoreError('VALIDATION_FAILED', 'MotionBinding fields or references are invalid', 400)
  const playback = isRecord(clipPatch.playback) ? clipPatch.playback : {}
  return {
    binding: candidate.bindings[clip.id]!, frameEnd: frameEnd as number,
    args: { motionId: binding.motionId, characterId: binding.characterId, frameStart,
      sourceStartSeconds: binding.sourceStartSeconds, sourceLengthSeconds: binding.sourceLengthSeconds, reverse: binding.reverse,
      speed: 'speed' in playback ? playback.speed : clip.playback.speed, loop: 'loop' in playback ? playback.loop : clip.playback.loop },
  }
}

async function evaluateUnifiedSceneChecks(project: UnifiedProject, frame: number, cameraNodeId: string | undefined, snapshot: ReturnType<typeof createFrameSnapshot>, checks: string[]) {
  const referenced = new Set<string>()
  for (const node of project.scene.content.nodes) {
    if (!['character', 'prop', 'primitive'].includes(node.type)) continue
    const character = Object.values(project.characters).find((entry) => entry.nodeId === node.id)
    const metadata = isRecord(node.metadata) ? node.metadata : {}
    const match = typeof metadata.modelUrl === 'string' ? /\/assets\/([^/]+)\/source(?:[?#]|$)/.exec(metadata.modelUrl) : null
    let routeAssetId: string | undefined
    if (match) { try { routeAssetId = decodeURIComponent(match[1]!) } catch { /* malformed node URLs are reported as unavailable below */ } }
    const assetId = [character?.assetId, typeof metadata.assetId === 'string' ? metadata.assetId : undefined, routeAssetId]
      .find((candidate) => candidate !== undefined && Object.hasOwn(project.assets, candidate))
    if (assetId) referenced.add(assetId)
  }
  for (const clip of project.scene.content.timeline.animation.motionClips) {
    const motion = project.motions[clip.motion.assetId]
    if (motion) referenced.add(motion.assetId)
  }

  let tempRoot: string | undefined
  try {
    tempRoot = await mkdtemp(path.join(tmpdir(), 'bbs-scene-check-'))
    const localAssets: Record<string, string> = {}
    let index = 0
    for (const assetId of referenced) {
      const asset = project.assets[assetId as keyof typeof project.assets]!
      const source = await resolveUnifiedAssetFile(project, assetId, 'source')
      const file = path.join(tempRoot, `${index++}${path.extname(asset.source.path) || '.asset'}`)
      await writeFile(file, source.bytes, { flag: 'wx' })
      localAssets[`api/unified/projects/${project.projectId}/assets/${encodeURIComponent(assetId)}/source`] = file
    }
    const extension = isRecord(project.extensions.topview) ? project.extensions.topview : {}
    const rawFcurves = extension.fcurves
    return await evaluateSceneChecks({
      document: project.scene,
      frame,
      checks: checks as Array<'grounding' | 'overlap' | 'frustum'>,
      cameraNodeId,
      fcurves: rawFcurves ?? null,
      localAssets,
      transformOverrides: Object.fromEntries(snapshot.transforms),
    })
  } catch (error) {
    const reason = error instanceof Error ? error.message.split('\n')[0].slice(0, 200) : 'verified scene asset unavailable'
    const issues = checks.map((check) => ({ code: 'CHECK_UNAVAILABLE', path: `checks.${check}`, message: `Geometry source unavailable: ${reason}` }))
    return { checks: Object.fromEntries(checks.map((check) => [check, { status: 'unavailable', issues: [{ code: 'CHECK_UNAVAILABLE', message: `Geometry source unavailable: ${reason}` }] }])), issues, warnings: [], blockedRequests: [] }
  } finally {
    if (tempRoot) await rm(tempRoot, { recursive: true, force: true })
  }
}

async function evaluateUnifiedScene(project: UnifiedProject, frame: number, cameraNodeId: string | undefined, checks: string[]) {
  const snapshot = createFrameSnapshot()
  evaluateFrame(projectEvaluationScene(project), frame, snapshot)
  const issues: Array<{ code: string; path: string; message: string }> = []
  const timeline = project.scene.content.timeline
  if (frame < timeline.frameStart || frame > timeline.frameEnd) issues.push({ code: 'FRAME_OUTSIDE_TIMELINE', path: 'frame', message: 'Frame is outside the project timeline range.' })
  const skeletons = await evaluateProjectSkeletons(project, snapshot)
  issues.push(...skeletons.issues)
  const geometry = checks.length ? await evaluateUnifiedSceneChecks(project, frame, cameraNodeId, snapshot, checks) : { checks: {}, issues: [], warnings: [], blockedRequests: [] }
  issues.push(...geometry.issues)
  if (cameraNodeId && !snapshot.transforms.has(cameraNodeId)) issues.push({ code: 'CAMERA_NOT_EVALUATED', path: 'cameraNodeId', message: 'The requested camera has no evaluated transform.' })
  return {
    sourceRevision: project.revision,
    frame,
    cameraNodeId: cameraNodeId ?? project.scene.content.activeShotCameraNodeId,
    transforms: Object.fromEntries(snapshot.transforms),
    poseSamples: Object.fromEntries(snapshot.poses),
    skeletonSamples: skeletons.skeletonSamples,
    transformSpace: 'authored-placement',
    skeletonMatrixOrder: 'column-major',
    boneLocalSpace: 'model-units',
    boneWorldSpace: 'scene-meters',
    motionPlayback: snapshot.motionPlayback,
    checks: geometry.checks,
    checkDiagnostics: { warnings: geometry.warnings, blockedRequests: geometry.blockedRequests },
    issues,
  }
}

async function withWriter<T>(id: string, action: () => Promise<T>): Promise<T> {
  const lock = path.join(root(), id, '.writer.lock')
  let handle
  try { handle = await open(lock, 'wx') } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new UnifiedStoreError('WRITER_BUSY', 'Project is already being written', 423)
    throw error
  }
  try { await handle.writeFile(`${process.pid}\n${new Date().toISOString()}\n`); return await action() }
  finally { await handle.close(); await rm(lock, { force: true }) }
}

async function commit(
  envelope: CommandEnvelope,
  hash: string,
  beforeProject: UnifiedProject,
  afterProject: UnifiedProject,
  afterIndex: HistoryIndex,
  result: Record<string, unknown>,
  changedIds: string[],
): Promise<CommandSuccess> {
  const response = success(envelope.requestId, afterProject.projectId, afterProject.revision, result, changedIds)
  const record: HistoryRecord = {
    requestId: envelope.requestId,
    hash,
    before: projectSnapshot(beforeProject),
    after: projectSnapshot(afterProject),
    nextIndex: afterIndex,
    changedIds,
    response,
  }
  await atomicJson(historyPath(afterProject.projectId, afterProject.revision), record)
  await atomicJson(projectPath(afterProject.projectId), afterProject)
  await atomicJson(path.join(historyDir(afterProject.projectId), 'index.json'), afterIndex)
  await saveRequest(envelope, hash, response)
  const retained = new Set([...afterIndex.entries, afterProject.revision].map(String))
  for (const file of await readdir(historyDir(afterProject.projectId))) {
    const revision = file.endsWith('.json') ? file.slice(0, -5) : ''
    if (/^\d+$/.test(revision) && !retained.has(revision)) await rm(path.join(historyDir(afterProject.projectId), file), { force: true })
  }
  return response
}

function validEnvelope(value: unknown): value is CommandEnvelope {
  return isRecord(value) && typeof value.requestId === 'string' && UUID.test(value.requestId) &&
    (value.projectId === undefined || typeof value.projectId === 'string' && UUID.test(value.projectId)) &&
    (value.expectedRevision === undefined || Number.isInteger(value.expectedRevision) && (value.expectedRevision as number) >= 0) &&
    (value.dryRun === undefined || typeof value.dryRun === 'boolean') &&
    typeof value.command === 'string' && isRecord(value.args)
}

export async function executeUnifiedCommand(raw: unknown): Promise<CommandSuccess> {
  if (!validEnvelope(raw)) throw new UnifiedStoreError('VALIDATION_FAILED', 'Invalid command envelope', 400)
  let envelope = raw
  if (envelope.command === 'animation.assignment.commit') {
    const { jobId, frameStart } = envelope.args
    if (Object.keys(envelope.args).some((key) => !['jobId', 'frameStart'].includes(key)) || typeof jobId !== 'string' || !UUID.test(jobId) ||
        frameStart !== undefined && (!Number.isSafeInteger(frameStart) || (frameStart as number) < 0)) throw new UnifiedStoreError('VALIDATION_FAILED', 'Assignment commit requires a job UUID and optional nonnegative frameStart', 400)
    envelope = { ...envelope, command: 'asset.import', args: { assignmentJobId: jobId, ...(frameStart === undefined ? {} : { frameStart }) } }
  }
  if (Object.keys(envelope).some((key) => !['requestId', 'projectId', 'expectedRevision', 'command', 'args', 'dryRun'].includes(key))) throw new UnifiedStoreError('VALIDATION_FAILED', 'Unknown command envelope field', 400)
  const hash = requestHash(envelope)
  return withRequestLock(envelope.requestId, () => executeLockedCommand(envelope, hash))
}

async function executeLockedCommand(envelope: CommandEnvelope, hash: string): Promise<CommandSuccess> {
  const replay = await previousRequest(envelope, hash)
  if (replay) return replay
  let sceneReplacement: { document: UnifiedProject['scene']; fcurves: unknown; characters: Record<string, Character>; bindings: Record<string, MotionBinding>; changedNodeIds: string[]; cloneMaps: Array<Record<string, Record<string, string>>> } | null = null
  let shotReplacement: { sequenceId: string; clip: EditSequenceClip } | null = null
  let stagedAssetImports: Array<{ upload: StagedAssetUpload; imported: ImportedAsset }> | null = null
  let assignmentPlacement: { characterId: string; frameStart: number | null; jobId: string; provenance: Record<string, unknown> } | null = null
  let libraryPlacement: { characterId: string; motionId: string; frameStart: number; name: string; duration: number; nativeValidated?: boolean } | null = null
  let libraryLink: LibraryLinkPlan | null = null
  let stagedAssetRelink: { upload: StagedAssetUpload; asset: UnifiedProject['assets'][keyof UnifiedProject['assets']] } | null = null
  let characterAddition: { characterId: string; character: UnifiedProject['characters'][string]; scene: UnifiedProject['scene'] } | null = null
  let propAddition: { nodeId: string; assetId: string; scene: UnifiedProject['scene'] } | null = null
  let mappingAddition: { draft: MappingDraft; calibration: RetargetCalibrationV1 | UniversalCalibrationV1; referencePose: UniversalReferencePoseV1 | null; report: MappingValidationReport } | null = null
  let retargetSessionAddition: { session: RetargetSession; nativeProject: RetargetProjectV99 } | null = null
  let shotResult: Awaited<ReturnType<typeof prepareShotResult>> | null = null
  let motionPlacement: { scene: UnifiedProject['scene']; binding: MotionBinding; clipId: string } | null = null
  let filmFrameExtensions: Record<string, unknown> | null = null
  let nativeAnimationAddition: { characterId: string; sourceMotionId: string | null; clipId: string | null; name: string; fps: number; duration: number; edit: Record<string, unknown>; glbBytes: Buffer; motionId: string; skeletonId: string } | null = null
  let cameraMotionChange: CameraMotionCommandResult | null = null

  if (envelope.command === 'project.create') {
    const { name, scene, fcurves = null, source } = envelope.args
    const validSource = source === undefined || isRecord(source) && Object.keys(source).every((key) => ['kind', 'id'].includes(key)) &&
      (source.kind === 'draft' || source.kind === 'project') && typeof source.id === 'string' && /^[a-z0-9][a-z0-9_-]{0,63}$/i.test(source.id)
    if (envelope.projectId !== undefined || envelope.expectedRevision !== undefined || Object.keys(envelope.args).some((key) => !['name', 'scene', 'fcurves', 'source'].includes(key)) || !validSource || !validateDirectorDocument(scene) || !validateFCurves(fcurves) || typeof name !== 'string' || !name.trim() || name.length > 120) throw new UnifiedStoreError('VALIDATION_FAILED', 'Project name or Topview document is invalid', 400)
    if (envelope.dryRun) return success(envelope.requestId, randomUUID(), 0, { valid: true })
    return createNewProject(envelope, hash, name.trim(), (projectId) => ({
      type: 'three-workspace-project', version: 1, projectId, name: name.trim(), revision: 0, scene,
      assets: {}, characters: {}, skeletons: {}, mappings: {}, motions: {}, bindings: {}, retargetSessions: {},
      extensions: { topview: { fcurves, ...(source ? { legacySource: source } : {}) } }, origins: [],
    }))
  }

  if (envelope.command === 'project.import') {
    const source = envelope.args.project
    const name = envelope.args.name
    if (envelope.projectId !== undefined || envelope.expectedRevision !== undefined || Object.keys(envelope.args).some((key) => !['project', 'name'].includes(key)) || !validateProject(source) || (name !== undefined && (typeof name !== 'string' || !name.trim() || name.length > 120))) throw new UnifiedStoreError('VALIDATION_FAILED', 'Imported project manifest is invalid', 400)
    if (Object.values(source.assets).length || Object.values(source.characters).length || Object.values(source.skeletons).length || Object.values(source.mappings).length || Object.values(source.motions).length || Object.values(source.bindings).length || Object.values(source.retargetSessions).length) throw new UnifiedStoreError('ASSET_MISSING', 'This phase imports scene-only manifests; native asset blobs are not yet copied', 422)
    if (envelope.dryRun) return success(envelope.requestId, randomUUID(), 0, { valid: true })
    const newName = typeof name === 'string' ? name.trim() : source.name
    return createNewProject(envelope, hash, newName, (projectId) => ({ ...structuredClone(source), projectId, name: newName, revision: 0 }))
  }

  if (!envelope.projectId) throw new UnifiedStoreError('VALIDATION_FAILED', 'projectId is required', 400)
  const id = envelope.projectId
  const project = await readUnifiedProject(id)
  if (envelope.command.startsWith('app3.')) {
    try {
      if (envelope.expectedRevision !== undefined && envelope.expectedRevision !== project.revision) throw new UnifiedStoreError('REVISION_CONFLICT', 'Project revision changed', 409)
      const result = await executeApp3Artifacts(project, envelope.command, envelope.args, envelope.requestId, envelope.dryRun, envelope.expectedRevision, () => readUnifiedProject(id))
      const response = success(envelope.requestId, id, project.revision, result)
      if (envelope.command === 'app3.command.submit') await saveRequest(envelope, hash, response)
      return response
    } catch (error) {
      if (error instanceof App3BridgeError) throw new UnifiedStoreError(error.code, error.message, error.status)
      throw error
    }
  }
  if (envelope.command === 'episode.export') {
    try { await validateFilmEffectsDestination(envelope.args.effectsPolicy) }
    catch (error) { throw new UnifiedStoreError('VALIDATION_FAILED', error instanceof Error ? error.message : 'Invalid effects destination', 400) }
    if (envelope.expectedRevision !== project.revision) throw new UnifiedStoreError('REVISION_CONFLICT', 'Dự án đã thay đổi — tải lại trước khi xuất tập.', 409)
    const episode = readEpisode(project)
    if (!episode) throw new UnifiedStoreError('VALIDATION_FAILED', 'Dự án chưa thuộc nhóm tập.', 400)
    if (Object.keys(envelope.args).some((key) => !['name', 'worldAnchor', 'effectsPolicy', 'viewportAspect'].includes(key))) throw new UnifiedStoreError('VALIDATION_FAILED', 'Tùy chọn xuất tập không hợp lệ.', 400)
    const rows = (await listUnifiedProjects()).filter((row) => row.episode?.id === episode.id).sort((a, b) => a.episode!.order - b.episode!.order)
    if (new Set(rows.map((row) => row.episode!.order)).size !== rows.length) throw new UnifiedStoreError('VALIDATION_FAILED', 'Nhóm tập có số thứ tự shot trùng nhau.', 400)
    const segments: Awaited<ReturnType<typeof planFilmSeriesWithCameraSamples>> = []
    let name = '', anchor = envelope.args.worldAnchor
    for (const row of rows) {
      const member = await readUnifiedProject(row.id)
      const sequenceId = member.scene.content.editorial?.activeSequenceId
      try {
        const resolved = resolveSceneBbsFilmArgs(member, { ...envelope.args, ...(anchor ? { worldAnchor: anchor } : {}), name: envelope.args.name ?? 'episode', sequenceId, characterIds: [], propIds: [], content: 'characters' })
        name = resolved.film.filmName
        const planned = await planFilmSeriesWithCameraSamples(member, { ...resolved.film, characterIds: Object.keys(member.characters), propIds: member.scene.content.nodes.filter((node) => node.type === 'prop' && typeof node.metadata?.assetId === 'string').map((node) => node.id), content: Object.keys(member.characters).length ? 'both' : 'backdrops' })
        anchor = planned[0]?.exportArgs.worldAnchor ?? anchor
        for (const segment of planned) { segment.order = segments.length + 1; segments.push(segment) }
      } catch (error) { throw new UnifiedStoreError('VALIDATION_FAILED', `${member.name}: ${error instanceof Error ? error.message : 'Không thể xuất.'}`, 400) }
    }
    const blocked = segments.flatMap((segment) => segment.planningIssues.map((issue) => issue.message))
    if (blocked.length) throw new UnifiedStoreError('VALIDATION_FAILED', blocked.join('\n'), 422)
    if (name.length > 56) throw new UnifiedStoreError('VALIDATION_FAILED', 'Tên file tập tối đa 56 ký tự ASCII.', 400)
    let tick = 0
    const series = segments.map((segment) => { const startTick = tick; tick += segment.ticks; return { projectId: segment.project.projectId, order: segment.order, ticks: segment.ticks, startTick, endTick: tick } })
    if (envelope.dryRun) return success(envelope.requestId, id, project.revision, { valid: true, episode, series })
    const job = await startUnifiedFilmSeriesExport(project, { name, segments })
    const response = success(envelope.requestId, id, project.revision, { jobId: job.jobId, state: job.state, sourceRevision: project.revision, episode, series })
    await saveRequest(envelope, hash, response)
    return response
  }
  if (envelope.command === 'project.splitShots') {
    const args = envelope.args
    if (Object.keys(args).some((key) => !['sequenceId', 'shotIds', 'episodeName'].includes(key)) || args.sequenceId !== undefined && typeof args.sequenceId !== 'string' || args.shotIds !== undefined && !isUniqueStringIdList(args.shotIds) || args.episodeName !== undefined && (typeof args.episodeName !== 'string' || !args.episodeName.trim() || args.episodeName.length > 100)) throw new UnifiedStoreError('VALIDATION_FAILED', 'Thông tin tách shot không hợp lệ.', 400)
    if (envelope.expectedRevision !== project.revision) throw new UnifiedStoreError('REVISION_CONFLICT', 'Dự án đã thay đổi — tải lại trước khi tách shot.', 409)
    const pending = await readJson<RequestRecord>(requestPath(envelope.requestId))
    let plans: ReturnType<typeof planSplitShots>
    try {
      const audioDurations = new Map<string, number>()
      for (const cue of readAudioCueExtension(project).cues) if (!audioDurations.has(cue.assetId)) {
        const audio = await resolveUnifiedAssetFile(project, cue.assetId, 'source')
        audioDurations.set(cue.assetId, (await decodeAudio(audio.bytes)).length / MIX_RATE)
      }
      plans = planSplitShots(project, args as Parameters<typeof planSplitShots>[1], pending?.splitProjectIds, audioDurations)
    }
    catch (error) { throw new UnifiedStoreError('VALIDATION_FAILED', error instanceof Error ? error.message : 'Không thể tách shot.', 400) }
    for (const plan of plans) if (!validateProject(plan.project)) throw new UnifiedStoreError('VALIDATION_FAILED', `Shot ${plan.shotId}: dữ liệu dự án không hợp lệ.`, 400)
    const reports: Record<string, unknown>[] = []
    if (!envelope.dryRun) await atomicJson(requestPath(envelope.requestId), { hash, splitProjectIds: plans.map((plan) => plan.project.projectId) } satisfies RequestRecord)
    try {
      for (const plan of plans) {
        const next = plan.project
        const shared = envelope.dryRun ? { assetBytes: 0, sharedBlobCount: 0 } : await linkSplitShotAssets(root(), id, next)
        const manifestBytes = Buffer.byteLength(JSON.stringify(next, null, 2) + '\n')
        if (!envelope.dryRun) await atomicJson(projectPath(next.projectId), next)
        reports.push({ projectId: next.projectId, name: next.name, shotId: plan.shotId, nodeCount: next.scene.content.nodes.length, clipCount: next.scene.content.timeline.animation.motionClips.length, manifestBytes, ...shared, newAssetBytes: 0, range: { startFrame: 0, endFrame: next.scene.content.timeline.frameEnd }, sourceRange: plan.sourceRange, warnings: plan.warnings })
      }
    } catch (error) {
      for (const plan of plans) await rm(path.join(root(), plan.project.projectId), { recursive: true, force: true })
      throw error
    }
    const response = success(envelope.requestId, id, project.revision, { projects: reports, sourceUnchanged: true })
    response.warnings = plans.flatMap((plan) => plan.warnings.map((message) => ({ code: 'SHOT_TRIMMED', path: plan.shotId, message })))
    if (!envelope.dryRun) await saveRequest(envelope, hash, response)
    return response
  }
  if (envelope.command === 'project.inspect') {
    if (Object.keys(envelope.args).length !== 0) throw new UnifiedStoreError('VALIDATION_FAILED', 'project.inspect does not accept arguments in this phase', 400)
    const response = success(envelope.requestId, id, project.revision, { project })
    await saveRequest(envelope, hash, response)
    return response
  }
  if (envelope.command === 'project.save') {
    if (Object.keys(envelope.args).length !== 0) throw new UnifiedStoreError('VALIDATION_FAILED', 'project.save does not accept arguments', 400)
    const response = success(envelope.requestId, id, project.revision, { revision: project.revision, sha256: createHash('sha256').update(JSON.stringify(project)).digest('hex'), manifestPath: `${id}/project.json` })
    await saveRequest(envelope, hash, response)
    return response
  }
  if (envelope.command === 'film.anchor.location.set') {
    if (Object.keys(envelope.args).some((key) => !['name', 'anchor'].includes(key))) throw new UnifiedStoreError('VALIDATION_FAILED', 'Chỉ nhận tên và điểm neo', 400)
    if (!Number.isInteger(envelope.expectedRevision)) throw new UnifiedStoreError('VALIDATION_FAILED', 'expectedRevision is required', 400)
    if (envelope.expectedRevision !== project.revision) throw new UnifiedStoreError('REVISION_CONFLICT', 'Dự án đã thay đổi; tải lại trước khi lưu địa điểm', 409)
    try { filmFrameExtensions = writeFilmAnchorLocation(project.extensions, envelope.args.name, envelope.args.anchor as import('./filmWorldAnchor').FilmWorldAnchor) }
    catch (error) { throw new UnifiedStoreError('VALIDATION_FAILED', error instanceof Error ? error.message : 'Điểm neo không hợp lệ', 400) }
    if (envelope.dryRun) return success(envelope.requestId, id, project.revision, { valid: true })
  }
  if (envelope.command === 'film.frame.set') {
    if (Object.keys(envelope.args).some((key) => key !== 'aspect')) throw new UnifiedStoreError('VALIDATION_FAILED', 'film.frame.set accepts only aspect', 400)
    if (!Number.isInteger(envelope.expectedRevision)) throw new UnifiedStoreError('VALIDATION_FAILED', 'expectedRevision is required for film.frame.set', 400)
    if (envelope.expectedRevision !== project.revision) throw new UnifiedStoreError('REVISION_CONFLICT', 'Film frame revision changed; reload before saving', 409, { expected: envelope.expectedRevision, actual: project.revision })
    try { filmFrameExtensions = writeFilmFrameAspect(project.extensions, envelope.args.aspect as '16:9' | '9:16' | '1:1' | number) }
    catch (error) { throw new UnifiedStoreError('VALIDATION_FAILED', error instanceof Error ? error.message : 'Invalid film frame aspect', 400) }
    if (envelope.dryRun) return success(envelope.requestId, id, project.revision, { valid: true, aspect: envelope.args.aspect, viewportAspect: readFilmFrameAspect(filmFrameExtensions) })
  }
  if (envelope.command === 'rig.inspect') {
    const { assetId, skeletonProfileId } = envelope.args
    if (Object.keys(envelope.args).some((key) => !['assetId', 'skeletonProfileId'].includes(key)) || typeof assetId !== 'string' || !project.assets[assetId as keyof typeof project.assets] ||
      skeletonProfileId !== undefined && typeof skeletonProfileId !== 'string') throw new UnifiedStoreError('VALIDATION_FAILED', 'rig.inspect requires an existing AssetID and optional SkeletonProfileID', 400)
    try {
      const result = await inspectProjectRig(project, assetId, undefined, typeof skeletonProfileId === 'string' ? skeletonProfileId : undefined)
      const response = success(envelope.requestId, id, project.revision, result)
      await saveRequest(envelope, hash, response)
      return response
    } catch (error) {
      if (error instanceof UnifiedStoreError) throw error
      throw new UnifiedStoreError('UNSUPPORTED_CAPABILITY', 'Rig inspection could not decode the selected asset; check embedded resources, skeleton selection and supported channel bindings.', 422)
    }
  }
  if (envelope.command === 'animation.assignment.plan' || envelope.command === 'animation.assignment.run') {
    const running = envelope.command === 'animation.assignment.run'
    if (running && envelope.expectedRevision !== project.revision) throw new UnifiedStoreError('REVISION_CONFLICT', 'Assignment requires the current expectedRevision', 409)
    const { motionId, characterId, fps } = envelope.args
    if (Object.keys(envelope.args).some((key) => !['motionId', 'characterId', 'fps', ...(running ? ['planSha256'] : [])].includes(key)) || typeof motionId !== 'string' || typeof characterId !== 'string' || typeof fps !== 'number') throw new UnifiedStoreError('VALIDATION_FAILED', 'Assignment requires MotionID, CharacterID and FPS', 400)
    try {
      const args = { motionId, characterId, fps }
      const plan = await planProjectAssignment(project, args)
      if (running) {
        if (typeof envelope.args.planSha256 !== 'string' || envelope.args.planSha256 !== plan.planSha256 || !plan.ready) throw new UnifiedStoreError('VALIDATION_FAILED', 'Assignment requires a matching ready plan hash', 422)
        if (envelope.dryRun) return success(envelope.requestId, id, project.revision, { valid: true, planSha256: plan.planSha256 })
        const job = await startUnifiedAssignment(project, args, plan.planSha256)
        const response = success(envelope.requestId, id, project.revision, { jobId: job.jobId, sourceRevision: job.sourceRevision, state: job.state })
        await saveRequest(envelope, hash, response)
        return response
      }
      const response = success(envelope.requestId, id, project.revision, plan)
      await saveRequest(envelope, hash, response)
      return response
    } catch (cause) { throw new UnifiedStoreError('UNSUPPORTED_CAPABILITY', cause instanceof TypeError ? cause.message : 'Assignment source or receiver could not be inspected', 422) }
  }
  if (envelope.command === 'rig.normalization.plan' || envelope.command === 'rig.normalization.run') {
    if (envelope.command === 'rig.normalization.run' && envelope.expectedRevision !== project.revision) throw new UnifiedStoreError('REVISION_CONFLICT', 'Normalization requires the current expectedRevision', 409)
    const { sourceAssetId, targetAssetId, mappingId, actionIndex, fps, rootTranslationPolicy, rootTranslationScale } = envelope.args
    if (rootTranslationPolicy !== undefined && rootTranslationPolicy !== 'preserve' && rootTranslationPolicy !== 'in-place') throw new UnifiedStoreError('VALIDATION_FAILED', 'Invalid root translation policy', 400)
    if (rootTranslationScale !== undefined && (typeof rootTranslationScale !== 'number' || !Number.isFinite(rootTranslationScale) || rootTranslationScale < 0.01 || rootTranslationScale > 20)) throw new UnifiedStoreError('VALIDATION_FAILED', 'Root translation scale must be in [0.01, 20]', 400)
    if (Object.keys(envelope.args).some((key) => !['sourceAssetId', 'targetAssetId', 'mappingId', 'actionIndex', 'fps', 'rootTranslationPolicy', 'rootTranslationScale', ...(envelope.command === 'rig.normalization.run' ? ['planSha256'] : [])].includes(key)) ||
        typeof sourceAssetId !== 'string' || typeof targetAssetId !== 'string' || typeof mappingId !== 'string' || typeof actionIndex !== 'number' || typeof fps !== 'number') throw new UnifiedStoreError('VALIDATION_FAILED', 'Normalization plan requires source/target AssetIDs, mappingId, actionIndex and fps', 400)
    try {
      const normalizationArgs = { sourceAssetId, targetAssetId, mappingId, actionIndex, fps,
        ...(rootTranslationPolicy ? { rootTranslationPolicy: rootTranslationPolicy as 'preserve' | 'in-place' } : {}),
        ...(typeof rootTranslationScale === 'number' ? { rootTranslationScale } : {}) }
      const result = await planProjectNormalization(project, normalizationArgs)
      if (envelope.command === 'rig.normalization.run') {
        if (typeof envelope.args.planSha256 !== 'string' || envelope.args.planSha256 !== result.planSha256 || !result.ready) throw new UnifiedStoreError('VALIDATION_FAILED', 'Normalization requires a matching ready plan hash', 422)
        if (envelope.dryRun) return success(envelope.requestId, id, project.revision, { valid: true, planSha256: result.planSha256 })
        const job = await startUnifiedNormalization(project, normalizationArgs, result.planSha256)
        const response = success(envelope.requestId, id, project.revision, { jobId: job.jobId, sourceRevision: job.sourceRevision, state: job.state })
        await saveRequest(envelope, hash, response)
        return response
      }
      const response = success(envelope.requestId, id, project.revision, result)
      await saveRequest(envelope, hash, response)
      return response
    } catch (error) {
      if (error instanceof UnifiedStoreError) throw error
      if (error instanceof Error && 'code' in error && error.code === 'JOB_BUSY') throw new UnifiedStoreError('JOB_BUSY', 'A local job is already active', 423)
      throw new UnifiedStoreError('VALIDATION_FAILED', error instanceof TypeError ? error.message : 'Normalization plan could not inspect source and target assets', 422)
    }
  }
  if (envelope.command === 'camera.framing.preview' || envelope.command === 'camera.framing.apply') {
    if (envelope.command === 'camera.framing.apply') {
      if (!Number.isInteger(envelope.expectedRevision)) throw new UnifiedStoreError('VALIDATION_FAILED', 'expectedRevision is required for framing apply', 400)
      if (envelope.expectedRevision !== project.revision) throw new UnifiedStoreError('REVISION_CONFLICT', 'Project revision changed; preview again', 409)
    }
    let plan: Awaited<ReturnType<typeof previewCameraFraming>>
    try { plan = await previewCameraFraming(project, envelope.args) }
    catch (error) { throw new UnifiedStoreError('VALIDATION_FAILED', error instanceof Error ? error.message : 'Invalid framing', 400) }
    if (envelope.command === 'camera.framing.preview') {
      const { operations: _operations, ...summary } = plan
      const response = success(envelope.requestId, id, project.revision, summary)
      await saveRequest(envelope, hash, response)
      return response
    }
    envelope = { ...envelope, command: 'scene.apply', args: { operations: plan.operations } }
  }
  if (envelope.command === 'scene.layout.preview' || envelope.command === 'scene.layout.apply') {
    if (envelope.command === 'scene.layout.apply') {
      if (!Number.isInteger(envelope.expectedRevision)) throw new UnifiedStoreError('VALIDATION_FAILED', 'expectedRevision is required for layout apply', 400)
      if (envelope.expectedRevision !== project.revision) throw new UnifiedStoreError('REVISION_CONFLICT', 'Project revision changed; preview again', 409)
    }
    let plan: ReturnType<typeof previewCharacterLayout>
    try {
      const layout=await readSceneLayout(project,{frame:envelope.args.frame===undefined?project.scene.content.timeline.frameStart:envelope.args.frame})
      const world=new Map([...layout.characters.map(c=>[c.nodeId,{position:c.position}] as const),...layout.cameras.map(c=>[c.id,{position:c.position}] as const)])
      plan = previewCharacterLayout(project, envelope.args,world)
    }
    catch (error) { throw new UnifiedStoreError('VALIDATION_FAILED', error instanceof Error ? error.message : 'Invalid layout', 400) }
    if (envelope.command === 'scene.layout.preview') {
      const {operations,...summary}=plan
      const response = success(envelope.requestId, id, project.revision, summary)
      await saveRequest(envelope, hash, response)
      return response
    }
    envelope = { ...envelope, command: 'scene.apply', args: { operations: plan.operations } }
  }
  if (envelope.command === 'scene.layout.read') {
    try {
      const response = success(envelope.requestId, id, project.revision, await readSceneLayout(project, envelope.args))
      await saveRequest(envelope, hash, response)
      return response
    } catch (error) {
      throw new UnifiedStoreError('VALIDATION_FAILED', error instanceof Error ? error.message : 'Scene layout could not be read', 400)
    }
  }
  if (envelope.command === 'scene.evaluate') {
    const { frame, cameraNodeId, checks = [] } = envelope.args
    if (Object.keys(envelope.args).some((key) => !['frame', 'cameraNodeId', 'checks'].includes(key)) || !isFiniteNumber(frame) ||
      cameraNodeId !== undefined && (typeof cameraNodeId !== 'string' || !project.scene.content.nodes.some((node) => node.id === cameraNodeId && node.type === 'camera')) ||
      !Array.isArray(checks) || checks.length > 3 || checks.some((check) => !['grounding', 'overlap', 'frustum'].includes(String(check)))) {
      throw new UnifiedStoreError('VALIDATION_FAILED', 'scene.evaluate requires a finite frame and optional camera/check IDs', 400)
    }
    const response = success(envelope.requestId, id, project.revision, await evaluateUnifiedScene(project, frame, cameraNodeId, checks))
    await saveRequest(envelope, hash, response)
    return response
  }
  if (envelope.command === 'scene.preview.bbs') {
    const { sequenceId, frames, viewportAspect, characterIds, propIds } = envelope.args
    const sequence = typeof sequenceId === 'string'
      ? project.scene.content.editorial?.sequences.find((item) => item.id === sequenceId)
      : undefined
    const validIds = (value: unknown, available: string[]) => value === undefined ||
      Array.isArray(value) && new Set(value).size === value.length && value.every((id) => typeof id === 'string' && available.includes(id))
    if (Object.keys(envelope.args).some((key) => !['sequenceId', 'frames', 'viewportAspect', 'characterIds', 'propIds'].includes(key)) ||
      typeof sequenceId !== 'string' || !sequenceId.trim() || !sequence ||
      !Array.isArray(frames) || !frames.length || frames.length > 60 ||
      frames.some((frame) => !Number.isSafeInteger(frame)) || new Set(frames).size !== frames.length ||
      typeof viewportAspect !== 'number' || !Number.isFinite(viewportAspect) || viewportAspect <= 0 ||
      !validIds(characterIds, Object.keys(project.characters)) ||
      !validIds(propIds, project.scene.content.nodes.filter((node) => node.type === 'prop').map((node) => node.id)) ||
      frames.some((frame) => {
        const sourceClips = sequence.clips.filter((clip) => Number.isSafeInteger(clip.sourceFrameStart) && Number.isSafeInteger(clip.sourceFrameEnd) && frame >= clip.sourceFrameStart && frame <= clip.sourceFrameEnd)
        return sourceClips.length === 0 && sequence.clips.filter((clip) => Number.isSafeInteger(clip.sourceFrameEnd) && frame === clip.sourceFrameEnd + 1 &&
          !sequence.clips.some((item) => item.sourceFrameStart === frame)).length !== 1
      })) {
      throw new UnifiedStoreError('VALIDATION_FAILED', 'scene.preview.bbs requires up to 60 unique source frames in the selected sequence, a positive viewport aspect, and existing Character/Prop IDs', 400)
    }
    try {
      const result = await sampleBbsPreview(project, { sequenceId, frames: frames as number[], viewportAspect,
        ...(characterIds === undefined ? {} : { characterIds: characterIds as string[] }),
        ...(propIds === undefined ? {} : { propIds: propIds as string[] }) })
      return success(envelope.requestId, id, project.revision, result)
    } catch (error) {
      throw new UnifiedStoreError('VALIDATION_FAILED', error instanceof Error ? error.message : 'BBS preview could not be sampled', 400)
    }
  }
  if (envelope.command === 'scene.render') {
    const { frames, cameraNodeIds, width, height, outputDirectory, silhouette, bbsLook, viewportAspect } = envelope.args
    const cameras = project.scene.content.nodes.filter((node) => node.type === 'camera')
    if (envelope.expectedRevision !== undefined && envelope.expectedRevision !== project.revision) {
      throw new UnifiedStoreError('REVISION_CONFLICT', 'Render snapshot revision is stale', 409, { expectedRevision: envelope.expectedRevision, actualRevision: project.revision })
    }
    if (Object.keys(envelope.args).some((key) => !['frames', 'cameraNodeIds', 'width', 'height', 'outputDirectory', 'silhouette', 'bbsLook', 'viewportAspect'].includes(key)) ||
      silhouette !== undefined && typeof silhouette !== 'boolean' || bbsLook !== undefined && typeof bbsLook !== 'boolean' ||
      viewportAspect !== undefined && (typeof viewportAspect !== 'number' || !Number.isFinite(viewportAspect) || viewportAspect <= 0) ||
      !Array.isArray(frames) || !frames.length || frames.length > 9 || frames.some((frame) => !Number.isSafeInteger(frame) || frame < project.scene.content.timeline.frameStart || frame > project.scene.content.timeline.frameEnd) || new Set(frames).size !== frames.length ||
      !Array.isArray(cameraNodeIds) || !cameraNodeIds.length || cameraNodeIds.length > 3 || frames.length * cameraNodeIds.length > 9 ||
      new Set(cameraNodeIds).size !== cameraNodeIds.length || cameraNodeIds.some((cameraId) => typeof cameraId !== 'string' || !cameras.some((camera) => camera.id === cameraId)) ||
      !Number.isInteger(width) || Number(width) < 64 || Number(width) > 1024 || !Number.isInteger(height) || Number(height) < 64 || Number(height) > 1024 ||
      !isRecord(outputDirectory) || Object.keys(outputDirectory).some((key) => !['kind', 'id'].includes(key)) ||
      outputDirectory.kind !== 'client-directory' || typeof outputDirectory.id !== 'string' || !UUID.test(outputDirectory.id)) {
      throw new UnifiedStoreError('VALIDATION_FAILED', 'scene.render requires up to nine frame-camera samples and an approved client directory handle', 400)
    }
    let renderAspect: number, renderSize: FilmFrameDimensions
    try {
      renderAspect = resolveFilmFrameAspect(project.extensions, viewportAspect)
      renderSize = fitFilmFrameDimensions(width as number, height as number, renderAspect)
    } catch (error) {
      throw new UnifiedStoreError('VALIDATION_FAILED', error instanceof Error ? error.message : 'Film aspect does not fit render bounds', 400)
    }
    if (envelope.dryRun) return success(envelope.requestId, id, project.revision, { valid: true, sourceRevision: project.revision,
      sampleCount: frames.length * cameraNodeIds.length, viewportAspect: renderAspect, width: renderSize.width, height: renderSize.height,
      actualAspect: renderSize.aspect, aspectError: renderSize.aspectError })
    try {
      const job = await startUnifiedSceneRender(project, { frames: frames as number[], cameraNodeIds: cameraNodeIds as string[], width: renderSize.width, height: renderSize.height, ...(silhouette ? { silhouette: true } : {}), ...(bbsLook ? { bbsLook: true } : {}) })
      const response = success(envelope.requestId, id, project.revision, { jobId: job.jobId, sourceRevision: job.sourceRevision, state: job.state, progress: job.progress,
        viewportAspect: renderAspect, width: renderSize.width, height: renderSize.height, actualAspect: renderSize.aspect, aspectError: renderSize.aspectError })
      await saveRequest(envelope, hash, response)
      return response
    } catch (error) {
      const native = error as { code?: unknown; status?: unknown; message?: unknown }
      if (typeof native.code === 'string' && typeof native.status === 'number') throw new UnifiedStoreError(native.code, typeof native.message === 'string' ? native.message : 'Scene render job could not start', native.status)
      throw error
    }
  }
  if (envelope.command === 'scene.export.glb') {
    if (envelope.expectedRevision !== undefined && envelope.expectedRevision !== project.revision) throw new UnifiedStoreError('REVISION_CONFLICT', 'Scene export source revision changed', 409)
    try {
      const args = envelope.args as unknown as SceneGlbArgs
      validateSceneGlbArgs(project, args)
      if (envelope.dryRun) return success(envelope.requestId, id, project.revision, { valid: true, sourceRevision: project.revision })
      const built = await exportSceneGlb(project, args)
      const result = await storeSceneGlb(project, built)
      const response = success(envelope.requestId, id, project.revision, result)
      await saveRequest(envelope, hash, response)
      return response
    } catch (error) {
      throw new UnifiedStoreError('VALIDATION_FAILED', error instanceof Error ? error.message : 'Scene GLB export failed', 400)
    }
  }
  if (envelope.command === 'scene.export.blend-fbx') {
    if (envelope.expectedRevision !== undefined && envelope.expectedRevision !== project.revision) throw new UnifiedStoreError('REVISION_CONFLICT', 'Scene conversion source revision changed', 409)
    try {
      const args = envelope.args as unknown as SceneConversionArgs
      await validateSceneConversionArgs(project, args)
      if (envelope.dryRun) return success(envelope.requestId, id, project.revision, { valid: true, sourceRevision: project.revision })
      const job = await startUnifiedSceneConversion(project, args)
      const response = success(envelope.requestId, id, project.revision, { jobId: job.jobId, sourceRevision: job.sourceRevision, state: job.state, progress: job.progress })
      await saveRequest(envelope, hash, response)
      return response
    } catch(error) {
      const native = error as { code?: string; status?: number }
      throw new UnifiedStoreError(native.code ?? 'VALIDATION_FAILED', error instanceof Error ? error.message : 'Scene conversion could not start', native.status ?? 400)
    }
  }
  if (envelope.command === 'shot.export') {
    if (envelope.expectedRevision !== undefined && envelope.expectedRevision !== project.revision) throw new UnifiedStoreError('REVISION_CONFLICT', 'Shot source revision changed', 409)
    let built: Awaited<ReturnType<typeof createShotPackage>>
    try { built = await createShotPackage(project, envelope.args as unknown as ShotExportArgs) }
    catch (error) { throw new UnifiedStoreError('VALIDATION_FAILED', error instanceof Error ? error.message : 'Shot export failed', 400) }
    if (envelope.dryRun) return success(envelope.requestId, id, project.revision, { valid: true })
    await saveShotExport(project, built)
    const job = await storeShotArtifact(project, built.bytes, built.shot.shotId)
    const response = success(envelope.requestId, id, project.revision, { shotId: built.shot.shotId, baseShotSha256: createHash('sha256').update(built.files['shot.json']!).digest('hex'), jobId: job.jobId, state: job.state, sourceRevision: project.revision })
    await saveRequest(envelope, hash, response)
    return response
  }
  if (['film.export', 'scene.export.bbsFilm', 'scene.export.bbsFilmSeries'].includes(envelope.command)) {
    try { await validateFilmEffectsDestination(envelope.args.effectsPolicy) }
    catch (error) { throw new UnifiedStoreError('VALIDATION_FAILED', error instanceof Error ? error.message : 'Invalid effects destination', 400) }
  }
  if (envelope.command === 'film.export') {
    const { worldAnchor, content, characterIds, propIds, sequenceId, range, viewportAspect, filmName } = envelope.args
    if (envelope.expectedRevision !== undefined && envelope.expectedRevision !== project.revision) {
      throw new UnifiedStoreError('REVISION_CONFLICT', 'Film snapshot revision is stale', 409, { expectedRevision: envelope.expectedRevision, actualRevision: project.revision })
    }
    if (Object.keys(envelope.args).some((key) => !['effectsPolicy', 'worldAnchor', 'characterIds', 'sequenceId', 'range', 'viewportAspect', 'filmName', 'content', 'propIds'].includes(key)) ||
        content !== undefined && (typeof content !== 'string' || !['characters', 'backdrops', 'both'].includes(content)) ||
        propIds !== undefined && !Array.isArray(propIds) ||
        typeof filmName !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(filmName) || filmName.endsWith('.')) {
      throw new UnifiedStoreError('VALIDATION_FAILED', 'film.export requires a safe filmName and valid Film sampling arguments', 400)
    }
    let preflight: ReturnType<typeof preflightProjectFilm>, normalizedFilm: ReturnType<typeof resolveSceneBbsFilmArgs>['film'], effectiveAspect: number
    try {
      effectiveAspect = resolveFilmFrameAspect(project.extensions, viewportAspect)
      if (typeof sequenceId !== 'string' || !isRecord(range) || !Number.isSafeInteger(range.startFrame) || !Number.isSafeInteger(range.endFrame) ||
          content !== 'backdrops' && !Array.isArray(characterIds)) throw new TypeError('Film sampling arguments are invalid')
      const resolved = resolveSceneBbsFilmArgs(project, {
        ...(content === undefined ? {} : { content }),
        ...(worldAnchor === undefined ? {} : { worldAnchor }),
        sequenceId,
        frameStart: range.startFrame as number,
        frameEnd: range.endFrame as number,
        ...(characterIds === undefined ? {} : { characterIds: characterIds as string[] }),
        ...(propIds === undefined ? {} : { propIds: propIds as string[] }),
        viewportAspect: effectiveAspect,
        name: filmName,
        effectsPolicy: envelope.args.effectsPolicy,
      })
      normalizedFilm = resolved.film
      preflight = preflightProjectFilm(project, resolved.film)
    } catch (error) {
      throw new UnifiedStoreError('VALIDATION_FAILED', error instanceof Error ? error.message : 'Film sampling arguments are invalid', 400)
    }
    if (envelope.dryRun) return success(envelope.requestId, id, project.revision, { valid: true, sourceRevision: project.revision, sampleCount: preflight.durationTicks + 1,
      viewportAspect: effectiveAspect, content: preflight.content, characterIds: preflight.characterIds, propIds: preflight.propIds })
    try {
      const job = await startUnifiedFilmExport(project, { ...normalizedFilm, filmName })
      const response = success(envelope.requestId, id, project.revision, { jobId: job.jobId, sourceRevision: job.sourceRevision, state: job.state, progress: job.progress, viewportAspect: effectiveAspect })
      await saveRequest(envelope, hash, response)
      return response
    } catch (error) {
      const native = error as { code?: unknown; status?: unknown; message?: unknown }
      if (typeof native.code === 'string' && typeof native.status === 'number') throw new UnifiedStoreError(native.code, typeof native.message === 'string' ? native.message : 'Film export job could not start', native.status)
      throw error
    }
  }
  if (envelope.command === 'film.preflight') {
    try { await validateFilmEffectsDestination(envelope.args.effectsPolicy) }
    catch (error) { throw new UnifiedStoreError('VALIDATION_FAILED', error instanceof Error ? error.message : 'Invalid effects policy', 400) }
    if (Object.keys(envelope.args).some((key) => !['effectsPolicy', 'worldAnchor', 'mode', 'characterIds', 'sequenceId', 'range', 'viewportAspect', 'propIds', 'content'].includes(key)) ||
        envelope.args.mode !== undefined && envelope.args.mode !== 'film' && envelope.args.mode !== 'series' ||
        envelope.args.content !== undefined && (typeof envelope.args.content !== 'string' || !['characters', 'backdrops', 'both'].includes(envelope.args.content)) ||
        envelope.args.mode === 'series' && envelope.args.characterIds !== undefined && envelope.args.characterIds !== 'auto' && !isUniqueStringIdList(envelope.args.characterIds) ||
        envelope.args.mode === 'series' && envelope.args.propIds !== undefined && envelope.args.propIds !== 'auto' && envelope.args.propIds !== 'all' && !isUniqueStringIdList(envelope.args.propIds) ||
        envelope.args.mode !== 'series' && envelope.args.characterIds !== undefined && !Array.isArray(envelope.args.characterIds) ||
        envelope.args.mode !== 'series' && envelope.args.propIds !== undefined && !Array.isArray(envelope.args.propIds) ||
        Array.isArray(envelope.args.characterIds) && !isUniqueStringIdList(envelope.args.characterIds) ||
        Array.isArray(envelope.args.propIds) && !isUniqueStringIdList(envelope.args.propIds)) {
      throw new UnifiedStoreError('VALIDATION_FAILED', 'film.preflight accepts mode, characterIds, sequenceId, range, viewportAspect, propIds and content', 400)
    }
    if (envelope.expectedRevision !== undefined && envelope.expectedRevision !== project.revision) {
      throw new UnifiedStoreError('REVISION_CONFLICT', 'Film preflight source revision is stale', 409, { expectedRevision: envelope.expectedRevision, actualRevision: project.revision })
    }
    let effectiveAspect: number
    try { effectiveAspect = resolveFilmFrameAspect(project.extensions, envelope.args.viewportAspect) }
    catch (error) {
      const message = error instanceof Error ? error.message : 'Film aspect is invalid'
      const preflight = { errors: [{ code: 'INVALID_ARGUMENT', message: { vi: message, en: message } }], warnings: [] as FilmPreflightIssue[] }
      return success(envelope.requestId, id, project.revision, { valid: false, sourceRevision: project.revision, preflight })
    }
    if (envelope.args.mode === 'series') {
      const content = (envelope.args.content ?? (Array.isArray(envelope.args.propIds) && envelope.args.propIds.length ? 'both' : 'characters')) as 'characters' | 'backdrops' | 'both'
      const rawCharacters = envelope.args.characterIds ?? 'auto'
      const rawProps = envelope.args.propIds ?? (content === 'characters' ? [] : 'auto')
      if (content === 'backdrops' && Array.isArray(rawCharacters) && rawCharacters.length) {
        const preflight = { errors: [{ code: 'INVALID_ARGUMENT', message: { vi: 'Chế độ chỉ hậu cảnh không nhận nhân vật.', en: 'Backdrop-only mode cannot include Characters.' } }], warnings: [] as FilmPreflightIssue[] }
        return success(envelope.requestId, id, project.revision, { valid: false, sourceRevision: project.revision, viewportAspect: effectiveAspect, preflight })
      }
      let plan: Awaited<ReturnType<typeof planFilmSeriesWithCameraSamples>>
      try {
        const resolved = resolveSceneBbsFilmArgs(project, {
          content: 'characters', sequenceId: envelope.args.sequenceId, characterIds: [], propIds: [], worldAnchor: envelope.args.worldAnchor,
          viewportAspect: effectiveAspect,
          name: 'preflight-series',
          effectsPolicy: envelope.args.effectsPolicy,
        })
        plan = await planFilmSeriesWithCameraSamples(project, { ...resolved.film, content,
          characterIds: content === 'backdrops' ? [] : rawCharacters as string[] | 'auto',
          propIds: content === 'characters' ? [] : rawProps as string[] | 'all' | 'auto',
        }, { retainInvalidSingles: true })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Film series preflight arguments are invalid'
        const preflight = { errors: [{ code: 'FILM_SERIES_PLAN_INVALID', message: { vi: message, en: message } }], warnings: [] as FilmPreflightIssue[] }
        return success(envelope.requestId, id, project.revision, { valid: false, sourceRevision: project.revision, viewportAspect: effectiveAspect, preflight })
      }
      const evidence = new Map<number, { assetAvailability: Record<string, boolean>; propBoneCounts: Record<string, number>; footSamples: Record<string, Array<{ frame: number; leftY?: number; rightY?: number; airborne?: boolean; actorWorldMatrix?: number[] }>>; samplingBlockers: string[]; samplingError?: string }>()
      for (const segment of plan) {
        const segmentEvidence = await collectFilmPreflightEvidence(segment.project, segment.exportArgs)
        evidence.set(segment.order, segmentEvidence)
      }
      const preflight = filmSeriesPreflight(plan, evidence)
      return success(envelope.requestId, id, project.revision, { valid: preflight.errors.length === 0, sourceRevision: project.revision, viewportAspect: effectiveAspect, preflight,
        segments: plan.map((segment) => ({ segment: segment.order, range: segment.range, characterIds: segment.exportArgs.characterIds, propIds: segment.exportArgs.propIds })) })
    }
    const rawContent = envelope.args.content as string | undefined
    const content = rawContent ?? (Array.isArray(envelope.args.propIds) && envelope.args.propIds.length ? 'both' : 'characters')
    const rawCharacterIds = envelope.args.characterIds
    if (content === 'backdrops' && rawCharacterIds !== undefined && !Array.isArray(rawCharacterIds)) {
      const preflight = { errors: [{ code: 'INVALID_ARGUMENT', message: { vi: 'Danh sách nhân vật phải là một mảng.', en: 'Character selection must be an array.' } }], warnings: [] as FilmPreflightIssue[] }
      return success(envelope.requestId, id, project.revision, { valid: false, sourceRevision: project.revision, viewportAspect: effectiveAspect, preflight })
    }
    const args = { ...envelope.args,
      content,
      characterIds: content === 'backdrops' && rawCharacterIds === undefined ? [] : rawCharacterIds,
      propIds: content === 'characters' ? (envelope.args.propIds ?? []) : (envelope.args.propIds ?? project.scene.content.nodes.filter((node) => node.type === 'prop' && typeof node.metadata?.assetId === 'string').map((node) => node.id)),
      viewportAspect: effectiveAspect,
      effectsPolicy: resolveFilmEffectsPolicy(envelope.args.effectsPolicy),
    } as {
      effectsPolicy: ReturnType<typeof resolveFilmEffectsPolicy>; content: string; characterIds: string[]; sequenceId: string; range: { startFrame: number; endFrame: number }; viewportAspect: number; propIds?: string[]
    }
    if (content !== 'backdrops' && !Array.isArray(args.characterIds)) {
      const preflight = { errors: [{ code: 'INVALID_ARGUMENT', message: { vi: 'Cần chọn nhân vật hợp lệ.', en: 'Valid Character selection is required.' } }], warnings: [] as FilmPreflightIssue[] }
      return success(envelope.requestId, id, project.revision, { valid: false, sourceRevision: project.revision, viewportAspect: effectiveAspect, preflight })
    }
    const evidence = await collectFilmPreflightEvidence(project, args)
    const preflight = filmPreflight(project, { ...args, ...evidence })
    return success(envelope.requestId, id, project.revision, { valid: preflight.errors.length === 0, sourceRevision: project.revision, viewportAspect: effectiveAspect, preflight })
  }
  if (envelope.command === 'scene.export.bbsFilm') {
    if (envelope.expectedRevision !== undefined && envelope.expectedRevision !== project.revision) {
      throw new UnifiedStoreError('REVISION_CONFLICT', 'Film snapshot revision is stale', 409, { expectedRevision: envelope.expectedRevision, actualRevision: project.revision })
    }
    let resolved: ReturnType<typeof resolveSceneBbsFilmArgs>, preflight: ReturnType<typeof preflightProjectFilm>
    try {
      resolved = resolveSceneBbsFilmArgs(project, envelope.args)
      preflight = preflightProjectFilm(project, resolved.film)
    } catch (error) {
      throw new UnifiedStoreError('VALIDATION_FAILED', error instanceof Error ? error.message : 'Scene Film arguments are invalid', 400)
    }
    const plan = { sceneExport: resolved.sceneExport, archiveName: resolved.archiveName, durationTicks: preflight.durationTicks }
    if (envelope.dryRun) return success(envelope.requestId, id, project.revision, { valid: true, sourceRevision: project.revision, ...plan })
    try {
      const job = await startUnifiedFilmExport(project, resolved.film, { archiveName: resolved.archiveName, extraFiles: { 'scene-export.json': resolved.sceneExport } })
      const response = success(envelope.requestId, id, project.revision, { jobId: job.jobId, sourceRevision: job.sourceRevision, state: job.state, progress: job.progress, ...plan })
      await saveRequest(envelope, hash, response)
      return response
    } catch (error) {
      const native = error as { code?: unknown; status?: unknown; message?: unknown }
      if (typeof native.code === 'string' && typeof native.status === 'number') throw new UnifiedStoreError(native.code, typeof native.message === 'string' ? native.message : 'Film export job could not start', native.status)
      throw error
    }
  }
  if (envelope.command === 'scene.export.bbsFilmSeries') {
    if (envelope.expectedRevision !== undefined && envelope.expectedRevision !== project.revision) {
      throw new UnifiedStoreError('REVISION_CONFLICT', 'Film series snapshot revision is stale', 409, { expectedRevision: envelope.expectedRevision, actualRevision: project.revision })
    }
    const { content, ...sceneArgs } = envelope.args
    if (Object.keys(envelope.args).some((key) => !['effectsPolicy', 'worldAnchor', 'sequenceId', 'frameStart', 'frameEnd', 'characterIds', 'propIds', 'viewportAspect', 'name', 'mode', 'content'].includes(key))) {
      throw new UnifiedStoreError('VALIDATION_FAILED', 'scene.export.bbsFilmSeries accepts sequenceId, characterIds, viewportAspect, name and content', 400)
    }
    if (sceneArgs.characterIds !== undefined && sceneArgs.characterIds !== 'auto' && !isUniqueStringIdList(sceneArgs.characterIds) ||
        sceneArgs.propIds !== undefined && sceneArgs.propIds !== 'auto' && sceneArgs.propIds !== 'all' && !isUniqueStringIdList(sceneArgs.propIds)) {
      throw new UnifiedStoreError('VALIDATION_FAILED', 'Film series characterIds must be a unique ID array or "auto"; propIds must be a unique ID array, "all", or "auto"', 400)
    }
    if (content !== undefined && (typeof content !== 'string' || !['characters', 'backdrops', 'both'].includes(content))) throw new UnifiedStoreError('VALIDATION_FAILED', 'content must be characters, backdrops, or both', 400)
    if (sceneArgs.frameStart !== undefined || sceneArgs.frameEnd !== undefined) throw new UnifiedStoreError('VALIDATION_FAILED', 'Film series exports the complete editorial sequence; frameStart and frameEnd are not accepted', 400)
    let resolved: ReturnType<typeof resolveSceneBbsFilmArgs>, segments: Awaited<ReturnType<typeof planFilmSeriesWithCameraSamples>>
    try {
      const resolvedContent = (content ?? (Array.isArray(sceneArgs.propIds) && sceneArgs.propIds.length ? 'both' : 'characters')) as 'characters' | 'backdrops' | 'both'
      const rawCharacters = sceneArgs.characterIds ?? 'auto'
      const rawProps = sceneArgs.propIds ?? (resolvedContent === 'characters' ? [] : 'auto')
      resolved = resolveSceneBbsFilmArgs(project, { ...sceneArgs, content: 'characters', characterIds: [], propIds: [] })
      segments = await planFilmSeriesWithCameraSamples(project, { ...resolved.film, content: resolvedContent,
        characterIds: resolvedContent === 'backdrops' ? [] : rawCharacters as string[] | 'auto',
        propIds: resolvedContent === 'characters' ? [] : rawProps as string[] | 'all' | 'auto',
      })
    } catch (error) {
      throw new UnifiedStoreError('VALIDATION_FAILED', error instanceof Error ? error.message : 'Film series arguments are invalid', 400)
    }
    const blocked = segments.flatMap((segment) => segment.planningIssues.map((item) => `Segment ${segment.order}: ${item.message}`))
    if (blocked.length) throw new UnifiedStoreError('VALIDATION_FAILED', blocked.join('\n'), 422)
    if (resolved.film.filmName.length > 56) throw new UnifiedStoreError('VALIDATION_FAILED', 'Film series name must be at most 56 safe ASCII characters so numbered segment names fit', 400)
    const series = segments.map((segment) => ({ order: segment.order, film: `films/${resolved.film.filmName}-${String(segment.order).padStart(2, '0')}.dat`,
      shots: segment.shots.map((shot) => shot.id), startFrame: segment.range.startFrame, endFrame: segment.range.endFrame, ticks: segment.ticks }))
    const characterIds = [...new Set(segments.flatMap((segment) => segment.exportArgs.characterIds))]
    const propIds = [...new Set(segments.flatMap((segment) => segment.exportArgs.propIds ?? []))]
    if (envelope.dryRun) return success(envelope.requestId, id, project.revision, { valid: true, sourceRevision: project.revision, content: content ?? 'characters',
      characterIds, propIds, segmentCount: segments.length, series,
      segments: segments.map((segment) => ({ segment: segment.order, range: segment.range, characterIds: segment.exportArgs.characterIds, propIds: segment.exportArgs.propIds ?? [] })) })
    try {
      const job = await startUnifiedFilmSeriesExport(project, { name: resolved.film.filmName, segments })
      const response = success(envelope.requestId, id, project.revision, { jobId: job.jobId, sourceRevision: job.sourceRevision, state: job.state, progress: job.progress, segmentCount: segments.length, series })
      await saveRequest(envelope, hash, response)
      return response
    } catch (error) {
      const native = error as { code?: unknown; status?: unknown; message?: unknown }
      if (typeof native.code === 'string' && typeof native.status === 'number') throw new UnifiedStoreError(native.code, typeof native.message === 'string' ? native.message : 'Film series job could not start', native.status)
      throw error
    }
  }
  if (envelope.command === 'job.get') {
    const { jobId } = envelope.args
    if (Object.keys(envelope.args).some((key) => key !== 'jobId') || typeof jobId !== 'string' || !UUID.test(jobId)) throw new UnifiedStoreError('VALIDATION_FAILED', 'job.get requires a job UUID', 400)
    try {
      const job = await getUnifiedJob(jobId, id)
      const response = success(envelope.requestId, id, project.revision, { job })
      await saveRequest(envelope, hash, response)
      return response
    } catch (error) {
      const native = error as { code?: unknown; status?: unknown; message?: unknown }
      if (typeof native.code === 'string' && typeof native.status === 'number') throw new UnifiedStoreError(native.code, typeof native.message === 'string' ? native.message : 'Job lookup failed', native.status)
      throw error
    }
  }
  if (envelope.command === 'job.cancel') {
    const { jobId } = envelope.args
    if (Object.keys(envelope.args).some((key) => key !== 'jobId') || typeof jobId !== 'string' || !UUID.test(jobId)) throw new UnifiedStoreError('VALIDATION_FAILED', 'job.cancel requires a job UUID', 400)
    try {
      if (envelope.dryRun) {
        const job = await getUnifiedJob(jobId, id)
        return success(envelope.requestId, id, project.revision, { valid: true, state: job.state, committed: job.state === 'succeeded' && job.type !== 'rig.normalization.run' })
      }
      const result = await cancelUnifiedJob(jobId, id)
      const response = success(envelope.requestId, id, project.revision, result)
      await saveRequest(envelope, hash, response)
      return response
    } catch (error) {
      const native = error as { code?: unknown; status?: unknown; message?: unknown }
      if (typeof native.code === 'string' && typeof native.status === 'number') throw new UnifiedStoreError(native.code, typeof native.message === 'string' ? native.message : 'Job cancellation failed', native.status)
      throw error
    }
  }
  if (envelope.command === 'scene.review.get') {
    const { sequenceId, clipId } = envelope.args
    const sequence = typeof sequenceId === 'string' ? project.scene.content.editorial?.sequences.find((item) => item.id === sequenceId) : undefined
    if (Object.keys(envelope.args).some((key) => !['sequenceId', 'clipId'].includes(key)) || typeof sequenceId !== 'string' || !sequenceId.trim() ||
      !sequence || clipId !== undefined && (typeof clipId !== 'string' || !clipId.trim() || !sequence.clips.some((clip) => clip.id === clipId))) throw new UnifiedStoreError('VALIDATION_FAILED', 'scene.review.get requires an existing sequence and optional clip', 400)
    if (envelope.expectedRevision !== undefined && envelope.expectedRevision !== project.revision) throw new UnifiedStoreError('REVISION_CONFLICT', 'Scene review source revision is stale', 409)
    const frames = new Map(planReviewFrames(project, sequenceId).map((item) => [item.clipId, item.frames]))
    const response = success(envelope.requestId, id, project.revision, clipId === undefined
      ? { sequenceId, shots: sequence.clips.map((clip) => ({ clipId: clip.id, ...reviewStatusForSequence(project, sequenceId, clip.id), frames: frames.get(clip.id) ?? [] })) }
      : { sequenceId, clipId, ...reviewStatusForSequence(project, sequenceId, clipId), frames: frames.get(clipId) ?? [] })
    return response
  }
  if (envelope.command === 'scene.review.set') {
    const { sequenceId, clipId, status, note = '' } = envelope.args
    const sequence = typeof sequenceId === 'string' ? project.scene.content.editorial?.sequences.find((item) => item.id === sequenceId) : undefined
    if (Object.keys(envelope.args).some((key) => !['sequenceId', 'clipId', 'status', 'note'].includes(key)) || typeof sequenceId !== 'string' || !sequenceId.trim() ||
      typeof clipId !== 'string' || !clipId.trim() || !sequence?.clips.some((clip) => clip.id === clipId) ||
      !['pending', 'ok', 'note'].includes(String(status)) || typeof note !== 'string' || note.length > 2000) {
      throw new UnifiedStoreError('VALIDATION_FAILED', 'scene.review.set requires an existing sequence/clip, a valid status, and a note up to 2000 characters', 400)
    }
    if (!Number.isInteger(envelope.expectedRevision)) throw new UnifiedStoreError('VALIDATION_FAILED', 'scene.review.set requires expectedRevision', 400)
    if (envelope.expectedRevision !== project.revision) throw new UnifiedStoreError('REVISION_CONFLICT', 'Scene review source revision is stale', 409)
    if (envelope.dryRun) return success(envelope.requestId, id, project.revision, { valid: true, sequenceId, clipId, frames: planReviewFrames(project, sequenceId).find((item) => item.clipId === clipId)?.frames ?? [] })
  }
  let vfxCueChange: { type: 'add'; cue: VfxCue } | { type: 'update'; cue: VfxCue } | { type: 'remove'; id: string } | null = null
  if (envelope.command === 'vfx.cue.list') {
    const { frameStart, frameEnd } = envelope.args
    if (Object.keys(envelope.args).some((key) => !['frameStart', 'frameEnd'].includes(key)) ||
      (frameStart === undefined) !== (frameEnd === undefined) || frameStart !== undefined &&
      (!Number.isSafeInteger(frameStart) || !Number.isSafeInteger(frameEnd) || (frameStart as number) > (frameEnd as number))) {
      throw new UnifiedStoreError('VALIDATION_FAILED', 'vfx.cue.list accepts an optional inclusive frame range', 400)
    }
    if (envelope.expectedRevision !== undefined && envelope.expectedRevision !== project.revision) throw new UnifiedStoreError('REVISION_CONFLICT', 'VFX cue list source revision is stale', 409)
    const cues = readVfxCueExtension(project).cues.filter((cue) => frameStart === undefined || cue.frameStart <= (frameEnd as number) && cue.frameEnd >= (frameStart as number))
    return success(envelope.requestId, id, project.revision, { cues })
  }
  if (envelope.command === 'vfx.cue.add' || envelope.command === 'vfx.cue.update' || envelope.command === 'vfx.cue.remove') {
    let extension: ReturnType<typeof readVfxCueExtension>
    try { extension = readVfxCueExtension(project) }
    catch (error) { throw new UnifiedStoreError('VALIDATION_FAILED', error instanceof Error ? error.message : 'VFX cue extension is invalid', 400) }
    if (!Number.isInteger(envelope.expectedRevision)) throw new UnifiedStoreError('VALIDATION_FAILED', `${envelope.command} requires expectedRevision`, 400)
    if (envelope.expectedRevision !== project.revision) throw new UnifiedStoreError('REVISION_CONFLICT', 'VFX cue source revision is stale', 409, { expectedRevision: envelope.expectedRevision, actualRevision: project.revision })
    try {
      if (envelope.command === 'vfx.cue.add') {
        if (Object.keys(envelope.args).length !== 1 || !Object.hasOwn(envelope.args, 'cue')) throw new TypeError('vfx.cue.add accepts only cue')
        if (extension.cues.length >= 2048) throw new TypeError('A project can contain at most 2048 VFX cues')
        const cue = makeVfxCue(project, envelope.args.cue, randomUUID())
        if (extension.cues.some((item) => item.id === cue.id)) throw new TypeError('Generated VFX cue ID already exists')
        vfxCueChange = { type: 'add', cue }
      } else if (envelope.command === 'vfx.cue.update') {
        const { id: cueId, patch } = envelope.args
        if (Object.keys(envelope.args).some((key) => !['id', 'patch'].includes(key)) || typeof cueId !== 'string' || !cueId.trim()) throw new TypeError('vfx.cue.update requires a cue ID and patch')
        const current = extension.cues.find((cue) => cue.id === cueId)
        if (!current) throw new TypeError(`VFX cue not found: ${cueId}`)
        vfxCueChange = { type: 'update', cue: updateVfxCue(project, current, patch) }
      } else {
        const cueId = envelope.args.id
        if (Object.keys(envelope.args).length !== 1 || typeof cueId !== 'string' || !cueId.trim()) throw new TypeError('vfx.cue.remove requires a cue ID')
        if (!extension.cues.some((cue) => cue.id === cueId)) throw new TypeError(`VFX cue not found: ${cueId}`)
        vfxCueChange = { type: 'remove', id: cueId }
      }
    } catch (error) { throw new UnifiedStoreError('VALIDATION_FAILED', error instanceof Error ? error.message : 'Invalid VFX cue command', 400) }
    if (envelope.dryRun) return success(envelope.requestId, id, project.revision, { valid: true,
      ...(vfxCueChange.type === 'remove' ? { cueId: vfxCueChange.id, removed: true } : { cue: vfxCueChange.cue }) })
  }
  let audioCueChange: { type: 'add'; cue: AudioCue } | { type: 'update'; cue: AudioCue } | { type: 'remove'; id: string } | null = null
  if (envelope.command === 'audio.cue.list') {
    if (Object.keys(envelope.args).length) throw new UnifiedStoreError('VALIDATION_FAILED', 'audio.cue.list takes no arguments', 400)
    try { return success(envelope.requestId, id, project.revision, { cues: readAudioCueExtension(project).cues }) }
    catch (error) { throw new UnifiedStoreError('VALIDATION_FAILED', error instanceof Error ? error.message : 'Audio cue extension is invalid', 400) }
  }
  if (envelope.command === 'audio.cue.add' || envelope.command === 'audio.cue.update' || envelope.command === 'audio.cue.remove') {
    let extension: ReturnType<typeof readAudioCueExtension>
    try { extension = readAudioCueExtension(project) }
    catch (error) { throw new UnifiedStoreError('VALIDATION_FAILED', error instanceof Error ? error.message : 'Audio cue extension is invalid', 400) }
    if (!Number.isInteger(envelope.expectedRevision)) throw new UnifiedStoreError('VALIDATION_FAILED', `${envelope.command} requires expectedRevision`, 400)
    if (envelope.expectedRevision !== project.revision) throw new UnifiedStoreError('REVISION_CONFLICT', 'Audio cue source revision is stale', 409, { expectedRevision: envelope.expectedRevision, actualRevision: project.revision })
    try {
      if (envelope.command === 'audio.cue.add') {
        if (Object.keys(envelope.args).length !== 1 || !Object.hasOwn(envelope.args, 'cue')) throw new TypeError('audio.cue.add accepts only cue')
        if (extension.cues.length >= 4096) throw new TypeError('A project can contain at most 4096 audio cues')
        audioCueChange = { type: 'add', cue: makeAudioCue(project, envelope.args.cue, randomUUID()) }
      } else if (envelope.command === 'audio.cue.update') {
        const { id: cueId, patch } = envelope.args
        if (Object.keys(envelope.args).some((key) => !['id', 'patch'].includes(key)) || typeof cueId !== 'string') throw new TypeError('audio.cue.update requires a cue ID and patch')
        const current = extension.cues.find((cue) => cue.id === cueId)
        if (!current) throw new TypeError(`Audio cue not found: ${cueId}`)
        audioCueChange = { type: 'update', cue: updateAudioCue(project, current, patch) }
      } else {
        const cueId = envelope.args.id
        if (Object.keys(envelope.args).length !== 1 || typeof cueId !== 'string' || !extension.cues.some((cue) => cue.id === cueId)) throw new TypeError('audio.cue.remove requires an existing cue ID')
        audioCueChange = { type: 'remove', id: cueId }
      }
    } catch (error) { throw new UnifiedStoreError('VALIDATION_FAILED', error instanceof Error ? error.message : 'Invalid audio cue command', 400) }
    if (envelope.dryRun) return success(envelope.requestId, id, project.revision, { valid: true,
      ...(audioCueChange.type === 'remove' ? { cueId: audioCueChange.id, removed: true } : { cue: audioCueChange.cue }) })
  }
  if (!['film.anchor.location.set', 'film.frame.set', 'shot.result.import', 'scene.apply', 'camera.shot.set', 'scene.review.set', 'vfx.cue.add', 'vfx.cue.update', 'vfx.cue.remove', 'audio.cue.add', 'audio.cue.update', 'audio.cue.remove', 'camera.motion.add', 'camera.motion.remove', 'asset.import', 'library.place', 'library.link', 'asset.relink', 'character.add', 'prop.add', 'skeleton.mapping.set', 'retarget.session.set', 'motion.edit', 'motion.place', 'motion.binding.set', 'history.undo', 'history.redo'].includes(envelope.command)) throw new UnifiedStoreError('UNSUPPORTED_CAPABILITY', `Command not implemented in this phase: ${envelope.command}`, 422)
  if (envelope.command === 'shot.result.import') {
    if (!Number.isInteger(envelope.expectedRevision)) throw new UnifiedStoreError('VALIDATION_FAILED', 'Result import requires expectedRevision', 400)
    if (envelope.expectedRevision !== project.revision) throw new UnifiedStoreError('REVISION_CONFLICT', 'Result import revision changed', 409)
    try { shotResult = await prepareShotResult(project, envelope.args) }
    catch (error) { const native = error as { code?: string; message?: string }; throw new UnifiedStoreError(native.code === 'REVISION_CONFLICT' ? native.code : 'VALIDATION_FAILED', native.message ?? 'Invalid result package', native.code === 'REVISION_CONFLICT' ? 409 : 400) }
  }
  if (envelope.command === 'scene.apply') {
    if (Object.keys(envelope.args).some((key) => key !== 'operations')) throw new UnifiedStoreError('VALIDATION_FAILED', 'scene.apply accepts only operations', 400)
    sceneReplacement = applySceneOperations(project, envelope.args.operations)
  } else if (envelope.command === 'camera.motion.add' || envelope.command === 'camera.motion.remove') {
    try {
      cameraMotionChange = envelope.command === 'camera.motion.add'
        ? prepareCameraMotionAdd(project, envelope.args)
        : prepareCameraMotionRemove(project, envelope.args)
    } catch (error) {
      throw new UnifiedStoreError('VALIDATION_FAILED', error instanceof Error ? error.message : 'Invalid camera motion command', 400)
    }
  } else if (envelope.command === 'camera.shot.set') {
    const { sequenceId, clip } = envelope.args
    if (Object.keys(envelope.args).some((key) => !['sequenceId', 'clip'].includes(key)) || typeof sequenceId !== 'string' || !sequenceId.trim() ||
      !isRecord(clip) || Object.keys(clip).some((key) => !['id', 'cameraNodeId', 'sourceFrameStart', 'sourceFrameEnd'].includes(key)) ||
      typeof clip.id !== 'string' || !clip.id.trim() || typeof clip.cameraNodeId !== 'string' || !clip.cameraNodeId.trim() ||
      !Number.isInteger(clip.sourceFrameStart) || !Number.isInteger(clip.sourceFrameEnd)) throw new UnifiedStoreError('VALIDATION_FAILED', 'Expected a sequence ID and camera shot', 400)
    shotReplacement = { sequenceId, clip: clip as unknown as EditSequenceClip }
    applyCameraShot(project.scene, shotReplacement.sequenceId, shotReplacement.clip)
  } else if (envelope.command === 'asset.import') {
    if (envelope.args.assignmentJobId !== undefined) {
      const jobId = envelope.args.assignmentJobId, frameStart = envelope.args.frameStart
      if (Object.keys(envelope.args).some((key) => !['assignmentJobId', 'frameStart'].includes(key)) || typeof jobId !== 'string' || !UUID.test(jobId) ||
          frameStart !== undefined && (!Number.isSafeInteger(frameStart) || (frameStart as number) < 0)) throw new UnifiedStoreError('VALIDATION_FAILED', 'Assignment commit requires a job UUID and optional nonnegative frameStart', 400)
      const job = await getUnifiedJob(jobId, id)
      if (job.type !== 'animation.assignment.run' || job.state !== 'succeeded' || !job.result) throw new UnifiedStoreError('VALIDATION_FAILED', 'Select a successful Assignment job', 422)
      if (job.sourceRevision !== project.revision || envelope.expectedRevision !== project.revision || job.sourceSha256 !== createHash('sha256').update(JSON.stringify(project)).digest('hex')) throw new UnifiedStoreError('REVISION_CONFLICT', 'Assignment result is stale; create a new plan and run', 409)
      const provenance = job.result.provenance
      const sourceMotionId = provenance.sourceMotionId, characterId = provenance.receiverCharacterId
      const sourceMotion = typeof sourceMotionId === 'string' ? project.motions[sourceMotionId] : undefined
      const character = typeof characterId === 'string' ? project.characters[characterId] : undefined
      const receiver = character ? project.skeletons[character.skeletonId] : undefined
      const source = sourceMotion ? project.assets[sourceMotion.assetId] : undefined
      const sourceSha256 = sourceMotion?.evaluator === 'animation-1.31.8' ? sourceMotion.sourceClip.sha256 : source?.source.sha256
      if (!sourceMotion || !source || !character || !receiver || receiver.fingerprint !== provenance.receiverFingerprint ||
          sourceSha256 !== provenance.sourceSha256 || !project.scene.content.nodes.some((node) => node.id === character.nodeId)) {
        throw new UnifiedStoreError('REVISION_CONFLICT', 'Assignment source or receiver changed; create a new plan and run', 409)
      }
      if (project.scene.content.nodes.find((node) => node.id === character.nodeId)?.locked) throw new UnifiedStoreError('VALIDATION_FAILED', 'The target Character is locked', 400)
      const file = job.result.files.find((item) => item.name === 'assigned.glb' && item.mimeType === 'model/gltf-binary')
      const output = file ? await readUnifiedJobFile(jobId, id, file.id) : null
      if (!output) throw new UnifiedStoreError('ASSET_MISSING', 'Verified Assignment output is unavailable', 422)
      const upload: StagedAssetUpload = { id: randomUUID(), name: `assigned-${jobId}.glb`, bytes: output.bytes, byteLength: output.bytes.length, sha256: createHash('sha256').update(output.bytes).digest('hex') }
      let imported: ImportedAsset
      try { imported = buildImportedAsset(upload, 'glb') }
      catch (error) { throw new UnifiedStoreError('PROFILE_MISMATCH', error instanceof Error ? error.message : 'Assignment GLB could not be imported', 422) }
      if (!imported.skeleton || (!sameMixamo65Rest(imported.skeleton, receiver) && glbTargetFingerprint(output.bytes) !== receiver.fingerprint) || imported.motions.length !== 1) throw new UnifiedStoreError('PROFILE_MISMATCH', 'Assignment output rest skeleton does not match the receiver profile', 422)
      const reportFile = job.result.files.find((item) => item.name === 'report.json' && item.mimeType === 'application/json')
      const reportOutput = reportFile ? await readUnifiedJobFile(jobId, id, reportFile.id) : null
      if (!reportOutput) throw new UnifiedStoreError('ASSET_MISSING', 'Verified Assignment report is unavailable', 422)
      const reportHash = createHash('sha256').update(reportOutput.bytes).digest('hex')
      const reportRef = { path: `assignment/${reportHash}/report.json`, sha256: reportHash, mediaType: 'application/json', byteLength: reportOutput.bytes.length }
      imported.normalizationReport = { ref: reportRef, bytes: reportOutput.bytes }
      imported.asset.derivatives[`assignmentReport_${reportHash}`] = reportRef
      imported.skeleton = receiver
      imported.skeletonProfiles = [receiver]
      for (const item of imported.motions) item.motion.skeletonId = receiver.id
      imported.asset.provenance.legacyId = `assignment-job:${jobId}`
      imported.asset.dependencies = [sourceMotion.assetId]
      imported.motions[0]!.motion.derivedFrom = sourceMotion.id
      stagedAssetImports = [{ upload, imported }]
      assignmentPlacement = { characterId: character.id, frameStart: typeof frameStart === 'number' ? frameStart : null, jobId, provenance }
    } else if (envelope.args.normalizationJobId !== undefined) {
      const jobId = envelope.args.normalizationJobId
      if (Object.keys(envelope.args).some((key) => key !== 'normalizationJobId') || typeof jobId !== 'string' || !UUID.test(jobId)) throw new UnifiedStoreError('VALIDATION_FAILED', 'Normalization import requires only a job UUID', 400)
      const job = await getUnifiedJob(jobId, id)
      if (job.type !== 'rig.normalization.run' || job.state !== 'succeeded' || !job.result) throw new UnifiedStoreError('VALIDATION_FAILED', 'Select a successful normalization job', 422)
      if (job.sourceRevision !== project.revision || envelope.expectedRevision !== project.revision) throw new UnifiedStoreError('REVISION_CONFLICT', 'Normalization result is stale; create a new plan and run', 409)
      if (job.sourceSha256 !== createHash('sha256').update(JSON.stringify(project)).digest('hex')) throw new UnifiedStoreError('REVISION_CONFLICT', 'Normalization snapshot content changed; create a new plan and run', 409)
      const file = job.result.files.find((item) => item.mimeType === 'model/gltf-binary')
      const output = file ? await readUnifiedJobFile(jobId, id, file.id) : null
      if (!output) throw new UnifiedStoreError('ASSET_MISSING', 'Verified normalization output is unavailable', 422)
      const upload: StagedAssetUpload = { id: randomUUID(), name: `normalized-${jobId}.glb`, bytes: output.bytes, byteLength: output.bytes.length, sha256: createHash('sha256').update(output.bytes).digest('hex') }
      const imported = buildImportedAsset(upload, 'glb')
      const reportFile = job.result.files.find((item) => item.name === 'report.json' && item.mimeType === 'application/json')
      const reportOutput = reportFile ? await readUnifiedJobFile(jobId, id, reportFile.id) : null
      if (!reportOutput) throw new UnifiedStoreError('ASSET_MISSING', 'Verified normalization report is unavailable', 422)
      const reportHash = createHash('sha256').update(reportOutput.bytes).digest('hex')
      const reportRef = { path: `normalization/${reportHash}/report.json`, sha256: reportHash, mediaType: 'application/json', byteLength: reportOutput.bytes.length }
      imported.normalizationReport = { ref: reportRef, bytes: reportOutput.bytes }
      imported.asset.derivatives[`normalizationReport_${reportHash}`] = reportRef
      if (!imported.skeleton || imported.skeleton.family !== 'mixamo65' || imported.motions.length !== 1) throw new UnifiedStoreError('VALIDATION_FAILED', 'Normalization output is not one canonical Mixamo65 motion', 422)
      imported.asset.provenance.legacyId = `normalization-job:${jobId}`
      const sourceAssetId = job.result.provenance.sourceAssetId
      if (typeof sourceAssetId !== 'string' || !project.assets[sourceAssetId as keyof typeof project.assets]) throw new UnifiedStoreError('ASSET_MISSING', 'Normalization source asset is unavailable', 422)
      imported.asset.dependencies = [sourceAssetId as `sha256:${string}`]
      const actionIndex = (job.result.provenance as Record<string, unknown>).actionIndex
      const sourceMotion = Object.values(project.motions).find((motion) => motion.assetId === sourceAssetId &&
        (project.extensions.retargetMotionMetadata?.[motion.id] as { clipIndex?: number } | undefined)?.clipIndex === actionIndex)
      imported.motions[0]!.motion.derivedFrom = sourceMotion?.id ?? null
      stagedAssetImports = [{ upload, imported }]
    } else {
    const { files, format = 'auto' } = envelope.args
    if (Object.keys(envelope.args).some((key) => !['files', 'format', 'unitMeters', 'basis', 'skeletonProfileId', 'modelRebindReport', 'manifest'].includes(key)) ||
      !Array.isArray(files) || files.length < 1 || files.length > 32 || typeof format !== 'string' || !['auto', 'glb', 'gltf', 'fbx', 'bobj', 'mdx', 'mdl', 'league', 'png', 'jpg', 'dds', 'pose-json', 'wav', 'mp3', 'ogg'].includes(format)) {
      throw new UnifiedStoreError('VALIDATION_FAILED', 'asset.import expects 1–32 staged file handles and a supported format', 400)
    }
    if (envelope.args.unitMeters !== undefined && (typeof envelope.args.unitMeters !== 'number' || !Number.isFinite(envelope.args.unitMeters) || envelope.args.unitMeters <= 0) ||
      envelope.args.basis !== undefined && (!Array.isArray(envelope.args.basis) || envelope.args.basis.length !== 9 || envelope.args.basis.some((value) => typeof value !== 'number' || !Number.isFinite(value)))) {
      throw new UnifiedStoreError('VALIDATION_FAILED', 'Invalid asset unit or basis', 400)
    }
    const basisToScene = (envelope.args.basis ?? [1, 0, 0, 0, 1, 0, 0, 0, 1]) as number[]
    try { sceneBasisMatrix(basisToScene) } catch (error) { throw new UnifiedStoreError('VALIDATION_FAILED', error instanceof Error ? error.message : 'Invalid scene basis', 400) }
    const skeletonProfileId = envelope.args.skeletonProfileId
    if (skeletonProfileId !== undefined && (typeof skeletonProfileId !== 'string' || !project.skeletons[skeletonProfileId] || files.length !== 1 || !['auto', 'glb', 'gltf'].includes(format))) {
      throw new UnifiedStoreError('VALIDATION_FAILED', 'skeletonProfileId requires one GLB/glTF animation-only import and an existing target profile', 400)
    }
    try {
      stagedAssetImports = []
      let totalBytes = 0
      const uniqueHandles = new Set<string>()
      for (const file of files) {
        if (typeof file !== 'string' || uniqueHandles.has(file)) throw new TypeError('Upload handles must be unique strings')
        uniqueHandles.add(file)
        const upload = await readStagedAssetUpload(file)
        totalBytes += upload.byteLength
        if (totalBytes > 512 * 1024 * 1024) throw new RangeError('Combined import exceeds 512 MiB')
        stagedAssetImports.push({ upload, imported: buildImportedAsset(upload, format, typeof envelope.args.unitMeters === 'number' ? envelope.args.unitMeters : 1, basisToScene, typeof skeletonProfileId === 'string' ? project.skeletons[skeletonProfileId] : undefined) })
      }
    } catch (error) {
      throw new UnifiedStoreError('UNSUPPORTED_CAPABILITY', error instanceof Error ? error.message : 'Asset import failed', 422)
    }
    if (envelope.args.manifest !== undefined) {
      if (files.length !== 1 || !['auto', 'glb'].includes(format)) throw new UnifiedStoreError('VALIDATION_FAILED', 'App 1 manifest requires exactly one GLB', 400)
      const item = stagedAssetImports[0]!
      try { attachApp1Manifest(item.imported, item.upload.bytes, envelope.args.manifest) }
      catch (error) { throw new UnifiedStoreError('VALIDATION_FAILED', error instanceof Error ? error.message : 'App 1 manifest is invalid', 400) }
    }
    if (envelope.args.modelRebindReport !== undefined) {
      if (files.length !== 1 || !['auto', 'glb'].includes(format) || skeletonProfileId !== undefined) throw new UnifiedStoreError('VALIDATION_FAILED', 'A model rebind report requires one imported GLB and its embedded canonical skeleton', 400)
      const item = stagedAssetImports[0]
      if (!item) throw new UnifiedStoreError('VALIDATION_FAILED', 'Model rebind upload is missing', 400)
      attachModelRebindReport(envelope.args.modelRebindReport, project, item.upload, item.imported)
    }
    }
  } else if (envelope.command === 'library.place') {
    const { actionUuid, characterId, frameStart: requestedFrameStart } = envelope.args
    if (Object.keys(envelope.args).some((key) => !['actionUuid', 'characterId', 'frameStart'].includes(key)) || typeof actionUuid !== 'string' || !LIBRARY_ACTION_UUID.test(actionUuid) || typeof characterId !== 'string' || !UUID.test(characterId) ||
      requestedFrameStart !== undefined && (!Number.isSafeInteger(requestedFrameStart) || (requestedFrameStart as number) < 0)) {
      throw new UnifiedStoreError('VALIDATION_FAILED', 'library.place requires an Action UUID, Character UUID and an optional nonnegative frameStart', 400)
    }
    const character = project.characters[characterId]
    const targetProfile = character && project.skeletons[character.skeletonId]
    const node = character && project.scene.content.nodes.find((item) => item.id === character.nodeId)
    if (!character || !targetProfile || !node || node.locked) throw new UnifiedStoreError('NOT_FOUND', 'Target Character was not found or is locked', 404)
    try {
      const action = getAction({ actionUuid })
      const libraryCharacter = typeof node.metadata?.libraryCharacterId === 'string' ? resolveCharacter(node.metadata.libraryCharacterId) : null
      const nativeCharacter = libraryCharacter?.baseModel?.format === 'bobj' && ['verity', 'minecraft20'].includes(libraryCharacter.baseModel.rig) && action.ownerCharId === node.metadata?.libraryCharacterId && targetProfile.family === 'custom-preserved' ? String(node.metadata.libraryCharacterId) : null
      const libraryTopology = !!libraryCharacter && (libraryCharacter.baseModel?.rig ?? libraryCharacter.character.rig) === 'minecraft20' && action.rig === 'minecraft20'
      const rigMatches = !!nativeCharacter || libraryTopology || action.rig === targetProfile.family || action.rig.startsWith('mixamo65+') && targetProfile.family === 'mixamo65'
      if (!rigMatches) throw new UnifiedStoreError('PROFILE_MISMATCH', `Action rig ${action.rig} does not match Character rig ${targetProfile.family}`, 422)
      const bytes = nativeCharacter ? await libraryNativeAction(nativeCharacter, path.join(path.dirname(action.glbPath), libraryCharacter?.baseModel?.rig === 'minecraft20' ? 'anim.bobj' : 'anim.original.bbs.bobj')) : await readFile(action.glbPath)
      const sourceHash = createHash('sha256').update(bytes).digest('hex')
      let existing: typeof project.motions[string] | undefined = project.motions[action.uuid]
      if (existing) {
        const asset = project.assets[existing.assetId]
        if (!asset || asset.source.sha256 !== sourceHash || !project.skeletons[existing.skeletonId] || !sameRigTopology(project.skeletons[existing.skeletonId] as unknown as NonNullable<ImportedAsset['skeleton']>, targetProfile)) {
          // B19: a stale copy whose clips were all deleted (the library Action was edited since) must not block
          // re-assigning it; replace it. A copy still used by a clip keeps the conflict.
          if (project.scene.content.timeline.animation.motionClips.some((clip) => clip.motion.assetId === action.uuid)) {
            throw new UnifiedStoreError('ASSET_CONFLICT', 'The source Action UUID already belongs to different project content', 409)
          }
          delete project.motions[action.uuid]
          existing = undefined
        }
      }
      if (existing) {
        libraryPlacement = { characterId, motionId: existing.id, frameStart: typeof requestedFrameStart === 'number' ? requestedFrameStart : -1, name: action.name, duration: existing.durationSeconds, nativeValidated: !!nativeCharacter || libraryTopology }
        stagedAssetImports = []
      } else {
        const upload: StagedAssetUpload = { id: randomUUID(), name: `${action.packId}.glb`, bytes, byteLength: bytes.byteLength, sha256: sourceHash }
        let imported: ImportedAsset
        try {
          imported = buildImportedAsset(upload, 'glb')
          if (nativeCharacter) {
            if (imported.motions.length !== 1) throw new Error('Native Action clip is missing')
            imported.motions[0]!.motion.id = action.uuid
            imported.motions[0]!.name = action.name
          } else attachApp1Manifest(imported, bytes, JSON.parse(await readFile(action.manifestPath, 'utf8')))
        } catch (error) { throw new UnifiedStoreError('PROFILE_MISMATCH', error instanceof Error ? error.message : 'Library Action pack is invalid', 422) }
        if (!imported.skeleton || !sameRigTopology(imported.skeleton, targetProfile)) {
          throw new UnifiedStoreError('PROFILE_MISMATCH', 'Library Action does not use the selected Character rig and rest skeleton', 422)
        }
        const selected = imported.motions.find((item) => item.motion.id.toLowerCase() === action.uuid.toLowerCase())
        if (!selected) throw new UnifiedStoreError('ASSET_MISSING', 'Library Action clip is missing from its pack GLB', 422)
        imported.motions = [selected]
        stagedAssetImports = [{ upload, imported }]
        libraryPlacement = { characterId, motionId: selected.motion.id, frameStart: typeof requestedFrameStart === 'number' ? requestedFrameStart : -1, name: selected.name, duration: selected.motion.durationSeconds, nativeValidated: !!nativeCharacter || libraryTopology }
      }
    } catch (error) {
      if (error instanceof UnifiedStoreError) throw error
      throw new UnifiedStoreError('ASSET_MISSING', error instanceof Error ? error.message : 'Could not load Action from the library', 404)
    }
  } else if (envelope.command === 'library.link') {
    // C25: link storyboard nodes to a library character. The nodes keep their transform and
    // shot framing; only the model/profile binding, library metadata and display name change.
    // Clips whose name matches a Draft of the character are re-placed on the new skeleton;
    // every other clip is reported in the result instead of being silently dropped.
    const { nodeIds, libraryCharacterId } = envelope.args
    if (Object.keys(envelope.args).some((key) => !['nodeIds', 'libraryCharacterId'].includes(key)) ||
      !isUniqueStringIdList(nodeIds) || typeof libraryCharacterId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(libraryCharacterId)) {
      throw new UnifiedStoreError('VALIDATION_FAILED', 'library.link requires node IDs and a library Character ID', 400)
    }
    try {
      const resolved = resolveCharacter(libraryCharacterId)
      if (!resolved.baseModel) throw new UnifiedStoreError('ASSET_MISSING', 'Library character has no base model', 422)
      const modelBytes = await libraryBaseGlb(libraryCharacterId)
      const modelFingerprint = (await libraryCharacterModel(libraryCharacterId)).fingerprint
      const modelUpload: StagedAssetUpload = { id: randomUUID(), name: `${resolved.baseModel.modelId}.glb`, bytes: modelBytes, byteLength: modelBytes.byteLength, sha256: createHash('sha256').update(modelBytes).digest('hex') }
      const modelImported = buildImportedAsset(modelUpload, 'glb')
      if (!modelImported.skeleton) throw new UnifiedStoreError('PROFILE_MISMATCH', 'Library base model has no skeleton', 422)
      const targetProfile = modelImported.skeleton
      const libraryRoot = path.resolve(resolveLibraryPath())
      const librarySkin = await Promise.all(Object.entries(resolved.textures).sort(([a], [b]) => a.localeCompare(b)).map(async ([object, file]) => {
        const relative = path.relative(libraryRoot, path.resolve(file)).split(path.sep).join('/')
        if (!relative || relative.startsWith('..')) throw new Error('Library asset escaped its root')
        return { object, path: relative, sha256: createHash('sha256').update(await readFile(file)).digest('hex'), source: (relative.startsWith(`characters/${libraryCharacterId}/`) ? 'skin' : 'base') as 'skin' | 'base' }
      }))
      const normalizeName = (value: string) => value.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase()
      const actionByName = new Map<string, ReturnType<typeof listCharacterActions>[number]>()
      for (const action of listCharacterActions({ charId: libraryCharacterId, latestOnly: true })) {
        if (!actionByName.has(normalizeName(action.name))) actionByName.set(normalizeName(action.name), action)
        if (action.nameVi && !actionByName.has(normalizeName(action.nameVi))) actionByName.set(normalizeName(action.nameVi), action)
      }
      const actionImports = new Map<string, { upload: StagedAssetUpload; imported: ImportedAsset }>()
      const actionFailures = new Map<string, string>()
      const loadActionImport = async (action: ReturnType<typeof listCharacterActions>[number]) => {
        const cached = actionImports.get(action.uuid)
        if (cached) return cached
        const failed = actionFailures.get(action.uuid)
        if (failed) throw new Error(failed)
        try {
          // Same native/topology rules as library.place: the Action must play on the character's own rig.
          const located = getAction({ actionUuid: action.uuid })
          const nativeCharacter = resolved.baseModel!.format === 'bobj' && ['verity', 'minecraft20'].includes(resolved.baseModel!.rig) && action.ownerCharId === libraryCharacterId && targetProfile.family === 'custom-preserved' ? libraryCharacterId : null
          const libraryTopology = (resolved.baseModel!.rig ?? resolved.character.rig) === 'minecraft20' && action.rig === 'minecraft20'
          const rigMatches = !!nativeCharacter || libraryTopology || action.rig === targetProfile.family || action.rig.startsWith('mixamo65+') && targetProfile.family === 'mixamo65'
          if (!rigMatches) throw new Error(`Action rig ${action.rig} does not match Character rig ${targetProfile.family}`)
          const bytes = nativeCharacter ? await libraryNativeAction(nativeCharacter, path.join(path.dirname(located.glbPath), resolved.baseModel!.rig === 'minecraft20' ? 'anim.bobj' : 'anim.original.bbs.bobj')) : await readFile(located.glbPath)
          const upload: StagedAssetUpload = { id: randomUUID(), name: `${action.packId}.glb`, bytes, byteLength: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex') }
          const imported = buildImportedAsset(upload, 'glb')
          if (nativeCharacter) {
            if (imported.motions.length !== 1) throw new Error('Native Action clip is missing')
            imported.motions[0]!.motion.id = action.uuid
            imported.motions[0]!.name = action.name
          } else attachApp1Manifest(imported, bytes, JSON.parse(await readFile(located.manifestPath, 'utf8')))
          if (!imported.skeleton || !sameRigTopology(imported.skeleton, targetProfile)) throw new Error('Library Action does not use the selected Character rig and rest skeleton')
          const selected = imported.motions.find((item) => item.motion.id.toLowerCase() === action.uuid.toLowerCase())
          if (!selected) throw new Error('Library Action clip is missing from its pack GLB')
          imported.motions = [selected]
          const entry = { upload, imported }
          actionImports.set(action.uuid, entry)
          return entry
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error)
          actionFailures.set(action.uuid, reason)
          throw error
        }
      }
      const usedNames = new Set(project.scene.content.nodes.filter((node) => !nodeIds.includes(node.id)).map((node) => node.name))
      const linkNodes: LibraryLinkNodePlan[] = []
      for (const nodeId of nodeIds) {
        const node = project.scene.content.nodes.find((item) => item.id === nodeId)
        if (!node || node.type !== 'character') throw new UnifiedStoreError('NOT_FOUND', `Storyboard node was not found: ${nodeId}`, 404)
        if (node.locked) throw new UnifiedStoreError('VALIDATION_FAILED', `Node is locked: ${node.name}`, 400)
        const existingCharacter = Object.values(project.characters).find((character) => character.nodeId === nodeId)
        let displayName = libraryShotDisplayName(resolved.character.name, node.name)
        if (usedNames.has(displayName)) { let suffix = 2; while (usedNames.has(`${displayName} (${suffix})`)) suffix++; displayName = `${displayName} (${suffix})` }
        usedNames.add(displayName)
        const replacements: LibraryLinkNodePlan['replacements'] = []
        const unconverted: LibraryLinkNodePlan['unconverted'] = []
        for (const clip of project.scene.content.timeline.animation.motionClips.filter((item) => item.target.nodeId === nodeId)) {
          const metadata = project.extensions.retargetMotionMetadata?.[clip.motion.assetId] as { name?: string } | undefined
          const name = metadata?.name ?? clip.motion.name
          const action = actionByName.get(normalizeName(name))
          if (!action) {
            unconverted.push({ clipId: clip.id, name, reason: `Bộ của ${resolved.character.name} chưa có Nháp cùng tên “${name}”; clip được giữ nguyên và chưa chuyển sang xương mới.` })
            continue
          }
          try {
            await loadActionImport(action)
            replacements.push({ clipId: clip.id, actionUuid: action.uuid, name: action.name, frameStart: clip.frameStart, frameEnd: clip.frameEnd })
          } catch (error) {
            unconverted.push({ clipId: clip.id, name, reason: `Không tải được Nháp “${action.name}” lên xương của ${resolved.character.name}: ${error instanceof Error ? error.message : String(error)}` })
          }
        }
        linkNodes.push({ nodeId, characterId: existingCharacter?.id ?? null, displayName, replacements, unconverted })
      }
      // Linking replaces the model but preserves authored transforms. Profile height is opt-in.
      const measuredHeight = libraryHeightSnapshot(resolved.character, modelBytes).librarySourceHeightMeters
      libraryLink = {
        modelImported, actionImports,
        library: { libraryHeightBlocks: measuredHeight, librarySourceHeightMeters: measuredHeight, libraryHeightScale: 1, libraryCharacterId, libraryModelFingerprint: modelFingerprint, libraryBaseModelId: resolved.baseModel.modelId, librarySkin },
        nodes: linkNodes,
      }
      stagedAssetImports = [{ upload: modelUpload, imported: modelImported }, ...actionImports.values()]
    } catch (error) {
      if (error instanceof UnifiedStoreError) throw error
      throw new UnifiedStoreError('ASSET_MISSING', error instanceof Error ? error.message : 'Could not load the library character for linking', 422)
    }
  } else if (envelope.command === 'asset.relink') {
    const { assetId, file } = envelope.args
    if (Object.keys(envelope.args).some((key) => !['assetId', 'file'].includes(key)) || typeof assetId !== 'string' || typeof file !== 'string') {
      throw new UnifiedStoreError('VALIDATION_FAILED', 'asset.relink requires an asset ID and staged file handle', 400)
    }
    const asset = Object.hasOwn(project.assets, assetId) ? project.assets[assetId as keyof typeof project.assets] : undefined
    if (!asset) throw new UnifiedStoreError('ASSET_MISSING', 'Asset to relink does not exist', 422)
    try {
      const upload = await readStagedAssetUpload(file)
      if (upload.sha256 !== asset.source.sha256 || upload.byteLength !== asset.source.byteLength) {
        throw new UnifiedStoreError('ASSET_MISSING', 'Relinked file does not match the asset content hash', 422)
      }
      stagedAssetRelink = { upload, asset }
    } catch (error) {
      if (error instanceof UnifiedStoreError) throw error
      throw new UnifiedStoreError('ASSET_MISSING', error instanceof Error ? error.message : 'Staged relink file is unavailable', 422)
    }
  } else if (envelope.command === 'character.add') {
    const { assetId, skeletonId, name, transform, parentNodeId, library } = envelope.args
    if (Object.keys(envelope.args).some((key) => !['assetId', 'skeletonId', 'name', 'transform', 'parentNodeId', 'library'].includes(key)) ||
      typeof assetId !== 'string' || typeof skeletonId !== 'string' || typeof name !== 'string' || !name.trim() || name.length > 120 ||
      parentNodeId !== undefined && typeof parentNodeId !== 'string') throw new UnifiedStoreError('VALIDATION_FAILED', 'character.add requires a model asset, skeleton profile and name', 400)
    if (library !== undefined && (!isRecord(library) || typeof library.libraryCharacterId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(library.libraryCharacterId) ||
      typeof library.libraryModelFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(library.libraryModelFingerprint) ||
      typeof library.libraryBaseModelId !== 'string' || !/^[a-f0-9]{16}$/.test(library.libraryBaseModelId) ||
      ['libraryHeightBlocks', 'librarySourceHeightMeters', 'libraryHeightScale'].some((key) => library[key] !== undefined && (typeof library[key] !== 'number' || !Number.isFinite(library[key]) || Number(library[key]) <= 0)) ||
      !Array.isArray(library.librarySkin) || library.librarySkin.some((item) => !isRecord(item) || typeof item.object !== 'string' || typeof item.path !== 'string' ||
        !item.object || item.object.startsWith('/') || item.object.split('/').some((part) => !part || part === '.' || part === '..') ||
        !/^(characters|models)\/[A-Za-z0-9_-]+\/(?:[A-Za-z0-9_. -]+\/)*default\.png$/.test(item.path) ||
        !/^[a-f0-9]{64}$/.test(String(item.sha256)) || !['skin', 'base'].includes(String(item.source))) ||
      !Array.isArray(library.libraryHiddenObjects) || library.libraryHiddenObjects.some((item) => typeof item !== 'string') ||
      library.libraryDefaultAction !== undefined && (typeof library.libraryDefaultAction !== 'string' || !LIBRARY_ACTION_UUID.test(library.libraryDefaultAction)))) {
      throw new UnifiedStoreError('VALIDATION_FAILED', 'character.add library metadata is invalid', 400)
    }
    const model = project.assets[assetId as keyof typeof project.assets]
    if (!model || model.kind !== 'model') throw new UnifiedStoreError('ASSET_MISSING', 'Character model asset is missing', 422)
    if (!project.skeletons[skeletonId]) throw new UnifiedStoreError('PROFILE_MISMATCH', 'Character skeleton profile is missing', 422)
    const profile = project.skeletons[skeletonId]!
    const rigs = isRecord(project.extensions.assetSkeletonFingerprints) ? project.extensions.assetSkeletonFingerprints[assetId] : null
    const sharedRig = Array.isArray(rigs) && rigs.includes(profile.fingerprint)
    if (profile.provenance.original.sha256 !== model.source.sha256 && !sharedRig) throw new UnifiedStoreError('PROFILE_MISMATCH', 'Character profile must belong to the selected model asset', 422)
    if (transform !== undefined && !finiteSceneTransform(transform)) {
      throw new UnifiedStoreError('VALIDATION_FAILED', 'Character transform must contain finite position, rotation and scale XYZ values', 400)
    }
    const scene = structuredClone(project.scene)
    const node = buildCharacterNode(scene, {
      type: 'add-character', libraryId: assetId,
      modelUrl: library && isRecord(library) ? `/api/library?modelCharacter=${encodeURIComponent(String(library.libraryCharacterId))}&fingerprint=${String(library.libraryModelFingerprint)}` : `/api/unified/projects/${id}/assets/${encodeURIComponent(assetId)}/source`, name: name.trim(),
    })
    delete node.character?.animation.posePresetId
    node.transform = transform === undefined
      ? { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } }
      : structuredClone(transform) as unknown as typeof node.transform
    if (parentNodeId !== undefined) {
      const parent = scene.content.nodes.find((candidate) => candidate.id === parentNodeId && candidate.type === 'group')
      if (!parent) throw new UnifiedStoreError('VALIDATION_FAILED', 'Character parent must be an existing group node', 400)
      node.parentId = parent.id
      parent.children = [...new Set([...(parent.children ?? []), node.id])]
    }
    const characterId = randomUUID()
    node.metadata = { ...(isRecord(node.metadata) ? node.metadata : {}), characterId, rig: 'direct',
      modelFormat: model.source.mediaType === 'application/vnd.autodesk.fbx' ? 'fbx' : 'gltf',
      modelUnitMeters: profile.metersPerUnit, modelBasisToScene: profile.basisToScene, preserveMaterials: true,
      ...(library ? structuredClone(library) : {}) }
    scene.content.nodes.push(node)
    characterAddition = { characterId, scene, character: { id: characterId, assetId: assetId as `sha256:${string}`, nodeId: node.id, skeletonId, name: name.trim() } }
    const proposed = structuredClone(project)
    proposed.scene = scene
    proposed.characters[characterId] = characterAddition.character
    if (!validateDirectorDocument(scene)) throw new UnifiedStoreError('VALIDATION_FAILED', 'Character node does not satisfy the Topview scene contract', 400)
    if (!validateProject(proposed)) throw new UnifiedStoreError('VALIDATION_FAILED', 'Character references do not satisfy the shared project contract', 400)
  } else if (envelope.command === 'prop.add') {
    const { assetId, name, transform, parentNodeId } = envelope.args
    if (Object.keys(envelope.args).some((key) => !['assetId', 'name', 'transform', 'parentNodeId'].includes(key)) ||
      typeof assetId !== 'string' || typeof name !== 'string' || !name.trim() || name.length > 120 ||
      parentNodeId !== undefined && typeof parentNodeId !== 'string') throw new UnifiedStoreError('VALIDATION_FAILED', 'prop.add requires a model asset and name', 400)
    const model = Object.hasOwn(project.assets, assetId) ? project.assets[assetId as keyof typeof project.assets] : undefined
    if (!model || model.kind !== 'model') throw new UnifiedStoreError('ASSET_MISSING', 'Prop model asset is missing', 422)
    if (transform !== undefined && !finiteSceneTransform(transform)) {
      throw new UnifiedStoreError('VALIDATION_FAILED', 'Prop transform must contain finite position, rotation and scale XYZ values', 400)
    }
    const scene = structuredClone(project.scene)
    const node = buildPropNode(scene, {
      type: 'add-prop', libraryId: assetId, name: name.trim(),
      modelUrl: `/api/unified/projects/${id}/assets/${encodeURIComponent(assetId)}/source`,
    })
    const modelMetadata = project.extensions.assetImportModels
    const rawInfo = isRecord(modelMetadata) ? modelMetadata[assetId] : null
    const info = isRecord(rawInfo) ? rawInfo : null
    if (model.source.mediaType === 'application/vnd.autodesk.fbx' && (!info || typeof info.metersPerUnit !== 'number' || !Number.isFinite(info.metersPerUnit) || info.metersPerUnit <= 0)) throw new UnifiedStoreError('UNSUPPORTED_CAPABILITY', 'Reimport this FBX to record its model unit before placing it as a prop', 422)
    node.metadata = { ...(node.metadata ?? {}), modelFormat: model.source.mediaType === 'application/vnd.autodesk.fbx' ? 'fbx' : 'gltf', modelUnitMeters: info?.metersPerUnit ?? 1, modelBasisToScene: Array.isArray(info?.basisToScene) ? info.basisToScene : [1, 0, 0, 0, 1, 0, 0, 0, 1], preserveMaterials: true }
    node.transform = transform === undefined
      ? { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } }
      : structuredClone(transform) as unknown as typeof node.transform
    if (parentNodeId !== undefined) {
      const parent = scene.content.nodes.find((candidate) => candidate.id === parentNodeId && candidate.type === 'group')
      if (!parent) throw new UnifiedStoreError('VALIDATION_FAILED', 'Prop parent must be an existing group node', 400)
      node.parentId = parent.id
      parent.children = [...new Set([...(parent.children ?? []), node.id])]
    }
    scene.content.nodes.push(node)
    const proposed = structuredClone(project)
    proposed.scene = scene
    if (!validateDirectorDocument(scene) || !validateProject(proposed)) throw new UnifiedStoreError('VALIDATION_FAILED', 'Prop node does not satisfy the shared scene contract', 400)
    propAddition = { nodeId: node.id, assetId, scene }
  } else if (envelope.command === 'skeleton.mapping.set') {
    const { mapping, calibration, referencePose } = envelope.args
    const mappingKeys = ['id', 'sourceProfileId', 'targetProfileId', 'sourceFingerprint', 'targetFingerprint', 'pairs', 'ignored']
    if (Object.keys(envelope.args).some((key) => !['mapping', 'calibration', 'referencePose'].includes(key)) || !isRecord(mapping) ||
      Object.keys(mapping).some((key) => !mappingKeys.includes(key)) || mappingKeys.some((key) => !Object.hasOwn(mapping, key)) ||
      typeof mapping.id !== 'string' || !UUID.test(mapping.id) || typeof mapping.sourceProfileId !== 'string' || typeof mapping.targetProfileId !== 'string' ||
      typeof mapping.sourceFingerprint !== 'string' || typeof mapping.targetFingerprint !== 'string' || !Array.isArray(mapping.pairs) || !Array.isArray(mapping.ignored)) {
      throw new UnifiedStoreError('VALIDATION_FAILED', 'skeleton.mapping.set requires a mapping draft and calibration data', 400)
    }
    const source = project.skeletons[mapping.sourceProfileId]
    const target = project.skeletons[mapping.targetProfileId]
    if (!source || !target) throw new UnifiedStoreError('PROFILE_MISMATCH', 'Source or target skeleton profile is missing', 422)
    const pairs = mapping.pairs
    const ignored = mapping.ignored
    if (pairs.some((pair) => !isRecord(pair) || Object.keys(pair).some((key) => !['sourceBoneId', 'sourceBoneIds', 'sourceBoneWeights', 'chainComposition', 'targetBoneId', 'role', 'enabled'].includes(key)) ||
      typeof pair.sourceBoneId !== 'string' || pair.sourceBoneIds !== undefined && (!Array.isArray(pair.sourceBoneIds) || pair.sourceBoneIds.some((id) => typeof id !== 'string')) ||
      pair.sourceBoneWeights !== undefined && (!Array.isArray(pair.sourceBoneWeights) || pair.sourceBoneWeights.some((weight) => typeof weight !== 'number' || !Number.isFinite(weight))) ||
      typeof pair.targetBoneId !== 'string' || typeof pair.role !== 'string' || typeof pair.enabled !== 'boolean') ||
      ignored.some((item) => !isRecord(item) || Object.keys(item).some((key) => !['side', 'boneId', 'reason'].includes(key)) ||
        !['source', 'target'].includes(String(item.side)) || typeof item.boneId !== 'string' || typeof item.reason !== 'string' || !item.reason.trim() || item.reason.length > 240)) {
      throw new UnifiedStoreError('VALIDATION_FAILED', 'Mapping pairs and ignored-bone reasons are invalid', 400)
    }
    const report = validateSemanticMapping(source, target, pairs as SemanticBonePair[], {
      sourceFingerprint: mapping.sourceFingerprint, targetFingerprint: mapping.targetFingerprint,
    })
    if (report.errors.length) throw new UnifiedStoreError('PROFILE_MISMATCH', 'Mapping has stale fingerprints or invalid bone assignments', 422, { errors: report.errors })
    const usedSources = new Set(pairs.filter((pair) => pair.enabled).flatMap((pair) => pair.sourceBoneIds ?? [pair.sourceBoneId]))
    const usedTargets = new Set(pairs.filter((pair) => pair.enabled).map((pair) => pair.targetBoneId))
    const ignoredKeys = new Set<string>()
    for (const item of ignored as Array<{ side: 'source' | 'target'; boneId: string; reason: string }>) {
      const key = `${item.side}:${item.boneId}`
      const validBone = item.side === 'source' ? source.bones.some((bone) => bone.id === item.boneId) : target.bones.some((bone) => bone.id === item.boneId)
      const mapped = item.side === 'source' ? usedSources.has(item.boneId) : usedTargets.has(item.boneId)
      if (!validBone || mapped || ignoredKeys.has(key)) throw new UnifiedStoreError('VALIDATION_FAILED', 'Ignored bones must be unique, valid, and not mapped', 400)
      ignoredKeys.add(key)
    }
    if (report.unmappedSourceBoneIds.some((boneId) => !ignoredKeys.has(`source:${boneId}`)) ||
      report.unmappedTargetBoneIds.some((boneId) => !ignoredKeys.has(`target:${boneId}`))) {
      throw new UnifiedStoreError('VALIDATION_FAILED', 'Every unmapped bone needs an explicit ignored-bone reason', 400)
    }
    const legacyCalibration = isRetargetCalibrationV1(calibration, source.fingerprint, target.fingerprint)
    let persistedCalibration: RetargetCalibrationV1 | UniversalCalibrationV1
    let persistedReferencePose: UniversalReferencePoseV1 | null = null
    if (legacyCalibration) {
      if (referencePose !== undefined) throw new UnifiedStoreError('VALIDATION_FAILED', 'V9.12 calibration cannot include a Universal reference pose', 400)
      persistedCalibration = structuredClone(calibration)
    } else if (isUniversalCalibrationDraftV1(calibration, source.fingerprint, target.fingerprint)) {
      if (!isUniversalReferencePoseV1(referencePose, source.fingerprint, target.fingerprint,
        new Set(source.bones.map((bone) => bone.id)), new Set(target.bones.map((bone) => bone.id)))) {
        throw new UnifiedStoreError('VALIDATION_FAILED', 'Universal calibration requires a complete scene-meter reference pose for both selected profiles', 400)
      }
      if (calibration.corrections.some((item) => !target.bones.some((bone) => bone.id === item.targetBoneId))) {
        throw new UnifiedStoreError('VALIDATION_FAILED', 'Universal calibration corrections must reference existing target profile bones', 400)
      }
      const mappingDigest = sha256CanonicalJson({ sourceProfileId: source.id, targetProfileId: target.id,
        sourceFingerprint: source.fingerprint, targetFingerprint: target.fingerprint, pairs, ignored })
      persistedReferencePose = structuredClone(referencePose)
      persistedCalibration = sealUniversalCalibrationV1(structuredClone(calibration), {
        sourceHash: source.provenance.sourceHash,
        mappingDigest,
        referencePoseSha256: sha256CanonicalJson(persistedReferencePose),
      })
    } else {
      throw new UnifiedStoreError('VALIDATION_FAILED', 'Calibration must be valid V9.12 settings or a Universal v1 draft for these exact profiles', 400)
    }
    mappingAddition = {
      draft: {
        id: mapping.id, sourceProfileId: source.id, targetProfileId: target.id,
        sourceFingerprint: mapping.sourceFingerprint, targetFingerprint: mapping.targetFingerprint,
        pairs: structuredClone(pairs) as SemanticBonePair[], ignored: structuredClone(ignored) as SkeletonMapping['ignored'],
      },
      calibration: persistedCalibration, referencePose: persistedReferencePose, report,
    }
  } else if (envelope.command === 'retarget.session.set') {
    const { sessionId, sourceMotionId, targetCharacterId, mappingId, nativeProject } = envelope.args
    if (Object.keys(envelope.args).some((key) => !['sessionId', 'sourceMotionId', 'targetCharacterId', 'mappingId', 'nativeProject'].includes(key)) ||
      sessionId !== undefined && (typeof sessionId !== 'string' || !UUID.test(sessionId)) ||
      typeof sourceMotionId !== 'string' || !MOTION_UUID.test(sourceMotionId) || typeof targetCharacterId !== 'string' || !UUID.test(targetCharacterId) ||
      typeof mappingId !== 'string' || !UUID.test(mappingId) || !isRetargetProjectV99(nativeProject)) {
      throw new UnifiedStoreError('VALIDATION_FAILED', 'retarget.session.set requires valid IDs and a V9.12 project JSON', 400)
    }
    const motion = project.motions[sourceMotionId]
    const character = project.characters[targetCharacterId]
    const mapping = project.mappings[mappingId]
    if (!motion || !character || !mapping) throw new UnifiedStoreError('NOT_FOUND', 'Retarget source motion, target character, or skeleton mapping was not found', 404)
    const sourceProfile = project.skeletons[motion.skeletonId]
    const targetProfile = project.skeletons[character.skeletonId]
    if (mapping.sourceProfileId !== motion.skeletonId || mapping.targetProfileId !== character.skeletonId ||
      motion.evaluator !== 'retarget-9.12' || sourceProfile?.family !== 'mixamo65' || targetProfile?.family !== 'minecraft20' ||
      nativeProject.rig.source !== 'mixamo65' || nativeProject.rig.target !== 'bobj20') {
      throw new UnifiedStoreError('PROFILE_MISMATCH', 'This session requires a Mixamo65 source, Minecraft20 target, and matching saved mapping', 422)
    }
    // shortcut: the preview still uses the V9.12 armature; bind target-profile rest transforms before enabling bake.
    const metadataRoot = project.extensions.retargetMotionMetadata
    const metadata = isRecord(metadataRoot) ? metadataRoot[sourceMotionId] : null
    const fingerprint = isRecord(metadata) ? metadata.nativeFingerprint : null
    const sourceAsset = project.assets[motion.assetId]
    const expectedName = sourceAsset?.provenance.original.path.split('/').at(-1)
    if (!isRecord(fingerprint) || fingerprint.kind !== 'fbx' || nativeProject.source.kind !== 'fbx' ||
      fingerprint.name !== expectedName || nativeProject.source.name !== fingerprint.name || nativeProject.source.clip !== fingerprint.clip ||
      nativeProject.source.duration !== motion.durationSeconds || fingerprint.duration !== motion.durationSeconds ||
      nativeProject.source.tracks !== fingerprint.tracks || nativeProject.source.content !== fingerprint.content) {
      throw new UnifiedStoreError('PROFILE_MISMATCH', 'The V9.12 project source fingerprint does not match this imported motion; reimport the original FBX', 422)
    }
    const sourceNames = new Set(sourceProfile.bones.map((bone) => bone.name))
    const context = nativeProject.state.context as Record<string, unknown>
    if (Object.values(context.mapping as Record<string, unknown>).some((name) => name !== 'none' && (typeof name !== 'string' || !sourceNames.has(name))) ||
      Object.keys(context.sourcePose as Record<string, unknown>).some((name) => !sourceNames.has(name))) {
      throw new UnifiedStoreError('PROFILE_MISMATCH', 'The native V9.12 source-bone names do not match the selected Mixamo profile', 422)
    }
    const id = typeof sessionId === 'string' ? sessionId : randomUUID()
    const existing = project.retargetSessions[id]
    retargetSessionAddition = {
      session: { id, sourceMotionId, targetCharacterId, mappingId, nativeProject: { path: '', sha256: '', mediaType: 'application/json', byteLength: 0 }, generatedMotionId: existing?.generatedMotionId ?? null },
      nativeProject: structuredClone(nativeProject),
    }
  } else if (envelope.command === 'motion.edit') {
    const { characterId, motionId, clipId, edit, derivativeBase64 } = envelope.args
    const allowed = ['characterId', 'motionId', 'clipId', 'edit', 'derivativeBase64']
    if (Object.keys(envelope.args).some((key) => !allowed.includes(key)) || typeof characterId !== 'string' || !UUID.test(characterId) ||
      motionId !== undefined && (typeof motionId !== 'string' || !MOTION_UUID.test(motionId)) || clipId !== undefined && (typeof clipId !== 'string' || !clipId.trim()) ||
      !isRecord(edit) || !validateJsonPayload(edit, 32 * 1024 * 1024) || typeof derivativeBase64 !== 'string' || derivativeBase64.length > 96 * 1024 * 1024) {
      throw new UnifiedStoreError('VALIDATION_FAILED', 'motion.edit requires a Character, native project JSON and a base64 GLB derivative', 400)
    }
    const character = project.characters[characterId]
    const profile = character && project.skeletons[character.skeletonId]
    const node = character && project.scene.content.nodes.find((item) => item.id === character.nodeId)
    if (!character || !profile || !node || node.locked) throw new UnifiedStoreError('NOT_FOUND', 'Editable Character was not found or is locked', 404)
    const sourceMotion = typeof motionId === 'string' ? project.motions[motionId] : null
    if (motionId && (!sourceMotion || sourceMotion.skeletonId !== profile.id)) throw new UnifiedStoreError('PROFILE_MISMATCH', 'Source Motion does not use this Character skeleton', 422)
    const nativeRig = isRecord(edit.rig) ? edit.rig : null
    const nativeFps = edit.fps
    const duration = edit.duration
    const name = typeof edit.name === 'string' ? edit.name.trim().slice(0, 120) : ''
    if (edit.type !== 'animation-studio' || edit.version !== 1 || !nativeRig || typeof nativeRig.name !== 'string' ||
      typeof nativeRig.fingerprint !== 'string' || typeof nativeRig.profile !== 'string' || !isRecord(edit.keys) ||
      typeof nativeFps !== 'number' || !Number.isFinite(nativeFps) || nativeFps < 1 || nativeFps > 240 || typeof duration !== 'number' || !Number.isFinite(duration) || duration <= 0 || duration > 600 || !name) {
      throw new UnifiedStoreError('VALIDATION_FAILED', 'Native Animation Studio project has an unsupported shape, duration, FPS or name', 400)
    }
    let glbBytes: Buffer
    let parsedAsset: ImportedAsset
    try {
      // shortcut: trust the local native editor's bake after validating its rig/tracks; replace with a server-side native baker before accepting remote/untrusted writers.
      glbBytes = Buffer.from(derivativeBase64, 'base64')
      if (!glbBytes.byteLength || glbBytes.byteLength > 64 * 1024 * 1024 || glbBytes.toString('base64') !== derivativeBase64) throw new TypeError('GLB derivative must be a valid base64 payload up to 64 MiB')
      glbBytes = normalizeAnimationGlbBoneNames(glbBytes, profile.bones.map((bone) => bone.name))
      const upload: StagedAssetUpload = { id: randomUUID(), name: `${name}.glb`, sha256: createHash('sha256').update(glbBytes).digest('hex'), byteLength: glbBytes.byteLength, bytes: glbBytes }
      parsedAsset = buildImportedAsset(upload, 'glb')
      if (!parsedAsset.skeleton) throw new TypeError('Baked GLB has no skin matching the selected Character')
      const profileNames = new Set(profile.bones.map((item) => item.name))
      const extraSkinBone = parsedAsset.skeleton.bones.find((bone) => bone.deform && !profileNames.has(bone.name))
      if (extraSkinBone) throw new TypeError(`Baked GLB contains an extra skin bone ${extraSkinBone.name}`)
      for (const bone of profile.bones) {
          const candidate = parsedAsset.skeleton!.bones.find((item) => item.name === bone.name)
          let candidateParentId = candidate?.parentId
          let candidateParent = candidateParentId ? parsedAsset.skeleton!.bones.find((item) => item.id === candidateParentId)?.name ?? null : null
          while (candidateParent && !profileNames.has(candidateParent)) {
            candidateParentId = parsedAsset.skeleton!.bones.find((item) => item.name === candidateParent)?.parentId
            candidateParent = candidateParentId ? parsedAsset.skeleton!.bones.find((item) => item.id === candidateParentId)?.name ?? null : null
          }
          const parentName = bone.parentId ? profile.bones.find((item) => item.id === bone.parentId)?.name : null
          const rest = isRecord(bone.rest) ? bone.rest : null
          const candidateRest = candidate && isRecord(candidate.rest) ? candidate.rest : null
          const vector = (value: unknown, key: string) => isRecord(value) && Array.isArray(value[key]) ? value[key] as unknown[] : null
          const position = rest && vector(rest, 'position'), candidatePosition = candidateRest && vector(candidateRest, 'position')
          const rotation = rest && vector(rest, 'rotation'), candidateRotation = candidateRest && vector(candidateRest, 'rotation')
          const scale = rest && vector(rest, 'scale'), candidateScale = candidateRest && vector(candidateRest, 'scale')
          if (!candidate) throw new TypeError(`Baked GLB is missing Character bone ${bone.name}; found ${parsedAsset.skeleton!.bones.slice(0, 8).map((item) => item.name).join(', ')}`)
          if (candidateParent !== parentName) throw new TypeError(`Baked GLB parent mismatch at ${bone.name}: expected ${parentName ?? 'root'}, got ${candidateParent ?? 'root'}`)
          if (!position || !candidatePosition || !rotation || !candidateRotation || !scale || !candidateScale ||
            position.length !== 3 || candidatePosition.length !== 3 || rotation.length !== 4 || candidateRotation.length !== 4 || scale.length !== 3 || candidateScale.length !== 3) throw new TypeError(`Baked GLB has invalid rest transforms at ${bone.name}`)
          if ([...position, ...candidatePosition, ...rotation, ...candidateRotation, ...scale, ...candidateScale].some((value) => typeof value !== 'number' || !Number.isFinite(value))) throw new TypeError(`Baked GLB has non-finite rest transforms at ${bone.name}`)
          const pointError = Math.hypot(...position.map((value, index) => (value as number) - (candidatePosition[index] as number)))
          const scaleError = Math.max(...scale.map((value, index) => Math.abs((value as number) - (candidateScale[index] as number))))
          const quaternionDot = Math.abs(rotation.reduce<number>((sum, value, index) => sum + (value as number) * (candidateRotation[index] as number), 0))
          if (pointError > 1e-4 || scaleError > 1e-4 || quaternionDot < 0.999999) throw new TypeError(`Baked GLB rest transform differs at ${bone.name}`)
      }
      const animationClipCount = glbAnimationCount(glbBytes)
      if (animationClipCount !== 1) throw new TypeError('Native animation bake must contain exactly one clip')
      const animatedBones = glbAnimationBoneNames(glbBytes)
      // shortcut: allow the native export's AuxScene wrapper track; validate its node structure before accepting non-local GLB writers.
      if (!animatedBones.length || animatedBones.some((name) => name !== 'AuxScene' && !profile.bones.some((bone) => bone.name === name))) throw new TypeError('Baked GLB animation targets bones outside the selected Character skeleton')
    } catch (error) {
      throw new UnifiedStoreError('PROFILE_MISMATCH', error instanceof Error ? error.message : 'Native animation derivative is invalid', 422)
    }
    const clipBinding = typeof clipId === 'string' ? project.bindings[clipId] : null
    if (clipId && (!clipBinding || clipBinding.characterId !== characterId || clipBinding.motionId !== motionId)) throw new UnifiedStoreError('REVISION_CONFLICT', 'Selected clip or source Motion changed; reload before saving', 409)
    if (clipBinding && clipBinding.sourceStartSeconds + clipBinding.sourceLengthSeconds > duration + 1e-6) throw new UnifiedStoreError('VALIDATION_FAILED', 'Edited animation is shorter than the selected clip source range', 400)
    nativeAnimationAddition = { characterId, sourceMotionId: typeof motionId === 'string' ? motionId : null, clipId: typeof clipId === 'string' ? clipId : null, name, fps: nativeFps as number, duration: duration as number, edit: structuredClone(edit), glbBytes, motionId: randomUUID(), skeletonId: profile.id }
  } else if (envelope.command === 'motion.place' || envelope.command === 'motion.binding.set') {
    const edit = envelope.command === 'motion.binding.set' ? prepareMotionBindingEdit(project, envelope.args) : null
    const args = edit?.args ?? envelope.args
    const { motionId, characterId, frameStart = 0, sourceStartSeconds = 0, sourceLengthSeconds, speed = 1, loop = false, reverse = false } = args
    if (Object.keys(args).some((key) => !['motionId', 'characterId', 'frameStart', 'sourceStartSeconds', 'sourceLengthSeconds', 'speed', 'loop', 'reverse'].includes(key)) ||
      typeof motionId !== 'string' || !MOTION_UUID.test(motionId) || typeof characterId !== 'string' || !UUID.test(characterId) ||
      !Number.isSafeInteger(frameStart) || (frameStart as number) < 0 ||
      typeof sourceStartSeconds !== 'number' || !Number.isFinite(sourceStartSeconds) || sourceStartSeconds < 0 ||
      sourceLengthSeconds !== undefined && (typeof sourceLengthSeconds !== 'number' || !Number.isFinite(sourceLengthSeconds) || sourceLengthSeconds <= 0) ||
      typeof speed !== 'number' || !Number.isFinite(speed) || speed < 0.01 || speed > 16 || typeof loop !== 'boolean' || typeof reverse !== 'boolean') {
      throw new UnifiedStoreError('VALIDATION_FAILED', 'motion.place requires Motion and Character IDs, a valid source range, speed from 0.01 to 16, and boolean loop/reverse values', 400)
    }
    const motion = project.motions[motionId]
    const character = project.characters[characterId]
    if (!motion || !character) throw new UnifiedStoreError('NOT_FOUND', 'Motion or Character was not found', 404)
    if (project.scene.content.nodes.find((node) => node.id === character.nodeId)?.locked) throw new UnifiedStoreError('VALIDATION_FAILED', 'The target Character is locked', 400)
    // shortcut: FBX clips require an identical rig; enable different rigs after V9.12 bake parity is verified.
    const sourceProfile = project.skeletons[motion.skeletonId]
    const targetProfile = project.skeletons[character.skeletonId]
    if (!sourceProfile || !targetProfile || (sourceProfile.fingerprint !== targetProfile.fingerprint && !(isMixamo65Topology(sourceProfile.bones) && isMixamo65Topology(targetProfile.bones))) || sourceProfile.metersPerUnit !== targetProfile.metersPerUnit) {
      throw new UnifiedStoreError('PROFILE_MISMATCH', 'Timeline placement requires the same skeleton fingerprint and unit; retarget first for a different rig', 422)
    }
    const asset = project.assets[motion.assetId]
    const nativeMotion = motion.evaluator === 'animation-1.31.8' && motion.edit !== null
    const metadataRoot = project.extensions.retargetMotionMetadata
    const metadata = isRecord(metadataRoot) ? metadataRoot[motionId] : null
    const gltfMotion = asset?.source.mediaType === 'model/gltf-binary' || asset?.source.mediaType === 'model/gltf+json'
    if (!asset || !['model', 'motion'].includes(asset.kind) || (!nativeMotion && (!['application/vnd.autodesk.fbx', 'model/gltf-binary', 'model/gltf+json'].includes(asset.source.mediaType) || !isRecord(metadata) ||
      !Number.isSafeInteger(metadata.clipIndex) || (metadata.clipIndex as number) < 0 || typeof metadata.name !== 'string' || !metadata.name.trim() ||
      gltfMotion && (!Array.isArray(metadata.boneNames) || metadata.boneNames.some((name) => typeof name !== 'string' || !targetProfile?.bones.some((bone) => canonicalJointName(bone.name) === canonicalJointName(name))))))) {
      throw new UnifiedStoreError('UNSUPPORTED_CAPABILITY', 'Motion has no supported FBX/glTF clip or its channels do not match the selected Character profile', 422)
    }
    const scene = structuredClone(project.scene)
    const sourceLength = sourceLengthSeconds === undefined ? motion.durationSeconds - sourceStartSeconds : sourceLengthSeconds as number
    if (sourceStartSeconds >= motion.durationSeconds || sourceStartSeconds + sourceLength > motion.durationSeconds + 1e-6) {
      throw new UnifiedStoreError('VALIDATION_FAILED', 'Motion source range must stay inside the imported clip duration', 400)
    }
    const durationFrames = Math.max(1, Math.round((sourceLength / (speed as number)) * scene.content.timeline.fps))
    if (!Number.isSafeInteger(durationFrames) || !Number.isSafeInteger((frameStart as number) + durationFrames)) {
      throw new UnifiedStoreError('VALIDATION_FAILED', 'motion.place duration exceeds the supported timeline range', 400)
    }
    const motionName = nativeMotion ? asset.displayName : (metadata as Record<string, unknown>).name as string
    const clipIndex = nativeMotion ? 0 : (metadata as Record<string, unknown>).clipIndex as number
    // The browser MotionPlayer picks GLTFLoader only for `format=glb` URLs; App 1 GLB Motions need it too, not just native edits.
    const glbSource = nativeMotion || asset.source.mediaType === 'model/gltf-binary'
    const url = `/api/unified/projects/${id}/assets/${encodeURIComponent(asset.id)}/source${glbSource ? '?format=glb' : ''}`
    const clip = edit ? scene.content.timeline.animation.motionClips.find((item) => item.id === edit.binding.clipId)! : appendMotionClip(scene, {
      type: 'add-motion', libraryId: motion.id, name: motionName, fbxKey: url,
      targetNodeId: character.nodeId, frameStart: frameStart as number, durationSeconds: sourceLength / (speed as number),
    })
    if (edit) {
      clip.frameStart = frameStart as number
      clip.target.nodeId = character.nodeId
      clip.motion.assetId = motion.id
      clip.motion.url = url
      clip.motion.name = motionName
    }
    // One App 1 GLB carries many Actions under one URL; each Motion still needs its own entry (renderers look it up by id),
    // while the builder's add-motion intent skips an entry whose path is already listed.
    if (!scene.content.asset.motionPath.some((entry) => entry.id === motion.id)) scene.content.asset.motionPath.push({ id: motion.id, path: url })
    clip.sourceDuration = motion.durationSeconds
    clip.frameEnd = edit?.frameEnd ?? clip.frameStart + durationFrames - 1
    if (edit && scene.content.timeline.animation.motionClips.some((other) => other.id !== clip.id && other.target.nodeId === clip.target.nodeId && other.frameStart <= clip.frameEnd && other.frameEnd >= clip.frameStart)) {
      throw new UnifiedStoreError('VALIDATION_FAILED', 'Edited motion clip overlaps another clip on this Character', 400)
    }
    clip.playback.speed = speed as number
    clip.playback.loop = loop
    clip.motion.speed = speed as number
    clip.motion.loop = loop
    clip.motion.time = sourceStartSeconds
    clip.motion.sourceLengthSeconds = sourceLength
    clip.motion.reverse = reverse
    clip.motion.clipIndex = clipIndex
    clip.motion.sourceRig = sourceProfile.family
    const binding: MotionBinding = edit?.binding ?? {
      clipId: clip.id, characterId, motionId, sourceStartSeconds, sourceLengthSeconds: sourceLength,
      reverse, fadeInSeconds: 0, fadeOutSeconds: 0, rootPolicy: 'skeletal', alignment: 'continue',
    }
    const rootBone = targetProfile.bones.find((bone) => bone.id === targetProfile.rootBoneId)!
    if (binding.rootPolicy !== 'skeletal' && scene.content.nodes.find((node) => node.id === character.nodeId)?.metadata?.rig !== 'direct') {
      throw new UnifiedStoreError('UNSUPPORTED_CAPABILITY', 'Root extraction currently requires an imported direct rig', 422)
    }
    clip.motion.rootMotion = { policy: binding.rootPolicy, boneName: rootBone.name, alignment: binding.alignment }
    clip.motion.inPlace = binding.rootPolicy === 'in-place'
    motionPlacement = { scene, binding, clipId: clip.id }
  } else if ((envelope.command === 'history.undo' || envelope.command === 'history.redo') && Object.keys(envelope.args).length !== 0) throw new UnifiedStoreError('VALIDATION_FAILED', 'History commands do not accept arguments', 400)
  const rootConflict = findRootMotionConflict(sceneReplacement?.document ?? motionPlacement?.scene ?? project.scene)
  if (rootConflict) throw new UnifiedStoreError('ROOT_MOTION_CONFLICT', 'Trajectory and path contain the same root-motion source', 422, rootConflict)
  if (envelope.dryRun) {
    const index = await historyIndex(project, false)
    const valid = envelope.command === 'film.anchor.location.set' || envelope.command === 'film.frame.set' || envelope.command === 'shot.result.import' || envelope.command === 'scene.apply' || envelope.command === 'camera.shot.set' || envelope.command === 'scene.review.set' || envelope.command === 'vfx.cue.add' || envelope.command === 'vfx.cue.update' || envelope.command === 'vfx.cue.remove' || envelope.command === 'audio.cue.add' || envelope.command === 'audio.cue.update' || envelope.command === 'audio.cue.remove' || envelope.command === 'camera.motion.add' || envelope.command === 'camera.motion.remove' || envelope.command === 'asset.import' || envelope.command === 'library.place' || envelope.command === 'library.link' || envelope.command === 'asset.relink' || envelope.command === 'character.add' || envelope.command === 'prop.add' || envelope.command === 'skeleton.mapping.set' || envelope.command === 'retarget.session.set' || envelope.command === 'motion.edit' || envelope.command === 'motion.place' || envelope.command === 'motion.binding.set' || (envelope.command === 'history.undo' ? index.cursor > 0 : index.cursor < index.entries.length)
    return success(envelope.requestId, id, project.revision, { valid, ...(propAddition ? { nodeId: propAddition.nodeId } : {}), ...(mappingAddition ? { validationReport: mappingAddition.report } : {}), ...(retargetSessionAddition ? { sessionId: retargetSessionAddition.session.id } : {}), ...(motionPlacement ? { clipId: motionPlacement.clipId } : {}), ...(cameraMotionChange?.type === 'add' ? { clipId: cameraMotionChange.clip.id } : {}), ...(stagedAssetImports ? { assetCount: stagedAssetImports.length } : {}), ...(stagedAssetRelink ? { matchedHash: stagedAssetRelink.asset.source.sha256 } : {}) })
  }
  if (!Number.isInteger(envelope.expectedRevision)) throw new UnifiedStoreError('VALIDATION_FAILED', 'expectedRevision is required for mutations', 400)

  return withWriter(id, async () => {
    const retry = await previousRequest(envelope, hash)
    if (retry) return retry
    const current = await readUnifiedProject(id)
    if (envelope.expectedRevision !== current.revision) throw new UnifiedStoreError('REVISION_CONFLICT', 'Project revision changed; reload before saving', 409, { expected: envelope.expectedRevision, actual: current.revision })
    const index = await historyIndex(current)
    let next = structuredClone(current)
    let nextIndex: HistoryIndex
    let result: Record<string, unknown>
    let changedIds: string[]
    let importedUploadIds: string[] = []

    if (envelope.command === 'film.anchor.location.set' || envelope.command === 'film.frame.set' || envelope.command === 'shot.result.import' || envelope.command === 'scene.apply' || envelope.command === 'camera.shot.set' || envelope.command === 'scene.review.set' || envelope.command === 'vfx.cue.add' || envelope.command === 'vfx.cue.update' || envelope.command === 'vfx.cue.remove' || envelope.command === 'audio.cue.add' || envelope.command === 'audio.cue.update' || envelope.command === 'audio.cue.remove' || envelope.command === 'camera.motion.add' || envelope.command === 'camera.motion.remove' || envelope.command === 'asset.import' || envelope.command === 'library.place' || envelope.command === 'library.link' || envelope.command === 'asset.relink' || envelope.command === 'character.add' || envelope.command === 'prop.add' || envelope.command === 'skeleton.mapping.set' || envelope.command === 'retarget.session.set' || envelope.command === 'motion.edit' || envelope.command === 'motion.place' || envelope.command === 'motion.binding.set') {
      if (envelope.command === 'film.anchor.location.set') {
        if (!filmFrameExtensions) throw new UnifiedStoreError('VALIDATION_FAILED', 'Điểm neo chưa được kiểm tra', 400)
        next.extensions = filmFrameExtensions as UnifiedProject['extensions']
        changedIds = ['film-anchor-locations']
        result = { locations: next.extensions.filmAnchorLocations }
      } else if (envelope.command === 'film.frame.set') {
        if (!filmFrameExtensions) throw new UnifiedStoreError('VALIDATION_FAILED', 'Film frame extension was not validated', 400)
        next.extensions = filmFrameExtensions as UnifiedProject['extensions']
        changedIds = ['film-frame']
        result = { aspect: envelope.args.aspect, viewportAspect: readFilmFrameAspect(next.extensions) }
      } else if (envelope.command === 'shot.result.import') {
        if (!shotResult) throw new UnifiedStoreError('VALIDATION_FAILED', 'Result package is unavailable', 400)
        result = await applyShotResult(next, shotResult)
        changedIds = ['scene', ...shotResult.edits.map(item => `motion:${item.edit.newActionUuid}`)]
        importedUploadIds = [shotResult.uploadId]
      } else if (envelope.command === 'scene.apply') {
        if (!sceneReplacement) throw new UnifiedStoreError('VALIDATION_FAILED', 'Scene operations are unavailable', 400)
        next.scene = sceneReplacement.document
        next.extensions.topview = { ...(next.extensions.topview ?? {}), fcurves: sceneReplacement.fcurves }
        Object.assign(next.characters, sceneReplacement.characters)
        Object.assign(next.bindings, sceneReplacement.bindings)
        const cleanup = reconcileSceneReplacement(current, next)
        changedIds = ['scene', ...sceneReplacement.changedNodeIds.map((nodeId) => `node:${nodeId}`), ...Object.keys(sceneReplacement.characters).map((characterId) => `character:${characterId}`), ...Object.keys(sceneReplacement.bindings).map((clipId) => `binding:${clipId}`), ...cleanup.removedCharacters.map((characterId) => `character:${characterId}`), ...cleanup.removedBindings.map((clipId) => `binding:${clipId}`)]
        result = { sceneSequence: current.revision + 1, affectedNodeIds: sceneReplacement.changedNodeIds, cloneMaps: sceneReplacement.cloneMaps, removedCharacterIds: cleanup.removedCharacters, removedBindingClipIds: cleanup.removedBindings }
      } else if (envelope.command === 'camera.shot.set') {
        if (!shotReplacement) throw new UnifiedStoreError('VALIDATION_FAILED', 'Expected a camera shot', 400)
        const applied = applyCameraShot(current.scene, shotReplacement.sequenceId, shotReplacement.clip)
        next.scene = applied.document
        changedIds = [`shot:${applied.shotId}`]
        result = { sequenceId: shotReplacement.sequenceId, shotId: applied.shotId }
      } else if (envelope.command === 'camera.motion.add' || envelope.command === 'camera.motion.remove') {
        if (!cameraMotionChange) throw new UnifiedStoreError('VALIDATION_FAILED', 'Camera motion command data is unavailable', 400)
        const animation = next.scene.content.timeline.animation
        if (cameraMotionChange.type === 'add') {
          const clip = cameraMotionChange.clip
          animation.cameraMotionClips = [...animation.cameraMotionClips, clip]
          const camera = next.scene.content.nodes.find((node) => node.id === clip.target.nodeId)
          if (camera?.camera?.subject) camera.camera.subject.overridesMotion = false
          changedIds = ['scene', `camera-motion-clip:${clip.id}`, `node:${clip.target.nodeId}`]
          result = { clipId: clip.id, frameStart: clip.frameStart, frameEnd: clip.frameEnd }
        } else {
          const clipId = cameraMotionChange.clipId
          animation.cameraMotionClips = animation.cameraMotionClips.filter((clip) => clip.id !== clipId)
          changedIds = ['scene', `camera-motion-clip:${clipId}`]
          result = { clipId, removed: true }
        }
      } else if (envelope.command === 'asset.relink') {
        if (!stagedAssetRelink) throw new UnifiedStoreError('VALIDATION_FAILED', 'Relink upload is unavailable', 400)
        importedUploadIds = [stagedAssetRelink.upload.id]
        const asset = current.assets[stagedAssetRelink.asset.id]
        if (!asset || asset.source.sha256 !== stagedAssetRelink.upload.sha256 || asset.source.byteLength !== stagedAssetRelink.upload.byteLength) throw new UnifiedStoreError('ASSET_MISSING', 'Asset changed or no longer matches the relinked file', 422)
        const restored = await persistRelinkedAssetFiles(id, asset, stagedAssetRelink.upload.bytes)
        if (!restored) {
          const response = success(envelope.requestId, id, current.revision, { assetId: asset.id, matchedHash: asset.source.sha256, restored: false }, [])
          await saveRequest(envelope, hash, response)
          await removeStagedAssetUploads(importedUploadIds).catch(() => undefined)
          return response
        }
        changedIds = [`asset:${asset.id}`]
        result = { assetId: asset.id, matchedHash: asset.source.sha256, restored: true }
      } else if (envelope.command === 'character.add') {
        if (!characterAddition) throw new UnifiedStoreError('VALIDATION_FAILED', 'Character data is unavailable', 400)
        next.scene = characterAddition.scene
        next.characters[characterAddition.characterId] = characterAddition.character
        changedIds = [`character:${characterAddition.characterId}`, `node:${characterAddition.character.nodeId}`]
        result = { characterId: characterAddition.characterId, nodeId: characterAddition.character.nodeId }
      } else if (envelope.command === 'prop.add') {
        if (!propAddition) throw new UnifiedStoreError('VALIDATION_FAILED', 'Prop data is unavailable', 400)
        next.scene = propAddition.scene
        changedIds = [`prop:${propAddition.nodeId}`]
        result = { nodeId: propAddition.nodeId, assetId: propAddition.assetId }
      } else if (envelope.command === 'scene.review.set') {
        const { sequenceId, clipId, status, note = '' } = envelope.args
        const currentReview = next.extensions.sceneReview as unknown as ReturnType<typeof emptySceneReview> | undefined
        const review = currentReview?.version === 1 && currentReview.sequenceId === sequenceId ? structuredClone(currentReview) : emptySceneReview(sequenceId as string)
        const shot = makeSceneReviewShot(next, sequenceId as string, clipId as string, status as SceneReviewStatus, note as string)
        review.shots[clipId as string] = shot
        next.extensions.sceneReview = review as unknown as Record<string, unknown>
        changedIds = [`scene-review:${clipId}`]
        result = { sequenceId, clipId, ...shot }
      } else if (envelope.command === 'vfx.cue.add' || envelope.command === 'vfx.cue.update' || envelope.command === 'vfx.cue.remove') {
        if (!vfxCueChange) throw new UnifiedStoreError('VALIDATION_FAILED', 'VFX cue command data is unavailable', 400)
        const cueChange = vfxCueChange
        const extension = readVfxCueExtension(next)
        if (cueChange.type === 'add') extension.cues.push(cueChange.cue)
        else if (cueChange.type === 'update') extension.cues = extension.cues.map((cue) => cue.id === cueChange.cue.id ? cueChange.cue : cue)
        else extension.cues = extension.cues.filter((cue) => cue.id !== cueChange.id)
        next.extensions.vfxCues = extension as unknown as Record<string, unknown>
        const cueId = cueChange.type === 'remove' ? cueChange.id : cueChange.cue.id
        changedIds = [`vfx-cue:${cueId}`]
        result = cueChange.type === 'remove' ? { cueId, removed: true } : { cue: cueChange.cue }
      } else if (envelope.command === 'audio.cue.add' || envelope.command === 'audio.cue.update' || envelope.command === 'audio.cue.remove') {
        if (!audioCueChange) throw new UnifiedStoreError('VALIDATION_FAILED', 'Audio cue command data is unavailable', 400)
        const cueChange = audioCueChange
        const extension = readAudioCueExtension(next)
        if (cueChange.type === 'add') extension.cues.push(cueChange.cue)
        else if (cueChange.type === 'update') extension.cues = extension.cues.map((cue) => cue.id === cueChange.cue.id ? cueChange.cue : cue)
        else extension.cues = extension.cues.filter((cue) => cue.id !== cueChange.id)
        next.extensions.audioCues = extension as unknown as Record<string, unknown>
        const cueId = cueChange.type === 'remove' ? cueChange.id : cueChange.cue.id
        changedIds = [`audio-cue:${cueId}`]
        result = cueChange.type === 'remove' ? { cueId, removed: true } : { cue: cueChange.cue }
      } else if (envelope.command === 'skeleton.mapping.set') {
        if (!mappingAddition) throw new UnifiedStoreError('VALIDATION_FAILED', 'Mapping data is unavailable', 400)
        const calibrationBytes = Buffer.from(canonicalJsonExact(mappingAddition.calibration), 'utf8')
        const calibration = await persistRetargetCalibration(id, calibrationBytes)
        const referencePose = mappingAddition.referencePose
          ? await persistUniversalReferencePose(id, Buffer.from(canonicalJsonExact(mappingAddition.referencePose), 'utf8'))
          : null
        const mapping: SkeletonMapping = {
          ...mappingAddition.draft, calibration, referencePose,
          confirmed: mappingAddition.report.missingRequiredRoles.length === 0,
        }
        next.mappings[mapping.id] = mapping
        changedIds = [`mapping:${mapping.id}`]
        result = { mappingId: mapping.id, calibration, referencePose, validationReport: { ...mappingAddition.report, confirmed: mapping.confirmed } }
      } else if (envelope.command === 'retarget.session.set') {
        if (!retargetSessionAddition) throw new UnifiedStoreError('VALIDATION_FAILED', 'Native retarget session data is unavailable', 400)
        const bytes = Buffer.from(JSON.stringify(retargetSessionAddition.nativeProject), 'utf8')
        const nativeProject = await persistNativeRetargetProject(id, bytes)
        const session = { ...retargetSessionAddition.session, nativeProject }
        next.retargetSessions[session.id] = session
        changedIds = [`retarget-session:${session.id}`]
        result = { sessionId: session.id, nativeProject, sourceMotionId: session.sourceMotionId, targetCharacterId: session.targetCharacterId, mappingId: session.mappingId }
      } else if (envelope.command === 'motion.edit') {
        if (!nativeAnimationAddition) throw new UnifiedStoreError('VALIDATION_FAILED', 'Native animation data is unavailable', 400)
        const editBytes = Buffer.from(JSON.stringify(nativeAnimationAddition.edit), 'utf8')
        const persisted = await persistNativeAnimationMotion(id, nativeAnimationAddition.name, editBytes, nativeAnimationAddition.glbBytes,
          [current.characters[nativeAnimationAddition.characterId]!.assetId])
        const motion = {
          id: nativeAnimationAddition.motionId, assetId: persisted.asset.id, skeletonId: nativeAnimationAddition.skeletonId,
          durationSeconds: nativeAnimationAddition.duration, sourceFps: nativeAnimationAddition.fps,
          sourceClip: persisted.asset.source, evaluator: 'animation-1.31.8' as const, edit: persisted.edit,
          derivedFrom: nativeAnimationAddition.sourceMotionId,
        }
        const priorAsset = next.assets[persisted.asset.id]
        next.assets[persisted.asset.id] = priorAsset ? { ...persisted.asset, kind: priorAsset.kind === 'model' ? 'model' : 'motion',
          source: priorAsset.source, provenance: priorAsset.provenance, license: priorAsset.license,
          derivatives: { ...priorAsset.derivatives, ...persisted.asset.derivatives },
          dependencies: [...new Set([...priorAsset.dependencies, ...persisted.asset.dependencies])],
        } : persisted.asset
        next.motions[motion.id] = motion
        if (nativeAnimationAddition.clipId) {
          const clip = next.scene.content.timeline.animation.motionClips.find((item) => item.id === nativeAnimationAddition!.clipId)!
          const url = `/api/unified/projects/${id}/assets/${encodeURIComponent(persisted.asset.id)}/source?format=glb`
          clip.sourceDuration = motion.durationSeconds
          clip.motion.assetId = motion.id
          clip.motion.url = url
          clip.motion.name = persisted.asset.displayName
          clip.motion.clipIndex = 0
          clip.motion.source = 'native'
          const paths = next.scene.content.asset.motionPath
          if (!paths.some((entry) => entry.id === motion.id)) paths.push({ id: motion.id, path: url })
          next.bindings[clip.id] = { ...next.bindings[clip.id]!, motionId: motion.id }
        }
        changedIds = [`motion:${motion.id}`, `asset:${persisted.asset.id}`, `animation-edit:${motion.id}`,
          ...(nativeAnimationAddition.clipId ? [`motion-clip:${nativeAnimationAddition.clipId}`, `binding:${nativeAnimationAddition.clipId}`] : [])]
        result = { motionId: motion.id, derivedFrom: motion.derivedFrom, affectedClipIds: nativeAnimationAddition.clipId ? [nativeAnimationAddition.clipId] : [] }
      } else if (envelope.command === 'motion.place' || envelope.command === 'motion.binding.set') {
        if (!motionPlacement) throw new UnifiedStoreError('VALIDATION_FAILED', 'Motion placement data is unavailable', 400)
        next.scene = motionPlacement.scene
        next.bindings[motionPlacement.clipId] = motionPlacement.binding
        changedIds = ['scene', `motion-clip:${motionPlacement.clipId}`, `binding:${motionPlacement.clipId}`]
        result = { clipId: motionPlacement.clipId, characterId: motionPlacement.binding.characterId, motionId: motionPlacement.binding.motionId }
      } else if (envelope.command === 'library.link') {
        if (!libraryLink) throw new UnifiedStoreError('VALIDATION_FAILED', 'Library link data is unavailable', 400)
        const link = libraryLink
        changedIds = []
        const motionMetadata = { ...(isRecord(next.extensions.retargetMotionMetadata) ? next.extensions.retargetMotionMetadata : {}) }
        let metadataChanged = false
        const registerImported = (imported: ImportedAsset) => {
          const assetId = imported.asset.id
          if (!next.assets[assetId]) { next.assets[assetId] = imported.asset; changedIds.push(`asset:${assetId}`) }
          if (imported.app1Manifest) {
            const manifests = { ...(isRecord(next.extensions.app1Manifests) ? next.extensions.app1Manifests : {}) }
            if (!manifests[assetId]) { manifests[assetId] = imported.app1Manifest; next.extensions.app1Manifests = manifests }
          }
          const profiles = imported.skeletonProfiles ?? (imported.skeleton ? [imported.skeleton] : [])
          const profileIds = new Map<string, string>()
          for (const profile of profiles) {
            const existingProfile = Object.values(next.skeletons).find((candidate) => candidate.fingerprint === profile.fingerprint)
            const profileId = existingProfile?.id ?? profile.id
            if (!existingProfile) { next.skeletons[profile.id] = profile; changedIds.push(`skeleton:${profile.id}`) }
            profileIds.set(profile.id, profileId)
          }
          for (const item of imported.motions) {
            const skeletonId = profileIds.get(item.motion.skeletonId) ?? (profiles.length === 1 ? profileIds.get(profiles[0]!.id) : undefined)
            if (!skeletonId || next.motions[item.motion.id]) continue
            const motion = { ...item.motion, skeletonId }
            next.motions[motion.id] = motion
            motionMetadata[motion.id] = { name: item.name, clipIndex: item.clipIndex, nativeFingerprint: item.nativeFingerprint, ...(item.boneNames ? { boneNames: item.boneNames } : {}) }
            metadataChanged = true
            changedIds.push(`motion:${motion.id}`)
          }
          return { assetId, profileIds }
        }
        const modelRegistration = registerImported(link.modelImported)
        const modelProfileId = modelRegistration.profileIds.get(link.modelImported.skeleton!.id) ?? [...modelRegistration.profileIds.values()][0]
        if (!modelProfileId) throw new UnifiedStoreError('PROFILE_MISMATCH', 'Library base model profile could not be registered', 422)
        for (const entry of link.actionImports.values()) registerImported(entry.imported)
        if (metadataChanged) next.extensions.retargetMotionMetadata = motionMetadata
        const profile = next.skeletons[modelProfileId]!
        const linkedNodes: Array<Record<string, unknown>> = []
        for (const plan of link.nodes) {
          const node = next.scene.content.nodes.find((item) => item.id === plan.nodeId)!
          const characterId = plan.characterId ?? randomUUID()
          next.characters[characterId] = { id: characterId, assetId: modelRegistration.assetId as `sha256:${string}`, nodeId: node.id, skeletonId: modelProfileId, name: plan.displayName }
          const storyboardName = node.name
          node.name = plan.displayName
          node.metadata = { ...(isRecord(node.metadata) ? node.metadata : {}), characterId, rig: 'direct',
            modelFormat: 'gltf', modelUnitMeters: profile.metersPerUnit, modelBasisToScene: profile.basisToScene, preserveMaterials: true,
            modelUrl: `/api/library?modelCharacter=${encodeURIComponent(link.library.libraryCharacterId)}&fingerprint=${link.library.libraryModelFingerprint}`,
            assetId: modelRegistration.assetId,
            libraryCharacterId: link.library.libraryCharacterId, libraryModelFingerprint: link.library.libraryModelFingerprint,
            libraryHeightBlocks: link.library.libraryHeightBlocks, librarySourceHeightMeters: link.library.librarySourceHeightMeters, libraryHeightScale: link.library.libraryHeightScale,
            libraryBaseModelId: link.library.libraryBaseModelId, librarySkin: link.library.librarySkin, libraryHiddenObjects: [],
            storyboardName }
          delete node.character?.animation.posePresetId
          changedIds.push(`character:${characterId}`, `node:${node.id}`)
          const replacedClips: Array<Record<string, unknown>> = []
          for (const replacement of plan.replacements) {
            const oldClip = next.scene.content.timeline.animation.motionClips.find((item) => item.id === replacement.clipId)
            const motion = next.motions[replacement.actionUuid]
            if (!oldClip || !motion) continue
            const oldBinding = next.bindings[oldClip.id]
            next.scene.content.timeline.animation.motionClips = next.scene.content.timeline.animation.motionClips.filter((item) => item.id !== oldClip.id)
            delete next.bindings[oldClip.id]
            const url = `/api/unified/projects/${id}/assets/${encodeURIComponent(motion.assetId)}/source?format=glb`
            const clip = appendMotionClip(next.scene, { type: 'add-motion', libraryId: motion.id, name: replacement.name, fbxKey: url, targetNodeId: node.id, frameStart: replacement.frameStart, durationSeconds: motion.durationSeconds })
            clip.sourceDuration = motion.durationSeconds
            clip.frameStart = replacement.frameStart; clip.frameEnd = replacement.frameEnd
            clip.playback.speed = 1; clip.playback.loop = false
            clip.motion.speed = 1; clip.motion.loop = false; clip.motion.time = 0
            const windowSeconds = (replacement.frameEnd - replacement.frameStart + 1) / next.scene.content.timeline.fps
            clip.motion.sourceLengthSeconds = Math.min(motion.durationSeconds, Math.max(0.05, windowSeconds))
            clip.motion.reverse = false
            clip.motion.clipIndex = (motionMetadata[motion.id] as { clipIndex?: number } | undefined)?.clipIndex ?? 0
            clip.motion.sourceRig = profile.family
            const rootBone = profile.bones.find((bone) => bone.id === profile.rootBoneId)
            if (!rootBone) throw new UnifiedStoreError('PROFILE_MISMATCH', 'Receiver root joint is missing', 422)
            clip.motion.rootMotion = { policy: 'skeletal', boneName: rootBone.name, alignment: 'continue' }; clip.motion.inPlace = false
            if (!next.scene.content.asset.motionPath.some((entry) => entry.id === motion.id)) next.scene.content.asset.motionPath.push({ id: motion.id, path: url })
            next.bindings[clip.id] = { clipId: clip.id, characterId, motionId: motion.id, sourceStartSeconds: oldBinding?.sourceStartSeconds ?? 0,
              sourceLengthSeconds: clip.motion.sourceLengthSeconds, reverse: false, fadeInSeconds: 0, fadeOutSeconds: 0, rootPolicy: 'skeletal', alignment: 'continue' }
            changedIds.push(`motion-clip:${clip.id}`, `binding:${clip.id}`)
            replacedClips.push({ clipId: clip.id, replacedClipId: oldClip.id, actionUuid: replacement.actionUuid, name: replacement.name, frameStart: clip.frameStart, frameEnd: clip.frameEnd })
          }
          // Clips that could not be replaced stay in place, but their root-motion reference must
          // follow the Character's new profile or the project contract rejects the whole link.
          const newRootBone = profile.bones.find((bone) => bone.id === profile.rootBoneId)
          for (const kept of plan.unconverted) {
            const clip = next.scene.content.timeline.animation.motionClips.find((item) => item.id === kept.clipId)
            if (clip?.motion.rootMotion && newRootBone) clip.motion.rootMotion = { ...clip.motion.rootMotion, boneName: newRootBone.name }
          }
          linkedNodes.push({ nodeId: node.id, characterId, displayName: plan.displayName, replacedClips, unconvertedClips: plan.unconverted })
        }
        const linkConflict = findRootMotionConflict(next.scene)
        if (linkConflict) throw new UnifiedStoreError('ROOT_MOTION_CONFLICT', 'Linking would conflict with an existing root-motion source', 422, linkConflict)
        result = { libraryCharacterId: link.library.libraryCharacterId, assetId: modelRegistration.assetId, skeletonId: modelProfileId, linkedNodes }
      } else {
        if (!stagedAssetImports) throw new UnifiedStoreError('VALIDATION_FAILED', 'Asset upload handles are unavailable', 400)
        importedUploadIds = stagedAssetImports.map(({ upload }) => upload.id)
        const assetIds: string[] = []
        const skeletonIds: string[] = []
        const motionIds: string[] = []
        const issues: Array<{ code: string; message: string; actionIndex?: number }> = []
        const modelRebindReports: Array<{ assetId: string; variant: string; sha256: string }> = []
        changedIds = []
        const motionMetadata = { ...(isRecord(next.extensions.retargetMotionMetadata) ? next.extensions.retargetMotionMetadata : {}) }
        const modelMetadata = { ...(isRecord(next.extensions.assetImportModels) ? next.extensions.assetImportModels : {}) }
        for (const { imported } of stagedAssetImports) {
          const assetId = imported.asset.id
          if (imported.app1Manifest) {
            const manifests = { ...(isRecord(next.extensions.app1Manifests) ? next.extensions.app1Manifests : {}) }
            manifests[assetId] = imported.app1Manifest
            next.extensions.app1Manifests = manifests
          }
          if (!next.assets[assetId]) {
            next.assets[assetId] = imported.asset
            assetIds.push(assetId)
            changedIds.push(`asset:${assetId}`)
          } else {
            assetIds.push(assetId)
            if (imported.normalizationReport || imported.modelRebindReport) {
              next.assets[assetId]!.derivatives = { ...next.assets[assetId]!.derivatives, ...imported.asset.derivatives }
              changedIds.push(`asset-report:${assetId}`)
            }
            if (imported.asset.kind === 'model' && next.assets[assetId]!.kind !== 'model') {
              next.assets[assetId] = { ...next.assets[assetId]!, kind: 'model' }
              changedIds.push(`asset:${assetId}`)
            }
          }
          if (imported.modelInfo) {
            const prior = modelMetadata[assetId]
            if (isRecord(prior) && (prior.metersPerUnit !== imported.modelInfo.metersPerUnit || JSON.stringify(prior.basisToScene ?? [1, 0, 0, 0, 1, 0, 0, 0, 1]) !== JSON.stringify(imported.modelInfo.basisToScene))) {
              throw new UnifiedStoreError('ASSET_CONFLICT', 'The same source asset is already imported with a different unit or scene basis', 409)
            }
            if (!prior) { modelMetadata[assetId] = imported.modelInfo; changedIds.push(`asset-model:${assetId}`) }
          }
          const importedProfiles = imported.skeletonProfiles ?? (imported.skeleton ? [imported.skeleton] : [])
          const profileIds = new Map<string, string>()
          for (const profile of importedProfiles) {
            const existingProfile = Object.values(next.skeletons).find((candidate) => candidate.fingerprint === profile.fingerprint)
            const profileId = existingProfile?.id ?? profile.id
            if (!existingProfile) {
              next.skeletons[profile.id] = profile
              changedIds.push(`skeleton:${profile.id}`)
            }
            profileIds.set(profile.id, profileId)
            skeletonIds.push(profileId)
          }
          // Profiles are shared by fingerprint, so a second model on the same rig gets the first model's profile;
          // remember the model's own fingerprints so character.add can accept that shared profile.
          if (imported.modelInfo && importedProfiles.length) {
            const rigs = { ...(isRecord(next.extensions.assetSkeletonFingerprints) ? next.extensions.assetSkeletonFingerprints : {}) }
            if (!Array.isArray(rigs[assetId])) { rigs[assetId] = importedProfiles.map((profile) => profile.fingerprint); next.extensions.assetSkeletonFingerprints = rigs }
          }
          for (const item of imported.motions) {
            const skeletonId = profileIds.get(item.motion.skeletonId) ?? (importedProfiles.length === 1 ? profileIds.get(importedProfiles[0]!.id) : undefined)
            if (!skeletonId) throw new UnifiedStoreError('PROFILE_MISMATCH', `Motion ${item.name} does not resolve to one imported skeleton profile`, 422)
            const duplicate = Object.entries(next.motions).find(([motionId, motion]) => {
              const metadata = motionMetadata[motionId]
              return motion.assetId === assetId && motion.skeletonId === skeletonId && isRecord(metadata) && metadata.clipIndex === item.clipIndex
            })
            // E1: a library.place import must keep the Action UUID as its own Motion id even when a
            // byte-identical Action of another character already produced a Motion for the same
            // (asset, skeleton, clipIndex). The Motions share the asset, but each Action keeps its
            // own Motion so its provenance (library ownerCharId, resolved via the Action UUID) and
            // per-character placement stay intact instead of folding into the other character's Motion.
            const keepOwnMotion = libraryPlacement !== null && stagedAssetImports.length === 1 && item.motion.id === libraryPlacement.motionId && !next.motions[item.motion.id]
            if (imported.app1Manifest && next.motions[item.motion.id]) {
              const existing = next.motions[item.motion.id]!
              if (existing.sourceClip.sha256 !== imported.asset.source.sha256) throw new UnifiedStoreError('ASSET_CONFLICT', 'App 1 Action UUID already exists with a different GLB SHA-256', 409)
              motionIds.push(existing.id)
              continue
            }
            if (duplicate && imported.app1Manifest && duplicate[0] !== item.motion.id && !keepOwnMotion) throw new UnifiedStoreError('ASSET_CONFLICT', 'This clip was already imported with another Action UUID', 409)
            if (duplicate && !keepOwnMotion) {
              const oldMetadata = (isRecord(motionMetadata[duplicate[0]]) ? motionMetadata[duplicate[0]] : {}) as Record<string, unknown>
              const sourceFileName = next.assets[assetId]?.provenance.original.path.split('/').at(-1) ?? item.nativeFingerprint.name
              const updatedMetadata = { ...oldMetadata, name: item.name, clipIndex: item.clipIndex, nativeFingerprint: { ...item.nativeFingerprint, name: sourceFileName } }
              if (JSON.stringify(oldMetadata) !== JSON.stringify(updatedMetadata)) { motionMetadata[duplicate[0]] = updatedMetadata; changedIds.push(`motion-metadata:${duplicate[0]}`) }
              motionIds.push(duplicate[0]); continue
            }
            const motion = { ...item.motion, skeletonId }
            next.motions[motion.id] = motion
            motionMetadata[motion.id] = { name: item.name, clipIndex: item.clipIndex, nativeFingerprint: item.nativeFingerprint, ...(item.boneNames ? { boneNames: item.boneNames } : {}) }
            motionIds.push(motion.id)
            changedIds.push(`motion:${motion.id}`)
          }
          issues.push(...(imported.issues?.length ? imported.issues : imported.issue ? [imported.issue] : []))
          if (imported.modelRebindReport) {
            const variant = Object.keys(imported.asset.derivatives).find((key) => key.startsWith('modelRebindReport_'))
            if (variant) modelRebindReports.push({ assetId, variant, sha256: imported.modelRebindReport.ref.sha256 })
          }
        }
        if (motionIds.length) next.extensions.retargetMotionMetadata = motionMetadata
        if (Object.keys(modelMetadata).length) next.extensions.assetImportModels = modelMetadata
        result = { assetIds, skeletonIds, motionIds, issues, ...(modelRebindReports.length ? { modelRebindReports } : {}) }
        if (assignmentPlacement) {
          const motionId = motionIds[0], motion = motionId ? next.motions[motionId] : undefined
          const character = next.characters[assignmentPlacement.characterId]
          const profile = character && next.skeletons[character.skeletonId]
          if (!motion || !character || !profile || motion.skeletonId !== profile.id || !isMixamo65Topology(profile.bones)) throw new UnifiedStoreError('PROFILE_MISMATCH', 'Committed Assignment Motion is not compatible with its receiver', 422)
          const scene = structuredClone(next.scene), priorClips = scene.content.timeline.animation.motionClips.filter((clip) => clip.target.nodeId === character.nodeId)
          const frameStart = assignmentPlacement.frameStart ?? Math.max(0, ...priorClips.map((clip) => clip.frameEnd + 1))
          const durationFrames = Math.max(1, Math.round(motion.durationSeconds * scene.content.timeline.fps))
          const frameEnd = frameStart + durationFrames - 1
          if (!Number.isSafeInteger(frameEnd) || priorClips.some((clip) => clip.frameStart <= frameEnd && clip.frameEnd >= frameStart)) throw new UnifiedStoreError('VALIDATION_FAILED', 'Assignment placement overlaps an existing clip or exceeds the timeline range', 400)
          const metadata = next.extensions.retargetMotionMetadata?.[motion.id] as { name?: string; clipIndex?: number } | undefined
          const name = metadata?.name || next.assets[motion.assetId]?.displayName || 'Assigned Animation'
          const url = `/api/unified/projects/${id}/assets/${encodeURIComponent(motion.assetId)}/source`
          const clip = appendMotionClip(scene, { type: 'add-motion', libraryId: motion.id, name, fbxKey: url, targetNodeId: character.nodeId, frameStart, durationSeconds: motion.durationSeconds })
          clip.sourceDuration = motion.durationSeconds; clip.frameEnd = frameEnd
          clip.playback.speed = 1; clip.playback.loop = false
          clip.motion.speed = 1; clip.motion.loop = false; clip.motion.time = 0; clip.motion.sourceLengthSeconds = motion.durationSeconds
          clip.motion.reverse = false; clip.motion.clipIndex = metadata?.clipIndex ?? 0; clip.motion.sourceRig = profile.family
          const rootBone = profile.bones.find((bone) => bone.id === profile.rootBoneId)
          if (!rootBone) throw new UnifiedStoreError('PROFILE_MISMATCH', 'Receiver root joint is missing', 422)
          clip.motion.rootMotion = { policy: 'skeletal', boneName: rootBone.name, alignment: 'continue' }; clip.motion.inPlace = false
          if (!scene.content.asset.motionPath.some((entry) => entry.id === motion.id)) scene.content.asset.motionPath.push({ id: motion.id, path: url })
          next.scene = scene
          const assignmentRootConflict = findRootMotionConflict(scene)
          if (assignmentRootConflict) throw new UnifiedStoreError('ROOT_MOTION_CONFLICT', 'Assignment would conflict with an existing root-motion source', 422, assignmentRootConflict)
          next.bindings[clip.id] = { clipId: clip.id, characterId: character.id, motionId: motion.id, sourceStartSeconds: 0,
            sourceLengthSeconds: motion.durationSeconds, reverse: false, fadeInSeconds: 0, fadeOutSeconds: 0, rootPolicy: 'skeletal', alignment: 'continue' }
          next.extensions.assignmentProvenance = { ...(next.extensions.assignmentProvenance ?? {}), [motion.id]: assignmentPlacement.provenance }
          changedIds.push('scene', `motion-clip:${clip.id}`, `binding:${clip.id}`, `assignment:${motion.id}`)
          result = { ...(result as Record<string, unknown>), assignment: { motionId: motion.id, clipId: clip.id, characterId: character.id, frameStart, frameEnd, jobId: assignmentPlacement.jobId } }
        }
        if (libraryPlacement) {
          const motion = next.motions[libraryPlacement.motionId]
          const character = next.characters[libraryPlacement.characterId]
          const profile = character && next.skeletons[character.skeletonId]
          // A missing Motion here means the import above failed to register the Action, not a rig
          // mismatch; report the real cause instead of blaming the Character profile (E1).
          if (!motion) throw new UnifiedStoreError('ASSET_MISSING', 'Action đã nhập nhưng Motion của nó không có trong project; không thể gán cho nhân vật', 422)
          if (!character || !profile || !(libraryPlacement.nativeValidated ? next.skeletons[motion.skeletonId] && sameRigTopology(next.skeletons[motion.skeletonId] as NonNullable<ImportedAsset['skeleton']>, profile) : isMixamo65Topology(profile.bones) && isMixamo65Topology(next.skeletons[motion.skeletonId]?.bones ?? []))) throw new UnifiedStoreError('PROFILE_MISMATCH', 'Action không tương thích với rig của nhân vật đã chọn', 422)
          const scene = structuredClone(next.scene)
          const priorClips = scene.content.timeline.animation.motionClips.filter((clip) => clip.target.nodeId === character.nodeId)
          // N1: an explicit frameStart places the clip at the shot start / current frame the user
          // picked; without one the clip is appended after the character's last clip as before.
          const frameStart = libraryPlacement.frameStart >= 0 ? libraryPlacement.frameStart : Math.max(0, ...priorClips.map((clip) => clip.frameEnd + 1))
          const durationFrames = Math.max(1, Math.round(motion.durationSeconds * scene.content.timeline.fps))
          const frameEnd = frameStart + durationFrames - 1
          if (!Number.isSafeInteger(frameEnd)) throw new UnifiedStoreError('VALIDATION_FAILED', 'Action placement exceeds the supported timeline range', 400)
          if (libraryPlacement.frameStart >= 0 && priorClips.some((clip) => clip.frameStart <= frameEnd && clip.frameEnd >= frameStart)) throw new UnifiedStoreError('VALIDATION_FAILED', 'Khung bắt đầu đã có clip khác của nhân vật này; hãy chọn khung trống hoặc đầu shot khác', 400)
          const metadata = next.extensions.retargetMotionMetadata?.[motion.id] as { clipIndex?: number } | undefined
          const url = `/api/unified/projects/${id}/assets/${encodeURIComponent(motion.assetId)}/source?format=glb`
          const clip = appendMotionClip(scene, { type: 'add-motion', libraryId: motion.id, name: libraryPlacement.name, fbxKey: url, targetNodeId: character.nodeId, frameStart, durationSeconds: motion.durationSeconds })
          clip.sourceDuration = motion.durationSeconds; clip.frameEnd = frameEnd
          clip.playback.speed = 1; clip.playback.loop = false
          clip.motion.speed = 1; clip.motion.loop = false; clip.motion.time = 0; clip.motion.sourceLengthSeconds = motion.durationSeconds
          clip.motion.reverse = false; clip.motion.clipIndex = metadata?.clipIndex ?? 0; clip.motion.sourceRig = profile.family
          const rootBone = profile.bones.find((bone) => bone.id === profile.rootBoneId)
          if (!rootBone) throw new UnifiedStoreError('PROFILE_MISMATCH', 'Receiver root joint is missing', 422)
          clip.motion.rootMotion = { policy: 'skeletal', boneName: rootBone.name, alignment: 'continue' }; clip.motion.inPlace = false
          if (!scene.content.asset.motionPath.some((entry) => entry.id === motion.id)) scene.content.asset.motionPath.push({ id: motion.id, path: url })
          next.scene = scene
          const conflict = findRootMotionConflict(scene)
          if (conflict) throw new UnifiedStoreError('ROOT_MOTION_CONFLICT', 'Action placement would conflict with an existing root-motion source', 422, conflict)
          next.bindings[clip.id] = { clipId: clip.id, characterId: character.id, motionId: motion.id, sourceStartSeconds: 0,
            sourceLengthSeconds: motion.durationSeconds, reverse: false, fadeInSeconds: 0, fadeOutSeconds: 0, rootPolicy: 'skeletal', alignment: 'continue' }
          changedIds.push(`scene`, `motion-clip:${clip.id}`, `binding:${clip.id}`)
          result = { ...(result as Record<string, unknown>), libraryPlacement: { actionUuid: motion.id, motionId: motion.id, clipId: clip.id, characterId: character.id, frameStart, frameEnd } }
        }
      }
      if (envelope.command === 'scene.apply') changedIds.push(...reconcileMotionBindings(next))
      if (envelope.command === 'asset.import' && changedIds.length === 0) {
        const response = success(envelope.requestId, id, current.revision, result, [])
        await saveRequest(envelope, hash, response)
        await removeStagedAssetUploads(importedUploadIds).catch(() => undefined)
        return response
      }
      nextIndex = { revision: current.revision + 1, entries: index.entries.slice(0, index.cursor), cursor: index.cursor + 1 }
      nextIndex.entries.push(current.revision + 1)
      if (nextIndex.entries.length > MAX_HISTORY) { nextIndex.entries.shift(); nextIndex.cursor = Math.max(0, nextIndex.cursor - 1) }
    } else {
      if (envelope.command === 'history.undo') {
        if (index.cursor <= 0) throw new UnifiedStoreError('VALIDATION_FAILED', 'Undo history is empty', 400)
        const item = await readJson<HistoryRecord>(historyPath(id, index.entries[index.cursor - 1]!))
        if (!item) throw new UnifiedStoreError('IO_FAILED', 'Undo snapshot is missing', 500)
        next = structuredClone(item.before.project)
        nextIndex = { revision: current.revision + 1, entries: index.entries, cursor: index.cursor - 1 }
        result = { undoneRequestId: item.requestId }
      } else {
        if (index.cursor >= index.entries.length) throw new UnifiedStoreError('VALIDATION_FAILED', 'Redo history is empty', 400)
        const item = await readJson<HistoryRecord>(historyPath(id, index.entries[index.cursor]!))
        if (!item) throw new UnifiedStoreError('IO_FAILED', 'Redo snapshot is missing', 500)
        next = structuredClone(item.after.project)
        nextIndex = { revision: current.revision + 1, entries: index.entries, cursor: index.cursor + 1 }
        result = { redoneRequestId: item.requestId }
      }
      changedIds = ['scene']
    }

    next.revision = current.revision + 1
    nextIndex.revision = next.revision
    if (!validateProject(next)) throw new UnifiedStoreError('VALIDATION_FAILED', 'Project contract validation failed after command', 400)
    if (envelope.command === 'asset.import' || envelope.command === 'library.place' || envelope.command === 'library.link') {
      if (!stagedAssetImports) throw new UnifiedStoreError('VALIDATION_FAILED', 'Asset upload handles are unavailable', 400)
      for (const { upload, imported } of stagedAssetImports) if (!current.assets[imported.asset.id] || imported.normalizationReport || imported.modelRebindReport) await persistImportedAssetFiles(id, imported, upload.bytes)
    }
    const response = await commit(envelope, hash, current, next, nextIndex, result, changedIds)
    if (envelope.command === 'asset.import' || envelope.command === 'asset.relink') await removeStagedAssetUploads(importedUploadIds).catch(() => undefined)
    return response
  })
}

export async function getRequestResult(requestId: string): Promise<CommandSuccess | null> {
  if (!UUID.test(requestId)) return null
  const request = await readJson<RequestRecord>(requestPath(requestId))
  return request?.response ?? null
}
