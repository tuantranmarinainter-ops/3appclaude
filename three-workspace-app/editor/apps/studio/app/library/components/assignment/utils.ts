export type AssignmentAction = { uuid: string; rig: string; ownerCharId?: string; skeletonKind?: string }
export const ASSIGNMENT_GROUPS = [
  { id: 'own', label: 'Của nhân vật này' },
  { id: 'mixamo', label: 'Mixamo65 (tự chuyển)' },
  { id: 'minecraft', label: 'Minecraft20 cùng rig' },
] as const
export type AssignmentGroupId = typeof ASSIGNMENT_GROUPS[number]['id']

/** Native skeleton metadata takes precedence over a pack's compatibility label. */
export function assignmentGroup(action: AssignmentAction, charId: string): AssignmentGroupId | null {
  if (action.ownerCharId === charId) return 'own'
  const rig = action.skeletonKind ?? action.rig
  if (rig === 'mixamo65') return 'mixamo'
  if (rig === 'minecraft20') return 'minecraft'
  return null
}

export function assignmentActions<T extends AssignmentAction>(rows: readonly T[], charId: string): T[] {
  const seen = new Set<string>()
  return rows.filter(row => {
    if (seen.has(row.uuid) || !assignmentGroup(row, charId)) return false
    seen.add(row.uuid)
    return true
  })
}

/** Read every canonical page, including actions outside the selected owner. */
export async function loadAssignmentPages<T>(load: (offset: number) => Promise<{ items: T[]; total: number }>): Promise<T[]> {
  const rows: T[] = []
  for (let offset = 0; ;) {
    const page = await load(offset)
    rows.push(...page.items)
    offset += page.items.length
    if (!page.items.length || offset >= page.total) return rows
  }
}

/** Imported native BOBJ models can retain custom-preserved profiles. */
export function assignmentTargetRig(family: string | undefined, nativeBaseRig?: string): string | undefined {
  return family === 'minecraft20' || family === 'custom-preserved' && nativeBaseRig === 'minecraft20' ? 'minecraft20' : family
}
