import type { DraftNode } from '../../contract/types'
import type { StageGraph } from './graph'

function setNodeObjectVisibility(graph: StageGraph, node: DraftNode, visible: boolean): void {
  const character = graph.characters.get(node.id)
  if (character) character.root.visible = visible
  const prop = graph.props.get(node.id)
  if (prop) prop.visible = visible
  const prim = graph.primitives.get(node.id)
  if (prim) prim.visible = visible
  const group = graph.groups.get(node.id)
  if (group) group.visible = visible
  const cam = graph.cameras.get(node.id)
  if (cam) cam.gizmo.group.visible = visible
}

export function applyNodeVisibility(graph: StageGraph): void {
  const nodes = graph.doc?.content.nodes ?? [...graph.nodeById.values()]
  for (const n of nodes) {
    setNodeObjectVisibility(graph, n, n.visible !== false)
  }
}

/**
 * Lớp xem N5 (chỉ hiện nhân vật / ẩn hậu cảnh): chỉ chạy trong vòng render tương tác,
 * SAU khi evaluate đã đặt visibility theo tài liệu — node bị bộ lọc xem ẩn sẽ bị tắt thêm.
 * Đường xuất/render không qua đây: chúng gọi evaluate() (đặt lại visibility theo tài liệu)
 * rồi render thẳng, nên khung xuất luôn đầy đủ. Hàm này không ghi gì vào tài liệu.
 */
export function applyViewVisibility(graph: StageGraph, viewHidden: ReadonlySet<string>): void {
  if (viewHidden.size === 0) return
  const nodes = graph.doc?.content.nodes ?? [...graph.nodeById.values()]
  for (const n of nodes) {
    if (!viewHidden.has(n.id)) continue
    setNodeObjectVisibility(graph, n, false)
  }
}
