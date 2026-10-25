import type { UnifiedProject } from '@bbs/animation-workspace-shared'

type Sequence = NonNullable<UnifiedProject['scene']['content']['editorial']>['sequences'][number]
export type ExportShot = Sequence['clips'][number]
export interface ExportShotRange { startFrame: number; endFrame: number }
export type ExportShotIssue = 'RANGE_INVALID' | 'CAMERA_LIMIT' | 'SEQUENCE_GAP' | 'SEQUENCE_COVERAGE' | 'CAMERA_CUT_GRID'

/** Inclusive source-frame intersection. Only this detached export view is trimmed; authored shots stay intact. */
export function selectExportShots(clips: readonly ExportShot[], range: ExportShotRange, fps: number) {
  const issues: ExportShotIssue[] = []
  const add = (issue: ExportShotIssue) => { if (!issues.includes(issue)) issues.push(issue) }
  if (!Number.isSafeInteger(range.startFrame) || !Number.isSafeInteger(range.endFrame) || range.endFrame < range.startFrame || !Number.isSafeInteger(fps) || fps <= 0) {
    return { clips: [] as ExportShot[], issues: ['RANGE_INVALID'] as ExportShotIssue[] }
  }
  const selected = clips.filter((clip) => clip.sourceFrameStart <= range.endFrame && clip.sourceFrameEnd >= range.startFrame)
    .map((clip) => ({ ...clip, sourceFrameStart: Math.max(clip.sourceFrameStart, range.startFrame), sourceFrameEnd: Math.min(clip.sourceFrameEnd, range.endFrame) }))
    .sort((a, b) => a.sourceFrameStart - b.sourceFrameStart || a.sourceFrameEnd - b.sourceFrameEnd || a.id.localeCompare(b.id))
  if (selected.length > 3) add('CAMERA_LIMIT')
  let nextFrame = range.startFrame
  for (const clip of selected) {
    if (clip.sourceFrameStart !== nextFrame) add('SEQUENCE_GAP')
    nextFrame = clip.sourceFrameEnd + 1
    const tick = (nextFrame - range.startFrame) * 20 / fps
    if (Math.abs(tick - Math.round(tick)) > 1e-7) add('CAMERA_CUT_GRID')
  }
  if (!selected.length || selected[0]!.sourceFrameStart !== range.startFrame || nextFrame !== range.endFrame + 1) add('SEQUENCE_COVERAGE')
  return { clips: selected, issues }
}

/** Read-only repairs: offer an unambiguous, grid-aligned part of an existing shot, never rewrite a chain. */
export function exportShotRepairRanges(clips: readonly ExportShot[], range: ExportShotRange, fps: number) {
  const selected = selectExportShots(clips, range, fps).clips
  return selected.flatMap((shot) => {
    let spans = [{ startFrame: shot.sourceFrameStart, endFrame: shot.sourceFrameEnd }]
    for (const other of selected) {
      if (other.id === shot.id) continue
      spans = spans.flatMap((span) => {
        if (other.sourceFrameStart > span.endFrame || other.sourceFrameEnd < span.startFrame) return [span]
        return [
          { startFrame: span.startFrame, endFrame: other.sourceFrameStart - 1 },
          { startFrame: other.sourceFrameEnd + 1, endFrame: span.endFrame },
        ].filter((part) => part.startFrame <= part.endFrame)
      })
    }
    let a = fps, b = 20
    while (b) { const remainder = a % b; a = b; b = remainder }
    const frameStep = fps / a
    const candidates = spans.map((span) => ({ startFrame: span.startFrame,
      endFrame: span.endFrame - (span.endFrame - span.startFrame + 1) % frameStep,
    })).filter((span) => span.endFrame >= span.startFrame).sort((a, b) => (b.endFrame - b.startFrame) - (a.endFrame - a.startFrame))
    return candidates[0] ? [{ shotId: shot.id, range: candidates[0] }] : []
  })
}

/** Explicit repair plan. Caller must commit with expectedRevision; normal selection never calls this. */
export function planExportCameraRepair(project: UnifiedProject, sequenceId: string, range: ExportShotRange, repairedId: string, shotId: string) {
  const editorial = project.scene.content.editorial
  const sequence = editorial?.sequences.find((item) => item.id === sequenceId)
  if (!sequence || editorial?.sequences.some((item) => item.id === repairedId)) throw new Error('Invalid export repair sequence')
  const selection = selectExportShots(sequence.clips, range, project.scene.content.timeline.fps)
  if (selection.issues.includes('RANGE_INVALID') || range.startFrame < project.scene.content.timeline.frameStart || range.endFrame > project.scene.content.timeline.frameEnd) throw new Error('Invalid export repair range')
  const cameraId = selection.clips.find((shot) => project.scene.content.nodes.some((node) => node.id === shot.cameraNodeId && node.camera?.projection === 'perspective'))?.cameraNodeId
    ?? project.scene.content.nodes.find((node) => node.camera?.projection === 'perspective')?.id
  if (!cameraId) throw new Error('Export repair requires a perspective camera')
  const document = structuredClone(project.scene)
  document.content.editorial!.sequences.push({ id: repairedId, clips: [{ id: shotId, cameraNodeId: cameraId,
    sourceFrameStart: range.startFrame, sourceFrameEnd: range.endFrame }] })
  return document
}
