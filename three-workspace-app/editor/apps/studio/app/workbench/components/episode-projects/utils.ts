import type { UnifiedProjectRow } from '../../hooks/useWorkbenchDrafts'

export function groupEpisodeProjects(projects: UnifiedProjectRow[]) {
  const groups = new Map<string, { id: string; name?: string; projects: UnifiedProjectRow[] }>()
  for (const project of projects) {
    const id = project.episode?.id ?? 'ungrouped'
    let group = groups.get(id)
    if (!group) { group = { id, name: project.episode?.name, projects: [] }; groups.set(id, group) }
    group.projects.push(project)
  }
  for (const group of groups.values()) group.projects.sort((a, b) => (a.episode?.order ?? 0) - (b.episode?.order ?? 0))
  return [...groups.values()]
}
