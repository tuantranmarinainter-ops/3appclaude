import { getRequestResult } from '../../../../../src/unifiedProjectStore'
import { validateLocalRequest } from '../../../../../src/unifiedSession'

export const runtime = 'nodejs'

export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const rejected = validateLocalRequest(request)
  if (rejected) return rejected
  const { id } = await context.params
  const result = await getRequestResult(id)
  return result ? Response.json(result, { headers: { 'Cache-Control': 'no-store' } }) : Response.json({ error: 'NOT_FOUND' }, { status: 404 })
}
