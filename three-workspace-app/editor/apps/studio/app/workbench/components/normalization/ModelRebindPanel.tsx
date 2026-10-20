'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import type { UnifiedProject } from '@bbs/animation-workspace-shared'
import { loadUnifiedProject, sendUnifiedCommand, uploadUnifiedAsset } from '../../../../src/unifiedApi'
import { canonicalizeClip, loadModelScene, mappedSkinOwners, rebindAndExport, weightedSourceBones } from './modelUtils'

type RebindResult = Awaited<ReturnType<typeof rebindAndExport>>

export function ModelRebindPanel({ projectId, project, vi }: { projectId: string; project: UnifiedProject | null; vi: boolean }) {
  const [assetId, setAssetId] = useState(''), [sourceProfileSelection, setSourceProfileSelection] = useState(''), [profileId, setProfileId] = useState(''), [mappingId, setMappingId] = useState(''), [motionId, setMotionId] = useState('')
  const [weighted, setWeighted] = useState<string[]>([]), [owners, setOwners] = useState<Record<string, string>>({})
  const [staged, setStaged] = useState<{ key: string; result: RebindResult } | null>(null)
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('')
  const [reportRef, setReportRef] = useState<{ assetId: string; variant: string } | null>(null), [reportText, setReportText] = useState('')
  const models = Object.values(project?.assets ?? {}).filter((asset) => asset.kind === 'model')
  const sourceAsset = Object.values(project?.assets ?? {}).find((asset) => asset.id === assetId)
  const sourceProfiles = useMemo(() => sourceAsset ? Object.values(project?.skeletons ?? {}).filter((profile) => profile.provenance.sourceHash === sourceAsset.source.sha256) : [], [project, sourceAsset])
  const sourceProfile = sourceProfiles.find((profile) => profile.id === sourceProfileSelection) ?? (sourceProfiles.length === 1 ? sourceProfiles[0] : undefined)
  const targets = Object.values(project?.skeletons ?? {}).filter((profile) => profile.family === 'mixamo65')
  const target = targets.find((profile) => profile.id === profileId)
  const mapping = project?.mappings[mappingId]
  const motions = Object.values(project?.motions ?? {}).filter((motion) => motion.skeletonId === target?.id && motion.evaluator === 'topview-0.1.8')
  const reviewKey = JSON.stringify([projectId, project?.revision, assetId, sourceProfile?.id, profileId, mappingId, motionId, Object.entries(owners).sort(([a], [b]) => a.localeCompare(b))])
  const reviewKeyRef = useRef(reviewKey); reviewKeyRef.current = reviewKey

  useEffect(() => { setStaged(null) }, [reviewKey])

  useEffect(() => {
    let live = true
    setWeighted([]); setOwners({}); setError('')
    if (!sourceAsset || !sourceProfile) return
    void fetch(`/api/unified/projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(sourceAsset.id)}/source`)
      .then(async (response) => { if (!response.ok) throw new Error(`Source model load failed (${response.status})`); return loadModelScene(await response.arrayBuffer(), sourceAsset.source.mediaType) })
      .then((scene) => { if (live) setWeighted(weightedSourceBones(scene)) })
      .catch((cause) => { if (live) setError(cause instanceof Error ? cause.message : String(cause)) })
    return () => { live = false }
  }, [projectId, sourceAsset, sourceProfile])

  useEffect(() => {
    if (!mapping || !sourceProfile || !target) { setOwners({}); return }
    setOwners(mappedSkinOwners(mapping, sourceProfile, target))
  }, [mapping, sourceProfile, target])

  async function build() {
    if (!project || !sourceAsset || !sourceProfile || !target || !mapping || !motionId || busy) return
    setBusy(true); setError(''); setMessage('')
    try {
      const key = reviewKey
      const [modelResponse, motion] = await Promise.all([
        fetch(`/api/unified/projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(sourceAsset.id)}/source`),
        Promise.resolve(project.motions[motionId]!),
      ])
      if (!modelResponse.ok) throw new Error(`Source model load failed (${modelResponse.status})`)
      const [modelBytes, motionAsset] = await Promise.all([modelResponse.arrayBuffer(), Promise.resolve(project.assets[motion.assetId])])
      if (!motionAsset) throw new Error('Normalized Motion asset is missing')
      const motionResponse = await fetch(`/api/unified/projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(motionAsset.id)}/source`)
      if (!motionResponse.ok) throw new Error(`Normalized Motion load failed (${motionResponse.status})`)
      const motionGltf = await new GLTFLoader().parseAsync(await motionResponse.arrayBuffer(), '')
      const metadata = project.extensions.retargetMotionMetadata?.[motion.id] as { clipIndex?: number } | undefined
      const clip = motionGltf.animations[metadata?.clipIndex ?? 0]
      if (!clip) throw new Error('Selected Motion contains no readable action')
      const normalizedClip = canonicalizeClip(clip, motionGltf.scene, target)
      const result = await rebindAndExport(await loadModelScene(modelBytes, sourceAsset.source.mediaType), sourceProfile, target, mapping, owners, normalizedClip)
      if (reviewKeyRef.current !== key) throw new Error('Selections changed while preparing the transfer; review it again.')
      setStaged({ key, result })
      setMessage(vi ? 'Đã chuẩn bị bản chuyển. Kiểm tra báo cáo loss trước khi áp dụng.' : 'Transfer prepared. Review the loss report before applying it.')
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusy(false) }
  }

  async function applyStaged() {
    if (!project || !sourceAsset || !staged || staged.key !== reviewKey || busy) return
    setBusy(true); setError(''); setMessage('')
    try {
      const { result } = staged
      const motion = project.motions[motionId]
      if (!motion) throw new Error('Selected normalized Motion no longer exists')
      const uploaded = await uploadUnifiedAsset(new File([result.bytes], `${sourceAsset.displayName}-mixamo65.glb`, { type: 'model/gltf-binary' }))
      const rebindReport = { schema: 'bbs-model-rebind-report', version: 1, producer: 'studio-client', outputSha256: uploaded.sha256,
        sourceAssetId: sourceAsset.id, sourceSha256: sourceAsset.source.sha256, motionId: motion.id, ...result.report }
      const imported = await sendUnifiedCommand({ requestId: crypto.randomUUID(), projectId, expectedRevision: project.revision,
        command: 'asset.import', args: { files: [uploaded.uploadId], format: 'glb', modelRebindReport: rebindReport } })
      const importResult = imported.result as { assetIds?: string[]; skeletonIds?: string[]; motionIds?: string[]; modelRebindReports?: Array<{ assetId: string; variant: string }> }
      const outputAssetId = importResult.assetIds?.[0], outputSkeletonId = importResult.skeletonIds?.[0], outputMotionId = importResult.motionIds?.[0]
      if (!outputAssetId || !outputSkeletonId || !outputMotionId) throw new Error('Imported output did not produce a model, skeleton profile and animation')
      const storedReport = importResult.modelRebindReports?.[0]
      if (!storedReport || storedReport.assetId !== outputAssetId) throw new Error('Model was imported without its persisted rebind report')
      const latest = await loadUnifiedProject(projectId)
      const placed = await sendUnifiedCommand({ requestId: crypto.randomUUID(), projectId, expectedRevision: latest.project.revision,
        command: 'character.add', args: { assetId: outputAssetId, skeletonId: outputSkeletonId, name: `${sourceAsset.displayName} · Mixamo65` } })
      const characterId = String((placed.result as { characterId?: string }).characterId ?? '')
      if (!characterId) throw new Error('Character was created, but the Scene response omitted its ID')
      const timeline = await sendUnifiedCommand({ requestId: crypto.randomUUID(), projectId, expectedRevision: placed.revision,
        command: 'motion.place', args: { motionId: outputMotionId, characterId, frameStart: 0 } })
      setMessage(`${vi ? 'Đã tạo Character và đặt Animation trong Scene' : 'Character created and animation placed in Scene'} · ${result.report.vertices} ${vi ? 'đỉnh' : 'vertices'} · rest error ${result.report.maxRestError.toExponential(2)} · revision ${timeline.revision}`)
      setReportRef({ assetId: storedReport.assetId, variant: storedReport.variant }); setReportText('')
      setStaged(null)
      window.dispatchEvent(new CustomEvent('bbs-unified-project-commit', { detail: { projectId } }))
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusy(false) }
  }

  async function openReport() {
    if (!reportRef || busy) return
    setBusy(true); setError('')
    try {
      const response = await fetch(`/api/unified/projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(reportRef.assetId)}/${encodeURIComponent(reportRef.variant)}`)
      if (!response.ok) throw new Error(`Rebind report load failed (${response.status})`)
      setReportText(JSON.stringify(await response.json(), null, 2))
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusy(false) }
  }

  return <details className="wb-retarget-settings-group"><summary>{vi ? 'Model + Rig Mixamo65 + Animation' : 'Model + Mixamo65 rig + animation'}</summary>
    <div className="wb-retarget-session-grid">
      <p>{vi ? 'Giữ mesh nguồn, chuyển weight sang rig Mixamo65 bằng mapping và owner xương rõ ràng; chọn Motion đã chuẩn hóa.' : 'Preserve the source mesh, transfer weights to Mixamo65 with explicit mapping/owners, and choose a normalized Motion.'}</p>
      <label>{vi ? 'Model nguồn' : 'Source model'}<select value={assetId} disabled={busy} onChange={(event) => { setAssetId(event.target.value); setSourceProfileSelection(''); setProfileId(''); setMappingId('') }}><option value="">—</option>{models.map((asset) => <option key={asset.id} value={asset.id}>{asset.displayName}</option>)}</select></label>
      {!!sourceProfiles.length && <label>{vi ? 'Hệ xương của model' : 'Model skeleton'}<select value={sourceProfile?.id ?? ''} disabled={busy} onChange={(event) => { setSourceProfileSelection(event.target.value); setMappingId('') }}><option value="">{vi ? 'Chọn hệ xương' : 'Select skeleton'}</option>{sourceProfiles.map((item) => <option key={item.id} value={item.id}>{item.family} · {item.bones.length} bones · {item.bones.find((bone) => bone.id === item.rootBoneId)?.name ?? item.rootBoneId}</option>)}</select></label>}
      <label>{vi ? 'Rig Mixamo65' : 'Mixamo65 rig'}<select value={profileId} disabled={busy} onChange={(event) => { setProfileId(event.target.value); setMappingId('') }}><option value="">—</option>{targets.map((item) => <option key={item.id} value={item.id}>{item.provenance.original.path.split('/').at(-1) || item.id}</option>)}</select></label>
      <label>Mapping<select value={mappingId} disabled={busy || !sourceProfile || !target} onChange={(event) => setMappingId(event.target.value)}><option value="">—</option>{Object.values(project?.mappings ?? {}).filter((item) => item.confirmed && item.sourceProfileId === sourceProfile?.id && item.targetProfileId === target?.id).map((item) => <option key={item.id} value={item.id}>{item.id.slice(0, 8)}</option>)}</select></label>
      <label>Motion<select value={motionId} disabled={busy || !motions.length} onChange={(event) => setMotionId(event.target.value)}><option value="">—</option>{motions.map((item) => <option key={item.id} value={item.id}>{project?.assets[item.assetId]?.displayName ?? item.id}</option>)}</select></label>
      {weighted.map((name) => <label key={name}>{vi ? `Owner da của ${name}` : `Skin owner for ${name}`}<select value={owners[name] ?? ''} disabled={busy || !target} onChange={(event) => setOwners((current) => ({ ...current, [name]: event.target.value }))}><option value="">—</option>{target?.bones.map((bone) => <option key={bone.id} value={bone.name}>{bone.name}</option>)}</select></label>)}
      <button type="button" disabled={busy || !sourceProfile || !target || !mapping || !motionId || !weighted.length || weighted.some((name) => !owners[name])} onClick={() => void build()}>{busy ? (vi ? 'Đang chuẩn bị…' : 'Preparing transfer…') : (vi ? 'Chuẩn bị và xem report' : 'Prepare and review report')}</button>
      {staged?.key === reviewKey && <section aria-label={vi ? 'Xem trước chuyển skin' : 'Skin transfer review'}>
        <h4>{vi ? 'Kiểm tra trước khi áp dụng' : 'Review before applying'}</h4>
        <p>{vi ? `${staged.result.report.vertices} đỉnh · sai số rest tối đa ${staged.result.report.maxRestError.toExponential(2)}` : `${staged.result.report.vertices} vertices · max rest error ${staged.result.report.maxRestError.toExponential(2)}`}</p>
        <ul>{staged.result.report.meshes.map((mesh) => <li key={mesh.mesh}>{mesh.mesh || (vi ? '(không tên)' : '(unnamed)')}: {mesh.affectedVertices} {vi ? 'đỉnh bị ảnh hưởng' : 'affected vertices'}, {mesh.droppedWeight} {vi ? 'weight bị loại' : 'weight dropped'}</li>)}</ul>
        <button type="button" disabled={busy} onClick={() => void applyStaged()}>{busy ? (vi ? 'Đang lưu…' : 'Applying…') : (vi ? 'Xác nhận và tạo Character trong Scene' : 'Confirm and create Character in Scene')}</button>
      </section>}
      {reportRef && <button type="button" disabled={busy} onClick={() => void openReport()}>{vi ? 'Mở báo cáo chuyển skin đã lưu' : 'Open saved skin-transfer report'}</button>}
      {reportText && <pre aria-label={vi ? 'Báo cáo chuyển skin' : 'Skin transfer report'}>{reportText}</pre>}
      {error && <p className="wb-retarget-error" role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    </div>
  </details>
}
