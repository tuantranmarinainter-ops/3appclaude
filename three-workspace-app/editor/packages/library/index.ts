export { ACTION_CATEGORIES, LIBRARY_VERSION } from './types.ts'
export type {
  ActionCategory, ActionMetadata, CharacterMetadata, IndexedAction, LibraryConfig, LibraryIndex, LibraryLicense,
  LibraryOptions, MotionPackMetadata, NormalizedAction, NormalizedManifest, SearchOptions,
} from './types.ts'
export { defaultLibraryPath, resolveLibraryPath } from './store.ts'
export { importNormalizedPack, updateActionMetadata, validatePackAssetPath } from './importPack.ts'
export type { ImportPackOptions, ImportPackResult } from './importPack.ts'
export { getAction, importPack, listLibraryCharacters, rebuildLibraryIndex, registerLibraryCharacter, searchLibrary, setActionMetadata } from './library.ts'
export type { SearchResult } from './library.ts'
export { callLibraryTool, LIBRARY_MCP_TOOLS } from './mcp.ts'
