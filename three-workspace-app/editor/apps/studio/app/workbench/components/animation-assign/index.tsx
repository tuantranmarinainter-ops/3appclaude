'use client'

import { useEffect, useMemo, useState, type ReactElement } from 'react'
import type { UnifiedProject } from '@bbs/animation-workspace-shared'
import { loadUnifiedProject } from '../../../../src/unifiedApi'
import { getLiveStudio } from '../../../../src/devtools/liveStudio'
import { filterLibraryActions } from '../../../../src/libraryFilters'
import { assignNodeOptions, shotStartFrame, sortAssignActions, type AssignActionItem } from './utils'
import { useAssignData } from './hooks/useAssignData'

type AssignTab = 'own' | 'others' | 'shared'
type Placement = 'shot' | 'frame'

const STATUS_LABEL: Record<string, string> = { draft: 'Nháp', edited: 'Đã chỉnh', approved: 'Đã duyệt' }

/**
 * N1 — "Gán animation": assign a library Action straight onto the selected scene node.
 * The node keeps its identity (no new character is created); an unlinked node is linked
 * to its library character first through the C25 flow. Placement goes through the
 * server-side place-for-node helper so same-rig copies and shared-Action assignment
 * share one code path with the Library page.
 */
export function AnimationAssignPanel({ projectId, project, initialNodeId }: {
  projectId: string
  project: UnifiedProject
  initialNodeId: string | null
}): ReactElement {
  const [currentProject, setCurrentProject] = useState(project)
  const nodes = useMemo(() => assignNodeOptions(currentProject), [currentProject])
  const [nodeId, setNodeId] = useState<string>(() => (initialNodeId && nodes.some((node) => node.nodeId === initialNodeId) ? initialNodeId : nodes[0]?.nodeId ?? ''))
  const node = nodes.find((item) => item.nodeId === nodeId) ?? null
  const [tab, setTab] = useState<AssignTab>('own')
  const [otherCharId, setOtherCharId] = useState('')
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('')
  const [placement, setPlacement] = useState<Placement>('shot')
  const [linkCharId, setLinkCharId] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const data = useAssignData()

  useEffect(() => { setCurrentProject(project) }, [project])
  useEffect(() => { void data.loadOwn(node?.libraryCharacterId ?? null) }, [node?.libraryCharacterId, data.loadOwn])
  useEffect(() => { void data.loadOther(otherCharId || null) }, [otherCharId, data.loadOther])

  const currentFrame = Math.round(getLiveStudio()?.stage.currentFrame ?? currentProject.scene.content.timeline.frameStart)
  const frameStart = placement === 'shot' ? shotStartFrame(currentProject, currentFrame) : currentFrame

  const sourceActions = tab === 'own' ? data.ownActions : tab === 'others' ? data.otherActions : data.sharedActions
  const categories = useMemo(() => [...new Set(sourceActions.map((action) => action.category).filter(Boolean))] as string[], [sourceActions])
  const visibleActions = useMemo(() => sortAssignActions(filterLibraryActions(sourceActions, query, category)), [sourceActions, query, category])

  const refreshProject = async () => {
    try { setCurrentProject((await loadUnifiedProject(projectId)).project) } catch { /* the overlay refresh covers the canvas */ }
    window.dispatchEvent(new CustomEvent('bbs-unified-project-commit', { detail: { projectId } }))
  }

  const linkNode = async () => {
    if (!node || !linkCharId) return
    setBusy('link'); setMessage(null)
    try {
      const response = await fetch('/api/library', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ operation: 'link-nodes', projectId, expectedRevision: currentProject.revision, charId: linkCharId, nodeIds: [node.nodeId] }) })
      const body = await response.json() as { linkedNodes?: Array<{ displayName: string }>; error?: string }
      if (!response.ok) throw new Error(body.error ?? `Nối thất bại (${response.status})`)
      setMessage(`Đã nối “${node.name}” với nhân vật thư viện${body.linkedNodes?.[0] ? ` — tên hiển thị: ${body.linkedNodes[0].displayName}` : ''}.`)
      await refreshProject()
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)) }
    finally { setBusy(null) }
  }

  const assign = async (action: AssignActionItem) => {
    if (!node) return
    setBusy(action.uuid); setMessage(null)
    try {
      const response = await fetch('/api/library', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ operation: 'place-for-node', projectId, actionUuid: action.uuid, nodeId: node.nodeId, frameStart }) })
      const body = await response.json() as { displayName?: string; clipId?: string; frameStart?: number; frameEnd?: number; converted?: boolean; warning?: string; error?: string }
      if (!response.ok) throw new Error(body.error ?? `Gán thất bại (${response.status})`)
      setMessage(`Đã gán “${action.nameVi || action.name}” cho ${body.displayName ?? node.name} tại khung ${body.frameStart}–${body.frameEnd}${body.converted ? ' (đã tạo Nháp trong bộ của nhân vật đích)' : ''}.${body.warning ? ` ${body.warning}` : ''}`)
      // C27: let the overlay reveal the new clip on the timeline.
      if (body.clipId && body.frameStart !== undefined && body.frameEnd !== undefined) {
        window.dispatchEvent(new CustomEvent('bbs-reveal-clip', { detail: { projectId, clipId: body.clipId, nodeId: node.nodeId, frameStart: body.frameStart, frameEnd: body.frameEnd } }))
      }
      await refreshProject()
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)) }
    finally { setBusy(null) }
  }

  return (
    <div className="wb-assign-panel">
      <label className="wb-assign-field"><span>Nhân vật trong cảnh</span>
        <select value={nodeId} onChange={(event) => setNodeId(event.target.value)}>
          {nodes.map((item) => <option key={item.nodeId} value={item.nodeId}>{item.name}{item.libraryCharacterId ? '' : ' — chưa nối thư viện'}</option>)}
        </select>
      </label>
      {!nodes.length && <p className="wb-assign-note">Cảnh chưa có nhân vật nào. Hãy thêm nhân vật trước.</p>}
      {node && !node.libraryCharacterId && (
        <div className="wb-assign-link">
          <p>Node này chưa nối với nhân vật thư viện. Nối trước để gán animation của thư viện (giữ nguyên vị trí và khung shot):</p>
          <div className="wb-assign-row">
            <select value={linkCharId} onChange={(event) => setLinkCharId(event.target.value)}>
              <option value="">— Chọn nhân vật thư viện —</option>
              {data.characters.map((character) => <option key={character.charId} value={character.charId}>{character.name}</option>)}
            </select>
            <button type="button" className="wb-host-primary" disabled={!linkCharId || busy !== null} onClick={() => void linkNode()}>{busy === 'link' ? 'Đang nối…' : 'Nối node này…'}</button>
          </div>
        </div>
      )}
      {node?.libraryCharacterId && (
        <>
          <div className="wb-assign-row wb-assign-placement" role="radiogroup" aria-label="Vị trí đặt clip">
            <label><input type="radio" name="wb-assign-placement" checked={placement === 'shot'} onChange={() => setPlacement('shot')} /> Đầu shot hiện tại (khung {shotStartFrame(currentProject, currentFrame)})</label>
            <label><input type="radio" name="wb-assign-placement" checked={placement === 'frame'} onChange={() => setPlacement('frame')} /> Khung hiện tại ({currentFrame})</label>
          </div>
          <div className="wb-assign-tabs" role="tablist" aria-label="Nguồn động tác">
            <button type="button" role="tab" aria-selected={tab === 'own'} className={tab === 'own' ? 'is-active' : ''} onClick={() => setTab('own')}>Của nhân vật này</button>
            <button type="button" role="tab" aria-selected={tab === 'others'} className={tab === 'others' ? 'is-active' : ''} onClick={() => setTab('others')}>Của nhân vật khác</button>
            <button type="button" role="tab" aria-selected={tab === 'shared'} className={tab === 'shared' ? 'is-active' : ''} onClick={() => setTab('shared')}>Tự do</button>
          </div>
          {tab === 'others' && (
            <label className="wb-assign-field"><span>Nhân vật khác</span>
              <select value={otherCharId} onChange={(event) => setOtherCharId(event.target.value)}>
                <option value="">— Chọn nhân vật —</option>
                {data.characters.filter((character) => character.charId !== node.libraryCharacterId).map((character) => <option key={character.charId} value={character.charId}>{character.name}</option>)}
              </select>
            </label>
          )}
          <div className="wb-assign-row">
            <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm động tác (Việt/Anh)…" aria-label="Tìm động tác" />
            <select value={category} onChange={(event) => setCategory(event.target.value)} aria-label="Lọc theo nhóm">
              <option value="">Mọi nhóm</option>
              {categories.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </div>
          <ul className="wb-assign-list">
            {visibleActions.map((action) => (
              <li key={action.uuid}>
                <span className="wb-assign-name">{action.favorite ? '★ ' : ''}{action.nameVi || action.name}</span>
                <span className="wb-assign-meta">{action.rig}{action.status ? ` · ${STATUS_LABEL[action.status] ?? action.status}` : ''}{action.durationSeconds ? ` · ${action.durationSeconds.toFixed(1)}s` : ''}</span>
                <button type="button" disabled={busy !== null} onClick={() => void assign(action)}>{busy === action.uuid ? 'Đang gán…' : 'Gán'}</button>
              </li>
            ))}
            {!visibleActions.length && <li className="wb-assign-empty">Không có động tác phù hợp.</li>}
          </ul>
        </>
      )}
      <div className="wb-assign-footer">
        <button type="button" className="cross-app-button bbs-cross-app-action wb-assign-library-btn" disabled={!node}
          onClick={() => window.open(`/library?unified=${encodeURIComponent(projectId)}&assignTo=${encodeURIComponent(node?.nodeId ?? '')}`, '_blank', 'noopener')}>
          Mở trong Thư viện
        </button>
      </div>
      {(message || data.error) && <p className="wb-assign-message" role="status">{message ?? data.error}</p>}
    </div>
  )
}
