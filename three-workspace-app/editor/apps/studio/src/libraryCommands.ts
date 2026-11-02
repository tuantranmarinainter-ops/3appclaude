import { createHash, randomUUID } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import {
  characterHeightBlocks,
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
  withIndexSnapshot,
  type CharacterActionStatus,
  type CharacterMetadata,
  type RequiredAction,
} from '../../../packages/library/index'
import { UnifiedStoreError } from './unifiedProjectStore'
import { executeUnifiedCommand, readUnifiedProject } from './unifiedProjectStore'
import { stageAssetUpload } from './unifiedAssetFiles'
import { libraryBaseGlb, libraryCharacterModel, libraryNativeAction } from './libraryModels'
import { libraryHeightSnapshot, scaleHeightCurvePayload } from './libraryHeight'
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

const textureHashes = new Map<string, { stamp: string; hash: Promise<string> }>()
async function sha256(file: string): Promise<string> {
  const info = await stat(file)
  const stamp = `${info.mtimeMs}:${info.ctimeMs}:${info.size}`
  const cached = textureHashes.get(file)
  if (cached?.stamp === stamp) return cached.hash
  const hash = readFile(file).then(bytes => createHash('sha256').update(bytes).digest('hex'))
  if (textureHashes.size >= 4096) textureHashes.delete(textureHashes.keys().next().value!)
  const entry = { stamp, hash }
  textureHashes.set(file, entry)
  try { return await hash }
  catch (error) {
    if (textureHashes.get(file) === entry) textureHashes.delete(file)
    throw error
  }
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
    heightBlocks: characterHeightBlocks(character),
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
  // describeLibraryCharacter resolves synchronously before its first await, so the whole list shares one index check.
  return Promise.all(withIndexSnapshot(() => listLibraryCharacters().map(describeLibraryCharacter)))
}

export function characterActions(charId: string, status?: CharacterActionStatus) {
  return listCharacterActions({ charId, latestOnly: true, ...(status ? { status } : {}) })
}

export function rawActions(text?: string) {
  return withIndexSnapshot(() => {
    const items: ReturnType<typeof searchLibrary>['items'] = []
    for (let offset = 0; ; offset += 100) {
      const page = searchLibrary({ text, limit: 100, offset })
      items.push(...page.items)
      if (offset + page.items.length >= page.total || !page.items.length) break
    }
    return items.filter((action) => !action.ownerCharId)
  })
}

export function approveCharacterAction(charId: string, actionUuid: string) {
  const action = listCharacterActions({ charId }).find((item) => item.uuid === actionUuid)
  if (!action) throw new Error('Action does not belong to this character')
  return setCharacterActionStatus({ charId, actionUuid, status: 'approved' })
}

export function copyCharacterAction(actionUuid: string, toCharId: string) {
  return copyActionToCharacter({ actionUuid, toCharId })
}

