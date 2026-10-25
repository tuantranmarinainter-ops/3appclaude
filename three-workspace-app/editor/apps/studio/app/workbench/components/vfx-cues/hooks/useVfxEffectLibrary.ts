import { useEffect, useState } from 'react'
import type { VfxSheetMeta } from '@topview/3d-builder'
import type { VfxEffectOption } from '../types'
import { vfxEffectOptions } from '../utils'

export const VFX_PREVIEWS_URL = '/api/unified/vfx-previews'

/**
 * The App 4 baked preview library for the effect picker. An unreachable or
 * empty library is not an error here: the form still accepts a typed name.
 */
export function useVfxEffectLibrary(): { options: VfxEffectOption[]; loading: boolean } {
  const [options, setOptions] = useState<VfxEffectOption[]>([])
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let cancelled = false
    void fetch(VFX_PREVIEWS_URL, { credentials: 'same-origin' })
      .then((response) => response.ok ? response.json() : { sheets: {} })
      .then((body: { sheets?: Record<string, VfxSheetMeta> }) => {
        if (!cancelled) setOptions(vfxEffectOptions(body.sheets, VFX_PREVIEWS_URL))
      })
      .catch(() => { /* No readable library on this machine: manual typing still works. */ })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])
  return { options, loading }
}
