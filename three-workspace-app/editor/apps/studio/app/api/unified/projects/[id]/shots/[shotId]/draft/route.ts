import { readShotDraft, saveShotDraft } from '../../../../../../../../src/shotDraft'
import { readStagedAssetUpload } from '../../../../../../../../src/unifiedAssetFiles'
import { readUnifiedProject } from '../../../../../../../../src/unifiedProjectStore'
import { validateLocalRequest } from '../../../../../../../../src/unifiedSession'

export const runtime = 'nodejs'
type Context = { params: Promise<{ id: string; shotId: string }> }

function failure(error: unknown) {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : 'VALIDATION_FAILED'
  return Response.json({ error: { code, message: error instanceof Error ? error.message : 'Shot draft failed' } }, { status: code === 'REVISION_CONFLICT' ? 409 : code === 'ENOENT' ? 404 : 400 })
}

export async function POST(request: Request, context: Context): Promise<Response> {
  const rejected = validateLocalRequest(request)
  if (rejected) return rejected
  try {
    const body = await request.json()
    if (!body || typeof body !== 'object' || Object.keys(body).length !== 1 || typeof body.file !== 'string') throw new TypeError('A staged shot result file is required')
    const { id, shotId } = await context.params
    const project = await readUnifiedProject(id), upload = await readStagedAssetUpload(body.file)
    return Response.json(await saveShotDraft(project, shotId, upload.bytes), { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) { return failure(error) }
}

export async function GET(request: Request, context: Context): Promise<Response> {
  const rejected = validateLocalRequest(request)
  if (rejected) return rejected
  try {
    const { id, shotId } = await context.params
    const bytes = await readShotDraft(await readUnifiedProject(id), shotId)
    return new Response(bytes, { headers: { 'Content-Type': 'application/zip', 'Cache-Control': 'no-store' } })
  } catch (error) { return failure(error) }
}
