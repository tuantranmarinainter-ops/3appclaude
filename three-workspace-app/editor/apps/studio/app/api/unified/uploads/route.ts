import { stageAssetUpload } from '../../../../src/unifiedAssetFiles'
import { validateLocalRequest } from '../../../../src/unifiedSession'

export const runtime = 'nodejs'
const MAX_UPLOAD_BYTES = 256 * 1024 * 1024

export async function POST(request: Request): Promise<Response> {
  const rejected = validateLocalRequest(request)
  if (rejected) return rejected
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/octet-stream')) return Response.json({ error: { code: 'VALIDATION_FAILED', message: 'Content-Type must be application/octet-stream' } }, { status: 415 })
  if (!request.body) return Response.json({ error: { code: 'VALIDATION_FAILED', message: 'Upload body is required' } }, { status: 400 })
  const length = Number(request.headers.get('content-length') ?? 0)
  if (length > MAX_UPLOAD_BYTES) return Response.json({ error: { code: 'VALIDATION_FAILED', message: 'Upload exceeds 256 MiB' } }, { status: 413 })
  try {
    const encodedName = request.headers.get('x-file-name') ?? ''
    const name = decodeURIComponent(encodedName)
    const upload = await stageAssetUpload(name, request.body, MAX_UPLOAD_BYTES)
    return Response.json({ uploadId: upload.id, name: upload.name, sha256: upload.sha256, byteLength: upload.byteLength }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    const tooLarge = error instanceof RangeError
    return Response.json({ error: { code: tooLarge ? 'PAYLOAD_TOO_LARGE' : 'VALIDATION_FAILED', message: error instanceof Error ? error.message : 'Upload failed' } }, { status: tooLarge ? 413 : 400 })
  }
}
