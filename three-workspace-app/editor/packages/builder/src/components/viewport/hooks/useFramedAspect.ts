import { useCallback, useSyncExternalStore } from 'react'
import { useDirector } from '../../../bridge/DirectorContext'

/** 引擎实际取景用的画幅比例；取景框必须跟它走，否则框内画面和机位预览对不上。 */
export function useFramedAspect(): number | null {
  const { stage } = useDirector()
  const subscribe = useCallback((onChange: () => void) => stage.on('camera:frame', onChange), [stage])
  const read = useCallback(() => stage.readFramedAspect?.() ?? null, [stage])
  return useSyncExternalStore(subscribe, read, () => null)
}
