#!/usr/bin/env node
/** Sequential folder wrapper around normalize.ts; run from editor/packages/builder so tsx resolves. */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

type Status = 'PASS' | 'FAIL' | 'BLOCKED' | 'ERROR' | 'SKIPPED'
interface Entry {
  path: string; stem: string; sha256: string | null; status: Status; exitCode: number | null
  actions: number; warnings: string[]; elapsedMs: number; error: string | null
}
interface Manifest { source?: { sha256?: string }; actions?: unknown[] }
interface Report { status?: string; error?: string; quality?: { warnings?: Array<{ code: string }> } }
const statuses: Status[] = ['PASS', 'FAIL', 'BLOCKED', 'ERROR', 'SKIPPED']
const extensions = new Set(['.glb', '.gltf', '.fbx', '.bobj'])
const cliPath = join(dirname(fileURLToPath(import.meta.url)), 'normalize.ts')
const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8'))
const lastLine = (text: string) => text.trim().split(/\r?\n/).filter(Boolean).at(-1) ?? ''
const message = (error: unknown) => error instanceof Error ? error.message : String(error)

/** Resolve existing ancestors too, so a symlink cannot put output back inside the source tree. */
function canonical(path: string): string {
  if (existsSync(path)) return realpathSync(path)
  const parent = dirname(path)
  return parent === path ? path : join(canonical(parent), basename(path))
}

function collect(dir: string, recursive: boolean): string[] {
  const files: string[] = []
  for (const item of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, item.name)
    if (item.isDirectory() && recursive) files.push(...collect(path, true))
    else if (item.isFile() && extensions.has(extname(item.name).toLowerCase())) files.push(path)
  }
  return files
}

