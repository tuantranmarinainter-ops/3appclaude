import { createHash } from 'node:crypto'
import type { UnifiedProject } from '@bbs/animation-workspace-shared'
import { calibrationRuntime, estimateUniversalBakeCost, isMixamo65Topology, isRetargetCalibrationV1, isUniversalCalibrationV1, isUniversalReferencePoseV1, normalizeAnimation, validateUniversalMapping, type UniversalCalibrationRuntime, type UniversalPoseReferenceV1 } from '@bbs/retarget'
import { inspectProjectRig, loadProjectRig } from './unifiedRigInspection'
import { resolveProjectBlob, sha256CanonicalJson } from './unifiedAssetFiles'

export interface NormalizationPlanArgs { sourceAssetId: string; targetAssetId: string; mappingId: string; actionIndex: number; fps: number; rootTranslationPolicy?: 'preserve' | 'in-place'; rootTranslationScale?: number }

async function resolveCalibration(project: UnifiedProject, mapping: UnifiedProject['mappings'][string], source: Awaited<ReturnType<typeof inspectProjectRig>>, target: Awaited<ReturnType<typeof inspectProjectRig>>) {
  const calibrationBytes = await resolveProjectBlob(project.projectId, mapping.calibration)
  let value: unknown
  try { value = JSON.parse(calibrationBytes.toString('utf8')) } catch { throw new TypeError('Saved calibration JSON is invalid; create a new mapping calibration') }
  if (isRetargetCalibrationV1(value, mapping.sourceFingerprint, mapping.targetFingerprint)) {
    if (mapping.referencePose) throw new TypeError('Legacy V9.12 calibration must not carry a Universal reference pose')
    return { mode: 'legacy-compatible' as const, calibrationSha256: mapping.calibration.sha256, referencePoseSha256: null,
      runtime: undefined, rootTranslationPolicy: 'preserve' as const, rootTranslationScale: 1 }
  }
  if (!isUniversalCalibrationV1(value, mapping.sourceFingerprint, mapping.targetFingerprint) || !mapping.referencePose) throw new TypeError('Saved calibration is unsupported or has no reference-pose blob')
  const sourceProfile = project.skeletons[mapping.sourceProfileId]!, targetProfile = project.skeletons[mapping.targetProfileId]!
  const mappingDigest = sha256CanonicalJson({ sourceProfileId: mapping.sourceProfileId, targetProfileId: mapping.targetProfileId,
    sourceFingerprint: mapping.sourceFingerprint, targetFingerprint: mapping.targetFingerprint, pairs: mapping.pairs, ignored: mapping.ignored })
  if (value.sourceHash !== sourceProfile.provenance.sourceHash || value.mappingDigest !== mappingDigest) throw new TypeError('Universal calibration is stale for this source asset or mapping')
  const referenceBytes = await resolveProjectBlob(project.projectId, mapping.referencePose)
  let reference: unknown
  try { reference = JSON.parse(referenceBytes.toString('utf8')) } catch { throw new TypeError('Saved Universal reference pose JSON is invalid') }
  if (!isUniversalReferencePoseV1(reference, mapping.sourceFingerprint, mapping.targetFingerprint,
    new Set(sourceProfile.bones.map((bone) => bone.id)), new Set(targetProfile.bones.map((bone) => bone.id)))) throw new TypeError('Saved Universal reference pose does not match the selected profiles')
  const sourceActions = new Map(source.actions.map((action) => [action.index, action]))
  const targetActions = new Map(target.actions.map((action) => [action.index, action]))
  for (const [pose, actions, label] of [[reference.source, sourceActions, 'Source'], [reference.target, targetActions, 'Target']] as const) {
    if (pose.kind === 'action') {
      const action = actions.get(pose.actionIndex!)
      if (!action || pose.timeSeconds! > action.durationSeconds) throw new TypeError(`${label} Universal reference Action/time is stale`)
    }
  }
  const resolvePose = (pose: UniversalPoseReferenceV1, inspection: typeof source) => {
    const links = new Map(inspection.profileBoneLinks.map((item) => [item.profileBoneId, item]))
    const result = pose.bones.map((bone) => {
      const link = links.get(bone.id)
      if (!link?.adapterNodeId || link.status !== 'matched') throw new TypeError(`Universal reference identity is unresolved for profile bone ${bone.id}`)
      return { id: link.adapterNodeId, world: bone.world }
    })
    const resolved = new Set(result.map((bone) => bone.id))
    for (const bone of inspection.graph.bones) if (!resolved.has(bone.id)) result.push({ id: bone.id, world: bone.restWorld })
    return result
  }
  const baseRuntime: UniversalCalibrationRuntime = calibrationRuntime(value, reference, mapping.referencePose.sha256)
  const runtime: UniversalCalibrationRuntime = {
    ...baseRuntime,
    sourceReference: resolvePose(reference.source, source),
    targetReference: resolvePose(reference.target, target),
    corrections: value.corrections.map((item) => {
      const link = target.profileBoneLinks.find((candidate) => candidate.profileBoneId === item.targetBoneId)
      if (!link?.adapterNodeId || link.status !== 'matched') throw new TypeError(`Universal correction identity is unresolved for profile bone ${item.targetBoneId}`)
      return { ...item, targetBoneId: link.adapterNodeId }
    }),
  }
  return { mode: 'universal-v1' as const, calibrationSha256: mapping.calibration.sha256, referencePoseSha256: mapping.referencePose.sha256,
    runtime, rootTranslationPolicy: value.rootTranslationPolicy, rootTranslationScale: value.rootTranslationScale }
}

