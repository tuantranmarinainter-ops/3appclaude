import { immutableAssetResponse } from '../../../../../../../../src/immutableAssetResponse'
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
    return immutableAssetResponse(request, file.bytes, file.mediaType)
  } catch (error) {
    const conversionRequired = !!error && typeof error === 'object' && 'code' in error && error.code === 'CONVERSION_REQUIRED'
    const status = error instanceof UnifiedStoreError ? error.status : conversionRequired ? 409 : 404
    return Response.json({ error: { code: error instanceof UnifiedStoreError ? error.code : conversionRequired ? 'CONVERSION_REQUIRED' : 'NOT_FOUND', message: error instanceof Error ? error.message : 'Asset not found' } }, { status })
  }
}
