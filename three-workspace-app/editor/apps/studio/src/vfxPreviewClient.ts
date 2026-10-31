import type { VfxSheetMeta } from '@topview/3d-builder'
export const VFX_PREVIEWS_URL = '/api/unified/vfx-previews'
let preview: Promise<{ sheets?: Record<string, VfxSheetMeta> }> | undefined
export function loadVfxPreviews(refresh = false): Promise<{ sheets?: Record<string, VfxSheetMeta> }> {
  if (refresh) preview = undefined
  if (!preview) {
    const request = fetch(VFX_PREVIEWS_URL, { credentials: 'same-origin' }).then(async response => {
      if (!response.ok) throw new Error(`VFX preview HTTP ${response.status}`)
      return response.json()
    })
    preview = request
    void request.catch(() => { if (preview === request) preview = undefined })
  }
  return preview
}
