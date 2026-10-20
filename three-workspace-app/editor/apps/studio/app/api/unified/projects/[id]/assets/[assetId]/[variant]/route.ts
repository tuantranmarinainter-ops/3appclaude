import { readUnifiedProject, UnifiedStoreError } from '../../../../../../../../src/unifiedProjectStore'
import { resolveUnifiedAssetFile } from '../../../../../../../../src/unifiedAssetFiles'
import { validateLocalRequest } from '../../../../../../../../src/unifiedSession'

export const runtime = 'nodejs'

export async function GET(request: Request, context: { params: Promise<{ id: string; assetId: string; variant: string }> }): Promise<Response> {
  const rejected = validateLocalRequest(request)
  if (rejected) return rejected
  const { id, assetId, variant } = await context.params
  try {
    const project = await readUnifiedProject(id)
    const asset = project.assets[decodeURIComponent(assetId) as keyof typeof project.assets]
    if (!asset) throw new UnifiedStoreError('NOT_FOUND', 'Asset not found', 404)
    const file = await resolveUnifiedAssetFile(project, asset.id, variant)
    return new Response(file.bytes, { headers: { 'Content-Type': file.mediaType, 'Content-Length': String(file.bytes.byteLength), 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } })
  } catch (error) {
    const status = error instanceof UnifiedStoreError ? error.status : 404
    return Response.json({ error: { code: error instanceof UnifiedStoreError ? error.code : 'NOT_FOUND', message: error instanceof Error ? error.message : 'Asset not found' } }, { status })
  }
}
