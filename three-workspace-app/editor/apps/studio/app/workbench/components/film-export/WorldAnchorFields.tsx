'use client'

import { useState } from 'react'
import type { UnifiedProject } from '@bbs/animation-workspace-shared'
import { parseMinecraftTp, type FilmWorldAnchor } from '../../../../src/filmWorldAnchor'
import { readFilmAnchorLocations } from '../../../../src/filmAnchorLocations'
import { sendUnifiedCommand } from '../../../../src/unifiedApi'

/** Step ③: paste F3+C or pick a remembered place. The exact numbers live in WorldAnchorAdvanced (B54). */
export function WorldAnchorFields({ project, value, onChange, onValidityChange }: { project: UnifiedProject; value: FilmWorldAnchor; onChange: (value: FilmWorldAnchor) => void; onValidityChange: (valid: boolean) => void }) {
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const locations0 = readFilmAnchorLocations(project.extensions)
  const [saved, setSaved] = useState(() => locations0.length ? `Đang dùng địa điểm ${locations0.at(-1)!.name}` : '')
  const locations = readFilmAnchorLocations(project.extensions)
  const destination = value.destination ?? [0, 64, 0]
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
  return <>
    {locations.length > 0 && <label>Địa điểm đã nhớ
      <select value="" onChange={(event) => {
        const location = locations.find((entry) => entry.name === event.target.value)
        if (location) { change({ ...value, ...location.anchor }); setSaved(`Đang dùng địa điểm ${location.name}`) }
      }}><option value="">Chọn địa điểm…</option>{locations.map((entry) => <option key={entry.name}>{entry.name}</option>)}</select>
    </label>}
    <label>Dán vị trí từ game (F3+C)<textarea rows={2} value={text} placeholder="Dán dòng /execute … tp @s x y z … vào đây" onChange={(event) => {
      const next = event.target.value; setText(next); setError('')
      if (!next.trim()) { onValidityChange(true); return }
      try {
        const tp = parseMinecraftTp(next)
        change({ ...value, mode: 'local-origin', destination: [tp.x, tp.y, tp.z], yawDegrees: tp.yaw, dimension: tp.dimension })
      } catch (cause) { onValidityChange(false); setError(cause instanceof Error ? cause.message : String(cause)) }
    }} />
      <small>Trong game, đứng đúng chỗ muốn đặt cảnh, quay mặt về phía trước của cảnh, bấm F3+C rồi dán vào đây.</small>
    </label>
    {value.mode === 'local-origin'
      ? <p className="wb-film-step-note">Cảnh sẽ đặt tại X {destination[0]}, Y {destination[1]}, Z {destination[2]} · hướng {value.yawDegrees ?? 0}°</p>
      : <p className="wb-film-step-note">Giữ nguyên tọa độ của cảnh (không dời theo chỗ đứng).</p>}
    <div className="wb-film-row">
      <label>Nhớ chỗ này với tên<input value={name} maxLength={100} onChange={(event) => setName(event.target.value)} placeholder="Lâu đài" /></label>
      <button type="button" disabled={saving || !name.trim()} onClick={() => void save()}>{saving ? 'Đang nhớ…' : 'Nhớ địa điểm'}</button>
    </div>
    {error && <p role="alert" className="wb-film-error">{error}</p>}{saved && <p role="status">{saved}</p>}
  </>
}

/** Advanced placement: mode, exact numbers, rounding and pivot, each with one plain sentence (B53). */
export function WorldAnchorAdvanced({ project, value, onChange }: { project: UnifiedProject; value: FilmWorldAnchor; onChange: (value: FilmWorldAnchor) => void }) {
  const destination = value.destination ?? [0, 64, 0]
  const pivotMode = value.pivot ? (value.pivot.every((n) => n === 0) ? 'origin' : 'point') : value.pivotCharacterId ? value.pivotCharacterId : 'first'
  return <>
    <label>Cách đặt cảnh
      <select aria-label="Chế độ điểm neo" value={value.mode} onChange={(event) => onChange({ ...value, mode: event.target.value as FilmWorldAnchor['mode'] })}>
        <option value="local-origin">Đặt cảnh tại chỗ đứng F3+C</option>
        <option value="scene-origin">Giữ tọa độ gốc của cảnh</option>
      </select>
    </label>
    {value.mode === 'local-origin' && <>
      <div className="wb-film-row">{(['X', 'Y', 'Z'] as const).map((axis, index) => <label key={axis}>{axis}<input type="number" value={destination[index]} min={-30000000} max={30000000} step="any" onChange={(event) => {
        const next: [number, number, number] = [...destination]; next[index] = event.target.valueAsNumber
        onChange({ ...value, destination: next })
      }} /></label>)}
        <label>Hướng (độ)<input type="number" step="any" value={value.yawDegrees ?? 0} onChange={(event) => onChange({ ...value, yawDegrees: event.target.valueAsNumber })} /></label>
      </div>
      <label className="wb-check">
        <input type="checkbox" checked={value.roundToBlock ?? false} onChange={(event) => onChange({ ...value, roundToBlock: event.target.checked })} />
        <span>Làm tròn về giữa block<small>Đặt cảnh vào chính giữa ô đất, để chân nhân vật không lệch nửa ô.</small></span>
      </label>
      <label>Điểm gốc trong cảnh
        <select value={pivotMode} onChange={(event) => {
          const selection = event.target.value
          const { sourceOrigin: _origin, pivot: _pivot, pivotCharacterId: _character, ...base } = value
          onChange({ ...base, ...(selection === 'origin' || selection === 'point' ? { pivot: [0, 0, 0] as [number, number, number] } : selection === 'first' ? {} : { pivotCharacterId: selection }) })
        }}>
          <option value="first">Chân nhân vật đầu tiên trong shot</option>
          <option value="origin">Gốc cảnh (0, 0, 0)</option>
          <option value="point">Mốc đặt tay trong cảnh</option>
          {Object.values(project.characters).map((character) => <option key={character.id} value={character.id}>Chân {character.name}</option>)}
        </select>
        <small>Điểm này trong cảnh sẽ nằm đúng chỗ bạn đứng khi bấm F3+C (mặc định: chân nhân vật đầu tiên).</small>
      </label>
      {value.pivot && <div className="wb-film-row">{(['X', 'Y', 'Z'] as const).map((axis, index) => <label key={axis}>Mốc {axis}<input type="number" step="any" value={value.pivot![index]} onChange={(event) => {
        const pivot: [number, number, number] = [...value.pivot!]; pivot[index] = event.target.valueAsNumber
        onChange({ ...value, pivot })
      }} /></label>)}</div>}
    </>}
  </>
}
