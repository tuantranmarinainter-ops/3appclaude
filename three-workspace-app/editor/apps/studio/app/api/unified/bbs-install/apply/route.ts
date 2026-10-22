import { applyInstall } from '../../../../../src/bbsInstall'
import { validateLocalRequest } from '../../../../../src/unifiedSession'

export const runtime = 'nodejs'

export async function POST(request: Request): Promise<Response> {
  const rejected = validateLocalRequest(request)
  if (rejected) return rejected
  try {
    const body: unknown = await request.json()
    const planId = body && typeof body === 'object' ? (body as Record<string, unknown>).planId : undefined
    if (typeof planId !== 'string' || !/^[0-9a-f-]{36}$/i.test(planId)) return Response.json({ error: { message: 'Invalid install preview' } }, { status: 400 })
    const result = await applyInstall(planId)
    return Response.json({ result }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    const status = typeof (error as { status?: unknown })?.status === 'number' ? (error as { status: number }).status : 400
    return Response.json({ error: { message: error instanceof Error ? error.message : 'Install failed' } }, { status, headers: { 'Cache-Control': 'no-store' } })
  }
}
