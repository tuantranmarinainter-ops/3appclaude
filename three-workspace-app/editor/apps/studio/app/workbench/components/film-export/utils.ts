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
