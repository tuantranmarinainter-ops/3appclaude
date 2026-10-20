'use client'

import type { UnifiedProject } from '@bbs/animation-workspace-shared'
import { isMixamo65Topology } from '@bbs/retarget'
import { useStudioLocale } from '../../../../src/devtools/localePreference'
import { useAssignment } from './hooks/useAssignment'

export function AssignmentPanel({ projectId, project }: { projectId: string; project: UnifiedProject | null }) {
  const vi = useStudioLocale() === 'vi', model = useAssignment(projectId)
  const motions = Object.values(project?.motions ?? {}).filter((motion) => ['topview-0.1.8', 'animation-1.31.8'].includes(motion.evaluator) && isMixamo65Topology(project?.skeletons[motion.skeletonId]?.bones ?? []))
  const characters = Object.values(project?.characters ?? {}).filter((character) => isMixamo65Topology(project?.skeletons[character.skeletonId]?.bones ?? []))
  const running = model.job?.state === 'queued' || model.job?.state === 'running'
  return <details className="wb-retarget-settings-group"><summary>{vi ? 'Gán animation lên nhân vật Mixamo65' : 'Assign animation to Mixamo65 Character'}</summary>
    <div className="wb-retarget-session-grid">
      <p>{vi ? 'Tạo Motion derivative theo rest pose của nhân vật nhận, đặt vào timeline và ghi Binding trong cùng một revision.' : 'Create a Motion derivative for the receiver rest pose, place it on the timeline, and save its Binding in one revision.'}</p>
      <label>{vi ? 'Motion nguồn' : 'Source Motion'}<select value={model.motionId} disabled={model.busy || running} onChange={(event) => model.setMotionId(event.target.value)}>
        <option value="">—</option>{motions.map((motion) => <option key={motion.id} value={motion.id}>{project?.assets[motion.assetId]?.displayName ?? motion.id} · {motion.durationSeconds.toFixed(2)}s</option>)}
      </select></label>
      <label>{vi ? 'Nhân vật nhận' : 'Receiver Character'}<select value={model.characterId} disabled={model.busy || running} onChange={(event) => model.setCharacterId(event.target.value)}>
        <option value="">—</option>{characters.map((character) => <option key={character.id} value={character.id}>{character.name}</option>)}
      </select></label>
      <button type="button" disabled={model.busy || running || !model.motionId || !model.characterId} onClick={() => void model.execute('plan')}>{vi ? 'Kiểm tra gán' : 'Check assignment'}</button>
      {model.plan && <p role="status">{model.plan.sampleCount} samples · {model.plan.ready ? (vi ? 'Sẵn sàng' : 'Ready') : model.plan.issues.join(', ')}</p>}
      <button type="button" disabled={model.busy || running || !model.plan?.ready} onClick={() => void model.execute('run')}>{vi ? 'Tạo derivative' : 'Build derivative'}</button>
      {model.job && <p role="status">{model.job.state} · {Math.round(model.job.progress * 100)}% {model.job.error?.message}</p>}
      {running && <button type="button" disabled={model.busy} onClick={() => void model.execute('cancel')}>{vi ? 'Hủy job' : 'Cancel job'}</button>}
      {model.job?.state === 'succeeded' && <button type="button" disabled={model.busy} onClick={() => void model.execute('commit')}>{vi ? 'Gán và đặt vào timeline' : 'Assign and place on timeline'}</button>}
      {model.error && <p className="wb-retarget-error" role="alert">{model.error}</p>}{model.message && <p role="status">{model.message}</p>}
    </div>
  </details>
}
