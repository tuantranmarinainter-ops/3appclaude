'use client'

import { useStudioLocale } from '../../../../src/devtools/localePreference'
import type { FilmWorldAnchor } from '../../../../src/filmWorldAnchor'

export function WorldAnchorFields({ value, onChange }: { value: FilmWorldAnchor; onChange: (value: FilmWorldAnchor) => void }) {
  const vi = useStudioLocale() === 'vi'
  const destination = value.destination ?? [0, 64, 0]
  return <fieldset>
    <legend>{vi ? 'Điểm neo tọa độ thế giới' : 'World coordinate anchor'}</legend>
    <select value={value.mode} onChange={(event) => onChange({ ...value, mode: event.target.value as FilmWorldAnchor['mode'] })}>
      <option value="local-origin">{vi ? 'Chuyển đến tọa độ chọn (mặc định 0,64,0)' : 'Move to chosen coordinates (default 0,64,0)'}</option>
      <option value="scene-origin">{vi ? 'Giữ tọa độ tuyệt đối của cảnh' : 'Keep absolute scene coordinates'}</option>
    </select>
    {value.mode === 'local-origin' && <div>{(['X', 'Y', 'Z'] as const).map((axis, index) => <label key={axis}>{axis}<input type="number" value={destination[index]} min={-30000000} max={30000000} step="any" onChange={(event) => {
      const next: [number, number, number] = [...destination]
      next[index] = event.target.valueAsNumber
      onChange({ ...value, destination: next })
    }} /></label>)}</div>}
    <small>{vi ? 'Tọa độ do bạn chọn; không đọc vị trí người chơi. Gốc mô hình đầu tiên chuyển đến điểm neo, camera và nội dung khác giữ vị trí tương đối. Y là độ cao gốc mô hình; hãy điều chỉnh theo mặt đất.' : 'User-chosen coordinates; player position is not read. The first model pivot moves to the anchor; cameras and other content retain relative positions. Y is the model pivot height; adjust for the ground.'}</small>
  </fieldset>
}
