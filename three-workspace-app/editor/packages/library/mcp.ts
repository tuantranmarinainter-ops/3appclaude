import { addCharacterActions, removeCharacterActions, getAction, listLibraryCharacters, searchLibrary, type SearchResult } from './library'
import type { CharacterMetadata, IndexedAction, LibraryOptions, SearchOptions } from './types'
import { ACTION_CATEGORIES } from './types'

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
        boundCharacter: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 100 }, offset: { type: 'integer', minimum: 0 },
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
export function callLibraryTool(name: string, input: unknown, options?: LibraryOptions): CharacterMetadata | SearchResult | CharacterMetadata[] | (IndexedAction & { glbPath: string; manifestPath: string; coverPath: string | null })
export function callLibraryTool(name: string, input: unknown, options: LibraryOptions = {}) {
  const args = object(input)
  if (name === 'library.search') {
    if (args.rig !== undefined && typeof args.rig !== 'string') throw new Error('rig must be a string')
    if (args.category !== undefined && (typeof args.category !== 'string' || !(ACTION_CATEGORIES as readonly string[]).includes(args.category))) throw new Error('Invalid category')
    if (args.tags !== undefined && (!Array.isArray(args.tags) || !args.tags.every((tag) => typeof tag === 'string'))) throw new Error('tags must be an array of strings')
    if (args.text !== undefined && typeof args.text !== 'string') throw new Error('text must be a string')
    if (args.boundCharacter !== undefined && typeof args.boundCharacter !== 'string') throw new Error('boundCharacter must be a string')
    if (args.limit !== undefined && (!Number.isSafeInteger(args.limit) || (args.limit as number) < 1 || (args.limit as number) > 100)) throw new Error('limit must be an integer between 1 and 100')
    if (args.offset !== undefined && (!Number.isSafeInteger(args.offset) || (args.offset as number) < 0)) throw new Error('offset must be a non-negative integer')
    const query: SearchOptions = {
      ...(typeof args.rig === 'string' ? { rig: args.rig } : {}),
      ...(typeof args.category === 'string' ? { category: args.category as SearchOptions['category'] } : {}),
      ...(Array.isArray(args.tags) && args.tags.every((tag) => typeof tag === 'string') ? { tags: args.tags as string[] } : {}),
      ...(typeof args.text === 'string' ? { text: args.text } : {}),
      ...(typeof args.boundCharacter === 'string' ? { boundCharacter: args.boundCharacter } : {}),
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
  throw new Error(`Unknown library tool: ${name}`)
}
