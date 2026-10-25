import { createHash, randomUUID } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import {
  initializeLibrary, readJsonFile, resolveLibraryPath, safeChild, safeId, withLibraryLock, writeIndex, writeJsonAtomic,
} from './store'
import {
  CHARACTER_ACTION_STATUSES, DEFAULT_REQUIRED_ACTIONS, LIBRARY_VERSION,
  type CharacterActionStatus, type CharacterCoverage, type CharacterMetadata,
  type CharacterPersonality, type IndexedAction, type LibraryLicense, type LibraryOptions, type MotionPackMetadata,
  type BaseModelMetadata, type NormalizedManifest, type RequiredAction,
} from './types'
import { validatePackGlbContract } from './importPack'
import { translateActionName } from './actionNames'
import { nativeSkeletonFingerprint } from '../retarget/src/nativeSkeleton'
import { bobjModelToGlb, parseBobjModel } from '../retarget/src/bobjModel'
import { nativeActionBobj } from '../retarget/src/nativeActionBobj'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function defaults(): RequiredAction[] {
  return DEFAULT_REQUIRED_ACTIONS.map(([key, label]) => ({ key, label }))
}

export function withCharacterDefaults(character: CharacterMetadata): CharacterMetadata {
  return {
    ...character,
    personality: character.personality ?? { summary: '', traits: [] },
    requiredActions: character.requiredActions ?? defaults(),
  }
}

function characterAt(root: string, charId: string): CharacterMetadata {
  const id = safeId(charId, 'character id')
  const character = readJsonFile<CharacterMetadata>(safeChild(root, 'characters', id, 'meta.json'))
  if (character.kind !== 'character' || character.charId !== id) throw new Error(`Invalid character metadata: ${id}`)
  return character
}

function memberships(root: string, character: CharacterMetadata, actions: IndexedAction[]): string[] {
  return character.actions ?? actions.filter((action) => action.boundCharacter === character.charId).map((action) => action.uuid)
}

function compatibleRig(characterRig: string, actionRig: string): boolean {
  return characterRig === actionRig ||
    (characterRig === 'verity' && (actionRig === 'mixamo65' || actionRig === 'mixamo65+verity')) ||
    ((characterRig === 'mixamo65' || characterRig === 'mixamo65+verity') && actionRig === 'verity')
}

function status(value: unknown): CharacterActionStatus {
  if (!(CHARACTER_ACTION_STATUSES as readonly unknown[]).includes(value)) throw new Error('Invalid character action status')
  return value as CharacterActionStatus
}

function actionAt(actions: IndexedAction[], uuid: string): IndexedAction {
  if (!UUID.test(uuid)) throw new Error('Invalid action UUID')
  const action = actions.find((candidate) => candidate.uuid.toLowerCase() === uuid.toLowerCase())
  if (!action) throw new Error(`Action not found: ${uuid}`)
  return action
}

function writeCharacter(root: string, character: CharacterMetadata): void {
  writeJsonAtomic(safeChild(root, 'characters', character.charId, 'meta.json'), character)
}

interface NewVersion {
  source: IndexedAction
  ownerCharId: string
  glbFile: string
  uuid: string
  status: CharacterActionStatus
  version: number
  variantOf: string
  parentUuid: string
  notes?: string
  preserveAnimationIndex: boolean
  durationSeconds?: number
  license: LibraryLicense
  manifestContract?: Pick<NormalizedManifest, 'version' | 'extraBoneMode' | 'extraBones'>
  nativeBobj?: string
  favorite?: boolean
}