export async function stageProjectNormalization(project: UnifiedProject, args: NormalizationPlanArgs, planSha256: string, signal?: AbortSignal) {
  signal?.throwIfAborted()
  const plan = await planProjectNormalization(project, args)
  if (!/^[a-f0-9]{64}$/.test(planSha256) || plan.planSha256 !== planSha256) throw new TypeError('Normalization plan is stale; create and review a new plan')
  if (!plan.ready) throw new TypeError('Normalization plan has unresolved issues')
  const mapping = project.mappings[args.mappingId]
  if (!mapping) throw new TypeError('Select a saved mapping')
  const source = await loadProjectRig(project, args.sourceAssetId, undefined, mapping.sourceProfileId)
  const target = await loadProjectRig(project, args.targetAssetId, undefined, mapping.targetProfileId)
  const sourceInspection = await inspectProjectRig(project, args.sourceAssetId, undefined, mapping.sourceProfileId)
  const targetInspection = await inspectProjectRig(project, args.targetAssetId, undefined, mapping.targetProfileId)
  const calibration = await resolveCalibration(project, mapping, sourceInspection, targetInspection)
  const output = await normalizeAnimation({ source: source.group, target: target.group, sourceOptions: source.options, targetOptions: target.options,
    pairs: plan.pairs, excludedSourceBones: plan.excludedSourceBones, actionIndex: args.actionIndex, fps: args.fps,
    rootTranslationPolicy: args.rootTranslationPolicy ?? calibration.rootTranslationPolicy,
    rootTranslationScale: args.rootTranslationScale ?? calibration.rootTranslationScale, calibration: calibration.runtime }, signal)
  return { ...output, provenance: { planSha256, sourceRevision: project.revision, sourceAssetId: args.sourceAssetId, targetAssetId: args.targetAssetId,
    sourceSha256: plan.sourceSha256, targetSha256: plan.targetSha256, mappingId: args.mappingId,
    actionIndex: args.actionIndex, outputSha256: createHash('sha256').update(output.bytes).digest('hex') } }
}

