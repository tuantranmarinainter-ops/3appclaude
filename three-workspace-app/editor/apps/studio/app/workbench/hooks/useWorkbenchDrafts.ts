import { useCallback, useEffect, useState } from 'react'
import { translateStudio } from '../../../src/locale'
import { CAMERA_PRESETS, createInitialDraft, type DirectorDocument } from '@topview/3d-builder'
import type { DraftRow, ProjectRow } from '../types'
import { slugify } from '../utils'
import { LocalHostAdapter } from '../../../src/LocalHostAdapter'
import { ensureUnifiedSession, loadUnifiedProjects, sendUnifiedCommand } from '../../../src/unifiedApi'

export interface UnifiedProjectRow extends DraftRow { revision: number; updatedAt: string }

async function createLocalDraft(id: string, doc: DirectorDocument): Promise<string> {
  const res = await fetch('/api/drafts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, doc }),
  })
  if (!res.ok) {
    const body = (await res.json()) as { error?: string }
    throw new Error(body.error ?? `HTTP ${res.status}`)
  }
  return id
}

export function useWorkbenchDrafts() {
  const [projects, setProjects] = useState<ProjectRow[]>([])
  const [unifiedProjects, setUnifiedProjects] = useState<UnifiedProjectRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const reload = useCallback(async () => {
    try {
      const listed = await fetch('/api/projects', { cache: 'no-store' })
      setProjects(listed.ok ? ((await listed.json()) as { projects: ProjectRow[] }).projects : [])
      await ensureUnifiedSession()
      const unified = await loadUnifiedProjects<{ projects: UnifiedProjectRow[] }>()
      setUnifiedProjects(unified.projects)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  const createDraft = async (input: {
    name: string
    fps: number
    frames: number
    withCamera: boolean
  }): Promise<string | null> => {
    setBusy(true)
    setError(null)
    try {
      const camera = input.withCamera ? CAMERA_PRESETS.find((p) => p.id === 'front-medium') : undefined
      const doc = await createInitialDraft(new LocalHostAdapter(), {
        name: input.name.trim() || translateStudio('新草稿'),
        fps: input.fps,
        totalFrames: input.frames,
        camera,
      })
      const id = await createLocalDraft(`${slugify(input.name)}-${Date.now().toString(36)}`, doc)
      await reload()
      return id
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      return null
    } finally {
      setBusy(false)
    }
  }

  const createUnifiedProject = async (input: { name: string; fps: number; frames: number; withCamera: boolean }): Promise<string | null> => {
    setBusy(true)
    setError(null)
    try {
      await ensureUnifiedSession()
      const camera = input.withCamera ? CAMERA_PRESETS.find((p) => p.id === 'front-medium') : undefined
      const name = input.name.trim() || translateStudio('Dự án mới')
      const scene = await createInitialDraft(new LocalHostAdapter(), { name, fps: input.fps, totalFrames: input.frames, camera })
      const response = await sendUnifiedCommand({
        requestId: crypto.randomUUID(), command: 'project.create', args: { name, scene, fcurves: null },
      })
      const id = response.result.projectId
      if (typeof id !== 'string') throw new Error('Project create response is missing projectId')
      await reload()
      return id
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      return null
    } finally { setBusy(false) }
  }

  const removeDraft = async (id: string) => {
    setBusy(true)
    try {
      await fetch(`/api/drafts/${id}`, { method: 'DELETE' })
      await reload()
    } finally {
      setBusy(false)
    }
  }

  return { projects, unifiedProjects, error, busy, createDraft, createUnifiedProject, removeDraft }
}
