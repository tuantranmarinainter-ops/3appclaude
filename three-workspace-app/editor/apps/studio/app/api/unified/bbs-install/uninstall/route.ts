import { uninstallInstall } from '../../../../../src/bbsInstall'
import { validateLocalRequest } from '../../../../../src/unifiedSession'

export const runtime = 'nodejs'

export async function POST(request: Request): Promise<Response> {
  const rejected = validateLocalRequest(request)
  if (rejected) return rejected
  try {
    const body: unknown = await request.json()
    const args = body && typeof body === 'object' ? body as Record<string, unknown> : {}
    if (typeof args.gameDir !== 'string' || typeof args.installId !== 'string') return Response.json({ error: { message: 'Game folder and install record are required' } }, { status: 400 })
    const result = await uninstallInstall(args.gameDir, args.installId)
    return Response.json({ result }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    const status = typeof (error as { status?: unknown })?.status === 'number' ? (error as { status: number }).status : 400
    return Response.json({ error: { message: error instanceof Error ? error.message : 'Uninstall failed' } }, { status, headers: { 'Cache-Control': 'no-store' } })
  }
}
