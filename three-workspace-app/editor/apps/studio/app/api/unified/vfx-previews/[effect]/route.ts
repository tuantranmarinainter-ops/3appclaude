import { createHash } from 'node:crypto'
import { readVfxSheetImage } from '../../../../../src/vfxPreviews'
import { validateLocalRequest } from '../../../../../src/unifiedSession'

export const runtime = 'nodejs'

export async function GET(request: Request, context: { params: Promise<{ effect: string }> }): Promise<Response> {
  const rejected = validateLocalRequest(request)
  if (rejected) return rejected
  const bytes = await readVfxSheetImage((await context.params).effect)
  if (!bytes) return new Response('Not found', { status: 404 })
  const headers = { 'Content-Type': 'image/png', 'Cache-Control': 'private, max-age=0, must-revalidate', ETag: `"${createHash('sha256').update(bytes).digest('hex')}"` }
  if (request.headers.get('if-none-match')?.split(',').some(tag => tag.trim().replace(/^W\//, '') === headers.ETag || tag.trim() === '*')) return new Response(null, { status: 304, headers })
  return new Response(bytes, { headers })
}
