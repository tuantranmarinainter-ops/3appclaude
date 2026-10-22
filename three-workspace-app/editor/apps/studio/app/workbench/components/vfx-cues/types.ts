import type { UnifiedProject } from '@bbs/animation-workspace-shared'
import type { VfxCue } from '../../../../src/vfxCues'

export type VfxCueForm = Omit<VfxCue, 'id'>
export type VfxCuePatch = Omit<VfxCueForm, 'attachNodeId' | 'attachBone'> & {
  attachNodeId: string | null
  attachBone: string | null
}

export interface VfxCuePanelProps {
  project: UnifiedProject
  cues: VfxCue[]
  frameRange?: { startFrame: number; endFrame: number }
  onAdd: (cue: Omit<VfxCue, 'id'>) => Promise<void> | void
  onUpdate: (id: string, patch: VfxCuePatch) => Promise<void> | void
  onRemove: (id: string) => Promise<void> | void
}
