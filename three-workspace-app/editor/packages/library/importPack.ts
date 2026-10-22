import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import {
  ACTION_CATEGORIES, LIBRARY_VERSION, type ActionCategory, type ActionMetadata, type LibraryLicense,
  type MotionPackMetadata, type NormalizedManifest,
} from './types.ts'
import { ensureRegularFile, initializeLibrary, readJsonFile, safeChild, validateRelativeAssetPath, withLibraryLock, writeIndex, writeJsonAtomic } from './store.ts'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SHA256 = /^[a-f0-9]{64}$/i

interface RigBone {
  name: string
  parent: string | null
  rest: { position: number[]; rotation: number[]; scale: number[] }
}

function glbRigBones(path: string): RigBone[] {
  const bytes = readFileSync(path)
  if (bytes.length < 20 || bytes.toString('ascii', 0, 4) !== 'glTF' || bytes.readUInt32LE(4) !== 2) throw new Error('Normalized model must be a GLB 2.0 file')
  const jsonLength = bytes.readUInt32LE(12), jsonType = bytes.readUInt32LE(16)
  if (jsonType !== 0x4e4f534a || jsonLength > bytes.length - 20) throw new Error('GLB has no valid JSON chunk')
  const gltf = JSON.parse(bytes.toString('utf8', 20, 20 + jsonLength)) as {
    nodes?: Array<{ name?: string; children?: number[]; translation?: number[]; rotation?: number[]; scale?: number[] }>
    skins?: Array<{ joints?: number[] }>
  }
  const nodes = gltf.nodes ?? []
  const jointIndices = new Set((gltf.skins ?? []).flatMap((skin) => skin.joints ?? []))
  if (!jointIndices.size) throw new Error('Normalized GLB does not contain a skinned rig')
  const parents = new Map<number, number>()
  for (const [parent, node] of nodes.entries()) for (const child of node.children ?? []) parents.set(child, parent)
  const indexToName = new Map<number, string>()
  for (const index of jointIndices) {
    const name = nodes[index]?.name
    if (!name) throw new Error(`GLB joint ${index} has no name`)
    indexToName.set(index, name)
  }
  const seen = new Set<string>()
  return [...jointIndices].map((index) => {
    const node = nodes[index]!, name = indexToName.get(index)!
    if (seen.has(name)) throw new Error(`Rig has duplicate joint name: ${name}`)
    seen.add(name)
    let parentIndex = parents.get(index)
    while (parentIndex !== undefined && !indexToName.has(parentIndex)) parentIndex = parents.get(parentIndex)
    return {
      name,
      parent: parentIndex === undefined ? null : indexToName.get(parentIndex)!,
      rest: {
        position: node.translation ?? [0, 0, 0],
        rotation: node.rotation ?? [0, 0, 0, 1],
        scale: node.scale ?? [1, 1, 1],
      },
    }
  })
}

