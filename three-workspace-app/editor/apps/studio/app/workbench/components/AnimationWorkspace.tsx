'use client'

import { useEffect, useMemo, useState } from 'react'
import type { MotionBinding, UnifiedProject } from '@bbs/animation-workspace-shared'
import { loadUnifiedProject, sendUnifiedCommand, uploadUnifiedAsset } from '../../../src/unifiedApi'
import { useStudioLocale } from '../../../src/devtools/localePreference'
import { HostDrawer } from './HostDrawer'
import { AnimationCreationPanel } from './animation-creation'

export function AnimationWorkspace({ projectId, active = true, controlsOpen, onClose, onEditorDirty }: { projectId: string; active?: boolean; controlsOpen: boolean; onClose: () => void; onEditorDirty: (dirty: boolean) => void }) {
  const vi = useStudioLocale() === 'vi'
  const [project, setProject] = useState<UnifiedProject | null>(null)
  const [animationMounted, setAnimationMounted] = useState(false)
  const [motionId, setMotionId] = useState('')
  const [characterId, setCharacterId] = useState('')
  const [frameStart, setFrameStart] = useState('0')
  const [sourceStart, setSourceStart] = useState('0')
  const [sourceLength, setSourceLength] = useState('')
  const [speed, setSpeed] = useState('1')
  const [loop, setLoop] = useState(false)
  const [reverse, setReverse] = useState(false)
  const [rootPolicy, setRootPolicy] = useState<MotionBinding['rootPolicy']>('skeletal')
  const [alignment, setAlignment] = useState<MotionBinding['alignment']>('continue')
  const [editingBinding, setEditingBinding] = useState<MotionBinding | null>(null)
  const [editDirty, setEditDirty] = useState(false)
  const [editRevision, setEditRevision] = useState(0)
  const [frameEnd, setFrameEnd] = useState('')
  const [busy, setBusy] = useState(false)
  const [importingMotion, setImportingMotion] = useState(false)
  const [animationProfileId, setAnimationProfileId] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [libraryQuery, setLibraryQuery] = useState('')
  const [libraryActions, setLibraryActions] = useState<Array<{ uuid: string; name: string; nameVi?: string; rig: string; tags: string[]; own?: boolean }>>([])
  const [librarySelected, setLibrarySelected] = useState<string[]>([])
  const [libraryCreateNew, setLibraryCreateNew] = useState(false)
  const [libraryJob, setLibraryJob] = useState<{ jobId: string; status: string; completed: number; total: number; results: Array<{ assignedUuid?: string; status: string; reason?: string }> } | null>(null)
  const selectedCharacter = project?.characters[characterId]
  const selectedCharacterNode = project?.scene.content.nodes.find((node) => node.id === selectedCharacter?.nodeId)
  const [pickerCharacterId, setPickerCharacterId] = useState('')
  const libraryCharacters = useMemo(() => project ? Object.values(project.characters).flatMap((character) => {
    const id = (project.scene.content.nodes.find((node) => node.id === character.nodeId)?.metadata as Record<string, unknown> | undefined)?.libraryCharacterId
    return typeof id === 'string' && id ? [{ id: character.id, name: character.name, libraryCharacterId: id }] : []
  }) : [], [project])
  const pickerCharacter = libraryCharacters.find((item) => item.id === pickerCharacterId)
  const libraryCharacterId = pickerCharacter?.libraryCharacterId ?? ''

  useEffect(() => { if (active) setAnimationMounted(true) }, [active])

  useEffect(() => {
    let active = true
    setEditingBinding(null)
    setProject(null)
    const refresh = () => { void loadUnifiedProject(projectId).then(({ project: next }) => { if (active) setProject(next) }).catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : String(cause)) }) }
    const onCommit = (event: Event) => { if ((event as CustomEvent<{ projectId?: string }>).detail?.projectId === projectId) refresh() }
    refresh()
    window.addEventListener('bbs-unified-project-commit', onCommit)
    return () => { active = false; window.removeEventListener('bbs-unified-project-commit', onCommit) }
  }, [projectId])

  const motions = useMemo(() => project ? Object.values(project.motions).filter((motion) => {
    const asset = project.assets[motion.assetId]
    return asset && ['model', 'motion'].includes(asset.kind) && (motion.evaluator === 'animation-1.31.8' && !!motion.edit || ['application/vnd.autodesk.fbx', 'model/gltf-binary', 'model/gltf+json'].includes(asset.source.mediaType)) &&
      Object.values(project.characters).some((character) => project.skeletons[character.skeletonId]?.fingerprint === project.skeletons[motion.skeletonId]?.fingerprint)
  }) : [], [project])
  const compatibleCharacters = useMemo(() => {
    const motion = project?.motions[motionId]
    const profile = motion && project?.skeletons[motion.skeletonId]
    return project && profile ? Object.values(project.characters).filter((character) => project.skeletons[character.skeletonId]?.fingerprint === profile.fingerprint && project.skeletons[character.skeletonId]?.metersPerUnit === profile.metersPerUnit) : []
  }, [project, motionId])
  const selectedMotion = project?.motions[motionId]
  const inPoint = Number(sourceStart)
  const sourceDuration = Number(sourceLength.trim() ? sourceLength : (selectedMotion?.durationSeconds ?? 0) - inPoint)
  const speedValue = Number(speed)
  const validPlacement = Number.isSafeInteger(Number(frameStart)) && Number(frameStart) >= 0 && Number.isFinite(inPoint) && inPoint >= 0 &&
    Number.isFinite(sourceDuration) && sourceDuration > 0 && inPoint + sourceDuration <= (selectedMotion?.durationSeconds ?? 0) + 1e-6 &&
    Number.isFinite(speedValue) && speedValue >= 0.01 && speedValue <= 16
    && (!editingBinding || frameEnd.trim() !== '' && Number.isSafeInteger(Number(frameEnd)) && Number(frameEnd) >= Number(frameStart))

  useEffect(() => {
    if (!motions.some((motion) => motion.id === motionId)) setMotionId(motions[0]?.id ?? '')
  }, [motions, motionId])
  useEffect(() => {
    if (!compatibleCharacters.some((character) => character.id === characterId)) setCharacterId(compatibleCharacters[0]?.id ?? '')
  }, [compatibleCharacters, characterId])

  const mixamoProfiles = useMemo(() => project ? Object.values(project.skeletons).filter((profile) => profile.family === 'mixamo65') : [], [project])
  useEffect(() => {
    if (!mixamoProfiles.some((profile) => profile.id === animationProfileId)) setAnimationProfileId(mixamoProfiles[0]?.id ?? '')
  }, [mixamoProfiles, animationProfileId])

  async function importAnimationOnly(file?: File) {
    if (!file || !project || !animationProfileId || importingMotion) return
    if (editDirty && !window.confirm(vi ? 'Bỏ các thay đổi clip chưa áp dụng?' : 'Discard unapplied clip changes?')) return
    const format = /\.glb$/i.test(file.name) ? 'glb' : /\.gltf$/i.test(file.name) ? 'gltf' : ''
    if (!format || file.size > 256 * 1024 * 1024) {
      setError(vi ? 'Chọn một tệp GLB hoặc glTF tự chứa không quá 256 MiB.' : 'Choose one self-contained GLB or glTF file up to 256 MiB.')
      return
    }
    setEditingBinding(null); setEditDirty(false)
    setImportingMotion(true); setError(''); setMessage('')
    try {
      const uploaded = await uploadUnifiedAsset(file)
      const latest = await loadUnifiedProject(projectId)
      const result = await sendUnifiedCommand({ requestId: crypto.randomUUID(), projectId, expectedRevision: latest.project.revision,
        command: 'asset.import', args: { files: [uploaded.uploadId], format, skeletonProfileId: animationProfileId } })
      const refreshed = await loadUnifiedProject(projectId)
      setProject(refreshed.project)
      const importedMotionId = Array.isArray(result.result.motionIds) ? String(result.result.motionIds[0] ?? '') : ''
      if (importedMotionId) setMotionId(importedMotionId)
      setMessage(vi ? `Đã nhập animation vào profile Mixamo65 · revision ${result.revision}.` : `Animation imported for the Mixamo65 profile · revision ${result.revision}.`)
      window.dispatchEvent(new CustomEvent('bbs-unified-project-commit', { detail: { projectId } }))
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setImportingMotion(false) }
  }

  async function placeMotion() {
    const start = Number(frameStart)
    if (!project || !selectedMotion || !motionId || !characterId || busy || !validPlacement) return
    setBusy(true); setError(''); setMessage('')
    try {
      const latest = editingBinding ? null : await loadUnifiedProject(projectId)
      const result = await sendUnifiedCommand({
        requestId: crypto.randomUUID(), projectId, expectedRevision: editingBinding ? editRevision : latest!.project.revision,
        command: editingBinding ? 'motion.binding.set' : 'motion.place',
        args: editingBinding ? {
          binding: { ...editingBinding, motionId, characterId, sourceStartSeconds: inPoint, sourceLengthSeconds: sourceDuration, reverse, rootPolicy, alignment },
          clipPatch: { frameStart: start, frameEnd: Number(frameEnd), playback: { speed: speedValue, loop } },
        } : { motionId, characterId, frameStart: start, sourceStartSeconds: inPoint, sourceLengthSeconds: sourceDuration, speed: speedValue, loop, reverse },
      })
      const refreshed = await loadUnifiedProject(projectId)
      setProject(refreshed.project)
      setMessage(editingBinding ? (vi ? `Đã cập nhật clip · revision ${result.revision}.` : `Updated clip · revision ${result.revision}.`) : (vi ? `Đã thêm clip vào frame ${start} · revision ${result.revision}.` : `Placed clip at frame ${start} · revision ${result.revision}.`))
      setEditingBinding(null)
      setEditDirty(false)
      window.dispatchEvent(new CustomEvent('bbs-unified-project-commit', { detail: { projectId } }))
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusy(false) }
  }

  async function openLibraryPicker(targetId?: string) {
    const target = libraryCharacters.find((item) => item.id === (targetId ?? (libraryCharacters.some((item) => item.id === characterId) ? characterId : libraryCharacters[0]?.id)))
    if (!target) return
    setPickerCharacterId(target.id)
    try {
      const q = libraryQuery ? `&q=${encodeURIComponent(libraryQuery)}` : ''
      const [shared, own] = await Promise.all([fetch(`/api/library?raw=1${q}`, { cache: 'no-store' }), fetch(`/api/library?charId=${encodeURIComponent(target.libraryCharacterId)}`, { cache: 'no-store' })])
      const body = await shared.json() as { actions?: typeof libraryActions; error?: string }
      if (!shared.ok) throw new Error(body.error ?? `Library lookup failed (${shared.status})`)
      const ownBody = own.ok ? await own.json() as { actions?: typeof libraryActions } : {}
      const needle = libraryQuery.trim().toLowerCase()
      const owned = (ownBody.actions ?? []).filter((action) => !needle || `${action.name} ${action.nameVi ?? ''}`.toLowerCase().includes(needle)).map((action) => ({ ...action, tags: action.tags ?? [], own: true }))
      const seen = new Set(owned.map((action) => action.uuid))
      setLibraryActions([...owned, ...(body.actions ?? [])].filter((action, index, all) => all.findIndex((other) => other.uuid === action.uuid) === index && (index < owned.length || !seen.has(action.uuid)))); setLibrarySelected([]); setLibraryOpen(true)
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
  }

  async function assignLibraryActions() {
    if (!libraryCharacterId || !librarySelected.length || !pickerCharacterId) return
    setBusy(true); setError(''); setMessage('')
    try {
      const ownUuids = librarySelected.filter((uuid) => libraryActions.some((action) => action.own && action.uuid === uuid)), sharedUuids = librarySelected.filter((uuid) => !ownUuids.includes(uuid))
      const ownResults = ownUuids.map((uuid) => ({ assignedUuid: uuid, status: 'ok' }))
      let job: NonNullable<typeof libraryJob> = { jobId: '', status: 'completed', completed: 0, total: 0, results: [] }
      if (sharedUuids.length) {
        const response = await fetch('/api/library/assign', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ actionUuids: sharedUuids, charId: libraryCharacterId, createNew: libraryCreateNew }) })
        const body = await response.json() as { job?: typeof job; error?: string }
        if (!response.ok || !body.job) throw new Error(body.error ?? `Assignment failed (${response.status})`)
        job = body.job
        setLibraryJob(job)
      }
      while (job.status === 'queued' || job.status === 'running') {
        await new Promise(resolve => window.setTimeout(resolve, 500))
        const poll = await fetch(`/api/library/assign?jobId=${encodeURIComponent(job.jobId)}`, { cache: 'no-store' })
        const next = await poll.json() as { job?: typeof job; error?: string }
        if (!poll.ok || !next.job) throw new Error(next.error ?? `Assignment status failed (${poll.status})`)
        job = next.job; setLibraryJob(job)
      }
      job = { ...job, total: job.total + ownResults.length, results: [...ownResults, ...job.results] }
      const placed: string[] = []
      let revision = (await loadUnifiedProject(projectId)).project.revision
      for (const result of job.results) if (result.assignedUuid && ['ok', 'already-exists'].includes(result.status)) {
        const latest = await loadUnifiedProject(projectId); revision = latest.project.revision
        await sendUnifiedCommand({ requestId: crypto.randomUUID(), projectId, expectedRevision: revision, command: 'library.place', args: { actionUuid: result.assignedUuid, characterId: pickerCharacterId } })
        placed.push(result.assignedUuid)
      }
      const refreshed = await loadUnifiedProject(projectId); setProject(refreshed.project)
      setMessage(vi ? `Đã gán ${placed.length}/${job.total} động tác vào nhân vật và đặt lên timeline.` : `Assigned ${placed.length}/${job.total} Actions and placed them on the timeline.`)
      setLibraryOpen(false)
      const failures = job.results.filter(result => result.status === 'error')
      if (failures.length) setError(failures.map(result => result.reason).filter(Boolean).join('; '))
      window.dispatchEvent(new CustomEvent('bbs-unified-project-commit', { detail: { projectId } }))
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusy(false) }
  }

  async function cancelLibraryAssignment() {
    if (!libraryJob?.jobId) return
    try {
      const response = await fetch(`/api/library/assign?jobId=${encodeURIComponent(libraryJob.jobId)}`, { method: 'DELETE' })
      const body = await response.json() as { job?: typeof libraryJob; error?: string }
      if (!response.ok || !body.job) throw new Error(body.error ?? `Cancellation failed (${response.status})`)
      setLibraryJob(body.job)
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
  }

  const clips = project?.scene.content.timeline.animation.motionClips ?? []
  function editClip(clipId: string) {
    const binding = project?.bindings[clipId]
    const clip = clips.find((item) => item.id === clipId)
    if (!project || !binding || !clip) return
    if (editDirty && !window.confirm(vi ? 'Bỏ các thay đổi clip chưa áp dụng?' : 'Discard unapplied clip changes?')) return
    setEditingBinding({ ...binding }); setEditRevision(project.revision)
    setEditDirty(false)
    setMotionId(binding.motionId); setCharacterId(binding.characterId)
    setFrameStart(String(clip.frameStart)); setFrameEnd(String(clip.frameEnd))
    setSourceStart(String(binding.sourceStartSeconds)); setSourceLength(String(binding.sourceLengthSeconds))
    setSpeed(String(clip.playback.speed)); setLoop(clip.playback.loop); setReverse(binding.reverse)
    setRootPolicy(binding.rootPolicy)
    setAlignment(binding.alignment)
    setError(''); setMessage('')
  }
  function closeControls() { onClose() }
  return <div className="wb-animation-layout" hidden={!active}>
    <div className="wb-animation-editor" role="region" aria-label={vi ? 'Trình tạo animation' : 'Animation Creation'}>{project && animationMounted && <AnimationCreationPanel projectId={projectId} project={project} active={active} onProject={setProject} onEditorDirty={onEditorDirty} />}</div>
    <HostDrawer open={controlsOpen} title={vi ? 'Animation' : 'Animation'} closeLabel={vi ? 'Đóng bảng' : 'Close panel'} className="wb-drawer-animation" onClose={closeControls}>
    <section className="wb-animation-panel" aria-labelledby="wb-animation-title">
    <div className="wb-retarget-session-heading"><div><h1 id="wb-animation-title">{vi ? 'Thêm animation' : 'Add animation'}</h1><p>{vi ? 'Chọn animation và nhân vật cùng bộ xương.' : 'Choose an animation and a character with the same skeleton.'}</p></div><span>{clips.length} {vi ? 'clip' : 'clips'}</span></div>
    <div className="wb-retarget-session-grid">
      <label>{vi ? 'Nhập animation-only GLB cho' : 'Import animation-only GLB for'}<select aria-label={vi ? 'Profile Mixamo65 đích' : 'Target Mixamo65 profile'} value={animationProfileId} onChange={(event) => setAnimationProfileId(event.target.value)} disabled={!mixamoProfiles.length}>
        {mixamoProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.family} · {profile.bones.length} bones · {profile.id.slice(0, 8)}</option>)}
      </select></label>
      <label>{vi ? 'Tệp animation GLB/glTF tự chứa' : 'Self-contained animation GLB/glTF'}<input type="file" accept=".glb,.gltf,model/gltf-binary,model/gltf+json" disabled={!animationProfileId || importingMotion} onChange={(event) => { void importAnimationOnly(event.target.files?.[0]); event.target.value = '' }} /></label>
      <label>{vi ? 'Animation' : 'Animation'}<select value={motionId} onChange={(event) => { if (editDirty && !window.confirm(vi ? 'Bỏ các thay đổi clip chưa áp dụng?' : 'Discard unapplied clip changes?')) return; setEditDirty(false); setEditingBinding(null); setMotionId(event.target.value) }} disabled={!motions.length}>
        {motions.map((motion) => { const metadata = project?.extensions.retargetMotionMetadata?.[motion.id] as { name?: string; clipIndex?: number } | undefined; const sourceName = project?.assets[motion.assetId]?.displayName ?? (vi ? 'Tệp FBX' : 'FBX file'); return <option key={motion.id} value={motion.id}>{metadata?.name ?? sourceName} · {vi ? 'Clip' : 'Clip'} {(metadata?.clipIndex ?? 0) + 1}</option> })}
      </select></label>
      <label>{vi ? 'Nhân vật tương thích' : 'Compatible character'}<select value={characterId} onChange={(event) => { setCharacterId(event.target.value); setEditDirty(true) }} disabled={!compatibleCharacters.length}>
        {compatibleCharacters.map((character) => <option key={character.id} value={character.id}>{character.name}</option>)}
      </select></label>
      {!!libraryCharacters.length && <button type="button" onClick={() => void openLibraryPicker()} disabled={busy}>{vi ? 'Lấy từ kho…' : 'Get from library…'}</button>}
      <label>{vi ? 'Frame bắt đầu' : 'Start frame'}<input type="number" min="0" step="1" value={frameStart} onChange={(event) => { setFrameStart(event.target.value); setEditDirty(true) }} /></label>
      {editingBinding && <label>{vi ? 'Frame kết thúc (bao gồm)' : 'End frame (inclusive)'}<input type="number" min={Number(frameStart)} step="1" value={frameEnd} onChange={(event) => { setFrameEnd(event.target.value); setEditDirty(true) }} /></label>}
      <details className="wb-animation-advanced"><summary>{vi ? 'Điều chỉnh clip' : 'Clip settings'}</summary><div className="wb-animation-advanced-fields">
      <label>{vi ? 'Bắt đầu nguồn (giây)' : 'Source in (seconds)'}<input type="number" min="0" max={selectedMotion?.durationSeconds} step="0.01" value={sourceStart} onChange={(event) => { setSourceStart(event.target.value); setEditDirty(true) }} /></label>
      <label>{vi ? 'Độ dài nguồn (giây, trống = hết clip)' : 'Source length (seconds, blank = full range)'}<input type="number" min="0.001" max={selectedMotion?.durationSeconds} step="0.01" value={sourceLength} onChange={(event) => { setSourceLength(event.target.value); setEditDirty(true) }} /></label>
      <label>{vi ? 'Tốc độ' : 'Speed'}<input type="number" min="0.01" max="16" step="0.1" value={speed} onChange={(event) => { setSpeed(event.target.value); setEditDirty(true) }} /></label>
      {editingBinding && <label>{vi ? 'Chuyển động root' : 'Root motion'}<select aria-label={vi ? 'Chuyển động root' : 'Root motion'} value={rootPolicy} onChange={(event) => { setRootPolicy(event.target.value as MotionBinding['rootPolicy']); setEditDirty(true) }}>
        <option value="skeletal">{vi ? 'Giữ trong skeleton' : 'Keep in skeleton'}</option>
        <option value="in-place">{vi ? 'Tại chỗ' : 'In place'}</option>
        <option value="trajectory">{vi ? 'Chuyển root sang actor' : 'Move root to actor'}</option>
      </select></label>}
      {editingBinding && rootPolicy === 'trajectory' && <label>{vi ? 'Nối chuyển động' : 'Motion alignment'}<select aria-label={vi ? 'Nối chuyển động' : 'Motion alignment'} value={alignment} onChange={(event) => { setAlignment(event.target.value as MotionBinding['alignment']); setEditDirty(true) }}>
        <option value="continue">{vi ? 'Nối endpoint clip trước' : 'Continue previous endpoint'}</option>
        <option value="origin">{vi ? 'Anchor riêng của clip' : 'Clip origin'}</option>
      </select></label>}
      <label className="wb-motion-loop"><input type="checkbox" checked={loop} onChange={(event) => { setLoop(event.target.checked); setEditDirty(true) }} />{vi ? 'Lặp clip' : 'Loop clip'}</label>
      <label className="wb-motion-loop"><input type="checkbox" checked={reverse} onChange={(event) => { setReverse(event.target.checked); setEditDirty(true) }} />{vi ? 'Phát ngược' : 'Reverse'}</label>
      </div></details>
      <div className="wb-retarget-session-actions"><button type="button" className="wb-retarget-load" onClick={() => void placeMotion()} disabled={busy || !motionId || !characterId || !validPlacement}>{busy ? (vi ? 'Đang xử lý…' : 'Working…') : editingBinding ? (vi ? 'Áp dụng sửa clip' : 'Apply clip changes') : (vi ? 'Đặt vào timeline' : 'Place on timeline')}</button>
        {editingBinding && <button type="button" disabled={busy} onClick={() => { setEditingBinding(null); setEditDirty(false) }}>{vi ? 'Hủy sửa' : 'Cancel edit'}</button>}
      </div>
    </div>
    {!motions.length && <p className="wb-retarget-preview-note">{vi ? 'Chưa có animation dùng được. Nhập animation-only GLB cho profile Mixamo65 hoặc nhập FBX tương thích.' : 'No compatible animation yet. Import an animation-only GLB for a Mixamo65 profile or import a compatible FBX.'}</p>}
    {error && <p className="wb-retarget-error" role="alert">{error}</p>}{message && <p className="wb-retarget-saved" role="status">{message}</p>}
    {libraryJob && <p role="status">{libraryJob.status} · {libraryJob.completed}/{libraryJob.total}</p>}
    {!!clips.length && <ol aria-label={vi ? 'Clip trên timeline' : 'Timeline clips'}>{clips.map((clip) => <li key={clip.id}>{clip.motion.name} · {Object.values(project?.characters ?? {}).find((item) => item.nodeId === clip.target.nodeId)?.name ?? (vi ? 'Nhân vật' : 'Character')} · {clip.frameStart}–{clip.frameEnd} {project?.bindings[clip.id] && <button type="button" disabled={busy} onClick={() => editClip(clip.id)} aria-label={`${vi ? 'Sửa' : 'Edit'} ${clip.motion.name}`}>{vi ? 'Sửa clip' : 'Edit clip'}</button>}</li>)}</ol>}
    </section>
    {libraryOpen && <div role="dialog" aria-modal="true" aria-label={vi ? 'Lấy động tác từ kho' : 'Get Actions from library'} style={{ position: 'fixed', inset: 0, zIndex: 1000, background: '#0009', display: 'grid', placeItems: 'center' }}>
      <section style={{ width: 'min(720px,92vw)', maxHeight: '80vh', overflow: 'auto', padding: 20, color: '#eee', background: '#20242c' }}>
        <h2>{vi ? 'Lấy từ kho dùng chung' : 'Get from shared library'}</h2>
        <label>{vi ? 'Nhân vật nhận' : 'Target character'} <select aria-label={vi ? 'Nhân vật nhận động tác' : 'Target character for Actions'} value={pickerCharacterId} disabled={busy} onChange={event => void openLibraryPicker(event.target.value)}>{libraryCharacters.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <input aria-label={vi ? 'Tìm động tác' : 'Search Actions'} value={libraryQuery} onChange={event => setLibraryQuery(event.target.value)} placeholder={vi ? 'Tìm tên Anh/Việt' : 'Search English/Vietnamese names'} />
        <button type="button" onClick={() => void openLibraryPicker(pickerCharacterId)}>{vi ? 'Tìm' : 'Search'}</button>
        <div style={{ maxHeight: '50vh', overflow: 'auto' }}>{libraryActions.map(action => <label key={action.uuid} style={{ display: 'block', padding: 5 }}><input type="checkbox" checked={librarySelected.includes(action.uuid)} onChange={event => setLibrarySelected(current => event.target.checked ? [...current, action.uuid] : current.filter(id => id !== action.uuid))} /> {action.own && <b>{vi ? '[của nhân vật] ' : '[character] '}</b>}{action.name}{action.nameVi ? ` | ${action.nameVi}` : ''} · {action.rig} · {action.tags.join(', ')}</label>)}{!libraryActions.length && <p>{vi ? 'Kho chưa có động tác phù hợp.' : 'No shared Actions found.'}</p>}</div>
        <label><input type="checkbox" checked={libraryCreateNew} onChange={event => setLibraryCreateNew(event.target.checked)} /> {vi ? 'Tạo bản mới dù đã có' : 'Create a new copy if already assigned'}</label>
        <p><button type="button" disabled={busy || !librarySelected.length} onClick={() => void assignLibraryActions()}>{busy ? `${libraryJob?.completed ?? 0}/${libraryJob?.total ?? librarySelected.length}` : vi ? `Gán ${librarySelected.length} động tác` : `Assign ${librarySelected.length} Actions`}</button> {busy && libraryJob && <button type="button" onClick={() => void cancelLibraryAssignment()}>{vi ? 'Hủy job' : 'Cancel job'}</button>} <button type="button" disabled={busy} onClick={() => setLibraryOpen(false)}>{vi ? 'Đóng' : 'Close'}</button></p>
      </section>
    </div>}
    </HostDrawer>
  </div>
}
