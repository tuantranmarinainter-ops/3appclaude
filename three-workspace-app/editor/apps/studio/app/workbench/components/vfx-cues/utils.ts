import type { UnifiedProject } from '@bbs/animation-workspace-shared'
import type { VfxSheetMeta } from '@topview/3d-builder'
import type { VfxCue } from '../../../../src/vfxCues'
import type { VfxEffectOption } from './types'

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

/** Select value for the fallback editorial entry: the whole scene timeline. */
export const EDITORIAL_TIMELINE_SHOT_ID = '__timeline__'

/**
 * Which editorial shot the panel targets. The timeline sentinel (and any
 * unknown id) means "no specific shot"; an untouched selector opens on the
 * first clip, matching the panel's previous behaviour.
 */
export function resolveEditorialShot<T extends { id: string }>(clips: readonly T[], shotId: string): T | undefined {
  if (shotId === EDITORIAL_TIMELINE_SHOT_ID) return undefined
  return clips.find((clip) => clip.id === shotId) ?? clips[0]
}

function validSheetMeta(meta: VfxSheetMeta | undefined): meta is VfxSheetMeta {
  return !!meta && [meta.frames, meta.columns, meta.rows].every((value) => Number.isFinite(value) && value > 0)
}

/** App 4 preview sheets (`GET /api/unified/vfx-previews`) as sorted picker options. */
export function vfxEffectOptions(sheets: Record<string, VfxSheetMeta> | undefined, baseUrl: string): VfxEffectOption[] {
  return Object.entries(sheets ?? {})
    .filter((entry): entry is [string, VfxSheetMeta] => validSheetMeta(entry[1]))
    .map(([name, meta]) => ({ name, meta, imageUrl: `${baseUrl}/${encodeURIComponent(name)}` }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * CSS background values showing one representative cell (the middle frame) of
 * a sprite sheet, using the standard percentage sprite technique.
 */
export function vfxSpriteThumb(meta: VfxSheetMeta): { backgroundSize: string; backgroundPosition: string } {
  const columns = Math.max(1, Math.floor(meta.columns)), rows = Math.max(1, Math.floor(meta.rows))
  const frame = Math.min(Math.max(0, Math.floor(meta.frames) - 1), Math.floor(Math.max(0, Math.floor(meta.frames)) / 2))
  const column = frame % columns, row = Math.floor(frame / columns)
  const percent = (value: number) => `${Number(value.toFixed(3))}%`
  return {
    backgroundSize: `${columns * 100}% ${rows * 100}%`,
    backgroundPosition: `${percent(columns > 1 ? column / (columns - 1) * 100 : 0)} ${percent(rows > 1 ? row / (rows - 1) * 100 : 0)}`,
  }
}