export async function planProjectNormalization(project: UnifiedProject, args: NormalizationPlanArgs) {
  if (args.rootTranslationPolicy !== undefined && !['preserve', 'in-place'].includes(args.rootTranslationPolicy)) throw new TypeError('Invalid root translation policy')
  if (args.rootTranslationScale !== undefined && (!Number.isFinite(args.rootTranslationScale) || args.rootTranslationScale < 0.01 || args.rootTranslationScale > 20)) throw new TypeError('Root translation scale must be in [0.01, 20]')
  if (!Number.isInteger(args.actionIndex) || args.actionIndex < 0 || !Number.isFinite(args.fps) || args.fps < 1 || args.fps > 240) throw new TypeError('Select a valid action index and FPS in [1, 240]')
  const mapping = project.mappings[args.mappingId]
  if (!mapping) throw new TypeError('Select a saved mapping')
  const source = await inspectProjectRig(project, args.sourceAssetId, undefined, mapping.sourceProfileId)
  const target = await inspectProjectRig(project, args.targetAssetId, undefined, mapping.targetProfileId)
  if (mapping.sourceProfileId !== source.skeletonProfileId || mapping.targetProfileId !== target.skeletonProfileId ||
      mapping.sourceFingerprint !== source.graph.fingerprint || mapping.targetFingerprint !== target.graph.fingerprint) throw new TypeError('Mapping profiles or fingerprints do not match the selected assets')
  const action = source.actions[args.actionIndex]
  if (!action || !(action.durationSeconds > 0)) throw new TypeError('Selected source action has no positive duration')
  const profile = project.skeletons[target.skeletonProfileId]!
  if (!isMixamo65Topology(profile.bones)) throw new TypeError('Select a canonical Mixamo65 target')
  const resolve = (inspection: typeof source, id: string) => {
    const link = inspection.profileBoneLinks.find((item) => item.profileBoneId === id)
    if (!link?.adapterNodeId || link.status !== 'matched') throw new TypeError(`Mapping bone has missing or ambiguous adapter identity: ${id}`)
    return link.adapterNodeId
  }
  const pairs = mapping.pairs.filter((pair) => pair.enabled).map((pair) => ({ sourceBoneId: resolve(source, pair.sourceBoneId),
    ...(pair.sourceBoneIds ? { sourceBoneIds: pair.sourceBoneIds.map((id) => resolve(source, id)) } : {}),
    ...(pair.sourceBoneWeights ? { sourceBoneWeights: pair.sourceBoneWeights } : {}), ...(pair.chainComposition ? { chainComposition: pair.chainComposition } : {}), targetBoneId: resolve(target, pair.targetBoneId), enabled: true }))
  const calibration = await resolveCalibration(project, mapping, source, target)
  const sourceProfile = project.skeletons[source.skeletonProfileId]!
  const excludedSourceBones = mapping.ignored.filter((item) => item.side === 'source').map((item) => {
    const bone = sourceProfile.bones.find((candidate) => candidate.id === item.boneId)
    if (!bone) throw new TypeError(`Ignored source bone is missing from its profile: ${item.boneId}`)
    return { sourceBoneId: item.boneId, name: bone.name, reason: item.reason }
  })
  const required = profile.bones.filter((bone) => bone.deform && /^(hips|spine|head|left(arm|forearm|hand|upleg|leg|foot)|right(arm|forearm|hand|upleg|leg|foot))$/i.test(bone.name.split(':').pop()!.replace(/^mixamorig\d*/i, ''))).map((bone) => resolve(target, bone.id))
  const report = validateUniversalMapping(source.graph, target.graph, pairs, required)
  const sampleCount = Math.ceil(action.durationSeconds * args.fps) + 1
  const resourceCost = estimateUniversalBakeCost(source.graph.bones.length, target.graph.bones.length, sampleCount)
  const issues = [...report.errors.map((error) => error.code), ...report.missingRequiredTargetBoneIds.map((id) => `REQUIRED_MAPPING_MISSING:${id}`),
    ...(!mapping.confirmed ? ['MAPPING_NOT_CONFIRMED'] : []), ...(sampleCount > 18_000 ? ['RESOURCE_SAMPLE_LIMIT'] : []),
    ...(!resourceCost.withinBudget ? ['RESOURCE_RIG_BUDGET'] : []), ...(!action.ready ? [`UNSUPPORTED_ACTION_CHANNELS:${action.index}`] : [])]
  const plan = { version: 1, sourceRevision: project.revision, ...args,
    rootTranslationPolicy: args.rootTranslationPolicy ?? calibration.rootTranslationPolicy,
    rootTranslationScale: args.rootTranslationScale ?? calibration.rootTranslationScale,
    sourceSha256: source.sourceSha256, targetSha256: target.sourceSha256,
    sourceFingerprint: source.graph.fingerprint, targetFingerprint: target.graph.fingerprint, pairs, excludedSourceBones, sampleCount, durationSeconds: action.durationSeconds,
    outputMode: 'animation-only', calibrationMode: calibration.mode, calibrationSha256: calibration.calibrationSha256,
    referencePoseSha256: calibration.referencePoseSha256, report, actionIssues: action.issues, resourceCost, issues, ready: issues.length === 0 }
  return { ...plan, planSha256: createHash('sha256').update(JSON.stringify(plan)).digest('hex') }
}
