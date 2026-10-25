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
