import { readFile } from 'node:fs/promises'
import { getAction } from '../../../../../../../packages/library/index'

export const runtime = 'nodejs'

export async function GET(_request: Request, context: { params: Promise<{ uuid: string }> }): Promise<Response> {
  try {
    const { uuid } = await context.params
    const action = getAction({ actionUuid: uuid })
    return new Response(await readFile(action.glbPath), { headers: { 'Content-Type': 'model/gltf-binary', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } })
  } catch { return new Response('Action not found', { status: 404 }) }
}
