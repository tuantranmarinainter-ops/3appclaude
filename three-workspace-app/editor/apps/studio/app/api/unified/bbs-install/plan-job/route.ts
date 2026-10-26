import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { planInstall } from '../../../../../src/bbsInstall'
import { readUnifiedJobFile } from '../../../../../src/unifiedJobs'
import { validateLocalRequest } from '../../../../../src/unifiedSession'

export const runtime = 'nodejs'

/** B27: preview an install straight from a finished export job, so the user never re-picks the ZIP. */
export async function POST(request: Request): Promise<Response> {
  const rejected = validateLocalRequest(request)
  if (rejected) return rejected
  let tempRoot: string | null = null
  try {
    const body = await request.json() as Record<string, unknown>
    const { projectId, jobId, gameDir, worldName } = body
    const fileId = body.fileId ?? '0'
    if ([projectId, jobId, gameDir, worldName, fileId].some((value) => typeof value !== 'string' || !value)) {
      return Response.json({ error: { message: 'projectId, jobId, gameDir and worldName are required' } }, { status: 400, headers: { 'Cache-Control': 'no-store' } })
    }
    const file = await readUnifiedJobFile(jobId as string, projectId as string, fileId as string)
    if (!file || !file.name.toLowerCase().endsWith('.zip')) return Response.json({ error: { message: 'Export job has no ZIP package' } }, { status: 404, headers: { 'Cache-Control': 'no-store' } })
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'bbs-install-job-'))
    const archive = path.join(tempRoot, 'package.zip')
    await writeFile(archive, file.bytes, { flag: 'wx' })
    const plan = await planInstall(archive, gameDir as string, worldName as string, file.name)
    return Response.json({ plan }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return Response.json({ error: { message: error instanceof Error ? error.message : 'Could not preview the package' } }, { status: 400, headers: { 'Cache-Control': 'no-store' } })
  } finally { if (tempRoot) await rm(tempRoot, { recursive: true, force: true }) }
}