function createVersionPack(root: string, input: NewVersion): IndexedAction {
  const bytes = readFileSync(input.glbFile)
  const glbSha256 = createHash('sha256').update(bytes).digest('hex')
  const packId = createHash('sha256').update(`${glbSha256}:${input.uuid}`).digest('hex').slice(0, 16)
  const destination = safeChild(root, 'packs', packId)
  if (existsSync(destination)) throw new Error(`Character action version already exists: ${input.uuid}`)
  const generatedName = translateActionName(input.source.name)
  const bilingual = input.source.nameVi
    ? { nameVi: input.source.nameVi, nameViSource: input.source.nameViSource }
    : generatedName.source === 'none' ? {} : { nameVi: generatedName.vi, nameViSource: generatedName.source }
  const metadata: MotionPackMetadata = {
    kind: 'motion-pack', libraryVersion: LIBRARY_VERSION, packId, glbSha256, rig: input.source.rig,
    createdBy: 'app3', createdAt: new Date().toISOString(),
    license: { ...input.license },
    boundCharacter: null, source: { file: input.source.name, sha256: null },
    actions: [{
      uuid: input.uuid, name: input.source.name, durationSeconds: input.durationSeconds ?? input.source.durationSeconds, fps: input.source.fps,
      ...bilingual, ...(input.source.sourceName ? { sourceName: input.source.sourceName } : {}),
      category: input.source.category, tags: [...input.source.tags], loop: input.source.loop, inPlace: input.source.inPlace,
      parentUuid: input.parentUuid, cover: null,
      glbAnimationIndex: input.preserveAnimationIndex ? input.source.glbAnimationIndex : 0,
      ownerCharId: input.ownerCharId, status: input.status, version: input.version, variantOf: input.variantOf,
      ...((input.favorite ?? input.source.favorite) ? { favorite: true } : {}),
      ...(input.notes === undefined ? {} : { notes: input.notes }),
    }],
  }
  const staging = safeChild(root, 'packs', `.${packId}.${process.pid}.tmp`)
  mkdirSync(staging)
  try {
    copyFileSync(input.glbFile, safeChild(staging, 'anim.glb'))
    if (input.nativeBobj !== undefined) {
      writeFileSync(safeChild(staging, 'anim.original.bbs.bobj'), input.nativeBobj)
      if (input.source.rig === 'minecraft20') writeFileSync(safeChild(staging, 'anim.bobj'), input.nativeBobj.slice(input.nativeBobj.lastIndexOf('\nan ') + 1))
    }
    writeJsonAtomic(safeChild(staging, 'anim.manifest.json'), {
      version: input.manifestContract?.version ?? '1.0.0', glbSha256, rig: input.source.rig,
      ...input.manifestContract,
      actions: metadata.actions.map(({ uuid, name, durationSeconds, fps, glbAnimationIndex }) => ({ uuid, name, durationSeconds, fps, glbAnimationIndex })),
    })
    writeJsonAtomic(safeChild(staging, 'meta.json'), metadata)
    renameSync(staging, destination)
  } catch (error) {
    rmSync(staging, { recursive: true, force: true })
    throw error
  }
  return { ...metadata.actions[0]!, packId, rig: metadata.rig, createdAt: metadata.createdAt, licenseId: metadata.license.id, boundCharacter: null }
}

function sourceLicense(root: string, action: IndexedAction): LibraryLicense {
  return readJsonFile<MotionPackMetadata>(safeChild(root, 'packs', action.packId, 'meta.json')).license
}

function sourceManifestContract(root: string, action: IndexedAction): NewVersion['manifestContract'] {
  const manifest = readJsonFile<NormalizedManifest>(safeChild(root, 'packs', action.packId, 'anim.manifest.json'))
  return {
    version: manifest.version,
    ...(manifest.extraBones === undefined ? {} : { extraBones: manifest.extraBones }),
    ...(manifest.extraBoneMode === undefined ? {} : { extraBoneMode: manifest.extraBoneMode }),
  }
}

