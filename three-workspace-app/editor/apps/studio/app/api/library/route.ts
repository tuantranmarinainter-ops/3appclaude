import { ACTION_CATEGORIES, getAction, listLibraryCharacters, searchLibrary, setActionMetadata, type ActionCategory } from '../../../../../packages/library/index'

export const runtime = 'nodejs'

export async function GET(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url)
    const actionUuid = url.searchParams.get('actionUuid')
    if (actionUuid) {
      const action = getAction({ actionUuid })
      return Response.json({ action: { ...action, glbPath: undefined, manifestPath: undefined, coverPath: undefined }, cover: action.coverPath ? `/api/library/cover/${encodeURIComponent(actionUuid)}` : null }, { headers: { 'Cache-Control': 'no-store' } })
    }
    if (url.searchParams.get('characters') === '1') return Response.json({ characters: listLibraryCharacters() }, { headers: { 'Cache-Control': 'no-store' } })
    const requestedCategory = url.searchParams.get('category') || undefined
    if (requestedCategory && !ACTION_CATEGORIES.includes(requestedCategory as ActionCategory)) return Response.json({ error: 'Unknown category' }, { status: 400 })
    const result = searchLibrary({ rig: url.searchParams.get('rig') || undefined, category: requestedCategory as ActionCategory | undefined, tags: url.searchParams.getAll('tag'), text: url.searchParams.get('q') || undefined, limit: 100 })
    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 }) }
}

export async function PATCH(request: Request): Promise<Response> {
  try {
    const body = await request.json() as { actionUuid?: string; category?: string; tags?: string[] }
    if (!body.actionUuid) return Response.json({ error: 'actionUuid is required' }, { status: 400 })
    if (body.category !== undefined && !ACTION_CATEGORIES.includes(body.category as ActionCategory)) return Response.json({ error: 'Unknown category' }, { status: 400 })
    setActionMetadata({ actionUuid: body.actionUuid, category: body.category as ActionCategory | undefined, tags: body.tags })
    return Response.json({ ok: true })
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 }) }
}
