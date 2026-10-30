'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Image from 'next/image'
import { loadUnifiedProject } from '../../src/unifiedApi'
import { ActionPreview } from './ActionPreview'
import { AutoPreviewVideo } from './AutoPreviewVideo'
import { WorkspaceNavigationSlot } from '../workbench/components/feature-navigation/WorkspaceNavigation'
import { ACTION_CATEGORIES } from '../../../../packages/library/types'
import { formatBilingual } from '../../../../packages/library/actionNames'
import { filterLibraryActions } from '../../src/libraryFilters'
import { libraryJson as json, invalidateLibrary } from '../../src/libraryClient'

type Status = 'draft' | 'edited' | 'approved'
type Action = { uuid: string; name: string; nameVi?: string; nameViSource?: 'glossary' | 'words' | 'manual'; rig: string; category: string; tags: string[]; durationSeconds: number; fps: number; packId: string; coverPath: string | null; previewPath: string | null; preview?: { file: string; sha256: string; width: number; height: number; fps: number; seconds: number }; glbAnimationIndex: number; ownerCharId?: string; status?: Status; version?: number; favorite?: boolean; inPlace: boolean; licenseId: string; licenseSource?: string; createdAt: string }
type Character = { charId: string; name: string; rig: string; previewUrl: string; baseModelId?: string; defaultAction?: string; heightBlocks?: number; personality?: { summary: string; traits: string[] }; requiredActions?: Array<{ key: string; label: string }> }
type Coverage = { charId: string; name: string; cells: Array<{ key: string; label: string; action: Action | null; status: Status | null }> }

const MISSING_PREVIEW_CAP = 20
const DETAIL_WIDTH_KEY = 'w01.library.detailWidth.v1'
const DETAIL_WIDTH_MIN = 280
const DETAIL_WIDTH_MAX = 720
const STATUS_LABEL: Record<Status, string> = { draft: 'Nháp', edited: 'Đã chỉnh', approved: 'Đã duyệt' }
const STATUS_COLOR: Record<Status, string> = { draft: '#78622e', edited: '#275d83', approved: '#276b46' }

