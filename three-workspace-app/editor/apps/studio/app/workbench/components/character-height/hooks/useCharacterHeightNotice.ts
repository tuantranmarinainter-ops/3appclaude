import { useState } from 'react'
import type { UnifiedProject } from '@bbs/animation-workspace-shared'
import { useCharacterHeights } from './useCharacterHeights'

export function useCharacterHeightNotice(project: UnifiedProject, selectedNodeId: string | null) {
  const heights = useCharacterHeights(project)
  const [status, setStatus] = useState({ projectId: project.projectId, busy: false, message: '' })
  const setMessage = (message: string) => setStatus(current => ({ ...current, projectId: project.projectId, message }))
  const setBusy = (busy: boolean) => setStatus(current => ({ ...current, projectId: project.projectId, busy }))
  const changed = project.scene.content.nodes.filter(node => typeof node.metadata?.libraryCharacterId === 'string' && heights[node.metadata.libraryCharacterId] !== undefined && heights[node.metadata.libraryCharacterId] !== node.metadata.libraryHeightBlocks)
  const selected = project.scene.content.nodes.find(node => node.id === selectedNodeId && node.type === 'character')
  const target = Number(selected?.metadata?.libraryHeightBlocks)
  const factor = Number(selected?.metadata?.libraryHeightScale)
  const displayed = target > 0 && factor > 0 && selected ? target * selected.transform.scale.y / factor : undefined
  const update = async () => {
    setBusy(true); setMessage('')
    try {
      const response = await fetch('/api/library', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ operation: 'update-scene-heights', projectId: project.projectId, expectedRevision: project.revision }) })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error)
      window.dispatchEvent(new CustomEvent('bbs-unified-project-commit', { detail: { projectId: project.projectId } }))
      setMessage('Đã cập nhật chiều cao trong cảnh.')
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)) }
    finally { setBusy(false) }
  }
  return { changed, selected, displayed, update, busy: status.projectId === project.projectId && status.busy, message: status.projectId === project.projectId ? status.message : '' }
}
