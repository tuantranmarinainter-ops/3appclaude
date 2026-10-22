import { readFile } from 'node:fs/promises'
import { getAction } from '../../../../../../../packages/library/index'

export const runtime = 'nodejs'

export async function GET(_request: Request, context: { params: Promise<{ uuid: string }> }): Promise<Response> {
  try {
    const { uuid } = await context.params
    const action = getAction({ actionUuid: uuid })
    if (!action.coverPath) return new Response('Cover not found', { status: 404 })
    return new Response(await readFile(action.coverPath), { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } })
  } catch { return new Response('Action not found', { status: 404 }) }
}
