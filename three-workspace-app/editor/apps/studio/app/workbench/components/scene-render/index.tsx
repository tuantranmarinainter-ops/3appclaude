'use client'

import type { UnifiedProject } from '@bbs/animation-workspace-shared'
import { useSceneRender } from './hooks/useSceneRender'
import { useStudioLocale } from '../../../../src/devtools/localePreference'

export function SceneRenderPanel({ project }: { project: UnifiedProject }) {
  const vi = useStudioLocale() === 'vi'
  const { framesText, setFramesText, busy, activeJobId, completedJob, status, error, cameras, cameraNodeIds, setSelectedCameraIds, render, cancel, saveAgain } = useSceneRender(project)
  return (
    <section className="wb-scene-render" aria-labelledby="wb-scene-render-title">
      <h2 id="wb-scene-render-title">{vi ? 'Thiết lập ảnh PNG' : 'PNG settings'}</h2>
      <label>{vi ? 'Frame cần render' : 'Frames to render'}
        <input value={framesText} onChange={(event) => setFramesText(event.target.value)} disabled={busy} aria-describedby="wb-scene-render-hint" />
      </label>
      <label>{vi ? 'Camera cần render' : 'Cameras to render'}
        <select multiple value={cameraNodeIds} onChange={(event) => setSelectedCameraIds(Array.from(event.target.selectedOptions, (option) => option.value))} disabled={busy}>
          {cameras.map((camera) => <option key={camera.id} value={camera.id}>{camera.name}</option>)}
        </select>
      </label>
      <small id="wb-scene-render-hint">{vi ? 'Phân tách frame bằng dấu phẩy. Tối đa 3 camera và 9 ảnh.' : 'Separate frames with commas. Up to 3 cameras and 9 images.'}</small>
      <div className="wb-scene-render-actions">
        <button type="button" onClick={() => void render()} disabled={busy || !cameraNodeIds.length}>{busy ? (vi ? 'Đang xử lý…' : 'Processing…') : (vi ? 'Tạo ảnh PNG' : 'Render PNG')}</button>
        {busy && activeJobId && <button type="button" onClick={() => void cancel()}>{vi ? 'Hủy' : 'Cancel'}</button>}
        {!busy && completedJob?.state === 'succeeded' && <button type="button" onClick={() => void saveAgain(completedJob)}>{vi ? 'Lưu lại file…' : 'Save again…'}</button>}
        {status && <span role="status" aria-live="polite">{status}</span>}
      </div>
      {error && <p className="wb-scene-render-error" role="alert">{error}</p>}
    </section>
  )
}
