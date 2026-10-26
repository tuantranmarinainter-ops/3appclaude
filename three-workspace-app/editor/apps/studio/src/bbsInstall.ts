import { assertBbsEffectsDestination, normalizeBbsGameDir } from './bbsGameCapabilities'
import { createHash, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { createReadStream } from 'node:fs'
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, lstat, writeFile, unlink, rename } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const MAX_ZIP_BYTES = 128 * 1024 * 1024
const PLAN_TTL_MS = 30 * 60 * 1000
const ZIP_SCAN_SCRIPT = String.raw`
import hashlib,json,pathlib,stat,sys,unicodedata,zipfile,zlib
archive=pathlib.Path(sys.argv[1]); out=pathlib.Path(sys.argv[2]); out.mkdir(parents=True,exist_ok=False)
max_entries=4096; max_total=256*1024*1024; total=0; seen=set(); kinds={}; selected=[]; requires_effects=False
devices={'con','prn','aux','nul','conin$','conout$'}
for info in zipfile.ZipFile(archive).infolist():
    raw=info.filename
    if not raw or chr(92) in raw or raw.startswith('/') or '\x00' in raw or any(ord(c)<32 for c in raw): raise ValueError('Unsafe ZIP member path')
    is_dir=info.is_dir(); name=raw[:-1] if is_dir else raw
    parts=name.split('/')
    if not name or any(p in ('','.','..') for p in parts): raise ValueError('Unsafe ZIP member path')
    for part in parts:
        normalized=unicodedata.normalize('NFC',part)
        stem=normalized.rstrip(' .').split('.')[0].casefold()
        if ':' in part or normalized.endswith(('.', ' ')) or stem in devices or stem in {f'{prefix}{number}' for prefix in ('com','lpt') for number in (*range(1,10),'¹','²','³')}:
            raise ValueError('Unsafe Windows ZIP member path')
    key=unicodedata.normalize('NFC',name).casefold()
    if key in seen: raise ValueError('Case-insensitive ZIP member collision')
    seen.add(key)
    unix_mode=(info.external_attr >> 16) & 0o170000
    allowed=(0,stat.S_IFDIR) if is_dir else (0,stat.S_IFREG)
    if unix_mode not in allowed: raise ValueError('ZIP contains a symlink or special file')
    if info.flag_bits & 1: raise ValueError('Encrypted ZIP members are not supported')
    if len(seen)>max_entries: raise ValueError('ZIP contains too many entries')
    total += info.file_size
    if info.file_size < 0 or total>max_total: raise ValueError('ZIP expands beyond the installation limit')
    for i in range(1,len(parts)):
        prefix='/'.join(parts[:i]); prior=kinds.get(prefix)
        if prior == 'file': raise ValueError('ZIP file is used as a parent directory')
        kinds[prefix]='dir'
    kind='dir' if is_dir else 'file'
    if kinds.get(name) and kinds[name] != kind: raise ValueError('ZIP path collides with a file and directory')
    kinds[name]=kind
    selected_file=(name.startswith('assets/') and not is_dir) or (name.startswith('films/') and len(parts)==2 and parts[0]=='films' and parts[1].endswith('.dat') and not is_dir)
    if not is_dir and name=='required-mods.json':
        if info.file_size>65536: raise ValueError('Mod requirements exceed limit')
        requirements=json.loads(zipfile.ZipFile(archive).read(info))
        if not isinstance(requirements,dict): raise ValueError('Invalid mod requirements')
        requires_effects=requires_effects or bool(requirements.get('includedEffectCount',0)) or any('AAA' in str(item) for item in requirements.get('requiredMods',[]))
    if selected_file:
        target=out.joinpath(*parts)
        target.parent.mkdir(parents=True,exist_ok=True)
        h=hashlib.sha256(); size=0
        with zipfile.ZipFile(archive).open(info) as source, target.open('xb') as destination:
            while True:
                block=source.read(1024*1024)
                if not block: break
                size+=len(block); h.update(block); destination.write(block)
                if size>info.file_size or size>max_total: raise ValueError('ZIP member expands beyond its declared size')
        if size != info.file_size: raise ValueError('ZIP member size changed during extraction')
        if name.startswith('assets/effeks/'): requires_effects=True
        if name.startswith('films/'):
            payload=target.read_bytes()
            # BBS films may be gzip/zlib compressed. Bound decompression independently of ZIP size.
            if payload[:2]==b'\x1f\x8b' or (len(payload)>1 and payload[0]==0x78):
                decoder=zlib.decompressobj(47); payload=decoder.decompress(payload,max_total+1)
                if len(payload)>max_total or decoder.unconsumed_tail: raise ValueError('Film expands beyond inspection limit')
            if b'bbs:aaa_particle' in payload: requires_effects=True
        selected.append({'name':name,'sizeBytes':size,'sha256':h.hexdigest()})
if not selected: raise ValueError('ZIP contains no assets/** or films/*.dat files')
print(json.dumps({'files':selected,'requiresEffects':requires_effects},separators=(',',':')))
`

