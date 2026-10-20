import { executeUnifiedCommand, UnifiedStoreError } from '../../../../src/unifiedProjectStore'
import { validateLocalRequest } from '../../../../src/unifiedSession'

export const runtime = 'nodejs'
const MAX_PAYLOAD_BYTES = 64 * 1024 * 1024

async function readJsonLimited(request: Request): Promise<unknown> {
  if (!request.body) throw new Error('Empty request body')
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > MAX_PAYLOAD_BYTES) { await reader.cancel(); throw new RangeError('Payload exceeds 64 MiB') }
    chunks.push(value)
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown
}

export async function POST(request: Request): Promise<Response> {
  const rejected = validateLocalRequest(request)
  if (rejected) return rejected
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) return Response.json({ error: { code: 'VALIDATION_FAILED', message: 'Content-Type must be application/json' } }, { status: 415 })
  const contentLength = Number(request.headers.get('content-length') ?? 0)
  if (contentLength > MAX_PAYLOAD_BYTES) return Response.json({ error: { code: 'VALIDATION_FAILED', message: 'Payload exceeds 64 MiB' } }, { status: 413 })
  let body: unknown
  try { body = await readJsonLimited(request) }
  catch (error) { return Response.json({ error: { code: 'VALIDATION_FAILED', message: error instanceof RangeError ? error.message : 'Invalid JSON' } }, { status: error instanceof RangeError ? 413 : 400 }) }
  try { return Response.json(await executeUnifiedCommand(body), { headers: { 'Cache-Control': 'no-store' } }) }
  catch (error) {
    if (process.env.NODE_ENV === 'development' && !(error instanceof UnifiedStoreError)) {
      const native = error && typeof error === 'object' ? error as { name?: unknown; code?: unknown; syscall?: unknown; message?: unknown } : {}
      console.error('Unified transaction diagnostic', {
        cause: typeof native.name === 'string' ? native.name : 'unknown', code: typeof native.code === 'string' ? native.code : undefined,
        syscall: typeof native.syscall === 'string' ? native.syscall : undefined,
        detail: native.name === 'TypeError' && typeof native.message === 'string' && !/[\\/]|[A-Za-z]:/.test(native.message) ? native.message : undefined,
      })
    }
    const failure = error instanceof UnifiedStoreError ? error : new UnifiedStoreError('IO_FAILED', 'Project transaction failed', 500)
    const value = body && typeof body === 'object' ? body as Record<string, unknown> : {}
    return Response.json({ ok: false, requestId: value.requestId ?? null, projectId: value.projectId ?? null, revision: failure.details?.actual ?? null, error: { code: failure.code, message: failure.message, retryable: failure.code === 'WRITER_BUSY' || failure.code === 'IO_FAILED', ...(failure.details ? { details: failure.details } : {}) } }, { status: failure.status })
  }
}
