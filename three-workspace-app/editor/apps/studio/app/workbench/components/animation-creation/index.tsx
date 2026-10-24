'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSilhouetteSync } from './hooks/useSilhouetteSync'
import type { UnifiedProject } from '@bbs/animation-workspace-shared'
import { loadUnifiedJob, loadUnifiedJobFile, loadUnifiedProject, sendUnifiedCommand, uploadUnifiedAsset } from '../../../../src/unifiedApi'

const CHANNEL = 'bbs-animation-studio-v1.32.0'
const FRAME_URL = '/animation-studio/v1.32.0/index.html'
const BRIDGE_URL = '/animation-studio/v1.32.0/host-bridge.js'

type BridgeReply = { channel: string; requestId: string; ok: boolean; value?: { state?: { project?: Record<string, unknown> }; nativeProject?: Record<string, unknown>; derivativeBase64?: string; fps?: number; duration?: number; shotId?: string; characterId?: string; zip?: ArrayBuffer }; error?: string }

export function AnimationCreationPanel({ projectId, project, active, onProject, onEditorDirty }: { projectId: string; project: UnifiedProject; active: boolean; onProject: (project: UnifiedProject) => void; onEditorDirty: (dirty: boolean) => void }) {
  const frame = useRef<HTMLIFrameElement>(null)
  useSilhouetteSync(frame)
  const openedRevision = useRef<number | null>(null)
  const pending = useRef(new Map<string, { resolve: (value: BridgeReply['value']) => void; reject: (error: Error) => void }>())
  const [characterId, setCharacterId] = useState(Object.keys(project.characters)[0] ?? '')
  const [motionId, setMotionId] = useState('')
  const [clipId, setClipId] = useState('')
  const [opened, setOpened] = useState(false)
  const [editorDirty, setEditorDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('Chọn nhân vật rồi tạo hoặc mở animation.')
  const [error, setError] = useState('')
  const [revisionConflict, setRevisionConflict] = useState(false)
  const characters = Object.values(project.characters)
  const cameras = project.scene.content.nodes.filter((node) => node.type === 'camera')
  const timeline = project.scene.content.timeline
  const [cameraId, setCameraId] = useState(cameras[0]?.id ?? '')
  const [shotRange, setShotRange] = useState<[number, number]>([timeline.frameStart, timeline.frameEnd])
  const [shotId, setShotId] = useState('')
  const [withBobj, setWithBobj] = useState(false)
  const nativeMotions = useMemo(() => Object.values(project.motions).filter((motion) => {
    const asset = project.assets[motion.assetId]
    const boundToCharacter = Object.values(project.bindings).some((binding) => binding.motionId === motion.id && binding.characterId === characterId)
    return asset?.source.mediaType === 'model/gltf-binary' && (motion.edit || boundToCharacter)
  }), [characterId, project])

  const receive = useCallback((event: MessageEvent) => {
    if (event.origin !== location.origin || event.source !== frame.current?.contentWindow || event.data?.channel !== CHANNEL) return
    if (event.data.type === 'bridge-ready') { setStatus('Animation Studio 1.32.0 đang khởi động…'); return }
    if (event.data.type === 'dirty') { const dirty = event.data.dirty === true; setEditorDirty(dirty); onEditorDirty(dirty); return }
    const item = pending.current.get(event.data.requestId)
    if (!item) return
    pending.current.delete(event.data.requestId)
    if (event.data.ok) item.resolve(event.data.value)
    else item.reject(new Error(event.data.error || 'Animation Studio không phản hồi.'))
  }, [onEditorDirty])

  useEffect(() => {
    const requests = pending.current
    window.addEventListener('message', receive)
    return () => { window.removeEventListener('message', receive); onEditorDirty(false); for (const item of requests.values()) item.reject(new Error('Workspace đã đóng.')); requests.clear() }
  }, [receive, onEditorDirty])

  useEffect(() => { if (!characters.some((character) => character.id === characterId)) setCharacterId(characters[0]?.id ?? '') }, [characters, characterId])
  useEffect(() => { if (motionId && !nativeMotions.some((motion) => motion.id === motionId)) { setMotionId(''); setClipId('') } }, [motionId, nativeMotions])
  useEffect(() => { frame.current?.contentWindow?.postMessage({ channel: CHANNEL, requestId: crypto.randomUUID(), type: 'active', value: { active } }, location.origin) }, [active])

  function request(type: 'open' | 'save' | 'saved' | 'shotOpen' | 'shotExport', value?: unknown): Promise<BridgeReply['value']> {
    const target = frame.current?.contentWindow
    if (!target) return Promise.reject(new Error('Editor chưa mở.'))
    const requestId = crypto.randomUUID()
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => { pending.current.delete(requestId); reject(new Error('Editor không phản hồi sau 30 giây.')) }, 30000)
      pending.current.set(requestId, { resolve: (result) => { clearTimeout(timer); resolve(result) }, reject: (cause) => { clearTimeout(timer); reject(cause) } })
      target.postMessage({ channel: CHANNEL, requestId, type, value }, location.origin)
    })
  }

  async function openEditor(existingMotionId?: string) {
    const character = project.characters[characterId]
    const asset = character && project.assets[character.assetId]
    if (!character || !asset || busy) return
    setBusy(true); setError(''); setStatus('Đang nạp rig vào Animation Studio…')
    try {
      const response = await fetch(`/api/unified/projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(asset.id)}/source`)
      if (!response.ok) throw new Error(`Không tải được model nhân vật (HTTP ${response.status}).`)
      const bytes = await response.arrayBuffer()
      let nativeProject: Record<string, unknown> | undefined
      let nextClipId = ''
      if (existingMotionId) {
        const motion = project.motions[existingMotionId]
        const motionAsset = motion && project.assets[motion.assetId]
        if (!motion || !motionAsset) throw new Error('Animation này không còn trong project.')
        const motionResponse = await fetch(`/api/unified/projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(motionAsset.id)}/source?format=glb`)
        if (!motionResponse.ok) throw new Error('Không tải lại được dữ liệu animation đã lưu.')
        const motionBytes = await motionResponse.arrayBuffer()
        const clip = Object.values(project.bindings).find((binding) => binding.motionId === existingMotionId && binding.characterId === characterId)
        nextClipId = clip?.clipId ?? ''
        const value: { bytes: ArrayBuffer; name: string; nativeProject?: Record<string, unknown> } = { bytes: motionBytes, name: `${motionAsset.displayName}.glb` }
        if (motion.edit) {
          const editResponse = await fetch(`/api/unified/projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(motionAsset.id)}/nativeEdit-${motion.edit.sha256}`)
          if (!editResponse.ok) throw new Error('Không tải lại được dữ liệu chỉnh sửa native.')
          value.nativeProject = await editResponse.json()
        }
        await request('open', value)
      } else {
        const extension = asset.source.mediaType === 'application/vnd.autodesk.fbx' ? '.fbx' : '.glb'
        await request('open', { bytes, name: `${asset.displayName}${extension}` })
      }
      setMotionId(existingMotionId ?? '')
      setClipId(nextClipId)
      openedRevision.current = project.revision
      setRevisionConflict(false)
      setOpened(true)
      setStatus(existingMotionId ? 'Đã mở bản chỉnh sửa native. Lưu sẽ tạo một bản mới.' : 'Rig đã nạp. Hãy tạo key xương trong editor rồi lưu vào project.')
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); setStatus('Không thể mở editor.') }
    finally { setBusy(false) }
  }

  /** App 2 → App 3: export the shot from the scene (shot.export), then open its ZIP in the editor. */
  async function openShot() {
    if (busy || !characterId || !cameraId) return
    setBusy(true); setError(''); setStatus('Đang xuất gói shot từ cảnh…')
    try {
      const latest = await loadUnifiedProject(projectId)
      const response = await sendUnifiedCommand({ requestId: crypto.randomUUID(), projectId, expectedRevision: latest.project.revision, command: 'shot.export',
        args: { cameraNodeId: cameraId, frameStart: shotRange[0], frameEnd: shotRange[1], editableCharacterIds: [characterId] } })
      const job = await loadUnifiedJob(projectId, String(response.result.jobId))
      const file = job.result?.files.find((item) => item.name.endsWith('.zip')) ?? job.result?.files[0]
      if (!file) throw new Error('shot.export không trả file ZIP.')
      const bytes = await (await loadUnifiedJobFile(projectId, job.jobId, file.id)).arrayBuffer()
      setStatus('Đang mở gói shot trong Animation Studio…')
      await request('shotOpen', { bytes })
      setShotId(String(response.result.shotId))
      openedRevision.current = latest.project.revision
      setOpened(true)
      setStatus(`Đã mở shot ${String(response.result.shotId).slice(0, 8)} (frame ${shotRange[0]}–${shotRange[1]}). Chỉnh xong bấm "Trả kết quả về cảnh".`)
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); setStatus('Không mở được shot.') }
    finally { setBusy(false) }
  }

  /** App 3 → App 2: result package ZIP from the editor → upload → shot.result.import (new Motion, one Undo step). */
  async function returnShot() {
    if (busy || !shotId) return
    setBusy(true); setError(''); setStatus('Đang xuất gói kết quả…')
    try {
      const exported = await request('shotExport', { includeMinecraft20: withBobj })
      if (!exported?.zip) throw new Error('Editor không trả gói kết quả.')
      const upload = await uploadUnifiedAsset(new File([exported.zip], `${shotId}.result.zip`, { type: 'application/zip' }))
      const latest = await loadUnifiedProject(projectId)
      const response = await sendUnifiedCommand({ requestId: crypto.randomUUID(), projectId, expectedRevision: latest.project.revision, command: 'shot.result.import', args: { file: upload.uploadId, shotId } })
      setShotId('')
      const updated = await loadUnifiedProject(projectId).catch(() => null)
      if (updated) onProject(updated.project)
      setStatus(`Đã trả kết quả về cảnh · revision ${response.revision}. Clip đã trỏ sang Action mới; Action gốc vẫn giữ.`)
      window.dispatchEvent(new CustomEvent('bbs-unified-project-commit', { detail: { projectId } }))
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      setError(message); setStatus(/revision|stale/i.test(message) ? 'Cảnh đã đổi sau khi xuất shot: hãy mở lại shot.' : 'Trả kết quả thất bại; bản chỉnh trong editor vẫn còn.')
    }
    finally { setBusy(false) }
  }

  async function saveMotion(asNew = false) {
    if (busy || !characterId || !opened) return
    setBusy(true); setError(''); setStatus('Đang tạo và kiểm tra animation…')
    try {
      if (shotId) {
        const exported = await request('shotExport', { includeMinecraft20: withBobj })
        if (!exported?.zip) throw new Error('Editor không trả gói kết quả để lưu.')
        const upload = await uploadUnifiedAsset(new File([exported.zip], `${shotId}.draft.zip`, { type: 'application/zip' }))
        const saved = await fetch(`/api/unified/projects/${encodeURIComponent(projectId)}/shots/${encodeURIComponent(shotId)}/draft`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ file: upload.uploadId }),
        })
        if (!saved.ok) { const body = await saved.json(); throw new Error(body.error?.message ?? 'Không lưu được bản chỉnh của shot.') }
        await request('saved')
        setOpened(false)
        setEditorDirty(false)
        onEditorDirty(false)
        setStatus('Đã lưu bản chỉnh của shot vào project · hãy bấm "Trả kết quả về cảnh" để cập nhật timeline.')
        return
      }
      const result = await request('save')
      if (!result?.nativeProject || !result.derivativeBase64) throw new Error('Editor không trả native project và GLB animation.')
      const latest = await loadUnifiedProject(projectId)
      const response = await sendUnifiedCommand({
        requestId: crypto.randomUUID(), projectId, expectedRevision: asNew ? latest.project.revision : openedRevision.current ?? project.revision, command: 'motion.edit',
        args: { characterId, ...(!asNew && motionId ? { motionId } : {}), ...(!asNew && clipId ? { clipId } : {}), edit: result.nativeProject, derivativeBase64: result.derivativeBase64 },
      })
      setMotionId(String(response.result.motionId ?? ''))
      setClipId('')
      setRevisionConflict(false)
      await request('saved').catch(() => undefined)
      setEditorDirty(false)
      onEditorDirty(false)
      const updated = await loadUnifiedProject(projectId).catch(() => null)
      if (updated) onProject(updated.project)
      setStatus(`Đã lưu animation vào project · revision ${response.revision}.`)
      window.dispatchEvent(new CustomEvent('bbs-unified-project-commit', { detail: { projectId } }))
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      setRevisionConflict(/revision|stale|changed/i.test(message))
      setError(message); setStatus('Lưu thất bại; dữ liệu đang mở trong editor được giữ lại.')
    }
    finally { setBusy(false) }
  }

  return <section className="wb-animation-creation" aria-label="Animation Creation">
    <header className="wb-animation-creation-toolbar">
      <label>Nhân vật<select value={characterId} onChange={(event) => setCharacterId(event.target.value)} disabled={busy || editorDirty || !characters.length}>
        {characters.map((character) => <option key={character.id} value={character.id}>{character.name}</option>)}
      </select></label>
      <label>Animation đã lưu<select value={motionId} onChange={(event) => setMotionId(event.target.value)} disabled={busy || editorDirty || !nativeMotions.length}>
        <option value="">Tạo animation mới</option>
        {nativeMotions.map((motion) => <option key={motion.id} value={motion.id}>{project.assets[motion.assetId]?.displayName ?? motion.id}</option>)}
      </select></label>
      <button type="button" disabled={!characterId || busy || editorDirty} onClick={() => void openEditor(motionId || undefined)}>{motionId ? 'Chỉnh animation' : 'Tạo animation'}</button>
      <button type="button" className="wb-host-primary" disabled={busy || !characterId || !opened} onClick={() => void saveMotion()}>Lưu vào project</button>
      {revisionConflict && editorDirty && <button type="button" disabled={busy} onClick={() => void saveMotion(true)}>Lưu thành animation mới</button>}
      {editorDirty && <button type="button" disabled={busy} onClick={() => { frame.current?.contentWindow?.location.reload(); setOpened(false); setEditorDirty(false); onEditorDirty(false); setStatus('Đã bỏ bản sửa chưa lưu; animation đã lưu trong project vẫn còn.') }}>Bỏ sửa</button>}
    </header>
    <header className="wb-animation-creation-toolbar" aria-label="Shot từ cảnh">
      <label>Camera<select value={cameraId} onChange={(event) => setCameraId(event.target.value)} disabled={busy || !!shotId || !cameras.length}>
        {cameras.map((camera) => <option key={camera.id} value={camera.id}>{camera.name}</option>)}
      </select></label>
      <label>Từ frame<input type="number" value={shotRange[0]} min={timeline.frameStart} max={shotRange[1]} disabled={busy || !!shotId} onChange={(event) => setShotRange([Number(event.target.value), shotRange[1]])} /></label>
      <label>Đến frame<input type="number" value={shotRange[1]} min={shotRange[0]} max={timeline.frameEnd} disabled={busy || !!shotId} onChange={(event) => setShotRange([shotRange[0], Number(event.target.value)])} /></label>
      <button type="button" disabled={busy || editorDirty || !characterId || !cameraId || !!shotId} onClick={() => void openShot()}>Mở shot từ cảnh</button>
      <label><input type="checkbox" checked={withBobj} disabled={busy} onChange={(event) => setWithBobj(event.target.checked)} />Kèm .bobj</label>
      <button type="button" className="wb-host-primary" disabled={busy || !shotId} onClick={() => void returnShot()}>Trả kết quả về cảnh</button>
    </header>
    {error && <p className="wb-animation-creation-error" role="alert">{error}</p>}
    <p className="wb-animation-creation-status" role="status">{status}</p>
    <iframe ref={frame} className="wb-animation-creation-frame" title="Animation Studio 1.32.0" src={FRAME_URL} onLoad={() => {
      const doc = frame.current?.contentDocument
      if (!doc || doc.querySelector('[data-bbs-host-bridge]')) return
      const script = doc.createElement('script'); script.src = BRIDGE_URL; script.dataset.bbsHostBridge = 'true'; doc.body.append(script)
    }} />
  </section>
}
