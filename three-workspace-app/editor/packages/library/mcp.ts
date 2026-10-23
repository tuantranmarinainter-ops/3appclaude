import { addCharacterActions, removeCharacterActions, getAction, listLibraryCharacters, searchLibrary, type SearchResult } from './library'
import { addDraftToCharacter, copyActionToCharacter, coverageMatrix, listCharacterActions, removeCharacterAction, saveCharacterActionVersion, setCharacterActionStatus, setCharacterProfile } from './characterActions'
import type { CharacterActionStatus, CharacterCoverage, CharacterMetadata, IndexedAction, LibraryOptions, SearchOptions } from './types'
import { ACTION_CATEGORIES, CHARACTER_ACTION_STATUSES } from './types'

export const LIBRARY_MCP_TOOLS = [
  {
    name: 'library.search',
    description: 'Search normalized animation actions by rig, category, tags and name.',
    inputSchema: {
      type: 'object', additionalProperties: false,
      properties: {
        rig: { type: 'string' },
        category: { type: 'string', enum: ['locomotion', 'idle', 'combat', 'emote', 'dance', 'gesture', 'interaction', 'hurt-fall', 'sit-lie', 'pose', 'other'] },
        tags: { type: 'array', items: { type: 'string' } }, text: { type: 'string' },
        boundCharacter: { type: 'string' }, ownerCharId: { type: 'string' }, status: { type: 'string', enum: CHARACTER_ACTION_STATUSES },
        limit: { type: 'integer', minimum: 1, maximum: 100 }, offset: { type: 'integer', minimum: 0 },
      },
    },
  },
  {
    name: 'library.get',
    description: 'Get an action record and paths to its immutable GLB and manifest.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['actionUuid'], properties: { actionUuid: { type: 'string' } } },
  },
  {
    name: 'library.characters',
    description: 'List registered character models and their rig identifiers.',
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
  },
  ...(['add', 'remove'] as const).map((operation) => ({
    name: `library.character.actions.${operation}`,
    description: `${operation} action UUIDs in a character's action set.`,
    inputSchema: {
      type: 'object', additionalProperties: false, required: ['charId', 'actions'],
      properties: { charId: { type: 'string' }, actions: { type: 'array', items: { type: 'string' } },
        ...(operation === 'add' ? { defaultAction: { type: 'string' } } : {}) },
    },
  })),
  ...[
    ['library.character.action.draft', ['charId', 'actionUuid']],
    ['library.character.action.copy', ['actionUuid', 'toCharId']],
    ['library.character.action.version.save', ['charId', 'baseUuid', 'glbFile', 'status']],
    ['library.character.action.status.set', ['charId', 'actionUuid', 'status']],
    ['library.character.action.remove', ['charId', 'actionUuid']],
    ['library.character.actions.list', ['charId']],
    ['library.character.profile.set', ['charId']],
    ['library.character.coverage', []],
  ].map(([name, required]) => ({
    name: name as string, description: `Character animation library operation: ${name}.`,
    inputSchema: { type: 'object', additionalProperties: false, required,
      properties: {
        charId: { type: 'string' }, toCharId: { type: 'string' }, actionUuid: { type: 'string' }, baseUuid: { type: 'string' },
        glbFile: { type: 'string' }, status: { type: 'string', enum: CHARACTER_ACTION_STATUSES }, notes: { type: 'string' },
        latestOnly: { type: 'boolean' }, personality: { type: 'object' }, requiredActions: { type: 'array' }, charIds: { type: 'array', items: { type: 'string' } },
      } },
  })),
] as const

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Tool arguments must be an object')
  return value as Record<string, unknown>
}

