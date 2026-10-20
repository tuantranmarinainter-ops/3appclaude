'use client'

import { useEffect, useMemo, useState } from 'react'
import { buildSkeletonMappingSuggestions, createRetargetCalibration, defaultReverseRetargetSettings, isRetargetCalibrationV1, RETARGET_SEMANTIC_ROLES, validateSemanticMapping } from '@bbs/retarget'
import type { SemanticBonePair } from '@bbs/retarget'
import type { ReverseRetargetSettings } from '@bbs/retarget'
import type { ActiveRetargetMapping } from './RetargetPreview'
import { loadUnifiedProject, sendUnifiedCommand } from '../../../src/unifiedApi'
import { useStudioLocale } from '../../../src/devtools/localePreference'

type ProjectState = Awaited<ReturnType<typeof loadUnifiedProject>>['project']
type Assignment = { sourceBoneId: string; targetBoneId: string }

export function SkeletonMappingEditor({ projectId, calibrationSettings, onCalibrationLoad, onActiveMappingChange }: { projectId: string; calibrationSettings: ReverseRetargetSettings; onCalibrationLoad: (settings: ReverseRetargetSettings) => void; onActiveMappingChange: (mapping: ActiveRetargetMapping | null) => void }) {
  const vi = useStudioLocale() === 'vi'
  const [project, setProject] = useState<ProjectState | null>(null)
  const [sourceMotionId, setSourceMotionId] = useState('')
  const [targetProfileId, setTargetProfileId] = useState('')
  const [selectedMappingId, setSelectedMappingId] = useState('')
  const [assignments, setAssignments] = useState<Record<string, Assignment>>({})
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let active = true
    const refresh = () => { void loadUnifiedProject(projectId).then(({ project: next }) => { if (active) { setProject(next); setError('') } }).catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : String(cause)) }) }
    const onCommit = (event: Event) => { if ((event as CustomEvent<{ projectId?: string }>).detail?.projectId === projectId) refresh() }
    refresh()
    window.addEventListener('bbs-unified-project-commit', onCommit)
    return () => { active = false; window.removeEventListener('bbs-unified-project-commit', onCommit) }
  }, [projectId])

  const motions = useMemo(() => project ? Object.values(project.motions) : [], [project])
  const profiles = useMemo(() => project ? Object.values(project.skeletons) : [], [project])
  const sourceMotion = project?.motions[sourceMotionId]
  const source = sourceMotion ? project?.skeletons[sourceMotion.skeletonId] : undefined
  const target = project?.skeletons[targetProfileId]
  const suggestions = useMemo(() => source && target ? buildSkeletonMappingSuggestions(source, target) : [], [source, target])
  const selectedMapping = project?.mappings[selectedMappingId]
  useEffect(() => {
    if (!project) return
    if (!motions.some((motion) => motion.id === sourceMotionId)) setSourceMotionId(motions[0]?.id ?? '')
    const nextSourceId = project.motions[sourceMotionId]?.skeletonId ?? motions[0]?.skeletonId
    if (!profiles.some((profile) => profile.id === targetProfileId && profile.id !== nextSourceId)) {
      setTargetProfileId(profiles.find((profile) => profile.id !== nextSourceId)?.id ?? '')
    }
  }, [project, motions, profiles, sourceMotionId, targetProfileId])

  useEffect(() => {
    if (selectedMapping) {
      onActiveMappingChange(null)
      onCalibrationLoad({ ...defaultReverseRetargetSettings })
      const matchingMotion = motions.find((motion) => motion.skeletonId === selectedMapping.sourceProfileId)
      if (matchingMotion) setSourceMotionId(matchingMotion.id)
      setTargetProfileId(selectedMapping.targetProfileId)
      if (source?.id === selectedMapping.sourceProfileId && target?.id === selectedMapping.targetProfileId) {
        setAssignments(Object.fromEntries(RETARGET_SEMANTIC_ROLES.map(({ id }) => {
          const pair = selectedMapping.pairs.find((item) => item.role === id && item.enabled)
          return [id, { sourceBoneId: pair?.sourceBoneId ?? '', targetBoneId: pair?.targetBoneId ?? '' }]
        })))
      }
      const controller = new AbortController()
      setSaving(true)
      setError('')
      void fetch(`/api/unified/projects/${encodeURIComponent(projectId)}/mappings/${encodeURIComponent(selectedMapping.id)}/calibration`, { signal: controller.signal })
        .then(async (response) => {
          if (!response.ok) throw new Error(`Calibration HTTP ${response.status}`)
          const value: unknown = await response.json()
          if (!isRetargetCalibrationV1(value, selectedMapping.sourceFingerprint, selectedMapping.targetFingerprint)) throw new Error('Saved calibration does not match the selected mapping fingerprints')
          onCalibrationLoad(value.settings)
          const sourceProfile = project?.skeletons[selectedMapping.sourceProfileId]
          const targetProfile = project?.skeletons[selectedMapping.targetProfileId]
          if (project && sourceProfile && targetProfile) {
            const sourceHashes = [...new Set(Object.values(project.motions).filter((motion) => motion.skeletonId === sourceProfile.id)
              .map((motion) => project.assets[motion.assetId]?.source.sha256).filter((hash): hash is string => !!hash))]
            const sourceBonesByRole = Object.fromEntries(selectedMapping.pairs.filter((pair) => pair.enabled).flatMap((pair) => {
              const bone = sourceProfile.bones.find((item) => item.id === pair.sourceBoneId)
              return bone ? [[pair.role, bone.name]] : []
            }))
            const expectedTargets = buildSkeletonMappingSuggestions(sourceProfile, targetProfile)
            const targetCompatible = targetProfile.family === 'minecraft20' && selectedMapping.pairs.filter((pair) => pair.enabled)
              .every((pair) => expectedTargets.find((suggestion) => suggestion.role === pair.role)?.targetBoneId === pair.targetBoneId)
            onActiveMappingChange({ id: selectedMapping.id, sourceHashes, sourceMetersPerUnit: sourceProfile.metersPerUnit, sourceBonesByRole, targetFamily: targetProfile.family, confirmed: selectedMapping.confirmed, targetCompatible })
          }
        })
        .catch((cause: unknown) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause)) })
        .finally(() => { if (!controller.signal.aborted) setSaving(false) })
      return () => controller.abort()
    }
    if (!source || !target) { setAssignments({}); return }
    onActiveMappingChange(null)
    onCalibrationLoad({ ...defaultReverseRetargetSettings })
    setAssignments(Object.fromEntries(suggestions.map((suggestion) => [suggestion.role, {
      sourceBoneId: suggestion.sourceBoneId ?? '', targetBoneId: suggestion.targetBoneId ?? '',
    }])))
  }, [projectId, selectedMapping, source, target, suggestions, motions, project, onCalibrationLoad, onActiveMappingChange])

  const pairs = useMemo<SemanticBonePair[]>(() => RETARGET_SEMANTIC_ROLES.flatMap(({ id }) => {
    const selected = assignments[id]
    return selected?.sourceBoneId && selected.targetBoneId
      ? [{ role: id, sourceBoneId: selected.sourceBoneId, targetBoneId: selected.targetBoneId, enabled: true }]
      : []
  }), [assignments])
  const partialAssignmentRoles = RETARGET_SEMANTIC_ROLES.filter(({ id }) => {
    const selected = assignments[id]
    return !!selected && (!!selected.sourceBoneId !== !!selected.targetBoneId)
  })
  const report = source && target ? validateSemanticMapping(source, target, pairs) : null

  function change(role: string, side: keyof Assignment, value: string) {
    setAssignments((current) => {
      const previous = current[role] ?? { sourceBoneId: '', targetBoneId: '' }
      return { ...current, [role]: side === 'sourceBoneId' ? { ...previous, sourceBoneId: value } : { ...previous, targetBoneId: value } }
    })
    setMessage('')
  }

  async function save() {
    if (!project || !source || !target || !report || saving) return
    if (partialAssignmentRoles.length) { setError(vi ? 'Mỗi role cần chọn cả xương nguồn và xương đích hoặc để trống cả hai.' : 'Each role needs both a source and target bone, or leave both blank.'); return }
    if (report.errors.length) { setError(vi ? 'Mapping có role hoặc xương bị trùng/không hợp lệ.' : 'Mapping has duplicate or invalid role/bone assignments.'); return }
    const updatingMapping = !!selectedMappingId && !!project.mappings[selectedMappingId]
    setSaving(true); setError(''); setMessage('')
    const usedSource = new Set(pairs.map((pair) => pair.sourceBoneId))
    const usedTarget = new Set(pairs.map((pair) => pair.targetBoneId))
    const mapping = {
      id: selectedMappingId && project.mappings[selectedMappingId] ? selectedMappingId : crypto.randomUUID(), sourceProfileId: source.id, targetProfileId: target.id,
      sourceFingerprint: source.fingerprint, targetFingerprint: target.fingerprint, pairs,
      ignored: [
        ...source.bones.filter((bone) => !usedSource.has(bone.id)).map((bone) => ({ side: 'source' as const, boneId: bone.id, reason: 'No semantic role assigned; preserved as extra source bone.' })),
        ...target.bones.filter((bone) => !usedTarget.has(bone.id)).map((bone) => ({ side: 'target' as const, boneId: bone.id, reason: 'No semantic role assigned; preserved as extra target bone.' })),
      ],
    }
    try {
      const result = await sendUnifiedCommand({
        requestId: crypto.randomUUID(), projectId, expectedRevision: project.revision, command: 'skeleton.mapping.set',
        args: { mapping, calibration: createRetargetCalibration(source.fingerprint, target.fingerprint, calibrationSettings) },
      })
      const saved = result.result.validationReport as { missingRequiredRoles?: string[]; confirmed?: boolean } | undefined
      setSelectedMappingId(mapping.id)
      setMessage(saved?.confirmed
        ? (vi ? `Đã ${updatingMapping ? 'cập nhật' : 'lưu'} mapping đã xác nhận · revision ${result.revision}.` : `Confirmed mapping ${updatingMapping ? 'updated' : 'saved'} · revision ${result.revision}.`)
        : (vi ? `Đã ${updatingMapping ? 'cập nhật' : 'lưu'} mapping nháp · còn thiếu ${saved?.missingRequiredRoles?.length ?? report.missingRequiredRoles.length} role bắt buộc; chưa thể bake.` : `Mapping draft ${updatingMapping ? 'updated' : 'saved'} · ${saved?.missingRequiredRoles?.length ?? report.missingRequiredRoles.length} required roles remain; baking is blocked.`))
      window.dispatchEvent(new CustomEvent('bbs-unified-project-commit', { detail: { projectId } }))
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setSaving(false) }
  }

  return <details className="wb-retarget-mapping">
    <summary id="wb-mapping-title">{vi ? 'Mapping skeleton theo semantic role' : 'Semantic skeleton mapping'}</summary>
    {!project ? error ? <p className="wb-retarget-error" role="alert">{error}</p> : <p role="status">{vi ? 'Đang tải profile…' : 'Loading profiles…'}</p> : !motions.length || profiles.length < 2 ?
      <p>{vi ? 'Cần lưu một Motion nguồn và nhập profile xương đích trước khi tạo mapping.' : 'Save a source Motion and import a target skeleton profile before mapping.'}</p> : <>
        <div className="wb-retarget-mapping-selects">
          <label>{vi ? 'Mapping đã lưu' : 'Saved mapping'}<select value={selectedMappingId} onChange={(event) => setSelectedMappingId(event.target.value)}>
            <option value="">{vi ? 'Mapping mới' : 'New mapping'}</option>
            {Object.values(project.mappings).map((mapping) => <option key={mapping.id} value={mapping.id}>{project.skeletons[mapping.sourceProfileId]?.family} → {project.skeletons[mapping.targetProfileId]?.family} · {mapping.id.slice(0, 8)}</option>)}
          </select></label>
          <label>{vi ? 'Motion nguồn' : 'Source motion'}<select value={sourceMotionId} onChange={(event) => setSourceMotionId(event.target.value)}>
            {motions.map((motion) => <option key={motion.id} value={motion.id}>{(project.extensions.retargetMotionMetadata?.[motion.id] as { name?: string } | undefined)?.name ?? motion.id} · {project.skeletons[motion.skeletonId]?.family}</option>)}
          </select></label>
          <label>{vi ? 'Profile đích' : 'Target profile'}<select value={targetProfileId} onChange={(event) => setTargetProfileId(event.target.value)}>
            {profiles.filter((profile) => profile.id !== source?.id).map((profile) => <option key={profile.id} value={profile.id}>{profile.family} · {profile.bones.length} {vi ? 'xương' : 'bones'}</option>)}
          </select></label>
        </div>
        {source && target && <>
          <div className="wb-retarget-mapping-rows" role="group" aria-label={vi ? 'Gán xương theo role' : 'Assign bones by role'}>
            {RETARGET_SEMANTIC_ROLES.map((role) => {
              const suggestion = suggestions.find((item) => item.role === role.id)
              return <div className="wb-retarget-mapping-row" key={role.id}>
              <span>{role.label}{(suggestion?.ambiguousSource || suggestion?.ambiguousTarget) && <small className="wb-retarget-mapping-warning">{vi ? 'Tên trùng, chọn tay' : 'Ambiguous name; choose manually'}</small>}</span>
              <select aria-label={`${role.label} · ${vi ? 'nguồn' : 'source'}`} value={assignments[role.id]?.sourceBoneId ?? ''} onChange={(event) => change(role.id, 'sourceBoneId', event.target.value)}>
                <option value="">— {vi ? 'chọn source' : 'select source'} —</option>
                {source.bones.map((bone) => <option key={bone.id} value={bone.id}>{bone.name}</option>)}
              </select>
              <select aria-label={`${role.label} · ${vi ? 'đích' : 'target'}`} value={assignments[role.id]?.targetBoneId ?? ''} onChange={(event) => change(role.id, 'targetBoneId', event.target.value)}>
                <option value="">— {vi ? 'chọn target' : 'select target'} —</option>
                {target.bones.map((bone) => <option key={bone.id} value={bone.id}>{bone.name}</option>)}
              </select>
            </div>})}
          </div>
          {report?.errors.length ? <p className="wb-retarget-error" role="alert">{report.errors.map((item) => item.code).join(', ')}</p> : null}
          {partialAssignmentRoles.length ? <p className="wb-retarget-mapping-warning" role="alert">{vi ? `Chưa đủ hai phía cho: ${partialAssignmentRoles.map((role) => role.label).join(', ')}` : `Choose both sides or clear: ${partialAssignmentRoles.map((role) => role.label).join(', ')}`}</p> : null}
          {report?.missingRequiredRoles.length ? <p className="wb-retarget-mapping-warning" role="status">
            {vi ? `Thiếu ${report.missingRequiredRoles.length} role thiết yếu: ` : `${report.missingRequiredRoles.length} required roles missing: `}{report.missingRequiredRoles.join(', ')}
          </p> : <p className="wb-retarget-mapping-ready" role="status">{vi ? 'Đã gán đủ role bắt buộc.' : 'All required roles are assigned.'}</p>}
          <p className="wb-retarget-preview-note">{vi ? `Xương dư được giữ nguyên: ${report?.unmappedSourceBoneIds.length ?? 0} nguồn, ${report?.unmappedTargetBoneIds.length ?? 0} đích; lý do lưu: “không có semantic role được gán”.` : `Unmapped bones are preserved: ${report?.unmappedSourceBoneIds.length ?? 0} source, ${report?.unmappedTargetBoneIds.length ?? 0} target; saved reason: “no semantic role assigned”.`}</p>
          <p className="wb-retarget-preview-note">{vi ? 'Gợi ý chỉ dùng tên khớp chính xác; xương dư được giữ với lý do. Calibration lấy thông số V9.12 đang chỉnh ở preview; session, reference pose và bake chưa nối.' : 'Suggestions use exact name aliases; extra bones are preserved with a reason. Calibration uses the current V9.12 preview settings; session, reference pose, and bake are not connected.'}</p>
          <button type="button" className="wb-retarget-load" onClick={() => void save()} disabled={saving || !!report?.errors.length || partialAssignmentRoles.length > 0}>
            {saving ? (vi ? 'Đang tải/lưu…' : 'Loading/saving…') : selectedMappingId ? (vi ? 'Cập nhật mapping trong project' : 'Update mapping in project') : (vi ? 'Lưu mapping vào project' : 'Save mapping to project')}
          </button>
          {error && <p className="wb-retarget-error" role="alert">{error}</p>}
          {message && <p className="wb-retarget-saved" role="status">{message}</p>}
        </>}
        <div className="wb-retarget-mapping-saved"><strong>{vi ? 'Mapping đã lưu' : 'Saved mappings'}</strong>
          {Object.values(project.mappings).length ? Object.values(project.mappings).map((mapping) => <span key={mapping.id}>{project.skeletons[mapping.sourceProfileId]?.family} → {project.skeletons[mapping.targetProfileId]?.family} · {mapping.confirmed ? (vi ? 'đã xác nhận' : 'confirmed') : (vi ? 'bản nháp' : 'draft')}</span>) : <small>{vi ? 'Chưa có.' : 'None yet.'}</small>}
        </div>
      </>}
  </details>
}