export function updateCharacterProfile(charId: string, personality: { summary: string; traits: string[] } | undefined, requiredActions: RequiredAction[] | undefined, heightBlocks?: number) {
  return setCharacterProfile({ charId, personality, requiredActions, heightBlocks })
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
 * Place an Action on one scene node. MC20 uses project conversion recipes or
 * direct same-rig placement; other rigs retain the existing library assignment flow.
 */
export async function placeLibraryActionForNode(input: { projectId: string; actionUuid: string; nodeId: string; frameStart?: number; reconvert?: boolean; replaceClipId?: string }) {
  const project = await readUnifiedProject(input.projectId)
  const character = Object.values(project.characters).find((item) => item.nodeId === input.nodeId)
  const node = project.scene.content.nodes.find((item) => item.id === input.nodeId)
  if (!character || !node) throw new Error('Node không còn trong project; hãy mở lại cảnh App 2')
  const libraryCharacterId = typeof node.metadata?.libraryCharacterId === 'string' ? node.metadata.libraryCharacterId : null
  if (!libraryCharacterId) throw new Error('Node chưa nối với nhân vật thư viện; hãy nối node này trước (C25) rồi gán lại')
  const action = getAction({ actionUuid: input.actionUuid })
  // Reject occupied ranges before any copy or cross-rig conversion writes library files.
  const replaced = input.replaceClipId ? project.scene.content.timeline.animation.motionClips.find((clip) => clip.id === input.replaceClipId && clip.target.nodeId === input.nodeId) : undefined
  if (input.replaceClipId && !replaced) throw new UnifiedStoreError('NOT_FOUND', 'Clip cần thay không còn trong cảnh hoặc không thuộc nhân vật này', 404)
  const frameStartWanted = replaced ? replaced.frameStart : input.frameStart
  // A replacement reuses the old clip's span (the store keeps frameStart..frameEnd), so only new placements are checked.
  if (frameStartWanted !== undefined && !replaced) {
    const duration = project.motions[action.uuid]?.durationSeconds ?? action.durationSeconds
    const frameEnd = frameStartWanted + Math.max(1, Math.round(duration * project.scene.content.timeline.fps)) - 1
    if (!Number.isSafeInteger(frameStartWanted) || frameStartWanted < 0 || !Number.isSafeInteger(frameEnd)) throw new UnifiedStoreError('VALIDATION_FAILED', 'Action placement exceeds the supported timeline range', 400)
    if (project.scene.content.timeline.animation.motionClips.some((clip) => clip.target.nodeId === input.nodeId && clip.frameStart <= frameEnd && clip.frameEnd >= frameStartWanted)) {
      throw new UnifiedStoreError('VALIDATION_FAILED', 'Khung bắt đầu đã có clip khác của nhân vật này; hãy chọn khung trống hoặc đầu shot khác', 400)
    }
  }
  const place = async (actionUuid: string, revision: number) => executeUnifiedCommand({ requestId: randomUUID(), projectId: input.projectId, expectedRevision: revision,
    command: 'library.place', args: { actionUuid, characterId: character.id, ...(input.reconvert ? { reconvert: true } : {}), ...(input.frameStart !== undefined ? { frameStart: input.frameStart } : {}), ...(replaced ? { replaceClipId: replaced.id } : {}) } })
  try {
    const placed = await place(input.actionUuid, project.revision)
    const placement = placed.result.libraryPlacement as { motionId: string; clipId: string; frameStart: number; frameEnd: number }
    return { projectId: input.projectId, revision: placed.revision, characterId: character.id, nodeId: input.nodeId, displayName: node.name, placedActionUuid: placement.motionId, converted: action.rig === 'mixamo65' && resolveCharacter(libraryCharacterId).character.rig === 'minecraft20', ...placement }
  } catch (error) {
    if (!(error instanceof UnifiedStoreError) || error.code !== 'PROFILE_MISMATCH' || resolveCharacter(libraryCharacterId).character.rig === 'minecraft20') throw error
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
    const placement = placed.result.libraryPlacement as { motionId: string; clipId: string; frameStart: number; frameEnd: number }
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
  const height = libraryHeightSnapshot(character, bytes)
  const positionX = nextLibraryCharacterX(
    project.scene.content.nodes.filter((node) => node.type === 'character').map((node) => node.transform.position.x),
    libraryCharacterBoundingBoxWidth(bytes) * height.libraryHeightScale,
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
    ...height,
    libraryCharacterId: character.charId,
    libraryModelFingerprint: preview.fingerprint,
    libraryBaseModelId: resolved.baseModel.modelId,
    librarySkin: details.textures,
    libraryHiddenObjects: [],
    ...(character.defaultAction ? { libraryDefaultAction: character.defaultAction } : {}),
  }
  const added = await executeUnifiedCommand({ requestId: randomUUID(), projectId: input.projectId, expectedRevision: imported.revision,
    command: 'character.add', args: { assetId, skeletonId, name: character.name, transform: { position: { x: positionX, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: height.libraryHeightScale, y: height.libraryHeightScale, z: height.libraryHeightScale } }, library } })
  const nodeId = String(added.result.nodeId)
  let revision = added.revision
  if (character.defaultAction) {
    const placed = await executeUnifiedCommand({ requestId: randomUUID(), projectId: input.projectId, expectedRevision: revision,
      command: 'library.place', args: { actionUuid: character.defaultAction, characterId: String(added.result.characterId) } })
    revision = placed.revision
  }
  return { projectId: input.projectId, revision, characterId: added.result.characterId, nodeId, assetId, modelId: resolved.baseModel.modelId }
}

/** Explicit opt-in only: profile writes never mutate a project. One undoable scene transaction. */
export async function updateLibraryCharacterHeights(projectId: string, expectedRevision: number) {
  const project = await readUnifiedProject(projectId)
  if (project.revision !== expectedRevision) throw new UnifiedStoreError('REVISION_CONFLICT', 'Cảnh đã thay đổi; hãy tải lại trước khi cập nhật chiều cao', 409)
  const document = structuredClone(project.scene)
  const ratios = new Map<string, number>()
  for (const node of document.content.nodes) {
    const id = node.metadata?.libraryCharacterId
    if (typeof id !== 'string') continue
    const resolved = resolveCharacter(id)
    const height = libraryHeightSnapshot(resolved.character, await libraryBaseGlb(id))
    if (height.libraryHeightBlocks === node.metadata?.libraryHeightBlocks) continue
    if (node.locked) throw new Error(`Nhân vật ${node.name} đang khóa; hãy mở khóa trước khi cập nhật chiều cao`)
    const previous = Number(node.metadata?.libraryHeightScale ?? 1)
    if (!(previous > 0) || !Number.isFinite(previous)) throw new Error('Hệ số chiều cao cũ không hợp lệ')
    const ratio = height.libraryHeightScale / previous
    ratios.set(node.id, ratio)
    for (const axis of ['x', 'y', 'z'] as const) node.transform.scale[axis] *= ratio
    node.metadata = { ...node.metadata, ...height }
  }
  const fcurves = scaleHeightCurvePayload(project.extensions.topview?.fcurves ?? null, ratios)
  const embedded = scaleHeightCurvePayload({ fcurves: document.content.timeline.animation.fcurves }, ratios) as { fcurves: typeof document.content.timeline.animation.fcurves }
  document.content.timeline.animation.fcurves = embedded.fcurves
  return executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision, command: 'scene.apply', args: { operations: [{ type: 'document.replace', document, fcurves }] } })
}
