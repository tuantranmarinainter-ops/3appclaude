import type { DraftNode } from './types'

/**
 * Bộ lọc CHỈ đổi cách xem cảnh trong khung 3D (N5): không ghi vào tài liệu,
 * không ảnh hưởng render/xuất. Trạng thái sống ở EditorStore + Stage (view-only),
 * tài liệu project không có trường nào cho hai chế độ này.
 */
export interface SceneViewFilter {
  /** Chỉ hiện nhân vật: ẩn mọi node không phải nhân vật (trừ node đang chứa nhân vật). */
  charactersOnly: boolean
  /** Ẩn cả nhóm Hậu cảnh (prop / primitive / tên set_*). */
  backgroundHidden: boolean
}

export const EMPTY_SCENE_VIEW_FILTER: SceneViewFilter = {
  charactersOnly: false,
  backgroundHidden: false,
}

/** Prop dựng cảnh của storyboard/BBS thường đặt tên set_* (set_ban, set_tuong...). */
const BACKGROUND_NAME_PATTERN = /^set[_-]/i

/** Node thuộc nhóm "Hậu cảnh": prop, primitive, hoặc node mang tên set_*. Nhân vật/camera/đường đi không bao giờ là hậu cảnh. */
export function isBackgroundNode(node: Pick<DraftNode, 'type' | 'name'>): boolean {
  if (node.type === 'character' || node.type === 'camera' || node.type === 'path') return false
  if (node.type === 'prop' || node.type === 'primitive') return true
  return BACKGROUND_NAME_PATTERN.test(node.name.trim())
}

/**
 * Tính tập node bị bộ lọc xem ẩn đi. Thuần dữ liệu: không sửa `nodes`.
 * Một node chứa nhân vật (chính nó hoặc bất kỳ node con nào là character) không bao giờ bị ẩn,
 * vì ẩn node cha trong three.js sẽ ẩn cả nhân vật bên trong.
 */
export function computeViewHiddenNodeIds(
  nodes: readonly DraftNode[],
  filter: SceneViewFilter,
): Set<string> {
  const hidden = new Set<string>()
  if (!filter.charactersOnly && !filter.backgroundHidden) return hidden
  const childrenOf = new Map<string, DraftNode[]>()
  for (const node of nodes) {
    if (!node.parentId) continue
    const list = childrenOf.get(node.parentId)
    if (list) list.push(node)
    else childrenOf.set(node.parentId, [node])
  }
  const containsCharacter = new Map<string, boolean>()
  const resolveContainsCharacter = (node: DraftNode, seen: Set<string>): boolean => {
    const cached = containsCharacter.get(node.id)
    if (cached !== undefined) return cached
    if (seen.has(node.id)) return false
    seen.add(node.id)
    let result = node.type === 'character'
    if (!result) {
      for (const child of childrenOf.get(node.id) ?? []) {
        if (resolveContainsCharacter(child, seen)) {
          result = true
          break
        }
      }
    }
    containsCharacter.set(node.id, result)
    return result
  }
  for (const node of nodes) {
    if (node.type === 'character') continue
    if (resolveContainsCharacter(node, new Set())) continue
    if (filter.charactersOnly) hidden.add(node.id)
    else if (filter.backgroundHidden && isBackgroundNode(node)) hidden.add(node.id)
  }
  return hidden
}
