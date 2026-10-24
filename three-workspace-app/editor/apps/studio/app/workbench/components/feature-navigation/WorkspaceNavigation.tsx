'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { usePathname, useSearchParams } from 'next/navigation'
import { WORKSPACES, workspaceHref, type WorkspaceId, type WorkspaceUrls } from './workspaceNavigationModel'
import './workspace-navigation.css'

const missingHint: Record<Exclude<WorkspaceId, 'scene' | 'library'>, string> = {
  normalize: 'Chưa cấu hình NEXT_PUBLIC_RETARGET_WORKBENCH_URL',
  animation: 'Chưa cấu hình NEXT_PUBLIC_ANIMATION_STUDIO_URL',
  vfx: 'Chưa cấu hình NEXT_PUBLIC_VFX_URL',
}

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
  const unified = search.get('unified')

  useEffect(() => {
    const ownedHost = document.createElement('div')
    ownedHost.className = 'workspace-navigation-host'
    const place = () => {
      const overlayHost = document.getElementById('studio-workspace-navigation')
      const header = document.querySelector('.wb-hero, .studio-shell-content > main > h1')
      if (overlayHost) {
        ownedHost.remove()
        setHost(overlayHost)
      } else if (header) {
        if (header.nextElementSibling !== ownedHost) header.after(ownedHost)
        setHost(ownedHost)
      } else {
        ownedHost.remove()
        setHost(null)
      }
    }
    place()
    const observer = new MutationObserver(place)
    observer.observe(document.body, { childList: true, subtree: true })
    return () => { observer.disconnect(); ownedHost.remove() }
  }, [pathname])
  useEffect(() => {
    const update = () => {
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
        const href = workspaceHref(workspace.id, urls, unified)
        const current = workspace.id === active
        const hint = !href && workspace.id !== 'scene' && workspace.id !== 'library'
          ? missingHint[workspace.id]
          : undefined
        return <li key={workspace.id}>
          {href
            ? <a href={href} aria-current={current ? 'page' : undefined} className={current ? 'is-active' : undefined}>
                <span aria-hidden="true">{workspace.number}</span>{workspace.label}
              </a>
            : <span className={`is-disabled${current ? ' is-active' : ''}`} aria-current={current ? 'page' : undefined} aria-disabled="true" title={hint}>
                <span aria-hidden="true">{workspace.number}</span>{workspace.label}<small>{hint}</small>
              </span>}
        </li>
      })}
    </ol>
  </nav>, host)
}
