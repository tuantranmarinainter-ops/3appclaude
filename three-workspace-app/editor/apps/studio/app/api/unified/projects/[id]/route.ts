import { readUnifiedProjectState } from '../../../../../src/unifiedProjectStore'
import { validateLocalRequest } from '../../../../../src/unifiedSession'

export const runtime = 'nodejs'

export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const rejected = validateLocalRequest(request)
  if (rejected) return rejected
  try {
    const { id } = await context.params
    return Response.json(await readUnifiedProjectState(id), { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    const status = error && typeof error === 'object' && 'status' in error ? Number((error as { status: unknown }).status) : 500
    return Response.json({ error: error instanceof Error ? error.message : 'IO_FAILED' }, { status })
  }
}
