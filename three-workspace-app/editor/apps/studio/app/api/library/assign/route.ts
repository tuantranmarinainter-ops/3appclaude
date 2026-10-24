import { cancelLibraryAssignJob, createLibraryAssignJob, getLibraryAssignJob } from '../../../../src/libraryAssign'

export const runtime = 'nodejs'

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await request.json() as { actionUuids?: unknown; charId?: unknown; createNew?: unknown }
    if (!Array.isArray(body.actionUuids) || body.actionUuids.some((uuid) => typeof uuid !== 'string') || typeof body.charId !== 'string' || body.createNew !== undefined && typeof body.createNew !== 'boolean') {
      return Response.json({ error: 'actionUuids, charId, and an optional boolean createNew are required' }, { status: 400 })
    }
    return Response.json({ job: createLibraryAssignJob({ actionUuids: body.actionUuids as string[], charId: body.charId, createNew: body.createNew as boolean | undefined }) }, { status: 202, headers: { 'Cache-Control': 'no-store' } })
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 }) }
}

export async function GET(request: Request): Promise<Response> {
  const jobId = new URL(request.url).searchParams.get('jobId')
  if (!jobId) return Response.json({ error: 'jobId is required' }, { status: 400 })
  const job = getLibraryAssignJob(jobId)
  return job ? Response.json({ job }, { headers: { 'Cache-Control': 'no-store' } }) : Response.json({ error: 'Assignment job not found' }, { status: 404 })
}

export async function DELETE(request: Request): Promise<Response> {
  const jobId = new URL(request.url).searchParams.get('jobId')
  if (!jobId) return Response.json({ error: 'jobId is required' }, { status: 400 })
  const job = cancelLibraryAssignJob(jobId)
  return job ? Response.json({ job }, { headers: { 'Cache-Control': 'no-store' } }) : Response.json({ error: 'Assignment job not found' }, { status: 404 })
}
