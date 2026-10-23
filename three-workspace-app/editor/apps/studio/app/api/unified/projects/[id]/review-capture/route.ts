import { captureReviewStills } from '../../../../../../src/reviewCapture'
import { readUnifiedProject } from '../../../../../../src/unifiedProjectStore'
import { validateLocalRequest } from '../../../../../../src/unifiedSession'

export const runtime = 'nodejs'

/** C4: POST { sequenceId, clipId, frames } → { images: data URLs } rendered with the BBS look for the review board. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const rejected = validateLocalRequest(request)
  if (rejected) return rejected
  try {
    const body = await request.json() as { sequenceId?: unknown; clipId?: unknown; frames?: unknown }
    if (typeof body.sequenceId !== 'string' || typeof body.clipId !== 'string' || !Array.isArray(body.frames)) {
      return Response.json({ error: { message: 'sequenceId, clipId and frames are required' } }, { status: 400 })
    }
    const project = await readUnifiedProject((await context.params).id)
    const images = await captureReviewStills(project, body.sequenceId, body.clipId, body.frames as number[], request.signal)
    return Response.json({ images, sourceRevision: project.revision }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    const busy = error && typeof error === 'object' && 'code' in error && (error as { code: unknown }).code === 'JOB_BUSY'
    return Response.json({ error: { message: error instanceof Error ? error.message : 'Review capture failed' } }, { status: busy ? 423 : 400 })
  }
}
