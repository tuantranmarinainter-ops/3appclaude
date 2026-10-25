import { useEffect, useState } from 'react'
import { useDirector } from '../../../bridge/DirectorContext'
import {
  DEFAULT_GROUND_VIEW_OPTIONS,
  normalizeGroundViewOptions,
  type GroundViewOptions,
} from '../../../contract/groundView'
import { browserPanelStorage } from '../../common/panelLayout'

export const GROUND_VIEW_STORAGE_KEY = 't3d.ground-view.v1'

function readStoredOptions(): GroundViewOptions {
  const storage = browserPanelStorage()
  if (!storage) return { ...DEFAULT_GROUND_VIEW_OPTIONS }
  try {
    const raw = storage.getItem(GROUND_VIEW_STORAGE_KEY)
    if (!raw) return { ...DEFAULT_GROUND_VIEW_OPTIONS }
    return normalizeGroundViewOptions(JSON.parse(raw) as Partial<GroundViewOptions>)
  } catch {
    return { ...DEFAULT_GROUND_VIEW_OPTIONS }
  }
}

/**
 * Tuỳ chọn sàn UV checker (N6): nhớ ở localStorage, đẩy xuống Stage qua facade.
 * Stage chỉ áp khi vẽ khung tương tác — lựa chọn này không vào tài liệu project/film.
 */
export function useGroundViewOptions(): readonly [
  GroundViewOptions,
  (next: GroundViewOptions) => void,
] {
  const { stage } = useDirector()
  const [options, setOptions] = useState<GroundViewOptions>(readStoredOptions)
  useEffect(() => {
    stage.setGroundViewOptions(options)
    const storage = browserPanelStorage()
    if (!storage) return
    try {
      storage.setItem(GROUND_VIEW_STORAGE_KEY, JSON.stringify(options))
    } catch {
      // Storage can be disabled or full; the choice still applies for this session.
    }
  }, [stage, options])
  return [options, setOptions] as const
}
