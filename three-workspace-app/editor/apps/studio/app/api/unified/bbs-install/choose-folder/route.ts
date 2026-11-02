import { chooseFolderNative } from '../../../../../src/bbsLocalDesktop'
import { validateLocalRequest } from '../../../../../src/unifiedSession'

export const runtime = 'nodejs'

/** B50: native "choose game folder" dialog on the machine running Studio. */
export async function POST(request: Request): Promise<Response> {
  const rejected = validateLocalRequest(request)
  if (rejected) return rejected
  try {
    const body = await request.json().catch(() => ({})) as { initial?: unknown }
    const folder = await chooseFolderNative(typeof body.initial === 'string' ? body.initial : undefined)
    return Response.json({ path: folder }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return Response.json({ error: { message: error instanceof Error ? error.message : 'Không mở được hộp chọn thư mục' } }, { status: 400, headers: { 'Cache-Control': 'no-store' } })
  }
}
