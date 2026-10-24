import type { UnifiedProject } from '@bbs/animation-workspace-shared'

/** Library edits must use the character model, not an animation-only solver asset. */
export function libraryAnimationEntry(project: UnifiedProject, characterId: string, motionId?: string) {
  const character=project.characters[characterId]
  const node=character&&project.scene.content.nodes.find(node=>node.id===character.nodeId)
  if(typeof node?.metadata?.libraryCharacterId!=='string')return null
  const clip=project.scene.content.timeline.animation.motionClips.find(clip=>{
    const binding=project.bindings[clip.id]
    return binding?.characterId===characterId&&(!motionId||binding.motionId===motionId)
  })
  if(!clip)throw new Error('Hãy đặt một Nháp của nhân vật lên timeline trước khi tạo hoặc chỉnh animation trong thư viện.')
  return {range:[clip.frameStart,clip.frameEnd] as [number,number],blank:!motionId}
}
