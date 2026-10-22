import { StoryboardError, buildStoryboard } from '../../../../src/storyboard'
import { validateLocalRequest } from '../../../../src/unifiedSession'

export const runtime = 'nodejs'

/** B14: POST { storyboard, baseDir? } builds a new project; relative paths resolve against baseDir (default: cwd). */
export async function POST(request: Request): Promise<Response> {
  const rejected = validateLocalRequest(request)
  if (rejected) return rejected
  try {
    const body = await request.json() as { storyboard?: unknown; baseDir?: unknown }
    const result = await buildStoryboard(body.storyboard, typeof body.baseDir === 'string' && body.baseDir ? body.baseDir : process.cwd())
    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    if (error instanceof StoryboardError) return Response.json({ error: { code: 'VALIDATION_FAILED', issues: error.issues } }, { status: 400 })
    return Response.json({ error: { message: error instanceof Error ? error.message : 'Storyboard build failed' } }, { status: 400 })
  }
}
