import { createHash, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import {
  copyActionToCharacter,
  coverageMatrix,
  getAction,
  listCharacterActions,
  listLibraryCharacters,
  resolveCharacter,
  resolveLibraryPath,
  searchLibrary,
  setCharacterActionStatus,
  setCharacterProfile,
  type CharacterActionStatus,
  type CharacterMetadata,
  type RequiredAction,
} from '../../../packages/library/index'
import { UnifiedStoreError } from './unifiedProjectStore'
import { executeUnifiedCommand, readUnifiedProject } from './unifiedProjectStore'
import { stageAssetUpload } from './unifiedAssetFiles'
import { libraryBaseGlb, libraryCharacterModel, libraryNativeAction } from './libraryModels'
import { libraryCharacterBoundingBoxWidth, nextLibraryCharacterX } from './libraryCharacterSpacing'

export type LibraryTextureRef = {
  object: string
  path: string
  sha256: string
  source: 'skin' | 'base'
}

function relativeLibraryPath(file: string): string {
  const root = path.resolve(resolveLibraryPath())
  const relative = path.relative(root, path.resolve(file))
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Library asset escaped its root')
  return relative.split(path.sep).join('/')
}

async function sha256(file: string): Promise<string> {
  return createHash('sha256').update(await readFile(file)).digest('hex')
}

export async function describeLibraryCharacter(character: CharacterMetadata) {
  const resolved = resolveCharacter(character.charId)
  const textures: LibraryTextureRef[] = await Promise.all(Object.entries(resolved.textures).map(async ([object, file]) => ({
    object,
    path: relativeLibraryPath(file),
    sha256: await sha256(file),
    source: relativeLibraryPath(file).startsWith(`characters/${character.charId}/`) ? 'skin' as const : 'base' as const,
  })))
  return {
    ...character,
    personality: character.personality ?? { summary: '', traits: [] },
    requiredActions: character.requiredActions ?? [],
    model: resolved.baseModel ? {
      modelId: resolved.baseModel.modelId,
      format: resolved.baseModel.format,
      path: relativeLibraryPath(resolved.modelPath),
      sha256: resolved.baseModel.sha256,
      objects: resolved.baseModel.objects,
    } : null,
    textures,
    warnings: resolved.warnings,
  }
}

export async function listLibraryCharacterDetails() {
  return Promise.all(listLibraryCharacters().map(describeLibraryCharacter))
}

export function characterActions(charId: string, status?: CharacterActionStatus) {
  return listCharacterActions({ charId, latestOnly: true, ...(status ? { status } : {}) })
}

export function rawActions(text?: string) {
  const items: ReturnType<typeof searchLibrary>['items'] = []
  for (let offset = 0; ; offset += 100) {
    const page = searchLibrary({ text, limit: 100, offset })
    items.push(...page.items)
    if (offset + page.items.length >= page.total || !page.items.length) break
  }
  return items.filter((action) => !action.ownerCharId)
}

export function approveCharacterAction(charId: string, actionUuid: string) {
  const action = listCharacterActions({ charId }).find((item) => item.uuid === actionUuid)
  if (!action) throw new Error('Action does not belong to this character')
  return setCharacterActionStatus({ charId, actionUuid, status: 'approved' })
}

export function copyCharacterAction(actionUuid: string, toCharId: string) {
  return copyActionToCharacter({ actionUuid, toCharId })
}

export function updateCharacterProfile(charId: string, personality: { summary: string; traits: string[] }, requiredActions: RequiredAction[]) {
  return setCharacterProfile({ charId, personality, requiredActions })
}

export function libraryCoverage() { return coverageMatrix() }

export type ExistingNodePolicy = 'ask' | 'reuse' | 'create'

export class LibraryCharacterAlreadyInSceneError extends Error {
  readonly code = 'LIBRARY_CHARACTER_ALREADY_IN_SCENE'
  constructor(readonly charId: string, readonly existingNodeIds: string[], readonly existingNodeNames: string[]) {
    super(`Nhân vật thư viện đã có ${existingNodeIds.length} node trong cảnh; hãy chọn dùng node có sẵn hoặc thêm lần xuất hiện mới`)
    this.name = 'LibraryCharacterAlreadyInSceneError'
  }
}

export function libraryCharacterSceneNodes(project: Awaited<ReturnType<typeof readUnifiedProject>>, charId: string) {
  return project.scene.content.nodes.filter((node) => node.type === 'character' && node.metadata?.libraryCharacterId === charId)
}

/**
 * C25: link existing storyboard nodes to a library character in one undoable store command.
 * Nodes keep their transform/shot framing; clips are re-placed from same-name Drafts of the
 * character or reported as unconverted in the command result.
 */
export async function linkStoryboardNodesToLibrary(input: { projectId: string; expectedRevision: number; charId: string; nodeIds: string[] }) {
  const character = listLibraryCharacters().find((item) => item.charId === input.charId)
  if (!character) throw new Error('Library character was not found')
  if (!input.nodeIds.length) throw new Error('Select at least one storyboard node to link')
  const response = await executeUnifiedCommand({ requestId: randomUUID(), projectId: input.projectId, expectedRevision: input.expectedRevision,
    command: 'library.link', args: { nodeIds: input.nodeIds, libraryCharacterId: input.charId } })
  return { projectId: input.projectId, revision: response.revision, ...(response.result as Record<string, unknown>) }
}

/**
 * N1: place a library Action onto one specific scene node (the Library page's
 * "Gán cho <Tên vai · Shot NN>" flow). Direct placement is tried first; a same-rig
 * Action owned by another character is copied into the target's set first, and a
 * shared Action goes through the existing assignment pipeline. Cross-skeleton
 * conversion of character-owned Actions is N1b's extension of that pipeline.
 */
export async function placeLibraryActionForNode(input: { projectId: string; actionUuid: string; nodeId: string; frameStart?: number }) {
  const project = await readUnifiedProject(input.projectId)
  const character = Object.values(project.characters).find((item) => item.nodeId === input.nodeId)
  const node = project.scene.content.nodes.find((item) => item.id === input.nodeId)
  if (!character || !node) throw new Error('Node không còn trong project; hãy mở lại cảnh App 2')
  const libraryCharacterId = typeof node.metadata?.libraryCharacterId === 'string' ? node.metadata.libraryCharacterId : null
  if (!libraryCharacterId) throw new Error('Node chưa nối với nhân vật thư viện; hãy nối node này trước (C25) rồi gán lại')
  const action = getAction({ actionUuid: input.actionUuid })
  const place = async (actionUuid: string, revision: number) => executeUnifiedCommand({ requestId: randomUUID(), projectId: input.projectId, expectedRevision: revision,
    command: 'library.place', args: { actionUuid, characterId: character.id, ...(input.frameStart !== undefined ? { frameStart: input.frameStart } : {}) } })
  try {
    const placed = await place(input.actionUuid, project.revision)
    const placement = placed.result.libraryPlacement as { clipId: string; frameStart: number; frameEnd: number }
    return { projectId: input.projectId, revision: placed.revision, characterId: character.id, nodeId: input.nodeId, displayName: node.name, placedActionUuid: input.actionUuid, converted: false, ...placement }
  } catch (error) {
    if (!(error instanceof UnifiedStoreError) || error.code !== 'PROFILE_MISMATCH') throw error
    const target = resolveCharacter(libraryCharacterId)
    let draftUuid: string
    let warning: string | undefined
    if (action.ownerCharId && action.ownerCharId !== libraryCharacterId) {
      const compatible = target.character.rig === action.rig || target.character.rig === 'verity' && (action.rig === 'mixamo65' || action.rig === 'mixamo65+verity') || (target.character.rig === 'mixamo65' || target.character.rig === 'mixamo65+verity') && action.rig === 'verity'
      if (compatible) {
        draftUuid = copyActionToCharacter({ actionUuid: input.actionUuid, toCharId: libraryCharacterId }).uuid
      } else {
        // N1b: cross-skeleton conversion of another character's Action through the retarget pipeline.
        const { assignToCharacter } = await import('./libraryAssign')
        const [result] = await assignToCharacter({ actionUuids: [input.actionUuid], charId: libraryCharacterId })
        if (!result || result.status === 'error' || !result.assignedUuid) throw new Error(result?.reason ?? 'Không chuyển được động tác sang nhân vật đích')
        draftUuid = result.assignedUuid
        warning = result.warning
      }
    } else if (!action.ownerCharId) {
      const { assignToCharacter } = await import('./libraryAssign')
      const [result] = await assignToCharacter({ actionUuids: [input.actionUuid], charId: libraryCharacterId })
      if (!result || result.status === 'error' || !result.assignedUuid) throw new Error(result?.reason ?? 'Không chuyển được động tác sang nhân vật đích')
      draftUuid = result.assignedUuid
      warning = result.warning
    } else throw error
    const latest = await readUnifiedProject(input.projectId)
    const placed = await place(draftUuid, latest.revision)
    const placement = placed.result.libraryPlacement as { clipId: string; frameStart: number; frameEnd: number }
    return { projectId: input.projectId, revision: placed.revision, characterId: character.id, nodeId: input.nodeId, displayName: node.name, placedActionUuid: draftUuid, converted: true, ...(warning ? { warning } : {}), ...placement }
  }
}

/**
 * Add a library character through the existing project commands. The base model is
 * content-addressed, so repeated characters import one project asset while each node
 * keeps its own skin and library identity.
 */
export async function addLibraryCharacterToProject(input: { projectId: string; expectedRevision: number; charId: string; existingNodePolicy?: ExistingNodePolicy }) {
  const character = listLibraryCharacters().find((item) => item.charId === input.charId)
  if (!character) throw new Error('Library character was not found')
  const project = await readUnifiedProject(input.projectId)
  // C25: never silently duplicate a role that already has nodes in this project. A caller with
  // a stale revision skips this check so the store still reports the revision conflict first.
  const existingNodes = input.expectedRevision === project.revision ? libraryCharacterSceneNodes(project, input.charId) : []
  if (existingNodes.length) {
    const policy = input.existingNodePolicy ?? 'ask'
    if (policy === 'ask') throw new LibraryCharacterAlreadyInSceneError(input.charId, existingNodes.map((node) => node.id), existingNodes.map((node) => node.name))
    if (policy === 'reuse') return { projectId: input.projectId, revision: project.revision, reused: true, nodeIds: existingNodes.map((node) => node.id), nodeNames: existingNodes.map((node) => node.name) }
  }
  const resolved = resolveCharacter(character.charId)
  if (!resolved.baseModel) throw new Error('Library character has no base model')
  if (character.defaultAction && resolved.baseModel.format === 'bobj' && ['verity', 'minecraft20'].includes(resolved.baseModel.rig)) {
    const action = getAction({ actionUuid: character.defaultAction })
    if (action.ownerCharId !== character.charId) throw new Error('Default native Action must belong to the selected character')
    await libraryNativeAction(character.charId, path.join(path.dirname(action.glbPath), resolved.baseModel.rig === 'minecraft20' ? 'anim.bobj' : 'anim.original.bbs.bobj'))
  }
  const bytes = await libraryBaseGlb(character.charId)
  const positionX = nextLibraryCharacterX(
    project.scene.content.nodes.filter((node) => node.type === 'character').map((node) => node.transform.position.x),
    libraryCharacterBoundingBoxWidth(bytes),
  )
  const preview = await libraryCharacterModel(character.charId)
  const staged = await stageAssetUpload(`${resolved.baseModel.modelId}.glb`, new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(bytes); controller.close() },
  }))
  const imported = await executeUnifiedCommand({ requestId: randomUUID(), projectId: input.projectId, expectedRevision: input.expectedRevision,
    command: 'asset.import', args: { files: [staged.id], format: 'glb' } })
  const assetId = String((imported.result.assetIds as unknown[])[0])
  const skeletonId = String((imported.result.skeletonIds as unknown[])[0])
  const details = await describeLibraryCharacter(character)
  const library = {
    libraryCharacterId: character.charId,
    libraryModelFingerprint: preview.fingerprint,
    libraryBaseModelId: resolved.baseModel.modelId,
    librarySkin: details.textures,
    libraryHiddenObjects: [],
    ...(character.defaultAction ? { libraryDefaultAction: character.defaultAction } : {}),
  }
  const added = await executeUnifiedCommand({ requestId: randomUUID(), projectId: input.projectId, expectedRevision: imported.revision,
    command: 'character.add', args: { assetId, skeletonId, name: character.name, transform: { position: { x: positionX, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } }, library } })
  const nodeId = String(added.result.nodeId)
  let revision = added.revision
  if (character.defaultAction) {
    const placed = await executeUnifiedCommand({ requestId: randomUUID(), projectId: input.projectId, expectedRevision: revision,
      command: 'library.place', args: { actionUuid: character.defaultAction, characterId: String(added.result.characterId) } })
    revision = placed.revision
  }
  return { projectId: input.projectId, revision, characterId: added.result.characterId, nodeId, assetId, modelId: resolved.baseModel.modelId }
}
