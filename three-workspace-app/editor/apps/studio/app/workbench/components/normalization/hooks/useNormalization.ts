'use client'

import { useEffect, useState } from 'react'
import type { UnifiedProject } from '@bbs/animation-workspace-shared'
import type { RetargetRig } from '@bbs/retarget'
import { loadUnifiedJob, loadUnifiedProject, sendUnifiedCommand, type UnifiedJobView } from '../../../../../src/unifiedApi'

type SourceInspection = { graph: RetargetRig; jointIds: string[]; profileBoneLinks: Array<{ profileBoneId: string; adapterNodeId: string | null; status: 'matched' | 'ambiguous' | 'missing' }> }
type InspectedAction = { index: number; name: string; durationSeconds: number; channels: unknown[]; totalTrackCount: number; ready: boolean; issues: Array<{ code: string; trackName: string; message: string }> }

function isInspectedAction(value: unknown): value is InspectedAction {
  if (!value || typeof value !== 'object') return false
  const action = value as Record<string, unknown>
  return Number.isInteger(action.index) && typeof action.name === 'string' && typeof action.durationSeconds === 'number' && Number.isFinite(action.durationSeconds) &&
    Array.isArray(action.channels) && Number.isSafeInteger(action.totalTrackCount) && typeof action.ready === 'boolean' && Array.isArray(action.issues) &&
    action.issues.every((issue: unknown) => !!issue && typeof issue === 'object' && typeof (issue as Record<string, unknown>).code === 'string' &&
      typeof (issue as Record<string, unknown>).trackName === 'string' && typeof (issue as Record<string, unknown>).message === 'string')
}

