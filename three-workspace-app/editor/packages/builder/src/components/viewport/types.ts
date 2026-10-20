/** 操作轴手柄悬停信息；与引擎 `GizmoHoverInfo` 结构一致（组件层不直接引用 engine）。 */
export interface GizmoHoverPayload {
  mode: 'translate' | 'rotate' | 'scale'
  kind: 'axis' | 'plane' | 'uniform'
  /** 大写轴名：X / Y / Z，平面为 XY / YZ / XZ，整体缩放为 UNIFORM。 */
  axis: string
  clientX: number
  clientY: number
}

export type GizmoHoverTipData = Pick<GizmoHoverPayload, 'mode' | 'kind' | 'axis'>
