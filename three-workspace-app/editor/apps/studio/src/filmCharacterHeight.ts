import { Quaternion, Vector3 } from 'three'
import type { UnifiedProject } from '@bbs/animation-workspace-shared'
import { filmSceneWorldMatrices } from './filmSceneWorld'

/** Only an explicit height snapshot opts a Character into calibrated uniform Film scaling. */
export function filmCharacterHeight(project: UnifiedProject, nodeId: string, frame: number): { actorScale: number; heightBlocks?: number } {
  const node = project.scene.content.nodes.find((item) => item.id === nodeId), metadata = node?.metadata
  const target = metadata?.libraryHeightBlocks, source = metadata?.librarySourceHeightMeters, calibrated = metadata?.libraryHeightScale
  if (![target, source, calibrated].every((value) => typeof value === 'number' && Number.isFinite(value) && value > 0) || Math.abs(target / source - calibrated) > 1e-6 * calibrated) return { actorScale: 1 }
  const scale = new Vector3()
  filmSceneWorldMatrices(project, frame)(nodeId).decompose(new Vector3(), new Quaternion(), scale)
  const scalar = scale.x
  if (!(scalar > 0) || scale.toArray().some((value) => Math.abs(value - scalar) > 1e-6 * Math.max(1, scalar))) return { actorScale: 1 }
  return { actorScale: scalar, heightBlocks: target * scalar / calibrated }
}

/** FS 2.7 fresh ModelConfig.scale is 1; BOBJ vertices have no implicit unit conversion. */
export function originalFilmHeightTransform(importHeightMeters: number, importUnitMeters: number, floorNative: number, heightBlocks: number, actorScale: number) {
  if (![importHeightMeters, importUnitMeters, heightBlocks, actorScale].every((value) => Number.isFinite(value) && value > 0) || !Number.isFinite(floorNative)) throw new TypeError('Original model height calibration requires finite positive measurements')
  const rawHeight = importHeightMeters / importUnitMeters
  const formScale = heightBlocks / rawHeight
  if (!(formScale > 0 && formScale <= 1000)) throw new TypeError('Original model height calibration exceeds the Film form scale range')
  return { formScale, formOffsetY: -floorNative * formScale, sourcePositionScale: actorScale * importUnitMeters / formScale }
}
