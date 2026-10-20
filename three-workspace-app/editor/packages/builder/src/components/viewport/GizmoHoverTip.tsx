import type { Ref } from 'react'
import { createPortal } from 'react-dom'
import { useT } from '../../locale'
import { usePortalRoot } from '../overlay/PortalRoot'
import type { GizmoHoverTipData } from './types'
import { gizmoHoverLabel } from './utils'

/** 悬停在操作轴手柄上时跟随鼠标的提示：变换类型 + 轴向/平面。 */
export function GizmoHoverTip({
  tip,
  tipRef,
}: {
  tip: GizmoHoverTipData | null
  tipRef: Ref<HTMLDivElement>
}) {
  const t = useT()
  const portal = usePortalRoot()
  if (!tip || !portal) return null
  return createPortal(
    <div ref={tipRef} className="t3d-tooltip t3d-gizmo-hover-tip" role="tooltip">
      <span>{gizmoHoverLabel(t, tip)}</span>
    </div>,
    portal,
  )
}
