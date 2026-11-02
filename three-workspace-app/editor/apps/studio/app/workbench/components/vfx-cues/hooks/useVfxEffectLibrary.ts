import { useEffect, useState } from 'react'
import type { VfxSheetMeta } from '@topview/3d-builder'
import type { VfxEffectOption } from '../types'
import { vfxEffectOptions } from '../utils'

import { loadVfxPreviews, VFX_PREVIEWS_URL } from '../../../../../src/vfxPreviewClient'
export { VFX_PREVIEWS_URL } from '../../../../../src/vfxPreviewClient'

/**
 * The App 4 baked preview library for the effect picker. An unreachable or
 * empty library is not an error here: the form still accepts a typed name.
 */
export function useVfxEffectLibrary(): { options: VfxEffectOption[]; loading: boolean } {
  const [options, setOptions] = useState<VfxEffectOption[]>([])
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let cancelled = false
    void loadVfxPreviews()
      .then((body: { sheets?: Record<string, VfxSheetMeta> }) => {
        if (!cancelled) setOptions(vfxEffectOptions(body.sheets, VFX_PREVIEWS_URL))
      })
      .catch(() => { /* No readable library on this machine: manual typing still works. */ })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])
  return { options, loading }
}
