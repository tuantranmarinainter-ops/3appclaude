import { randomUUID } from 'node:crypto'
import { readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { UnifiedProject } from '@bbs/animation-workspace-shared'
import { loadShotExport } from './shotExchange'
import { sha256, unzipPackage, validateResult } from './shotPackage'

function draftPath(projectId: string, shotId: string) {
  return path.join(path.resolve(process.env.BBS_UNIFIED_PROJECTS_DIR?.trim() || path.join(process.cwd(), 'unified-projects')), projectId, '.shots', `${shotId}.draft.zip`)
}

async function checkDraft(project: UnifiedProject, shotId: string, bytes: Uint8Array) {
  // loadShotExport validates both IDs and the authoritative source package before any path is used.
  const base = await loadShotExport(project.projectId, shotId)
  if (base.saved.sourceRevision !== project.revision) throw Object.assign(new Error('Exported shot revision is stale'), { code: 'REVISION_CONFLICT' })
  const issues = validateResult(unzipPackage(bytes), base.files)
  if (issues.length) throw new TypeError(JSON.stringify(issues))
}

/** Persist an editor draft without replacing any scene clip; return/import remains its own transaction. */
export async function saveShotDraft(project: UnifiedProject, shotId: string, bytes: Uint8Array) {
  await checkDraft(project, shotId, bytes)
  const file = draftPath(project.projectId, shotId), temporary = `${file}.${randomUUID()}.tmp`
  try { await writeFile(temporary, bytes, { flag: 'wx' }); await rename(temporary, file) }
  finally { await rm(temporary, { force: true }) }
  return { shotId, sha256: sha256(bytes), byteLength: bytes.byteLength, sourceRevision: project.revision }
}

export async function readShotDraft(project: UnifiedProject, shotId: string) {
  await loadShotExport(project.projectId, shotId)
  const bytes = await readFile(draftPath(project.projectId, shotId))
  await checkDraft(project, shotId, bytes)
  return bytes
}
