'use client'

import { useEffect, useMemo, useState } from 'react'
import type { RetargetSession, UnifiedProject } from '@bbs/animation-workspace-shared'
import { isRetargetProjectV99, type Quat } from '@bbs/retarget'
import { loadUnifiedProject, sendUnifiedCommand } from '../../../src/unifiedApi'
import { useStudioLocale } from '../../../src/devtools/localePreference'
import type { RetargetReferencePose } from './RetargetPreview'

function isRecord(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value) }

function referencePoseForSession(project: UnifiedProject, links: Pick<RetargetSession, 'sourceMotionId' | 'targetCharacterId' | 'mappingId'>, value: unknown): RetargetReferencePose | null {
  if (!isRetargetProjectV99(value) || value.rig.source !== 'mixamo65' || value.rig.target !== 'bobj20') return null
  const motion = project.motions[links.sourceMotionId]
  const character = project.characters[links.targetCharacterId]
  const mapping = project.mappings[links.mappingId]
  const profile = motion && project.skeletons[motion.skeletonId]
  const targetProfile = character && project.skeletons[character.skeletonId]
  const asset = motion && project.assets[motion.assetId]
  const sourcePose = isRecord(value.state.context) && isRecord(value.state.context.sourcePose) ? value.state.context.sourcePose : null
  if (!motion || motion.evaluator !== 'retarget-9.12' || !character || !mapping || mapping.sourceProfileId !== motion.skeletonId || mapping.targetProfileId !== character.skeletonId ||
    profile?.family !== 'mixamo65' || targetProfile?.family !== 'minecraft20' || !asset || !sourcePose || !Object.keys(sourcePose).length) return null
  return { mappingId: mapping.id, sourceHash: asset.source.sha256, sourceMetersPerUnit: profile.metersPerUnit, bones: sourcePose as Record<string, Quat> }
}

