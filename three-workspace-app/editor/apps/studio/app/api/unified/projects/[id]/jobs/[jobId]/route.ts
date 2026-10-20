import { getUnifiedJob } from '../../../../../../../src/unifiedJobs'
import { validateLocalRequest } from '../../../../../../../src/unifiedSession'

export const runtime = 'nodejs'

export async function GET(request: Request, context: { params: Promise<{ id: string; jobId: string }> }): Promise<Response> {
  const rejected = validateLocalRequest(request)
  if (rejected) return rejected
  const { id, jobId } = await context.params
  try {
    const job = await getUnifiedJob(jobId, id)
    return Response.json({ job }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    const status = (error as { status?: number }).status === 404 ? 404 : 500
    return Response.json({ error: status === 404 ? 'NOT_FOUND' : 'IO_FAILED' }, { status, headers: { 'Cache-Control': 'no-store' } })
  }
}
