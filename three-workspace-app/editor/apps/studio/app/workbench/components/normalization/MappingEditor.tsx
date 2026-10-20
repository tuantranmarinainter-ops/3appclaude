'use client'

import { useMemo, useState } from 'react'
import type { SkeletonMapping, SkeletonProfile } from '@bbs/animation-workspace-shared'
import { applyMixamo65MappingPreset, createMixamo65MappingPreset, createRetargetCalibration, isMixamo65Topology, isRetargetCalibrationV1, MIXAMO65_BONE_PARENTS } from '@bbs/retarget'
import { loadUnifiedProject, sendUnifiedCommand } from '../../../../src/unifiedApi'

function canonical(name: string) { return name.split(':').pop()!.replace(/^mixamorig\d*/i, '').replace(/[^a-z0-9]/gi, '').toLowerCase() }
function isDescendant(parentById: ReadonlyMap<string, string | null>, id: string, ancestorId: string) {
  let parent = parentById.get(id) ?? null
  while (parent) { if (parent === ancestorId) return true; parent = parentById.get(parent) ?? null }
  return false
}
function boneDepth(parentById: ReadonlyMap<string, string | null>, id: string) {
  let depth = 0, parent = parentById.get(id) ?? null
  while (parent) { depth += 1; parent = parentById.get(parent) ?? null }
  return depth
}

