import { useCallback, useEffect, useRef, useState } from 'react'
import type { UnifiedProject } from '@bbs/animation-workspace-shared'
import { loadUnifiedProject, sendUnifiedCommand } from '../../../../../src/unifiedApi'
import type { VfxCue } from '../../../../../src/vfxCues'
import type { VfxCueForm, VfxCuePatch } from '../types'

function invalidateRequest(ref: { current: number }): void { ref.current++ }

export function useVfxCueHost(projectId: string, initialProject: UnifiedProject, active: boolean) {
  const [project, setProject] = useState(initialProject)
  const [cues, setCues] = useState<VfxCue[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const requestSeq = useRef(0)
  const live = useRef(false)
  const refresh = useCallback(async () => {
    const request = ++requestSeq.current
    try {
      const fresh = (await loadUnifiedProject(projectId)).project
      const listed = await sendUnifiedCommand({ requestId: crypto.randomUUID(), projectId,
        expectedRevision: fresh.revision, command: 'vfx.cue.list', args: {} })
      const found = listed.result.cues
      if (!Array.isArray(found)) throw new Error('VFX cue list returned an invalid response')
      if (!live.current || request !== requestSeq.current || fresh.projectId !== projectId) return
      setProject(fresh)
      setCues(found as VfxCue[])
      setError('')
    } catch (cause) {
      if (live.current && request === requestSeq.current) throw cause
    }
  }, [projectId])
  useEffect(() => {
    live.current = true
    if (!active) return
    setLoading(true)
    void refresh().catch((cause: unknown) => { if (live.current) setError(cause instanceof Error ? cause.message : String(cause)) })
      .finally(() => { if (live.current) setLoading(false) })
    const onCommit = (event: Event) => {
      if ((event as CustomEvent<{ projectId?: string }>).detail?.projectId === projectId) {
        void refresh().catch((cause: unknown) => { if (live.current) setError(cause instanceof Error ? cause.message : String(cause)) })
      }
    }
    window.addEventListener('bbs-unified-project-commit', onCommit)
    return () => { live.current = false; invalidateRequest(requestSeq); window.removeEventListener('bbs-unified-project-commit', onCommit) }
  }, [active, projectId, refresh])
  const mutate = useCallback(async (command: 'vfx.cue.add' | 'vfx.cue.update' | 'vfx.cue.remove', args: Record<string, unknown>) => {
    // A stale panel must receive REVISION_CONFLICT rather than overwrite another editor's cue.
    await sendUnifiedCommand({ requestId: crypto.randomUUID(), projectId, expectedRevision: project.revision, command, args })
    window.dispatchEvent(new CustomEvent('bbs-unified-project-commit', { detail: { projectId } }))
  }, [projectId, project.revision])
  return { project, cues, error, loading, onAdd: (cue: VfxCueForm) => mutate('vfx.cue.add', { cue }),
    onUpdate: (id: string, patch: VfxCuePatch) => mutate('vfx.cue.update', { id, patch }),
    onRemove: (id: string) => mutate('vfx.cue.remove', { id }) }
}
