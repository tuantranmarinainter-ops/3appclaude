'use client'

import { useEffect, useState } from 'react'
import type { UnifiedProject } from '@bbs/animation-workspace-shared'
import { useBbsInstall } from './hooks/useBbsInstall'
import { useFilmExport } from './hooks/useFilmExport'
import { useStudioLocale } from '../../../../src/devtools/localePreference'
import { ExportShotPicker } from './ExportShotPicker'
import { EffectsOptions } from './EffectsOptions'
import { WorldAnchorFields } from './WorldAnchorFields'
import { BbsInstallPanel } from './BbsInstallPanel'

export function FilmExportPanel({ project, active }: { project: UnifiedProject; active?: boolean }) {
  const vi = useStudioLocale() === 'vi'
  const install = useBbsInstall(vi)
  const state = useFilmExport(project, install.capabilities, active)
  const [inOutNotice, setInOutNotice] = useState(false)
  // N4: mỗi lần mở panel Xuất, áp lại mặc định In/Out (trừ khi đã sửa tay).
  useEffect(() => {
    if (active) setInOutNotice(state.applyInOutDefault())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])
  return (
    <>
    <section className="wb-film-export" aria-labelledby="wb-film-export-title">
      <h2 id="wb-film-export-title">{vi ? 'Xuất Film BBS FS 2.7' : 'BBS FS 2.7 Film export'}</h2>
      <EffectsOptions capabilities={install.capabilities} value={state.effectsPolicy} onChange={state.setEffectsPolicy} disabled={state.busy} vi={vi} />
      <div className="wb-film-export-controls">
        <WorldAnchorFields project={project} value={state.worldAnchor} onChange={state.setWorldAnchor} onValidityChange={state.setWorldAnchorInputValid} />
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
        {state.exportMode === 'series' && state.content !== 'backdrops' && <label>{vi ? 'Chọn nhân vật cho cả tập' : 'Episode character selection'}
          <select value={state.seriesCharacterSelection} onChange={(event) => state.setSeriesCharacterSelection(event.target.value as 'auto' | 'selected')} disabled={state.busy}>
            <option value="auto">{vi ? 'Tự chọn theo từng đoạn' : 'Auto per segment'}</option>
            <option value="selected">{vi ? 'Dùng danh sách bên dưới' : 'Use the list below'}</option>
          </select>
        </label>}
        {(state.content !== 'backdrops' && (state.exportMode === 'film' || state.seriesCharacterSelection === 'selected')) && <label>{vi ? 'Nhân vật' : 'Characters'}
          <select multiple value={state.characterIds} onChange={(event) => state.setCharacterIds(Array.from(event.target.selectedOptions, (option) => option.value))} disabled={state.busy} aria-label={vi ? 'Nhân vật cần xuất gói BBS FS' : 'Characters to export'}>
            {state.characters.map((character) => <option key={character.id} value={character.id}>{character.name}</option>)}
          </select>
        </label>}
        {state.exportMode === 'series' && state.content !== 'characters' && <label>{vi ? 'Chọn hậu cảnh cho cả tập' : 'Episode backdrop selection'}
          <select value={state.seriesPropSelection} onChange={(event) => state.setSeriesPropSelection(event.target.value as 'auto' | 'selected')} disabled={state.busy}>
            <option value="auto">{vi ? 'Tự chọn trong phạm vi camera (≤ 60 m)' : 'Auto within camera range (≤ 60 m)'}</option>
            <option value="selected">{vi ? 'Dùng danh sách bên dưới' : 'Use the list below'}</option>
          </select>
        </label>}
        {state.content !== 'characters' && (state.exportMode === 'film' || state.seriesPropSelection === 'selected') && <label>{vi ? 'Hậu cảnh' : 'Backdrops'}
          <select multiple value={state.propIds} onChange={(event) => state.setPropIds(Array.from(event.target.selectedOptions, (option) => option.value))} disabled={state.busy} aria-label={vi ? 'Hậu cảnh cần xuất gói BBS FS' : 'Backdrops to export'}>
            {state.props.map((prop) => <option key={prop.id} value={prop.id}>{prop.name}</option>)}
          </select>
        </label>}
        <label>{vi ? 'Chuỗi camera' : 'Camera sequence'}
          <select value={state.sequenceId} onChange={(event) => state.setSequenceId(event.target.value)} disabled={state.busy}>
            {state.sequences.map((sequence) => <option key={sequence.id} value={sequence.id}>{sequence.id}</option>)}
          </select>
        </label>
        {state.exportMode === 'film' && <ExportShotPicker state={state} vi={vi} />}
        {state.exportMode === 'film' && <label>{vi ? 'Frame đầu' : 'Start frame'}<input type="number" value={state.startFrame} onChange={(event) => state.setStartFrame(Number(event.target.value))} disabled={state.busy} /></label>}
        {state.exportMode === 'film' && <label>{vi ? 'Frame cuối' : 'End frame'}<input type="number" value={state.endFrame} onChange={(event) => state.setEndFrame(Number(event.target.value))} disabled={state.busy} /></label>}
        {inOutNotice && state.exportMode === 'film' && <small role="status">{vi ? 'Khoảng mặc định từ In/Out của timeline (đã làm tròn về lưới 20 tick).' : 'Default range from the timeline In/Out (rounded to the 20-tick grid).'}</small>}
        <label>Aspect<input type="number" min="0.01" step="0.01" value={state.viewportAspect} onChange={(event) => state.setViewportAspect(Number(event.target.value))} disabled={state.busy} /></label>
        <label>{vi ? 'Tên gói' : 'Package name'}<input value={state.filmName} onChange={(event) => state.setFilmName(event.target.value)} disabled={state.busy} maxLength={state.exportMode === 'series' ? 56 : 64} /></label>
        <small>{vi ? 'Xuất Film editable cho BBS FS 2.7. Chế độ Cả tập tự chia theo giới hạn worker, chỉ cắt ở ranh giới cảnh.' : 'Exports editable Film for BBS FS 2.7. Entire episode splits at shot boundaries to fit worker limits.'}</small>
        {state.rangeNotice && <p role="status">{vi
          ? `Đã tự làm tròn khoảng xuất ${state.rangeNotice.from.startFrame}–${state.rangeNotice.from.endFrame} → ${state.rangeNotice.to.startFrame}–${state.rangeNotice.to.endFrame} để khớp lưới 20 tick của BBS Film.`
          : `Export range rounded ${state.rangeNotice.from.startFrame}–${state.rangeNotice.from.endFrame} → ${state.rangeNotice.to.startFrame}–${state.rangeNotice.to.endFrame} to fit the BBS Film 20 Hz tick grid.`}</p>}
        {state.sequenceEmpty && (state.hasCamera
          ? <div className="wb-scene-render-actions">
              <button type="button" onClick={() => void state.createCameraShot()} disabled={state.busy || state.creatingShot}>
                {state.creatingShot ? (vi ? 'Đang tạo shot…' : 'Creating shot…') : (vi ? 'Tạo shot camera cho khoảng này' : 'Create a camera shot for this range')}
              </button>
              <span>{vi ? 'Chuỗi camera đang rỗng; shot Main Camera sẽ phủ đúng khoảng xuất hiện tại.' : 'The camera sequence is empty; a Main Camera shot will cover the current export range.'}</span>
            </div>
          : <p role="alert">{vi ? 'Chuỗi camera đang rỗng và dự án chưa có camera nào; hãy thêm một camera vào cảnh trước khi xuất.' : 'The camera sequence is empty and the project has no camera; add a camera to the scene before exporting.'}</p>)}
        {state.canUndoCreateCameraShot && <button type="button" onClick={() => void state.undoCreateCameraShot()} disabled={state.busy || state.creatingShot}>{vi ? 'Hoàn tác sửa camera' : 'Undo camera repair'}</button>}
        <div className="wb-scene-render-actions">
          <button type="button" onClick={() => void state.exportFilm()} disabled={!state.canExport}>{state.busy ? (vi ? 'Đang xuất…' : 'Exporting…') : state.checkingPreflight ? (vi ? 'Đang kiểm tra…' : 'Checking…') : (vi ? 'Xuất gói' : 'Export package')}</button>
          <button type="button" className="primary" onClick={() => void state.exportFilm({ install: (job) => install.installJob(project.projectId, job.jobId) })}
            disabled={!state.canExport || install.busy || !install.gameDir.trim() || !install.worldName}
            title={!install.gameDir.trim() || !install.worldName ? (vi ? 'Chọn thư mục game và world ở mục "Cài vào game" bên dưới.' : 'Choose a game folder and world under "Install into game" below.') : undefined}>
            {vi ? `Xuất và cài vào game${install.worldName ? ` · ${install.worldName}` : ''}` : `Export and install${install.worldName ? ` · ${install.worldName}` : ''}`}
          </button>
          {state.busy && state.activeJobId && <button type="button" onClick={() => void state.cancel()}>{vi ? 'Hủy' : 'Cancel'}</button>}
          {!state.busy && state.completedJob?.state === 'succeeded' && <button type="button" onClick={() => void state.saveAgain(state.completedJob!)}>{vi ? 'Lưu lại…' : 'Save again…'}</button>}
          {state.status && <span role="status" aria-live="polite">{state.status}</span>}
        </div>
        <div className="wb-film-preflight" aria-live="polite" aria-busy={state.checkingPreflight}>
          {state.checkingPreflight && <p>{vi ? 'Đang kiểm tra lựa chọn xuất…' : 'Checking the export selection…'}</p>}
          {state.preflight?.placement && <p>{`Cảnh sẽ nằm từ X ${state.preflight.placement.min[0]!.toFixed(2)}…${state.preflight.placement.max[0]!.toFixed(2)}, Y ${state.preflight.placement.min[1]!.toFixed(2)}…${state.preflight.placement.max[1]!.toFixed(2)}, Z ${state.preflight.placement.min[2]!.toFixed(2)}…${state.preflight.placement.max[2]!.toFixed(2)} (ước lượng gốc actor/camera/VFX; chưa gồm mesh, root motion và camera bám nhân vật)`}{state.preflight.placement.nearestActorDistance !== undefined ? `; nhân vật gần nhất cách chỗ anh/chị đứng ${state.preflight.placement.nearestActorDistance.toFixed(2)} block` : ''}</p>}
          {state.preflight?.errors.map((item, index) => <p key={`error-${item.code}-${item.nodeId ?? ''}-${item.clipId ?? ''}-${item.frame ?? ''}-${index}`} role="alert">
            {vi ? 'Lỗi' : 'Error'}{item.segment === undefined ? '' : ` · ${vi ? 'Đoạn' : 'Segment'} ${item.segment}`}{vi ? ': ' : ': '}{vi ? item.message.vi : item.message.en}
          </p>)}
          {state.preflight?.warnings.map((item, index) => <p key={`warning-${item.code}-${item.nodeId ?? ''}-${item.clipId ?? ''}-${item.frame ?? ''}-${index}`}>
            {vi ? 'Cảnh báo' : 'Warning'}{item.segment === undefined ? '' : ` · ${vi ? 'Đoạn' : 'Segment'} ${item.segment}`}{vi ? ': ' : ': '}{vi ? item.message.vi : item.message.en}
          </p>)}
          {state.preflight && !state.checkingPreflight && state.preflight.errors.length === 0 && state.preflight.warnings.length === 0 &&
            <p>{vi ? 'Kiểm tra trước khi xuất đạt.' : 'Preflight passed.'}</p>}
        </div>
        {state.error && <p className="wb-scene-render-error" role="alert">{state.error}</p>}
      </div>
    </section>
    <BbsInstallPanel state={install} />
    </>
  )
}
