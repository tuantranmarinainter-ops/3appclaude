import { listUnifiedProjects } from '../../../../src/unifiedProjectStore'
import { validateLocalRequest } from '../../../../src/unifiedSession'

export const runtime = 'nodejs'

export async function GET(request: Request): Promise<Response> {
  const rejected = validateLocalRequest(request)
  if (rejected) return rejected
  try { return Response.json({ projects: await listUnifiedProjects() }, { headers: { 'Cache-Control': 'no-store' } }) }
  catch { return Response.json({ error: 'IO_FAILED' }, { status: 500 }) }
}
