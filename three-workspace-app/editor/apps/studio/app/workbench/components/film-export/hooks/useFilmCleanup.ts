import { useState } from 'react'
import { ensureUnifiedSession } from '../../../../../src/unifiedApi'
import type { CleanupFilmRow, CleanupPlan, CleanupResult } from '../../../../../src/bbsFilmCleanup'

export interface ZipPlan { removeCount: number; freedBytes: number }

async function call<T>(url: string, body: unknown, vi: boolean): Promise<T> {
  await ensureUnifiedSession()
  const send = () => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  let response = await send()
  if (response.status === 401) { await ensureUnifiedSession(true); response = await send() }
  const data = await response.json() as T & { error?: { message?: string } }
  if (!response.ok) throw new Error(data.error?.message ?? (vi ? `Yêu cầu lỗi (${response.status})` : `Request failed (${response.status})`))
  return data
}

export const formatMiB = (bytes: number) => bytes < 1024 * 1024 ? `${Math.max(1, Math.ceil(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`

/** B64: "Dọn phim cũ" (films + unreferenced assets in the game) and "Xoá gói ZIP cũ" (project job folder). */
export function useFilmCleanup(vi: boolean, gameDir: string, worldName: string, projectId: string, refreshInstall: () => Promise<unknown>) {
  const [films, setFilms] = useState<CleanupFilmRow[]>([])
  const [foreign, setForeign] = useState<CleanupFilmRow[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [plan, setPlan] = useState<CleanupPlan | null>(null)
  const [gameRunning, setGameRunning] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const [zipPlan, setZipPlan] = useState<ZipPlan | null>(null)

  const guard = async (work: () => Promise<void>) => {
    if (busy) return
    setBusy(true); setError('')
    try { await work() } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); setStatus('') } finally { setBusy(false) }
  }
  const body = (action: string, extra: object = {}) => ({ action, gameDir, worldName, ...extra })

  const load = () => guard(async () => {
    if (!gameDir.trim() || !worldName) throw new Error(vi ? 'Chọn thư mục game và world ở bước 1.' : 'Choose the game folder and world in step 1.')
    const data = await call<{ films: CleanupFilmRow[]; foreign: CleanupFilmRow[]; gameRunning: boolean | null }>('/api/unified/bbs-install/cleanup', body('list'), vi)
    setFilms(data.films); setForeign(data.foreign); setGameRunning(data.gameRunning); setSelected([]); setPlan(null); setStatus('')
  })

  const toggle = (relPath: string, on: boolean) => { setPlan(null); setSelected((prev) => on ? [...new Set([...prev, relPath])] : prev.filter((item) => item !== relPath)) }

  const preview = () => guard(async () => {
    const names = selected.map((item) => item.split('/').pop()!)
    const data = await call<{ plan: CleanupPlan; gameRunning: boolean | null }>('/api/unified/bbs-install/cleanup', body('plan', { films: names }), vi)
    setPlan(data.plan); setGameRunning(data.gameRunning)
  })

  const apply = () => guard(async () => {
    if (!plan) return
    const mb = formatMiB(plan.freedBytes)
    if (!window.confirm(vi ? `Sẽ xoá ${plan.films.length} phim, ${plan.assets.length} file, giải phóng ${mb}. Không hoàn tác được. Xoá?` : `Delete ${plan.films.length} films and ${plan.assets.length} files, freeing ${mb}. This cannot be undone. Continue?`)) return
    const data = await call<{ result: CleanupResult }>('/api/unified/bbs-install/cleanup', body('apply', { films: plan.films.map((item) => item.relPath.split('/').pop()), token: plan.token }), vi)
    const r = data.result
    setStatus(vi ? `Đã xoá ${r.removedFilms.length} phim, ${r.removedAssets.length} file · giải phóng ${formatMiB(r.freedBytes)}${r.preserved.length ? ` · giữ lại ${r.preserved.length} file đã bị sửa/không xoá được` : ''}` : `Removed ${r.removedFilms.length} films, ${r.removedAssets.length} files · freed ${formatMiB(r.freedBytes)}`)
    setPlan(null); setSelected([])
    await refreshInstall()
    const next = await call<{ films: CleanupFilmRow[]; foreign: CleanupFilmRow[]; gameRunning: boolean | null }>('/api/unified/bbs-install/cleanup', body('list'), vi)
    setFilms(next.films); setForeign(next.foreign)
  })

  const previewZips = () => guard(async () => {
    const data = await call<{ plan: ZipPlan }>(`/api/unified/projects/${projectId}/zip-cleanup`, { action: 'plan' }, vi)
    setZipPlan(data.plan)
    setStatus(data.plan.removeCount ? '' : (vi ? 'Không có gói ZIP cũ nào để xoá.' : 'No old ZIP packages to delete.'))
  })

  const applyZips = () => guard(async () => {
    if (!zipPlan?.removeCount) return
    if (!window.confirm(vi ? `Xoá ${zipPlan.removeCount} gói ZIP cũ trong project, giải phóng ${formatMiB(zipPlan.freedBytes)}? Mỗi phim giữ gói mới nhất.` : `Delete ${zipPlan.removeCount} old ZIP packages (${formatMiB(zipPlan.freedBytes)})? The newest per film is kept.`)) return
    const data = await call<{ result: { removed: string[]; freedBytes: number } }>(`/api/unified/projects/${projectId}/zip-cleanup`, { action: 'apply' }, vi)
    setStatus(vi ? `Đã xoá ${data.result.removed.length} gói ZIP cũ · giải phóng ${formatMiB(data.result.freedBytes)}` : `Deleted ${data.result.removed.length} ZIP packages · freed ${formatMiB(data.result.freedBytes)}`)
    setZipPlan(null)
  })

  return { films, foreign, selected, toggle, plan, gameRunning, busy, error, status, zipPlan, load, preview, apply, previewZips, applyZips }
}
