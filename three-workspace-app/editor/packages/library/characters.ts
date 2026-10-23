import { createHash, randomUUID } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync } from 'node:fs'
import { basename, dirname, extname } from 'node:path'
import { ensureRegularFile, initializeLibrary, readJsonFile, resolveLibraryPath, safeChild, safeId, validateRelativeAssetPath, withLibraryLock, writeIndex, writeJsonAtomic } from './store'
import { LIBRARY_VERSION, type BaseModelMetadata, type CharacterMetadata, type CharacterWarning, type LibraryLicense, type LibraryOptions, type ResolvedCharacter } from './types'

function rigId(rig: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*(?:\+[A-Za-z0-9][A-Za-z0-9_-]*)?$/.test(rig)) throw new Error('Invalid rig id')
  return rig
}
function name(value: string): string {
  if (!value.trim()) throw new Error('Name is required')
  return value.trim()
}
function texturePath(root: string, object: string): string {
  validateRelativeAssetPath(object)
  return safeChild(root, ...object.split('/'), 'default.png')
}
function missing(objects: string[], textures: Record<string, string>): CharacterWarning[] {
  return objects.filter((object) => !textures[object]).map((object) => ({ code: 'MISSING_TEXTURE', object, message: `Missing texture for object ${object}` }))
}
function copyTextures(source: string | undefined, target: string, objects: string[], defaults?: string): void {
  if (!source) return
  for (const object of objects) {
    const from = texturePath(source, object)
    if (!existsSync(from)) continue
    ensureRegularFile(from)
    const original = defaults ? texturePath(defaults, object) : undefined
    if (original && existsSync(original)) {
      ensureRegularFile(original)
      if (readFileSync(from).equals(readFileSync(original))) continue
    }
    const to = texturePath(target, object)
    mkdirSync(dirname(to), { recursive: true })
    copyFileSync(from, to)
  }
}
function texturesFor(objects: string[], defaults: string, overrides?: string): Record<string, string> {
  const result: Record<string, string> = Object.create(null) as Record<string, string>
  for (const object of objects) {
    const base = texturePath(defaults, object), skin = overrides ? texturePath(overrides, object) : undefined
    const path = skin && existsSync(skin) ? skin : existsSync(base) ? base : undefined
    if (path) { ensureRegularFile(path); result[object] = path }
  }
  return result
}

