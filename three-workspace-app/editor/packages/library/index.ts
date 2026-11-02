export { ACTION_CATEGORIES, CHARACTER_ACTION_STATUSES, DEFAULT_REQUIRED_ACTIONS, LIBRARY_VERSION } from './types'
export { ACTION_NAME_GLOSSARY, formatBilingual, translateActionName } from './actionNames'
export type { ActionNameTranslationSource } from './actionNames'
export type {
  ActionCategory, ActionMetadata, CharacterActionStatus, CharacterCoverage, CharacterMetadata, CharacterPersonality,
  CoverageCell, IndexedAction, LibraryConfig, LibraryIndex, LibraryLicense, LibraryOptions, MotionPackMetadata,
  NormalizedAction, NormalizedManifest, RequiredAction, SearchOptions,
} from './types'
export { defaultLibraryPath, resolveLibraryPath, withIndexSnapshot } from './store'
export { importNormalizedPack, updateActionMetadata, validatePackAssetPath } from './importPack'
export type { ImportPackOptions, ImportPackResult } from './importPack'
export { getAction, importPack, listLibraryCharacters, rebuildLibraryIndex, registerLibraryCharacter, searchLibrary, setActionMetadata, setActionPreview } from './library'
export type { SearchResult } from './library'
export { callLibraryTool, LIBRARY_MCP_TOOLS } from './mcp'

export { registerBaseModel, createCharacter, createCharacterWithOwnBase, setCharacterSkin, setCharacterBaseModel, addCharacterActions, removeCharacterActions, resolveCharacter } from './characters'
export type { RegisterBaseModelOptions, CreateCharacterOptions } from './characters'
export type { BaseModelMetadata, CharacterWarning, ResolvedCharacter } from './types'
export {
  addConvertedDraftToCharacter, addDraftToCharacter, copyActionToCharacter, coverageMatrix, listCharacterActions, removeCharacterAction,
  saveCharacterActionVersion, setCharacterActionStatus, setCharacterProfile,
} from './characterActions'

export { characterHeightBlocks } from './characterHeight'
