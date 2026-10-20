import { resolveProjectBlob } from '../../../../../../../../src/unifiedAssetFiles'
import { readUnifiedProject, UnifiedStoreError } from '../../../../../../../../src/unifiedProjectStore'
import { validateLocalRequest } from '../../../../../../../../src/unifiedSession'

export const runtime = 'nodejs'

export async function GET(request: Request, context: { params: Promise<{ id: string; mappingId: string }> }): Promise<Response> {
  const rejected = validateLocalRequest(request)
  if (rejected) return rejected
  try {
    const { id, mappingId } = await context.params
    const project = await readUnifiedProject(id)
    const mapping = project.mappings[decodeURIComponent(mappingId)]
    if (!mapping) throw new UnifiedStoreError('NOT_FOUND', 'Skeleton mapping not found', 404)
    const bytes = await resolveProjectBlob(id, mapping.calibration)
    return new Response(bytes, { headers: { 'Content-Type': mapping.calibration.mediaType, 'Content-Length': String(bytes.byteLength), 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } })
  } catch (error) {
    const status = error instanceof UnifiedStoreError ? error.status : 404
    return Response.json({ error: { code: error instanceof UnifiedStoreError ? error.code : 'NOT_FOUND', message: error instanceof Error ? error.message : 'Calibration not found' } }, { status })
  }
}
