import type { UnifiedProject } from '@bbs/animation-workspace-shared'

/** Explicit, undoable JSON cleanup. Physical blobs remain available to every history snapshot. */
export function cleanupUnusedProjectResources(project: UnifiedProject): { removedMotionIds: string[]; removedAssetIds: string[]; removedConversionKeys: string[] } {
  const owns = (value: object, key: string): boolean => Object.prototype.hasOwnProperty.call(value, key)
  const live = new Set<string>()
  const assets = project.assets as Record<string, unknown>
  const motions = project.motions as Record<string, unknown>
  const conversions = project.extensions.libraryMotionConversions ?? {}
  const metadata = project.extensions.retargetMotionMetadata ?? {}
  const pending: string[] = []
  const scan = (value: unknown): void => {
    if (typeof value === 'string') {
      const candidates = [value]
      // Host asset URLs also count as references (props, audio and timeline sources).
      const match = value.match(/\/assets\/([^/?#]+)/)
      if (match) { try { candidates.push(decodeURIComponent(match[1]!)) } catch { /* Keep scanning other references. */ } }
      for (const id of candidates) if ((owns(assets, id) || owns(motions, id)) && !live.has(id)) { live.add(id); pending.push(id) }
    } else if (Array.isArray(value)) value.forEach(scan)
    else if (value && typeof value === 'object') Object.values(value).forEach(scan)
  }
  const { assets: _assets, motions: _motions, extensions, ...roots } = project
  // motionPath is a lookup catalogue, not a timeline reference: deleted clips leave entries behind.
  const paths = project.scene.content.asset?.motionPath ?? []
  scan({ ...roots, scene: { ...project.scene, content: { ...project.scene.content, asset: { ...project.scene.content.asset, motionPath: [] } } } })
  for (const [key, value] of Object.entries(extensions)) if (key !== 'libraryMotionConversions' && key !== 'retargetMotionMetadata') scan(value)
  const retainedConversions = new Set<string>()
  const drain = (): void => {
    while (pending.length) {
      const id = pending.pop()!
      scan(assets[id] ?? motions[id])
      for (const entry of paths) if (entry.id === id) scan(entry)
      if (owns(metadata, id)) scan(metadata[id])
    }
  }
  // Retain conversion inputs transitively whenever an output/source motion remains in use.
  let changed = true
  while (changed) {
    drain(); changed = false
    for (const [key, value] of Object.entries(conversions)) {
      if (retainedConversions.has(key)) continue
      const refs: string[] = []
      const collect = (v: unknown): void => { if (typeof v === 'string') refs.push(v); else if (Array.isArray(v)) v.forEach(collect); else if (v && typeof v === 'object') Object.values(v).forEach(collect) }
      collect(value)
      const outputKeys = ['motionId', 'convertedMotionId', 'outputMotionId', 'generatedMotionId', 'targetMotionId']
      const outputs = value && typeof value === 'object' && !Array.isArray(value) ? outputKeys.map((field) => (value as Record<string, unknown>)[field]).filter((id): id is string => typeof id === 'string') : []
      const referenced = outputs.length ? outputs.some((id) => live.has(id)) : refs.some((id) => live.has(id) && owns(motions, id))
      if (live.has(key) || referenced) {
        retainedConversions.add(key); scan(value); changed = true
      }
    }
  }
  const removedMotionIds = Object.keys(motions).filter((id) => !live.has(id))
  const removedAssetIds = Object.keys(assets).filter((id) => !live.has(id))
  const removedConversionKeys = Object.keys(conversions).filter((key) => !retainedConversions.has(key))
  const removedMotions = new Set(removedMotionIds)
  if (project.scene.content.asset) project.scene.content.asset.motionPath = paths.filter((entry) => !removedMotions.has(entry.id))
  for (const id of removedMotionIds) { delete motions[id]; delete metadata[id] }
  for (const id of removedAssetIds) delete assets[id]
  for (const key of removedConversionKeys) delete conversions[key]
  return { removedMotionIds, removedAssetIds, removedConversionKeys }
}