export interface InstallWorld { name: string }
export interface InstallPlanFile { source: string; target: string; sizeBytes: number; sha256: string; status: 'install' | 'skip' | 'conflict' }
export interface InstallPlan { planId: string; packageName: string; packageSha256: string; gameDir: string; worldName: string; files: InstallPlanFile[]; expiresAt: string }
interface InternalPlan extends InstallPlan { requiresEffects: boolean; stagingRoot: string; expiresMs: number }
interface LogFile { path: string; sha256: string }
interface InstallLogEntry { installId: string; installedAt: string; packageName: string; packageSha256: string; ownedFiles: LogFile[]; uninstalledAt?: string; preservedFiles?: string[] }
interface InstallLog { version: 1; installs: InstallLogEntry[] }
type GlobalPlans = typeof globalThis & { __bbsInstallPlans?: Map<string, InternalPlan> }
const plans = (globalThis as GlobalPlans).__bbsInstallPlans ??= new Map()
type GlobalLocks = typeof globalThis & { __bbsInstallLocks?: Map<string, Promise<void>> }
const locks = (globalThis as GlobalLocks).__bbsInstallLocks ??= new Map()

const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
async function fileDigest(file: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer)
  return hash.digest('hex')
}
const isInside = (root: string, candidate: string) => candidate !== root && candidate.startsWith(root.endsWith(path.sep) ? root : `${root}${path.sep}`)
const python = () => process.env.BBS_PYTHON?.trim() || (process.platform === 'win32' ? 'python' : 'python3')

function runPython(script: string, args: string[], maxOutput = 2 * 1024 * 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(python(), ['-c', script, ...args], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = '', stderr = '', exceeded = false
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8'); if (Buffer.byteLength(stdout) > maxOutput) { exceeded = true; child.kill() } })
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8'); if (Buffer.byteLength(stderr) > 1024 * 1024) child.kill() })
    child.once('error', reject)
    child.once('close', (code) => {
      if (exceeded) reject(new Error('ZIP metadata exceeds the installation limit'))
      else if (code !== 0) reject(new Error(stderr.trim().split(/\r?\n/).at(-1) || 'Could not inspect the ZIP package'))
      else resolve(stdout)
    })
  })
}

