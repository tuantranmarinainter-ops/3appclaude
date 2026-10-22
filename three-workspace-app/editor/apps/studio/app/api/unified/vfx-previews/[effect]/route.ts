import { readVfxSheetImage } from '../../../../../src/vfxPreviews'
import { validateLocalRequest } from '../../../../../src/unifiedSession'

export const runtime = 'nodejs'

export async function GET(request: Request, context: { params: Promise<{ effect: string }> }): Promise<Response> {
  const rejected = validateLocalRequest(request)
  if (rejected) return rejected
  const bytes = await readVfxSheetImage((await context.params).effect)
  if (!bytes) return new Response('Not found', { status: 404 })
  return new Response(bytes, { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' } })
}
