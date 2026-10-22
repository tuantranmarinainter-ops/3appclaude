'use client'

import type { UnifiedProject } from '@bbs/animation-workspace-shared'
import { useFilmExport } from './hooks/useFilmExport'
import { useStudioLocale } from '../../../../src/devtools/localePreference'
import { BbsInstallPanel } from './BbsInstallPanel'

export function FilmExportPanel({ project }: { project: UnifiedProject }) {
  const vi = useStudioLocale() === 'vi'
  const state = useFilmExport(project)
  return (
    <>
    <section className="wb-film-export" aria-labelledby="wb-film-export-title">
      <h2 id="wb-film-export-title">{vi ? 'Xuất Film BBS FS 2.7' : 'BBS FS 2.7 Film export'}</h2>
      <div className="wb-film-export-controls">
        <label>{vi ? 'Phạm vi xuất' : 'Export scope'}
          <select value={state.exportMode} onChange={(event) => state.setExportMode(event.target.value as 'film' | 'series')} disabled={state.busy}>
            <option value="film">{vi ? 'Film hiện tại' : 'Current Film'}</option>
            <option value="series">{vi ? 'Cả tập' : 'Entire episode'}</option>
          </select>
        </label>
        <label>{vi ? 'Nội dung' : 'Content'}
          <select value={state.content} onChange={(event) => state.setContent(event.target.value as typeof state.content)} disabled={state.busy}>
            <option value="characters">{vi ? 'Chỉ nhân vật' : 'Characters only'}</option>
            <option value="backdrops">{vi ? 'Chỉ hậu cảnh' : 'Backdrops only'}</option>
            <option value="both">{vi ? 'Cả nhân vật và hậu cảnh' : 'Characters and backdrops'}</option>
          </select>
        </label>
        {(state.exportMode === 'series' || state.content !== 'backdrops') && <label>{vi ? 'Nhân vật' : 'Characters'}
          <select multiple value={state.characterIds} onChange={(event) => state.setCharacterIds(Array.from(event.target.selectedOptions, (option) => option.value))} disabled={state.busy} aria-label={vi ? 'Nhân vật cần xuất gói BBS FS' : 'Characters to export'}>
            {state.characters.map((character) => <option key={character.id} value={character.id}>{character.name}</option>)}
          </select>
        </label>}
        {state.content !== 'characters' && <label>{vi ? 'Hậu cảnh' : 'Backdrops'}
          <select multiple value={state.propIds} onChange={(event) => state.setPropIds(Array.from(event.target.selectedOptions, (option) => option.value))} disabled={state.busy} aria-label={vi ? 'Hậu cảnh cần xuất gói BBS FS' : 'Backdrops to export'}>
            {state.props.map((prop) => <option key={prop.id} value={prop.id}>{prop.name}</option>)}
          </select>
        </label>}
        <label>{vi ? 'Chuỗi camera' : 'Camera sequence'}
          <select value={state.sequenceId} onChange={(event) => state.setSequenceId(event.target.value)} disabled={state.busy}>
            {state.sequences.map((sequence) => <option key={sequence.id} value={sequence.id}>{sequence.id}</option>)}
          </select>
        </label>
        {state.exportMode === 'film' && <label>{vi ? 'Frame đầu' : 'Start frame'}<input type="number" value={state.startFrame} onChange={(event) => state.setStartFrame(Number(event.target.value))} disabled={state.busy} /></label>}
        {state.exportMode === 'film' && <label>{vi ? 'Frame cuối' : 'End frame'}<input type="number" value={state.endFrame} onChange={(event) => state.setEndFrame(Number(event.target.value))} disabled={state.busy} /></label>}
        <label>Aspect<input type="number" min="0.01" step="0.01" value={state.viewportAspect} onChange={(event) => state.setViewportAspect(Number(event.target.value))} disabled={state.busy} /></label>
        <label>{vi ? 'Tên gói' : 'Package name'}<input value={state.filmName} onChange={(event) => state.setFilmName(event.target.value)} disabled={state.busy} maxLength={state.exportMode === 'series' ? 56 : 64} /></label>
        <small>{vi ? 'Xuất Film editable cho BBS FS 2.7. Chế độ Cả tập tự chia theo giới hạn worker, chỉ cắt ở ranh giới cảnh.' : 'Exports editable Film for BBS FS 2.7. Entire episode splits at shot boundaries to fit worker limits.'}</small>
        <div className="wb-scene-render-actions">
          <button type="button" onClick={() => void state.exportFilm()} disabled={!state.canExport}>{state.busy ? (vi ? 'Đang xuất…' : 'Exporting…') : state.checkingPreflight ? (vi ? 'Đang kiểm tra…' : 'Checking…') : (vi ? 'Xuất gói' : 'Export package')}</button>
          {state.busy && state.activeJobId && <button type="button" onClick={() => void state.cancel()}>{vi ? 'Hủy' : 'Cancel'}</button>}
          {!state.busy && state.completedJob?.state === 'succeeded' && <button type="button" onClick={() => void state.saveAgain(state.completedJob!)}>{vi ? 'Lưu lại…' : 'Save again…'}</button>}
          {state.status && <span role="status" aria-live="polite">{state.status}</span>}
        </div>
        <div className="wb-film-preflight" aria-live="polite" aria-busy={state.checkingPreflight}>
          {state.checkingPreflight && <p>{vi ? 'Đang kiểm tra lựa chọn xuất…' : 'Checking the export selection…'}</p>}
          {state.preflight?.errors.map((item, index) => <p key={`error-${item.code}-${item.nodeId ?? ''}-${item.clipId ?? ''}-${item.frame ?? ''}-${index}`} role="alert">
            {vi ? 'Lỗi: ' : 'Error: '}{vi ? item.message.vi : item.message.en}
          </p>)}
          {state.preflight?.warnings.map((item, index) => <p key={`warning-${item.code}-${item.nodeId ?? ''}-${item.clipId ?? ''}-${item.frame ?? ''}-${index}`}>
            {vi ? 'Cảnh báo: ' : 'Warning: '}{vi ? item.message.vi : item.message.en}
          </p>)}
          {state.preflight && !state.checkingPreflight && state.preflight.errors.length === 0 && state.preflight.warnings.length === 0 &&
            <p>{vi ? 'Kiểm tra trước khi xuất đạt.' : 'Preflight passed.'}</p>}
        </div>
        {state.error && <p className="wb-scene-render-error" role="alert">{state.error}</p>}
      </div>
    </section>
    <BbsInstallPanel />
    </>
  )
}
