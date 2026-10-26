'use client'

import { useState } from 'react'
import type { UnifiedProject } from '@bbs/animation-workspace-shared'
import { parseMinecraftTp, type FilmWorldAnchor } from '../../../../src/filmWorldAnchor'
import { readFilmAnchorLocations } from '../../../../src/filmAnchorLocations'
import { sendUnifiedCommand } from '../../../../src/unifiedApi'

export function WorldAnchorFields({ project, value, onChange, onValidityChange }: { project: UnifiedProject; value: FilmWorldAnchor; onChange: (value: FilmWorldAnchor) => void; onValidityChange: (valid: boolean) => void }) {
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState('')
  const locations = readFilmAnchorLocations(project.extensions)
  const destination = value.destination ?? [0, 64, 0]
  const pivotMode = value.pivot ? (value.pivot.every((n) => n === 0) ? 'origin' : 'point') : value.pivotCharacterId ? value.pivotCharacterId : 'first'
  const change = (next: FilmWorldAnchor) => { setSaved(''); onValidityChange(true); onChange(next) }
  const save = async () => {
    setSaving(true); setError('')
    try {
      await sendUnifiedCommand({ requestId: crypto.randomUUID(), projectId: project.projectId, expectedRevision: project.revision,
        command: 'film.anchor.location.set', args: { name, anchor: value } })
      setSaved(`Đã nhớ địa điểm ${name.trim()}`)
      window.dispatchEvent(new CustomEvent('bbs-unified-project-commit', { detail: { projectId: project.projectId } }))
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setSaving(false) }
  }
  return <fieldset>
    <legend>Điểm neo tọa độ thế giới</legend>
    <label>Dán vị trí từ game (F3+C)<textarea value={text} onChange={(event) => {
      const next = event.target.value; setText(next); setError('')
      if (!next.trim()) { onValidityChange(true); return }
      try {
        const tp = parseMinecraftTp(next)
        change({ ...value, mode: 'local-origin', destination: [tp.x, tp.y, tp.z], yawDegrees: tp.yaw, dimension: tp.dimension })
      } catch (cause) { onValidityChange(false); setError(cause instanceof Error ? cause.message : String(cause)) }
    }} /></label>
    <small>Trong game đứng đúng chỗ, nhìn về phía trước của cảnh, bấm F3+C rồi dán vào đây</small>
    <select aria-label="Chế độ điểm neo" value={value.mode} onChange={(event) => change({ ...value, mode: event.target.value as FilmWorldAnchor['mode'] })}>
      <option value="local-origin">Đặt cảnh tại vị trí chọn</option>
      <option value="scene-origin">Giữ tọa độ tuyệt đối của cảnh</option>
    </select>
    {value.mode === 'local-origin' && <>
      <p>Đã đọc: X {destination[0]}, Y {destination[1]}, Z {destination[2]} · hướng {value.yawDegrees ?? 0}° · {value.dimension ?? 'minecraft:overworld'} (bỏ qua pitch)</p>
      <div>{(['X', 'Y', 'Z'] as const).map((axis, index) => <label key={axis}>{axis}<input type="number" value={destination[index]} min={-30000000} max={30000000} step="any" onChange={(event) => {
        const next: [number, number, number] = [...destination]; next[index] = event.target.valueAsNumber
        change({ ...value, destination: next })
      }} /></label>)}</div>
      <label>Hướng (yaw °)<input type="number" step="any" value={value.yawDegrees ?? 0} onChange={(event) => change({ ...value, yawDegrees: event.target.valueAsNumber })} /></label>
      <label><input type="checkbox" checked={value.roundToBlock ?? false} onChange={(event) => change({ ...value, roundToBlock: event.target.checked })} />Làm tròn về giữa block</label>
      <label>Điểm gốc trong cảnh<select value={pivotMode} onChange={(event) => {
        const selection = event.target.value
        const { sourceOrigin: _origin, pivot: _pivot, pivotCharacterId: _character, ...base } = value
        change({ ...base, ...(selection === 'origin' || selection === 'point' ? { pivot: [0, 0, 0] as [number, number, number] } : selection === 'first' ? {} : { pivotCharacterId: selection }) })
      }}>
        <option value="first">Chân nhân vật đầu tiên trong shot</option>
        <option value="origin">Gốc cảnh (0, 0, 0)</option>
        <option value="point">Mốc đặt tay trong cảnh</option>
        {Object.values(project.characters).map((character) => <option key={character.id} value={character.id}>Chân {character.name}</option>)}
      </select></label>
      {value.pivot && <div>{(['X', 'Y', 'Z'] as const).map((axis, index) => <label key={axis}>Mốc {axis}<input type="number" step="any" value={value.pivot![index]} onChange={(event) => {
        const pivot: [number, number, number] = [...value.pivot!]; pivot[index] = event.target.valueAsNumber
        change({ ...value, pivot })
      }} /></label>)}</div>}
      <label>Địa điểm đã nhớ<select value="" onChange={(event) => {
        const location = locations.find((entry) => entry.name === event.target.value)
        if (location) change({ ...value, ...location.anchor })
      }}><option value="">Chọn địa điểm…</option>{locations.map((entry) => <option key={entry.name}>{entry.name}</option>)}</select></label>
      <label>Tên địa điểm<input value={name} maxLength={100} onChange={(event) => setName(event.target.value)} placeholder="Lâu đài" /></label>
      <button type="button" disabled={saving || !name.trim()} onClick={() => void save()}>{saving ? 'Đang nhớ…' : 'Nhớ địa điểm trong project'}</button>
    </>}
    {error && <p role="alert">{error}</p>}{saved && <p role="status">{saved}</p>}
  </fieldset>
}
