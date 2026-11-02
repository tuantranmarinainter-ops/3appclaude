import type { UnifiedProject } from '@bbs/animation-workspace-shared'
import { sampleCameraSequence } from '@topview/3d-builder/skeleton'
import { projectEvaluationScene } from './unifiedSkeletonEvaluation'
import { selectExportShots } from './exportShotSelection'
import type { FilmPreflightIssue } from './filmPreflight'

/** Inspect evaluated poses, including keys, paths and look-at, rather than guessing from clip presence. */
export function filmCameraWarnings(project: UnifiedProject, sequenceId: string, range: { startFrame: number; endFrame: number }, aspect: number): FilmPreflightIssue[] {
  const sequence = project.scene.content.editorial?.sequences.find(item => item.id === sequenceId)
  if (!sequence || !range) return []
  const selected = selectExportShots(sequence.clips, range, project.scene.content.timeline.fps)
  if (selected.issues.length || !selected.clips.length) return []
  const document = { ...project.scene, content: { ...project.scene.content,
    editorial: { version: 1 as const, activeSequenceId: sequenceId, sequences: [{ ...sequence, clips: selected.clips }] } } }
  const shots = new Map<string, { first: { position: number[]; quaternion: number[]; verticalFov: number }; moving: boolean }>()
  try {
    const overlays = projectEvaluationScene(project)
    for (const sample of sampleCameraSequence(document, sequenceId, 20, aspect, overlays)) {
      let shot = shots.get(sample.shotId)
      if (!shot) { shot = { first: sample, moving: false }; shots.set(sample.shotId, shot) }
      const first = shot.first
      const dot = sample.quaternion.reduce((sum, value, index) => sum + value * first.quaternion[index]!, 0)
      shot.moving ||= sample.position.some((value, index) => Math.abs(value - first.position[index]!) > 1e-5) ||
        Math.abs(sample.verticalFov - first.verticalFov) > 1e-5 || 1 - Math.abs(dot) > 1e-10
    }
  } catch {
    // Trajectory-follow cameras require host CPU skeleton evaluation. Never mislabel them as stationary.
    return []
  }
  return [...shots].filter(([, shot]) => !shot.moving).map(([clipId]) => ({ code: 'CAMERA_STATIONARY', clipId,
    message: { vi: `Camera ${clipId} đứng yên — đúng ý bạn?`, en: `Camera ${clipId} is stationary — is that intended?` } }))
}
