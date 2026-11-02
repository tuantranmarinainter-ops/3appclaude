import { readFile, readdir, rm } from 'node:fs/promises'
import path from 'node:path'

/** B64: old exported ZIP packages pile up in `<project>\.jobs\<jobId>\files\`. Keep the newest per film name. */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export interface ZipJobRow { jobId: string; name: string; sizeBytes: number; updatedAt: string; keep: boolean }
export interface ZipCleanupPlan { jobs: ZipJobRow[]; removeCount: number; freedBytes: number }

const projectsRoot = () => path.resolve(process.env.BBS_UNIFIED_PROJECTS_DIR?.trim() || path.join(process.cwd(), 'unified-projects'))

export async function planProjectZipCleanup(projectId: string): Promise<ZipCleanupPlan> {
  if (!UUID.test(projectId)) throw new TypeError('Invalid project')
  const folder = path.join(projectsRoot(), projectId, '.jobs')
  const rows: ZipJobRow[] = []
  for (const entry of await readdir(folder, { withFileTypes: true }).catch(() => [])) {
    if (!entry.isDirectory() || entry.isSymbolicLink() || !UUID.test(entry.name)) continue
    try {
      const record = JSON.parse(await readFile(path.join(folder, entry.name, 'job.json'), 'utf8')) as { jobId?: string; projectId?: string; type?: string; state?: string; updatedAt?: string; createdAt?: string; result?: { files?: Array<{ name?: string; mimeType?: string; sizeBytes?: number }> } }
      // Only finished film packages; running jobs and other kinds of job (render, normalization, shots) are never touched.
      if (record.jobId !== entry.name || record.projectId !== projectId || record.state !== 'succeeded' || !['film.export', 'film.series.export'].includes(record.type ?? '')) continue
      const zip = record.result?.files?.find((file) => file.mimeType === 'application/zip' && typeof file.name === 'string')
      if (!zip) continue
      rows.push({ jobId: entry.name, name: zip.name!, sizeBytes: Number(zip.sizeBytes) || 0, updatedAt: record.updatedAt ?? record.createdAt ?? '', keep: true })
    } catch { /* Unreadable job record: leave it alone. */ }
  }
  const newest = new Map<string, ZipJobRow>()
  for (const row of rows) {
    const key = row.name.toLowerCase(), prior = newest.get(key)
    if (!prior || row.updatedAt > prior.updatedAt || (row.updatedAt === prior.updatedAt && row.jobId > prior.jobId)) newest.set(key, row)
  }
  for (const row of rows) row.keep = newest.get(row.name.toLowerCase()) === row
  rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  const old = rows.filter((row) => !row.keep)
  return { jobs: rows, removeCount: old.length, freedBytes: old.reduce((sum, row) => sum + row.sizeBytes, 0) }
}

/** Removes the whole job folder of every superseded package (same as the automatic job pruning does). */
export async function applyProjectZipCleanup(projectId: string): Promise<{ removed: string[]; freedBytes: number }> {
  const plan = await planProjectZipCleanup(projectId)
  const removed: string[] = []
  let freed = 0
  for (const row of plan.jobs.filter((item) => !item.keep)) {
    await rm(path.join(projectsRoot(), projectId, '.jobs', row.jobId), { recursive: true, force: true })
    removed.push(row.jobId); freed += row.sizeBytes
  }
  return { removed, freedBytes: freed }
}
