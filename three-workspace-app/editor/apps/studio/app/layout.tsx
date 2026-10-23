import type { ReactNode } from 'react'
import { headers } from 'next/headers'
import '@topview/3d-builder/styles.css'
import './globals.css'
import { DevToolsDock } from '../src/devtools/DevToolsDock'
import { StudioLocaleRoot } from '../src/devtools/localePreference'
import { localeFromHeaders } from '../src/locale/server'
import { WorkspaceNavigation } from './workbench/components/feature-navigation/WorkspaceNavigation'

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = localeFromHeaders(await headers())
  const urls = {
    normalize: process.env.NEXT_PUBLIC_RETARGET_WORKBENCH_URL,
    animation: process.env.NEXT_PUBLIC_ANIMATION_STUDIO_URL,
    vfx: process.env.NEXT_PUBLIC_VFX_URL,
  }
  return (
    <html lang={locale}>
      <body>
        <StudioLocaleRoot serverLocale={locale}>
          <div className="studio-shell">
            <WorkspaceNavigation urls={urls} />
            <div className="studio-shell-content">{children}</div>
          </div>
          <DevToolsDock />
        </StudioLocaleRoot>
      </body>
    </html>
  )
}
