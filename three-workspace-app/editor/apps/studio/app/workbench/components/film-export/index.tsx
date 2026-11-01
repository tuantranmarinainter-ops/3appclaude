'use client'

import { useEffect, useState } from 'react'
import type { UnifiedProject } from '@bbs/animation-workspace-shared'
import { useBbsInstall } from './hooks/useBbsInstall'
import { useFilmExport } from './hooks/useFilmExport'
import { useStudioLocale } from '../../../../src/devtools/localePreference'
import { ExportShotPicker } from './ExportShotPicker'
import { EffectsOptions } from './EffectsOptions'
import { WorldAnchorAdvanced, WorldAnchorFields } from './WorldAnchorFields'
import { BbsInstallPanel } from './BbsInstallPanel'
import { GameFolderStep } from './GameFolderStep'
import { ASPECT_PRESETS, aspectLabel, aspectPreset } from './utils'

/** B54: three steps in the order the user works — ① game, ② content, ③ place in the world — then one big button.
 * Rarely used settings live in "Tuỳ chọn nâng cao". */
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
  const gameReady = !!install.gameDir.trim() && !!install.worldName
  const shotLabel = state.matchingShotId || `${state.effectiveRange.startFrame}–${state.effectiveRange.endFrame}`
  const exportInstall = () => void state.exportFilm({ install: (job) => install.installJob(project.projectId, job.jobId) })
  const preset = aspectPreset(state.viewportAspect)
  return (
    <section className="wb-film-export wb-film-steps" aria-labelledby="wb-film-export-title">
      <h2 id="wb-film-export-title">{vi ? 'Xuất phim vào Minecraft (BBS FS 2.7)' : 'Export Film to Minecraft (BBS FS 2.7)'}</h2>

      <GameFolderStep install={install} vi={vi} />

      <fieldset className="wb-film-step" disabled={state.busy}>
        <legend><span className="wb-film-step-no">2</span>{vi ? 'Nội dung phim' : 'Film content'}</legend>
        {state.canSeries
          ? <label>{vi ? 'Xuất gì' : 'Export'}
              <select value={state.exportMode} onChange={(event) => state.setExportMode(event.target.value as 'film' | 'series')}>
                <option value="film">{vi ? `Shot hiện tại (${shotLabel})` : `Current shot (${shotLabel})`}</option>
                <option value="series">{vi ? 'Nhiều film theo shot trong project này' : 'One film per shot in this project'}</option>
              </select>
              <small>{vi ? 'Shot hiện tại = một file phim cho khoảng đang chọn. Nhiều film = mỗi đoạn shot thành một phim riêng.' : 'Current shot = one film for the selected range. Several films = one film per shot group.'}</small>
            </label>
          : <p className="wb-film-step-note">{vi ? `Xuất: shot hiện tại (${shotLabel}), frame ${state.effectiveRange.startFrame}–${state.effectiveRange.endFrame}.` : `Exporting the current shot (${shotLabel}), frames ${state.effectiveRange.startFrame}–${state.effectiveRange.endFrame}.`}</p>}
        <label>{vi ? 'Đưa gì vào phim' : 'Include'}
          <select value={state.content} onChange={(event) => state.setContent(event.target.value as typeof state.content)}>
            <option value="characters">{vi ? 'Chỉ nhân vật' : 'Characters only'}</option>
            <option value="backdrops">{vi ? 'Chỉ hậu cảnh' : 'Backdrops only'}</option>
            <option value="both">{vi ? 'Nhân vật và hậu cảnh' : 'Characters and backdrops'}</option>
          </select>
        </label>
        {state.exportMode === 'series' && state.content !== 'backdrops' && <label>{vi ? 'Nhân vật cho từng film' : 'Characters per film'}
          <select value={state.seriesCharacterSelection} onChange={(event) => state.setSeriesCharacterSelection(event.target.value as 'auto' | 'selected')}>
            <option value="auto">{vi ? 'Tự chọn nhân vật có mặt trong từng đoạn' : 'Auto per segment'}</option>
            <option value="selected">{vi ? 'Dùng danh sách tick bên dưới' : 'Use the ticked list below'}</option>
          </select>
        </label>}
        {state.content !== 'backdrops' && (state.exportMode === 'film' || state.seriesCharacterSelection === 'selected') &&
          <div className="wb-film-checklist" role="group" aria-label={vi ? 'Nhân vật đưa vào film' : 'Characters in the film'}>
            <div className="wb-film-checklist-head">
              <span>{vi ? 'Nhân vật đưa vào phim (bỏ tick = không có trong phim)' : 'Characters in the film (untick = left out)'}</span>
              <button type="button" onClick={state.selectAllCharacters}>{vi ? 'Chọn tất cả' : 'Select all'}</button>
              <button type="button" onClick={state.clearCharacters}>{vi ? 'Bỏ chọn' : 'Clear'}</button>
            </div>
            {state.characters.map((character) => <label key={character.id} className="wb-check">
              <input type="checkbox" checked={state.characterIds.includes(character.id)} onChange={(event) => state.toggleCharacter(character.id, event.target.checked)} />
              <span>{character.name}{state.actingCharacterIds.includes(character.id) ? (vi ? ' · có động tác trong shot' : ' · acts in this shot') : ''}</span>
            </label>)}
            {state.actingButUnselected.length > 0 && <p role="alert" className="wb-film-warn">{vi
              ? `${state.actingButUnselected.join(', ')} có động tác trong shot nhưng chưa được tick — phim sẽ thiếu nhân vật này.`
              : `${state.actingButUnselected.join(', ')} act in this shot but are not ticked.`}</p>}
          </div>}
        {state.exportMode === 'series' && state.content !== 'characters' && <label>{vi ? 'Hậu cảnh cho từng film' : 'Backdrops per film'}
          <select value={state.seriesPropSelection} onChange={(event) => state.setSeriesPropSelection(event.target.value as 'auto' | 'selected')}>
            <option value="auto">{vi ? 'Tự chọn trong tầm camera (≤ 60 m)' : 'Auto within camera range (≤ 60 m)'}</option>
            <option value="selected">{vi ? 'Dùng danh sách bên dưới' : 'Use the list below'}</option>
          </select>
        </label>}
        {state.content !== 'characters' && (state.exportMode === 'film' || state.seriesPropSelection === 'selected') && <label>{vi ? 'Hậu cảnh' : 'Backdrops'}
          <select multiple value={state.propIds} onChange={(event) => state.setPropIds(Array.from(event.target.selectedOptions, (option) => option.value))} aria-label={vi ? 'Hậu cảnh cần xuất' : 'Backdrops to export'}>
            {state.props.map((prop) => <option key={prop.id} value={prop.id}>{prop.name}</option>)}
          </select>
        </label>}
        <EffectsOptions capabilities={install.capabilities} value={state.effectsPolicy} onChange={state.setEffectsPolicy} disabled={state.busy} vi={vi} />
        <label>{vi ? 'Tên phim' : 'Film name'}<input value={state.filmName} onChange={(event) => state.setFilmName(event.target.value)} maxLength={state.exportMode === 'series' ? 56 : 64} />
          <small>{vi ? 'Tên hiện trong danh sách Film của BBS. Chỉ dùng chữ không dấu, số, dấu - _ .' : 'Shown in the BBS Film list. Letters, digits, - _ . only.'}</small>
        </label>
        <label>{vi ? 'Khung hình' : 'Frame shape'}
          <select value={preset?.label ?? 'custom'} onChange={(event) => { const next = ASPECT_PRESETS.find((item) => item.label === event.target.value); if (next) state.setViewportAspect(next.value) }}>
            {ASPECT_PRESETS.map((item) => <option key={item.label} value={item.label}>{item.label} · {item.hint}</option>)}
            {!preset && <option value="custom">{aspectLabel(state.viewportAspect)}</option>}
          </select>
        </label>
      </fieldset>

      <fieldset className="wb-film-step" disabled={state.busy}>
        <legend><span className="wb-film-step-no">3</span>{vi ? 'Vị trí trong game' : 'Place in the world'}</legend>
        <WorldAnchorFields project={project} value={state.worldAnchor} onChange={state.setWorldAnchor} onValidityChange={state.setWorldAnchorInputValid} />
      </fieldset>

      <div className="wb-film-go">
        {gameReady
          ? <button type="button" className="primary wb-film-go-main" onClick={exportInstall} disabled={!state.canExport || install.busy}>
              {state.busy ? (vi ? 'Đang xuất…' : 'Exporting…') : state.checkingPreflight ? (vi ? 'Đang kiểm tra…' : 'Checking…') : (vi ? `Xuất và cài vào game · ${install.worldName}` : `Export and install · ${install.worldName}`)}
            </button>
          : <button type="button" className="primary wb-film-go-main" onClick={() => void state.exportFilm()} disabled={!state.canExport}>
              {state.busy ? (vi ? 'Đang xuất…' : 'Exporting…') : state.checkingPreflight ? (vi ? 'Đang kiểm tra…' : 'Checking…') : (vi ? 'Lưu gói ZIP (chưa có thư mục game)…' : 'Save ZIP package (no game folder yet)…')}
            </button>}
        {state.busy && state.activeJobId && <button type="button" onClick={() => void state.cancel()}>{vi ? 'Hủy' : 'Cancel'}</button>}
        {!state.busy && state.completedJob?.state === 'succeeded' && <button type="button" onClick={() => void state.revealZip(state.completedJob!)}>{vi ? 'Mở thư mục chứa ZIP' : 'Open ZIP folder'}</button>}
        <small>{gameReady
          ? (vi ? 'Một bấm là xong: app làm phim, lưu gói ZIP trong project rồi chép vào game. Không cần chọn thư mục.' : 'One click: builds the film, keeps the ZIP in the project and copies it into the game.')
          : (vi ? 'Chọn thư mục game ở bước 1 để cài thẳng vào game. Không có thì app lưu một file ZIP (bên trong có phim .dat).' : 'Pick the game folder in step 1 to install directly; otherwise a ZIP (with the .dat film inside) is saved.')}</small>
        {(state.status || install.status) && <p role="status" aria-live="polite">{state.status || install.status}</p>}
        {state.error && <p className="wb-scene-render-error" role="alert" aria-live="assertive">{vi ? 'Chưa xuất được: ' : 'Export stopped: '}{state.error}</p>}
        {install.error && <p className="wb-scene-render-error" role="alert">{install.error}</p>}
      </div>

      <div className="wb-film-preflight" aria-live="polite" aria-busy={state.checkingPreflight}>
        {state.checkingPreflight && <p>{vi ? 'Đang kiểm tra lựa chọn xuất…' : 'Checking the export selection…'}</p>}
        {state.preflight?.errors.map((item, index) => <p key={`error-${item.code}-${item.nodeId ?? ''}-${item.clipId ?? ''}-${item.frame ?? ''}-${index}`} role="alert" className="wb-film-error">
          {vi ? 'Lỗi' : 'Error'}{item.segment === undefined ? '' : ` · ${vi ? 'Đoạn' : 'Segment'} ${item.segment}`}: {vi ? item.message.vi : item.message.en}
        </p>)}
        {state.preflight?.warnings.map((item, index) => <p key={`warning-${item.code}-${item.nodeId ?? ''}-${item.clipId ?? ''}-${item.frame ?? ''}-${index}`} className="wb-film-warn">
          {vi ? 'Lưu ý' : 'Warning'}{item.segment === undefined ? '' : ` · ${vi ? 'Đoạn' : 'Segment'} ${item.segment}`}: {vi ? item.message.vi : item.message.en}
        </p>)}
        {state.preflight && !state.checkingPreflight && state.preflight.errors.length === 0 && state.preflight.warnings.length === 0 &&
          <p>{vi ? 'Kiểm tra trước khi xuất: đạt.' : 'Preflight passed.'}</p>}
        {state.preflight?.placement && <p className="wb-film-muted">{vi
          ? `Cảnh sẽ nằm trong khoảng X ${state.preflight.placement.min[0]!.toFixed(1)}…${state.preflight.placement.max[0]!.toFixed(1)}, Y ${state.preflight.placement.min[1]!.toFixed(1)}…${state.preflight.placement.max[1]!.toFixed(1)}, Z ${state.preflight.placement.min[2]!.toFixed(1)}…${state.preflight.placement.max[2]!.toFixed(1)}${state.preflight.placement.nearestActorDistance !== undefined ? `; nhân vật gần nhất cách chỗ bạn đứng ${state.preflight.placement.nearestActorDistance.toFixed(1)} block` : ''}.`
          : `Scene spans X ${state.preflight.placement.min[0]!.toFixed(1)}…${state.preflight.placement.max[0]!.toFixed(1)}, Y ${state.preflight.placement.min[1]!.toFixed(1)}…${state.preflight.placement.max[1]!.toFixed(1)}, Z ${state.preflight.placement.min[2]!.toFixed(1)}…${state.preflight.placement.max[2]!.toFixed(1)}.`}</p>}
      </div>

      <details className="wb-film-advanced">
        <summary>{vi ? 'Tuỳ chọn nâng cao' : 'Advanced options'}</summary>
        <fieldset className="wb-film-step" disabled={state.busy}>
          <legend>{vi ? 'Khoảng phim và camera' : 'Range and camera'}</legend>
          <label>{vi ? 'Chuỗi camera' : 'Camera sequence'}
            <select value={state.sequenceId} onChange={(event) => state.setSequenceId(event.target.value)}>
              {state.sequences.map((sequence) => <option key={sequence.id} value={sequence.id}>{sequence.id}</option>)}
            </select>
          </label>
          {state.exportMode === 'film' && <ExportShotPicker state={state} vi={vi} />}
          {state.exportMode === 'film' && <div className="wb-film-row">
            <label>{vi ? 'Frame đầu' : 'Start frame'}<input type="number" value={state.startFrame} onChange={(event) => state.setStartFrame(Number(event.target.value))} /></label>
            <label>{vi ? 'Frame cuối' : 'End frame'}<input type="number" value={state.endFrame} onChange={(event) => state.setEndFrame(Number(event.target.value))} /></label>
          </div>}
          {inOutNotice && state.exportMode === 'film' && <small role="status">{vi ? 'Khoảng mặc định lấy từ In/Out của timeline (đã làm tròn về lưới 20 tick).' : 'Default range from the timeline In/Out (rounded to the 20-tick grid).'}</small>}
          {state.rangeNotice && <small role="status">{vi
            ? `Đã tự làm tròn khoảng ${state.rangeNotice.from.startFrame}–${state.rangeNotice.from.endFrame} → ${state.rangeNotice.to.startFrame}–${state.rangeNotice.to.endFrame} cho khớp nhịp 20 tick/giây của BBS.`
            : `Range rounded ${state.rangeNotice.from.startFrame}–${state.rangeNotice.from.endFrame} → ${state.rangeNotice.to.startFrame}–${state.rangeNotice.to.endFrame} to the BBS 20 Hz tick grid.`}</small>}
          {state.sequenceEmpty && (state.hasCamera
            ? <div className="wb-scene-render-actions">
                <button type="button" onClick={() => void state.createCameraShot()} disabled={state.creatingShot}>
                  {state.creatingShot ? (vi ? 'Đang tạo shot…' : 'Creating shot…') : (vi ? 'Tạo shot camera cho khoảng này' : 'Create a camera shot for this range')}
                </button>
                <span>{vi ? 'Chuỗi camera đang rỗng; shot Main Camera sẽ phủ đúng khoảng xuất hiện tại.' : 'The camera sequence is empty; a Main Camera shot will cover the current export range.'}</span>
              </div>
            : <p role="alert">{vi ? 'Chuỗi camera đang rỗng và dự án chưa có camera nào; hãy thêm một camera vào cảnh trước khi xuất.' : 'The camera sequence is empty and the project has no camera; add a camera to the scene before exporting.'}</p>)}
          {state.canUndoCreateCameraShot && <button type="button" onClick={() => void state.undoCreateCameraShot()} disabled={state.creatingShot}>{vi ? 'Hoàn tác sửa camera' : 'Undo camera repair'}</button>}
        </fieldset>
        <fieldset className="wb-film-step" disabled={state.busy}>
          <legend>{vi ? 'Đặt cảnh chính xác' : 'Exact placement'}</legend>
          <WorldAnchorAdvanced project={project} value={state.worldAnchor} onChange={state.setWorldAnchor} />
        </fieldset>
        <fieldset className="wb-film-step" disabled={state.busy}>
          <legend>{vi ? 'Lưu ra chỗ khác' : 'Save elsewhere'}</legend>
          <small>{vi ? 'Không cần nếu đã cài thẳng vào game. Gói ZIP chứa phim .dat, nhân vật và hiệu ứng.' : 'Not needed when installing directly. The ZIP holds the .dat film, characters and effects.'}</small>
          <div className="wb-scene-render-actions">
            <button type="button" onClick={() => void state.exportFilm()} disabled={!state.canExport}>{vi ? 'Lưu ZIP ra chỗ khác…' : 'Save ZIP elsewhere…'}</button>
            {state.exportMode === 'film' && <button type="button" onClick={() => void state.exportFilm({ datOnly: true })} disabled={!state.canExport}>{vi ? 'Chỉ lưu file .dat…' : 'Save the .dat only…'}</button>}
            {!state.busy && state.completedJob?.state === 'succeeded' && <button type="button" onClick={() => void state.saveAgain(state.completedJob!)}>{vi ? 'Lưu lại gói vừa xuất…' : 'Save the last package again…'}</button>}
          </div>
        </fieldset>
        <BbsInstallPanel state={install} />
      </details>
    </section>
  )
}
