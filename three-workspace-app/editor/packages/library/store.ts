import { randomUUID } from 'node:crypto'
import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import {
  LIBRARY_VERSION, type CharacterMetadata, type LibraryConfig, type LibraryIndex,
  type MotionPackMetadata,
} from './types'

const LOCK_TIMEOUT_MS = 10_000
const STALE_LOCK_MS = 5 * 60_000
const waitCell = new Int32Array(new SharedArrayBuffer(4))

export function defaultLibraryPath(platform = process.platform, home = homedir()): string {
  return platform === 'win32' ? 'C:\\w01-library' : join(home, 'w01-library')
}

export function resolveLibraryPath(options: { root?: string; repositoryRoot?: string } = {}): string {
  const configured = options.root?.trim() || process.env.W01_LIBRARY?.trim() || defaultLibraryPath()
  if (!isAbsolute(configured)) throw new Error('Library root must be an absolute path')
  const root = resolve(configured)
  if (!isAbsolute(root)) throw new Error('Library root must be an absolute path')
  if (options.repositoryRoot && isAtOrBelow(root, resolve(options.repositoryRoot))) {
    throw new Error('Library root must be outside the repository')
  }
  return root
}

function isAtOrBelow(candidate: string, parent: string): boolean {
  const rel = relative(parent, candidate)
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
}

export function safeId(value: string, label: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value)) throw new Error(`${label} must contain 1-64 ASCII letters, digits, underscores or hyphens`)
  return value
}

export function safeChild(root: string, ...segments: string[]): string {
  const rootPath = canonicalFuture(root)
  const result = resolve(root, ...segments)
  if (!isAtOrBelow(canonicalFuture(result), rootPath)) throw new Error('Path escapes library root')
  return result
}

function canonicalFuture(path: string): string {
  let existing = resolve(path)
  const suffix: string[] = []
  while (!existsSync(existing)) {
    const parent = dirname(existing)
    if (parent === existing) break
    suffix.unshift(basename(existing))
    existing = parent
  }
  return resolve(realpathSync(existing), ...suffix)
}

export function readJsonFile<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T
}