export function useNormalization(projectId: string) {
  const [project, setProject] = useState<UnifiedProject | null>(null)
  const [mappingId, setMappingId] = useState(''), [sourceAssetId, setSourceAssetId] = useState(''), [targetAssetId, setTargetAssetId] = useState('')
  const [actionIndex, setActionIndex] = useState(0), [fps, setFps] = useState(30)
  const [rootTranslationScale, setRootTranslationScale] = useState(1)
  const [rootTranslationPolicy, setRootTranslationPolicy] = useState<'preserve' | 'in-place'>('preserve')
  const [sourceSkeletonSelection, setSourceSkeletonSelection] = useState(''), [targetSkeletonSelection, setTargetSkeletonSelection] = useState('')
  const sourceProfiles = Object.values(project?.skeletons ?? {}).filter((profile) => profile.provenance.sourceHash === project?.assets[sourceAssetId as `sha256:${string}`]?.source.sha256)
  const targetProfiles = Object.values(project?.skeletons ?? {}).filter((profile) => profile.provenance.sourceHash === project?.assets[targetAssetId as `sha256:${string}`]?.source.sha256)
  const sourceSkeletonId = sourceProfiles.some((profile) => profile.id === sourceSkeletonSelection) ? sourceSkeletonSelection : sourceProfiles.length === 1 ? sourceProfiles[0]!.id : ''
  const targetSkeletonId = targetProfiles.some((profile) => profile.id === targetSkeletonSelection) ? targetSkeletonSelection : targetProfiles.length === 1 ? targetProfiles[0]!.id : ''
  const [actions, setActions] = useState<InspectedAction[]>([])
  const [inspection, setInspection] = useState<SourceInspection | null>(null)
  const [inspecting, setInspecting] = useState(false)
  useEffect(() => {
    let live = true
    setActions([]); setInspection(null); setActionIndex(0); setError('')
    if (!sourceAssetId || !sourceSkeletonId) { setInspecting(false); return }
    setInspecting(true)
    void sendUnifiedCommand({ requestId: crypto.randomUUID(), projectId, command: 'rig.inspect', args: { assetId: sourceAssetId, skeletonProfileId: sourceSkeletonId } })
      .then((response) => {
        if (!live) return
        const list = response.result.actions
        if (!Array.isArray(list) || !list.every(isInspectedAction)) throw new Error('Invalid source action inspection')
        const result = response.result as unknown as SourceInspection
        if (!result.graph || typeof result.graph.fingerprint !== 'string' || !Array.isArray(result.graph.bones) ||
          result.graph.bones.some((bone) => !bone || typeof bone.id !== 'string' || (bone.parentId !== null && typeof bone.parentId !== 'string')) ||
          !Array.isArray(result.jointIds) || !Array.isArray(result.profileBoneLinks)) throw new Error('Invalid source rig inspection')
        setInspection(result)
        setActions(list); setActionIndex(list[0]?.index ?? 0)
      }).catch((cause) => { if (live) setError(cause instanceof Error ? cause.message : String(cause)) })
      .finally(() => { if (live) setInspecting(false) })
    return () => { live = false }
  }, [projectId, sourceAssetId, sourceSkeletonId])
  const [plan, setPlan] = useState<{ planSha256: string; sourceRevision: number; ready: boolean; issues: string[]; sampleCount: number; excludedSourceBones: Array<{ sourceBoneId: string; name: string; reason: string }>; actionIssues: InspectedAction['issues']; resourceCost: { nodeSamples: number; estimatedPeakBytes: number; maxNodeSamples: number; maxEstimatedBytes: number; withinBudget: boolean } } | null>(null)
  const [job, setJob] = useState<UnifiedJobView | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('')
  useEffect(() => {
    let live = true
    const refresh = () => { void loadUnifiedProject(projectId).then(({ project: next }) => { if (live) { setProject(next); setPlan(null) } }).catch((cause) => { if (live) setError(String(cause)) }) }
    const committed = (event: Event) => { if ((event as CustomEvent).detail?.projectId === projectId) refresh() }
    refresh(); window.addEventListener('bbs-unified-project-commit', committed)
    return () => { live = false; window.removeEventListener('bbs-unified-project-commit', committed) }
  }, [projectId])
  useEffect(() => { setPlan(null); setJob(null); setMessage('') }, [sourceAssetId, sourceSkeletonId, targetAssetId, targetSkeletonId, mappingId, actionIndex, fps, rootTranslationPolicy, rootTranslationScale])
  const jobId = job?.jobId, state = job?.state
  useEffect(() => {
    if (!jobId || !['queued', 'running'].includes(state ?? '')) return
    let live = true
    const timer = setTimeout(() => { void loadUnifiedJob(projectId, jobId).then((next) => { if (live) { setJob(next); setError('') } }).catch((cause) => { if (live) { setError(String(cause)); setJob((current) => current ? { ...current } : null) } }) }, 1000)
    return () => { live = false; clearTimeout(timer) }
  }, [projectId, jobId, state, job])
  const args = { sourceAssetId, targetAssetId, mappingId, actionIndex, fps, rootTranslationPolicy, rootTranslationScale }
  async function execute(action: 'plan' | 'run' | 'cancel' | 'save') {
    if (busy || !project) return
    setBusy(true); setError(''); setMessage('')
    try {
      const latest = await loadUnifiedProject(projectId)
      if (action === 'plan') {
        const result = await sendUnifiedCommand({ requestId: crypto.randomUUID(), projectId, command: 'rig.normalization.plan', args })
        setProject(latest.project); setPlan(result.result as unknown as NonNullable<typeof plan>); setJob(null)
      } else if (action === 'run') {
        if (!plan?.ready || plan.sourceRevision !== latest.project.revision) throw new Error('Plan is stale or incomplete; create a new plan.')
        const result = await sendUnifiedCommand({ requestId: crypto.randomUUID(), projectId, expectedRevision: plan.sourceRevision, command: 'rig.normalization.run', args: { ...args, planSha256: plan.planSha256 } })
        setJob(await loadUnifiedJob(projectId, String(result.result.jobId)))
      } else if (action === 'cancel' && job) {
        await sendUnifiedCommand({ requestId: crypto.randomUUID(), projectId, command: 'job.cancel', args: { jobId: job.jobId } })
        setJob(await loadUnifiedJob(projectId, job.jobId))
      } else if (action === 'save' && job?.state === 'succeeded') {
        const result = await sendUnifiedCommand({ requestId: crypto.randomUUID(), projectId, expectedRevision: latest.project.revision, command: 'asset.import', args: { normalizationJobId: job.jobId } })
        setPlan(null); setJob(null); setMessage(`Motion saved · revision ${result.revision}`)
        window.dispatchEvent(new CustomEvent('bbs-unified-project-commit', { detail: { projectId } }))
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusy(false) }
  }
  return { project, mappingId, setMappingId, sourceAssetId, setSourceAssetId, targetAssetId, setTargetAssetId,
    sourceProfiles, sourceSkeletonId, setSourceSkeletonSelection, targetProfiles, targetSkeletonId, setTargetSkeletonSelection,
    actionIndex, setActionIndex, actions, inspection, inspecting, fps, setFps, rootTranslationPolicy, setRootTranslationPolicy, rootTranslationScale, setRootTranslationScale, plan, job, busy, error, message, execute }
}
