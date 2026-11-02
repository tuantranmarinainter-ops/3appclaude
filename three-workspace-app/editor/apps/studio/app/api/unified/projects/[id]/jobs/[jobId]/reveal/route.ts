import { revealPathNative } from '../../../../../../../../src/bbsLocalDesktop'
import { unifiedJobZipPath } from '../../../../../../../../src/unifiedJobs'
import { validateLocalRequest } from '../../../../../../../../src/unifiedSession'

export const runtime = 'nodejs'

/** B55: open the folder holding the exported ZIP, with the file selected. */
export async function POST(request: Request, context: { params: Promise<{ id: string; jobId: string }> }): Promise<Response> {
  const rejected = validateLocalRequest(request)
  if (rejected) return rejected
  const { id, jobId } = await context.params
  try {
    const zip = await unifiedJobZipPath(jobId, id)
    if (!zip) return Response.json({ error: 'NOT_FOUND' }, { status: 404, headers: { 'Cache-Control': 'no-store' } })
    await revealPathNative(zip)
    return Response.json({ path: zip }, { headers: { 'Cache-Control': 'no-store' } })
  } catch {
    return Response.json({ error: 'NOT_FOUND' }, { status: 404, headers: { 'Cache-Control': 'no-store' } })
  }
}
