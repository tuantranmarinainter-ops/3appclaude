import type { UnifiedProjectRow } from '../../hooks/useWorkbenchDrafts'
import { DraftCard } from '../DraftCard'
import { groupEpisodeProjects } from './utils'

export function EpisodeProjects({ projects, onOpen }: { projects: UnifiedProjectRow[]; onOpen: (id: string) => void }) {
  return <>{groupEpisodeProjects(projects).map((group) => <section key={group.id}>
    {group.name && <h3>{group.name}</h3>}
    <div className="wb-grid">{group.projects.map((project) => <DraftCard key={project.id} draft={project} deletable={false} onOpen={onOpen} />)}</div>
  </section>)}</>
}
