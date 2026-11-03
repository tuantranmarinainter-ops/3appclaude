import { createHash } from 'node:crypto'
import { lstat, rmdir, unlink } from 'node:fs/promises'
import path from 'node:path'
import {
  assertSafePath, assetRelativePath, canonicalGameDir, isLoggedAsset, readInstallLog, removeLoggedFile, withGameLock, writeInstallLog, worldDir,
  type InstallLog,
} from './bbsInstall'
import { listWorldFilms, remainingFilmIndex, type WorldFilm } from './bbsWorldFilms'

/** B64 "Dọn phim cũ": delete chosen W01 films and only the assets that no remaining film (any world, any install) needs. */

export interface CleanupFilmRow { name: string; relPath: string; sizeBytes: number; modifiedAt: string; installId?: string; packageName?: string; installedAt?: string }
export interface CleanupPlan {
  world: string
  films: Array<{ relPath: string; sizeBytes: number }>
  assets: Array<{ path: string; sizeBytes: number }>
  freedBytes: number
  /** Films that could not be read; while any exist, no asset is deleted (their references are unknown). */
  unreadable: string[]
  token: string
}

export const FILM_NAME = /^[^\\/:\0<>"|?*]+\.dat$/i

function loggedOwners(log: InstallLog) {
  const owners = new Map<string, { installId: string; packageName: string; installedAt: string }>()
  for (const entry of log.installs) if (!entry.uninstalledAt) for (const file of entry.ownedFiles) owners.set(file.path, { installId: entry.installId, packageName: entry.packageName, installedAt: entry.installedAt })
  return owners
}

async function sizeOf(root: string, logged: string): Promise<number | null> {
  try {
    const target = path.resolve(root, ...logged.split('/'))
    await assertSafePath(root, target, false)
    const info = await lstat(target)
    return info.isFile() && !info.isSymbolicLink() ? info.size : null
  } catch { return null }
}

/** Films of one world, newest first, marking the ones W01 installed (only those may be deleted here). */
export async function listCleanupFilms(gameDir: string, worldName: string): Promise<{ films: CleanupFilmRow[]; foreign: CleanupFilmRow[] }> {
  const root = await canonicalGameDir(gameDir)
  await worldDir(root, worldName)
  const owners = loggedOwners(await readInstallLog(root))
  const { films } = await listWorldFilms(root, worldName)
  const row = (film: WorldFilm): CleanupFilmRow => ({ name: film.name, relPath: film.relPath, sizeBytes: film.sizeBytes, modifiedAt: new Date(film.mtimeMs).toISOString(), ...owners.get(film.relPath) })
  const sorted = [...films].sort((a, b) => b.mtimeMs - a.mtimeMs).map(row)
  return { films: sorted.filter((item) => item.installId), foreign: sorted.filter((item) => !item.installId) }
}

async function buildPlan(root: string, log: InstallLog, worldName: string, names: readonly string[]): Promise<CleanupPlan> {
  const owners = loggedOwners(log)
  const chosen = [...new Set(names)]
  const films: CleanupPlan['films'] = []
  const exclude = new Set<string>()
  for (const name of chosen) {
    if (!FILM_NAME.test(name)) throw new TypeError('Tên phim không hợp lệ')
    const relPath = `saves/${worldName}/bbs/films/${name}`
    if (!owners.has(relPath)) throw new TypeError(`Phim ${name} không do W01 cài; không xoá ở đây`)
    const size = await sizeOf(root, relPath)
    if (size === null) continue
    films.push({ relPath, sizeBytes: size })
    exclude.add(path.resolve(root, ...relPath.split('/')))
  }
  const index = await remainingFilmIndex(root, exclude)
  const assets: CleanupPlan['assets'] = []
  if (!index.unreadable.length) {
    for (const [logged] of owners) {
      if (!isLoggedAsset(logged) || index.isReferenced(assetRelativePath(logged))) continue
      const size = await sizeOf(root, logged)
      if (size !== null) assets.push({ path: logged, sizeBytes: size })
    }
  }
  const freedBytes = films.reduce((sum, item) => sum + item.sizeBytes, 0) + assets.reduce((sum, item) => sum + item.sizeBytes, 0)
  const token = createHash('sha256').update(JSON.stringify([worldName, films, assets])).digest('hex')
  return { world: worldName, films, assets, freedBytes, unreadable: index.unreadable, token }
}

export async function planFilmCleanup(gameDir: string, worldName: string, names: readonly string[]): Promise<CleanupPlan> {
  const root = await canonicalGameDir(gameDir)
  await worldDir(root, worldName)
  return buildPlan(root, await readInstallLog(root), worldName, names)
}

async function pruneEmptyAssetDirs(root: string, removedAssets: readonly string[]): Promise<void> {
  const assetsRoot = path.join(root, 'config', 'bbs', 'assets')
  const folders = new Set<string>()
  for (const logged of removedAssets) {
    for (let folder = path.dirname(path.resolve(root, ...logged.split('/'))); folder.length > assetsRoot.length && folder.startsWith(assetsRoot + path.sep); folder = path.dirname(folder)) folders.add(folder)
  }
  for (const folder of [...folders].sort((a, b) => b.length - a.length)) {
    try { await assertSafePath(root, folder, false); await rmdir(folder) } catch { /* Not empty or already gone. */ }
  }
}

export interface CleanupResult { removedFilms: string[]; removedAssets: string[]; preserved: string[]; freedBytes: number }

/** `token` is the plan the user confirmed; a changed game folder makes it stale instead of deleting something unseen. */
export async function applyFilmCleanup(gameDir: string, worldName: string, names: readonly string[], token: string): Promise<CleanupResult> {
  const root = await canonicalGameDir(gameDir)
  await worldDir(root, worldName)
  return withGameLock(root, async () => {
    const log = await readInstallLog(root)
    const plan = await buildPlan(root, log, worldName, names)
    if (plan.token !== token) throw Object.assign(new Error('Nội dung game đã đổi sau khi xem trước; hãy xem trước lại.'), { status: 409 })
    const removedFilms: string[] = [], removedAssets: string[] = [], preserved: string[] = []
    let freed = 0
    // Films were ticked and confirmed by the user, so a film BBS re-saved since the install is removed too.
    for (const film of plan.films) {
      try {
        const target = path.resolve(root, ...film.relPath.split('/'))
        await assertSafePath(root, target, false)
        const info = await lstat(target)
        if (!info.isFile() || info.isSymbolicLink()) { preserved.push(film.relPath); continue }
        await unlink(target); removedFilms.push(film.relPath); freed += info.size
      } catch { preserved.push(film.relPath) }
    }
    // Re-read what is actually left before touching any asset (a film that failed to delete still needs its models).
    const index = await remainingFilmIndex(root)
    const logged = new Map<string, { path: string; sha256: string }>()
    for (const entry of log.installs) if (!entry.uninstalledAt) for (const file of entry.ownedFiles) logged.set(file.path, file)
    for (const asset of plan.assets) {
      const file = logged.get(asset.path)
      if (!file || index.isReferenced(assetRelativePath(asset.path))) continue
      if (await removeLoggedFile(root, file)) { removedAssets.push(asset.path); freed += asset.sizeBytes } else preserved.push(asset.path)
    }
    const gone = new Set([...removedFilms, ...removedAssets])
    const now = new Date().toISOString()
    for (const entry of log.installs) {
      if (entry.uninstalledAt) continue
      entry.ownedFiles = entry.ownedFiles.filter((file) => !gone.has(file.path))
      if (!entry.ownedFiles.length) { entry.uninstalledAt = now; entry.preservedFiles = [] }
    }
    // An install left with only shared assets (its films are gone) hands them to the newest active install, so a later
    // "Gỡ" of that one can still clean them up. Removal stays guarded by film references either way.
    for (const entry of log.installs) {
      if (entry.uninstalledAt || entry.ownedFiles.some((file) => !isLoggedAsset(file.path))) continue
      const heir = log.installs.filter((row) => !row.uninstalledAt && row !== entry && row.ownedFiles.some((file) => !isLoggedAsset(file.path))).sort((a, b) => b.installedAt.localeCompare(a.installedAt))[0]
      if (!heir) continue
      heir.ownedFiles.push(...entry.ownedFiles); entry.ownedFiles = []; entry.uninstalledAt = now; entry.preservedFiles = []
    }
    await writeInstallLog(root, log)
    await pruneEmptyAssetDirs(root, removedAssets)
    return { removedFilms, removedAssets, preserved, freedBytes: freed }
  })
}
