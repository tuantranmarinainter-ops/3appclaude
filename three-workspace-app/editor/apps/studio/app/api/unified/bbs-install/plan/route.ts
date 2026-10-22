import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { planInstall } from '../../../../../src/bbsInstall'
import { validateLocalRequest } from '../../../../../src/unifiedSession'

export const runtime = 'nodejs'
const MAX_ZIP_BYTES = 128 * 1024 * 1024

function decodeHeader(value: string | null): string {
  if (!value) return ''
  try { return decodeURIComponent(value) } catch { return '' }
}

async function readLimited(request: Request): Promise<Buffer> {
  if (!request.body) throw new TypeError('ZIP body is empty')
  const reader = request.body.getReader(), chunks: Uint8Array[] = []
  let size = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > MAX_ZIP_BYTES) { await reader.cancel(); throw new RangeError('ZIP exceeds the 128 MiB limit') }
    chunks.push(value)
  }
  return Buffer.concat(chunks, size)
}

export async function POST(request: Request): Promise<Response> {
  const rejected = validateLocalRequest(request)
  if (rejected) return rejected
  if (!request.headers.get('content-type')?.toLowerCase().includes('application/zip')) return Response.json({ error: { message: 'Upload a ZIP package' } }, { status: 415 })
  const contentLength = Number(request.headers.get('content-length') ?? 0)
  if (contentLength > MAX_ZIP_BYTES) return Response.json({ error: { message: 'ZIP exceeds the 128 MiB limit' } }, { status: 413 })
  const gameDir = decodeHeader(request.headers.get('x-bbs-game-dir')), worldName = decodeHeader(request.headers.get('x-bbs-world-name'))
  const packageName = decodeHeader(request.headers.get('x-bbs-package-name'))
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'bbs-install-upload-'))
  try {
    const bytes = await readLimited(request)
    const archive = path.join(tempRoot, 'package.zip')
    await writeFile(archive, bytes, { flag: 'wx' })
    const plan = await planInstall(archive, gameDir, worldName, packageName)
    return Response.json({ plan }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    const tooLarge = error instanceof RangeError
    return Response.json({ error: { message: error instanceof Error ? error.message : 'Could not preview the package' } }, { status: tooLarge ? 413 : 400, headers: { 'Cache-Control': 'no-store' } })
  } finally { await rm(tempRoot, { recursive: true, force: true }) }
}
