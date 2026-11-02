import { applyProjectZipCleanup, planProjectZipCleanup } from '../../../../../../src/projectZipCleanup'
import { validateLocalRequest } from '../../../../../../src/unifiedSession'

export const runtime = 'nodejs'

/** B64: POST { action: 'plan' | 'apply' } — old exported ZIPs in the project's job folder; the newest per film name stays. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const rejected = validateLocalRequest(request)
  if (rejected) return rejected
  const headers = { 'Cache-Control': 'no-store' }
  try {
    const { id } = await context.params
    const body: unknown = await request.json().catch(() => ({}))
    const action = body && typeof body === 'object' ? (body as Record<string, unknown>).action : undefined
    if (action === 'plan') return Response.json({ plan: await planProjectZipCleanup(id) }, { headers })
    if (action === 'apply') return Response.json({ result: await applyProjectZipCleanup(id) }, { headers })
    return Response.json({ error: { message: 'Unknown action' } }, { status: 400, headers })
  } catch (error) {
    return Response.json({ error: { message: error instanceof Error ? error.message : 'Cleanup failed' } }, { status: 400, headers })
  }
}
