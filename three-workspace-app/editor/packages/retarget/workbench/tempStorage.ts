import { randomBytes } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, posix, win32 } from 'node:path'

export const DEFAULT_RETENTION_DAYS = 7
export const SESSION_LOCK = '.session-lock.json'
const SESSION_NAME = /^(?:session-)?[a-z0-9]+-[a-f0-9]{8}$/

type Platform = 'win32' | 'posix'
type CleanupOptions = { now?: number; retentionDays?: number; isProcessRunning?: (pid: number) => boolean }

/** Resolve with the selected platform implementation so Windows drive paths can be covered on non-Windows CI. */
export function resolveWorkbenchTempRoot(options: { configured?: string; tempDir?: string; cwd?: string; platform?: Platform } = {}): string {
  const platform = options.platform ?? (process.platform === 'win32' ? 'win32' : 'posix')
  const path = platform === 'win32' ? win32 : posix
  const configured = options.configured?.trim().replace(/^(?:"(.*)"|'(.*)')$/, '$1$2')
  if (configured) return path.join(path.resolve(options.cwd ?? process.cwd(), configured), 'w01-workbench')
  return path.join(options.tempDir ?? tmpdir(), 'w01-workbench')
}

export function retentionDays(value = process.env.W01_WORKBENCH_RETENTION_DAYS): number {
  if (value === undefined || value.trim() === '') return DEFAULT_RETENTION_DAYS
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 3650) throw new Error('W01_WORKBENCH_RETENTION_DAYS must be an integer from 0 to 3650')
  return parsed
}

export function processIsRunning(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    // A zombie still answers signal 0 on Linux but can no longer own a Workbench session.
    if (process.platform === 'linux') {
      try {
        const stat = readFileSync(`/proc/${pid}/stat`, 'utf8'), state = stat.slice(stat.lastIndexOf(') ') + 2, stat.lastIndexOf(') ') + 3)
        if (state === 'Z' || state === 'X') return false
      } catch { /* process may have exited between checks */ }
    }
    return true
  } catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM' }
}

function lockPid(sessionDir: string): number | null {
  try {
    const value = JSON.parse(readFileSync(join(sessionDir, SESSION_LOCK), 'utf8'))
    return Number.isInteger(value.pid) && value.pid > 0 ? value.pid : null
  } catch { return null }
}

/** Remove only recognizable, expired session folders whose PID lock is absent or stale. */
export function cleanupStaleSessions(root: string, options: CleanupOptions = {}) {
  const now = options.now ?? Date.now(), days = options.retentionDays ?? retentionDays()
  const isRunning = options.isProcessRunning ?? processIsRunning
  const cutoff = now - days * 24 * 60 * 60 * 1000
  let removedSessions = 0, freedBytes = 0
  if (!existsSync(root)) return { removedSessions, freedBytes }
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !SESSION_NAME.test(entry.name)) continue
    const sessionDir = join(root, entry.name)
    let stat
    try { stat = statSync(sessionDir) } catch { continue }
    if (stat.mtimeMs > cutoff) continue
    const pid = lockPid(sessionDir)
    if (pid !== null && isRunning(pid)) continue
    const bytes = directorySize(sessionDir)
    try { rmSync(sessionDir, { recursive: true, force: true }); removedSessions++; freedBytes += bytes } catch { /* retried on a later cleanup */ }
  }
  return { removedSessions, freedBytes }
}

export function createSession(root: string, now = Date.now()): string {
  mkdirSync(root, { recursive: true })
  const sessionDir = join(root, `session-${now.toString(36)}-${cryptoRandomSuffix()}`)
  mkdirSync(join(sessionDir, 'uploads'), { recursive: true })
  mkdirSync(join(sessionDir, 'runs'), { recursive: true })
  writeFileSync(join(sessionDir, SESSION_LOCK), JSON.stringify({ pid: process.pid, startedAt: new Date(now).toISOString() }) + '\n', { flag: 'wx' })
  return sessionDir
}

function cryptoRandomSuffix(): string {
  // Kept local to avoid coupling callers to the session naming scheme.
  return randomBytes(4).toString('hex')
}

export function directorySize(path: string): number {
  let total = 0
  let entries
  try { entries = readdirSync(path, { withFileTypes: true }) } catch { return 0 }
  for (const entry of entries) {
    const child = join(path, entry.name)
    try {
      if (entry.isDirectory()) total += directorySize(child)
      else if (entry.isFile()) total += lstatSync(child).size
    } catch { /* file changed while measuring */ }
  }
  return total
}
