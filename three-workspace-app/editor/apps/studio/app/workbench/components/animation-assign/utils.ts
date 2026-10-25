import type { UnifiedProject } from '@bbs/animation-workspace-shared'

export interface AssignActionItem {
  uuid: string
  name: string
  nameVi?: string
  category?: string
  favorite?: boolean
  ownerCharId?: string | null
  rig: string
  status?: string
  durationSeconds?: number
}

export interface AssignNodeOption {
  nodeId: string
  name: string
  characterId: string
  libraryCharacterId: string | null
}

/** Character nodes of the scene with their library link state, in scene order. */
export function assignNodeOptions(project: UnifiedProject): AssignNodeOption[] {
  const byNode = new Map(Object.values(project.characters).map((character) => [character.nodeId, character]))
  return project.scene.content.nodes
    .filter((node) => node.type === 'character')
    .flatMap((node) => {
      const character = byNode.get(node.id)
      if (!character) return []
      const libraryCharacterId = typeof node.metadata?.libraryCharacterId === 'string' ? node.metadata.libraryCharacterId : null
      return [{ nodeId: node.id, name: node.name, characterId: character.id, libraryCharacterId }]
    })
}

/** Favorites first (N1 ★), then by display name. */
export function sortAssignActions(actions: readonly AssignActionItem[]): AssignActionItem[] {
  return [...actions].sort((a, b) => Number(b.favorite ?? false) - Number(a.favorite ?? false) || (a.nameVi || a.name).localeCompare(b.nameVi || b.name, 'vi'))
}

/**
 * Start frame of the shot (editorial clip of the active sequence) that contains the
 * current frame — the "chặn đầu của shot" placement of N1. Falls back to the first
 * shot, then to the timeline start when the project has no editorial sequence yet.
 */
export function shotStartFrame(project: UnifiedProject, currentFrame: number): number {
  const editorial = project.scene.content.editorial
  const sequence = editorial?.sequences.find((item) => item.id === editorial.activeSequenceId) ?? editorial?.sequences[0]
  if (!sequence?.clips.length) return Math.max(0, project.scene.content.timeline.frameStart)
  const containing = sequence.clips.find((clip) => currentFrame >= clip.sourceFrameStart && currentFrame <= clip.sourceFrameEnd)
  return (containing ?? sequence.clips[0]!).sourceFrameStart
}
