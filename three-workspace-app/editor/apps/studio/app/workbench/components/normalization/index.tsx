'use client'

import { useStudioLocale } from '../../../../src/devtools/localePreference'
import { useNormalization } from './hooks/useNormalization'
import { CanonicalMappingEditor } from './MappingEditor'
import { AssignmentPanel } from './AssignmentPanel'
import { ModelRebindPanel } from './ModelRebindPanel'
import { RigTree } from './RigTree'
import { NormalizationPreview } from './NormalizationPreview'

export function NormalizationPanel({ projectId }: { projectId: string }) {
  const vi = useStudioLocale() === 'vi', model = useNormalization(projectId)
  const { project, job, plan, busy } = model
  const running = job?.state === 'queued' || job?.state === 'running'
  const scaleValid = Number.isFinite(model.rootTranslationScale) && model.rootTranslationScale >= 0.01 && model.rootTranslationScale <= 20
  const assets = Object.values(project?.assets ?? {}).filter((asset) => ['model', 'motion'].includes(asset.kind))
  const sourceProfiles = model.sourceProfiles, targetProfiles = model.targetProfiles
  const sourceProfile = sourceProfiles.find((profile) => profile.id === model.sourceSkeletonId)
  const targetProfile = targetProfiles.find((profile) => profile.id === model.targetSkeletonId)
  const selectedMapping = project?.mappings[model.mappingId]
  const editableMapping = selectedMapping?.sourceProfileId === sourceProfile?.id && selectedMapping?.targetProfileId === targetProfile?.id && selectedMapping?.pairs.some((pair) => pair.role.startsWith('mixamo65:')) ? selectedMapping : undefined
  return <><details className="wb-retarget-settings-group"><summary>{vi ? 'Universal · chuẩn hóa animation' : 'Universal animation normalization'}</summary>
    <div className="wb-retarget-session-grid">
      <p>{vi ? 'Animation-only → Mixamo65. Chọn mapping đã lưu; xương ngón chưa mapping giữ tư thế nghỉ.' : 'Animation-only → Mixamo65. Choose a saved mapping; unmapped fingers retain their rest pose.'}</p>
      <label>{vi ? 'Nguồn' : 'Source asset'}<select value={model.sourceAssetId} disabled={busy || running} onChange={(event) => model.setSourceAssetId(event.target.value)}><option value="">—</option>{assets.map((asset) => <option key={asset.id} value={asset.id}>{asset.displayName}</option>)}</select></label>
      {!!sourceProfiles.length && <label>{vi ? 'Hệ xương nguồn' : 'Source skeleton'}<select value={model.sourceSkeletonId} disabled={busy || running} onChange={(event) => model.setSourceSkeletonSelection(event.target.value)}><option value="">{vi ? 'Chọn hệ xương' : 'Select skeleton'}</option>{sourceProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.family} · {profile.bones.length} bones · {profile.bones.find((bone) => bone.id === profile.rootBoneId)?.name ?? profile.rootBoneId}</option>)}</select></label>}
      {model.inspection && <RigTree rig={model.inspection.graph} profileBoneLinks={model.inspection.profileBoneLinks} vi={vi} />}
      <label>{vi ? 'Model/rig Mixamo65 đích' : 'Target Mixamo65 model/rig'}<select value={model.targetAssetId} disabled={busy || running} onChange={(event) => model.setTargetAssetId(event.target.value)}><option value="">—</option>{assets.map((asset) => <option key={asset.id} value={asset.id}>{asset.displayName}</option>)}</select></label>
      {!!targetProfiles.length && <label>{vi ? 'Hệ xương đích' : 'Target skeleton'}<select value={model.targetSkeletonId} disabled={busy || running} onChange={(event) => model.setTargetSkeletonSelection(event.target.value)}><option value="">{vi ? 'Chọn hệ xương' : 'Select skeleton'}</option>{targetProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.family} · {profile.bones.length} bones · {profile.bones.find((bone) => bone.id === profile.rootBoneId)?.name ?? profile.rootBoneId}</option>)}</select></label>}
      <label>Mapping<select value={model.mappingId} disabled={busy || running} onChange={(event) => model.setMappingId(event.target.value)}><option value="">—</option>{Object.values(project?.mappings ?? {}).filter((mapping) => mapping.sourceProfileId === sourceProfile?.id && mapping.targetProfileId === targetProfile?.id).map((mapping) => <option key={mapping.id} value={mapping.id}>{mapping.id.slice(0, 8)} · {mapping.confirmed ? 'confirmed' : 'draft'}</option>)}</select></label>
      {!running && sourceProfile && targetProfile && <CanonicalMappingEditor key={`${sourceProfile.fingerprint}:${targetProfile.fingerprint}:${editableMapping?.id ?? 'new'}`} projectId={projectId} revision={project!.revision} source={sourceProfile} target={targetProfile} mapping={editableMapping} vi={vi} onSaved={model.setMappingId} />}
      <label>Action<select value={model.actionIndex} disabled={busy || running || model.inspecting || !model.actions.length} onChange={(event) => model.setActionIndex(Number(event.target.value))}>
        {!model.actions.length && <option value={0}>{model.inspecting ? (vi ? 'Đang đọc Action…' : 'Inspecting actions…') : (vi ? 'Chưa có Action' : 'No actions')}</option>}
        {model.actions.map((action) => <option key={action.index} value={action.index}>{action.name} · {action.durationSeconds.toFixed(3)}s · {action.channels.length}/{action.totalTrackCount} tracks{action.ready ? '' : ` · ⚠ ${action.issues.length} unsupported`}</option>)}
      </select></label>
      {project && selectedMapping?.confirmed && selectedMapping.sourceProfileId === sourceProfile?.id && selectedMapping.targetProfileId === targetProfile?.id && model.sourceAssetId && model.targetAssetId && <NormalizationPreview key={`${model.sourceAssetId}:${model.sourceSkeletonId}:${model.targetAssetId}:${model.targetSkeletonId}:${selectedMapping.id}:${model.actionIndex}`} projectId={projectId} project={project} sourceAssetId={model.sourceAssetId} targetAssetId={model.targetAssetId} mappingId={selectedMapping.id} actionIndex={model.actionIndex} rootTranslationPolicy={model.rootTranslationPolicy} rootTranslationScale={model.rootTranslationScale} vi={vi} />}
      <label>FPS<input type="number" min={1} max={240} value={model.fps} disabled={busy || running} onChange={(event) => model.setFps(Number(event.target.value))} /></label>
      <label>{vi ? 'Dịch chuyển root' : 'Root translation'}<select value={model.rootTranslationPolicy} disabled={busy || running} onChange={(event) => model.setRootTranslationPolicy(event.target.value as 'preserve' | 'in-place')}>
        <option value="preserve">{vi ? 'Giữ theo mét' : 'Preserve meters'}</option><option value="in-place">{vi ? 'Tại chỗ (giữ rotation)' : 'In place (keep rotation)'}</option>
      </select></label>
      <label>{vi ? 'Hiệu chỉnh quãng đường root' : 'Root travel calibration'}<input aria-describedby="normalization-root-scale-hint" type="number" min={0.01} max={20} step={0.05} value={model.rootTranslationScale} disabled={busy || running || model.rootTranslationPolicy === 'in-place'} onChange={(event) => model.setRootTranslationScale(Number(event.target.value))} /></label>
      <small id="normalization-root-scale-hint">{vi ? 'Nhân dịch chuyển root nguồn; 1 = giữ mét. Chỉ áp dụng chế độ preserve.' : 'Scales source root travel; 1 preserves meters. Used only with preserve.'}</small>
      <button type="button" disabled={busy || running || !scaleValid || model.inspecting || !model.actions.length || !model.mappingId || !model.sourceAssetId || !model.targetAssetId} onClick={() => void model.execute('plan')}>{vi ? 'Kiểm tra kế hoạch' : 'Check plan'}</button>
      {plan && <div><p role="status">{plan.sampleCount} samples · {plan.resourceCost.nodeSamples.toLocaleString()} node-samples · {(plan.resourceCost.estimatedPeakBytes / (1024 * 1024)).toFixed(1)} MiB estimated · {plan.ready ? (vi ? 'Sẵn sàng' : 'Ready') : plan.issues.join(', ')}</p>
        {!!plan.actionIssues.length && <details><summary>{vi ? `Action có ${plan.actionIssues.length} track không hỗ trợ` : `Action has ${plan.actionIssues.length} unsupported track(s)`}</summary><ul>{plan.actionIssues.map((issue, index) => <li key={`${issue.trackName}:${index}`}>{issue.code} · {issue.trackName}: {issue.message}</li>)}</ul></details>}
        {!!plan.excludedSourceBones.length && <details><summary>{vi ? `Không chuyển ${plan.excludedSourceBones.length} xương nguồn` : `Excluded ${plan.excludedSourceBones.length} source bones`}</summary><ul>{plan.excludedSourceBones.map((bone) => <li key={bone.sourceBoneId}>{bone.name} [{bone.sourceBoneId}]: {bone.reason}</li>)}</ul></details>}
      </div>}
      <button type="button" disabled={busy || running || !plan?.ready} onClick={() => void model.execute('run')}>{vi ? 'Chuẩn hóa' : 'Normalize'}</button>
      {job && <p role="status">{job.state} · {Math.round(job.progress * 100)}% {job.error?.message}</p>}
      {running && <button type="button" disabled={busy} onClick={() => void model.execute('cancel')}>{vi ? 'Hủy job' : 'Cancel job'}</button>}
      {job?.state === 'succeeded' && <button type="button" disabled={busy} onClick={() => void model.execute('save')}>{vi ? 'Lưu Motion vào project' : 'Save Motion to project'}</button>}
      {model.error && <p className="wb-retarget-error" role="alert">{model.error}</p>}
      {model.message && <p role="status">{model.message}</p>}
    </div>
  </details><ModelRebindPanel projectId={projectId} project={project} vi={vi} /><AssignmentPanel projectId={projectId} project={project} /></>
}
