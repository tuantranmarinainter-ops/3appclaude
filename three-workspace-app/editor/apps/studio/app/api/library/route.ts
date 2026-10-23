import { libraryCharacterModel } from '../../../src/libraryModels'
import { ACTION_CATEGORIES, CHARACTER_ACTION_STATUSES, getAction, searchLibrary, setActionMetadata, type ActionCategory, type CharacterActionStatus } from '../../../../../packages/library/index'
import { addLibraryCharacterToProject, approveCharacterAction, characterActions, copyCharacterAction, libraryCoverage, listLibraryCharacterDetails, rawActions, updateCharacterProfile } from '../../../src/libraryCommands'

export const runtime = 'nodejs'

export async function GET(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url)
    const modelCharacter = url.searchParams.get('modelCharacter')
    if (modelCharacter) {
      const model = await libraryCharacterModel(modelCharacter)
      if (url.searchParams.get('fingerprint') !== model.fingerprint) return Response.json({ error: 'Library model or skin changed; add the character again' }, { status: 409 })
      return new Response(new Uint8Array(model.bytes), { headers: { 'Content-Type': 'model/gltf-binary', 'Cache-Control': 'no-store' } })
    }
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
      const library = (await listLibraryCharacterDetails()).map((character) => ({ ...character, previewUrl: `/api/library/character/${character.charId}` }))
      return Response.json({ characters: [...builtin, ...library] }, { headers: { 'Cache-Control': 'no-store' } })
    }
    const charId = url.searchParams.get('charId')
    if (charId) {
      const status = url.searchParams.get('status') || undefined
      if (status && !CHARACTER_ACTION_STATUSES.includes(status as CharacterActionStatus)) return Response.json({ error: 'Unknown character Action status' }, { status: 400 })
      return Response.json({ actions: characterActions(charId, status as CharacterActionStatus | undefined) }, { headers: { 'Cache-Control': 'no-store' } })
    }
    if (url.searchParams.get('coverage') === '1') return Response.json({ coverage: libraryCoverage() }, { headers: { 'Cache-Control': 'no-store' } })
    if (url.searchParams.get('raw') === '1') return Response.json({ actions: rawActions(url.searchParams.get('q') || undefined) }, { headers: { 'Cache-Control': 'no-store' } })
    const requestedCategory = url.searchParams.get('category') || undefined
    if (requestedCategory && !ACTION_CATEGORIES.includes(requestedCategory as ActionCategory)) return Response.json({ error: 'Unknown category' }, { status: 400 })
    const result = searchLibrary({ rig: url.searchParams.get('rig') || undefined, category: requestedCategory as ActionCategory | undefined, tags: url.searchParams.getAll('tag'), text: url.searchParams.get('q') || undefined, limit: 100 })
    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 }) }
}

export async function PATCH(request: Request): Promise<Response> {
  try {
    const body = await request.json() as { operation?: string; charId?: string; actionUuid?: string; category?: string; tags?: string[]; name?: string; nameVi?: string; sourceName?: string; personality?: { summary: string; traits: string[] }; requiredActions?: Array<{ key: string; label: string }> }
    if (body.operation === 'approve') {
      if (!body.charId || !body.actionUuid) return Response.json({ error: 'charId and actionUuid are required' }, { status: 400 })
      return Response.json({ action: approveCharacterAction(body.charId, body.actionUuid) })
    }
    if (body.operation === 'profile') {
      if (!body.charId || !body.personality || !body.requiredActions) return Response.json({ error: 'Character profile is required' }, { status: 400 })
      return Response.json({ character: updateCharacterProfile(body.charId, body.personality, body.requiredActions) })
    }
    if (!body.actionUuid) return Response.json({ error: 'actionUuid is required' }, { status: 400 })
    if (body.category !== undefined && !ACTION_CATEGORIES.includes(body.category as ActionCategory)) return Response.json({ error: 'Unknown category' }, { status: 400 })
    setActionMetadata({ actionUuid: body.actionUuid, category: body.category as ActionCategory | undefined, tags: body.tags, name: body.name, nameVi: body.nameVi, sourceName: body.sourceName })
    return Response.json({ ok: true })
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 }) }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await request.json() as { operation?: string; actionUuid?: string; toCharId?: string; projectId?: string; expectedRevision?: number; charId?: string }
    if (body.operation === 'copy') {
      if (!body.actionUuid || !body.toCharId) return Response.json({ error: 'actionUuid and toCharId are required' }, { status: 400 })
      return Response.json({ action: copyCharacterAction(body.actionUuid, body.toCharId) })
    }
    if (body.operation === 'add-to-scene') {
      if (!body.projectId || !body.charId || !Number.isSafeInteger(body.expectedRevision)) return Response.json({ error: 'projectId, expectedRevision and charId are required' }, { status: 400 })
      return Response.json(await addLibraryCharacterToProject({ projectId: body.projectId, expectedRevision: body.expectedRevision!, charId: body.charId }))
    }
    return Response.json({ error: 'Unknown library operation' }, { status: 400 })
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 }) }
}
