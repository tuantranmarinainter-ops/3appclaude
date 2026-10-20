'use client'

import { useEffect, useState } from 'react'
import { loadUnifiedJob, loadUnifiedProject, sendUnifiedCommand, type UnifiedJobView } from '../../../../../src/unifiedApi'

export function useAssignment(projectId: string) {
  const [motionId, setMotionId] = useState(''), [characterId, setCharacterId] = useState('')
  const [plan, setPlan] = useState<{ planSha256: string; sourceRevision: number; ready: boolean; issues: string[]; sampleCount: number } | null>(null)
  const [job, setJob] = useState<UnifiedJobView | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('')
  useEffect(() => { setPlan(null); setJob(null); setMessage('') }, [motionId, characterId])
  const jobId = job?.jobId, state = job?.state
  useEffect(() => {
    if (!jobId || !['queued', 'running'].includes(state ?? '')) return
    let live = true
    const timer = setTimeout(() => { void loadUnifiedJob(projectId, jobId).then((next) => { if (live) { setJob(next); setError('') } }).catch((cause) => { if (live) setError(cause instanceof Error ? cause.message : String(cause)) }) }, 1000)
    return () => { live = false; clearTimeout(timer) }
  }, [projectId, jobId, state, job])
  async function execute(action: 'plan' | 'run' | 'cancel' | 'commit') {
    if (busy || !motionId || !characterId) return
    setBusy(true); setError(''); setMessage('')
    try {
      const latest = await loadUnifiedProject(projectId), args = { motionId, characterId, fps: 30 }
      if (action === 'plan') {
        const response = await sendUnifiedCommand({ requestId: crypto.randomUUID(), projectId, command: 'animation.assignment.plan', args })
        setPlan(response.result as unknown as NonNullable<typeof plan>); setJob(null)
      } else if (action === 'run') {
        if (!plan?.ready || plan.sourceRevision !== latest.project.revision) throw new Error('Assignment plan is stale or incomplete; create a new plan.')
        const response = await sendUnifiedCommand({ requestId: crypto.randomUUID(), projectId, expectedRevision: plan.sourceRevision,
          command: 'animation.assignment.run', args: { ...args, planSha256: plan.planSha256 } })
        setJob(await loadUnifiedJob(projectId, String(response.result.jobId)))
      } else if (action === 'cancel' && job) {
        await sendUnifiedCommand({ requestId: crypto.randomUUID(), projectId, command: 'job.cancel', args: { jobId: job.jobId } })
        setJob(await loadUnifiedJob(projectId, job.jobId))
      } else if (action === 'commit' && job?.state === 'succeeded') {
        const response = await sendUnifiedCommand({ requestId: crypto.randomUUID(), projectId, expectedRevision: latest.project.revision,
          command: 'asset.import', args: { assignmentJobId: job.jobId } })
        const assignment = response.result.assignment as { frameStart: number; frameEnd: number }
        setMessage(`Motion assigned · frames ${assignment.frameStart}–${assignment.frameEnd} · revision ${response.revision}`)
        setPlan(null); setJob(null)
        window.dispatchEvent(new CustomEvent('bbs-unified-project-commit', { detail: { projectId } }))
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusy(false) }
  }
  return { motionId, setMotionId, characterId, setCharacterId, plan, job, busy, error, message, execute }
}
