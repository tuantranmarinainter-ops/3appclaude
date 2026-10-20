import type { DirectorEngine } from '../engine/DirectorEngine'
import { useDirector } from './DirectorContext'

export { EDITOR_EXPORT_CAMERA_ID } from '../engine/DirectorEngine'
export type { EditorViewDirection } from '../engine/interact/camera/axisView'
export type { DirectorEngine } from '../engine/DirectorEngine'

export function useEngine(): DirectorEngine {
  return useDirector().stage
}