/** Stateless MCP-side adapter; the host/MCP transport can delegate these local calls. */
export function callLibraryTool(name: 'library.search', input: unknown, options?: LibraryOptions): SearchResult
export function callLibraryTool(name: 'library.get', input: unknown, options?: LibraryOptions): IndexedAction & { glbPath: string; manifestPath: string; coverPath: string | null }
export function callLibraryTool(name: 'library.characters', input: unknown, options?: LibraryOptions): CharacterMetadata[]
export function callLibraryTool(name: 'library.character.actions.add' | 'library.character.actions.remove', input: unknown, options?: LibraryOptions): CharacterMetadata
export function callLibraryTool(name: 'library.character.action.draft' | 'library.character.action.copy' | 'library.character.action.version.save' | 'library.character.action.status.set', input: unknown, options?: LibraryOptions): IndexedAction
export function callLibraryTool(name: 'library.character.action.remove' | 'library.character.profile.set', input: unknown, options?: LibraryOptions): CharacterMetadata
export function callLibraryTool(name: 'library.character.actions.list', input: unknown, options?: LibraryOptions): IndexedAction[]
export function callLibraryTool(name: 'library.character.coverage', input: unknown, options?: LibraryOptions): CharacterCoverage[]
export function callLibraryTool(name: string, input: unknown, options?: LibraryOptions): CharacterMetadata | SearchResult | CharacterMetadata[] | CharacterCoverage[] | IndexedAction[] | IndexedAction | (IndexedAction & { glbPath: string; manifestPath: string; coverPath: string | null })
export function callLibraryTool(name: string, input: unknown, options: LibraryOptions = {}) {
  const args = object(input)
  if (name === 'library.search') {
    if (args.rig !== undefined && typeof args.rig !== 'string') throw new Error('rig must be a string')
    if (args.category !== undefined && (typeof args.category !== 'string' || !(ACTION_CATEGORIES as readonly string[]).includes(args.category))) throw new Error('Invalid category')
    if (args.tags !== undefined && (!Array.isArray(args.tags) || !args.tags.every((tag) => typeof tag === 'string'))) throw new Error('tags must be an array of strings')
    if (args.text !== undefined && typeof args.text !== 'string') throw new Error('text must be a string')
    if (args.boundCharacter !== undefined && typeof args.boundCharacter !== 'string') throw new Error('boundCharacter must be a string')
    if (args.ownerCharId !== undefined && typeof args.ownerCharId !== 'string') throw new Error('ownerCharId must be a string')
    if (args.status !== undefined && !(CHARACTER_ACTION_STATUSES as readonly unknown[]).includes(args.status)) throw new Error('Invalid status')
    if (args.limit !== undefined && (!Number.isSafeInteger(args.limit) || (args.limit as number) < 1 || (args.limit as number) > 100)) throw new Error('limit must be an integer between 1 and 100')
    if (args.offset !== undefined && (!Number.isSafeInteger(args.offset) || (args.offset as number) < 0)) throw new Error('offset must be a non-negative integer')
    const query: SearchOptions = {
      ...(typeof args.rig === 'string' ? { rig: args.rig } : {}),
      ...(typeof args.category === 'string' ? { category: args.category as SearchOptions['category'] } : {}),
      ...(Array.isArray(args.tags) && args.tags.every((tag) => typeof tag === 'string') ? { tags: args.tags as string[] } : {}),
      ...(typeof args.text === 'string' ? { text: args.text } : {}),
      ...(typeof args.boundCharacter === 'string' ? { boundCharacter: args.boundCharacter } : {}),
      ...(typeof args.ownerCharId === 'string' ? { ownerCharId: args.ownerCharId } : {}),
      ...(typeof args.status === 'string' ? { status: args.status as CharacterActionStatus } : {}),
      ...(typeof args.limit === 'number' ? { limit: args.limit } : {}),
      ...(typeof args.offset === 'number' ? { offset: args.offset } : {}),
    }
    return searchLibrary({ ...options, ...query })
  }
  if (name === 'library.get') {
    if (typeof args.actionUuid !== 'string') throw new Error('actionUuid is required')
    return getAction({ ...options, actionUuid: args.actionUuid })
  }
  if (name === 'library.characters') return listLibraryCharacters(options)
  if (name === 'library.character.actions.add' || name === 'library.character.actions.remove') {
    if (typeof args.charId !== 'string') throw new Error('charId is required')
    if (!Array.isArray(args.actions) || !args.actions.every((uuid) => typeof uuid === 'string')) throw new Error('actions must be an array of UUID strings')
    if (args.defaultAction !== undefined && typeof args.defaultAction !== 'string') throw new Error('defaultAction must be a string')
    const request = { ...options, charId: args.charId, actions: args.actions as string[] }
    return name === 'library.character.actions.add'
      ? addCharacterActions({ ...request, ...(typeof args.defaultAction === 'string' ? { defaultAction: args.defaultAction } : {}) })
      : removeCharacterActions(request)
  }
  const string = (key: string) => { if (typeof args[key] !== 'string') throw new Error(`${key} is required`); return args[key] as string }
  const optionalStatus = () => {
    if (args.status !== undefined && !(CHARACTER_ACTION_STATUSES as readonly unknown[]).includes(args.status)) throw new Error('Invalid status')
    return args.status as CharacterActionStatus | undefined
  }
  if (name === 'library.character.action.draft') return addDraftToCharacter({ ...options, charId: string('charId'), actionUuid: string('actionUuid') })
  if (name === 'library.character.action.copy') return copyActionToCharacter({ ...options, actionUuid: string('actionUuid'), toCharId: string('toCharId') })
  if (name === 'library.character.action.version.save') {
    if (args.status !== 'edited') throw new Error('Saved character action versions must have edited status')
    return saveCharacterActionVersion({ ...options, charId: string('charId'), baseUuid: string('baseUuid'), glbFile: string('glbFile'), status: 'edited', ...(typeof args.notes === 'string' ? { notes: args.notes } : {}) })
  }
  if (name === 'library.character.action.status.set') return setCharacterActionStatus({ ...options, charId: string('charId'), actionUuid: string('actionUuid'), status: optionalStatus()! })
  if (name === 'library.character.action.remove') return removeCharacterAction({ ...options, charId: string('charId'), actionUuid: string('actionUuid') })
  if (name === 'library.character.actions.list') {
    if (args.latestOnly !== undefined && typeof args.latestOnly !== 'boolean') throw new Error('latestOnly must be a boolean')
    return listCharacterActions({ ...options, charId: string('charId'), ...(optionalStatus() ? { status: optionalStatus() } : {}), ...(typeof args.latestOnly === 'boolean' ? { latestOnly: args.latestOnly } : {}) })
  }
  if (name === 'library.character.profile.set') {
    const personality = args.personality as Parameters<typeof setCharacterProfile>[0]['personality']
    const requiredActions = args.requiredActions as Parameters<typeof setCharacterProfile>[0]['requiredActions']
    return setCharacterProfile({ ...options, charId: string('charId'), ...(personality === undefined ? {} : { personality }), ...(requiredActions === undefined ? {} : { requiredActions }) })
  }
  if (name === 'library.character.coverage') {
    if (args.charIds !== undefined && (!Array.isArray(args.charIds) || !args.charIds.every((id) => typeof id === 'string'))) throw new Error('charIds must be an array of strings')
    return coverageMatrix({ ...options, ...(Array.isArray(args.charIds) ? { charIds: args.charIds as string[] } : {}) })
  }
  throw new Error(`Unknown library tool: ${name}`)
}
