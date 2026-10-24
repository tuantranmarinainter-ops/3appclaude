import { readFile } from 'node:fs/promises'
import { getAction } from '../../../../../../../packages/library/index'

export const runtime = 'nodejs'

export async function GET(_request: Request, context: { params: Promise<{ uuid: string }> }): Promise<Response> {
  try {
    const { uuid } = await context.params, action = getAction({ actionUuid: uuid })
    if (!action.previewPath) return new Response('Preview is not ready', { status: 404 })
    const bytes = await readFile(action.previewPath)
    return new Response(bytes, { headers: { 'Content-Type': 'video/webm', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Length': String(bytes.byteLength) } })
  } catch { return new Response('Preview not found', { status: 404 }) }
}
