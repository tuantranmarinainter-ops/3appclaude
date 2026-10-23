import { randomUUID } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { basename, extname } from 'node:path'
import { importNormalizedPack, updateActionMetadata, type ImportPackOptions, type ImportPackResult } from './importPack'
import { initializeLibrary, readJsonFile, resolveLibraryPath, safeChild, safeId, withLibraryLock, writeIndex, writeJsonAtomic } from './store'
import { LIBRARY_VERSION, type ActionCategory, type CharacterMetadata, type IndexedAction, type LibraryIndex, type LibraryOptions, type LibraryLicense, type SearchOptions } from './types'

export interface SearchResult {
  total: number
  offset: number
  limit: number
  items: IndexedAction[]
}

export function searchLibrary(options: LibraryOptions & SearchOptions = {}): SearchResult {
  const root = resolveLibraryPath(options)
  return withLibraryLock(root, () => {
    initializeLibrary(root)
    const index = writeIndex(root)
    const selectedCharacter = options.boundCharacter ? index.characters.find((character) => character.charId === options.boundCharacter) : undefined
    const query = options.text?.trim().toLocaleLowerCase()
    const tags = options.tags?.map((tag) => tag.toLocaleLowerCase()) ?? []
    const matches = index.actions.filter((action) =>
      (!options.rig || action.rig === options.rig) &&
      (!options.category || action.category === options.category) &&
      (!options.boundCharacter || (selectedCharacter?.actions ? selectedCharacter.actions.includes(action.uuid) : action.boundCharacter === options.boundCharacter)) &&
      tags.every((tag) => action.tags.some((candidate) => candidate.toLocaleLowerCase() === tag)) &&
      (!query || [action.name, action.rig, action.category, ...action.tags].some((value) => value.toLocaleLowerCase().includes(query)))
    ).sort((a, b) => a.name.localeCompare(b.name) || a.uuid.localeCompare(b.uuid))
    const offset = Math.max(0, Math.floor(options.offset ?? 0))
    const limit = Math.max(1, Math.min(100, Math.floor(options.limit ?? 50)))
    return { total: matches.length, offset, limit, items: matches.slice(offset, offset + limit) }
  })
}

export function getAction(options: LibraryOptions & { actionUuid: string }): IndexedAction & { glbPath: string; manifestPath: string; coverPath: string | null } {
  const root = resolveLibraryPath(options)
  const action = searchLibrary({ root, limit: 100 }).items.find((item) => item.uuid.toLowerCase() === options.actionUuid.toLowerCase())
    ?? withLibraryLock(root, () => writeIndex(root).actions.find((item) => item.uuid.toLowerCase() === options.actionUuid.toLowerCase()))
  if (!action) throw new Error(`Action not found: ${options.actionUuid}`)
  const packDirectory = safeChild(root, 'packs', action.packId)
  const pack = readJsonFile<{ actions: Array<{ uuid: string; cover: string | null }> }>(safeChild(packDirectory, 'meta.json'))
  const packAction = pack.actions.find((item) => item.uuid.toLowerCase() === action.uuid.toLowerCase())
  const coverPath = packAction?.cover ? safeChild(packDirectory, ...packAction.cover.split('/')) : null
  return Object.assign({}, action, {
    glbPath: safeChild(packDirectory, 'anim.glb'),
    manifestPath: safeChild(packDirectory, 'anim.manifest.json'),
    coverPath: coverPath && existsSync(coverPath) ? coverPath : null,
  })
}

export function listLibraryCharacters(options: LibraryOptions = {}): CharacterMetadata[] {
  const root = resolveLibraryPath(options)
  return withLibraryLock(root, () => {
    initializeLibrary(root)
    const index = writeIndex(root)
    return index.characters.map((character) => ({ ...character,
      actions: character.actions ?? index.actions.filter((action) => action.boundCharacter === character.charId).map((action) => action.uuid),
    }))
  })
}

export function registerLibraryCharacter(options: LibraryOptions & {
  charId?: string
  name: string
  rig: string
  modelFile: string
  license?: LibraryLicense
  fingerprint?: string | null
}): CharacterMetadata {
  const root = resolveLibraryPath(options)
  const charId = safeId(options.charId ?? randomUUID(), 'character id')
  if (!options.name.trim()) throw new Error('Character name is required')
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*(?:\+[A-Za-z0-9][A-Za-z0-9_-]*)?$/.test(options.rig)) throw new Error('Invalid character rig id')
  const extension = extname(options.modelFile).toLowerCase()
  if (!['.glb', '.bobj'].includes(extension)) throw new Error('Character model must be a .glb or .bobj file')
  if (!statSync(options.modelFile).isFile()) throw new Error('Character model must be a regular file')
  const license = options.license ?? { id: 'internal-only', commitable: false, source: basename(options.modelFile) }
  if (!license.id.trim() || typeof license.commitable !== 'boolean') throw new Error('Character license requires an id and commitable boolean')
  const metadata: CharacterMetadata = {
    kind: 'character', charId, libraryVersion: LIBRARY_VERSION, name: options.name.trim(), rig: options.rig,
    createdAt: new Date().toISOString(), license: { ...license }, fingerprint: options.fingerprint ?? null,
    model: `model${extension}`,
  }
  return withLibraryLock(root, () => {
    initializeLibrary(root)
    const parent = safeChild(root, 'characters')
    const destination = safeChild(parent, charId)
    if (existsSync(destination)) throw new Error(`Character already exists: ${charId}`)
    const staging = safeChild(parent, `.${charId}.${process.pid}.tmp`)
    mkdirSync(staging)
    try {
      copyFileSync(options.modelFile, safeChild(staging, metadata.model))
      writeJsonAtomic(safeChild(staging, 'meta.json'), metadata)
      renameSync(staging, destination)
      writeIndex(root)
      return metadata
    } catch (error) { rmSync(staging, { recursive: true, force: true }); throw error }
  })
}

export function setActionMetadata(options: LibraryOptions & Omit<Parameters<typeof updateActionMetadata>[0], 'libraryRoot'>) {
  return updateActionMetadata({ ...options, libraryRoot: resolveLibraryPath(options) })
}

export function rebuildLibraryIndex(options: LibraryOptions = {}): LibraryIndex {
  const root = resolveLibraryPath(options)
  return withLibraryLock(root, () => { initializeLibrary(root); return writeIndex(root) })
}

export function importPack(options: Omit<ImportPackOptions, 'libraryRoot'> & LibraryOptions): ImportPackResult {
  return importNormalizedPack({ ...options, libraryRoot: resolveLibraryPath(options) })
}

export type { ActionCategory }

export { registerBaseModel, createCharacter, setCharacterSkin, addCharacterActions, removeCharacterActions, resolveCharacter } from './characters'