function inspectEditedGlb(root: string, path: string, rig: string, manifestContract?: NewVersion['manifestContract']): { durationSeconds: number } {
  const bytes = readFileSync(path)
  if (bytes.length < 20 || bytes.toString('ascii', 0, 4) !== 'glTF' || bytes.readUInt32LE(4) !== 2 || bytes.readUInt32LE(8) !== bytes.length || bytes.readUInt32LE(16) !== 0x4e4f534a) throw new Error('Edited action must be a valid GLB 2.0 file')
  const jsonLength = bytes.readUInt32LE(12)
  if (jsonLength > bytes.length - 20) throw new Error('Edited GLB JSON chunk is truncated')
  const gltf = JSON.parse(bytes.toString('utf8', 20, 20 + jsonLength)) as {
    animations?: Array<{ samplers?: Array<{ input?: number }> }>
    accessors?: Array<{ max?: number[] }>
    nodes?: Array<{ name?: string }>
    skins?: Array<{ joints?: number[] }>
  }
  if (gltf.animations?.length !== 1) throw new Error('Edited action GLB must contain exactly one animation')
  const inputs = gltf.animations[0]!.samplers?.map((sampler) => sampler.input).filter((index): index is number => Number.isInteger(index)) ?? []
  const durationSeconds = Math.max(...inputs.map((index) => gltf.accessors?.[index]?.max?.[0] ?? NaN))
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) throw new Error('Edited action GLB has no positive animation duration')
  if (manifestContract?.extraBoneMode === 'scene-nodes') {
    validatePackGlbContract(path, { ...manifestContract, version: '1.1.0', rig, actions: [] })
  }
  const rigPath = safeChild(root, 'rigs', `${rig.replace(/[+]/g, '-')}.json`)
  if (existsSync(rigPath) && gltf.skins?.length) {
    const expected = readJsonFile<{ bones?: Array<{ name: string }> }>(rigPath).bones?.map((bone) => bone.name).sort()
    const actual = [...new Set(gltf.skins.flatMap((skin) => skin.joints ?? []).map((index) => gltf.nodes?.[index]?.name).filter((name): name is string => !!name))].sort()
    if (expected && JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`Edited action GLB rig does not match ${rig}`)
  }
  return { durationSeconds }
}

export function addDraftToCharacter(options: LibraryOptions & { charId: string; actionUuid: string; favorite?: boolean }): IndexedAction {
  const root = resolveLibraryPath(options)
  return withLibraryLock(root, () => {
    initializeLibrary(root)
    const index = writeIndex(root), character = characterAt(root, options.charId), source = actionAt(index.actions, options.actionUuid)
    if (source.ownerCharId) throw new Error('Draft source must be a raw library action')
    if (!compatibleRig(character.rig, source.rig)) throw new Error(`Rig mismatch: character ${character.rig}, action ${source.rig}`)
    const uuid = randomUUID()
    const created = createVersionPack(root, { source, ownerCharId: character.charId, glbFile: safeChild(root, 'packs', source.packId, 'anim.glb'), uuid,
      status: 'draft', version: 1, variantOf: uuid, parentUuid: source.uuid, preserveAnimationIndex: true,
      license: sourceLicense(root, source), manifestContract: sourceManifestContract(root, source), favorite: options.favorite })
    character.actions = [...new Set([...memberships(root, character, index.actions), created.uuid])]
    writeCharacter(root, character); writeIndex(root)
    return created
  })
}

