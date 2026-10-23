export { ACTION_CATEGORIES, CHARACTER_ACTION_STATUSES, DEFAULT_REQUIRED_ACTIONS, LIBRARY_VERSION } from './types'
export type {
  ActionCategory, ActionMetadata, CharacterActionStatus, CharacterCoverage, CharacterMetadata, CharacterPersonality,
  CoverageCell, IndexedAction, LibraryConfig, LibraryIndex, LibraryLicense, LibraryOptions, MotionPackMetadata,
  NormalizedAction, NormalizedManifest, RequiredAction, SearchOptions,
} from './types'
export { defaultLibraryPath, resolveLibraryPath } from './store'
export { importNormalizedPack, updateActionMetadata, validatePackAssetPath } from './importPack'
export type { ImportPackOptions, ImportPackResult } from './importPack'
export { getAction, importPack, listLibraryCharacters, rebuildLibraryIndex, registerLibraryCharacter, searchLibrary, setActionMetadata } from './library'
export type { SearchResult } from './library'
export { callLibraryTool, LIBRARY_MCP_TOOLS } from './mcp'

export { registerBaseModel, createCharacter, setCharacterSkin, addCharacterActions, removeCharacterActions, resolveCharacter } from './characters'
export type { RegisterBaseModelOptions, CreateCharacterOptions } from './characters'
export type { BaseModelMetadata, CharacterWarning, ResolvedCharacter } from './types'
export {
  addDraftToCharacter, copyActionToCharacter, coverageMatrix, listCharacterActions, removeCharacterAction,
  saveCharacterActionVersion, setCharacterActionStatus, setCharacterProfile,
} from './characterActions'
