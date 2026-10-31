'use client'

import { useState } from 'react'
import { useCharacterHeights } from './hooks/useCharacterHeights'
import type { UnifiedProject } from '@bbs/animation-workspace-shared'

export function CharacterHeightNotice({ project, selectedNodeId }: { project: UnifiedProject; selectedNodeId: string | null }) {
  const heights = useCharacterHeights(JSON.stringify([...new Set(project.scene.content.nodes.map(node => node.metadata?.libraryCharacterId).filter(id => typeof id === 'string'))].sort()))
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
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
  return <div style={{ position: 'absolute', top: 8, left: 8, zIndex: 5, background: '#20242cee', padding: 8, borderRadius: 6 }}>
    <small>Lưới: 1 ô = 1 block · vạch đậm mỗi 5 block</small>
    {displayed !== undefined && <div>{selected!.name} · {displayed.toLocaleString('vi-VN', { maximumFractionDigits: 2 })} block</div>}
    {!!changed.length && <div role="status">Nhân vật đã đổi chiều cao — cập nhật trong cảnh? <button type="button" disabled={busy} onClick={() => void update()}>{busy ? 'Đang cập nhật…' : 'Đồng ý cập nhật'}</button><small> Chỉ cập nhật khi anh/chị đồng ý.</small></div>}
    {message && <div role="status">{message}</div>}
  </div>
}
