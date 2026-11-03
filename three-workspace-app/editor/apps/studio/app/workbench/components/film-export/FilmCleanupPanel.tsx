'use client'

import { formatMiB, type useFilmCleanup } from './hooks/useFilmCleanup'

/** B64: tidy old films in the chosen world, and old ZIP packages in the project. */
export function FilmCleanupPanel({ state, vi }: { state: ReturnType<typeof useFilmCleanup>; vi: boolean }) {
  const plan = state.plan
  return (
    <fieldset className="wb-film-step" disabled={state.busy}>
      <legend>{vi ? 'Dọn phim cũ' : 'Clean up old films'}</legend>
      <small>{vi
        ? 'Liệt kê phim app đã cài vào world ở bước 1. Tick phim muốn xoá; app đọc các phim còn lại để biết nhân vật/hiệu ứng nào vẫn đang dùng và chỉ xoá file không phim nào cần. Thoát game trước khi xoá.'
        : 'Lists films this app installed in the world from step 1. Tick the ones to delete; files still used by any remaining film are kept.'}</small>
      <div className="wb-scene-render-actions">
        <button type="button" onClick={() => void state.load()}>{vi ? 'Liệt kê phim trong world' : 'List films'}</button>
        {state.selected.length > 0 && <button type="button" onClick={() => void state.preview()}>{vi ? `Xem trước xoá ${state.selected.length} phim` : `Preview deleting ${state.selected.length}`}</button>}
      </div>
      {state.gameRunning && <p role="alert" className="wb-film-warn">{vi ? 'Minecraft đang chạy từ thư mục này. Thoát game rồi mới xoá được.' : 'Minecraft is running from this folder; quit it before deleting.'}</p>}
      {state.films.length > 0 && <ul className="wb-film-checklist" aria-label={vi ? 'Phim đã cài' : 'Installed films'}>
        {state.films.map((film) => <li key={film.relPath}><label className="wb-check">
          <input type="checkbox" checked={state.selected.includes(film.relPath)} onChange={(event) => state.toggle(film.relPath, event.target.checked)} />
          <span>{film.name} · {new Date(film.modifiedAt).toLocaleString()} · {formatMiB(film.sizeBytes)}{film.packageName ? ` · ${film.packageName}` : ''}</span>
        </label></li>)}
      </ul>}
      {state.foreign.length > 0 && <small>{vi ? `${state.foreign.length} phim khác trong world không do app cài (${state.foreign.map((film) => film.name).join(', ')}) — giữ nguyên, và vẫn được tính là đang dùng file.` : `${state.foreign.length} other films were not installed by this app; they are kept and still count as users of files.`}</small>}
      {plan && <div role="status" aria-live="polite">
        <p><strong>{vi ? `Sẽ xoá ${plan.films.length} phim, ${plan.assets.length} file, giải phóng ${formatMiB(plan.freedBytes)}` : `Will delete ${plan.films.length} films, ${plan.assets.length} files, freeing ${formatMiB(plan.freedBytes)}`}</strong></p>
        {plan.unreadable.length > 0 && <p role="alert" className="wb-film-warn">{vi ? `Không đọc được phim: ${plan.unreadable.join(', ')}. Vì chưa biết phim đó dùng gì nên sẽ không xoá file nào ngoài phim đã tick.` : `Could not read: ${plan.unreadable.join(', ')}. No asset files will be deleted.`}</p>}
        <button type="button" className="primary" onClick={() => void state.apply()} disabled={state.gameRunning === true || (plan.films.length === 0 && plan.assets.length === 0)}>{vi ? 'Xoá (cần xác nhận)' : 'Delete (asks to confirm)'}</button>
      </div>}
      <div className="wb-scene-render-actions">
        <button type="button" onClick={() => void state.previewZips()}>{vi ? 'Xoá gói ZIP cũ trong project' : 'Delete old ZIP packages in project'}</button>
        {state.zipPlan && state.zipPlan.removeCount > 0 && <>
          <span>{vi ? `${state.zipPlan.removeCount} gói cũ · ${formatMiB(state.zipPlan.freedBytes)} (giữ gói mới nhất của mỗi phim)` : `${state.zipPlan.removeCount} old packages · ${formatMiB(state.zipPlan.freedBytes)}`}</span>
          <button type="button" onClick={() => void state.applyZips()}>{vi ? 'Xoá các gói này' : 'Delete these'}</button>
        </>}
      </div>
      {state.status && <p role="status" aria-live="polite">{state.status}</p>}
      {state.error && <p className="wb-scene-render-error" role="alert">{state.error}</p>}
    </fieldset>
  )
}
