'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Image from 'next/image'
import { loadUnifiedProject } from '../../src/unifiedApi'
import { ActionPreview } from './ActionPreview'
import { ACTION_CATEGORIES } from '../../../../packages/library/types'
import { formatBilingual } from '../../../../packages/library/actionNames'

type Status = 'draft' | 'edited' | 'approved'
type Action = { uuid: string; name: string; nameVi?: string; nameViSource?: 'glossary' | 'words' | 'manual'; rig: string; category: string; tags: string[]; durationSeconds: number; fps: number; packId: string; coverPath: string | null; glbAnimationIndex: number; ownerCharId?: string; status?: Status; version?: number }
type Character = { charId: string; name: string; rig: string; previewUrl: string; baseModelId?: string; defaultAction?: string; personality?: { summary: string; traits: string[] }; requiredActions?: Array<{ key: string; label: string }> }
type Coverage = { charId: string; name: string; cells: Array<{ key: string; label: string; action: Action | null; status: Status | null }> }

const STATUS_LABEL: Record<Status, string> = { draft: 'Nháp', edited: 'Đã chỉnh', approved: 'Đã duyệt' }
const STATUS_COLOR: Record<Status, string> = { draft: '#78622e', edited: '#275d83', approved: '#276b46' }

function searchable(value: string) { return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase() }