function validateRig(rig: string, bones: RigBone[], manifest: NormalizedManifest): void {
  const names = new Set(bones.map((bone) => bone.name))
  if (rig === 'mixamo65' || rig.startsWith('mixamo65+')) {
    const required = ['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head', 'LeftArm', 'LeftForeArm', 'LeftHand', 'RightArm', 'RightForeArm', 'RightHand',
      'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'RightUpLeg', 'RightLeg', 'RightFoot']
    if (required.some((name) => !names.has(name))) throw new Error('GLB is missing required Mixamo65 core joints')
    const extras = manifest.extraBones ?? []
    if (rig === 'mixamo65' && bones.length !== 65) throw new Error(`mixamo65 packs must contain 65 joints, found ${bones.length}`)
    if (rig !== 'mixamo65' && (extras.length === 0 || bones.length !== 65 + extras.length)) throw new Error('Extended Mixamo manifest and GLB joint counts do not match')
    for (const raw of extras) {
      if (!raw || typeof raw !== 'object') throw new Error('Invalid extraBones manifest entry')
      const extra = raw as { name?: unknown; parent?: unknown }
      if (typeof extra.name !== 'string' || !/^X_[A-Za-z0-9_]+_[A-Za-z0-9_]+$/.test(extra.name) ||
          typeof extra.parent !== 'string' || !names.has(extra.parent)) throw new Error('Extra bones must use X_<attachment>_<name> and reference an existing joint')
    }
  } else if (rig === 'minecraft20' && bones.length !== 20) {
    throw new Error(`minecraft20 packs must contain 20 joints, found ${bones.length}`)
  }
}

export interface ImportPackOptions {
  libraryRoot: string
  sourceDirectory: string
  license?: LibraryLicense
  createdBy?: 'app1' | 'app3'
  boundCharacter?: string | null
  category?: ActionCategory
  tags?: string[]
  loop?: boolean
}

export interface ImportPackResult {
  packId: string
  rig: string
  actions: number
  created: boolean
  metadata: MotionPackMetadata
}

function readNormalizedInput(directory: string) {
  const source = resolve(directory)
  const files = (extension: string) => join(source, `${basename(source)}${extension}`)
  // normalizeBatch names its output stem after the input source, not the directory.
  // Resolve the one unambiguous manifest first and use its stem for all sidecars.
  const manifestCandidates = ['.manifest.json']
  let manifestPath = files(manifestCandidates[0]!)
  if (!existsSync(manifestPath)) {
    const candidates = readdirSync(source).filter((name) => name.endsWith('.manifest.json'))
    if (candidates.length !== 1) throw new Error('Expected exactly one normalized *.manifest.json sidecar')
    manifestPath = join(source, candidates[0]!)
  }
  const stem = basename(manifestPath, '.manifest.json')
  const artifact = (extension: string) => join(source, `${stem}${extension}`)
  const glbPath = artifact('.glb'), reportPath = artifact('.report.json')
  ensureRegularFile(manifestPath)
  ensureRegularFile(glbPath)
  const manifest = readJsonFile<NormalizedManifest>(manifestPath)
  if (!existsSync(reportPath)) throw new Error('Normalized result is missing its .report.json gate')
  ensureRegularFile(reportPath)
  const report = readJsonFile<{ status?: string }>(reportPath)
  if (report.status !== 'PASS') throw new Error(`Only normalized PASS outputs can be imported (status: ${report.status ?? 'missing'})`)
  const glbSha256 = createHash('sha256').update(readFileSync(glbPath)).digest('hex')
  if (manifest.glbSha256 && manifest.glbSha256.toLowerCase() !== glbSha256) throw new Error('Normalized manifest GLB hash does not match the GLB')
  if (!Array.isArray(manifest.actions) || manifest.actions.length === 0) throw new Error('Normalized manifest must contain at least one action')
  return { source, stem, artifact, manifest, glbPath, manifestPath, reportPath, glbSha256 }
}

function validateLicense(value: LibraryLicense | undefined, fallbackSource: string | undefined): LibraryLicense {
  const license = value ?? { id: 'internal-only', commitable: false, ...(fallbackSource ? { source: fallbackSource } : {}) }
  if (typeof license.id !== 'string' || !license.id.trim() || typeof license.commitable !== 'boolean') throw new Error('License requires a non-empty id and commitable boolean')
  if (license.source !== undefined && typeof license.source !== 'string') throw new Error('License source must be a string')
  return { ...license }
}

function category(value: unknown, fallback: ActionCategory): ActionCategory {
  return typeof value === 'string' && (ACTION_CATEGORIES as readonly string[]).includes(value) ? value as ActionCategory : fallback
}

function buildActions(manifest: NormalizedManifest, options: ImportPackOptions, hasCover: boolean): ActionMetadata[] {
  const categoryDefault = options.category ?? 'other'
  if (!ACTION_CATEGORIES.includes(categoryDefault)) throw new Error(`Unknown action category: ${categoryDefault}`)
  const seen = new Set<string>()
  return manifest.actions.map((action, index) => {
    if (!action || typeof action.uuid !== 'string' || !UUID.test(action.uuid)) throw new Error(`Action ${index} has an invalid UUID`)
    if (seen.has(action.uuid.toLowerCase())) throw new Error(`Duplicate action UUID: ${action.uuid}`)
    seen.add(action.uuid.toLowerCase())
    if (typeof action.name !== 'string' || !action.name.trim() || !Number.isFinite(action.durationSeconds) || action.durationSeconds <= 0 ||
        !Number.isFinite(action.fps) || action.fps <= 0) throw new Error(`Action ${index} has invalid timing or name metadata`)
    const tags = options.tags ?? []
    if (!Array.isArray(tags) || tags.some((tag) => typeof tag !== 'string' || !tag.trim())) throw new Error('Tags must be non-empty strings')
    const cover = hasCover ? `covers/${action.uuid}.png` : null
    return {
      uuid: action.uuid, name: action.name, durationSeconds: action.durationSeconds, fps: action.fps,
      category: category((action as NormalizedManifest['actions'][number] & { category?: unknown }).category, categoryDefault),
      tags: [...new Set(tags.map((tag) => tag.trim()))],
      loop: options.loop ?? false,
      inPlace: manifest.rootPolicy?.mode === 'in-place',
      parentUuid: null,
      cover,
      glbAnimationIndex: Number.isInteger(action.glbAnimationIndex) ? action.glbAnimationIndex! : index,
    }
  })
}

/** Import a normalize.ts/normalizeBatch.ts output as one immutable content-addressed pack. */
export function importNormalizedPack(options: ImportPackOptions): ImportPackResult {
  const input = readNormalizedInput(options.sourceDirectory)
  const bones = glbRigBones(input.glbPath)
  const packId = input.glbSha256.slice(0, 16)
  const destination = safeChild(options.libraryRoot, 'packs', packId)
  const coverPath = input.artifact('.preview.png')
  const hasCover = existsSync(coverPath)
  if (hasCover) ensureRegularFile(coverPath)
  const actions = buildActions(input.manifest, options, hasCover)
  const rig = input.manifest.rig || (input.manifest.version === '1.0.0' ? 'mixamo65' : '')
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*(?:\+[A-Za-z0-9][A-Za-z0-9_-]*)?$/.test(rig)) throw new Error('Normalized manifest has no supported rig id')
  validateRig(rig, bones, input.manifest)
  const license = validateLicense(options.license, input.manifest.source?.file)
  const metadata: MotionPackMetadata = {
    kind: 'motion-pack', libraryVersion: LIBRARY_VERSION, packId, glbSha256: input.glbSha256, rig,
    createdBy: options.createdBy ?? 'app1', createdAt: new Date().toISOString(), license,
    boundCharacter: options.boundCharacter ?? input.manifest.target?.sha256 ?? null,
    source: { file: input.manifest.source?.file ?? null, sha256: input.manifest.source?.sha256 ?? null },
    actions,
  }
  return withLibraryLock(options.libraryRoot, () => {
    initializeLibrary(options.libraryRoot)
    mkdirSync(safeChild(options.libraryRoot, 'packs'), { recursive: true })
    if (existsSync(destination)) {
      const existing = readJsonFile<MotionPackMetadata>(safeChild(destination, 'meta.json'))
      if (existing.glbSha256 !== input.glbSha256) throw new Error(`Pack id collision at ${packId}`)
      return { packId, rig: existing.rig, actions: existing.actions.length, created: false, metadata: existing }
    }
    const staging = safeChild(options.libraryRoot, 'packs', `.${packId}.${process.pid}.${Date.now()}.tmp`)
    mkdirSync(staging)
    try {
      copyFileSync(input.glbPath, safeChild(staging, 'anim.glb'))
      copyFileSync(input.manifestPath, safeChild(staging, 'anim.manifest.json'))
      if (existsSync(input.reportPath)) { ensureRegularFile(input.reportPath); copyFileSync(input.reportPath, safeChild(staging, 'anim.report.json')) }
      // App 1 names the Minecraft20 action file `<stem>.minecraft20.bobj` (normalize.ts --bobj).
      const bobjPath = [input.artifact('.minecraft20.bobj'), input.artifact('.bobj')].find((path) => existsSync(path)) ?? ''
      if (existsSync(bobjPath)) { ensureRegularFile(bobjPath); copyFileSync(bobjPath, safeChild(staging, 'anim.bobj')) }
      if (hasCover) {
        mkdirSync(safeChild(staging, 'covers'))
        for (const action of actions) copyFileSync(coverPath, safeChild(staging, 'covers', `${action.uuid}.png`))
      }
      writeJsonAtomic(safeChild(staging, 'meta.json'), metadata)
      registerRigUnlocked(options.libraryRoot, rig, bones)
      renameSync(staging, destination)
      writeIndex(options.libraryRoot)
      return { packId, rig, actions: actions.length, created: true, metadata }
    } catch (error) { rmSync(staging, { recursive: true, force: true }); throw error }
  })
}