export default function LibraryPage() {
  const [tab, setTab] = useState<'actions' | 'favorites' | 'characters' | 'coverage'>('actions')
  const [actions, setActions] = useState<Action[]>([]), [characters, setCharacters] = useState<Character[]>([])
  const [coverage, setCoverage] = useState<Coverage[]>([]), [characterId, setCharacterId] = useState('')
  const [status, setStatus] = useState<'' | Status>(''), [warehouse, setWarehouse] = useState(true)
  const [query, setQuery] = useState(''), [category, setCategory] = useState(''), [sourceFilter, setSourceFilter] = useState(''), [inPlaceOnly, setInPlaceOnly] = useState(false), [sortOrder, setSortOrder] = useState<'name' | 'newest'>('name')
  const [selected, setSelected] = useState<Action | null>(null), [copyTarget, setCopyTarget] = useState('')
  const previousPreviewJobs = useRef<Record<string, { state: string; message?: string }>>({})
  const [message, setMessage] = useState(''), [previewJobs, setPreviewJobs] = useState<Record<string, { state: string; message?: string }>>({}), [assignTarget, setAssignTarget] = useState('')
  const [projectId, setProjectId] = useState(''), [hasOpener, setHasOpener] = useState(false), [adding, setAdding] = useState(false)
  const [detailWidth, setDetailWidth] = useState(380)

  useEffect(() => {
    const saved = Number(window.localStorage.getItem(DETAIL_WIDTH_KEY))
    if (Number.isFinite(saved) && saved >= DETAIL_WIDTH_MIN && saved <= DETAIL_WIDTH_MAX) setDetailWidth(saved)
  }, [])
  function startResizeDetail(event: React.PointerEvent) {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = detailWidth
    let width = startWidth
    const onMove = (move: PointerEvent) => { width = Math.min(DETAIL_WIDTH_MAX, Math.max(DETAIL_WIDTH_MIN, startWidth + startX - move.clientX)); setDetailWidth(width) }
    const onUp = () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); window.localStorage.setItem(DETAIL_WIDTH_KEY, String(width)) }
    window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp)
  }
  const [sceneConflict, setSceneConflict] = useState<{ charId: string; names: string[] } | null>(null)
  const [assignTo, setAssignTo] = useState<{ nodeId: string; displayName: string; libraryCharacterId: string | null } | null>(null)
  const [placingForNode, setPlacingForNode] = useState(false)

  const loadCharacters = useCallback(async () => {
    const body = await json('/api/library?characters=1')
    const rows = (body.characters as Character[]).filter(item => item.baseModelId)
    setCharacters(rows)
    const requested = new URLSearchParams(window.location.search).get('charId') ?? ''
    setCharacterId(current => rows.some(item => item.charId === current) ? current : rows.some(item => item.charId === requested) ? requested : rows[0]?.charId ?? '')
    setCopyTarget(current => rows.some(item => item.charId === current) ? current : rows[0]?.charId ?? '')
  }, [])
  const loadActions = useCallback(async () => {
    let fetched: Action[]
    if (tab === 'favorites') {
      const [rawBody, ...charBodies] = await Promise.all([
        json('/api/library?raw=1'),
        ...characters.map(item => json(`/api/library?charId=${encodeURIComponent(item.charId)}`)),
      ])
      fetched = [...(rawBody.actions as Action[]), ...charBodies.flatMap(body => body.actions as Action[])].filter(action => action.favorite)
    } else {
      if (!warehouse && !characterId) { setActions([]); return }
      const params = warehouse ? new URLSearchParams({ raw: '1', ...(query ? { q: query } : {}) }) : new URLSearchParams({ charId: characterId, ...(status ? { status } : {}) })
      const body = await json(`/api/library?${params}`)
      fetched = body.actions as Action[]
    }
    let rows = fetched.filter((action, index, all) => all.findIndex(other => other.uuid === action.uuid) === index).map(action => ({ ...action, coverPath: action.coverPath ?? (('cover' in action && typeof action.cover === 'string' && action.cover) ? `/api/library/cover/${encodeURIComponent(action.uuid)}` : null) }))
    rows = filterLibraryActions(rows, query, category)
    if (sourceFilter) rows = rows.filter(action => sourceFilter === 'mixamo' ? /mixamo/i.test(`${action.licenseId} ${action.licenseSource ?? ''}`) : !/mixamo/i.test(`${action.licenseId} ${action.licenseSource ?? ''}`))
    if (inPlaceOnly) rows = rows.filter(action => action.inPlace)
    rows = [...rows].sort((a, b) => Number(!!b.favorite) - Number(!!a.favorite) || (sortOrder === 'newest' ? b.createdAt.localeCompare(a.createdAt) : a.name.localeCompare(b.name)))
    setActions(rows); setSelected(current => rows.find(item => item.uuid === current?.uuid) ?? rows[0] ?? null)
  }, [category, characterId, characters, inPlaceOnly, query, sortOrder, sourceFilter, status, tab, warehouse])

  useEffect(() => {
    invalidateLibrary()
    setHasOpener(!!window.opener)
    const params = new URLSearchParams(window.location.search)
    const requested = params.get('unified')
    const assignNodeId = params.get('assignTo')
    if (requested) void loadUnifiedProject(requested).then(({ project }) => {
      setProjectId(project.projectId)
      // N1: opened from App 2's "Mở trong Thư viện" — preselect the node's role and offer per-Action assign buttons.
      if (assignNodeId) {
        const node = project.scene.content.nodes.find(item => item.id === assignNodeId)
        if (node) {
          const libraryCharacterId = typeof node.metadata?.libraryCharacterId === 'string' ? node.metadata.libraryCharacterId : null
          setAssignTo({ nodeId: node.id, displayName: node.name, libraryCharacterId })
          if (libraryCharacterId) { setCharacterId(libraryCharacterId); setWarehouse(false) }
        }
      }
    }).catch(error => setMessage(String(error)))
  }, [])
  useEffect(() => { void loadCharacters().catch(error => setMessage(String(error))) }, [loadCharacters])
  useEffect(() => { void json('/api/library/previews').then(body => setPreviewJobs(Object.fromEntries((body.jobs as Array<{ uuid: string; state: string; message?: string }>).map(job => [job.uuid, job])))).catch(() => undefined) }, [])
  useEffect(() => { const timer = window.setInterval(() => { void json('/api/library/previews').then(body => { const jobs = Object.fromEntries((body.jobs as Array<{ uuid: string; state: string; message?: string }>).map(job => [job.uuid, job])); const completed = Object.entries(jobs).some(([uuid, job]) => job.state === 'complete' && previousPreviewJobs.current[uuid]?.state !== 'complete'); previousPreviewJobs.current = jobs; setPreviewJobs(jobs); if (completed) void loadActions().catch(error => setMessage(String(error))) }).catch(() => undefined) }, 2500); return () => window.clearInterval(timer) }, [loadActions])
  useEffect(() => { void loadActions().catch(error => setMessage(String(error))) }, [loadActions])
  useEffect(() => { if (tab === 'coverage') void json('/api/library?coverage=1').then(body => setCoverage(body.coverage)).catch(error => setMessage(String(error))) }, [tab])

  const missingPreviews = useMemo(() => actions.filter(action => !action.preview && previewJobs[action.uuid]?.state !== 'queued' && previewJobs[action.uuid]?.state !== 'running'), [actions, previewJobs])
  const selectedCharacter = characters.find(item => item.charId === characterId)
  const compatibleTargets = useMemo(() => characters.filter(item => (item.rig === selected?.rig || item.rig === 'verity' && selected?.rig === 'mixamo65+verity') && item.charId !== selected?.ownerCharId), [characters, selected])
  const effectiveCopyTarget = compatibleTargets.some(item => item.charId === copyTarget) ? copyTarget : compatibleTargets[0]?.charId ?? ''
  async function addCharacter(charId: string, policy?: 'reuse' | 'create') {
    if (window.opener) { window.opener.postMessage({ type: 'bbs-library-add-character', charId }, window.location.origin); return }
    if (!projectId) return
    setAdding(true)
    try {
      const { project } = await loadUnifiedProject(projectId)
      const response = await fetch('/api/library', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ operation: 'add-to-scene', charId, projectId, expectedRevision: project.revision, ...(policy ? { existingNodePolicy: policy } : {}) }) })
      const body = await response.json()
      if (response.status === 409 && body.code === 'LIBRARY_CHARACTER_ALREADY_IN_SCENE') { setSceneConflict({ charId, names: body.existingNodeNames ?? [] }); return }
      if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`)
      setSceneConflict(null)
      setMessage(body.reused ? 'Đã dùng node có sẵn của vai này trong cảnh.' : 'Đã thêm nhân vật vào cảnh App 2.')
    } finally { setAdding(false) }
  }
  async function queueMissingPreviews() {
    const actionUuids = missingPreviews.slice(0, MISSING_PREVIEW_CAP).map(action => action.uuid)
    if (!actionUuids.length) return
    const body = await json('/api/library/previews', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ actionUuids }) })
    setPreviewJobs(Object.fromEntries((body.jobs as Array<{ uuid: string; state: string; message?: string }>).map(job => [job.uuid, job]))); setMessage(`Đã xếp hàng ${actionUuids.length} video.`)
  }
  async function toggleFavorite(action: Action) {
    const next = !action.favorite
    setActions(current => current.map(item => item.uuid === action.uuid ? { ...item, favorite: next } : item))
    setSelected(current => current?.uuid === action.uuid ? { ...current, favorite: next } : current)
    try {
      await json('/api/library', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ actionUuid: action.uuid, favorite: next }) })
      await loadActions()
    } catch (error) { setMessage(String(error)); await loadActions().catch(() => undefined) }
  }
  async function approve() {
    if (!selected?.ownerCharId) return
    await json('/api/library', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ operation: 'approve', charId: selected.ownerCharId, actionUuid: selected.uuid }) })
    await loadActions(); setMessage('Đã duyệt động tác.')
  }
  async function copy() {
    if (!selected || !effectiveCopyTarget) return
    await json('/api/library', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ operation: 'copy', actionUuid: selected.uuid, toCharId: effectiveCopyTarget }) })
    setMessage('Đã sao chép thành bản Nháp riêng của nhân vật đích.')
  }
  async function saveActionName(name: string, nameVi: string) {
    if (!selected) return
    await json('/api/library', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ actionUuid: selected.uuid, name, nameVi }) })
    await loadActions(); setMessage('Đã lưu tên động tác.')
  }
  async function placeForNode(action: Action) {
    if (!assignTo || !projectId) return
    setPlacingForNode(true)
    try {
      const body = await json('/api/library', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ operation: 'place-for-node', projectId, actionUuid: action.uuid, nodeId: assignTo.nodeId }) })
      // C27: hand the placed clip to the workbench so its timeline reveals it on return.
      if (body.clipId) { try { sessionStorage.setItem('bbs-reveal-clip', JSON.stringify({ projectId, clipId: body.clipId, nodeId: assignTo.nodeId, frameStart: body.frameStart, frameEnd: body.frameEnd })) } catch { /* storage unavailable */ } }
      setMessage(`Đã gán “${formatBilingual(action.name, action.nameVi)}” cho ${body.displayName ?? assignTo.displayName} tại khung ${body.frameStart}–${body.frameEnd}${body.converted ? ' (đã tạo Nháp trong bộ của nhân vật đích)' : ''}.${body.warning ? ` ${body.warning}` : ''} Quay lại cảnh App 2 để xem.`)
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)) }
    finally { setPlacingForNode(false) }
  }
  function notifyOpener(type: string) {
    if (!selected || !window.opener) return setMessage('Mở Thư viện từ App 2 để dùng thao tác này.')
    window.opener.postMessage({ type, actionUuid: selected.uuid }, window.location.origin)
  }

  return <main style={{ padding: 24, color: '#eee', background: '#111318', minHeight: '100vh', fontFamily: 'system-ui' }}>
    <h1>App 5 · Thư viện</h1>
    <WorkspaceNavigationSlot />
    <nav style={{ display: 'flex', gap: 8, marginBottom: 18 }}><button onClick={() => setTab('actions')}>Động tác</button><button onClick={() => setTab('favorites')}>★ Yêu thích</button><button onClick={() => setTab('characters')}>Nhân vật</button><button onClick={() => setTab('coverage')}>Bảng động tác</button></nav>
    {assignTo && (tab === 'actions' || tab === 'favorites') && <div role="status" style={{ marginBottom: 14, padding: '10px 12px', background: '#2b2113', border: '2px solid #f5a623', borderRadius: 8 }}>
      <strong>Đang gán cho {assignTo.displayName}</strong>{assignTo.libraryCharacterId
        ? <> — mỗi động tác có nút “Gán cho {assignTo.displayName}”; gán xong hãy quay lại cảnh App 2.</>
        : <> — node này chưa nối với nhân vật thư viện; hãy nối node trong App 2 (bảng Gán animation) trước khi gán.</>}
    </div>}
    {(tab === 'actions' || tab === 'favorites') && <><div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
      <select aria-label="Nhân vật" value={characterId} onChange={event => { setCharacterId(event.target.value); setWarehouse(false) }}>{characters.map(item => <option key={item.charId} value={item.charId}>{item.name}</option>)}</select>
      <select aria-label="Trạng thái" value={status} disabled={warehouse} onChange={event => setStatus(event.target.value as '' | Status)}><option value="">Mọi trạng thái</option><option value="draft">Nháp</option><option value="edited">Đã chỉnh</option><option value="approved">Đã duyệt</option></select>
      <button onClick={() => setWarehouse(value => !value)}>{warehouse ? `Bộ của ${selectedCharacter?.name ?? 'nhân vật'}` : 'Xem cả kho'}</button>
      <button disabled={!missingPreviews.length} title={`Mỗi lần bấm tạo tối đa ${MISSING_PREVIEW_CAP} video`} onClick={() => void queueMissingPreviews().catch(error => setMessage(String(error)))}>{`Tạo video còn thiếu (${missingPreviews.length}, tối đa ${MISSING_PREVIEW_CAP}/lần)`}</button>
      <input aria-label="Tìm động tác" placeholder="Tìm" value={query} onChange={event => setQuery(event.target.value)} />
      <select aria-label="Loại động tác" value={category} onChange={event => setCategory(event.target.value)}><option value="">Mọi loại</option>{ACTION_CATEGORIES.map(value => <option key={value}>{value}</option>)}</select><select aria-label="Nguồn" value={sourceFilter} onChange={event => setSourceFilter(event.target.value)}><option value="">Mọi nguồn</option><option value="mixamo">Mixamo</option><option value="other">Khác</option></select><label><input type="checkbox" checked={inPlaceOnly} onChange={event => setInPlaceOnly(event.target.checked)} /> In Place</label><select aria-label="Sắp xếp" value={sortOrder} onChange={event => setSortOrder(event.target.value as 'name' | 'newest')}><option value="name">Theo tên</option><option value="newest">Mới nhập</option></select>
    </div><div style={{ display: 'grid', gridTemplateColumns: `minmax(0,1fr) 10px ${detailWidth}px`, gap: 10, height: 'calc(100vh - 235px)', minHeight: 340 }}>
      <section aria-label="Danh sách động tác" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(165px,1fr))', gap: 12, alignContent: 'start', overflowY: 'auto', minHeight: 0, paddingRight: 4 }}>
        {actions.map(action => <article key={action.uuid} onClick={event => { if ((event.target as HTMLElement).closest('button, a, input, select, textarea')) return; setSelected(action) }} style={{ color: 'inherit', background: '#20242c', border: selected?.uuid === action.uuid ? '2px solid #68a9ff' : '1px solid #444', padding: 8, textAlign: 'left', cursor: 'pointer' }}>
          {action.preview ? <AutoPreviewVideo uuid={action.uuid} onClick={() => setSelected(action)} /> : <div style={{ height: 120, background: '#16191f', display: 'grid', placeItems: 'center' }}>{action.coverPath ? <Image src={`/api/library/cover/${encodeURIComponent(action.uuid)}`} alt="Ảnh bìa dự phòng" width={220} height={90} unoptimized /> : 'Đang tạo video…'}</div>}
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 4 }}><button type="button" onClick={() => setSelected(action)} style={{ border: 0, padding: '8px 0', color: 'inherit', background: 'transparent', textAlign: 'left', cursor: 'pointer', flex: 1 }}><strong>{formatBilingual(action.name, action.nameVi)}</strong></button><button type="button" aria-label={action.favorite ? `Bỏ yêu thích ${action.name}` : `Đánh dấu yêu thích ${action.name}`} aria-pressed={!!action.favorite} title={action.favorite ? 'Bỏ yêu thích' : 'Đánh dấu yêu thích'} onClick={() => void toggleFavorite(action)} style={{ border: 0, padding: '6px 2px', background: 'transparent', cursor: 'pointer', fontSize: 17, lineHeight: 1, color: action.favorite ? '#f2c14e' : '#8a8f98' }}>{action.favorite ? '★' : '☆'}</button></div><div>{action.durationSeconds.toFixed(1)} giây · {action.tags.join(', ') || action.category}</div><small>{/mixamo/i.test(`${action.licenseId} ${action.licenseSource ?? ''}`) ? 'Mixamo' : 'Khác'}{action.inPlace ? ' · In Place' : ''}</small>{action.status && <div><small style={{ background: STATUS_COLOR[action.status], padding: '2px 5px' }}>{STATUS_LABEL[action.status]} · v{action.version ?? 1}</small></div>}{!action.preview && previewJobs[action.uuid]?.state === 'failed' && <small role="status">Video lỗi: {previewJobs[action.uuid].message}</small>}
          {assignTo?.libraryCharacterId && <button type="button" disabled={placingForNode} onClick={() => void placeForNode(action)} style={{ marginTop: 6, border: '2px solid #f5a623', background: 'rgba(245,166,35,.12)', color: '#ffd58a', borderRadius: 6, padding: '4px 8px', cursor: 'pointer', fontWeight: 600 }}>{placingForNode ? 'Đang gán…' : `Gán cho ${assignTo.displayName}`}</button>}
        </article>)}{!actions.length && <p>Chưa có động tác phù hợp.</p>}
      </section>
      <div role="separator" aria-orientation="vertical" aria-label="Kéo để đổi độ rộng khung chi tiết" title="Kéo để đổi độ rộng khung chi tiết" onPointerDown={startResizeDetail} style={{ cursor: 'col-resize', background: '#2c313a', borderRadius: 4, touchAction: 'none' }} />
      <aside style={{ padding: 16, background: '#20242c', overflowY: 'auto', minHeight: 0 }}>{selected ? <><h2>{formatBilingual(selected.name, selected.nameVi)}</h2>{selectedCharacter && <ActionPreview uuid={selected.uuid} animationIndex={selected.glbAnimationIndex} characterUrl={selectedCharacter.previewUrl} />}
        <p>{selected.durationSeconds.toFixed(2)} giây · {selected.fps} fps · {selected.rig} · {/mixamo/i.test(`${selected.licenseId} ${selected.licenseSource ?? ''}`) ? 'Mixamo' : 'Khác'}</p>{selected.preview && <video controls muted loop playsInline src={`/api/library/video/${encodeURIComponent(selected.uuid)}`} style={{ width: '100%', aspectRatio: '1 / 1', objectFit: 'contain', background: '#15191f' }} />}<button onClick={() => void json('/api/library/previews', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ actionUuids: [selected.uuid], regenerate: true }) }).then(body => { setPreviewJobs(Object.fromEntries((body.jobs as Array<{ uuid: string; state: string; message?: string }>).map(job => [job.uuid, job]))) }).catch(error => setMessage(String(error)))}>Tạo lại video</button>
        <form key={selected.uuid} onSubmit={event => { event.preventDefault(); const data = new FormData(event.currentTarget); void saveActionName(String(data.get('name') ?? ''), String(data.get('nameVi') ?? '')).catch(error => setMessage(String(error))) }}><label>Tên tiếng Anh <input name="name" required defaultValue={selected.name} /></label><label>Tên tiếng Việt <input name="nameVi" defaultValue={selected.nameVi ?? ''} /></label><button type="submit">Lưu tên</button></form>
        {selected.ownerCharId && selected.status !== 'approved' && <button onClick={() => void approve().catch(error => setMessage(String(error)))}>Duyệt</button>}
        {assignTo?.libraryCharacterId && <p><button type="button" disabled={placingForNode} onClick={() => void placeForNode(selected)} style={{ border: '2px solid #f5a623', background: 'rgba(245,166,35,.12)', color: '#ffd58a', borderRadius: 6, padding: '6px 10px', cursor: 'pointer', fontWeight: 600 }}>{placingForNode ? 'Đang gán…' : `Gán cho ${assignTo.displayName}`}</button></p>}
        {(hasOpener || projectId) && (selected.ownerCharId || characterId) && <p><button type="button" className="cross-app-button" disabled={adding} onClick={() => void addCharacter(selected.ownerCharId || characterId).catch(error => setMessage(String(error)))}>Thêm vào cảnh App 2</button></p>}
        <p><select aria-label="Nhân vật để gán" value={assignTarget || characterId} onChange={event => setAssignTarget(event.target.value)}>{characters.map(item => <option key={item.charId} value={item.charId}>{item.name}</option>)}</select><button className="cross-app-button" onClick={() => void json('/api/library/assign', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ actionUuids: [selected.uuid], charId: assignTarget || characterId }) }).then(() => setMessage('Đã gửi yêu cầu gán animation cho nhân vật.')).catch(error => setMessage(`Không thể gán animation: ${String(error)}`))}>Gán cho nhân vật…</button></p><button className="cross-app-button" onClick={() => notifyOpener('bbs-library-place-action')}>Dùng cho nhân vật đang chọn</button><button className="cross-app-button" onClick={() => notifyOpener('bbs-library-open-app3')}>Sửa ở App 3</button>
        <p><select aria-label="Nhân vật đích" value={effectiveCopyTarget} onChange={event => setCopyTarget(event.target.value)}>{compatibleTargets.map(item => <option key={item.charId} value={item.charId}>{item.name}</option>)}</select><button disabled={!compatibleTargets.length} onClick={() => void copy().catch(error => setMessage(String(error)))}>Sao chép sang…</button></p>
      </> : <p>Chọn một động tác.</p>}</aside>
    </div></>}
    {tab === 'characters' && <>{projectId && <LinkStoryboardPanel projectId={projectId} characters={characters} setMessage={setMessage} />}<CharacterProfiles characters={characters} onSaved={loadCharacters} setMessage={setMessage} onAdd={hasOpener || projectId ? addCharacter : undefined} adding={adding} /></>}
    {sceneConflict && <div role="dialog" aria-modal="true" aria-label="Vai đã có trong cảnh" style={{ position: 'fixed', inset: 0, zIndex: 1000, background: '#0009', display: 'grid', placeItems: 'center' }}>
      <section style={{ width: 'min(520px,92vw)', padding: 20, color: '#eee', background: '#20242c' }}>
        <h2>Vai này đã có node trong cảnh</h2>
        <p>Các node hiện có: {sceneConflict.names.join(', ')}. Bạn muốn dùng node có sẵn hay thêm một lần xuất hiện mới?</p>
        <p style={{ display: 'flex', gap: 8 }}>
          <button type="button" disabled={adding} onClick={() => { setSceneConflict(null); setMessage('Đã dùng node có sẵn của vai này trong cảnh.') }}>Dùng node có sẵn</button>
          <button type="button" disabled={adding} onClick={() => void addCharacter(sceneConflict.charId, 'create').catch(error => setMessage(String(error)))}>Thêm lần xuất hiện mới</button>
          <button type="button" onClick={() => setSceneConflict(null)}>Huỷ</button>
        </p>
      </section>
    </div>}
    {tab === 'coverage' && <CoverageMatrix rows={coverage} onMissing={(key, charId) => { setCharacterId(charId); setQuery(key); setWarehouse(true); setTab('actions') }} />}
    {projectId && <a className="cross-app-button" style={{ display: 'inline-block', padding: '4px 10px', marginTop: 12, color: 'inherit', textDecoration: 'none' }} href={`/?unified=${encodeURIComponent(projectId)}`}>Quay lại cảnh App 2</a>}
    {message && <p role="status">{message}</p>}
  </main>
}

type LinkNodeResult = { nodeId: string; displayName: string; replacedClips: Array<{ name: string }>; unconvertedClips: Array<{ name: string; reason: string }> }

function LinkStoryboardPanel({ projectId, characters, setMessage }: { projectId: string; characters: Character[]; setMessage: (value: string) => void }) {
  const [charId, setCharId] = useState('')
  const [nodes, setNodes] = useState<Array<{ id: string; name: string; linked: boolean }>>([])
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [pattern, setPattern] = useState('')
  const [busy, setBusy] = useState(false)
  const [results, setResults] = useState<LinkNodeResult[]>([])
  const load = useCallback(async () => {
    const { project } = await loadUnifiedProject(projectId)
    setNodes(project.scene.content.nodes.filter(node => node.type === 'character').map(node => ({ id: node.id, name: node.name, linked: typeof node.metadata?.libraryCharacterId === 'string' })))
  }, [projectId])
  useEffect(() => { void load().catch(error => setMessage(String(error))) }, [load])
  useEffect(() => { if (!characters.some(item => item.charId === charId)) setCharId(characters[0]?.charId ?? '') }, [characters, charId])
  const unlinked = nodes.filter(node => !node.linked)
  function selectByPattern() {
    const prefix = pattern.trim().replace(/\*+$/, '').toLowerCase()
    if (!prefix) return
    setSelectedIds(unlinked.filter(node => node.name.toLowerCase().startsWith(prefix)).map(node => node.id))
  }
  async function link() {
    if (!charId || !selectedIds.length) return
    setBusy(true)
    try {
      const { project } = await loadUnifiedProject(projectId)
      const body = await json('/api/library', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ operation: 'link-nodes', projectId, expectedRevision: project.revision, charId, nodeIds: selectedIds }) })
      const linked = (body.linkedNodes ?? []) as LinkNodeResult[]
      setResults(linked)
      const replaced = linked.reduce((sum, node) => sum + node.replacedClips.length, 0)
      const unconverted = linked.reduce((sum, node) => sum + node.unconvertedClips.length, 0)
      setMessage(`Đã nối ${linked.length} node với ${characters.find(item => item.charId === charId)?.name ?? charId}: thay ${replaced} clip bằng Nháp cùng tên${unconverted ? `, ${unconverted} clip chưa chuyển được (xem chi tiết bên dưới)` : ''}.`)
      setSelectedIds([])
      await load()
    } catch (error) { setMessage(String(error)) } finally { setBusy(false) }
  }
  if (!unlinked.length && !results.length) return <section style={{ padding: 14, background: '#20242c', marginBottom: 14 }}><h2>Nối node storyboard với nhân vật thư viện</h2><p>Mọi node nhân vật trong cảnh App 2 đã nối thư viện.</p></section>
  return <section style={{ padding: 14, background: '#20242c', marginBottom: 14 }}>
    <h2>Nối node storyboard với nhân vật thư viện</h2>
    <p>Thay model tạm của node bằng base model của nhân vật thư viện, giữ nguyên vị trí và khung shot. Clip trùng tên Nháp của nhân vật sẽ được thay sang xương mới; clip không thay được sẽ được báo rõ. Toàn bộ là một bước Hoàn tác.</p>
    <p style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
      <select aria-label="Nhân vật thư viện để nối" value={charId} onChange={event => setCharId(event.target.value)}>{characters.map(item => <option key={item.charId} value={item.charId}>{item.name}</option>)}</select>
      <input aria-label="Mẫu tên node" placeholder="Mẫu tên, vd go *" value={pattern} onChange={event => setPattern(event.target.value)} />
      <button type="button" onClick={selectByPattern}>Chọn theo mẫu</button>
      <button type="button" disabled={busy || !selectedIds.length || !charId} onClick={() => void link()}>{busy ? 'Đang nối…' : `Nối ${selectedIds.length} node đã chọn`}</button>
    </p>
    <div style={{ display: 'grid', gap: 4 }}>{unlinked.map(node => <label key={node.id}><input type="checkbox" checked={selectedIds.includes(node.id)} onChange={event => setSelectedIds(current => event.target.checked ? [...current, node.id] : current.filter(id => id !== node.id))} /> {node.name}</label>)}</div>
    {!!results.length && <div>{results.map(node => <div key={node.nodeId} style={{ marginTop: 8 }}><strong>{node.displayName}</strong>{node.replacedClips.map((clip, index) => <div key={index}>Đã thay clip bằng Nháp “{clip.name}”.</div>)}{node.unconvertedClips.map((clip, index) => <div key={index} role="status">Chưa chuyển được clip “{clip.name}”: {clip.reason}</div>)}</div>)}</div>}
  </section>
}

function CharacterProfiles({ characters, onSaved, setMessage, onAdd, adding }: { onAdd?: (charId: string) => Promise<void>; adding: boolean; characters: Character[]; onSaved: () => Promise<void>; setMessage: (value: string) => void }) {
  async function save(character: Character, form: HTMLFormElement) {
    const data = new FormData(form)
    const personality = { summary: String(data.get('summary') ?? ''), traits: String(data.get('traits') ?? '').split(',').map(value => value.trim()).filter(Boolean) }
    const requiredActions = String(data.get('required') ?? '').split('\n').map(line => line.split(':', 2)).filter(parts => parts[0]?.trim() && parts[1]?.trim()).map(([key, label]) => ({ key: key!.trim(), label: label!.trim() }))
    await json('/api/library', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ operation: 'profile', charId: character.charId, personality, requiredActions, ...(String(data.get('heightBlocks') ?? '').trim() ? { heightBlocks: Number(data.get('heightBlocks')) } : {}) }) })
    await onSaved(); setMessage(`Đã lưu hồ sơ ${character.name}.`)
  }
  return <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(300px,1fr))', gap: 14 }}>{characters.map(character => <form key={character.charId} onSubmit={event => { event.preventDefault(); void save(character, event.currentTarget).catch(error => setMessage(String(error))) }} style={{ padding: 14, background: '#20242c' }}>
    <h2>{character.name}</h2><p>{character.rig} · mô hình {character.baseModelId}</p>
    <label>Chiều cao (block)<input name="heightBlocks" type="number" min="0" step="any" defaultValue={character.heightBlocks ?? ''} /></label>
    <label>Tính cách<textarea name="summary" defaultValue={character.personality?.summary} style={{ width: '100%' }} /></label>
    <label>Đặc điểm (cách nhau bằng dấu phẩy)<input name="traits" defaultValue={character.personality?.traits.join(', ')} style={{ width: '100%' }} /></label>
    <label>Động tác cần có (key: nhãn)<textarea name="required" defaultValue={character.requiredActions?.map(item => `${item.key}: ${item.label}`).join('\n')} style={{ width: '100%', minHeight: 130 }} /></label><button type="submit">Lưu hồ sơ</button>
    {onAdd && <button type="button" className="cross-app-button" disabled={adding} onClick={() => void onAdd(character.charId).catch(error => setMessage(String(error)))}>Thêm vào cảnh App 2</button>}
  </form>)}</section>
}

function CoverageMatrix({ rows, onMissing }: { rows: Coverage[]; onMissing: (key: string, charId: string) => void }) {
  const columns = [...new Map(rows.flatMap(row => row.cells).map(cell => [cell.key, cell.label])).entries()]
  return <div style={{ overflow: 'auto' }}><table style={{ borderCollapse: 'collapse', minWidth: '100%' }}><thead><tr><th>Nhân vật</th>{columns.map(([key, label]) => <th key={key}>{label}</th>)}</tr></thead><tbody>{rows.map(row => <tr key={row.charId}><th>{row.name}</th>{columns.map(([key]) => { const cell = row.cells.find(item => item.key === key); return <td key={key} style={{ padding: 5, background: cell?.status ? STATUS_COLOR[cell.status] : '#3a3030' }}>{cell?.action ? <span title={formatBilingual(cell.action.name, cell.action.nameVi)}>{formatBilingual(cell.action.name, cell.action.nameVi)}{cell.status && ` · ${STATUS_LABEL[cell.status]}`}</span> : <button onClick={() => onMissing(key, row.charId)}>Tìm trong kho</button>}</td> })}</tr>)}</tbody></table></div>
}