/** Read structural metadata without loading textures, rewriting the model or depending on a retarget preset. */
function inspectModel(bytes: Buffer, format: 'glb' | 'bobj') {
  const objects: string[] = [], bones: string[] = [], extraBones: string[] = [], heights: number[] = []
  if (format === 'bobj') {
    const text = bytes.toString('utf8')
    const scale = Number(text.match(/\bBBSFix[^\r\n]*\bmotion_scale=([\d.eE+-]+)/)?.[1] ?? 1)
    if (!(scale > 0) || !Number.isFinite(scale)) throw new Error('Invalid BOBJ motion_scale')
    for (const line of text.split(/\r?\n/)) {
      const parts = line.trim().split(/\s+/)
      if (parts[0] === 'o') objects.push(parts.slice(1).join(' '))
      if (parts[0] === 'arm_bone' && parts[1]) bones.push(parts[1])
      if (parts[0] === 'v' && parts.length >= 4) heights.push(Number(parts[2]) * scale)
    }
    extraBones.push(...bones.filter((bone) => /^X_|jaw|wing/i.test(bone)))
  } else {
    if (bytes.length < 20 || bytes.toString('ascii', 0, 4) !== 'glTF' || bytes.readUInt32LE(4) !== 2 || bytes.readUInt32LE(8) !== bytes.length || bytes.readUInt32LE(16) !== 0x4e4f534a || bytes.readUInt32LE(12) > bytes.length - 20) throw new Error('Model must be a valid GLB 2.0 file')
    const gltf = JSON.parse(bytes.toString('utf8', 20, 20 + bytes.readUInt32LE(12))) as {
      nodes?: Array<{ name?: string; mesh?: number; children?: number[]; matrix?: number[]; translation?: number[]; rotation?: number[]; scale?: number[] }>
      meshes?: Array<{ name?: string; primitives: Array<{ attributes?: { POSITION?: number } }> }>
      skins?: Array<{ joints?: number[] }>
      accessors?: Array<{ min?: number[]; max?: number[] }>
    }
    const nodes = gltf.nodes ?? [], parents = new Map<number, number>()
    for (const [index, node] of nodes.entries()) for (const child of node.children ?? []) parents.set(child, index)
    const worldPoint = (index: number, point: number[], visited = new Set<number>()): number[] => {
      if (visited.has(index)) throw new Error('GLB node hierarchy contains a cycle')
      visited.add(index)
      const node = nodes[index]
      if (!node) throw new Error('Invalid GLB node reference')
      let transformed: number[]
      if (node.matrix) {
        const m = node.matrix, [x, y, z] = point
        transformed = [0, 1, 2].map((axis) => m[axis]! * x! + m[4 + axis]! * y! + m[8 + axis]! * z! + m[12 + axis]!)
      } else {
        const scale = node.scale ?? [1, 1, 1], q = node.rotation ?? [0, 0, 0, 1], translation = node.translation ?? [0, 0, 0]
        const [x, y, z] = point.map((value, axis) => value * scale[axis]!) as [number, number, number]
        const [qx, qy, qz, qw] = q as [number, number, number, number]
        const tx = 2 * (qy * z - qz * y), ty = 2 * (qz * x - qx * z), tz = 2 * (qx * y - qy * x)
        transformed = [x + qw * tx + qy * tz - qz * ty, y + qw * ty + qz * tx - qx * tz, z + qw * tz + qx * ty - qy * tx]
          .map((value, axis) => value + translation[axis]!)
      }
      const parent = parents.get(index)
      return parent === undefined ? transformed : worldPoint(parent, transformed, visited)
    }
    for (const index of new Set((gltf.skins ?? []).flatMap((skin) => skin.joints ?? []))) {
      if (!nodes[index]?.name) throw new Error(`GLB joint ${index} has no name`)
      bones.push(nodes[index]!.name!)
    }
    extraBones.push(...bones.filter((bone) => /^X_|jaw|wing/i.test(bone)))
    for (const [index, node] of nodes.entries()) {
      if (node.mesh === undefined) continue
      const mesh = gltf.meshes?.[node.mesh]
      if (!mesh) throw new Error('Invalid GLB mesh reference')
      objects.push(node.name ?? mesh.name ?? `mesh_${node.mesh}`)
      for (const primitive of mesh.primitives) {
        const accessor = gltf.accessors?.[primitive.attributes?.POSITION ?? -1]
        if (!accessor?.min || !accessor.max) continue
        for (let mask = 0; mask < 8; mask++) heights.push(worldPoint(index, [0, 1, 2].map((axis) => ((mask >> axis) & 1) ? accessor.max![axis]! : accessor.min![axis]!))[1]!)
      }
    }
  }
  if (!objects.length || !bones.length) throw new Error('Base model requires named objects and bones')
  for (const object of objects) validateRelativeAssetPath(object)
  if (new Set(objects).size !== objects.length || new Set(bones).size !== bones.length) throw new Error('Model contains duplicate object or bone names')
  if (heights.some((height) => !Number.isFinite(height))) throw new Error('Invalid model height')
  let minimum = Infinity, maximum = -Infinity
  for (const height of heights) { minimum = Math.min(minimum, height); maximum = Math.max(maximum, height) }
  const heightMeters = heights.length ? maximum - minimum : 0
  return { objects, bones, extraBones, heightMeters }
}

