import type { UnifiedProject } from '@bbs/animation-workspace-shared'
import type { VfxCue } from '../../../../src/vfxCues'

export type VfxCueForm = Omit<VfxCue, 'id'>

export function defaultVfxCue(project: UnifiedProject, range?: { startFrame: number; endFrame: number }): VfxCueForm {
  return {
    effect: '', frameStart: range?.startFrame ?? project.scene.content.timeline.frameStart,
    frameEnd: range?.endFrame ?? project.scene.content.timeline.frameEnd,
    position: { x: 0, y: 0, z: 0 }, yaw: 0, scale: 1,
  }
}

export function editableVfxCue(cue: VfxCue): VfxCueForm {
  const { id: _id, ...values } = cue
  return structuredClone(values)
}
