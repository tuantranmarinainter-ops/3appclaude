export const LIBRARY_VERSION = '1.0.0' as const

export const ACTION_CATEGORIES = [
  'locomotion', 'idle', 'combat', 'emote', 'dance', 'gesture', 'interaction',
  'hurt-fall', 'sit-lie', 'pose', 'other',
] as const

export type ActionCategory = typeof ACTION_CATEGORIES[number]

export interface LibraryLicense {
  id: string
  commitable: boolean
  source?: string
}

export interface NormalizedAction {
  uuid: string
  name: string
  durationSeconds: number
  fps: number
  sourceActionIndex?: number
  glbAnimationIndex?: number
}

export interface NormalizedManifest {
  version: string
  glbSha256?: string
  actions: NormalizedAction[]
  source?: { file?: string; sha256?: string }
  target?: { file?: string; sha256?: string }
  fingerprint?: { boneLengthsMeters?: Record<string, number>; hipsHeightMeters?: number }
  rootPolicy?: { mode?: string; translationScale?: number; units?: string }
  rig?: string
  extraBones?: unknown[]
}

export interface ActionMetadata {
  uuid: string
  name: string
  durationSeconds: number
  fps: number
  category: ActionCategory
  tags: string[]
  loop: boolean
  inPlace: boolean
  parentUuid: string | null
  cover: string | null
  glbAnimationIndex: number
}

export interface MotionPackMetadata {
  kind: 'motion-pack'
  libraryVersion: typeof LIBRARY_VERSION
  packId: string
  glbSha256: string
  rig: string
  createdBy: 'app1' | 'app3'
  createdAt: string
  license: LibraryLicense
  boundCharacter: string | null
  source: { file: string | null; sha256: string | null }
  actions: ActionMetadata[]
}

export interface LibraryConfig {
  version: typeof LIBRARY_VERSION
  rigs: string[]
}

export interface IndexedAction extends ActionMetadata {
  packId: string
  rig: string
  createdAt: string
  licenseId: string
  boundCharacter: string | null
}

export interface LibraryIndex {
  version: 1
  generatedAt: string
  packs: Array<Pick<MotionPackMetadata, 'packId' | 'rig' | 'createdAt' | 'license' | 'boundCharacter'>>
  actions: IndexedAction[]
  characters: CharacterMetadata[]
}

export interface CharacterMetadata {
  kind: 'character'
  charId: string
  libraryVersion: typeof LIBRARY_VERSION
  name: string
  rig: string
  createdAt: string
  license: LibraryLicense
  fingerprint?: string | null
  model: string
  baseModelId?: string
  skin?: string | null
  actions?: string[]
  actionCount?: number
  defaultAction?: string
}

export interface LibraryOptions {
  root?: string
  /** Used by applications to prevent configuring the library inside a checkout. */
  repositoryRoot?: string
}

export interface SearchOptions {
  rig?: string
  category?: ActionCategory
  tags?: string[]
  text?: string
  boundCharacter?: string
  limit?: number
  offset?: number
}

export interface BaseModelMetadata {
  kind: 'base-model'
  libraryVersion: typeof LIBRARY_VERSION
  modelId: string
  name: string
  rig: string
  format: 'glb' | 'bobj'
  model: string
  objects: string[]
  bones: string[]
  extraBones: string[]
  heightMeters: number
  sha256: string
  license: LibraryLicense
}

export interface CharacterWarning {
  code: 'MISSING_TEXTURE'
  object: string
  message: string
}

export interface ResolvedCharacter {
  character: CharacterMetadata
  baseModel: BaseModelMetadata | null
  modelPath: string
  textures: Record<string, string>
  actions: IndexedAction[]
  warnings: CharacterWarning[]
}