export interface RegisterBaseModelOptions extends LibraryOptions {
  name: string
  rig: string
  modelFile: string
  /** Directory containing <object>/default.png. Defaults to textures/ beside the model. */
  texturesDir?: string
  license?: LibraryLicense
}
export function registerBaseModel(options: RegisterBaseModelOptions): { modelId: string; created: boolean; metadata: BaseModelMetadata; warnings: CharacterWarning[] } {
  const root = resolveLibraryPath(options)
  const modelName = name(options.name), rig = rigId(options.rig)
  const extension = extname(options.modelFile).toLowerCase()
  if (extension !== '.glb' && extension !== '.bobj') throw new Error('Base model must be .glb or .bobj')
  ensureRegularFile(options.modelFile)
  const bytes = readFileSync(options.modelFile), format = extension === '.glb' ? 'glb' : 'bobj'
  const sha256 = createHash('sha256').update(bytes).digest('hex'), modelId = sha256.slice(0, 16)
  const license = options.license ?? { id: 'internal-only', commitable: false, source: basename(options.modelFile) }
  if (!license.id.trim() || typeof license.commitable !== 'boolean') throw new Error('Invalid license')
  const metadata: BaseModelMetadata = { kind: 'base-model', libraryVersion: LIBRARY_VERSION, modelId, name: modelName, rig, format,
    model: format === 'glb' ? 'model.glb' : 'model.bbs.bobj', ...inspectModel(bytes, format), sha256, license: { ...license } }
  return withLibraryLock(root, () => {
    initializeLibrary(root)
    const destination = safeChild(root, 'models', modelId)
    let record = metadata, created = false
    if (existsSync(destination)) {
      record = readJsonFile<BaseModelMetadata>(safeChild(destination, 'meta.json'))
      if (record.sha256 !== sha256 || record.rig !== rig) throw new Error('Existing model SHA or rig does not match')
    } else {
      const staging = safeChild(root, 'models', `.${randomUUID()}.tmp`)
      mkdirSync(staging)
      try {
        copyFileSync(options.modelFile, safeChild(staging, metadata.model))
        copyTextures(options.texturesDir ?? safeChild(dirname(options.modelFile), 'textures'), safeChild(staging, 'textures'), metadata.objects)
        writeJsonAtomic(safeChild(staging, 'meta.json'), metadata)
        renameSync(staging, destination)
        created = true
      } catch (error) { rmSync(staging, { recursive: true, force: true }); throw error }
    }
    return { modelId, created, metadata: record, warnings: missing(record.objects, texturesFor(record.objects, safeChild(destination, 'textures'))) }
  })
}

