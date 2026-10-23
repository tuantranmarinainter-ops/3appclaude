import type { UnifiedProject } from '@bbs/animation-workspace-shared'
import { readFilmFrameAspect } from './filmFrame'
import { getUnifiedJob, readUnifiedJobFile, startUnifiedSceneRender } from './unifiedJobs'

/** Long side of review stills; the short side follows the project's film frame. */
export const REVIEW_CAPTURE_SIZE = 640

export function reviewCaptureSize(aspect: number): { width: number; height: number } {
  return aspect >= 1
    ? { width: REVIEW_CAPTURE_SIZE, height: Math.max(64, Math.round(REVIEW_CAPTURE_SIZE / aspect)) }
    : { width: Math.max(64, Math.round(REVIEW_CAPTURE_SIZE * aspect)), height: REVIEW_CAPTURE_SIZE }
}

/**
 * C4: stills for the shot review board, rendered headless through the camera of one editorial clip with the BBS look
 * (Minecraft lighting, sky, grass, shadows, VFX sprites), at the project's film frame. Returns PNG data URLs in frame order.
 */
export async function captureReviewStills(project: UnifiedProject, sequenceId: string, clipId: string, frames: readonly number[], signal?: AbortSignal): Promise<string[]> {
  const clip = project.scene.content.editorial?.sequences.find((item) => item.id === sequenceId)?.clips.find((item) => item.id === clipId)
  if (!clip) throw new TypeError('Review clip does not exist')
  if (!frames.length || frames.length > 9 || frames.some((frame) => !Number.isSafeInteger(frame) || frame < clip.sourceFrameStart || frame > clip.sourceFrameEnd)) {
    throw new TypeError('Review frames must be 1-9 whole frames inside the clip')
  }
  let job = await startUnifiedSceneRender(project, { frames: [...frames], cameraNodeIds: [clip.cameraNodeId], ...reviewCaptureSize(readFilmFrameAspect(project.extensions)), bbsLook: true })
  while (job.state === 'queued' || job.state === 'running') {
    signal?.throwIfAborted()
    await new Promise((resolve) => setTimeout(resolve, 500))
    job = await getUnifiedJob(job.jobId, project.projectId)
  }
  if (job.state !== 'succeeded' || !job.result) throw new Error(`Review capture ${job.state}`)
  const byFrame = new Map<number, string>()
  for (const file of job.result.files) {
    const match = /frame-(\d+)\.png$/.exec(file.name)
    if (!match) continue
    const stored = await readUnifiedJobFile(job.jobId, project.projectId, file.id)
    if (stored) byFrame.set(Number(match[1]), `data:image/png;base64,${Buffer.from(stored.bytes).toString('base64')}`)
  }
  return frames.map((frame) => byFrame.get(frame) ?? '')
}
