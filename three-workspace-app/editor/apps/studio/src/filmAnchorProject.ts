import { Vector3 } from 'three'
import type { UnifiedProject } from '@bbs/animation-workspace-shared'
import { filmSceneWorldMatrices } from './filmSceneWorld'
import { resolveFilmWorldAnchor, type FilmWorldAnchor } from './filmWorldAnchor'

/** Resolve the chosen scene pivot before segmenting; sourceOrigin remains the legacy fallback. */
export function projectFilmAnchor(project: UnifiedProject, anchor: FilmWorldAnchor | undefined, frame: number, characterIds: readonly string[], propIds: readonly string[] = [], fallbackSource?: readonly number[]) {
  if (anchor?.mode === 'scene-origin' || anchor?.pivot || anchor?.sourceOrigin) return resolveFilmWorldAnchor(anchor, [0, 0, 0])
  if (!anchor?.pivotCharacterId && fallbackSource) return resolveFilmWorldAnchor(anchor, fallbackSource)
  const id = anchor?.pivotCharacterId ?? characterIds[0]
  const nodeId = id ? project.characters[id]?.nodeId : propIds[0]
  if (anchor?.pivotCharacterId && !nodeId) throw new TypeError('Nhân vật làm điểm neo không còn trong dự án')
  if (!nodeId && fallbackSource) return resolveFilmWorldAnchor(anchor, fallbackSource)
  const cameraId = project.scene.content.editorial?.sequences.flatMap((sequence) => sequence.clips).find((clip) => clip.sourceFrameStart <= frame && clip.sourceFrameEnd >= frame)?.cameraNodeId
  const fallbackNode = nodeId ?? cameraId
  const position = fallbackNode ? new Vector3().setFromMatrixPosition(filmSceneWorldMatrices(project, frame)(fallbackNode)) : new Vector3()
  return resolveFilmWorldAnchor(anchor, [position.x, position.y, position.z])
}
