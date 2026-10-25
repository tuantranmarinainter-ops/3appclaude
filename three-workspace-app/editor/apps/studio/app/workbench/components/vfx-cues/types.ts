import type { UnifiedProject } from '@bbs/animation-workspace-shared'
import type { VfxSheetMeta } from '@topview/3d-builder'
import type { VfxCue } from '../../../../src/vfxCues'

/** One baked App 4 effect from `GET /api/unified/vfx-previews`, ready for the picker. */
export interface VfxEffectOption {
  name: string
  meta: VfxSheetMeta
  imageUrl: string
}

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
