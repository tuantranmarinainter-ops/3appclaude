import { useEffect, useState } from 'react'
import type { UnifiedProject } from '@bbs/animation-workspace-shared'
import { loadUnifiedJob, sendUnifiedCommand, type UnifiedJobView } from '../../../../../src/unifiedApi'

interface Report { projectId: string; name: string; nodeCount: number; clipCount: number; manifestBytes: number; range: { startFrame: number; endFrame: number }; warnings: string[] }

export function useSplitShots(project: UnifiedProject) {
  const editorial = project.scene.content.editorial
  const sequence = editorial?.sequences.find((item) => item.id === editorial.activeSequenceId) ?? editorial?.sequences[0]
  const shots = sequence?.clips ?? []
  const [selected, setSelected] = useState<string[]>(shots.map((shot) => shot.id))
  const [episodeName, setEpisodeName] = useState(project.name)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [reports, setReports] = useState<Report[]>([])
  const [job, setJob] = useState<UnifiedJobView | null>(null)
  const episode = project.extensions.episode as { name?: string } | undefined
  const shotKey = JSON.stringify(shots.map((shot) => shot.id))
  useEffect(() => { setSelected(JSON.parse(shotKey) as string[]) }, [project.projectId, shotKey])
  useEffect(() => {
    if (!job || !['queued', 'running'].includes(job.state)) return
    let stopped = false
    const timer = setTimeout(() => { void loadUnifiedJob(project.projectId, job.jobId).then((value) => { if (!stopped) setJob(value) }).catch((value: unknown) => { if (!stopped) setError(value instanceof Error ? value.message : String(value)) }) }, 1000)
    return () => { stopped = true; clearTimeout(timer) }
  }, [job, project.projectId])
  const split = async () => {
    setBusy(true); setError('')
    try {
      const response = await sendUnifiedCommand({ requestId: crypto.randomUUID(), projectId: project.projectId, expectedRevision: project.revision, command: 'project.splitShots', args: { sequenceId: sequence?.id, shotIds: selected, episodeName } })
      setReports(response.result.projects as Report[])
      window.dispatchEvent(new Event('bbs-project-list-changed'))
    } catch (value) { setError(value instanceof Error ? value.message : String(value)) }
    finally { setBusy(false) }
  }
  const exportEpisode = async () => {
    setBusy(true); setError('')
    try {
      const response = await sendUnifiedCommand({ requestId: crypto.randomUUID(), projectId: project.projectId, expectedRevision: project.revision, command: 'episode.export', args: { name: 'episode' } })
      setJob(await loadUnifiedJob(project.projectId, String(response.result.jobId)))
    } catch (value) { setError(value instanceof Error ? value.message : String(value)) }
    finally { setBusy(false) }
  }
  return { shots, selected, setSelected, episodeName, setEpisodeName, busy, error, reports, job, episode, split, exportEpisode }
}