async function json(url: string, init?: RequestInit) {
  const response = await fetch(url, { cache: 'no-store', ...init })
  const body = await response.json()
  if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`)
  return body
}

export default function LibraryPage() {
  const [tab, setTab] = useState<'actions' | 'characters' | 'coverage'>('actions')
  const [actions, setActions] = useState<Action[]>([]), [characters, setCharacters] = useState<Character[]>([])
  const [coverage, setCoverage] = useState<Coverage[]>([]), [characterId, setCharacterId] = useState('')
  const [status, setStatus] = useState<'' | Status>(''), [warehouse, setWarehouse] = useState(false)
  const [query, setQuery] = useState(''), [category, setCategory] = useState('')
  const [selected, setSelected] = useState<Action | null>(null), [copyTarget, setCopyTarget] = useState('')
  const [message, setMessage] = useState('')
  const [projectId, setProjectId] = useState(''), [hasOpener, setHasOpener] = useState(false), [adding, setAdding] = useState(false)

  const loadCharacters = useCallback(async () => {
    const body = await json('/api/library?characters=1')
    const rows = (body.characters as Character[]).filter(item => item.baseModelId)
    setCharacters(rows)
    const requested = new URLSearchParams(window.location.search).get('charId') ?? ''
    setCharacterId(current => rows.some(item => item.charId === current) ? current : rows.some(item => item.charId === requested) ? requested : rows[0]?.charId ?? '')
    setCopyTarget(current => rows.some(item => item.charId === current) ? current : rows[0]?.charId ?? '')
  }, [])
  const loadActions = useCallback(async () => {
    if (!warehouse && !characterId) { setActions([]); return }
    const params = warehouse ? new URLSearchParams({ raw: '1', ...(query ? { q: query } : {}) }) : new URLSearchParams({ charId: characterId, ...(status ? { status } : {}) })
    const body = await json(`/api/library?${params}`)
    let rows = body.actions as Action[]
    if (category) rows = rows.filter(action => action.category === category)
    if (!warehouse && query) rows = rows.filter(action => searchable(`${action.name} ${action.nameVi ?? ''} ${action.tags.join(' ')}`).includes(searchable(query)))
    setActions(rows); setSelected(current => rows.find(item => item.uuid === current?.uuid) ?? rows[0] ?? null)
  }, [category, characterId, query, status, warehouse])

  useEffect(() => {
    setHasOpener(!!window.opener)
    const requested = new URLSearchParams(window.location.search).get('unified')
    if (requested) void loadUnifiedProject(requested).then(({ project }) => setProjectId(project.projectId)).catch(error => setMessage(String(error)))
  }, [])
  useEffect(() => { void loadCharacters().catch(error => setMessage(String(error))) }, [loadCharacters])
  useEffect(() => { void loadActions().catch(error => setMessage(String(error))) }, [loadActions])
  useEffect(() => { if (tab === 'coverage') void json('/api/library?coverage=1').then(body => setCoverage(body.coverage)).catch(error => setMessage(String(error))) }, [tab])

  const selectedCharacter = characters.find(item => item.charId === characterId)
  const compatibleTargets = useMemo(() => characters.filter(item => (item.rig === selected?.rig || item.rig === 'verity' && selected?.rig === 'mixamo65+verity') && item.charId !== selected?.ownerCharId), [characters, selected])
  const effectiveCopyTarget = compatibleTargets.some(item => item.charId === copyTarget) ? copyTarget : compatibleTargets[0]?.charId ?? ''
  async function addCharacter(charId: string) {
    if (window.opener) { window.opener.postMessage({ type: 'bbs-library-add-character', charId }, window.location.origin); return }
    if (!projectId) return
    setAdding(true)
    try {
      const { project } = await loadUnifiedProject(projectId)
      await json('/api/library', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ operation: 'add-to-scene', charId, projectId, expectedRevision: project.revision }) })
      setMessage('Đã thêm nhân vật vào cảnh App 2.')
    } finally { setAdding(false) }
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
  function notifyOpener(type: string) {
    if (!selected || !window.opener) return setMessage('Mở Thư viện từ App 2 để dùng thao tác này.')
    window.opener.postMessage({ type, actionUuid: selected.uuid }, window.location.origin)
  }

  return <main style={{ padding: 24, color: '#eee', background: '#111318', minHeight: '100vh', fontFamily: 'system-ui' }}>
    <h1>App 5 · Thư viện</h1>
    <nav style={{ display: 'flex', gap: 8, marginBottom: 18 }}><button onClick={() => setTab('actions')}>Động tác</button><button onClick={() => setTab('characters')}>Nhân vật</button><button onClick={() => setTab('coverage')}>Bảng động tác</button></nav>
    {tab === 'actions' && <><div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
      <select aria-label="Nhân vật" value={characterId} onChange={event => { setCharacterId(event.target.value); setWarehouse(false) }}>{characters.map(item => <option key={item.charId} value={item.charId}>{item.name}</option>)}</select>
      <select aria-label="Trạng thái" value={status} disabled={warehouse} onChange={event => setStatus(event.target.value as '' | Status)}><option value="">Mọi trạng thái</option><option value="draft">Nháp</option><option value="edited">Đã chỉnh</option><option value="approved">Đã duyệt</option></select>
      <button onClick={() => setWarehouse(value => !value)}>{warehouse ? `Bộ của ${selectedCharacter?.name ?? 'nhân vật'}` : 'Xem cả kho'}</button>
      <input aria-label="Tìm động tác" placeholder="Tìm" value={query} onChange={event => setQuery(event.target.value)} />
      <select aria-label="Loại động tác" value={category} onChange={event => setCategory(event.target.value)}><option value="">Mọi loại</option>{ACTION_CATEGORIES.map(value => <option key={value}>{value}</option>)}</select>
    </div><div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,2fr) minmax(280px,1fr)', gap: 20 }}>
      <section aria-label="Danh sách động tác" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(165px,1fr))', gap: 12, alignContent: 'start' }}>
        {actions.map(action => <button key={action.uuid} onClick={() => setSelected(action)} style={{ color: 'inherit', background: '#20242c', border: selected?.uuid === action.uuid ? '2px solid #68a9ff' : '1px solid #444', padding: 8, textAlign: 'left' }}>
          <div style={{ height: 90, background: '#16191f', display: 'grid', placeItems: 'center' }}>{action.coverPath ? <Image src={`/api/library/cover/${encodeURIComponent(action.uuid)}`} alt="" width={220} height={90} unoptimized /> : 'Không có ảnh'}</div>
          <strong>{formatBilingual(action.name, action.nameVi)}</strong><div>{action.tags.join(', ') || action.category}</div>{action.status && <small style={{ background: STATUS_COLOR[action.status], padding: '2px 5px' }}>{STATUS_LABEL[action.status]} · v{action.version ?? 1}</small>}
        </button>)}{!actions.length && <p>Chưa có động tác phù hợp.</p>}
      </section>
      <aside style={{ padding: 16, background: '#20242c', alignSelf: 'start' }}>{selected ? <><h2>{formatBilingual(selected.name, selected.nameVi)}</h2>{selectedCharacter && <ActionPreview uuid={selected.uuid} animationIndex={selected.glbAnimationIndex} characterUrl={selectedCharacter.previewUrl} />}
        <p>{selected.durationSeconds.toFixed(2)} giây · {selected.fps} fps · {selected.rig}</p>
        <form key={selected.uuid} onSubmit={event => { event.preventDefault(); const data = new FormData(event.currentTarget); void saveActionName(String(data.get('name') ?? ''), String(data.get('nameVi') ?? '')).catch(error => setMessage(String(error))) }}><label>Tên tiếng Anh <input name="name" required defaultValue={selected.name} /></label><label>Tên tiếng Việt <input name="nameVi" defaultValue={selected.nameVi ?? ''} /></label><button type="submit">Lưu tên</button></form>
        {selected.ownerCharId && selected.status !== 'approved' && <button onClick={() => void approve().catch(error => setMessage(String(error)))}>Duyệt</button>}
        <button onClick={() => notifyOpener('bbs-library-place-action')}>Dùng cho nhân vật đang chọn</button><button onClick={() => notifyOpener('bbs-library-open-app3')}>Sửa ở App 3</button>
        <p><select aria-label="Nhân vật đích" value={effectiveCopyTarget} onChange={event => setCopyTarget(event.target.value)}>{compatibleTargets.map(item => <option key={item.charId} value={item.charId}>{item.name}</option>)}</select><button disabled={!compatibleTargets.length} onClick={() => void copy().catch(error => setMessage(String(error)))}>Sao chép sang…</button></p>
      </> : <p>Chọn một động tác.</p>}</aside>
    </div></>}
    {tab === 'characters' && <CharacterProfiles characters={characters} onSaved={loadCharacters} setMessage={setMessage} onAdd={hasOpener || projectId ? addCharacter : undefined} adding={adding} />}
    {tab === 'coverage' && <CoverageMatrix rows={coverage} onMissing={(key, charId) => { setCharacterId(charId); setQuery(key); setWarehouse(true); setTab('actions') }} />}
    {projectId && <a href={`/?unified=${encodeURIComponent(projectId)}`}>Quay lại cảnh App 2</a>}
    {message && <p role="status">{message}</p>}
  </main>
}

function CharacterProfiles({ characters, onSaved, setMessage, onAdd, adding }: { onAdd?: (charId: string) => Promise<void>; adding: boolean; characters: Character[]; onSaved: () => Promise<void>; setMessage: (value: string) => void }) {
  async function save(character: Character, form: HTMLFormElement) {
    const data = new FormData(form)
    const personality = { summary: String(data.get('summary') ?? ''), traits: String(data.get('traits') ?? '').split(',').map(value => value.trim()).filter(Boolean) }
    const requiredActions = String(data.get('required') ?? '').split('\n').map(line => line.split(':', 2)).filter(parts => parts[0]?.trim() && parts[1]?.trim()).map(([key, label]) => ({ key: key!.trim(), label: label!.trim() }))
    await json('/api/library', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ operation: 'profile', charId: character.charId, personality, requiredActions }) })
    await onSaved(); setMessage(`Đã lưu hồ sơ ${character.name}.`)
  }
  return <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(300px,1fr))', gap: 14 }}>{characters.map(character => <form key={character.charId} onSubmit={event => { event.preventDefault(); void save(character, event.currentTarget).catch(error => setMessage(String(error))) }} style={{ padding: 14, background: '#20242c' }}>
    <h2>{character.name}</h2><p>{character.rig} · mô hình {character.baseModelId}</p>
    <label>Tính cách<textarea name="summary" defaultValue={character.personality?.summary} style={{ width: '100%' }} /></label>
    <label>Đặc điểm (cách nhau bằng dấu phẩy)<input name="traits" defaultValue={character.personality?.traits.join(', ')} style={{ width: '100%' }} /></label>
    <label>Động tác cần có (key: nhãn)<textarea name="required" defaultValue={character.requiredActions?.map(item => `${item.key}: ${item.label}`).join('\n')} style={{ width: '100%', minHeight: 130 }} /></label><button type="submit">Lưu hồ sơ</button>
    {onAdd && <button type="button" disabled={adding} onClick={() => void onAdd(character.charId).catch(error => setMessage(String(error)))}>Thêm vào cảnh App 2</button>}
  </form>)}</section>
}

function CoverageMatrix({ rows, onMissing }: { rows: Coverage[]; onMissing: (key: string, charId: string) => void }) {
  const columns = [...new Map(rows.flatMap(row => row.cells).map(cell => [cell.key, cell.label])).entries()]
  return <div style={{ overflow: 'auto' }}><table style={{ borderCollapse: 'collapse', minWidth: '100%' }}><thead><tr><th>Nhân vật</th>{columns.map(([key, label]) => <th key={key}>{label}</th>)}</tr></thead><tbody>{rows.map(row => <tr key={row.charId}><th>{row.name}</th>{columns.map(([key]) => { const cell = row.cells.find(item => item.key === key); return <td key={key} style={{ padding: 5, background: cell?.status ? STATUS_COLOR[cell.status] : '#3a3030' }}>{cell?.action ? <span title={formatBilingual(cell.action.name, cell.action.nameVi)}>{formatBilingual(cell.action.name, cell.action.nameVi)}{cell.status && ` · ${STATUS_LABEL[cell.status]}`}</span> : <button onClick={() => onMissing(key, row.charId)}>Tìm trong kho</button>}</td> })}</tr>)}</tbody></table></div>
}