export function saveCharacterActionVersion(options: LibraryOptions & {
  charId: string; baseUuid: string; glbFile: string; status: 'edited'; notes?: string; rig?: string; actionUuid?: string; nativeBobj?: string
}): IndexedAction {
  const root = resolveLibraryPath(options)
  return withLibraryLock(root, () => {
    initializeLibrary(root)
    const index = writeIndex(root), character = characterAt(root, options.charId), source = actionAt(index.actions, options.baseUuid)
    const member = memberships(root, character, index.actions).some((uuid) => uuid.toLowerCase() === source.uuid.toLowerCase())
    if (!member || source.ownerCharId !== character.charId || !source.variantOf || !source.version) throw new Error('Base action does not belong to this character')
    if (options.status !== 'edited') throw new Error('Saved character action versions must have edited status')
    if (!existsSync(options.glbFile)) throw new Error('Edited GLB file does not exist')
    const manifestContract = sourceManifestContract(root, source)
    if (options.actionUuid && !UUID.test(options.actionUuid)) throw new Error('actionUuid must be a UUID')
    if (options.rig && options.rig !== source.rig) {
      const nativeModel = character.baseModelId ? readJsonFile<BaseModelMetadata>(safeChild(root, 'models', character.baseModelId, 'meta.json')) : null
      if (!['verity', 'minecraft20'].includes(options.rig) || nativeModel?.rig !== options.rig || nativeModel.format !== 'bobj') throw new Error('Edited rig transition must target the character native BOBJ rig')
    }
    const editedSource = options.rig && options.rig !== source.rig ? { ...source, rig: options.rig } : source
    const requestedUuid = options.actionUuid ?? randomUUID()
    let nativeBobj: string | undefined
    if (['verity', 'minecraft20'].includes(editedSource.rig) && character.baseModelId) {
      const model = readJsonFile<BaseModelMetadata>(safeChild(root, 'models', character.baseModelId, 'meta.json'))
      if (model.format !== 'bobj' || model.rig !== editedSource.rig) throw new Error('Edited rig must match the character base model')
      const original = readFileSync(safeChild(root, 'models', character.baseModelId, model.model))
      if (createHash('sha256').update(original).digest('hex') !== model.sha256) throw new Error('Native base checksum mismatch')
      const expected = bobjModelToGlb(parseBobjModel(original.toString('utf8')), { faceForward: true }).bytes
      if (nativeSkeletonFingerprint(expected) !== nativeSkeletonFingerprint(readFileSync(options.glbFile))) throw new Error('Edited native skeleton does not match the character base')
      const suppliedUuid = options.nativeBobj?.slice(original.toString('utf8').length).match(/^an app3_([^\r\n]+)$/m)?.[1]
      if (options.nativeBobj !== undefined && (!suppliedUuid || !UUID.test(suppliedUuid))) throw new Error('Edited native BOBJ has no valid Action identity')
      nativeBobj = nativeActionBobj(original, readFileSync(options.glbFile), suppliedUuid ?? requestedUuid)
      if (options.nativeBobj !== undefined && options.nativeBobj !== nativeBobj) throw new Error('Edited native BOBJ does not match the GLB')
    }
    const inspected = inspectEditedGlb(root, options.glbFile, editedSource.rig, manifestContract)
    const editedHash = createHash('sha256').update(readFileSync(options.glbFile)).digest('hex')
    const existing = index.actions.find((action) => action.uuid.toLowerCase() === requestedUuid.toLowerCase())
    if (existing) {
      if (existing.ownerCharId === character.charId && existing.variantOf === source.variantOf && existing.parentUuid === (source.parentUuid ?? source.uuid) && existing.status === 'edited' && existing.rig === editedSource.rig && createHash('sha256').update(readFileSync(safeChild(root, 'packs', existing.packId, 'anim.glb'))).digest('hex') === editedHash && (nativeBobj === undefined || readFileSync(safeChild(root, 'packs', existing.packId, 'anim.original.bbs.bobj'), 'utf8') === nativeBobj)) return existing
      throw new Error('Requested actionUuid already belongs to a different action')
    }
    const chain = index.actions.filter((action) => action.ownerCharId === character.charId && action.variantOf === source.variantOf)
    const version = Math.max(...chain.map((action) => action.version ?? 0)) + 1
    const created = createVersionPack(root, { source: editedSource, ownerCharId: character.charId, glbFile: options.glbFile, uuid: requestedUuid,
      status: status(options.status), version, variantOf: source.variantOf, parentUuid: source.parentUuid ?? source.uuid,
      notes: options.notes, preserveAnimationIndex: false, durationSeconds: inspected.durationSeconds,
      license: sourceLicense(root, source), manifestContract, nativeBobj })
    character.actions = [...memberships(root, character, index.actions), created.uuid]
    writeCharacter(root, character); writeIndex(root)
    return created
  })
}

export function setCharacterActionStatus(options: LibraryOptions & { charId: string; actionUuid: string; status: CharacterActionStatus }): IndexedAction {
  const root = resolveLibraryPath(options)
  return withLibraryLock(root, () => {
    initializeLibrary(root)
    const index = writeIndex(root), character = characterAt(root, options.charId), selected = actionAt(index.actions, options.actionUuid)
    if (selected.ownerCharId !== character.charId || !memberships(root, character, index.actions).includes(selected.uuid)) throw new Error('Action does not belong to this character')
    const metaPath = safeChild(root, 'packs', selected.packId, 'meta.json'), pack = readJsonFile<MotionPackMetadata>(metaPath)
    const action = pack.actions.find((candidate) => candidate.uuid === selected.uuid)!
    action.status = status(options.status)
    writeJsonAtomic(metaPath, pack)
    return writeIndex(root).actions.find((candidate) => candidate.uuid === selected.uuid)!
  })
}

/**
 * Draft from a GLB that App 1 converted for this character (e.g. Mixamo65 -> Minecraft20), linked to the raw shared Action it
 * came from. Unlike importPack + addDraftToCharacter it leaves no intermediate pack in the shared store.
 */