function characterRecord(root: string, charId: string): CharacterMetadata {
  const record = readJsonFile<CharacterMetadata>(safeChild(root, 'characters', safeId(charId, 'character id'), 'meta.json'))
  if (record.kind !== 'character' || record.charId !== charId) throw new Error('Invalid character metadata')
  return record
}
function baseRecord(root: string, id: string): BaseModelMetadata {
  const record = readJsonFile<BaseModelMetadata>(safeChild(root, 'models', safeId(id, 'model id'), 'meta.json'))
  if (record.kind !== 'base-model' || record.modelId !== id) throw new Error('Invalid base model metadata')
  return record
}
export interface CreateCharacterOptions extends LibraryOptions {
  charId?: string
  name: string
  baseModelId: string
  /** Directory containing only the <object>/default.png overrides. */
  skinDir?: string
  actions?: string[]
  defaultAction?: string
  license?: LibraryLicense
}
export function createCharacter(options: CreateCharacterOptions): CharacterMetadata {
  const root = resolveLibraryPath(options), charId = safeId(options.charId ?? randomUUID(), 'character id'), characterName = name(options.name)
  return withLibraryLock(root, () => {
    initializeLibrary(root)
    const base = baseRecord(root, options.baseModelId)
    const actions = validateActions(root, options.actions ?? [])
    const defaultAction = options.defaultAction ? actions.find((uuid) => uuid.toLowerCase() === options.defaultAction!.toLowerCase()) : undefined
    if (options.defaultAction && !defaultAction) throw new Error('defaultAction must belong to character actions')
    const license = options.license ?? base.license
    if (!license.id.trim() || typeof license.commitable !== 'boolean') throw new Error('Invalid license')
    const metadata: CharacterMetadata = { kind: 'character', libraryVersion: LIBRARY_VERSION, charId, name: characterName, rig: base.rig,
      createdAt: new Date().toISOString(), license: { ...license }, model: base.model,
      baseModelId: base.modelId, skin: options.skinDir ? 'skin/textures' : null, actions, ...(defaultAction ? { defaultAction } : {}) }
    const destination = safeChild(root, 'characters', charId), staging = safeChild(root, 'characters', `.${randomUUID()}.tmp`)
    if (existsSync(destination)) throw new Error(`Character already exists: ${charId}`)
    mkdirSync(staging)
    try {
      copyTextures(options.skinDir, safeChild(staging, 'skin', 'textures'), base.objects, safeChild(root, 'models', base.modelId, 'textures'))
      writeJsonAtomic(safeChild(staging, 'meta.json'), metadata)
      renameSync(staging, destination)
      writeIndex(root)
      return metadata
    } catch (error) { rmSync(staging, { recursive: true, force: true }); throw error }
  })
}
function validateActions(root: string, uuids: string[]): string[] {
  const actions = writeIndex(root).actions
  return [...new Set(uuids.map((uuid) => {
    const action = actions.find((item) => item.uuid.toLowerCase() === uuid.toLowerCase())
    if (!action) throw new Error(`Action not found: ${uuid}`)
    return action.uuid
  }))]
}
export function setCharacterSkin(options: LibraryOptions & { charId: string; skinDir?: string }): CharacterMetadata {
  const root = resolveLibraryPath(options)
  return withLibraryLock(root, () => {
    const character = characterRecord(root, options.charId)
    if (!character.baseModelId) throw new Error('Legacy character has no base model')
    const base = baseRecord(root, character.baseModelId), directory = safeChild(root, 'characters', character.charId)
    const staging = safeChild(directory, `.skin-${randomUUID()}.tmp`), backup = safeChild(directory, `.skin-${randomUUID()}.bak`), skin = safeChild(directory, 'skin')
    mkdirSync(staging)
    let backedUp = false, installed = false
    try {
      copyTextures(options.skinDir, safeChild(staging, 'textures'), base.objects, safeChild(root, 'models', base.modelId, 'textures'))
      if (existsSync(skin)) { renameSync(skin, backup); backedUp = true }
      renameSync(staging, skin); installed = true
      character.skin = options.skinDir ? 'skin/textures' : null
      writeJsonAtomic(safeChild(directory, 'meta.json'), character)
    } catch (error) {
      if (installed) rmSync(skin, { recursive: true, force: true })
      if (backedUp) renameSync(backup, skin)
      throw error
    } finally { rmSync(staging, { recursive: true, force: true }) }
    rmSync(backup, { recursive: true, force: true })
    writeIndex(root)
    return character
  })
}
export function addCharacterActions(options: LibraryOptions & { charId: string; actions: string[]; defaultAction?: string }): CharacterMetadata {
  return changeActions(options, false)
}
export function removeCharacterActions(options: LibraryOptions & { charId: string; actions: string[] }): CharacterMetadata {
  return changeActions(options, true)
}
function changeActions(options: LibraryOptions & { charId: string; actions: string[]; defaultAction?: string }, remove: boolean): CharacterMetadata {
  const root = resolveLibraryPath(options)
  return withLibraryLock(root, () => {
    initializeLibrary(root)
    const character = characterRecord(root, options.charId)
    const currentActions = character.actions ?? writeIndex(root).actions.filter((action) => action.boundCharacter === character.charId).map((action) => action.uuid)
    const requested = remove ? options.actions.map((uuid) => uuid.toLowerCase()) : validateActions(root, options.actions)
    character.actions = remove ? currentActions.filter((uuid) => !requested.includes(uuid.toLowerCase())) : [...new Set([...currentActions, ...requested])]
    if (options.defaultAction) {
      const canonical = character.actions.find((uuid) => uuid.toLowerCase() === options.defaultAction!.toLowerCase())
      if (!canonical) throw new Error('defaultAction must belong to character actions')
      character.defaultAction = canonical
    }
    if (character.defaultAction && !character.actions.includes(character.defaultAction)) delete character.defaultAction
    writeJsonAtomic(safeChild(root, 'characters', character.charId, 'meta.json'), character)
    writeIndex(root)
    return character
  })
}
export function resolveCharacter(charId: string, options?: LibraryOptions): ResolvedCharacter
export function resolveCharacter(options: LibraryOptions & { charId: string }): ResolvedCharacter
export function resolveCharacter(input: string | (LibraryOptions & { charId: string }), configuration: LibraryOptions = {}): ResolvedCharacter {
  const options = typeof input === 'string' ? { ...configuration, charId: input } : input
  const root = resolveLibraryPath(options)
  return withLibraryLock(root, () => {
    initializeLibrary(root)
    const character = characterRecord(root, options.charId), directory = safeChild(root, 'characters', character.charId)
    const baseModel = character.baseModelId ? baseRecord(root, character.baseModelId) : null
    const modelDirectory = baseModel ? safeChild(root, 'models', baseModel.modelId) : directory
    const textures = texturesFor(baseModel?.objects ?? [], safeChild(modelDirectory, 'textures'), character.skin ? safeChild(directory, validateRelativeAssetPath(character.skin)) : undefined)
    const index = writeIndex(root)
    const actions = index.actions.filter((action) => character.actions ? character.actions.includes(action.uuid) : action.boundCharacter === character.charId)
    return { character, baseModel, modelPath: safeChild(modelDirectory, validateRelativeAssetPath(baseModel?.model ?? character.model)), textures, actions, warnings: missing(baseModel?.objects ?? [], textures) }
  })
}
