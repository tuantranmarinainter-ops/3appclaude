import { useCallback, useSyncExternalStore } from 'react'
import { useDirector } from '../../../bridge/DirectorContext'

/** Project film aspect while BBS-look camera framing is active. */
export function useFilmFrameAspect(): number | null {
  const { stage } = useDirector()
  const subscribe = useCallback((onChange: () => void) => stage.on('camera:frame', onChange), [stage])
  const read = useCallback(() => stage.readFilmFrameAspect(), [stage])
  return useSyncExternalStore(subscribe, read, () => null)
}