export function addConvertedDraftToCharacter(options: LibraryOptions & {
  charId: string; parentUuid: string; glbFile: string; rig: string; durationSeconds?: number
  manifestContract?: Pick<NormalizedManifest, 'version' | 'extraBoneMode' | 'extraBones'>
  favorite?: boolean
}): IndexedAction {
  const root = resolveLibraryPath(options)
  return withLibraryLock(root, () => {
    initializeLibrary(root)
    const index = writeIndex(root), character = characterAt(root, options.charId), parent = actionAt(index.actions, options.parentUuid)
    if (parent.ownerCharId) throw new Error('Converted draft parent must be a raw library action')
    if (!compatibleRig(character.rig, options.rig)) throw new Error(`Rig mismatch: character ${character.rig}, action ${options.rig}`)
    if (!existsSync(options.glbFile)) throw new Error('Converted GLB file does not exist')
    const source: IndexedAction = { ...parent, rig: options.rig, glbAnimationIndex: 0 }
    validatePackGlbContract(options.glbFile, {
      version: options.manifestContract?.version ?? '1.0.0', rig: options.rig, ...options.manifestContract,
      actions: [{ uuid: parent.uuid, name: parent.name, durationSeconds: options.durationSeconds ?? parent.durationSeconds, fps: parent.fps, glbAnimationIndex: 0 }],
    } as NormalizedManifest)
    const uuid = randomUUID()
    const created = createVersionPack(root, { source, ownerCharId: character.charId, glbFile: options.glbFile, uuid,
      status: 'draft', version: 1, variantOf: uuid, parentUuid: parent.uuid, preserveAnimationIndex: false,
      durationSeconds: options.durationSeconds, license: sourceLicense(root, parent), manifestContract: options.manifestContract, favorite: options.favorite })
    character.actions = [...new Set([...memberships(root, character, index.actions), created.uuid])]
    writeCharacter(root, character); writeIndex(root)
    return created
  })
}

export function copyActionToCharacter(options: LibraryOptions & { actionUuid: string; toCharId: string }): IndexedAction {
  const root = resolveLibraryPath(options)
  return withLibraryLock(root, () => {
    initializeLibrary(root)
    const index = writeIndex(root), target = characterAt(root, options.toCharId), source = actionAt(index.actions, options.actionUuid)
    if (!compatibleRig(target.rig, source.rig)) throw new Error(`Rig mismatch: character ${target.rig}, action ${source.rig}`)
    const uuid = randomUUID()
    // A copied native (BOBJ-rig) Action needs its sidecar rebuilt against the TARGET character's
    // base model, exactly like an edited version; without it library.place cannot load the copy
    // through the native path (anim.bobj / anim.original.bbs.bobj would be missing).
    let nativeBobj: string | undefined
    if (['verity', 'minecraft20'].includes(source.rig) && target.baseModelId) {
      const model = readJsonFile<BaseModelMetadata>(safeChild(root, 'models', target.baseModelId, 'meta.json'))
      if (model.format === 'bobj' && model.rig === source.rig) {
        const original = readFileSync(safeChild(root, 'models', target.baseModelId, model.model))
        if (createHash('sha256').update(original).digest('hex') === model.sha256) {
          try { nativeBobj = nativeActionBobj(original, readFileSync(safeChild(root, 'packs', source.packId, 'anim.glb')), uuid) } catch { nativeBobj = undefined }
        }
      }
    }
    const created = createVersionPack(root, { source, ownerCharId: target.charId, glbFile: safeChild(root, 'packs', source.packId, 'anim.glb'), uuid,
      status: 'draft', version: 1, variantOf: uuid, parentUuid: source.uuid, preserveAnimationIndex: true,
      license: sourceLicense(root, source), manifestContract: sourceManifestContract(root, source), favorite: false, nativeBobj })
    target.actions = [...new Set([...memberships(root, target, index.actions), created.uuid])]
    writeCharacter(root, target); writeIndex(root)
    return created
  })
}

