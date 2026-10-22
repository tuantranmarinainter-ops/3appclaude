import { useEffect, useState } from 'react'
import type { UnifiedProject } from '@bbs/animation-workspace-shared'
import type { VfxSheet, VfxSpriteCue } from '@topview/3d-builder'
import { getLiveStudio, subscribeLiveStudio } from '../../../../../src/devtools/liveStudio'

const SHEETS_URL = '/api/unified/vfx-previews'

/** Push the project's VFX cues and the baked App 4 sprite sheets into App 2's viewport (view only). */
export function useVfxPreview(project: UnifiedProject | null): void {
  const [sheets, setSheets] = useState<Record<string, VfxSheet>>({})
  useEffect(() => {
    let cancelled = false
    void fetch(SHEETS_URL, { credentials: 'same-origin' }).then((response) => response.ok ? response.json() : { sheets: {} }).then((body: { sheets?: Record<string, VfxSheet['meta']> }) => {
      if (cancelled) return
      setSheets(Object.fromEntries(Object.entries(body.sheets ?? {}).map(([effect, meta]) => [effect, { url: `${SHEETS_URL}/${encodeURIComponent(effect)}`, meta }])))
    }).catch(() => { /* No baked sheets: the viewport draws labelled placeholders. */ })
    return () => { cancelled = true }
  }, [])
  const raw = (project?.extensions as { vfxCues?: { cues?: unknown } } | undefined)?.vfxCues?.cues
  const cues = Array.isArray(raw) ? raw as VfxSpriteCue[] : []
  const key = JSON.stringify(cues)
  useEffect(() => {
    const apply = () => getLiveStudio()?.stage.setVfxCues(cues, sheets)
    apply()
    const unsubscribe = subscribeLiveStudio(apply)
    return () => { unsubscribe(); getLiveStudio()?.stage.setVfxCues([], {}) }
    // `key` stands for the cue list contents.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, sheets])
}