function registerRigUnlocked(root: string, rigId: string, bones: RigBone[]): void {
  const configPath = safeChild(root, 'library.json')
  const config = readJsonFile<{ version: string; rigs: string[] }>(configPath)
  const rigFile = safeChild(root, 'rigs', `${rigId.replace(/[+]/g, '-')}.json`)
  if (existsSync(rigFile)) {
    const existing = readJsonFile<{ bones?: RigBone[] }>(rigFile)
    if (JSON.stringify(existing.bones?.map(({ name, parent }) => [name, parent])) !== JSON.stringify(bones.map(({ name, parent }) => [name, parent]))) {
      throw new Error(`Rig topology does not match registered rig ${rigId}`)
    }
  } else {
    writeJsonAtomic(rigFile, { rigId, base: rigId.includes('+') ? rigId.slice(0, rigId.indexOf('+')) : null, bones })
  }
  if (!config.rigs.includes(rigId)) writeJsonAtomic(configPath, { ...config, rigs: [...config.rigs, rigId].sort() })
}

/** Change searchable metadata only; immutable GLB and App 1 manifest bytes are preserved. */
export function updateActionMetadata(options: {
  libraryRoot: string; actionUuid: string; category?: ActionCategory; tags?: string[]; loop?: boolean; parentUuid?: string | null
}): MotionPackMetadata {
  if (!UUID.test(options.actionUuid)) throw new Error('Invalid action UUID')
  if (options.category !== undefined && !ACTION_CATEGORIES.includes(options.category)) throw new Error(`Unknown action category: ${options.category}`)
  if (options.tags?.some((tag) => typeof tag !== 'string' || !tag.trim())) throw new Error('Tags must be non-empty strings')
  if (options.parentUuid !== undefined && options.parentUuid !== null && !UUID.test(options.parentUuid)) throw new Error('Invalid parent action UUID')
  return withLibraryLock(options.libraryRoot, () => {
    initializeLibrary(options.libraryRoot)
    const packsRoot = safeChild(options.libraryRoot, 'packs')
    for (const pack of readdirSync(packsRoot, { withFileTypes: true })) {
      if (!pack.isDirectory() || !/^[a-f0-9]{16}$/.test(pack.name)) continue
      const metaPath = safeChild(packsRoot, pack.name, 'meta.json')
      if (!existsSync(metaPath)) continue
      const metadata = readJsonFile<MotionPackMetadata>(metaPath)
      const action = metadata.actions.find((item) => item.uuid.toLowerCase() === options.actionUuid.toLowerCase())
      if (!action) continue
      if (options.category !== undefined) action.category = options.category
      if (options.tags !== undefined) action.tags = [...new Set(options.tags.map((tag) => tag.trim()))]
      if (options.loop !== undefined) action.loop = options.loop
      if (options.parentUuid !== undefined) action.parentUuid = options.parentUuid
      writeJsonAtomic(metaPath, metadata)
      writeIndex(options.libraryRoot)
      return metadata
    }
    throw new Error(`Action not found: ${options.actionUuid}`)
  })
}

export function validatePackAssetPath(value: string): string {
  return validateRelativeAssetPath(value)
}
