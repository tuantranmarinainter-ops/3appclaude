import type { useFilmExport } from './hooks/useFilmExport'

export function ExportShotPicker({ state, vi }: { state: ReturnType<typeof useFilmExport>; vi: boolean }) {
  const shots = state.selectedSequence?.clips ?? []
  if (!shots.length) return null
  // B57: nothing to pick when the only shot already is the range.
  const pickerUseful = shots.length > 1 || !state.matchingShotId
  return <div>
    {pickerUseful && <label>{vi ? 'Chọn nhanh khoảng shot' : 'Use a shot range'}
      <select value={state.matchingShotId} onChange={(event) => state.chooseShot(event.target.value)} disabled={state.busy}>
        {!state.matchingShotId && <option value="">{vi ? 'Chọn shot…' : 'Choose a shot…'}</option>}
        {shots.map((shot) => <option key={shot.id} value={shot.id}>{shot.id} · {shot.sourceFrameStart}–{shot.sourceFrameEnd}</option>)}
      </select>
    </label>}
    {state.shotNotice && <p role="status">{state.shotNotice}</p>}
    <p role="status">{vi ? 'Shot trong khoảng xuất' : 'Shots in the export range'}: {state.shotSelection.clips.map((shot) => `${shot.id} (${shot.sourceFrameStart}–${shot.sourceFrameEnd})`).join(', ') || '—'}</p>
    {state.shotSelection.issues.length > 0 && <div>
      <p>{vi ? 'Khoảng này có khoảng trống, chồng lấn, điểm cắt lệch lưới hoặc quá 3 shot. Chọn một shot để xuất riêng; dữ liệu cảnh được giữ nguyên.' : 'This range has gaps, overlaps, off-grid cuts or more than 3 shots. Choose one shot to export separately; scene data stays unchanged.'}</p>
      {state.shotRepairs.map((repair) => <button key={repair.shotId} type="button" disabled={state.busy} onClick={() => state.applyShotRepair(repair.range)}>{vi ? 'Dùng phần hợp lệ' : 'Use valid part of'} {repair.shotId} · {repair.range.startFrame}–{repair.range.endFrame}</button>)}
      {state.hasPerspectiveCamera && <button type="button" disabled={state.busy || state.creatingShot} onClick={() => void state.repairCameraChain()}>{vi ? 'Tạo chuỗi xuất riêng: một camera phủ khoảng này (có Hoàn tác)' : 'Create separate export sequence: one camera covers this range (Undo available)'}</button>}
    </div>}
  </div>
}
