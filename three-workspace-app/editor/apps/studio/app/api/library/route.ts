import { assignmentTargetRig } from '../../library/components/assignment/utils'
import { UnifiedStoreError, readUnifiedProject } from '../../../src/unifiedProjectStore'
import { resolveCharacter } from '../../../../../packages/library/index'
import { readLibraryCharacterHeight } from '../../../src/libraryCharacterProfiles'
import { invalidateLibraryModels, libraryCharacterModel } from '../../../src/libraryModels'
import { ACTION_CATEGORIES, CHARACTER_ACTION_STATUSES, getAction, searchLibrary, setActionMetadata, type ActionCategory, type CharacterActionStatus } from '../../../../../packages/library/index'
import { addLibraryCharacterToProject, approveCharacterAction, characterActions, copyCharacterAction, libraryCoverage, linkStoryboardNodesToLibrary, listLibraryCharacterDetails, placeLibraryActionForNode, updateLibraryCharacterHeights, rawActions, updateCharacterProfile, LibraryCharacterAlreadyInSceneError, type ExistingNodePolicy } from '../../../src/libraryCommands'

export const runtime = 'nodejs'

export async function GET(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url)
    const heightCharacter = url.searchParams.get('heightCharacter')
    if (heightCharacter) return Response.json(await readLibraryCharacterHeight(heightCharacter), { headers: { 'Cache-Control': 'no-store' } })
    const modelCharacter = url.searchParams.get('modelCharacter')
    if (modelCharacter) {
      const fingerprint = url.searchParams.get('fingerprint')
      let model = await libraryCharacterModel(modelCharacter)
      if (fingerprint !== model.fingerprint) { const legacy = await libraryCharacterModel(modelCharacter, false); if (legacy.fingerprint === fingerprint) model = legacy }
      if (fingerprint !== model.fingerprint) return Response.json({ error: 'Library model or skin changed; add the character again' }, { status: 409 })
      const headers = { 'Content-Type': 'model/gltf-binary', 'Cache-Control': 'private, max-age=31536000, immutable', ETag: `"${model.fingerprint}"` }
      if (request.headers.get('if-none-match')?.split(',').some(tag => tag.trim().replace(/^W\//, '') === headers.ETag || tag.trim() === '*')) return new Response(null, { status: 304, headers })
      return new Response(new Uint8Array(model.bytes), { headers })
    }
    const assignmentNodeId = url.searchParams.get('assignmentNodeId')
    if (assignmentNodeId) {
      const projectId = url.searchParams.get('projectId')
      if (!projectId) throw new Error('projectId is required')
      const project = await readUnifiedProject(projectId)
      const node = project.scene.content.nodes.find(item => item.id === assignmentNodeId)
      const character = Object.values(project.characters).find(item => item.nodeId === assignmentNodeId)
      if (!node || !character) throw new Error('Node không còn trong project')
      const libraryCharacterId = typeof node.metadata?.libraryCharacterId === 'string' ? node.metadata.libraryCharacterId : null
      const resolved = libraryCharacterId ? resolveCharacter(libraryCharacterId) : null
      const family = project.skeletons[character.skeletonId]?.family
      const targetRig = assignmentTargetRig(family, resolved?.baseModel?.rig)
      return Response.json({ targetRig, libraryCharacterId }, { headers: { 'Cache-Control': 'no-store' } })
    }
    if (url.searchParams.get('assignmentActions') === '1') {
      const offset = Number(url.searchParams.get('offset') ?? 0)
      if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('Invalid offset')
      const page = searchLibrary({ limit: 100, offset })
      const ownerRigs = new Map<string, string>()
      const items = page.items.map(action => {
        if (action.ownerCharId && !ownerRigs.has(action.ownerCharId)) {
          const owner = resolveCharacter(action.ownerCharId)
          ownerRigs.set(action.ownerCharId, owner.baseModel?.rig ?? owner.character.rig)
        }
        return { ...action, skeletonKind: action.ownerCharId ? ownerRigs.get(action.ownerCharId) : action.rig }
      })
      return Response.json({ ...page, items }, { headers: { 'Cache-Control': 'no-store' } })
    }
    const actionUuid = url.searchParams.get('actionUuid')
    if (actionUuid) {
      const action = getAction({ actionUuid })
      return Response.json({ action: { ...action, glbPath: undefined, manifestPath: undefined, coverPath: undefined, previewPath: undefined }, cover: action.coverPath ? `/api/library/cover/${encodeURIComponent(actionUuid)}` : null }, { headers: { 'Cache-Control': 'no-store' } })
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
    const body = await request.json() as { operation?: string; charId?: string; actionUuid?: string; category?: string; tags?: string[]; name?: string; nameVi?: string; sourceName?: string; favorite?: boolean; heightBlocks?: number; personality?: { summary: string; traits: string[] }; requiredActions?: Array<{ key: string; label: string }> }
    if (body.operation === 'approve') {
      if (!body.charId || !body.actionUuid) return Response.json({ error: 'charId and actionUuid are required' }, { status: 400 })
      return Response.json({ action: approveCharacterAction(body.charId, body.actionUuid) })
    }
    if (body.operation === 'profile') {
      if (!body.charId || body.heightBlocks === undefined && !body.personality && !body.requiredActions) return Response.json({ error: 'Character profile is required' }, { status: 400 })
      const character = updateCharacterProfile(body.charId, body.personality, body.requiredActions, body.heightBlocks)
      invalidateLibraryModels(body.charId)
      return Response.json({ character })
    }
    if (!body.actionUuid) return Response.json({ error: 'actionUuid is required' }, { status: 400 })
    if (body.category !== undefined && !ACTION_CATEGORIES.includes(body.category as ActionCategory)) return Response.json({ error: 'Unknown category' }, { status: 400 })
    setActionMetadata({ actionUuid: body.actionUuid, category: body.category as ActionCategory | undefined, tags: body.tags, name: body.name, nameVi: body.nameVi, sourceName: body.sourceName, favorite: body.favorite })
    return Response.json({ ok: true })
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 }) }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await request.json() as { operation?: string; actionUuid?: string; toCharId?: string; projectId?: string; expectedRevision?: number; charId?: string; existingNodePolicy?: string; nodeIds?: string[]; nodeId?: string; frameStart?: number; reconvert?: boolean; replaceClipId?: string }
    if (body.operation === 'update-scene-heights') {
      if (!body.projectId || !Number.isSafeInteger(body.expectedRevision)) return Response.json({ error: 'projectId và expectedRevision là bắt buộc' }, { status: 400 })
      return Response.json(await updateLibraryCharacterHeights(body.projectId, body.expectedRevision!))
    }
    if (body.operation === 'copy') {
      if (!body.actionUuid || !body.toCharId) return Response.json({ error: 'actionUuid and toCharId are required' }, { status: 400 })
      return Response.json({ action: copyCharacterAction(body.actionUuid, body.toCharId) })
    }
    if (body.operation === 'add-to-scene') {
      if (!body.projectId || !body.charId || !Number.isSafeInteger(body.expectedRevision)) return Response.json({ error: 'projectId, expectedRevision and charId are required' }, { status: 400 })
      if (body.existingNodePolicy !== undefined && !['ask', 'reuse', 'create'].includes(body.existingNodePolicy)) return Response.json({ error: 'existingNodePolicy must be ask, reuse or create' }, { status: 400 })
      return Response.json(await addLibraryCharacterToProject({ projectId: body.projectId, expectedRevision: body.expectedRevision!, charId: body.charId, existingNodePolicy: body.existingNodePolicy as ExistingNodePolicy | undefined }))
    }
    if (body.operation === 'place-for-node') {
      if (!body.projectId || !body.actionUuid || !body.nodeId || body.frameStart !== undefined && (!Number.isSafeInteger(body.frameStart) || (body.frameStart as number) < 0)) return Response.json({ error: 'projectId, actionUuid, nodeId and an optional nonnegative frameStart are required' }, { status: 400 })
      if (body.reconvert !== undefined && typeof body.reconvert !== 'boolean') return Response.json({ error: 'reconvert must be boolean' }, { status: 400 })
      if (body.replaceClipId !== undefined && (typeof body.replaceClipId !== 'string' || !body.replaceClipId)) return Response.json({ error: 'replaceClipId phải là chuỗi' }, { status: 400 })
      return Response.json(await placeLibraryActionForNode({ projectId: body.projectId, actionUuid: body.actionUuid, nodeId: body.nodeId, ...(body.replaceClipId ? { replaceClipId: body.replaceClipId } : {}), ...(body.reconvert ? { reconvert: true } : {}), ...(body.frameStart !== undefined ? { frameStart: body.frameStart } : {}) }))
    }
    if (body.operation === 'link-nodes') {
      if (!body.projectId || !body.charId || !Number.isSafeInteger(body.expectedRevision) || !Array.isArray(body.nodeIds) || !body.nodeIds.length || body.nodeIds.some((id) => typeof id !== 'string')) return Response.json({ error: 'projectId, expectedRevision, charId and nodeIds are required' }, { status: 400 })
      return Response.json(await linkStoryboardNodesToLibrary({ projectId: body.projectId, expectedRevision: body.expectedRevision!, charId: body.charId, nodeIds: body.nodeIds as string[] }))
    }
    return Response.json({ error: 'Unknown library operation' }, { status: 400 })
  } catch (error) {
    if (error instanceof UnifiedStoreError) return Response.json({ error: error.message, code: error.code }, { status: error.code === 'CONVERSION_REQUIRED' ? 409 : 400 })
    if (error instanceof LibraryCharacterAlreadyInSceneError) {
      return Response.json({ error: error.message, code: error.code, charId: error.charId, existingNodeIds: error.existingNodeIds, existingNodeNames: error.existingNodeNames }, { status: 409 })
    }
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 })
  }
}
