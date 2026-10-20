import type { FeatureNode } from '@bbs/animation-workspace-shared'

export function visibleFeatures(nodes: readonly FeatureNode[], expanded: ReadonlySet<string>): FeatureNode[] {
  const visible = new Set<string>()
  return nodes.filter((node) => {
    if (node.parentId !== null && (!visible.has(node.parentId) || !expanded.has(node.parentId))) return false
    visible.add(node.id)
    return true
  })
}

export function restoreExpansion(value: string | null, groups: readonly string[]): Set<string> {
  try {
    const parsed: unknown = JSON.parse(value ?? 'null')
    if (Array.isArray(parsed) && parsed.every((id) => typeof id === 'string')) return new Set(parsed.filter((id) => groups.includes(id)))
  } catch { /* Storage is optional. */ }
  return new Set(['1.4'])
}

export function isEditing(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && !!target.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"])')
}
