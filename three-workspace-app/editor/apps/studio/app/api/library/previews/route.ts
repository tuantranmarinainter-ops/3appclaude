import { libraryPreviewJobs, queueLibraryPreviews } from '../../../../src/libraryPreviews'

export const runtime = 'nodejs'

export async function GET(): Promise<Response> { return Response.json({ jobs: libraryPreviewJobs() }, { headers: { 'Cache-Control': 'no-store' } }) }

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await request.json().catch(() => ({})) as { actionUuids?: unknown; regenerate?: unknown }
    if (body.actionUuids !== undefined && (!Array.isArray(body.actionUuids) || body.actionUuids.some(value => typeof value !== 'string'))) return Response.json({ error: 'actionUuids must be a list of strings' }, { status: 400 })
    return Response.json({ jobs: queueLibraryPreviews({ origin: new URL(request.url).origin, actionUuids: body.actionUuids as string[] | undefined, regenerate: body.regenerate === true }) }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 }) }
}
