'use client'

import { useEffect, useMemo, useState } from 'react'
import Image from 'next/image'
import { ActionPreview } from './ActionPreview'
import { ACTION_CATEGORIES } from '../../../../packages/library/types'

type Action = { uuid: string; name: string; rig: string; category: string; tags: string[]; durationSeconds: number; fps: number; packId: string; coverPath: string | null; glbAnimationIndex: number }
type Character = { charId: string; name: string; rig: string; previewUrl: string }
type Page = { items: Action[]; total: number }

export default function LibraryPage() {
  const [page, setPage] = useState<Page>({ items: [], total: 0 })
  const [rig, setRig] = useState('')
  const [category, setCategory] = useState('')
  const [tag, setTag] = useState('')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Action | null>(null)
  const [characters, setCharacters] = useState<Character[]>([])
  const [characterId, setCharacterId] = useState('')
  const [editTags, setEditTags] = useState('')
  const [editCategory, setEditCategory] = useState('')
  const [message, setMessage] = useState('')
  const params = useMemo(() => new URLSearchParams({ ...(rig ? { rig } : {}), ...(category ? { category } : {}), ...(tag ? { tag } : {}), ...(query ? { q: query } : {}) }), [rig, category, tag, query])
  useEffect(() => { let live = true; fetch(`/api/library?${params}`, { cache: 'no-store' }).then(r => r.json()).then(data => { if (live) setPage(data) }).catch(error => setMessage(String(error))); return () => { live = false } }, [params])
  const selectedRig = selected?.rig
  useEffect(() => { let live = true; fetch('/api/library?characters=1', { cache: 'no-store' }).then(r => r.json()).then(data => { if (live) { const rows = (data.characters as Character[]).filter(c => c.rig === selectedRig || !selectedRig); setCharacters(rows); setCharacterId(current => rows.some(c => c.charId === current) ? current : rows[0]?.charId ?? '') } }).catch(error => setMessage(String(error))); return () => { live = false } }, [selectedRig])
  const previewCharacter = characters.find(character => character.charId === characterId)
  async function choose(action: Action) {
    setSelected(action); setEditTags(action.tags.join(', ')); setEditCategory(action.category)
    try { const response = await fetch(`/api/library?actionUuid=${encodeURIComponent(action.uuid)}`); const body = await response.json(); if (!response.ok) throw Error(body.error); setSelected({ ...action, ...body.action }) } catch (error) { setMessage(String(error)) }
  }
  async function save() {
    if (!selected) return
    const response = await fetch('/api/library', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ actionUuid: selected.uuid, category: editCategory, tags: editTags.split(',').map(t => t.trim()).filter(Boolean) }) })
    const body = await response.json(); if (!response.ok) { setMessage(body.error); return }
    setMessage('Metadata saved'); const updated = { ...selected, category: editCategory, tags: editTags.split(',').map(t => t.trim()).filter(Boolean) }; setSelected(updated); setPage(p => ({ ...p, items: p.items.map(a => a.uuid === updated.uuid ? updated : a) }))
  }
  return <main style={{ padding: 24, color: '#eee', background: '#111318', minHeight: '100vh', fontFamily: 'system-ui' }}>
    <h1>App 5 · Animation Library</h1>
    <p>Browse immutable normalized Actions. Metadata edits change tags and category only.</p>
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
      <input aria-label="Search actions" placeholder="Search" value={query} onChange={e => setQuery(e.target.value)} />
      <select aria-label="Filter rig" value={rig} onChange={e => setRig(e.target.value)}><option value="">All rigs</option>{[...new Set(page.items.map(a => a.rig))].map(v => <option key={v}>{v}</option>)}</select>
      <select aria-label="Filter category" value={category} onChange={e => setCategory(e.target.value)}><option value="">All categories</option>{ACTION_CATEGORIES.map(v => <option key={v}>{v}</option>)}</select>
      <input aria-label="Filter tag" placeholder="Tag" value={tag} onChange={e => setTag(e.target.value)} />
    </div>
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(260px, 1fr)', gap: 20 }}>
      <section aria-label="Action covers" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(150px,1fr))', gap: 12, alignContent: 'start' }}>
        {page.items.map(action => <button key={action.uuid} onClick={() => void choose(action)} style={{ color: 'inherit', background: '#20242c', border: selected?.uuid === action.uuid ? '2px solid #68a9ff' : '1px solid #444', padding: 8, textAlign: 'left', cursor: 'pointer' }}>
          <div style={{ height: 105, background: '#16191f', display: 'grid', placeItems: 'center' }}>{action.coverPath ? <Image src={`/api/library/cover/${encodeURIComponent(action.uuid)}`} alt="" width={240} height={105} unoptimized style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : 'No cover'}</div>
          <strong>{action.name}</strong><div>{action.rig} · {action.category}</div><small>{action.tags.join(', ')}</small>
        </button>)}
        {!page.items.length && <p>No actions in this library yet.</p>}
      </section>
      <aside aria-label="Action preview and metadata" style={{ padding: 16, background: '#20242c', alignSelf: 'start' }}>
        {selected ? <><h2>{selected.name}</h2>
          <label>Preview character <select aria-label="Preview character" value={characterId} onChange={event => setCharacterId(event.target.value)}>{characters.filter(character => character.rig === selected.rig).map(character => <option key={character.charId} value={character.charId}>{character.name}</option>)}</select></label>
          {previewCharacter ? <ActionPreview uuid={selected.uuid} animationIndex={selected.glbAnimationIndex} characterUrl={previewCharacter.previewUrl} /> : <p>No preview character is available for rig {selected.rig}.</p>}
          <p>Action preview · {selected.durationSeconds.toFixed(2)} s · {selected.fps} fps</p><p>Rig: {selected.rig} · Pack: {selected.packId}</p>
          <label>Category <select value={editCategory} onChange={e => setEditCategory(e.target.value)}>{ACTION_CATEGORIES.map(v => <option key={v}>{v}</option>)}</select></label><p><label>Tags (comma separated)<br /><input value={editTags} onChange={e => setEditTags(e.target.value)} /></label></p><button onClick={() => void save()}>Save metadata</button>
          <p>Action UUID · {selected.uuid}</p>
          {typeof window !== 'undefined' && window.opener ? <><button onClick={() => window.opener?.postMessage({ type: 'bbs-library-place-action', actionUuid: selected.uuid }, window.location.origin)}>Place on selected App 2 character</button><button onClick={() => window.opener?.postMessage({ type: 'bbs-library-open-app3', actionUuid: selected.uuid }, window.location.origin)}>Open in Animation Studio</button></> : null}
        </> : <p>Select an Action to preview its details and edit metadata.</p>}{message && <p role="status">{message}</p>}
      </aside>
    </div>
  </main>
}