function validWorldName(value: string): boolean {
  return !!value && value !== '.' && value !== '..' && !/[\\/:\0<>"|?*]/.test(value) && !/[ .]$/.test(value) &&
    !/^(con|prn|aux|nul|conin\$|conout\$|com[1-9¹²³]|lpt[1-9¹²³])(?:\..*)?$/i.test(value)
}

async function canonicalGameDir(gameDir: string): Promise<string> {
  gameDir = (await normalizeBbsGameDir(gameDir)).gameDir
  if (typeof gameDir !== 'string' || !gameDir.trim() || gameDir.includes('\0')) throw new TypeError('Enter the BBS FS game folder')
  const root = await realpath(path.resolve(gameDir.trim()))
  if (!(await stat(root)).isDirectory()) throw new TypeError('The game folder is not a directory')
  return root
}

async function withGameLock<T>(root: string, action: () => Promise<T>): Promise<T> {
  const previous = locks.get(root) ?? Promise.resolve()
  let release!: () => void
  const held = new Promise<void>((resolve) => { release = resolve })
  const queued = previous.catch(() => undefined).then(() => held)
  locks.set(root, queued)
  await previous.catch(() => undefined)
  try { return await action() }
  finally { release(); if (locks.get(root) === queued) locks.delete(root) }
}

function safePackageName(value: string | undefined, fallback: string): string {
  const name = (value?.trim() ? value : fallback).replace(/.*[\\/]/, '').trim()
  if (!name || name.length > 160 || /[\0\r\n]/.test(name)) throw new TypeError('Invalid package name')
  return name
}

async function assertSafePath(root: string, target: string, allowMissing: boolean): Promise<void> {
  const resolved = path.resolve(target)
  if (!isInside(root, resolved)) throw new TypeError('Install path escaped the selected game folder')
  const relative = path.relative(root, resolved).split(path.sep).filter(Boolean)
  let cursor = root
  for (let i = 0; i < relative.length; i++) {
    cursor = path.join(cursor, relative[i]!)
    try {
      const info = await lstat(cursor)
      if (info.isSymbolicLink()) throw new TypeError('Install path contains a symbolic link or junction')
      if (i < relative.length - 1 && !info.isDirectory()) throw new TypeError('Install path parent is not a directory')
      const actual = await realpath(cursor)
      if (actual !== cursor && process.platform !== 'win32') throw new TypeError('Install path resolves through a symbolic link')
      if (!isInside(root, actual)) throw new TypeError('Install path escaped the selected game folder')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT' && allowMissing) return
      throw error
    }
  }
}

async function worldDir(root: string, worldName: string): Promise<string> {
  if (!validWorldName(worldName)) throw new TypeError('Invalid world name')
  const saves = path.join(root, 'saves')
  await assertSafePath(root, saves, false)
  const world = path.join(saves, worldName)
  await assertSafePath(root, world, false)
  const level = path.join(world, 'level.dat')
  await assertSafePath(root, level, false)
  if (!(await stat(world)).isDirectory() || !(await stat(level)).isFile()) throw new TypeError('World must contain level.dat')
  return world
}

export async function listInstallWorlds(gameDir: string): Promise<InstallWorld[]> {
  const root = await canonicalGameDir(gameDir)
  const saves = path.join(root, 'saves')
  try { await assertSafePath(root, saves, false) }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error }
  const rows: InstallWorld[] = []
  for (const entry of await readdir(saves, { withFileTypes: true })) {
    if (!entry.isDirectory() || !validWorldName(entry.name)) continue
    const candidate = path.join(saves, entry.name), level = path.join(candidate, 'level.dat')
    try {
      await assertSafePath(root, candidate, false); await assertSafePath(root, level, false)
      if ((await stat(level)).isFile()) rows.push({ name: entry.name })
    } catch { /* Ignore invalid and linked save folders. */ }
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name))
}

function cleanupExpiredPlans(): void {
  const now = Date.now()
  for (const [id, plan] of plans) if (plan.expiresMs <= now) { plans.delete(id); void rm(plan.stagingRoot, { recursive: true, force: true }) }
}

