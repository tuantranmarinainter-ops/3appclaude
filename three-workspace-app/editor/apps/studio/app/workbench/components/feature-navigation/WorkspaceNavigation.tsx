'use client'

import { useEffect, useState } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { WORKSPACES, workspaceHref, type WorkspaceId, type WorkspaceUrls } from './workspaceNavigation'
import './workspace-navigation.css'

const missingHint: Record<Exclude<WorkspaceId, 'scene' | 'library'>, string> = {
  normalize: 'Chưa cấu hình NEXT_PUBLIC_RETARGET_WORKBENCH_URL',
  animation: 'Chưa cấu hình NEXT_PUBLIC_ANIMATION_STUDIO_URL',
  vfx: 'Chưa cấu hình NEXT_PUBLIC_VFX_URL',
}

export function WorkspaceNavigation({ urls }: { urls: WorkspaceUrls }) {
  const pathname = usePathname()
  const search = useSearchParams()
  const routeActive: WorkspaceId = pathname.startsWith('/library') ? 'library'
    : search.get('workspace') === 'retarget' ? 'normalize'
      : search.get('workspace') === 'animation' ? 'animation' : 'scene'
  const [active, setActive] = useState<WorkspaceId>(routeActive)
  const unified = search.get('unified')

  useEffect(() => setActive(routeActive), [routeActive])
  useEffect(() => {
    const update = (event: Event) => {
      const workspace = (event as CustomEvent<{ workspace?: string }>).detail?.workspace
      if (pathname.startsWith('/library')) return
      setActive(workspace === 'retarget' ? 'normalize' : workspace === 'animation' ? 'animation' : 'scene')
    }
    window.addEventListener('bbs-workspace-change', update)
    return () => window.removeEventListener('bbs-workspace-change', update)
  }, [pathname])

  return <nav className="workspace-navigation" aria-label="5 workspace">
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
            : <span className="is-disabled" aria-disabled="true" title={hint}>
                <span aria-hidden="true">{workspace.number}</span>{workspace.label}<small>{hint}</small>
              </span>}
        </li>
      })}
    </ol>
  </nav>
}
