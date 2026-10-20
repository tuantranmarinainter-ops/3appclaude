export type FeatureWorkspace = 'shared' | 'scene' | 'retarget' | 'animation'

export interface FeatureNode {
  id: string
  parentId: string | null
  label: string
  keywords: string[]
  workspace: FeatureWorkspace
  panelId?: string
  command?: string
  requires: string[]
  spec?: string
}

export function validateFeatureTree(nodes: readonly FeatureNode[], panels: readonly string[], commands: readonly string[] = []): void {
  const byId = new Map<string, FeatureNode>()
  for (const node of nodes) {
    if (typeof node.id !== 'string' || !node.id || byId.has(node.id)) throw new Error(`Feature ${node.id}: duplicate or empty ID`)
    if (typeof node.label !== 'string' || !node.label.trim() || !['shared', 'scene', 'retarget', 'animation'].includes(node.workspace) ||
      !(node.parentId === null || typeof node.parentId === 'string') ||
      !Array.isArray(node.keywords) || !node.keywords.every((word) => typeof word === 'string') ||
      !Array.isArray(node.requires) || !node.requires.every((value) => typeof value === 'string')) throw new Error(`Feature ${node.id}: invalid metadata`)
    if (node.panelId && !panels.includes(node.panelId)) throw new Error(`Feature ${node.id}: unknown panel ${node.panelId}`)
    if (node.command && !commands.includes(node.command)) throw new Error(`Feature ${node.id}: unknown command ${node.command}`)
    byId.set(node.id, node)
  }
  for (const node of nodes) {
    const visited = new Set([node.id])
    let parentId = node.parentId
    while (parentId !== null) {
      if (!byId.has(parentId)) throw new Error(`Feature ${node.id}: missing parent ${parentId}`)
      if (visited.has(parentId)) throw new Error(`Feature ${node.id}: cycle at ${parentId}`)
      visited.add(parentId)
      parentId = byId.get(parentId)!.parentId
    }
    if (!node.panelId && !nodes.some((child) => child.parentId === node.id)) throw new Error(`Feature ${node.id}: leaf has no panel`)
  }
}
