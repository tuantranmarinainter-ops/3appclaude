import type { DraftNode } from '../../contract/types'
import { isBackgroundNode } from '../../contract/sceneView'
import type { TranslateFn } from '../../locale'
import { isDerivedTransformPath } from '../../evaluate/path/deriveWalk'
import { displayNodeName } from '../displayNames'

export { isDerivedTransformPath }

export function tOr(t: TranslateFn, key: string, fallback: string): string {
  const value = t(key)
  return value === key ? fallback : value
}

export function catalogPreviewSrc(url?: string, key?: string): string | undefined {
  const value = url?.trim() || key?.trim()
  return value || undefined
}

export function matchesQuery(name: string, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return name.toLowerCase().includes(q)
}

export function groupByCategory<T extends { category?: string }>(
  items: T[],
  fallback = '',
): Array<{ category: string; items: T[] }> {
  const map = new Map<string, T[]>()
  for (const item of items) {
    const key = item.category?.trim() || fallback
    const list = map.get(key)
    if (list) list.push(item)
    else map.set(key, [item])
  }
  return [...map.entries()].map(([category, grouped]) => ({ category, items: grouped }))
}

export interface TreeRow {
  id: string
  name: string
  type: DraftNode['type'] | 'scene' | 'background'
  depth: number
  node?: DraftNode
}

export function buildObjectRows(nodes: DraftNode[], query: string, t: TranslateFn): TreeRow[] {
  const byParent = new Map<string | null, DraftNode[]>()
  for (const node of nodes) {
    if (isDerivedTransformPath(node)) continue
    const parent = node.parentId ?? null
    const list = byParent.get(parent)
    if (list) list.push(node)
    else byParent.set(parent, [node])
  }
  const walk = (parentId: string | null, depth: number): TreeRow[] => {
    const children = byParent.get(parentId) ?? []
    return children.flatMap((node) => [
      { id: node.id, name: displayNodeName(t, node), type: node.type, depth, node },
      ...walk(node.id, depth + 1),
    ])
  }
  const rows = walk(null, 0)
  if (!query.trim()) {
    const listed = [...byParent.values()].flat()
    return [
      { id: '__scene__', name: '', type: 'scene', depth: 0 },
      ...groupBackgroundRows(rows, listed),
    ]
  }
  return rows.filter((row) => {
    const persist = row.node?.name ?? row.name
    return matchesQuery(persist, query) || matchesQuery(row.name, query)
  })
}

/** Node gốc của một cụm hậu cảnh có thể gom: chính nó là hậu cảnh và mọi tổ tiên cũng là hậu cảnh (hoặc không có tổ tiên). */
function backgroundClusterRootId(node: DraftNode, byId: Map<string, DraftNode>): string | null {
  if (!isBackgroundNode(node)) return null
  let top = node
  let cursor = node
  const seen = new Set<string>([node.id])
  while (cursor.parentId && !seen.has(cursor.parentId)) {
    seen.add(cursor.parentId)
    const parent = byId.get(cursor.parentId)
    if (!parent) break
    if (!isBackgroundNode(parent)) return null
    top = parent
    cursor = parent
  }
  return top.id
}

/**
 * N5: chuyển các cụm hậu cảnh (prop / primitive / set_* ở gốc cây) xuống cuối danh sách,
 * nằm dưới một dòng nhóm "Hậu cảnh". Node hậu cảnh lồng trong node không phải hậu cảnh
 * (vd. prop gắn vào nhân vật) giữ nguyên vị trí để không mất ngữ cảnh cha–con.
 */
export function groupBackgroundRows(rows: TreeRow[], nodes: DraftNode[]): TreeRow[] {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const roots = new Set<string>()
  for (const node of nodes) {
    const rootId = backgroundClusterRootId(node, byId)
    if (rootId) roots.add(rootId)
  }
  if (roots.size === 0) return rows
  const kept: TreeRow[] = []
  const block: TreeRow[] = []
  let i = 0
  while (i < rows.length) {
    const row = rows[i]!
    if (row.node && roots.has(row.id)) {
      block.push({ ...row, depth: row.depth + 1 })
      i += 1
      while (i < rows.length && rows[i]!.depth > row.depth) {
        block.push({ ...rows[i]!, depth: rows[i]!.depth + 1 })
        i += 1
      }
    } else {
      kept.push(row)
      i += 1
    }
  }
  if (block.length === 0) return rows
  return [...kept, { id: '__background__', name: '', type: 'background', depth: 0 }, ...block]
}

export function uniqueCategories(
  facets: string[],
  items: Array<{ category?: string }> | null,
): string[] {
  const fromItems = [...new Set((items ?? []).map((i) => i.category?.trim()).filter(Boolean))] as string[]
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of [...facets, ...fromItems]) {
    if (!value || seen.has(value)) continue
    seen.add(value)
    out.push(value)
  }
  return out
}

export function sectionDomId(tab: string, key: string): string {
  return `t3d-leftrail-sec-${tab}-${key.replace(/[^\w\u4e00-\u9fff-]+/g, '-')}`
}

export function treeIconKind(type: TreeRow['type']): 'scene' | 'character' | 'prop' | 'camera' | 'object' {
  if (type === 'scene' || type === 'background') return 'scene'
  if (type === 'character') return 'character'
  if (type === 'camera') return 'camera'
  if (type === 'prop' || type === 'primitive') return 'prop'
  return 'object'
}
