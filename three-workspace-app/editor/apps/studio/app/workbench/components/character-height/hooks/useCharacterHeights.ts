import { useEffect, useRef, useState } from 'react'
import type { UnifiedProject } from '@bbs/animation-workspace-shared'
import { characterHeightCache, HEIGHT_PROFILE_EVENT, HEIGHT_PROFILE_STORAGE, type HeightProfile } from '../utils'

export function useCharacterHeights(project: UnifiedProject) {
  // Revisions and transforms do not change profile identity. Undo/redo must not query the library.
  const fingerprint = JSON.stringify(Array.from(new Map(project.scene.content.nodes.flatMap(node => {
    const id = node.metadata?.libraryCharacterId
    return typeof id === 'string' ? [[id, { charId: id, fingerprint: JSON.stringify([node.metadata?.libraryModelFingerprint, node.metadata?.libraryHeightBlocks]) }] as const] : []
  })).values()).sort((a, b) => a.charId.localeCompare(b.charId)))
  const scope = JSON.stringify([project.projectId, fingerprint])
  const openedProject = useRef<string | null>(null)
  const [state, setState] = useState<{ scope: string; heights: Record<string, number> }>({ scope: '', heights: {} })
  useEffect(() => {
    const profiles = JSON.parse(fingerprint) as HeightProfile[]
    // Opening a project checks profiles once, including changes made by external tools.
    // Keep the ref across StrictMode's effect replay so concurrent/replayed reads still coalesce.
    if (openedProject.current !== project.projectId) {
      for (const profile of profiles) characterHeightCache.invalidate(profile.charId)
      openedProject.current = project.projectId
    }
    let alive = true
    let sequence = 0
    const refresh = async () => {
      const request = ++sequence
      const rows = await Promise.all(profiles.map(async profile => {
        try { return [profile.charId, await characterHeightCache.read(profile)] as const } catch { return [profile.charId, undefined] as const }
      }))
      if (alive && request === sequence) setState({ scope, heights: Object.fromEntries(rows.filter((row): row is readonly [string, number] => row[1] !== undefined)) })
    }
    const invalidate = (charId: unknown) => {
      if (typeof charId !== 'string') return
      if (profiles.some(profile => profile.charId === charId)) void refresh()
    }
    const onProfile = (event: Event) => invalidate((event as CustomEvent<{ charId?: string }>).detail?.charId)
    const onStorage = (event: StorageEvent) => {
      if (event.key !== HEIGHT_PROFILE_STORAGE || !event.newValue) return
      try { invalidate(JSON.parse(event.newValue).charId) } catch { /* Ignore unrelated/malformed storage. */ }
    }
    window.addEventListener(HEIGHT_PROFILE_EVENT, onProfile)
    window.addEventListener('storage', onStorage)
    void refresh()
    return () => { alive = false; window.removeEventListener(HEIGHT_PROFILE_EVENT, onProfile); window.removeEventListener('storage', onStorage) }
  }, [fingerprint, scope, project.projectId])
  return state.scope === scope ? state.heights : {}
}