export function RetargetSessionPanel({ projectId, onReferencePoseChange }: { projectId: string; onReferencePoseChange: (reference: RetargetReferencePose | null) => void }) {
  const vi = useStudioLocale() === 'vi'
  const [project, setProject] = useState<UnifiedProject | null>(null)
  const [motionId, setMotionId] = useState('')
  const [characterId, setCharacterId] = useState('')
  const [mappingId, setMappingId] = useState('')
  const [sessionId, setSessionId] = useState('')
  const [nativeProject, setNativeProject] = useState<Record<string, unknown> | null>(null)
  const [fileName, setFileName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  useEffect(() => {
    let active = true
    const refresh = () => { void loadUnifiedProject(projectId).then(({ project: next }) => { if (active) { setProject(next); setError('') } }).catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : String(cause)) }) }
    const onCommit = (event: Event) => { if ((event as CustomEvent<{ projectId?: string }>).detail?.projectId === projectId) refresh() }
    refresh()
    window.addEventListener('bbs-unified-project-commit', onCommit)
    return () => { active = false; window.removeEventListener('bbs-unified-project-commit', onCommit) }
  }, [projectId])

  const motions = useMemo(() => project ? Object.values(project.motions).filter((motion) => motion.evaluator === 'retarget-9.12' && project.skeletons[motion.skeletonId]?.family === 'mixamo65') : [], [project])
  const characters = useMemo(() => project ? Object.values(project.characters).filter((character) => project.skeletons[character.skeletonId]?.family === 'minecraft20') : [], [project])
  const mappings = useMemo(() => project ? Object.values(project.mappings).filter((mapping) => mapping.sourceProfileId === project.motions[motionId]?.skeletonId && mapping.targetProfileId === project.characters[characterId]?.skeletonId) : [], [project, motionId, characterId])

  useEffect(() => {
    if (!motions.some((motion) => motion.id === motionId)) setMotionId(motions[0]?.id ?? '')
    if (!characters.some((character) => character.id === characterId)) setCharacterId(characters[0]?.id ?? '')
    if (!mappings.some((mapping) => mapping.id === mappingId)) setMappingId(mappings[0]?.id ?? '')
  }, [motions, characters, mappings, motionId, characterId, mappingId])

  function selectSession(value: string) {
    setSessionId(value)
    setMessage('')
    setNativeProject(null)
    onReferencePoseChange(null)
    const session = project?.retargetSessions[value]
    if (session) { setMotionId(session.sourceMotionId); setCharacterId(session.targetCharacterId); setMappingId(session.mappingId) }
  }

  async function importProject(file: File | undefined) {
    if (!file) return
    setError(''); setMessage('')
    try {
      if (file.size > 12 * 1024 * 1024) throw new Error(vi ? 'File project vượt giới hạn 12 MiB.' : 'Project JSON exceeds the 12 MiB V9.12 limit.')
      const parsed: unknown = JSON.parse(await file.text())
      if (!isRecord(parsed)) throw new Error(vi ? 'Project JSON phải là object.' : 'Project JSON must be an object.')
      onReferencePoseChange(null)
      setNativeProject(parsed)
      setFileName(file.name)
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
  }

  async function loadSession() {
    if (!sessionId || busy) return
    setBusy(true); setError(''); setMessage('')
    try {
      const response = await fetch(`/api/unified/projects/${encodeURIComponent(projectId)}/retarget-sessions/${encodeURIComponent(sessionId)}/native-project`, { cache: 'no-store' })
      if (!response.ok) throw new Error(`Session HTTP ${response.status}`)
      const value: unknown = await response.json()
      if (!isRetargetProjectV99(value)) throw new Error('Stored native project is invalid')
      setNativeProject(value); setFileName(`${sessionId}.retarget.json`)
      if (selectedSession && project) onReferencePoseChange(referencePoseForSession(project, selectedSession, value))
      setMessage(vi ? 'Đã nạp snapshot V9.12 của session.' : 'Loaded the V9.12 session snapshot.')
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusy(false) }
  }

  function downloadProject() {
    if (!nativeProject) return
    const url = URL.createObjectURL(new Blob([JSON.stringify(nativeProject, null, 2)], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url; link.download = fileName || 'retarget-v9.12.json'; link.click()
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }

  async function saveSession() {
    if (!project || !motionId || !characterId || !mappingId || !nativeProject || busy) return
    setBusy(true); setError(''); setMessage('')
    try {
      const latest = await loadUnifiedProject(projectId)
      const response = await sendUnifiedCommand({
        requestId: crypto.randomUUID(), projectId, expectedRevision: latest.project.revision, command: 'retarget.session.set',
        args: { ...(sessionId ? { sessionId } : {}), sourceMotionId: motionId, targetCharacterId: characterId, mappingId, nativeProject },
      })
      const savedId = String(response.result.sessionId)
      setSessionId(savedId)
      onReferencePoseChange(referencePoseForSession(latest.project, { sourceMotionId: motionId, targetCharacterId: characterId, mappingId }, nativeProject))
      setMessage(vi ? `Đã lưu session ${savedId.slice(0, 8)} · revision ${response.revision}.` : `Saved session ${savedId.slice(0, 8)} · revision ${response.revision}.`)
      window.dispatchEvent(new CustomEvent('bbs-unified-project-commit', { detail: { projectId } }))
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusy(false) }
  }

  const selectedSession = project && sessionId ? project.retargetSessions[sessionId] as RetargetSession | undefined : undefined

  return (
    <section className="wb-retarget-session" aria-labelledby="wb-retarget-session-title">
      <div className="wb-retarget-session-heading">
        <div><h2 id="wb-retarget-session-title">{vi ? 'Session V9.12' : 'V9.12 session'}</h2><p>{vi ? 'Giữ nguyên project native đã xác thực và liên kết với motion, nhân vật, mapping trong project chung.' : 'Preserve a validated native project and bind it to the shared motion, character, and mapping.'}</p></div>
        <span>{Object.keys(project?.retargetSessions ?? {}).length} {vi ? 'session' : 'sessions'}</span>
      </div>
      {project ? <div className="wb-retarget-session-grid">
        <label>{vi ? 'Session đã lưu' : 'Saved session'}<select value={sessionId} onChange={(event) => selectSession(event.target.value)}>
          <option value="">{vi ? 'Tạo session mới' : 'Create a new session'}</option>
          {Object.values(project.retargetSessions).map((session) => <option key={session.id} value={session.id}>{session.id.slice(0, 8)} · {project.motions[session.sourceMotionId]?.id.slice(0, 8) ?? 'missing motion'}</option>)}
        </select></label>
        <label>{vi ? 'Motion nguồn Mixamo65' : 'Mixamo65 source motion'}<select value={motionId} onChange={(event) => { setMotionId(event.target.value); onReferencePoseChange(null) }} disabled={!motions.length}>
          {motions.map((motion) => <option key={motion.id} value={motion.id}>{project.assets[motion.assetId]?.displayName ?? motion.id} · {motion.id.slice(0, 8)}</option>)}
        </select></label>
        <label>{vi ? 'Nhân vật đích Minecraft20' : 'Minecraft20 target character'}<select value={characterId} onChange={(event) => { setCharacterId(event.target.value); onReferencePoseChange(null) }} disabled={!characters.length}>
          {characters.map((character) => <option key={character.id} value={character.id}>{character.name}</option>)}
        </select></label>
        <label>{vi ? 'Mapping skeleton' : 'Skeleton mapping'}<select value={mappingId} onChange={(event) => { setMappingId(event.target.value); onReferencePoseChange(null) }} disabled={!mappings.length}>
          {mappings.map((mapping) => <option key={mapping.id} value={mapping.id}>{mapping.confirmed ? '✓' : 'Draft'} · {mapping.id.slice(0, 8)}</option>)}
        </select></label>
        <label className="wb-retarget-session-file">{vi ? 'Project JSON xuất từ V9.12' : 'Project JSON exported from V9.12'}<input type="file" accept="application/json,.json" onChange={(event) => { void importProject(event.target.files?.[0]); event.target.value = '' }} /></label>
        <div className="wb-retarget-session-actions">
          {selectedSession && <button type="button" onClick={() => void loadSession()} disabled={busy}>{vi ? 'Nạp snapshot' : 'Load snapshot'}</button>}
          {nativeProject && <button type="button" onClick={downloadProject}>{vi ? 'Tải JSON' : 'Download JSON'}</button>}
          <button type="button" className="wb-retarget-load" onClick={() => void saveSession()} disabled={busy || !motionId || !characterId || !mappingId || !nativeProject}>
            {busy ? (vi ? 'Đang xử lý…' : 'Working…') : sessionId ? (vi ? 'Cập nhật session' : 'Update session') : (vi ? 'Lưu session' : 'Save session')}
          </button>
        </div>
        {nativeProject && <p className="wb-retarget-session-file-name" role="status">{fileName || 'V9.12 JSON'} · {vi ? 'snapshot giữ nguyên; chưa bake vào timeline.' : 'snapshot preserved; not baked to the timeline.'}</p>}
      </div> : <p role="status">{vi ? 'Đang đọc project…' : 'Loading project…'}</p>}
      {error && <p className="wb-retarget-error" role="alert">{error}</p>}
      {message && <p className="wb-retarget-saved" role="status">{message}</p>}
      {project && (!motions.length || !characters.length || !mappings.length) && <p className="wb-retarget-preview-note">{vi ? 'Cần có Motion Mixamo65, Character Minecraft20 và mapping giữa hai profile trước khi lưu session.' : 'Import a Mixamo65 motion, add a Minecraft20 character, and save a mapping before storing a session.'}</p>}
    </section>
  )
}