export function listCharacterActions(options: LibraryOptions & { charId: string; status?: CharacterActionStatus; latestOnly?: boolean }): IndexedAction[] {
  const root = resolveLibraryPath(options)
  return withLibraryLock(root, () => {
    initializeLibrary(root)
    const index = writeIndex(root), character = characterAt(root, options.charId), ids = new Set(memberships(root, character, index.actions))
    let actions = index.actions.filter((action) => ids.has(action.uuid) && action.ownerCharId === character.charId)
    if (options.latestOnly) {
      const latest = new Map<string, IndexedAction>()
      for (const action of actions) {
        const key = action.variantOf ?? action.uuid, previous = latest.get(key)
        if (!previous || (action.version ?? 0) > (previous.version ?? 0)) latest.set(key, action)
      }
      actions = [...latest.values()]
    }
    if (options.status) actions = actions.filter((action) => action.status === options.status)
    return actions.sort((a, b) => Number(!!b.favorite) - Number(!!a.favorite) || (a.variantOf ?? a.uuid).localeCompare(b.variantOf ?? b.uuid) || (a.version ?? 0) - (b.version ?? 0))
  })
}

export function removeCharacterAction(options: LibraryOptions & { charId: string; actionUuid: string }): CharacterMetadata {
  const root = resolveLibraryPath(options)
  return withLibraryLock(root, () => {
    initializeLibrary(root)
    const index = writeIndex(root), character = characterAt(root, options.charId), action = actionAt(index.actions, options.actionUuid)
    if (action.ownerCharId !== character.charId) throw new Error('Action does not belong to this character')
    character.actions = memberships(root, character, index.actions).filter((uuid) => uuid.toLowerCase() !== action.uuid.toLowerCase())
    if (character.defaultAction?.toLowerCase() === action.uuid.toLowerCase()) delete character.defaultAction
    writeCharacter(root, character); writeIndex(root)
    return withCharacterDefaults(character)
  })
}

export function setCharacterProfile(options: LibraryOptions & {
  charId: string; personality?: CharacterPersonality; requiredActions?: RequiredAction[]
}): CharacterMetadata {
  const root = resolveLibraryPath(options)
  return withLibraryLock(root, () => {
    initializeLibrary(root)
    const character = characterAt(root, options.charId)
    if (options.personality) {
      if (typeof options.personality.summary !== 'string' || !Array.isArray(options.personality.traits) || options.personality.traits.some((trait) => typeof trait !== 'string' || !trait.trim())) throw new Error('Invalid personality')
      character.personality = { summary: options.personality.summary.trim(), traits: [...new Set(options.personality.traits.map((trait) => trait.trim()))] }
    }
    if (options.requiredActions) {
      const seen = new Set<string>()
      if (options.requiredActions.some(({ key, label }) => !/^[A-Za-z0-9_-]+$/.test(key) || !label.trim() || seen.has(key) || !seen.add(key))) throw new Error('Invalid or duplicate required action')
      character.requiredActions = options.requiredActions.map(({ key, label }) => ({ key, label: label.trim() }))
    }
    const updated = withCharacterDefaults(character)
    writeCharacter(root, updated); writeIndex(root)
    return updated
  })
}

export function coverageMatrix(options: LibraryOptions & { charIds?: string[] } = {}): CharacterCoverage[] {
  const root = resolveLibraryPath(options)
  return withLibraryLock(root, () => {
    initializeLibrary(root)
    const index = writeIndex(root), requested = options.charIds ? new Set(options.charIds.map((id) => safeId(id, 'character id'))) : null
    return index.characters.filter((character) => !requested || requested.has(character.charId)).map((raw) => {
      const character = withCharacterDefaults(raw), ids = new Set(memberships(root, raw, index.actions))
      const owned = index.actions.filter((action) => ids.has(action.uuid) && action.ownerCharId === character.charId)
      const latest = new Map<string, IndexedAction>()
      for (const action of owned) {
        const key = action.variantOf ?? action.uuid, previous = latest.get(key)
        if (!previous || (action.version ?? 0) > (previous.version ?? 0)) latest.set(key, action)
      }
      const actions = [...latest.values()]
      return { charId: character.charId, name: character.name, cells: character.requiredActions!.map(({ key, label }) => {
        const matching = actions.filter((action) => action.tags.some((tag) => tag.toLowerCase() === key.toLowerCase()))
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.uuid.localeCompare(a.uuid))
        const action = matching[0] ?? null
        return { key, label, action, status: action?.status ?? null }
      }) }
    })
  })
}