export function CanonicalMappingEditor({ projectId, source, target, vi, onSaved, mapping, revision }: {
  projectId: string; source: SkeletonProfile; target: SkeletonProfile; vi: boolean; onSaved: (id: string) => void; mapping?: SkeletonMapping; revision: number
}) {
  const suggestions = useMemo(() => Object.fromEntries(MIXAMO65_BONE_PARENTS.map(([name]) => {
    const matches = source.bones.filter((bone) => canonical(bone.name) === canonical(name))
    return [name, matches.length === 1 ? matches[0]!.id : '']
  })), [source])
  const parentById = useMemo(() => new Map(source.bones.map((bone) => [bone.id, bone.parentId])), [source])
  const [assignments, setAssignments] = useState<Record<string, string>>(() => mapping ? Object.fromEntries(MIXAMO65_BONE_PARENTS.map(([name]) => [name, mapping.pairs.find((pair) => pair.role === `mixamo65:${name}` && pair.enabled)?.sourceBoneId ?? ''])) : suggestions)
  const [chainSources, setChainSources] = useState<Record<string, string[]>>(() => mapping ? Object.fromEntries(MIXAMO65_BONE_PARENTS.map(([name]) => [name, mapping.pairs.find((pair) => pair.role === `mixamo65:${name}` && pair.enabled)?.sourceBoneIds?.slice(1) ?? []])) : {})
  const [chainWeights, setChainWeights] = useState<Record<string, number[]>>(() => mapping ? Object.fromEntries(MIXAMO65_BONE_PARENTS.map(([name]) => {
    const pair = mapping.pairs.find((item) => item.role === `mixamo65:${name}` && item.enabled)
    return [name, pair?.sourceBoneWeights ?? pair?.sourceBoneIds?.map(() => 1) ?? []]
  })) : {})
  const [chainCompositions, setChainCompositions] = useState<Record<string, 'world-average' | 'local-compose'>>(() => mapping ? Object.fromEntries(MIXAMO65_BONE_PARENTS.map(([name]) => [name, mapping.pairs.find((pair) => pair.role === `mixamo65:${name}`)?.chainComposition ?? 'world-average'])) : {})
  const [unreviewedChainModes, setUnreviewedChainModes] = useState<Record<string, boolean>>({})
  const [chainRole, setChainRole] = useState('Spine')
  const [query, setQuery] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [confirmedLosses, setConfirmedLosses] = useState(false)
  const [presetReview, setPresetReview] = useState(''), [confirmedPreset, setConfirmedPreset] = useState(false)
  const [editRevision, setEditRevision] = useState(revision)
  if (!isMixamo65Topology(target.bones)) return <p role="status">{vi ? 'Chọn target canonical Mixamo65 để tạo mapping.' : 'Choose a canonical Mixamo65 target to create a mapping.'}</p>
  const pairs = MIXAMO65_BONE_PARENTS.flatMap(([name]) => {
    const targetBone = target.bones.find((bone) => bone.deform && canonical(bone.name) === canonical(name))
    if (!assignments[name] || !targetBone) return []
    const extras = (chainSources[name] ?? []).filter((id) => isDescendant(parentById, id, assignments[name]!)).sort((a, b) => boneDepth(parentById, a) - boneDepth(parentById, b))
    const chain = [assignments[name]!, ...extras]
    const weights = chainWeights[name]?.length === chain.length ? chainWeights[name]! : chain.map(() => 1)
    return [{ role: `mixamo65:${name}`, sourceBoneId: chain[0]!, ...(chain.length > 1 ? { sourceBoneIds: chain, sourceBoneWeights: weights,
      ...(chainCompositions[name] === 'local-compose' ? { chainComposition: 'local-compose' as const } : {}) } : {}), targetBoneId: targetBone.id, enabled: true }]
  })
  const invalidChainRoles = pairs.filter((pair) => (pair.sourceBoneIds ?? []).some((id, index, ids) => index > 0 && !isDescendant(parentById, id, ids[index - 1]!))).map((pair) => pair.role)
  const invalidWeightRoles = pairs.filter((pair) => pair.sourceBoneWeights && (pair.sourceBoneWeights.some((weight) => !Number.isFinite(weight) || weight < 0 || pair.chainComposition === 'local-compose' && weight > 1) || !pair.sourceBoneWeights.some((weight) => weight > 0))).map((pair) => pair.role)
  const activeChain = assignments[chainRole] ? [assignments[chainRole]!, ...(chainSources[chainRole] ?? []).filter((id) => isDescendant(parentById, id, assignments[chainRole]!)).sort((a, b) => boneDepth(parentById, a) - boneDepth(parentById, b))] : []
  const activeWeights = chainWeights[chainRole]?.length === activeChain.length ? chainWeights[chainRole]! : activeChain.map(() => 1)
  const usedSource = new Set(pairs.flatMap((pair) => pair.sourceBoneIds ?? [pair.sourceBoneId])), usedTarget = new Set(pairs.map((pair) => pair.targetBoneId))
  const ignored = [...source.bones.filter((bone) => !usedSource.has(bone.id)).map((bone) => ({ side: 'source' as const, boneId: bone.id, reason: 'Not projected into target motion; original source retained.' })),
    ...target.bones.filter((bone) => !usedTarget.has(bone.id)).map((bone) => ({ side: 'target' as const, boneId: bone.id, reason: 'No source motion mapping; retains target rest-relative transform.' }))]
  async function save() {
    if (busy || !pairs.length || invalidChainRoles.length || invalidWeightRoles.length || Object.values(unreviewedChainModes).some(Boolean) || ignored.length && !confirmedLosses || presetReview && !confirmedPreset) return
    setBusy(true); setError('')
    try {
      const latest = await loadUnifiedProject(projectId), id = mapping?.id ?? crypto.randomUUID()
      if (latest.project.revision !== editRevision) throw new Error('Project changed while editing; reload the mapping before saving.')
      if (mapping && (mapping.sourceFingerprint !== source.fingerprint || mapping.targetFingerprint !== target.fingerprint)) throw new Error('Saved mapping fingerprints are stale; remap explicitly.')
      let calibration = createRetargetCalibration(source.fingerprint, target.fingerprint)
      if (mapping) {
        const response = await fetch(`/api/unified/projects/${encodeURIComponent(projectId)}/mappings/${encodeURIComponent(mapping.id)}/calibration`, { cache: 'no-store' })
        if (!response.ok) throw new Error(`Calibration load failed (${response.status})`)
        const saved: unknown = await response.json()
        if (!isRetargetCalibrationV1(saved, source.fingerprint, target.fingerprint)) throw new Error('Saved calibration does not match the edited profiles')
        calibration = saved
      }
      const result = await sendUnifiedCommand({ requestId: crypto.randomUUID(), projectId, expectedRevision: editRevision, command: 'skeleton.mapping.set',
        args: { mapping: { id, sourceProfileId: source.id, targetProfileId: target.id, sourceFingerprint: source.fingerprint, targetFingerprint: target.fingerprint, pairs, ignored },
          calibration } })
      setEditRevision(result.revision)
      onSaved(id)
      window.dispatchEvent(new CustomEvent('bbs-unified-project-commit', { detail: { projectId } }))
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusy(false) }
  }
  async function importPreset(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setError('')
    try {
      if (file.size > 1024 * 1024) throw new Error('Mapping preset is larger than 1 MiB.')
      const applied = applyMixamo65MappingPreset(JSON.parse(await file.text()), source, target)
      setAssignments(applied.assignments)
      setChainSources({})
      setChainWeights(applied.chainWeights)
      setChainCompositions(applied.chainCompositions)
      setUnreviewedChainModes({})
      setConfirmedLosses(false); setConfirmedPreset(false)
      const problems = [
        ...(!applied.fingerprintsMatch ? ['profile fingerprints differ; names were remapped'] : []),
        ...(applied.missingSource.length ? [`${applied.missingSource.length} missing source names`] : []),
        ...(applied.ambiguousSource.length ? [`${applied.ambiguousSource.length} ambiguous source names`] : []),
        ...(applied.missingTarget.length ? [`${applied.missingTarget.length} missing target names`] : []),
        ...(applied.ambiguousTarget.length ? [`${applied.ambiguousTarget.length} ambiguous target names`] : []),
        ...(applied.invalidSourceChain.length ? [`${applied.invalidSourceChain.length} invalid source chains`] : []),
      ]
      setChainSources(applied.chainAssignments)
      setPresetReview(problems.join('; ') || 'Review every suggested role before saving.')
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
  }
  function downloadPreset() {
    try {
      const orderedChains = Object.fromEntries(Object.entries(chainSources).map(([name, ids]) => [name, ids.slice().sort((a, b) => boneDepth(parentById, a) - boneDepth(parentById, b))]))
      const orderedWeights = Object.fromEntries(Object.entries(orderedChains).filter(([, ids]) => ids.length).map(([name, ids]) => {
        const length = ids.length + 1, weights = chainWeights[name]
        return [name, weights?.length === length ? weights : Array.from({ length }, () => 1)]
      }))
      const preset = createMixamo65MappingPreset(source, target, assignments, orderedChains, orderedWeights, chainCompositions)
      const url = URL.createObjectURL(new Blob([JSON.stringify(preset, null, 2)], { type: 'application/json' }))
      const link = document.createElement('a'); link.href = url; link.download = 'mixamo65-mapping-preset.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 0)
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
  }
  return <details><summary>{vi ? 'Tạo mapping65' : 'Create mapping65'} · {pairs.length}/65</summary>
    <div><button type="button" disabled={busy} onClick={downloadPreset}>{vi ? 'Xuất preset JSON' : 'Export JSON preset'}</button>
      <label>{vi ? 'Nhập preset JSON' : 'Import JSON preset'}<input type="file" accept="application/json,.json" disabled={busy} onChange={(event) => void importPreset(event)} /></label></div>
    {presetReview && <><p role="status">{vi ? `Preset cần rà soát: ${presetReview}. Tên bone chỉ được tự khớp khi duy nhất.` : `Preset needs review: ${presetReview}. Bone names are auto-matched only when unique.`}</p>
      <label><input type="checkbox" checked={confirmedPreset} onChange={(event) => setConfirmedPreset(event.target.checked)} />{vi ? 'Tôi đã rà soát các mapping được nhập.' : 'I reviewed the imported mappings.'}</label></>}
    <label>{vi ? 'Tìm joint' : 'Search joints'}<input value={query} onChange={(event) => setQuery(event.target.value)} /></label>
    <div className="wb-retarget-mapping-rows">{MIXAMO65_BONE_PARENTS.filter(([name]) => name.toLowerCase().includes(query.toLowerCase())).map(([name]) => <label key={name}>{name}
      <select value={assignments[name] ?? ''} disabled={busy} onChange={(event) => { setAssignments((current) => ({ ...current, [name]: event.target.value })); setChainSources((current) => ({ ...current, [name]: [] })); setChainWeights((current) => ({ ...current, [name]: [1] })); setConfirmedLosses(false); setConfirmedPreset(false) }}>
        <option value="">{vi ? 'Không gán · giữ rest đích' : 'Unmapped · target rest'}</option>
        {source.bones.map((bone) => <option key={bone.id} value={bone.id}>{bone.name} [{bone.id}]</option>)}
      </select></label>)}</div>
    <details><summary>{vi ? 'Gộp chain nguồn vào một joint Mixamo65' : 'Merge a source chain into one Mixamo65 joint'}</summary>
      <label>{vi ? 'Joint đích' : 'Target joint'}<select value={chainRole} disabled={busy} onChange={(event) => setChainRole(event.target.value)}>{MIXAMO65_BONE_PARENTS.map(([name]) => <option key={name} value={name}>{name}</option>)}</select></label>
      <label>{vi ? 'Cách kết hợp chuyển động chain' : 'Chain motion composition'}<select value={chainCompositions[chainRole] ?? 'world-average'} disabled={busy || activeChain.length < 2} onChange={(event) => {
        const mode = event.target.value as 'world-average' | 'local-compose'
        setChainCompositions((current) => ({ ...current, [chainRole]: mode }))
        setChainWeights((current) => ({ ...current, [chainRole]: activeChain.map(() => 1) }))
        setUnreviewedChainModes((current) => ({ ...current, [chainRole]: true }))
        setConfirmedLosses(false); setConfirmedPreset(false)
      }}><option value="world-average">World average</option><option value="local-compose">Local compose</option></select></label>
      <label>{vi ? 'Bone con bổ sung' : 'Additional descendant bones'}<select multiple size={5} value={chainSources[chainRole] ?? []} disabled={busy || !assignments[chainRole]} onChange={(event) => { const selected = Array.from(event.target.selectedOptions, (option) => option.value); setChainSources((current) => ({ ...current, [chainRole]: selected })); setChainWeights((current) => ({ ...current, [chainRole]: Array.from({ length: selected.length + 1 }, () => 1) })); setConfirmedLosses(false); setConfirmedPreset(false) }}>
        {source.bones.filter((bone) => {
          const base = assignments[chainRole]
          if (!base || bone.id === base) return false
          return !!base && isDescendant(parentById, bone.id, base)
        }).map((bone) => <option key={bone.id} value={bone.id}>{bone.name} [{bone.id}]</option>)}
      </select></label>
      {activeChain.length > 1 && <div>{activeChain.map((id, index) => <label key={id}>{vi ? `Trọng số xoay · ${source.bones.find((bone) => bone.id === id)?.name ?? id}` : `Rotation weight · ${source.bones.find((bone) => bone.id === id)?.name ?? id}`}
        <input type="number" min="0" max={chainCompositions[chainRole] === 'local-compose' ? 1 : undefined} step="0.1" value={activeWeights[index] ?? 1} disabled={busy} onChange={(event) => { const next = activeWeights.slice(); next[index] = event.currentTarget.valueAsNumber; setChainWeights((current) => ({ ...current, [chainRole]: next })); setConfirmedLosses(false); setConfirmedPreset(false) }} />
      </label>)}</div>}
      {unreviewedChainModes[chainRole] && <label><input type="checkbox" disabled={busy} onChange={(event) => setUnreviewedChainModes((current) => ({ ...current, [chainRole]: !event.target.checked }))} />{vi ? 'Tôi đã rà soát chế độ mới và trọng số đã đặt lại về 1.' : 'I reviewed the new mode and the weights reset to 1.'}</label>}
      <small>{chainCompositions[chainRole] === 'local-compose' ? (vi ? 'Local compose lấy delta xoay theo từng đoạn cha-con, bỏ chuyển động chung của cha; trọng số từ 0 đến 1.' : 'Local compose applies ancestor-first local rotation deltas and removes shared parent motion; weights range from 0 to 1.') : (vi ? 'World average dùng trọng số tương đối; 0 bỏ ảnh hưởng xoay. Root travel vẫn theo bone gốc.' : 'World average uses relative weights; 0 removes rotation influence. Root travel remains owned by the base bone.')}</small>
    </details>
    {!!invalidChainRoles.length && <p role="alert">{vi ? 'Chain cần là một nhánh liên tục; hãy bỏ các bone ở nhánh khác.' : 'A source chain must follow one hierarchy path; remove bones from other branches.'}</p>}
    {!!invalidWeightRoles.length && <p role="alert">{vi ? 'Mỗi chain cần trọng số không âm, hữu hạn và ít nhất một trọng số lớn hơn 0.' : 'Each chain needs finite nonnegative weights with at least one value above 0.'}</p>}
    <p>{vi ? 'Gợi ý tên chỉ là điểm bắt đầu; cần kiểm bên trái/phải và rest pose. Calibration universal chưa có trong panel này.' : 'Name suggestions require review of side and rest pose. Universal calibration is not yet available in this panel.'}</p>
    {!!ignored.length && <><details><summary>{vi ? 'Xương chưa gán' : 'Unmapped bones'} · {ignored.length}</summary><ul>{ignored.map((item) => <li key={`${item.side}:${item.boneId}`}>{item.side}: {(item.side === 'source' ? source : target).bones.find((bone) => bone.id === item.boneId)?.name} [{item.boneId}]</li>)}</ul></details>
      <label><input type="checkbox" checked={confirmedLosses} onChange={(event) => setConfirmedLosses(event.target.checked)} />{vi ? 'Xác nhận các xương nguồn không chuyển motion và joint đích giữ rest; không áp dụng cho skin transfer.' : 'Confirm unmapped source motion and target rest joints; this does not approve skin transfer.'}</label></>}
    <button type="button" disabled={busy || !pairs.length || !!invalidChainRoles.length || !!invalidWeightRoles.length || Object.values(unreviewedChainModes).some(Boolean) || !!ignored.length && !confirmedLosses || !!presetReview && !confirmedPreset} onClick={() => void save()}>{mapping ? (vi ? 'Cập nhật mapping' : 'Update mapping') : (vi ? 'Lưu mapping mới' : 'Save new mapping')}</button>
    {error && <p role="alert">{error}</p>}
  </details>
}
