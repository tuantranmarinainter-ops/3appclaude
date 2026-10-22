import { mixdownProjectAudio } from '../../../../../../src/audioMix'
import { readUnifiedProject } from '../../../../../../src/unifiedProjectStore'
import { validateLocalRequest } from '../../../../../../src/unifiedSession'

export const runtime = 'nodejs'

/** B16 mixdown: GET ?start=<frame>&end=<frame> → one ducked WAV of the project's audio lane (whole timeline by default). */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const rejected = validateLocalRequest(request)
  if (rejected) return rejected
  try {
    const project = await readUnifiedProject((await context.params).id)
    const url = new URL(request.url), timeline = project.scene.content.timeline
    const start = Number(url.searchParams.get('start') ?? timeline.frameStart), end = Number(url.searchParams.get('end') ?? timeline.frameEnd)
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < timeline.frameStart || end > timeline.frameEnd || end < start) {
      return Response.json({ error: { message: 'start/end must be whole frames inside the timeline' } }, { status: 400 })
    }
    return new Response(await mixdownProjectAudio(project, start, end), { headers: { 'Content-Type': 'audio/wav', 'Cache-Control': 'no-store' } })
  } catch (error) {
    return Response.json({ error: { message: error instanceof Error ? error.message : 'Audio mixdown failed' } }, { status: 400 })
  }
}
