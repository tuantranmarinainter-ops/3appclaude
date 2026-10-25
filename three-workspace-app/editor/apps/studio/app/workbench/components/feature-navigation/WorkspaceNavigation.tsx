'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { usePathname, useSearchParams } from 'next/navigation'
import { QUICK_NORMALIZE_LABEL, WORKSPACES, workspaceHref, workspaceProjectListHint, type WorkspaceId, type WorkspaceUrls } from './workspaceNavigationModel'
import './workspace-navigation.css'

/** Where a page wants the 5-workspace bar. Rendered only after the page hydrated, so the portal never adds DOM React did not expect. */
export function WorkspaceNavigationSlot() {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  return mounted ? <div id="studio-workspace-navigation" className="workspace-navigation-host" /> : null
}

export function WorkspaceNavigation({ urls }: { urls: WorkspaceUrls }) {
  const pathname = usePathname()
  const search = useSearchParams()
  const routeActive: WorkspaceId = pathname.startsWith('/library') ? 'library'
    : search.get('workspace') === 'retarget' ? 'normalize'
      : search.get('workspace') === 'animation' ? 'animation' : 'scene'
  const [active, setActive] = useState<WorkspaceId>(routeActive)
  const [host, setHost] = useState<HTMLElement | null>(null)
  const [unifiedOpen, setUnifiedOpen] = useState(false)
  const unified = search.get('unified')

  useEffect(() => {
    const place = () => setHost(document.querySelector<HTMLElement>('.wb-unified-shell #studio-workspace-navigation') ?? document.getElementById('studio-workspace-navigation'))
    place()
    const observer = new MutationObserver(place)
    observer.observe(document.body, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [pathname])
  useEffect(() => {
    const update = () => {
      setUnifiedOpen(document.body.classList.contains('wb-unified-open'))
      const workspace = document.body.dataset.bbsWorkspace
      setActive(pathname.startsWith('/library') ? 'library' : workspace === 'retarget' ? 'normalize'
        : workspace === 'animation' ? 'animation' : workspace === 'scene' ? 'scene' : routeActive)
    }
    update()
    window.addEventListener('bbs-workspace-change', update)
    return () => window.removeEventListener('bbs-workspace-change', update)
  }, [pathname, routeActive])

  if (!host) return null
  return createPortal(<nav className="workspace-navigation" aria-label="5 workspace">
    <ol>
      {WORKSPACES.map((workspace) => {
        const internal = unifiedOpen && (workspace.id === 'normalize' || workspace.id === 'scene' || workspace.id === 'animation')
        const current = workspace.id === active
        const hint = internal ? null : workspaceProjectListHint(workspace.id, urls)
        return <li key={workspace.id}>
          {internal
            ? <button type="button" aria-current={current ? 'page' : undefined} className={current ? 'is-active' : undefined}
                title={workspace.id === 'normalize' ? 'Công cụ chuẩn hoá nhanh (V9.12) của Studio, không phải App 1 Workbench' : undefined}
                onClick={() => window.dispatchEvent(new CustomEvent('bbs-workspace-request', { detail: { workspace: workspace.id === 'normalize' ? 'retarget' : workspace.id } }))}>
                <span aria-hidden="true">{workspace.number}</span>{workspace.id === 'normalize' ? QUICK_NORMALIZE_LABEL : workspace.label}
              </button>
            : <a href={workspaceHref(workspace.id, urls, unified)} aria-current={current ? 'page' : undefined} className={current ? 'is-active' : undefined}
                title={hint ?? undefined}>
                <span aria-hidden="true">{workspace.number}</span>{workspace.label}{hint ? <small>{hint}</small> : null}
              </a>}
        </li>
      })}
    </ol>
  </nav>, host)
}
