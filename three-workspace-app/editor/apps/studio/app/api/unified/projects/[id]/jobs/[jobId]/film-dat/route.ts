import { readFile } from 'node:fs/promises'
import { unifiedJobZipPath } from '../../../../../../../../src/unifiedJobs'
import { validateLocalRequest } from '../../../../../../../../src/unifiedSession'
import { readFilmDat } from '../../../../../../../../src/zipEntry'

export const runtime = 'nodejs'

/** B56: the Film `.dat` alone, for users who copy films by hand. */
export async function GET(request: Request, context: { params: Promise<{ id: string; jobId: string }> }): Promise<Response> {
  const rejected = validateLocalRequest(request)
  if (rejected) return rejected
  const { id, jobId } = await context.params
  try {
    const zip = await unifiedJobZipPath(jobId, id)
    if (!zip) return Response.json({ error: 'NOT_FOUND' }, { status: 404, headers: { 'Cache-Control': 'no-store' } })
    const film = readFilmDat(await readFile(zip))
    if (!/^[A-Za-z0-9._-]{1,128}$/.test(film.name)) throw new Error('Tên film không hợp lệ.')
    return new Response(new Uint8Array(film.data), { headers: { 'Cache-Control': 'no-store', 'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${film.name}"`, 'X-Content-Type-Options': 'nosniff' } })
  } catch (error) {
    return Response.json({ error: { message: error instanceof Error ? error.message : 'Không đọc được film' } }, { status: 400, headers: { 'Cache-Control': 'no-store' } })
  }
}