export function writeJsonAtomic(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`
  const descriptor = openSync(temporary, 'wx')
  try {
    writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
    fsyncSync(descriptor)
  } finally { closeSync(descriptor) }
  try { renameSync(temporary, path) }
  catch (error) { rmSync(temporary, { force: true }); throw error }
}

function acquireLock(path: string): string {
  const started = Date.now(), token = `${process.pid}:${randomUUID()}`
  while (Date.now() - started < LOCK_TIMEOUT_MS) {
    try {
      const fd = openSync(path, 'wx')
      try { writeFileSync(fd, JSON.stringify({ token, createdAt: Date.now() })); fsyncSync(fd) }
      finally { closeSync(fd) }
      return token
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      try {
        const age = Date.now() - statSync(path).mtimeMs
        if (age > STALE_LOCK_MS) {
          let pid: number | undefined
          try { pid = Number(readJsonFile<{ token: string }>(path).token.split(':', 1)[0]) } catch { /* treat corrupt stale locks as expired */ }
          let ownerAlive = false
          if (Number.isSafeInteger(pid) && pid! > 0) {
            try { process.kill(pid!, 0); ownerAlive = true }
            catch (processError) { ownerAlive = (processError as NodeJS.ErrnoException).code === 'EPERM' }
          }
          if (!ownerAlive) { rmSync(path, { force: true }); continue }
        }
      } catch { continue }
      Atomics.wait(waitCell, 0, 0, 25)
    }
  }
  throw new Error('Timed out waiting for animation library index lock')
}

export function withLibraryLock<T>(root: string, operation: () => T): T {
  mkdirSync(root, { recursive: true })
  const lockPath = safeChild(root, '.index.lock')
  const token = acquireLock(lockPath)
  try { return operation() }
  finally {
    try {
      const current = readJsonFile<{ token?: string }>(lockPath)
      if (current.token === token) rmSync(lockPath, { force: true })
    } catch { /* A removed or replaced lock is owned by another process. */ }
  }
}

export function initializeLibrary(root: string): LibraryConfig {
  mkdirSync(root, { recursive: true })
  for (const folder of ['packs', 'rigs', 'characters', 'models']) mkdirSync(safeChild(root, folder), { recursive: true })
  const configPath = safeChild(root, 'library.json')
  if (!existsSync(configPath)) writeJsonAtomic(configPath, { version: LIBRARY_VERSION, rigs: [] } satisfies LibraryConfig)
  const raw = readJsonFile<{ version: string; rigs: string[] }>(configPath)
  if (!['1.0.0', LIBRARY_VERSION].includes(raw.version) || !Array.isArray(raw.rigs) || raw.rigs.some((rig) => typeof rig !== 'string')) {
    throw new Error(`Unsupported or invalid library configuration at ${configPath}`)
  }
  const config: LibraryConfig = { version: LIBRARY_VERSION, rigs: raw.rigs }
  if (raw.version === '1.0.0') writeJsonAtomic(configPath, config)
  return config
}

export function writeIndex(root: string): LibraryIndex {
  const packsRoot = safeChild(root, 'packs')
  const packs: MotionPackMetadata[] = []
  for (const entry of readdirSync(packsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^[a-f0-9]{16}$/.test(entry.name)) continue
    const metaPath = safeChild(packsRoot, entry.name, 'meta.json')
    if (!existsSync(metaPath)) continue
    const meta = readJsonFile<MotionPackMetadata>(metaPath)
    if (meta.kind === 'motion-pack' && meta.packId === entry.name) packs.push(meta)
  }
  const characters = readCharacters(root)
  const index: LibraryIndex = {
    version: 1,
    generatedAt: new Date().toISOString(),
    packs: packs.map(({ packId, rig, createdAt, license, boundCharacter }) => ({ packId, rig, createdAt, license, boundCharacter })),
    actions: packs.flatMap((pack) => pack.actions.map((action) => ({ ...action, packId: pack.packId, rig: pack.rig,
      createdAt: pack.createdAt, licenseId: pack.license.id, licenseSource: pack.license.source, boundCharacter: pack.boundCharacter }))),
    characters: characters.map((character) => ({ ...character, actionCount: character.actions?.length ?? packs.reduce((count, pack) => count + (pack.boundCharacter === character.charId ? pack.actions.length : 0), 0) })),
  }
  writeJsonAtomic(safeChild(root, 'index.json'), index)
  return index
}

export function readCharacters(root: string): CharacterMetadata[] {
  const directory = safeChild(root, 'characters')
  if (!existsSync(directory)) return []
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (!entry.isDirectory()) return []
    const metaPath = safeChild(directory, entry.name, 'meta.json')
    if (!existsSync(metaPath)) return []
    const meta = readJsonFile<CharacterMetadata>(metaPath)
    return meta.kind === 'character' && meta.charId === entry.name ? [meta] : []
  })
}

export function validateRelativeAssetPath(value: string): string {
  if (!value || value.includes('\\') || value.startsWith('/') || /^[A-Za-z]:/.test(value)) throw new Error('Asset path must be a relative POSIX path')
  const parts = value.split('/')
  if (parts.some((part) => !part || part === '.' || part === '..')) throw new Error('Asset path contains an unsafe path segment')
  return value
}

export function ensureRegularFile(path: string): void {
  const info = lstatSync(path)
  if (info.isSymbolicLink()) throw new Error(`${basename(path)} must not be a symbolic link`)
  if (!info.isFile()) throw new Error(`${basename(path)} must be a regular file`)
  // The size check also prevents accidentally indexing device-like or unexpectedly huge inputs.
  if (!Number.isSafeInteger(info.size) || info.size < 0) throw new Error(`${basename(path)} has an invalid size`)
}
