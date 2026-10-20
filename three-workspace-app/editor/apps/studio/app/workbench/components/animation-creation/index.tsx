'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { UnifiedProject } from '@bbs/animation-workspace-shared'
import { loadUnifiedProject, sendUnifiedCommand } from '../../../../src/unifiedApi'

const CHANNEL = 'bbs-animation-studio-v1.31.8'
const FRAME_URL = '/animation-studio/v1.31.8/index.html'
const BRIDGE_URL = '/animation-studio/v1.31.8/host-bridge.js'

type BridgeReply = { channel: string; requestId: string; ok: boolean; value?: { state?: { project?: Record<string, unknown> }; nativeProject?: Record<string, unknown>; derivativeBase64?: string; fps?: number; duration?: number }; error?: string }

export function AnimationCreationPanel({ projectId, project, active, onProject, onEditorDirty }: { projectId: string; project: UnifiedProject; active: boolean; onProject: (project: UnifiedProject) => void; onEditorDirty: (dirty: boolean) => void }) {
  const frame = useRef<HTMLIFrameElement>(null)
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
  const nativeMotions = useMemo(() => Object.values(project.motions).filter((motion) => motion.evaluator === 'animation-1.31.8' && motion.edit), [project])

  const receive = useCallback((event: MessageEvent) => {
    if (event.origin !== location.origin || event.source !== frame.current?.contentWindow || event.data?.channel !== CHANNEL) return
    if (event.data.type === 'bridge-ready') { setStatus('Animation Studio 1.31.8 đang khởi động…'); return }
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
  useEffect(() => { frame.current?.contentWindow?.postMessage({ channel: CHANNEL, requestId: crypto.randomUUID(), type: 'active', value: { active } }, location.origin) }, [active])

  function request(type: 'open' | 'save' | 'saved', value?: unknown): Promise<BridgeReply['value']> {
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
        if (!motion || !motionAsset || !motion.edit) throw new Error('Animation này chưa có dữ liệu chỉnh sửa native.')
        const [motionResponse, editResponse] = await Promise.all([
          fetch(`/api/unified/projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(motionAsset.id)}/source?format=glb`),
          fetch(`/api/unified/projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(motionAsset.id)}/nativeEdit-${motion.edit.sha256}`),
        ])
        if (!motionResponse.ok || !editResponse.ok) throw new Error('Không tải lại được dữ liệu animation đã lưu.')
        const [motionBytes, edit] = await Promise.all([motionResponse.arrayBuffer(), editResponse.json()])
        const clip = Object.values(project.bindings).find((binding) => binding.motionId === existingMotionId && binding.characterId === characterId)
        nextClipId = clip?.clipId ?? ''
        await request('open', { bytes: motionBytes, name: `${motionAsset.displayName}.glb`, nativeProject: edit })
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

  async function saveMotion(asNew = false) {
    if (busy || !characterId || !opened) return
    setBusy(true); setError(''); setStatus('Đang tạo và kiểm tra animation…')
    try {
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
    {error && <p className="wb-animation-creation-error" role="alert">{error}</p>}
    <p className="wb-animation-creation-status" role="status">{status}</p>
    <iframe ref={frame} className="wb-animation-creation-frame" title="Animation Studio 1.31.8" src={FRAME_URL} onLoad={() => {
      const doc = frame.current?.contentDocument
      if (!doc || doc.querySelector('[data-bbs-host-bridge]')) return
      const script = doc.createElement('script'); script.src = BRIDGE_URL; script.dataset.bbsHostBridge = 'true'; doc.body.append(script)
    }} />
  </section>
}
