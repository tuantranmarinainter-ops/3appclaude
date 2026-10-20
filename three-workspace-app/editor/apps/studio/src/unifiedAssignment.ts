import { createHash } from 'node:crypto'
import type { UnifiedProject } from '@bbs/animation-workspace-shared'
import { assignCanonicalAnimation, isMixamo65Topology } from '@bbs/retarget'
import { inspectProjectRig, loadProjectRig } from './unifiedRigInspection'

export interface AssignmentArgs { motionId: string; characterId: string; fps: number }

export async function planProjectAssignment(project: UnifiedProject, args: AssignmentArgs) {
  if (!Number.isFinite(args.fps) || args.fps < 1 || args.fps > 240) throw new TypeError('Assignment FPS must be in [1, 240]')
  const motion = project.motions[args.motionId], character = project.characters[args.characterId]
  if (!motion || !character) throw new TypeError('Choose an existing Motion and receiver Character')
  if (!['topview-0.1.8', 'animation-1.31.8'].includes(motion.evaluator)) throw new TypeError('Assignment requires an imported or baked native Motion')
  const sourceProfile = project.skeletons[motion.skeletonId], receiver = project.skeletons[character.skeletonId]
  if (!sourceProfile || !receiver || !isMixamo65Topology(sourceProfile.bones) || !isMixamo65Topology(receiver.bones)) throw new TypeError('Normalize both source and receiver to canonical Mixamo65 before Assignment')
  const source = await inspectProjectRig(project, motion.assetId, motion.id, motion.skeletonId), target = await inspectProjectRig(project, character.assetId, undefined, character.skeletonId)
  if (source.skeletonProfileId !== motion.skeletonId || target.skeletonProfileId !== character.skeletonId) throw new TypeError('Stored Motion/Character profile does not match the verified asset')
  const metadata = project.extensions.retargetMotionMetadata?.[motion.id] as { clipIndex?: number } | undefined
  const actionIndex = motion.evaluator === 'animation-1.31.8' ? 0 : metadata?.clipIndex
  if (!Number.isInteger(actionIndex) || !source.actions[actionIndex!]) throw new TypeError('Motion action index is unavailable')
  const action = source.actions[actionIndex!]!, sampleCount = Math.ceil(action.durationSeconds * args.fps) + 1
  const plan = { version: 1, ...args, sourceRevision: project.revision, sourceAssetId: motion.assetId, targetAssetId: character.assetId,
    sourceSha256: source.sourceSha256, targetSha256: target.sourceSha256, sourceFingerprint: sourceProfile.fingerprint, receiverFingerprint: receiver.fingerprint,
    actionIndex: actionIndex!, sampleCount, issues: sampleCount > 18_000 ? ['RESOURCE_LIMIT'] : [], ready: action.durationSeconds > 0 && sampleCount <= 18_000 }
  return { ...plan, planSha256: createHash('sha256').update(JSON.stringify(plan)).digest('hex') }
}

export async function stageProjectAssignment(project: UnifiedProject, args: AssignmentArgs, planSha256: string, signal?: AbortSignal) {
  signal?.throwIfAborted()
  const plan = await planProjectAssignment(project, args)
  if (!plan.ready || plan.planSha256 !== planSha256) throw new TypeError('Assignment plan is stale or incomplete')
  const source = await loadProjectRig(project, plan.sourceAssetId, args.motionId)
  const target = await loadProjectRig(project, plan.targetAssetId, undefined, project.characters[args.characterId]!.skeletonId)
  const output = await assignCanonicalAnimation({ source: source.group, target: target.group, sourceOptions: source.options, targetOptions: target.options, actionIndex: plan.actionIndex, fps: args.fps }, signal)
  return { ...output, provenance: { planSha256, sourceRevision: project.revision, sourceMotionId: args.motionId, receiverCharacterId: args.characterId,
    sourceSha256: plan.sourceSha256, receiverSha256: plan.targetSha256, receiverFingerprint: plan.receiverFingerprint,
    outputSha256: createHash('sha256').update(output.bytes).digest('hex') } }
}
