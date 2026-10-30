import { useEffect, useState } from 'react'
import { LIBRARY_CHANGED, libraryJson } from '../../../../../src/libraryClient'

/** Scene membership, not revision, determines when profiles are needed. */
export function useCharacterHeights(characterIds: string): Record<string, number> {
  const [heights, setHeights] = useState<Record<string, number>>({})
  useEffect(() => {
    let alive = true
    let generation = 0
    const refresh = async () => {
      const current = ++generation
      if (!JSON.parse(characterIds).length) { setHeights({}); return }
      try {
        const body = await libraryJson<{ characters: Array<{ charId: string; heightBlocks?: number }> }>('/api/library?characters=1')
        if (alive && current === generation) setHeights(Object.fromEntries(body.characters.filter(c => Number.isFinite(c.heightBlocks)).map(c => [c.charId, c.heightBlocks!])))
      } catch { /* Keep saved scene scale when the library is unavailable. */ }
    }
    void refresh()
    window.addEventListener(LIBRARY_CHANGED, refresh)
    return () => { alive = false; window.removeEventListener(LIBRARY_CHANGED, refresh) }
  }, [characterIds])
  return heights
}
