import { useEffect, useState } from 'react'
import type { UnifiedProject } from '@bbs/animation-workspace-shared'
import type { VfxSheet, VfxSpriteCue } from '@topview/3d-builder'
import { getLiveStudio, subscribeLiveStudio } from '../../../../../src/devtools/liveStudio'
import { loadVfxPreviews, VFX_PREVIEWS_URL } from '../../../../../src/vfxPreviewClient'

/** Load only after a live scene exists, then yield its first paint before any VFX requests. */
export function useVfxPreview(project: UnifiedProject | null): void {
  const [sheets, setSheets] = useState<Record<string, VfxSheet>>({})
  const raw = (project?.extensions as { vfxCues?: { cues?: unknown } } | undefined)?.vfxCues?.cues
  const cues = Array.isArray(raw) ? raw as VfxSpriteCue[] : []
  const key = JSON.stringify(cues)
  useEffect(() => {
    let cancelled = false
    let scheduled = false
    let first = 0, second = 0
    const schedule = () => {
      if (!cues.length || !getLiveStudio() || scheduled) return
      scheduled = true
      first = requestAnimationFrame(() => { second = requestAnimationFrame(() => {
        void loadVfxPreviews().then(body => {
          if (cancelled) return
          const used = new Set(cues.map(cue => cue.effect))
          setSheets(Object.fromEntries(Object.entries(body.sheets ?? {}).filter(([effect]) => used.has(effect)).map(([effect, meta]) => [effect, { url: `${VFX_PREVIEWS_URL}/${encodeURIComponent(effect)}`, meta }])))
        }).catch(() => { /* Keep labelled placeholders when previews are unavailable. */ })
      }) })
    }
    schedule()
    const unsubscribe = subscribeLiveStudio(schedule)
    return () => { cancelled = true; cancelAnimationFrame(first); cancelAnimationFrame(second); unsubscribe() }
    // The serialized cue list represents its contents.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  useEffect(() => {
    const apply = () => getLiveStudio()?.stage.setVfxCues(cues, sheets)
    apply()
    const unsubscribe = subscribeLiveStudio(apply)
    return () => { unsubscribe(); getLiveStudio()?.stage.setVfxCues([], {}) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, sheets])
}