export async function planInstall(packageZip: string, gameDir: string, worldName: string, originalPackageName?: string): Promise<InstallPlan> {
  cleanupExpiredPlans()
  const root = await canonicalGameDir(gameDir)
  const world = await worldDir(root, worldName)
  const zipPath = await realpath(path.resolve(packageZip))
  const zipInfo = await stat(zipPath)
  if (!zipInfo.isFile() || zipInfo.size < 22 || zipInfo.size > MAX_ZIP_BYTES) throw new TypeError('ZIP must be between 22 bytes and 128 MiB')
  const zipBytes = await readFile(zipPath)
  if (zipBytes.byteLength > MAX_ZIP_BYTES) throw new TypeError('ZIP exceeds the 128 MiB limit')
  const packageSha256 = digest(zipBytes)
  const stagingRoot = await mkdtemp(path.join(os.tmpdir(), 'bbs-install-'))
  try {
    const stagedZip = path.join(stagingRoot, 'archive.zip')
    await writeFile(stagedZip, zipBytes, { flag: 'wx' })
    const extracted = path.join(stagingRoot, 'extracted')
    const scanned = JSON.parse(await runPython(ZIP_SCAN_SCRIPT, [stagedZip, extracted])) as { files: Array<{ name: string; sizeBytes: number; sha256: string }>; requiresEffects: boolean }
    const manifest = scanned.files
    if (scanned.requiresEffects) await assertBbsEffectsDestination(root)
    const files: InstallPlanFile[] = []
    for (const item of manifest) {
      const destinationRoot = item.name.startsWith('assets/') ? path.join(root, 'config', 'bbs', 'assets') : path.join(world, 'bbs', 'films')
      const relativeName = item.name.startsWith('assets/') ? item.name.slice('assets/'.length) : item.name.slice('films/'.length)
      if (!relativeName || relativeName.split('/').some((part) => !part || part === '.' || part === '..')) throw new TypeError('Unsafe package member path')
      const target = path.join(destinationRoot, ...relativeName.split('/'))
      await assertSafePath(root, target, true)
      let status: InstallPlanFile['status'] = 'install'
      try {
        const existing = await lstat(target)
        if (existing.isFile()) {
          await assertSafePath(root, target, false)
          status = await fileDigest(target) === item.sha256 ? 'skip' : 'conflict'
        } else status = 'conflict'
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
      files.push({ source: item.name, target: path.relative(root, target).split(path.sep).join('/'), sizeBytes: item.sizeBytes, sha256: item.sha256, status })
    }
    const planId = randomUUID(), expiresMs = Date.now() + PLAN_TTL_MS
    const plan: InternalPlan = { requiresEffects: scanned.requiresEffects, planId, packageName: safePackageName(originalPackageName, path.basename(zipPath)), packageSha256, gameDir: root, worldName, files, stagingRoot, expiresMs,
      expiresAt: new Date(expiresMs).toISOString() }
    plans.set(planId, plan)
    return publicPlan(plan)
  } catch (error) { await rm(stagingRoot, { recursive: true, force: true }); throw error }
}

function publicPlan(plan: InternalPlan): InstallPlan {
  const { requiresEffects: _requiresEffects, stagingRoot: _stagingRoot, expiresMs: _expiresMs, ...value } = plan
  return structuredClone(value)
}

function logPath(root: string): string { return path.join(root, 'config', 'bbs', 'w01-install-log.json') }

async function readInstallLog(root: string): Promise<InstallLog> {
  const file = logPath(root)
  await assertSafePath(root, file, true)
  try {
    if ((await stat(file)).size > 16 * 1024 * 1024) throw new TypeError('Install log exceeds the supported size')
    const parsed: unknown = JSON.parse(await readFile(file, 'utf8'))
    if (!parsed || typeof parsed !== 'object' || (parsed as InstallLog).version !== 1 || !Array.isArray((parsed as InstallLog).installs) || (parsed as InstallLog).installs.length > 10000) throw new TypeError('Install log has an unsupported format')
    const installs = (parsed as InstallLog).installs, ids = new Set<string>(), activeOwned = new Set<string>()
    for (const entry of installs) {
      if (!entry || typeof entry !== 'object' || !/^[0-9a-f-]{36}$/i.test(entry.installId) || ids.has(entry.installId) ||
          typeof entry.installedAt !== 'string' || !Number.isFinite(Date.parse(entry.installedAt)) || typeof entry.packageName !== 'string' || entry.packageName.length > 160 ||
          !/^[a-f0-9]{64}$/.test(entry.packageSha256) || !Array.isArray(entry.ownedFiles) || entry.ownedFiles.length > 4096 ||
          (entry.uninstalledAt !== undefined && (typeof entry.uninstalledAt !== 'string' || !Number.isFinite(Date.parse(entry.uninstalledAt)))) ||
          (entry.preservedFiles !== undefined && (!Array.isArray(entry.preservedFiles) || entry.preservedFiles.some((item) => typeof item !== 'string' || !safeOwnedPath(item))))) throw new TypeError('Install log has an unsupported format')
      safePackageName(entry.packageName, '')
      ids.add(entry.installId)
      const owned = new Set<string>()
      for (const file of entry.ownedFiles) {
        if (!file || typeof file !== 'object' || typeof file.path !== 'string' || !/^[a-f0-9]{64}$/.test(file.sha256) || !safeOwnedPath(file.path) || owned.has(file.path)) throw new TypeError('Install log contains an unsafe owned-file record')
        if (!entry.uninstalledAt && activeOwned.has(file.path)) throw new TypeError('Install log contains an overlapping active owned-file record')
        owned.add(file.path)
        if (!entry.uninstalledAt) activeOwned.add(file.path)
      }
    }
    return parsed as InstallLog
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, installs: [] }; throw error }
}

