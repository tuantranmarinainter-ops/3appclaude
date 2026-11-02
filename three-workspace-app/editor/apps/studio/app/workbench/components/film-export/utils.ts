import type { UnifiedProject } from '@bbs/animation-workspace-shared'

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]))
  return value
}

// Keep the export's data dependencies, not save bookkeeping or workbench/session state.
export function filmExportContentKey(project: UnifiedProject): string {
  return JSON.stringify(canonical({ projectId: project.projectId, content: { nodes: project.scene.content.nodes, timeline: project.scene.content.timeline,
    aspectRatio: project.scene.content.aspectRatio,
    editorial: project.scene.content.editorial?.sequences, physicalConstraints: project.scene.content.physicalConstraints },
    assets: project.assets, characters: project.characters, motions: project.motions,
    bindings: project.bindings, skeletons: project.skeletons, mappings: project.mappings,
    extensions: { fcurves: project.extensions.topview?.fcurves,
      vfxCues: project.extensions.vfxCues, filmFrame: project.extensions.filmFrame,
      assetSkeletonFingerprints: project.extensions.assetSkeletonFingerprints, assetImportModels: project.extensions.assetImportModels } }))
}

/** The folder picker can stay open across saves. Check the fresh server snapshot and
 * preflight that exact revision; expectedRevision on the export closes the final race. */
export async function prepareFilmExportRevision(options: {
  contentKey: string
  selectionUnchanged: () => boolean
  load: () => Promise<UnifiedProject>
  preflight: (revision: number) => Promise<{ revision: number; sourceRevision: unknown; errors: unknown[] }>
  changedMessage: string
  failedMessage: string
}): Promise<number> {
  const project = await options.load()
  if (!options.selectionUnchanged() || filmExportContentKey(project) !== options.contentKey) throw new Error(options.changedMessage)
  const result = await options.preflight(project.revision)
  if (!options.selectionUnchanged()) throw new Error(options.changedMessage)
  if (result.revision !== project.revision || result.sourceRevision !== project.revision || result.errors.length) throw new Error(options.failedMessage)
  return project.revision
}

/** B49: familiar frame shapes; the decimal value stays internal. */
export const ASPECT_PRESETS = [
  { label: '16:9', value: 16 / 9, hint: 'màn hình ngang (YouTube)' },
  { label: '9:16', value: 9 / 16, hint: 'màn hình dọc (Shorts, TikTok)' },
  { label: '1:1', value: 1, hint: 'vuông' },
  { label: '4:3', value: 4 / 3, hint: 'ti vi cũ' },
  { label: '2.39:1', value: 2.39, hint: 'màn ảnh rộng điện ảnh' },
] as const

export function aspectPreset(value: number): (typeof ASPECT_PRESETS)[number] | undefined {
  return ASPECT_PRESETS.find((preset) => Math.abs(preset.value - value) < 1e-3)
}

export function aspectLabel(value: number): string {
  return aspectPreset(value)?.label ?? `≈ ${value.toFixed(2).replace('.', ',')}:1`
}

/** B48: characters whose motion clips overlap the export range. */
export function charactersInRange(project: UnifiedProject, range: { startFrame: number; endFrame: number }): string[] {
  const clips = project.scene.content.timeline.animation.motionClips
  return Object.values(project.characters)
    .filter((character) => clips.some((clip) => clip.target.nodeId === character.nodeId && clip.frameEnd >= range.startFrame && clip.frameStart <= range.endFrame))
    .map((character) => character.id)
}

/** B48: tick every character that acts in the shot; with no clips at all, tick everyone so nobody is silently left out. */
export function defaultExportCharacterIds(project: UnifiedProject, range: { startFrame: number; endFrame: number }): string[] {
  const acting = charactersInRange(project, range)
  return acting.length ? acting : Object.keys(project.characters)
}
