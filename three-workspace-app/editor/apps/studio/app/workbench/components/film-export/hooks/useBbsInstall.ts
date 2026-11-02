import { useEffect, useRef, useState } from 'react'
import { ensureUnifiedSession } from '../../../../../src/unifiedApi'
import type { InstallPlan } from '../../../../../src/bbsInstall'

import type { BbsGameCapabilities } from '../../../../../src/bbsGameCapabilities'
import { GAME_DIR_KEY, pickWorld, recentGameDirs, rememberGameDir, rememberWorld } from '../../../../../src/gameFolderMemory'

const browserStore = () => typeof window === 'undefined' ? undefined : window.localStorage

interface InstallWorld { name: string }
interface InstallRecord { installId: string; installedAt: string; packageName: string; files: number }

async function responseBody<T>(response: Response, vi: boolean): Promise<T> {
  const body = await response.json() as T & { error?: { message?: string } }
  if (!response.ok) throw new Error(vi ? `Lỗi yêu cầu cài BBS (${response.status}): ${body.error?.message ?? 'không thể hoàn tất'}` : body.error?.message ?? `BBS install request failed (${response.status})`)
  return body
}

export function useBbsInstall(vi: boolean) {
  // NEXT_PUBLIC_BBS_GAME_DIR pre-fills the game folder on a fresh browser; a folder the user picked (localStorage) wins.
  const [gameDir, setGameDirState] = useState(() => { try { return browserStore()?.getItem(GAME_DIR_KEY) ?? process.env.NEXT_PUBLIC_BBS_GAME_DIR ?? '' } catch { return '' } })
  const [recentDirs, setRecentDirs] = useState<string[]>(() => recentGameDirs(browserStore()))
  const [capabilities, setCapabilities] = useState<BbsGameCapabilities | null>(null)
  /** B33: Minecraft running from this folder; null = unknown. */
  const [gameRunning, setGameRunning] = useState<boolean | null>(null)
  const [scanning, setScanning] = useState(false)
  const [scannedDir, setScannedDir] = useState('')
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
    setGameDirState(value); setCapabilities(null); setGameRunning(null); setScannedDir(''); setError('')
    setWorlds([]); setInstalls([]); worldRef.current = ''; setWorldName('')
  }

  const setSelectedWorld = (value: string) => { worldRef.current = value; invalidatePreview(); setWorldName(value); rememberWorld(browserStore(), gameDirRef.current, value) }
  const setSelectedFile = (value: File | null) => { fileRef.current = value; invalidatePreview(); setPackageFile(value) }

  const refresh = async (folder = gameDir) => {
    if (!folder.trim()) throw new Error(vi ? 'Nhập thư mục game BBS FS.' : 'Enter the BBS FS game folder.')
    const revision = ++refreshRevision.current
    await ensureUnifiedSession()
    const send = () => fetch(`/api/unified/bbs-install?gameDir=${encodeURIComponent(folder)}`, { cache: 'no-store' })
    let response = await send()
    if (response.status === 401) { await ensureUnifiedSession(true); response = await send() }
    const body = await responseBody<{ worlds: InstallWorld[]; installs: InstallRecord[]; capabilities: BbsGameCapabilities; gameRunning?: boolean | null }>(response, vi)
    if (revision !== refreshRevision.current || gameDirRef.current !== folder) return null
    setCapabilities(body.capabilities); setGameRunning(body.gameRunning ?? null)
    // B50: a sub-folder (configbs\…, saves, mods) was walked back to the game root; show and keep the root.
    const root = body.capabilities.gameDir
    if (root !== folder) { gameDirRef.current = root; setGameDirState(root) }
    setRecentDirs(rememberGameDir(browserStore(), root)); setScannedDir(root)
    setWorlds(body.worlds); setInstalls(body.installs)
    const nextWorld = pickWorld(browserStore(), root, body.worlds, worldRef.current)
    worldRef.current = nextWorld; setWorldName(nextWorld)
    return body
  }

  // B51: read worlds and mods by itself once a folder is typed, picked or remembered — no "Đọc world" click.
  useEffect(() => {
    const folder = gameDir.trim()
    if (!folder || folder === scannedDir) return
    const timer = setTimeout(() => {
      setScanning(true); setError('')
      void refresh(gameDir).catch((cause) => { if (gameDirRef.current === gameDir) setError(cause instanceof Error ? cause.message : String(cause)) })
        .finally(() => setScanning(false))
      // Long enough that a half-typed path is not walked back to its parent while the user is still typing.
    }, 1000)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameDir, scannedDir])

  const loadWorlds = async () => {
    setError(''); setScanning(true)
    try { await refresh() }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setScanning(false) }
  }

  /** B50: native folder dialog on this computer. */
  const chooseFolder = async () => {
    setError('')
    try {
      await ensureUnifiedSession()
      const send = () => fetch('/api/unified/bbs-install/choose-folder', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ initial: gameDirRef.current }) })
      let response = await send()
      if (response.status === 401) { await ensureUnifiedSession(true); response = await send() }
      const body = await responseBody<{ path: string | null }>(response, vi)
      if (body.path) setGameDir(body.path)
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
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
    setBusy(true); setError(''); setPlan(null); setStatus(vi ? 'Đang kiểm tra game…' : 'Checking the game…')
    try {
      // B33: re-check right before writing; BBS has crashed when a Film appeared while its Film panel was open.
      const fresh = await refresh(folder)
      if (fresh?.gameRunning && !window.confirm(vi
        ? 'Minecraft đang chạy từ thư mục game này. Cài film lúc game mở có thể làm BBS bị lỗi.\n\nNên thoát world (hoặc đóng bảng Film trong BBS) rồi bấm Xuất lại.\n\nVẫn cài ngay?'
        : 'Minecraft is running from this game folder. Installing now can crash BBS.\n\nLeave the world (or close the BBS Film panel) and export again.\n\nInstall anyway?')) {
        throw new Error(vi ? 'Chưa cài vì game đang chạy. Gói đã xuất vẫn được giữ; thoát world rồi cài lại.' : 'Not installed because the game is running. The exported package is kept.')
      }
      setStatus(vi ? 'Đang xem trước gói vừa xuất…' : 'Previewing the exported package…')
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

  return { capabilities, gameDir, setGameDir, recentDirs, chooseFolder, gameRunning, scanning, scanned: !!scannedDir && scannedDir === gameDir, worlds, installs, worldName, setWorldName: setSelectedWorld, packageFile, setPackageFile: setSelectedFile, plan, busy, error, status, refresh, loadWorlds, preview, apply, installJob, uninstall }
}
