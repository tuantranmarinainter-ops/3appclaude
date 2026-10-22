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
      <h2 id="wb-film-export-title">{vi ? 'Gói BBS FS 2.4' : 'BBS FS 2.4 package'}</h2>
      <div className="wb-film-export-controls">
        <label>{vi ? 'Nhân vật' : 'Characters'}
          <select multiple value={state.characterIds} onChange={(event) => state.setCharacterIds(Array.from(event.target.selectedOptions, (option) => option.value))} disabled={state.busy} aria-label={vi ? 'Nhân vật cần xuất gói BBS FS' : 'Characters to export'}>
            {state.characters.map((character) => <option key={character.id} value={character.id}>{character.name}</option>)}
          </select>
        </label>
        <label>{vi ? 'Chuỗi camera' : 'Camera sequence'}
          <select value={state.sequenceId} onChange={(event) => state.setSequenceId(event.target.value)} disabled={state.busy}>
            {state.sequences.map((sequence) => <option key={sequence.id} value={sequence.id}>{sequence.id}</option>)}
          </select>
        </label>
        <label>{vi ? 'Frame đầu' : 'Start frame'}<input type="number" value={state.startFrame} onChange={(event) => state.setStartFrame(Number(event.target.value))} disabled={state.busy} /></label>
        <label>{vi ? 'Frame cuối' : 'End frame'}<input type="number" value={state.endFrame} onChange={(event) => state.setEndFrame(Number(event.target.value))} disabled={state.busy} /></label>
        <label>Aspect<input type="number" min="0.01" step="0.01" value={state.viewportAspect} onChange={(event) => state.setViewportAspect(Number(event.target.value))} disabled={state.busy} /></label>
        <label>{vi ? 'Tên gói' : 'Package name'}<input value={state.filmName} onChange={(event) => state.setFilmName(event.target.value)} disabled={state.busy} maxLength={64} /></label>
        <small>{vi ? 'Gói editable cho BBS FS 2.4; cần FBX/GLB có rig hỗ trợ và camera perspective.' : 'Editable BBS FS 2.4 package; requires a supported FBX/GLB rig and perspective camera.'}</small>
        <div className="wb-scene-render-actions">
          <button type="button" onClick={() => void state.exportFilm()} disabled={state.busy || !state.characters.length || !state.sequences.length}>{state.busy ? (vi ? 'Đang xuất…' : 'Exporting…') : (vi ? 'Xuất gói' : 'Export package')}</button>
          {state.busy && state.activeJobId && <button type="button" onClick={() => void state.cancel()}>{vi ? 'Hủy' : 'Cancel'}</button>}
          {!state.busy && state.completedJob?.state === 'succeeded' && <button type="button" onClick={() => void state.saveAgain(state.completedJob!)}>{vi ? 'Lưu lại…' : 'Save again…'}</button>}
          {state.status && <span role="status" aria-live="polite">{state.status}</span>}
        </div>
        {state.error && <p className="wb-scene-render-error" role="alert">{state.error}</p>}
      </div>
    </section>
    <BbsInstallPanel />
    </>
  )
}
