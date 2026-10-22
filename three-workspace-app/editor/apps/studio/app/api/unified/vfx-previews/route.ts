import { listVfxPreviews } from '../../../../src/vfxPreviews'
import { validateLocalRequest } from '../../../../src/unifiedSession'

export const runtime = 'nodejs'

export async function GET(request: Request): Promise<Response> {
  const rejected = validateLocalRequest(request)
  if (rejected) return rejected
  return Response.json({ sheets: await listVfxPreviews() }, { headers: { 'Cache-Control': 'no-store' } })
}
