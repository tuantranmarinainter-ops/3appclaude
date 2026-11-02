type StorageLike = Pick<Storage, 'getItem' | 'setItem'>

export const PINNED_ROWS_STORAGE_PREFIX = 'topview.builder.timeline.pinned.'

export function pinnedRowsKey(projectId: string): string {
  return `${PINNED_ROWS_STORAGE_PREFIX}${projectId || 'default'}`
}

export function readPinnedRows(storage: StorageLike | null, projectId: string): string[] {
  if (!storage) return []
  try {
    const parsed: unknown = JSON.parse(storage.getItem(pinnedRowsKey(projectId)) ?? '[]')
    return Array.isArray(parsed) ? [...new Set(parsed.filter((item): item is string => typeof item === 'string'))] : []
  } catch {
    return []
  }
}

export function writePinnedRows(storage: StorageLike | null, projectId: string, pinned: readonly string[]): void {
  if (!storage) return
  try {
    storage.setItem(pinnedRowsKey(projectId), JSON.stringify(pinned))
  } catch {
    // Storage off or full: pins only live for this session.
  }
}

export function togglePinned(pinned: readonly string[], nodeId: string): string[] {
  return pinned.includes(nodeId) ? pinned.filter((id) => id !== nodeId) : [...pinned, nodeId]
}

/**
 * Move pinned root rows (with their child rows) to the top in pin order.
 * Everything else keeps its original order. View-only: never touches the document.
 */
export function orderPinnedRows<T extends { row: { nodeId: string; kind: string }; depth: number }>(
  rows: readonly T[],
  pinned: readonly string[],
): T[] {
  if (!pinned.length) return [...rows]
  const groups: T[][] = []
  for (const item of rows) {
    if (item.depth === 0 || !groups.length) groups.push([item])
    else groups[groups.length - 1].push(item)
  }
  const rootId = (group: T[]) => (group[0].row.kind === 'node' ? group[0].row.nodeId : null)
  const pinnedGroups = pinned
    .map((id) => groups.find((group) => rootId(group) === id))
    .filter((group): group is T[] => !!group)
  const pinnedSet = new Set(pinnedGroups)
  return [...pinnedGroups, ...groups.filter((group) => !pinnedSet.has(group))].flat()
}