function main(): number {
  const args = process.argv.slice(2), separator = args.indexOf('--')
  const forwarded = separator < 0 ? [] : args.slice(separator + 1)
  const { values } = parseArgs({ args: separator < 0 ? args : args.slice(0, separator), options: {
    'src-dir': { type: 'string' }, target: { type: 'string' }, out: { type: 'string' },
    recursive: { type: 'boolean', default: false }, 'skip-existing': { type: 'boolean', default: false }, armature: { type: 'string' },
  } })
  if (!values['src-dir'] || !values.target || !values.out) throw new Error('--src-dir, --target and --out are required')
  const sourceDir = realpathSync(resolve(values['src-dir'])), outDir = canonical(resolve(values.out))
  const inside = relative(sourceDir, outDir)
  if (!inside || (!isAbsolute(inside) && inside !== '..' && !inside.startsWith(`..${sep}`))) {
    throw new Error('--out must be outside --src-dir')
  }
  if (!statSync(sourceDir).isDirectory()) throw new Error('--src-dir must be a directory')
  const target = resolve(values.target), armature = values.armature ? resolve(values.armature) : undefined
  const relativePath = (path: string) => relative(sourceDir, path).split(sep).join('/')
  const files = collect(sourceDir, values.recursive!).sort((a, b) => relativePath(a) < relativePath(b) ? -1 : relativePath(a) > relativePath(b) ? 1 : 0)
  mkdirSync(outDir, { recursive: true })
  const used = new Set<string>(), entries: Entry[] = []
  for (const [index, source] of files.entries()) {
    const started = performance.now(), originalStem = basename(source, extname(source))
    let stem = originalStem, suffix = 2
    // Case-folding also keeps destinations distinct on Windows filesystems.
    while (used.has(stem.toLowerCase())) stem = `${originalStem}-${suffix++}`
    used.add(stem.toLowerCase())
    const destination = join(outDir, stem), manifestPath = join(destination, `${stem}.manifest.json`)
    const entry: Entry = { path: relativePath(source), stem, sha256: null, status: 'ERROR', exitCode: null, actions: 0, warnings: [], elapsedMs: 0, error: null }
    let staging: string | undefined
    try {
      entry.sha256 = createHash('sha256').update(readFileSync(source)).digest('hex')
      let existing: Manifest | undefined
      if (values['skip-existing'] && existsSync(manifestPath)) {
        // A damaged manifest is not a cache hit: regenerate it instead of failing the batch.
        try { existing = readJson<Manifest>(manifestPath) } catch { /* regenerate */ }
      }
      if (existing?.source?.sha256 === entry.sha256) {
        entry.status = 'SKIPPED'
        entry.actions = Array.isArray(existing.actions) ? existing.actions.length : 0
        try { entry.warnings = readJson<Report>(join(destination, `${stem}.report.json`)).quality?.warnings?.map((item) => item.code) ?? [] } catch { /* optional report */ }
      } else {
        mkdirSync(destination, { recursive: true })
        // Invalidate the old cache before running; a failed rerun must not leave a stale manifest.
        rmSync(manifestPath, { force: true })
        staging = mkdtempSync(join(destination, '.normalize-'))
        // Managed paths come last so forwarded flags cannot redirect writes into the source tree.
        const child = spawnSync(process.execPath, ['--import', 'tsx', cliPath, ...forwarded,
          '--src', source, '--target', target, '--out', staging,
          ...(extname(source).toLowerCase() === '.bobj' && armature ? ['--armature', armature] : []),
        ], { cwd: process.cwd(), encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
        entry.exitCode = child.status
        let report: Report | undefined
        const reportPath = join(staging, `${originalStem}.report.json`), newManifestPath = join(staging, `${originalStem}.manifest.json`)
        if (existsSync(reportPath)) report = readJson<Report>(reportPath)
        const manifest = existsSync(newManifestPath) ? readJson<Manifest>(newManifestPath) : undefined
        entry.actions = Array.isArray(manifest?.actions) ? manifest.actions.length : 0
        entry.warnings = report?.quality?.warnings?.map((item) => item.code) ?? []
        if (child.error || child.signal || report?.error) entry.status = 'ERROR'
        else if (child.status === 0 && report?.status === 'PASS' && manifest) entry.status = 'PASS'
        else if (child.status === 2) entry.status = 'BLOCKED'
        else if (child.status === 1 && report?.status === 'FAIL') entry.status = 'FAIL'
        else entry.status = 'ERROR'
        if (entry.status === 'ERROR') entry.error = lastLine(child.stderr || child.stdout) || report?.error || (child.error ? message(child.error) : `normalize.ts exited ${child.status} (${child.signal ?? 'missing or inconsistent output'})`)
        // normalize.ts names artifacts after the source. Promote them under the allocated batch stem.
        for (const name of readdirSync(staging)) {
          if (name.startsWith(`${originalStem}.`)) renameSync(join(staging, name), join(destination, `${stem}${name.slice(originalStem.length)}`))
        }
      }
    } catch (error) { entry.status = 'ERROR'; entry.error = lastLine(message(error)) }
    finally { if (staging) rmSync(staging, { recursive: true, force: true }) }
    entry.elapsedMs = Math.round(performance.now() - started)
    entries.push(entry)
    console.log(`[${index + 1}/${files.length}] ${entry.status} ${JSON.stringify(entry.path)} -> ${JSON.stringify(stem)} (${entry.elapsedMs}ms)`)
  }
  const totals = Object.fromEntries(statuses.map((status) => [status, entries.filter((entry) => entry.status === status).length])) as Record<Status, number>
  writeFileSync(join(outDir, 'summary.json'), JSON.stringify({ sourceDir, outDir, entries, totals }, null, 2) + '\n')
  const columns = ['path', 'stem', 'sha256', 'status', 'exitCode', 'actions', 'warnings', 'elapsedMs', 'error'] as const
  const cell = (value: unknown) => String(value ?? '').replace(/\t/g, '\\t').replace(/\r/g, '\\r').replace(/\n/g, '\\n')
  // The final comment carries totals without pretending to be another input file.
  const tsv = [columns.join('\t'), ...entries.map((entry) => columns.map((key) => cell(key === 'warnings' ? entry.warnings.join(',') : entry[key])).join('\t')),
    `# totals\t${statuses.map((status) => `${status}=${totals[status]}`).join('\t')}`]
  writeFileSync(join(outDir, 'summary.tsv'), tsv.join('\n') + '\n')
  return totals.FAIL || totals.ERROR ? 1 : totals.BLOCKED ? 2 : 0
}

try { process.exitCode = main() } catch (error) { console.error(`normalizeBatch: ${message(error)}`); process.exitCode = 1 }
