import { createHash } from 'node:crypto'

/** ETag identifies the returned representation, including derivative variants. */
export function immutableAssetResponse(request: Request, bytes: Buffer, mediaType: string): Response {
  const etag = `"${createHash('sha256').update(bytes).digest('hex')}"`
  const headers = { 'Content-Type': mediaType, 'Cache-Control': 'private, max-age=31536000, immutable', ETag: etag, 'X-Content-Type-Options': 'nosniff' }
  // GET uses weak comparison; tags can contain commas inside their quoted opaque value.
  const condition = request.headers.get('if-none-match')
  const matches = condition?.trim() === '*' || [...(condition ?? '').matchAll(/(?:W\/)?"[^"\r\n]*"/g)].some(([tag]) => tag.replace(/^W\//, '') === etag)
  if (matches) return new Response(null, { status: 304, headers })
  return new Response(bytes, { headers: { ...headers, 'Content-Length': String(bytes.byteLength) } })
}
