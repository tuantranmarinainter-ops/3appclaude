'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { loadUnifiedProject } from '../../unifiedApi'
import { useStudioLocale } from '../localePreference'

type DiagnosticReport = {
  createdAt: string
  page: string
  health?: unknown
  project?: {
    id: string
    name: string
    revision: number
    counts: { assets: number; characters: number; motions: number; bindings: number; cameras: number }
    assets: Array<{ id: string; name: string; kind: string; sha256: string; skeletons: Array<{ family: string; fingerprint: string; unit: number }> }>
    frame: number
    fps: number
  }
  errors: string[]
}

export function DiagnosticsPanel() {
  const vi = useStudioLocale() === 'vi'
  const [report, setReport] = useState<DiagnosticReport | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const running = useRef(false)
  const projectId = typeof window === 'undefined' ? '' : new URLSearchParams(window.location.search).get('unified') ?? ''

  const refresh = useCallback(async () => {
    if (running.current) return
    running.current = true
    setBusy(true)
    setError('')
    const errors: string[] = []
    const next: DiagnosticReport = { createdAt: new Date().toISOString(), page: window.location.origin, errors }
    try {
      const response = await fetch('/api/unified/health', { cache: 'no-store' })
      if (!response.ok) throw new Error(`Health check HTTP ${response.status}`)
      next.health = await response.json()
    } catch (failure) {
      errors.push(`health: ${failure instanceof Error ? failure.message : String(failure)}`)
    }
    if (projectId) {
      try {
        const { project } = await loadUnifiedProject(projectId)
        const cameras = project.scene.content.nodes.filter((node) => node.type === 'camera').length
        next.project = {
          id: project.projectId, name: project.name, revision: project.revision,
          counts: { assets: Object.keys(project.assets).length, characters: Object.keys(project.characters).length, motions: Object.keys(project.motions).length, bindings: Object.keys(project.bindings).length, cameras },
          assets: Object.values(project.assets).map((asset) => ({
            id: asset.id, name: asset.displayName, kind: asset.kind, sha256: asset.source.sha256,
            skeletons: Object.values(project.skeletons).filter((profile) => profile.provenance.original.sha256 === asset.source.sha256)
              .map((profile) => ({ family: profile.family, fingerprint: profile.fingerprint, unit: profile.metersPerUnit })),
          })),
          frame: project.scene.content.timeline.frameStart, fps: project.scene.content.timeline.fps,
        }
      } catch (failure) {
        errors.push(`project: ${failure instanceof Error ? failure.message : String(failure)}`)
      }
    } else {
      errors.push('project: no unified project is open')
    }
    setReport(next)
    setError(errors.join('\n'))
    running.current = false
    setBusy(false)
  }, [projectId])

  useEffect(() => { void refresh() }, [refresh])

  function download() {
    if (!report) return
    const blob = new Blob([`${JSON.stringify(report, null, 2)}\n`], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `bbs-diagnostics-${report.project?.id ?? 'app'}-${Date.now()}.json`
    link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 0)
  }

  return <div className="studio-devtools-upload">
    <p className="studio-devtools-hint">{vi ? 'Kiểm tra dịch vụ cục bộ và dự án hiện tại. Báo cáo chỉ gồm cấu trúc dự án, phiên bản và SHA-256; không chứa model, cookie hoặc thông tin xác thực.' : 'Check local services and the current project. The report contains project structure, versions, and SHA-256 only; it excludes model files, cookies, and credentials.'}</p>
    {report?.project && <ul className="studio-devtools-results">
      <li data-status="ok"><strong>{report.project.name} · r{report.project.revision}</strong><span>{vi ? 'Nhân vật' : 'Characters'} {report.project.counts.characters} · {vi ? 'Animation' : 'Motions'} {report.project.counts.motions} · {vi ? 'Liên kết' : 'Bindings'} {report.project.counts.bindings} · {vi ? 'Camera' : 'Cameras'} {report.project.counts.cameras}</span></li>
    </ul>}
    {error && <pre className="studio-devtools-error" role="alert">{error}</pre>}
    <div className="studio-devtools-row">
      <button type="button" className="studio-devtools-primary" onClick={() => void refresh()} disabled={busy}>{busy ? (vi ? 'Đang kiểm tra…' : 'Checking…') : (vi ? 'Kiểm tra lại' : 'Check again')}</button>
      <button type="button" className="studio-devtools-primary" onClick={download} disabled={!report}>{vi ? 'Tải báo cáo JSON' : 'Download JSON report'}</button>
    </div>
    {report && <details><summary>{vi ? 'Xem nội dung báo cáo' : 'View report'}</summary><pre>{JSON.stringify(report, null, 2)}</pre></details>}
  </div>
}
