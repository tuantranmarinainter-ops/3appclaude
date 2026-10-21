import type { CommandEnvelope, CommandSuccess, HistorySummary, UnifiedProject } from '@bbs/animation-workspace-shared'

// Same-origin iframe context publication. No selected-character inference and no credentials.
declare global { interface Window { __bbsApp3Projects?: Record<string, UnifiedProject> } }
function publishApp3Project(project: UnifiedProject) {
  if (typeof window === 'undefined') return
  const projects = window.__bbsApp3Projects ??= {}
  projects[project.projectId] = project
  window.dispatchEvent(new CustomEvent('bbs-app3-project', { detail: { projectId: project.projectId } }))
}

let sessionPromise: Promise<void> | null = null

export function ensureUnifiedSession(force = false): Promise<void> {
  if (sessionPromise && !force) return sessionPromise
  sessionPromise = fetch('/api/unified/session', { method: 'POST', cache: 'no-store' }).then((response) => {
    if (!response.ok) throw new Error(`Could not establish local session (${response.status})`)
  }).catch((error) => { sessionPromise = null; throw error })
  return sessionPromise
}

export async function loadUnifiedProject(projectId: string): Promise<{ project: UnifiedProject; history: HistorySummary }> {
  await ensureUnifiedSession()
  let response = await fetch(`/api/unified/projects/${encodeURIComponent(projectId)}`, { cache: 'no-store' })
  if (response.status === 401) { await ensureUnifiedSession(true); response = await fetch(`/api/unified/projects/${encodeURIComponent(projectId)}`, { cache: 'no-store' }) }
  if (!response.ok) throw new Error(`Project load failed (${response.status})`)
  const body = await response.json() as { project: UnifiedProject; history: HistorySummary }
  publishApp3Project(body.project)
  return body
}

export async function loadUnifiedProjects<T>(): Promise<T> {
  await ensureUnifiedSession()
  let response = await fetch('/api/unified/projects', { cache: 'no-store' })
  if (response.status === 401) { await ensureUnifiedSession(true); response = await fetch('/api/unified/projects', { cache: 'no-store' }) }
  if (!response.ok) throw new Error(`Project list failed (${response.status})`)
  return response.json() as Promise<T>
}

export async function sendUnifiedCommand(envelope: CommandEnvelope): Promise<CommandSuccess> {
  await ensureUnifiedSession()
  const init: RequestInit = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(envelope),
  }
  let response = await fetch('/api/unified/commands', init)
  if (response.status === 401) { await ensureUnifiedSession(true); response = await fetch('/api/unified/commands', init) }
  const body = await response.json() as CommandSuccess | { error?: { code?: string; message?: string } }
  if (!response.ok || !('ok' in body) || body.ok !== true) {
    const failure = body as { error?: { code?: string; message?: string } }
    throw new Error(failure.error?.message ?? failure.error?.code ?? `Command failed (${response.status})`)
  }
  return body
}

export interface UnifiedJobFile { id: string; name: string; mimeType: string; sizeBytes: number; sha256: string }
export interface UnifiedJobView {
  jobId: string
  state: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'
  sourceRevision: number
  progress: number
  result?: { files: UnifiedJobFile[]; provenance: Record<string, unknown>; warnings: string[]; blockedRequests: string[] }
  error?: { code: string; message: string }
}

export async function loadUnifiedJob(projectId: string, jobId: string): Promise<UnifiedJobView> {
  await ensureUnifiedSession()
  const url = `/api/unified/projects/${encodeURIComponent(projectId)}/jobs/${encodeURIComponent(jobId)}`
  let response = await fetch(url, { cache: 'no-store' })
  if (response.status === 401) { await ensureUnifiedSession(true); response = await fetch(url, { cache: 'no-store' }) }
  const body = await response.json() as { job?: UnifiedJobView; error?: string }
  if (!response.ok || !body.job) throw new Error(body.error ?? `Job lookup failed (${response.status})`)
  return body.job
}

export async function loadUnifiedJobFile(projectId: string, jobId: string, fileId: string): Promise<Blob> {
  await ensureUnifiedSession()
  const url = `/api/unified/projects/${encodeURIComponent(projectId)}/jobs/${encodeURIComponent(jobId)}/files/${encodeURIComponent(fileId)}`
  let response = await fetch(url, { cache: 'no-store' })
  if (response.status === 401) { await ensureUnifiedSession(true); response = await fetch(url, { cache: 'no-store' }) }
  if (!response.ok) throw new Error(`Render file download failed (${response.status})`)
  return response.blob()
}

export async function uploadUnifiedAsset(file: File): Promise<{ uploadId: string; name: string; sha256: string; byteLength: number }> {
  await ensureUnifiedSession()
  const send = () => fetch('/api/unified/uploads', {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name) },
    body: file,
  })
  let response = await send()
  if (response.status === 401) { await ensureUnifiedSession(true); response = await send() }
  const body = await response.json() as { uploadId?: string; name?: string; sha256?: string; byteLength?: number; error?: { message?: string } }
  if (!response.ok || !body.uploadId || !body.name || !body.sha256 || typeof body.byteLength !== 'number') throw new Error(body.error?.message ?? `Asset upload failed (${response.status})`)
  return body as { uploadId: string; name: string; sha256: string; byteLength: number }
}
