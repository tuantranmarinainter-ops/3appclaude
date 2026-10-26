import { useEffect, useRef, useState } from 'react'
import { ensureUnifiedSession } from '../../../../../src/unifiedApi'
import type { InstallPlan } from '../../../../../src/bbsInstall'

import type { BbsGameCapabilities } from '../../../../../src/bbsGameCapabilities'

interface InstallWorld { name: string }
interface InstallRecord { installId: string; installedAt: string; packageName: string; files: number }

async function responseBody<T>(response: Response, vi: boolean): Promise<T> {
  const body = await response.json() as T & { error?: { message?: string } }
  if (!response.ok) throw new Error(vi ? `Lỗi yêu cầu cài BBS (${response.status}): ${body.error?.message ?? 'không thể hoàn tất'}` : body.error?.message ?? `BBS install request failed (${response.status})`)
  return body
}

export function useBbsInstall(vi: boolean) {
  // NEXT_PUBLIC_BBS_GAME_DIR pre-fills the game folder on a fresh browser; a folder the user picked (localStorage) wins.
  const [gameDir, setGameDirState] = useState(() => typeof window === 'undefined' ? '' : localStorage.getItem('topview-bbs-game-dir') ?? process.env.NEXT_PUBLIC_BBS_GAME_DIR ?? '')
  const [capabilities, setCapabilities] = useState<BbsGameCapabilities | null>(null)
  const [worlds, setWorlds] = useState<InstallWorld[]>([])
  const [installs, setInstalls] = useState<InstallRecord[]>([])
  const [worldName, setWorldName] = useState('')
  const [packageFile, setPackageFile] = useState<File | null>(null)
  const [plan, setPlan] = useState<InstallPlan | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const gameDirRef = useRef(gameDir), worldRef = useRef(''), fileRef = useRef<File | null>(null)
  const inputRevision = useRef(0), refreshRevision = useRef(0)

  const invalidatePreview = () => { inputRevision.current++; setPlan(null); setStatus('') }

  const setGameDir = (value: string) => {
    gameDirRef.current = value; refreshRevision.current++
    invalidatePreview()
    setGameDirState(value); setCapabilities(null)
    if (typeof window !== 'undefined') localStorage.setItem('topview-bbs-game-dir', value)
    setWorlds([]); setInstalls([]); worldRef.current = ''; setWorldName('')
  }

  const setSelectedWorld = (value: string) => { worldRef.current = value; invalidatePreview(); setWorldName(value) }
  const setSelectedFile = (value: File | null) => { fileRef.current = value; invalidatePreview(); setPackageFile(value) }

  const refresh = async (folder = gameDir) => {
    if (!folder.trim()) throw new Error(vi ? 'Nhập thư mục game BBS FS.' : 'Enter the BBS FS game folder.')
    const revision = ++refreshRevision.current
    await ensureUnifiedSession()
    const send = () => fetch(`/api/unified/bbs-install?gameDir=${encodeURIComponent(folder)}`, { cache: 'no-store' })
    let response = await send()
    if (response.status === 401) { await ensureUnifiedSession(true); response = await send() }
    const body = await responseBody<{ worlds: InstallWorld[]; installs: InstallRecord[]; capabilities: BbsGameCapabilities }>(response, vi)
    if (revision !== refreshRevision.current || gameDirRef.current !== folder) return
    setCapabilities(body.capabilities)
    if (body.capabilities.corrected) {
      gameDirRef.current = body.capabilities.gameDir; setGameDirState(body.capabilities.gameDir)
      localStorage.setItem('topview-bbs-game-dir', body.capabilities.gameDir)
    }
    setWorlds(body.worlds); setInstalls(body.installs)
    const nextWorld = body.worlds.some((world) => world.name === worldRef.current) ? worldRef.current : body.worlds[0]?.name ?? ''
    worldRef.current = nextWorld; setWorldName(nextWorld)
  }

  useEffect(() => {
    if (!gameDir.trim()) return
    void refresh().catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)))
    // Initial read uses the saved folder; users can refresh explicitly after changing it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const loadWorlds = async () => {
    setError('')
    try { await refresh() }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
  }

  const preview = async () => {
    if (busy) return
    if (!packageFile || !packageFile.name.toLowerCase().endsWith('.zip')) { setError(vi ? 'Chọn gói ZIP trước.' : 'Choose a ZIP package first.'); return }
    if (!gameDir.trim() || !worldName) { setError(vi ? 'Chọn thư mục game và world.' : 'Choose a game folder and world.'); return }
    const revision = inputRevision.current, requestedGameDir = gameDir, requestedWorld = worldName, requestedFile = packageFile
    setBusy(true); setError(''); setStatus(vi ? 'Đang đọc gói ZIP…' : 'Reading ZIP package…'); setPlan(null)
    try {
      await ensureUnifiedSession()
      const send = () => fetch('/api/unified/bbs-install/plan', { method: 'POST', headers: {
        'Content-Type': 'application/zip', 'x-bbs-game-dir': encodeURIComponent(gameDir),
        'x-bbs-world-name': encodeURIComponent(worldName), 'x-bbs-package-name': encodeURIComponent(packageFile.name),
      }, body: packageFile })
      let response = await send()
      if (response.status === 401) { await ensureUnifiedSession(true); response = await send() }
      const body = await responseBody<{ plan: InstallPlan }>(response, vi)
      if (revision !== inputRevision.current || gameDirRef.current !== requestedGameDir || worldRef.current !== requestedWorld || fileRef.current !== requestedFile) return
      setPlan(body.plan)
      setStatus(vi ? `Đã xem trước ${body.plan.files.length} file · hết hạn ${new Date(body.plan.expiresAt).toLocaleTimeString()}` : `Preview ready · ${body.plan.files.length} files · expires ${new Date(body.plan.expiresAt).toLocaleTimeString()}`)
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); setStatus('') }
    finally { setBusy(false) }
  }

  const apply = async () => {
    if (!plan || busy) return
    if (plan.worldName !== worldName || plan.packageName !== packageFile?.name) { setPlan(null); setError(vi ? 'Thông tin đã đổi; hãy xem trước lại.' : 'Inputs changed; preview the package again.'); return }
    const count = plan.files.filter((file) => file.status === 'install').length
    if (!count) { setError(vi ? 'Không có file mới để cài.' : 'There are no new files to install.'); return }
    const confirmText = vi
      ? `Cài ${count} file từ ${plan.packageName} vào ${plan.gameDir} · world ${plan.worldName}? File khác nội dung sẽ được giữ nguyên.`
      : `Install ${count} files from ${plan.packageName} into ${plan.gameDir} · world ${plan.worldName}? Different existing files will be kept.`
    if (!window.confirm(confirmText)) return
    setBusy(true); setError(''); setStatus(vi ? 'Đang cài gói…' : 'Installing package…')
    try {
      await ensureUnifiedSession()
      const send = () => fetch('/api/unified/bbs-install/apply', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ planId: plan.planId }) })
      let response = await send()
      if (response.status === 401) { await ensureUnifiedSession(true); response = await send() }
      const body = await responseBody<{ result: { installId: string; installed: string[]; skipped: string[]; conflicts: string[] } }>(response, vi)
      setPlan(null); setPackageFile(null)
      setStatus(vi ? `Đã cài ${body.result.installed.length} · bỏ qua ${body.result.skipped.length} · xung đột ${body.result.conflicts.length}` : `Installed ${body.result.installed.length} · skipped ${body.result.skipped.length} · conflicts ${body.result.conflicts.length}`)
      await refresh()
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); setStatus('') }
    finally { setBusy(false) }
  }

  /** B27: install a finished export job directly (no ZIP picker); the button itself is the user's confirmation. */
  const installJob = async (projectId: string, jobId: string): Promise<string> => {
    const folder = gameDirRef.current, world = worldRef.current
    if (!folder.trim() || !world) throw new Error(vi ? 'Chọn thư mục game và world trong mục Cài vào game.' : 'Choose a game folder and world under Install into game.')
    setBusy(true); setError(''); setPlan(null); setStatus(vi ? 'Đang xem trước gói vừa xuất…' : 'Previewing the exported package…')
    try {
      await ensureUnifiedSession()
      const post = (url: string, body: unknown) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const call = async (url: string, body: unknown) => { let response = await post(url, body); if (response.status === 401) { await ensureUnifiedSession(true); response = await post(url, body) } return response }
      const planned = (await responseBody<{ plan: InstallPlan }>(await call('/api/unified/bbs-install/plan-job', { projectId, jobId, gameDir: folder, worldName: world }), vi)).plan
      const count = planned.files.filter((file) => file.status === 'install').length
      let message: string
      if (!count) message = vi ? `Game đã có đủ ${planned.files.length} file của gói ${planned.packageName}; không cần cài thêm.` : `The game already has all ${planned.files.length} files of ${planned.packageName}.`
      else {
        setStatus(vi ? `Đang cài ${count} file…` : `Installing ${count} files…`)
        const result = (await responseBody<{ result: { installed: string[]; skipped: string[]; conflicts: string[] } }>(await call('/api/unified/bbs-install/apply', { planId: planned.planId }), vi)).result
        message = vi
          ? `Đã cài vào world ${planned.worldName}: ${result.installed.length} file mới · bỏ qua ${result.skipped.length} · giữ nguyên ${result.conflicts.length} file khác nội dung`
          : `Installed into ${planned.worldName}: ${result.installed.length} new · skipped ${result.skipped.length} · kept ${result.conflicts.length} different files`
      }
      setStatus(message)
      await refresh(folder)
      return message
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); setStatus(''); throw cause }
    finally { setBusy(false) }
  }

  const uninstall = async (installId: string) => {
    if (busy) return
    if (!window.confirm(vi ? 'Chỉ gỡ file không thay đổi trong nhật ký cài đặt? File đã sửa sẽ được giữ.' : 'Remove only unchanged files recorded by this install? Modified files will be preserved.')) return
    setBusy(true); setError(''); setStatus(vi ? 'Đang gỡ file trong nhật ký…' : 'Removing recorded files…')
    try {
      await ensureUnifiedSession()
      const send = () => fetch('/api/unified/bbs-install/uninstall', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ gameDir, installId }) })
      let response = await send()
      if (response.status === 401) { await ensureUnifiedSession(true); response = await send() }
      const body = await responseBody<{ result: { removed: string[]; preserved: string[] } }>(response, vi)
      setStatus(vi ? `Đã gỡ ${body.result.removed.length} · giữ ${body.result.preserved.length} file đã đổi/thiếu` : `Removed ${body.result.removed.length} · preserved ${body.result.preserved.length} changed/missing files`)
      await refresh()
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); setStatus('') }
    finally { setBusy(false) }
  }

  return { capabilities, gameDir, setGameDir, worlds, installs, worldName, setWorldName: setSelectedWorld, packageFile, setPackageFile: setSelectedFile, plan, busy, error, status, refresh, loadWorlds, preview, apply, installJob, uninstall }
}
