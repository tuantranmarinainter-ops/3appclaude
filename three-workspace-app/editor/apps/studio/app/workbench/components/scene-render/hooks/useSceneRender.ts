import { useState } from 'react'
import type { UnifiedProject } from '@bbs/animation-workspace-shared'
import { loadUnifiedJob, sendUnifiedCommand, type UnifiedJobView } from '../../../../../src/unifiedApi'
import { chooseDirectory, parseRenderFrames, saveJob } from '../utils'
import { useStudioLocale } from '../../../../../src/devtools/localePreference'

export function useSceneRender(project: UnifiedProject) {
  const vi = useStudioLocale() === 'vi'
  const [framesText, setFramesText] = useState(String(project.scene.content.timeline.frameStart))
  const [selectedCameraIds, setSelectedCameraIds] = useState<string[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [activeJobId, setActiveJobId] = useState<string | null>(null)
  const [completedJob, setCompletedJob] = useState<UnifiedJobView | null>(null)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const cameras = project.scene.content.nodes.filter((node) => node.type === 'camera')
  const activeCamera = project.scene.content.activeShotCameraNodeId
  const cameraNodeIds = (selectedCameraIds ?? [activeCamera ?? cameras[0]?.id]).filter((id): id is string => cameras.some((camera) => camera.id === id))

  const saveAgain = async (job: UnifiedJobView) => {
    setBusy(true)
    setError('')
    try {
      const directory = await chooseDirectory()
      await saveJob(project.projectId, job, directory)
      setStatus(vi ? `Đã lưu ${job.result?.files.length ?? 0} tệp · revision nguồn ${job.sourceRevision}` : `Saved ${job.result?.files.length ?? 0} files · source revision ${job.sourceRevision}`)
    } catch (cause) {
      if (!(cause instanceof DOMException && cause.name === 'AbortError')) setError(cause instanceof Error ? cause.message : String(cause))
    } finally { setBusy(false) }
  }

  const render = async () => {
    if (busy) return
    const frames = parseRenderFrames(framesText, project.scene.content.timeline.frameStart, project.scene.content.timeline.frameEnd)
    if (!frames) {
      setError(vi ? `Nhập tối đa 9 frame nguyên, không trùng, trong khoảng ${project.scene.content.timeline.frameStart}–${project.scene.content.timeline.frameEnd}.` : `Enter up to 9 unique whole frames between ${project.scene.content.timeline.frameStart} and ${project.scene.content.timeline.frameEnd}.`)
      return
    }
    if (!cameraNodeIds.length || cameraNodeIds.length > 3 || frames.length * cameraNodeIds.length > 9) { setError(vi ? 'Chọn 1–3 camera; tổng frame × camera không quá 9 ảnh.' : 'Choose 1–3 cameras; the total frames × cameras must not exceed 9 images.'); return }
    setBusy(true)
    setError('')
    setCompletedJob(null)
    setStatus(vi ? 'Chọn thư mục lưu kết quả…' : 'Choose an output folder…')
    try {
      const directory = await chooseDirectory()
      const started = await sendUnifiedCommand({
        requestId: crypto.randomUUID(), projectId: project.projectId, expectedRevision: project.revision,
        command: 'scene.render', args: {
          frames, cameraNodeIds, width: 640, height: 360,
          outputDirectory: { kind: 'client-directory', id: crypto.randomUUID() },
        },
      })
      const jobId = String(started.result.jobId)
      setActiveJobId(jobId)
      setStatus(vi ? 'Đang render ảnh…' : 'Rendering images…')
      let job = await loadUnifiedJob(project.projectId, jobId)
      for (let attempt = 0; attempt < 1200 && (job.state === 'queued' || job.state === 'running'); attempt++) {
        setStatus(vi ? `Đang render · ${Math.round(job.progress * 100)}% · revision ${job.sourceRevision}` : `Rendering · ${Math.round(job.progress * 100)}% · revision ${job.sourceRevision}`)
        await new Promise((resolve) => setTimeout(resolve, 500))
        job = await loadUnifiedJob(project.projectId, jobId)
      }
      if (job.state === 'queued' || job.state === 'running') {
        await sendUnifiedCommand({ requestId: crypto.randomUUID(), projectId: project.projectId, command: 'job.cancel', args: { jobId } })
        throw new Error(vi ? 'Render quá thời gian chờ và đã được hủy.' : 'Render timed out and was canceled.')
      }
      if (job.state !== 'succeeded') throw new Error(job.error?.message ?? `Render kết thúc với trạng thái ${job.state}.`)
      setCompletedJob(job)
      setStatus(vi ? 'Render xong · đang lưu vào thư mục đã chọn…' : 'Render complete · saving to the selected folder…')
      await saveJob(project.projectId, job, directory)
      setStatus(vi ? `Đã lưu ${job.result?.files.length ?? 0} tệp · revision nguồn ${job.sourceRevision}` : `Saved ${job.result?.files.length ?? 0} files · source revision ${job.sourceRevision}`)
    } catch (cause) {
      if (!(cause instanceof DOMException && cause.name === 'AbortError')) setError(cause instanceof Error ? cause.message : String(cause))
      setStatus('')
    } finally { setBusy(false); setActiveJobId(null) }
  }

  const cancel = async () => {
    if (!activeJobId) return
    try {
      await sendUnifiedCommand({ requestId: crypto.randomUUID(), projectId: project.projectId, command: 'job.cancel', args: { jobId: activeJobId } })
      setStatus(vi ? 'Đã yêu cầu hủy render.' : 'Render cancellation requested.')
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
  }

  return { framesText, setFramesText, busy, activeJobId, completedJob, status, error, cameras, cameraNodeIds, setSelectedCameraIds, render, cancel, saveAgain }
}
