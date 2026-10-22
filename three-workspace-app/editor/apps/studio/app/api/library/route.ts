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
    if (url.searchParams.get('characters') === '1') {
      const builtin = [
        ['a3d_char_de37873a79244fbe8a0660ea08d1b4ab', 'Mixamo Character 1'],
        ['a3d_char_7d220ac359844c80a8faaf0e25478477', 'Mixamo Character 2'],
        ['a3d_char_461b4f4b76ae4b198f439fa4f6f743b6', 'Mixamo Character 3'],
        ['a3d_char_30ec53c93eae4173946b38639691ebe0', 'Mixamo Character 4'],
      ].map(([id, name]) => ({ charId: id, name, rig: 'mixamo65', previewUrl: `/api/library/character/${id}` }))
      const library = listLibraryCharacters().map((character) => ({ ...character, previewUrl: `/api/library/character/${character.charId}` }))
      return Response.json({ characters: [...builtin, ...library] }, { headers: { 'Cache-Control': 'no-store' } })
    }
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
