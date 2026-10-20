import type { DirectorDocument } from '../../contract/types'
import type { TranslateFn } from '../../locale/types'
import type { GizmoHoverTipData } from './types'

/** Moving a camera changes its derived orientation; that is not a manual rotation. */
export function cameraGizmoCommitPatch(nodeId: string, prop: string | null, position: number[] | null, rotation: number[] | null) {
  return { nodeId, ...(position ? { position } : {}), ...(prop === 'rotation' && rotation ? { rotation } : {}) }
}

export function isCameraNode(doc: DirectorDocument | null, nodeId: string): boolean {
  return !!doc?.content.nodes.some((n) => n.id === nodeId && n.type === 'camera')
}

export function isPathNode(doc: DirectorDocument | null, nodeId: string): boolean {
  return !!doc?.content.nodes.some((n) => n.id === nodeId && n.type === 'path')
}

export function readGizmoTransform(
  stage: { readAttachedTransform: (prop: 'position' | 'rotation' | 'scale', nodeId?: string) => number[] | null },
  nodeId?: string,
) {
  return {
    position: stage.readAttachedTransform('position', nodeId),
    rotation: stage.readAttachedTransform('rotation', nodeId),
    scale: stage.readAttachedTransform('scale', nodeId),
  }
}

export function attachedGizmoIds(stage: {
  gizmoAttachedNodeIds?: () => string[]
  gizmoAttachedNodeId: () => string | null
}): string[] {
  const ids = stage.gizmoAttachedNodeIds?.() ?? []
  if (ids.length) return ids
  const primary = stage.gizmoAttachedNodeId()
  return primary ? [primary] : []
}

/** Gizmo 手柄悬停提示文案：变换类型 + 轴向/平面，走 i18n。 */
export function gizmoHoverLabel(t: TranslateFn, info: GizmoHoverTipData): string {
  const axis = info.axis
  if (info.mode === 'rotate') return t('viewport.gizmoRotateAxis', { axis })
  if (info.mode === 'scale') {
    return info.kind === 'uniform' ? t('viewport.gizmoScaleUniform') : t('viewport.gizmoScaleAxis', { axis })
  }
  return info.kind === 'plane' ? t('viewport.gizmoTranslatePlane', { axis }) : t('viewport.gizmoTranslateAxis', { axis })
}
