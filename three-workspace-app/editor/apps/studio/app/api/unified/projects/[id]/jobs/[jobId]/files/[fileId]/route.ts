import { readUnifiedJobFile } from '../../../../../../../../../src/unifiedJobs'
import { validateLocalRequest } from '../../../../../../../../../src/unifiedSession'

export const runtime = 'nodejs'

export async function GET(request: Request, context: { params: Promise<{ id: string; jobId: string; fileId: string }> }): Promise<Response> {
  const rejected = validateLocalRequest(request)
  if (rejected) return rejected
  const { id, jobId, fileId } = await context.params
  try {
    const file = await readUnifiedJobFile(jobId, id, fileId)
    if (!file) return Response.json({ error: 'NOT_FOUND' }, { status: 404, headers: { 'Cache-Control': 'no-store' } })
    return new Response(new Uint8Array(file.bytes), { headers: {
      'Cache-Control': 'no-store', 'Content-Type': file.mimeType,
      'Content-Disposition': `attachment; filename="${file.name}"`, 'X-Content-Type-Options': 'nosniff',
    } })
  } catch {
    return Response.json({ error: 'NOT_FOUND' }, { status: 404, headers: { 'Cache-Control': 'no-store' } })
  }
}