function safeOwnedPath(value: string): boolean {
  const parts = value.split('/')
  if (parts.some((part) => !part || part === '.' || part === '..' || /[\\:\0<>"|?*]/.test(part) || /[ .]$/.test(part) || /^(con|prn|aux|nul|conin\$|conout\$|com[1-9¹²³]|lpt[1-9¹²³])(?:\..*)?$/i.test(part))) return false
  if (parts[0] === 'config' && parts[1] === 'bbs' && parts[2] === 'assets' && parts.length >= 4) return true
  return parts[0] === 'saves' && validWorldName(parts[1] ?? '') && parts[2] === 'bbs' && parts[3] === 'films' && parts.length === 5 && /^[^/]+\.dat$/.test(parts[4] ?? '')
}

async function writeInstallLog(root: string, log: InstallLog): Promise<void> {
  const folder = path.dirname(logPath(root))
  await ensureSafeDirectories(root, folder)
  const file = logPath(root), temp = `${file}.${randomUUID()}.tmp`
  await assertSafePath(root, file, true)
  await writeFile(temp, `${JSON.stringify(log, null, 2)}\n`, { flag: 'wx' })
  await assertSafePath(root, temp, false)
  await rename(temp, file)
}

async function ensureSafeDirectories(root: string, target: string): Promise<void> {
  const resolved = path.resolve(target)
  if (resolved !== root && !isInside(root, resolved)) throw new TypeError('Install directory escaped the game folder')
  const parts = path.relative(root, resolved).split(path.sep).filter(Boolean)
  let cursor = root
  for (const part of parts) {
    cursor = path.join(cursor, part)
    try { await mkdir(cursor) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
    await assertSafePath(root, cursor, false)
    if (!(await stat(cursor)).isDirectory()) throw new TypeError('Install parent is not a directory')
  }
}

export async function applyInstall(planId: string): Promise<{ installId: string; installed: string[]; skipped: string[]; conflicts: string[] }> {
  cleanupExpiredPlans()
  const plan = plans.get(planId)
  if (!plan || plan.expiresMs <= Date.now()) throw Object.assign(new Error('Install preview expired; create a new preview'), { status: 410 })
  plans.delete(planId) // Claim synchronously, before any await, so duplicate apply calls cannot race.
  return withGameLock(plan.gameDir, async () => {
    const root = plan.gameDir
    const installed: string[] = [], skipped: string[] = [], conflicts: string[] = [], ownedFiles: LogFile[] = [], created: string[] = []
    try {
      if (plan.expiresMs <= Date.now()) throw Object.assign(new Error('Install preview expired; create a new preview'), { status: 410 })
      if (await canonicalGameDir(plan.gameDir) !== root) throw new TypeError('Game folder changed after preview')
      await worldDir(root, plan.worldName)
      if (plan.requiresEffects) await assertBbsEffectsDestination(root)
      const log = await readInstallLog(root)
      for (const file of plan.files) {
        const target = path.resolve(root, ...file.target.split('/'))
        await assertSafePath(root, target, true)
        const staged = path.join(plan.stagingRoot, 'extracted', ...file.source.split('/'))
        if (digest(await readFile(staged)) !== file.sha256) throw new TypeError('Prepared ZIP contents changed after preview')
        let existing: Awaited<ReturnType<typeof lstat>> | undefined
        try { existing = await lstat(target) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
        if (existing) {
          if (existing.isFile()) {
            await assertSafePath(root, target, false)
            if (await fileDigest(target) === file.sha256) skipped.push(file.target)
            else conflicts.push(file.target)
          } else conflicts.push(file.target)
          continue
        }
        if (file.target.startsWith('saves/')) await worldDir(root, plan.worldName)
        await ensureSafeDirectories(root, path.dirname(target))
        await assertSafePath(root, target, true)
        const bytes = await readFile(staged)
        try { await writeFile(target, bytes, { flag: 'wx' }) }
        catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') { conflicts.push(file.target); continue } throw error }
        created.push(target); ownedFiles.push({ path: file.target, sha256: file.sha256 }); installed.push(file.target)
      }
      const installId = randomUUID()
      log.installs.push({ installId, installedAt: new Date().toISOString(), packageName: plan.packageName, packageSha256: plan.packageSha256, ownedFiles })
      await writeInstallLog(root, log)
      return { installId, installed, skipped, conflicts }
    } catch (error) {
      for (const file of created.reverse()) {
        try { await assertSafePath(root, file, false); if (digest(await readFile(file)) === ownedFiles.find((item) => path.resolve(root, ...item.path.split('/')) === file)?.sha256) await unlink(file) } catch { /* Preserve any file whose ownership cannot be confirmed. */ }
      }
      throw error
    } finally { await rm(plan.stagingRoot, { recursive: true, force: true }) }
  })
}

export async function uninstallInstall(gameDir: string, installId: string): Promise<{ removed: string[]; preserved: string[] }> {
  if (!/^[0-9a-f-]{36}$/i.test(installId)) throw new TypeError('Invalid install record')
  const root = await canonicalGameDir(gameDir)
  return withGameLock(root, async () => {
    const log = await readInstallLog(root)
    const entry = log.installs.find((row) => row.installId === installId && !row.uninstalledAt)
    if (!entry) throw Object.assign(new Error('Install record not found'), { status: 404 })
    const removed: string[] = [], preserved: string[] = []
    for (const file of entry.ownedFiles) {
      const target = path.resolve(root, ...file.path.split('/'))
      try {
        await assertSafePath(root, target, false)
        const info = await lstat(target)
        if (!info.isFile() || info.isSymbolicLink()) { preserved.push(file.path); continue }
        await assertSafePath(root, target, false)
        if (await fileDigest(target) !== file.sha256) { preserved.push(file.path); continue }
        const verified = await lstat(target)
        if (info.dev !== verified.dev || info.ino !== verified.ino || info.size !== verified.size || info.mtimeMs !== verified.mtimeMs) { preserved.push(file.path); continue }
        await assertSafePath(root, target, false)
        await unlink(target); removed.push(file.path)
      } catch { preserved.push(file.path) }
    }
    entry.uninstalledAt = new Date().toISOString(); entry.preservedFiles = preserved
    await writeInstallLog(root, log)
    return { removed, preserved }
  })
}

export async function listInstallRecords(gameDir: string): Promise<Array<{ installId: string; installedAt: string; packageName: string; files: number }>> {
  const root = await canonicalGameDir(gameDir), log = await readInstallLog(root)
  return log.installs.filter((entry) => !entry.uninstalledAt).map((entry) => ({ installId: entry.installId, installedAt: entry.installedAt, packageName: entry.packageName, files: entry.ownedFiles.length }))
}
