'use client'

import { useCallback, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { CreateDialog } from './components/CreateDialog'
import { DraftCard } from './components/DraftCard'
import { PlusIcon } from './components/icons'
import { StudioOverlay } from './components/StudioOverlay'
import { DEFAULT_FPS, DEFAULT_FRAMES, DRAFT_QUERY_KEY, PROJECT_QUERY_KEY, UNIFIED_QUERY_KEY } from './constants'
import { useStudioT } from '../../src/locale'
import { useWorkbenchDrafts } from './hooks/useWorkbenchDrafts'
import { LanguageMenu } from './components/LanguageMenu'
import { WorkspaceNavigationSlot } from './components/feature-navigation/WorkspaceNavigation'
import { useStudioLocale } from '../../src/devtools/localePreference'
import { buildWorkbenchHref, isValidDraftId, readDraftQuery } from './utils'
import './styles.css'

export function WorkbenchClient() {
  const t = useStudioT()
  const vi = useStudioLocale() === 'vi'
  const router = useRouter()
  const searchParams = useSearchParams()
  const { projects, unifiedProjects, error, busy, createUnifiedProject } = useWorkbenchDrafts()
  const [createOpen, setCreateOpen] = useState(false)
  const editingId = readDraftQuery(searchParams.get(DRAFT_QUERY_KEY))
  const projectId = editingId ? null : readDraftQuery(searchParams.get(PROJECT_QUERY_KEY))
  const unifiedId = editingId || projectId ? null : readDraftQuery(searchParams.get(UNIFIED_QUERY_KEY))
  const [name, setName] = useState('')
  const [fps, setFps] = useState(DEFAULT_FPS)
  const [frames, setFrames] = useState(DEFAULT_FRAMES)
  const [withCamera, setWithCamera] = useState(true)

  const syncQuery = useCallback(
    (open: { draft?: string; project?: string; unified?: string } | null) => {
      const href = buildWorkbenchHref(searchParams.toString(), open)
      if (href === `${window.location.pathname}${window.location.search}`) return
      router.replace(href, { scroll: false })
    },
    [router, searchParams],
  )

  const openCreate = () => {
    setName('Dự án mới')
    setFps(30)
    setFrames(DEFAULT_FRAMES)
    setWithCamera(true)
    setCreateOpen(true)
  }

  const openProject = useCallback(
    (id: string) => {
      if (isValidDraftId(id)) syncQuery({ project: id })
    },
    [syncQuery],
  )

  const openUnified = useCallback((id: string) => {
    if (isValidDraftId(id)) syncQuery({ unified: id })
  }, [syncQuery])

  const closeStudio = useCallback(() => {
    syncQuery(null)
  }, [syncQuery])

  const create = async () => {
    const id = await createUnifiedProject({ name, fps, frames, withCamera })
    if (!id) return
    setCreateOpen(false)
    try { window.localStorage.setItem(`bbs-new-project:${id}`, '1') } catch { /* The first-workspace preference is optional. */ }
    openUnified(id)
  }

  const closeCreate = () => {
    if (busy) return
    setCreateOpen(false)
  }

  return (
    <>
      <main className="wb">
        <header className="wb-hero">
          <div className="wb-hero-top">
            <p className="wb-kicker">Topview · Scene3D Studio</p>
            <div className="wb-hero-actions">
              <LanguageMenu />
              <button type="button" className="wb-cta" onClick={() => openCreate()} disabled={busy}>
                <PlusIcon />{vi ? 'Tạo dự án' : 'Create project'}</button>
            </div>
          </div>
          <h1 className="wb-title">{vi ? 'Dự án của bạn' : 'Your projects'}</h1>
          <p className="wb-sub">{vi ? 'Mở dự án gần đây hoặc tạo dự án mới để bắt đầu.' : 'Open a recent project or create one to get started.'}</p>
        </header>
        <WorkspaceNavigationSlot />

        {error &&<div className="wb-error">{error}</div>}

        <section className="wb-section wb-recent-projects">
          <div className="wb-section-head"><h2>{vi ? 'Dự án gần đây' : 'Recent projects'}</h2><span className="wb-count">{unifiedProjects.length}</span></div>
          {unifiedProjects.length > 0 ? <div className="wb-grid">{unifiedProjects.map((project) => <DraftCard key={project.id} draft={project} deletable={false} onOpen={openUnified} />)}</div> : <div className="wb-project-empty"><strong>{vi ? 'Chưa có dự án nào' : 'No projects yet'}</strong><span>{vi ? 'Tạo dự án đầu tiên để bắt đầu chuẩn hóa model và dựng cảnh.' : 'Create your first project to standardize a model and build a scene.'}</span><button type="button" className="wb-cta" onClick={() => openCreate()} disabled={busy}><PlusIcon />{vi ? 'Tạo dự án' : 'Create project'}</button></div>}
        </section>

        {projects.length > 0 && <details className="wb-other-projects"><summary>{vi ? 'Dự án khác' : 'Other projects'} <span className="wb-count">{projects.length}</span></summary>
          <section className="wb-section"><div className="wb-section-head"><h2>{t('CLI 项目')}</h2><span className="wb-count">{projects.length}</span></div><div className="wb-grid">{projects.map((project) => <DraftCard key={project.id} draft={project} onOpen={openProject} />)}</div></section>
        </details>}

        {createOpen && (
          <CreateDialog
            busy={busy}
            name={name}
            fps={fps}
            frames={frames}
            withCamera={withCamera}
            error={error}
            onName={setName}
            onFps={setFps}
            onFrames={setFrames}
            onCamera={setWithCamera}
            onClose={closeCreate}
            title={vi ? 'Tạo dự án' : 'Create project'}
            submitLabel={vi ? 'Tạo và mở' : 'Create and open'}
            onSubmit={() => void create()}
          />
        )}
      </main>
      {editingId ? <StudioOverlay documentId={editingId} onClose={closeStudio} /> : null}
      {projectId ? <StudioOverlay documentId={projectId} source="project" onClose={closeStudio} /> : null}
      {unifiedId ? <StudioOverlay documentId={unifiedId} source="unified" onClose={closeStudio} /> : null}
    </>
  )
}
