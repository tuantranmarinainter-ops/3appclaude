import { createHash, randomUUID } from 'node:crypto'
import { AUDIO_FORMATS } from './audioCues'
import { mkdir, open, readFile, readdir, realpath, rename, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { Bone, Matrix4, PropertyBinding, Quaternion, REVISION, Vector3 } from 'three'
import type { AnimationClip } from 'three'
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js'
import { fbxSourceBones } from '@topview/3d-builder/evaluate'
import { isMixamo65Topology } from '@bbs/retarget'
import { isRecord } from '@bbs/animation-workspace-shared'
import type { Asset, AssetID, BlobRef, Motion, SkeletonProfile, UnifiedProject } from '@bbs/animation-workspace-shared'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const HASH = /^[0-9a-f]{64}$/

export interface StagedAssetUpload { id: string; name: string; sha256: string; byteLength: number; bytes: Buffer }
export interface ImportedMotion { motion: Motion; name: string; clipIndex: number; nativeFingerprint: { kind: 'fbx' | 'gltf'; name: string; clip: string; duration: number; tracks: number; content: string }; boneNames?: string[] }
export interface ImportedAsset { app1Manifest?: Record<string, unknown>; asset: Asset; skeleton: SkeletonProfile | null; skeletonProfiles?: SkeletonProfile[]; motions: ImportedMotion[]; normalizationReport?: { ref: BlobRef; bytes: Buffer }; modelRebindReport?: { ref: BlobRef; bytes: Buffer }; modelInfo?: { format: 'fbx' | 'gltf'; metersPerUnit: number; basisToScene: number[] }; issue?: { code: string; message: string }; issues?: Array<{ code: string; message: string; actionIndex?: number }> }

function root(): string {
  return path.resolve(process.env.BBS_UNIFIED_PROJECTS_DIR?.trim() || path.join(process.cwd(), 'unified-projects'))
}

function safeName(input: string): string {
  const leaf = input.replace(/\\/g, '/').split('/').pop() ?? ''
  const cleaned = leaf.normalize('NFC').replace(/[\u0000-\u001f<>:"|?*]/g, '_').replace(/^\.+$/, '').trim().slice(0, 120)
  return cleaned || 'asset.bin'
}

export async function stageAssetUpload(name: string, body: ReadableStream<Uint8Array>, maxBytes = 256 * 1024 * 1024): Promise<Omit<StagedAssetUpload, 'bytes'>> {
  const id = randomUUID()
  const folder = path.join(root(), '.uploads')
  const temporary = path.join(folder, `${id}.tmp`)
  const binary = path.join(folder, `${id}.bin`)
  await mkdir(folder, { recursive: true })
  const expiry = Date.now() - 24 * 60 * 60 * 1000
  for (const entry of await readdir(folder)) {
    const file = path.join(folder, entry)
    const info = await stat(file).catch(() => null)
    if (info && info.mtimeMs < expiry && (entry.endsWith('.tmp') || entry.endsWith('.json') || entry.endsWith('.bin'))) {
      const uploadId = entry.slice(0, entry.lastIndexOf('.'))
      await rm(file, { force: true })
      await rm(path.join(folder, `${uploadId}.bin`), { force: true })
    }
  }
  const file = await open(temporary, 'wx')
  const hash = createHash('sha256')
  const reader = body.getReader()
  let byteLength = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      byteLength += value.byteLength
      if (byteLength > maxBytes) throw new RangeError('Upload exceeds 256 MiB')
      hash.update(value)
      for (let offset = 0; offset < value.byteLength;) {
        const { bytesWritten } = await file.write(value, offset, value.byteLength - offset)
        if (!bytesWritten) throw new Error('Could not write staged asset upload')
        offset += bytesWritten
      }
    }
    if (!byteLength) throw new TypeError('Empty asset upload')
    await file.sync()
    await file.close()
    await rename(temporary, binary)
    const record = { id, name: safeName(name), sha256: hash.digest('hex'), byteLength }
    const metadata = await open(path.join(folder, `${id}.json`), 'wx')
    try { await metadata.writeFile(JSON.stringify(record)); await metadata.sync() } finally { await metadata.close() }
    return record
  } catch (error) {
    await file.close().catch(() => undefined)
    await rm(temporary, { force: true })
    await rm(binary, { force: true })
    throw error
  } finally {
    reader.releaseLock()
  }
}

export async function readStagedAssetUpload(id: unknown): Promise<StagedAssetUpload> {
  if (typeof id !== 'string' || !UUID.test(id)) throw new TypeError('Invalid upload handle')
  const folder = path.join(root(), '.uploads')
  const record = JSON.parse(await readFile(path.join(folder, `${id}.json`), 'utf8')) as Omit<StagedAssetUpload, 'bytes'>
  if (record.id !== id || typeof record.name !== 'string' || !HASH.test(record.sha256) || !Number.isSafeInteger(record.byteLength) || record.byteLength <= 0) throw new TypeError('Invalid staged upload')
  const bytes = await readFile(path.join(folder, `${id}.bin`))
  if (bytes.byteLength !== record.byteLength || createHash('sha256').update(bytes).digest('hex') !== record.sha256) throw new TypeError('Staged upload hash mismatch')
  return { ...record, bytes }
}

export async function removeStagedAssetUploads(ids: string[]): Promise<void> {
  const folder = path.join(root(), '.uploads')
  for (const id of ids) if (UUID.test(id)) {
    await rm(path.join(folder, `${id}.bin`), { force: true })
    await rm(path.join(folder, `${id}.json`), { force: true })
  }
}

async function writeImmutable(projectId: string, ref: BlobRef, bytes: Buffer): Promise<boolean> {
  const projectRoot = path.join(root(), projectId)
  const target = path.resolve(projectRoot, ...ref.path.split('/'))
  if (!target.startsWith(`${projectRoot}${path.sep}`)) throw new TypeError('Asset path escapes project')
  await mkdir(path.dirname(target), { recursive: true })
  const resolvedRoot = await realpath(projectRoot)
  const resolvedParent = await realpath(path.dirname(target))
  if (!resolvedParent.startsWith(`${resolvedRoot}${path.sep}`)) throw new TypeError('Asset parent escapes project')
  try {
    const file = await open(target, 'wx')
    try { await file.writeFile(bytes); await file.sync() } finally { await file.close() }
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    const current = await readFile(target)
    if (current.byteLength !== ref.byteLength || createHash('sha256').update(current).digest('hex') !== ref.sha256) throw new TypeError('Existing content-addressed blob is corrupt')
    return false
  }
}

export async function persistRetargetCalibration(projectId: string, bytes: Buffer): Promise<BlobRef> {
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  const ref: BlobRef = { path: `mappings/calibration/${sha256}.json`, sha256, mediaType: 'application/json', byteLength: bytes.byteLength }
  await writeImmutable(projectId, ref, bytes)
  return ref
}

export async function persistUniversalReferencePose(projectId: string, bytes: Buffer): Promise<BlobRef> {
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  const ref: BlobRef = { path: `mappings/reference-poses/${sha256}.json`, sha256, mediaType: 'application/json', byteLength: bytes.byteLength }
  await writeImmutable(projectId, ref, bytes)
  return ref
}

export async function persistNativeRetargetProject(projectId: string, bytes: Buffer): Promise<BlobRef> {
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  const ref: BlobRef = { path: `retarget/sessions/${sha256}.json`, sha256, mediaType: 'application/json', byteLength: bytes.byteLength }
  await writeImmutable(projectId, ref, bytes)
  return ref
}

export async function persistNativeAnimationMotion(projectId: string, displayName: string, nativeBytes: Buffer, glbBytes: Buffer, dependencies: AssetID[]): Promise<{ asset: Asset; edit: BlobRef }> {
  const assetHash = createHash('sha256').update(glbBytes).digest('hex')
  const editHash = createHash('sha256').update(nativeBytes).digest('hex')
  const fileName = `${safeName(displayName).replace(/\.[^.]+$/, '') || 'animation'}.glb`
  const source: BlobRef = { path: `assets/${assetHash}/${fileName}`, sha256: assetHash, mediaType: 'model/gltf-binary', byteLength: glbBytes.byteLength }
  const edit: BlobRef = { path: `animation/edits/${editHash}.json`, sha256: editHash, mediaType: 'application/json', byteLength: nativeBytes.byteLength }
  const original: BlobRef = { ...source, path: `originals/${assetHash}/${fileName}` }
  const asset: Asset = {
    id: `sha256:${assetHash}`, kind: 'motion', displayName: fileName.replace(/\.glb$/i, ''), source,
    derivatives: { [`nativeEdit-${editHash}`]: edit },
    provenance: { sourceKey: 'animation-studio', sourceVersion: '1.31.8', sourceHash: assetHash, original },
    license: null, dependencies: [...new Set(dependencies)],
  }
  await writeImmutable(projectId, source, glbBytes)
  await writeImmutable(projectId, original, glbBytes)
  await writeImmutable(projectId, edit, nativeBytes)
  return { asset, edit }
}

export async function resolveProjectBlob(projectId: string, ref: BlobRef): Promise<Buffer> {
  const projectRoot = await realpath(path.join(root(), projectId))
  const target = path.resolve(projectRoot, ...ref.path.split('/'))
  if (!target.startsWith(`${projectRoot}${path.sep}`)) throw new TypeError('Project blob path escapes project')
  const resolved = await realpath(target)
  if (!resolved.startsWith(`${projectRoot}${path.sep}`)) throw new TypeError('Project blob symlink escapes project')
  const info = await stat(resolved)
  if (!info.isFile() || info.size !== ref.byteLength) throw new TypeError('Project blob size mismatch')
  const bytes = await readFile(resolved)
  if (createHash('sha256').update(bytes).digest('hex') !== ref.sha256) throw new TypeError('Project blob hash mismatch')
  return bytes
}

function glbJson(bytes: Buffer): Record<string, unknown> | null {
  if (bytes.length < 20 || bytes.toString('ascii', 0, 4) !== 'glTF' || bytes.readUInt32LE(4) !== 2 || bytes.readUInt32LE(8) !== bytes.length) return null
  let offset = 12
  while (offset + 8 <= bytes.length) {
    const length = bytes.readUInt32LE(offset)
    const type = bytes.readUInt32LE(offset + 4)
    offset += 8
    if (offset + length > bytes.length) return null
    if (type === 0x4e4f534a) {
      try {
        const value: unknown = JSON.parse(bytes.toString('utf8', offset, offset + length).replace(/\0+$/g, '').trim())
        return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
      } catch { return null }
    }
    offset += length
  }
  return null
}

export function glbTargetFingerprint(bytes: Buffer): string | null {
  const document = glbJson(bytes)
  const asset = document?.asset, extras = isRecord(asset) ? asset.extras : null
  return isRecord(extras) && typeof extras.targetFingerprint === 'string' ? extras.targetFingerprint : null
}

export function glbAnimationCount(bytes: Buffer): number {
  const document = glbJson(bytes)
  return document && Array.isArray(document.animations) ? document.animations.length : 0
}

export function glbAnimationBoneNames(bytes: Buffer): string[] {
  const document = glbJson(bytes)
  if (!document || !Array.isArray(document.nodes) || !Array.isArray(document.animations)) return []
  const nodes = document.nodes as Array<{ name?: unknown }>
  const clips = document.animations as Array<{ channels?: unknown }>
  const first = clips[0]
  if (!first || !Array.isArray(first.channels)) return []
  return [...new Set(first.channels.flatMap((channel) => {
    if (!isRecord(channel) || !isRecord(channel.target) || !Number.isInteger(channel.target.node)) return []
    const name = nodes[channel.target.node as number]?.name
    return typeof name === 'string' && name ? [name] : []
  }))]
}

function gltfJson(bytes: Buffer): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(bytes.toString('utf8'))
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
  } catch { return null }
}

function importGltfMotions(document: Record<string, unknown>, assetId: AssetID, original: BlobRef, fileName: string, skeletons: SkeletonProfile[]) {
  if (!Array.isArray(document.animations) || !document.animations.length) return { motions: [] as ImportedAsset['motions'], issue: undefined }
  if (!skeletons.length) return { motions: [] as ImportedAsset['motions'], issue: { code: 'GLTF_ANIMATION_NO_RIG', message: 'glTF animations were retained in the source file, but no skin/skeleton profile was found for timeline assignment.' } }
  const accessors = Array.isArray(document.accessors) ? document.accessors as Array<Record<string, unknown>> : []
  const motions: ImportedAsset['motions'] = [], issues: NonNullable<ImportedAsset['issues']> = []
  for (const [clipIndex, raw] of document.animations.entries()) {
    if (!isRecord(raw) || !Array.isArray(raw.channels) || !Array.isArray(raw.samplers) || !raw.channels.length) throw new TypeError(`glTF animation ${clipIndex} is invalid`)
    let duration = 0
    const intervals: number[] = []
    const animatedNodeIds = new Set<string>(), boneNames = new Set<string>()
    for (const channel of raw.channels) {
      if (!isRecord(channel) || !Number.isInteger(channel.sampler) || !isRecord(channel.target) || !Number.isInteger(channel.target.node) ||
        !['translation', 'rotation', 'scale', 'weights'].includes(String(channel.target.path))) throw new TypeError(`glTF animation ${clipIndex} has an unsupported channel`)
      const sampler = raw.samplers[channel.sampler as number]
      const input = isRecord(sampler) && Number.isInteger(sampler.input) ? accessors[sampler.input as number] : undefined
      const maximum = input?.max, minimum = input?.min, count = input?.count
      if (!Array.isArray(maximum) || !Array.isArray(minimum) || typeof maximum[0] !== 'number' || typeof minimum[0] !== 'number' ||
        !Number.isSafeInteger(count) || (count as number) < 2) throw new TypeError(`glTF animation ${clipIndex} has an invalid time accessor`)
      const span = (maximum[0] as number) - (minimum[0] as number)
      if (!(span > 0) || !Number.isFinite(span)) throw new TypeError(`glTF animation ${clipIndex} has a non-positive duration`)
      duration = Math.max(duration, maximum[0] as number)
      intervals.push(((count as number) - 1) / span)
      const nodes = Array.isArray(document.nodes) ? document.nodes : []
      const node = nodes[channel.target.node as number]
      if (!isRecord(node) || typeof node.name !== 'string' || !node.name) throw new TypeError(`glTF animation ${clipIndex} targets a node without a name`)
      if (channel.target.path !== 'weights') { animatedNodeIds.add(String(channel.target.node)); boneNames.add(node.name) }
    }
    const sourceFps = intervals.sort((a, b) => a - b)[Math.floor(intervals.length / 2)]!
    const animationName = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : `Clip ${clipIndex + 1}`
    const fingerprint = createHash('sha256').update(canonical(raw)).digest('hex')
    const candidates = skeletons.filter((skeleton) => [...animatedNodeIds].every((nodeId) => skeleton.bones.some((bone) => bone.id === nodeId)))
    if (candidates.length !== 1) {
      issues.push({ code: candidates.length ? 'GLTF_ACTION_SKELETON_AMBIGUOUS' : 'GLTF_ACTION_OUTSIDE_SKELETON', actionIndex: clipIndex, message: `Action ${animationName} maps to ${candidates.length} skeleton profiles; it is retained in the source asset but not listed as an assignable Motion.` })
      continue
    }
    const skeleton = candidates[0]!
    const motion: Motion = { id: randomUUID(), assetId, skeletonId: skeleton.id, durationSeconds: duration,
      sourceFps: Math.round(sourceFps * 1000) / 1000, sourceClip: original, evaluator: 'topview-0.1.8', edit: null, derivedFrom: null }
    motions.push({ motion, name: animationName, clipIndex, boneNames: [...boneNames],
      nativeFingerprint: { kind: 'gltf', name: fileName, clip: animationName, duration, tracks: raw.channels.length, content: fingerprint } })
  }
  return { motions, issue: issues[0], issues }
}

function embeddedGltfOnly(document: Record<string, unknown>): boolean {
  for (const key of ['buffers', 'images']) {
    const entries = document[key]
    if (entries === undefined) continue
    if (!Array.isArray(entries) || entries.some((entry) => !entry || typeof entry !== 'object' ||
      typeof (entry as { uri?: unknown }).uri === 'string' && !(entry as { uri: string }).uri.startsWith('data:'))) return false
  }
  return true
}

function canonical(value: unknown): string {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Skeleton contains a non-finite number')
    const rounded = Math.round(value * 1e6) / 1e6
    return Object.is(rounded, -0) ? '0' : String(rounded)
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`).join(',')}}`
  return JSON.stringify(value)
}

export function canonicalJsonExact(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('JSON payload contains a non-finite number')
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJsonExact).join(',')}]`
  if (value && typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) throw new TypeError('Payload must contain only plain JSON objects')
    const record = value as Record<string, unknown>
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJsonExact(record[key])}`).join(',')}}`
  }
  throw new TypeError('Payload must contain only JSON values')
}

export function sha256CanonicalJson(value: unknown): string {
  return createHash('sha256').update(canonicalJsonExact(value)).digest('hex')
}

function normalizedBoneName(name: string): string {
  return name.split(':').pop()!.replace(/^mixamorig\d*/i, '').replace(/[^A-Za-z0-9]/g, '').toLowerCase()
}

export function normalizeAnimationGlbBoneNames(bytes: Buffer, profileNames: string[]): Buffer {
  const document = glbJson(bytes)
  if (!document || !Array.isArray(document.nodes)) throw new TypeError('Baked animation is not a valid GLB')
  const profileByName = new Map<string, string>()
  for (const name of profileNames) {
    const key = normalizedBoneName(name)
    if (profileByName.has(key)) throw new TypeError('Character has ambiguous normalized bone names')
    profileByName.set(key, name)
  }
  for (const node of document.nodes) {
    if (isRecord(node) && typeof node.name === 'string') node.name = profileByName.get(normalizedBoneName(node.name)) ?? node.name
  }
  const jsonChunk = Buffer.from(JSON.stringify(document))
  const paddedLength = Math.ceil(jsonChunk.length / 4) * 4
  let oldJsonLength = 0
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const length = bytes.readUInt32LE(offset)
    if (bytes.readUInt32LE(offset + 4) === 0x4e4f534a) { oldJsonLength = length; break }
    offset += 8 + length
  }
  if (!oldJsonLength) throw new TypeError('Baked animation GLB has no JSON chunk')
  const output = Buffer.alloc(bytes.length - oldJsonLength + paddedLength)
  let sourceOffset = 12
  let targetOffset = 12
  while (sourceOffset + 8 <= bytes.length) {
    const length = bytes.readUInt32LE(sourceOffset)
    const type = bytes.readUInt32LE(sourceOffset + 4)
    if (sourceOffset + 8 + length > bytes.length) throw new TypeError('Baked animation GLB chunk is invalid')
    if (type === 0x4e4f534a) {
      output.writeUInt32LE(paddedLength, targetOffset)
      output.writeUInt32LE(type, targetOffset + 4)
      jsonChunk.copy(output, targetOffset + 8)
      output.fill(0x20, targetOffset + 8 + jsonChunk.length, targetOffset + 8 + paddedLength)
      targetOffset += 8 + paddedLength
    } else {
      bytes.copy(output, targetOffset, sourceOffset, sourceOffset + 8 + length)
      targetOffset += 8 + length
    }
    sourceOffset += 8 + length
  }
  if (sourceOffset !== bytes.length) throw new TypeError('Baked animation GLB chunk table is invalid')
  bytes.copy(output, 0, 0, 12)
  output.writeUInt32LE(output.length, 8)
  return output
}

function isMixamo65Skeleton(bones: SkeletonProfile['bones']): boolean {
  return isMixamo65Topology(bones)
}

function isMinecraft20Skeleton(bones: SkeletonProfile['bones']): boolean {
  const byName = new Map(bones.map((bone) => [normalizedBoneName(bone.name), bone]))
  const parentRoles: Record<string, string | null> = {
    anchor: null, body: 'anchor', lowbody: 'body', head: 'lowbody',
    leftarm: 'lowbody', lowleftarm: 'leftarm', lowleftarmend: 'lowleftarm',
    rightarm: 'lowbody', lowrightarm: 'rightarm', lowrightarmend: 'lowrightarm',
    leftleg: 'body', lowleftleg: 'leftleg', rightleg: 'body', lowlegright: 'rightleg',
  }
  if (byName.size !== bones.length || Object.keys(parentRoles).some((name) => !byName.has(name))) return false
  // shortcut: family detection only identifies a candidate; a confirmed profile mapping still gates retargeting.
  return Object.entries(parentRoles).every(([name, parentName]) => {
    const bone = byName.get(name)!
    return bone.parentId === (parentName ? byName.get(parentName)!.id : null)
  })
}

function glbSkeletons(document: Record<string, unknown>, original: BlobRef, basisToScene: number[]): SkeletonProfile[] {
  const skins = document.skins
  if (!Array.isArray(skins) || !skins.length) return []
  const profiles = skins.map((_, index) => glbSkeleton(document, original, basisToScene, index))
  return profiles.filter((profile, index): profile is SkeletonProfile => !!profile && profiles.findIndex((candidate) => candidate?.fingerprint === profile.fingerprint) === index)
}

function glbSkeleton(document: Record<string, unknown>, original: BlobRef, basisToScene: number[], skinIndex: number): SkeletonProfile | null {
  const nodes = document.nodes
  const skins = document.skins
  if (!Array.isArray(nodes) || !Array.isArray(skins) || !skins.length) return null
  const skin = skins[skinIndex]
  if (!skin || typeof skin !== 'object') throw new TypeError(`GLB skin ${skinIndex} is invalid`)
  const rawJoints = (skin as { joints?: unknown }).joints
  if (!Array.isArray(rawJoints) || !rawJoints.length || rawJoints.some((id) => !Number.isInteger(id) || (id as number) < 0 || (id as number) >= nodes.length)) throw new TypeError(`GLB skin ${skinIndex} has invalid joints`)
  if (new Set(rawJoints).size !== rawJoints.length) throw new TypeError(`GLB skin ${skinIndex} repeats a joint`)
  const jointSet = new Set<number>()
  for (const joint of rawJoints as number[]) jointSet.add(joint)
  const parents = new Map<number, number>()
  nodes.forEach((node, index) => {
    if (!node || typeof node !== 'object' || !Array.isArray((node as { children?: unknown }).children)) return
    for (const child of (node as { children: unknown[] }).children) {
      if (!Number.isInteger(child) || (child as number) < 0 || (child as number) >= nodes.length || parents.has(child as number)) throw new TypeError('GLB node hierarchy is invalid')
      parents.set(child as number, index)
    }
  })
  const ancestors = new Set<number>()
  for (const joint of jointSet) {
    let current: number | undefined = joint
    const path = new Set<number>()
    while (current !== undefined) {
      if (path.has(current)) throw new TypeError('GLB skeleton contains a hierarchy cycle')
      path.add(current); ancestors.add(current); current = parents.get(current)
    }
  }
  const roots = [...ancestors].filter((id) => !parents.has(id))
  if (roots.length !== 1) throw new TypeError('GLB skin must have one connected skeleton root')
  const root = roots[0]!
  const children = new Map<number, number[]>()
  for (const id of ancestors) {
    const parent = parents.get(id)
    if (parent !== undefined && ancestors.has(parent)) children.set(parent, [...(children.get(parent) ?? []), id])
  }
  const ordered: number[] = []
  const visit = (id: number) => { ordered.push(id); for (const child of children.get(id) ?? []) visit(child) }
  visit(root)
  if (ordered.length !== ancestors.size) throw new TypeError('GLB skeleton contains a hierarchy cycle')
  const id = randomUUID()
  const bones = ordered.map((nodeIndex) => {
    const node = nodes[nodeIndex] as Record<string, unknown>
    if (['rotation', 'translation', 'scale'].some((key) => node[key] !== undefined && !Array.isArray(node[key]))) throw new TypeError(`GLB joint ${nodeIndex} has malformed TRS fields`)
    let rotation = Array.isArray(node.rotation) ? node.rotation : [0, 0, 0, 1]
    let position = Array.isArray(node.translation) ? node.translation : [0, 0, 0]
    let scale = Array.isArray(node.scale) ? node.scale : [1, 1, 1]
    if (node.matrix !== undefined) {
      if (node.translation !== undefined || node.rotation !== undefined || node.scale !== undefined || !Array.isArray(node.matrix) || node.matrix.length !== 16 || node.matrix.some((value) => typeof value !== 'number' || !Number.isFinite(value))) throw new TypeError(`GLB joint ${nodeIndex} has invalid matrix or mixed matrix/TRS`)
      const values = node.matrix as number[], matrix = new Matrix4().fromArray(values)
      if ([3, 7, 11].some((index) => Math.abs(values[index]!) > 1e-9) || Math.abs(values[15]! - 1) > 1e-9 || !Number.isFinite(matrix.determinant()) || matrix.determinant() === 0) throw new TypeError(`GLB joint ${nodeIndex} requires invertible affine matrix`)
      const p = new Vector3(), q = new Quaternion(), s = new Vector3()
      matrix.decompose(p, q, s)
      const rebuilt = new Matrix4().compose(p, q, s)
      if (rebuilt.elements.some((value, index) => !Number.isFinite(value) || Math.abs(value - values[index]!) > 1e-6 * Math.max(1, Math.abs(values[index]!)))) throw new TypeError(`GLB joint ${nodeIndex} contains unsupported matrix shear`)
      position = p.toArray(); rotation = q.normalize().toArray(); scale = s.toArray()
    }
    if (rotation.length !== 4 || position.length !== 3 || scale.length !== 3 || [...rotation, ...position, ...scale].some((n) => typeof n !== 'number' || !Number.isFinite(n))) throw new TypeError(`GLB joint ${nodeIndex} has invalid transform`)
    const norm = Math.hypot(...rotation as number[])
    if (!norm || Math.abs(norm - 1) > 1e-3) throw new TypeError(`GLB joint ${nodeIndex} quaternion is invalid`)
    return {
      id: String(nodeIndex), name: typeof node.name === 'string' && node.name ? node.name : `node_${nodeIndex}`,
      parentId: parents.has(nodeIndex) && ancestors.has(parents.get(nodeIndex)!) ? String(parents.get(nodeIndex)) : null,
      rest: { position, rotation: (rotation as number[]).map((value) => value / norm), scale }, deform: jointSet.has(nodeIndex),
    }
  })
  const family = isMinecraft20Skeleton(bones) ? 'minecraft20' as const : isMixamo65Skeleton(bones) ? 'mixamo65' as const : 'custom-preserved' as const
  const profile = {
    id, family, bones, rootBoneId: String(root), metersPerUnit: 1,
    basisToScene, nativeFingerprint: null,
    provenance: { sourceKey: 'gltf2', sourceVersion: '2', sourceHash: original.sha256, original },
  }
  const fingerprintData = { family: profile.family, bones: profile.bones, rootBoneId: profile.rootBoneId, metersPerUnit: profile.metersPerUnit, basisToScene: profile.basisToScene }
  return { ...profile, fingerprint: createHash('sha256').update(canonical(fingerprintData)).digest('hex') }
}

function nearestBoneParent(bone: Bone): Bone | null {
  let parent = bone.parent
  while (parent && !(parent instanceof Bone)) parent = parent.parent
  return parent instanceof Bone ? parent : null
}

function legacyFbxFingerprint(fileName: string, clip: AnimationClip) {
  let hash = 2166136261
  const add = (value: unknown) => { for (const character of String(value)) { hash ^= character.charCodeAt(0); hash = Math.imul(hash, 16777619) } }
  for (const track of clip.tracks) { add(track.name); for (const value of track.times) add(value); for (const value of track.values) add(value) }
  return { kind: 'fbx' as const, name: fileName, clip: clip.name, duration: clip.duration, tracks: clip.tracks.length, content: (hash >>> 0).toString(16) }
}

function importFbx(upload: StagedAssetUpload, original: BlobRef, assetId: `sha256:${string}`, metersPerUnit: number, basisToScene: number[]): { skeleton: SkeletonProfile | null; skeletonProfiles: SkeletonProfile[]; motions: ImportedMotion[]; issues: NonNullable<ImportedAsset['issues']>; hasGeometry: boolean } {
  const bytes = upload.bytes
  // shortcut: Node FBXLoader cannot decode DOM-only texture paths, route those files through the local converter when supported.
  const root = new FBXLoader().parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '')
  root.updateWorldMatrix(true, true)
  const bones = fbxSourceBones(root)
  const parentByBone = new Map(bones.map((bone) => [bone, nearestBoneParent(bone)]))
  const roots = bones.filter((bone) => !parentByBone.get(bone))
  const indices = new Map(bones.map((bone, index) => [bone, index]))
  const componentRoot = new Map<Bone, Bone>()
  const rootFor = (bone: Bone) => {
    const path: Bone[] = []
    let current = bone
    while (!componentRoot.has(current)) {
      path.push(current)
      const parent = parentByBone.get(current)
      if (!parent) { componentRoot.set(current, current); break }
      current = parent
    }
    const rootBone = componentRoot.get(current)!
    for (const item of path) componentRoot.set(item, rootBone)
    return rootBone
  }
  const components = new Map<Bone, Bone[]>()
  for (const bone of bones) {
    const rootBone = rootFor(bone)
    const component = components.get(rootBone)
    if (component) component.push(bone)
    else components.set(rootBone, [bone])
  }
  const skeletonProfiles = roots.map((rootBone) => {
    const component = components.get(rootBone) ?? [], componentSet = new Set(component)
    const profileBones = component.map((bone) => {
      const parent = parentByBone.get(bone) ?? null
      const rest = parent && componentSet.has(parent)
        ? new Matrix4().copy(parent.matrixWorld).invert().multiply(bone.matrixWorld)
        : new Matrix4().copy(root.matrixWorld).invert().multiply(bone.matrixWorld)
      const position = new Vector3(), rotation = new Quaternion(), scale = new Vector3()
      rest.decompose(position, rotation, scale)
      if (![...position.toArray(), ...rotation.toArray(), ...scale.toArray()].every(Number.isFinite) || !rotation.length() || scale.toArray().some((value) => value === 0)) {
        throw new TypeError(`FBX bone ${bone.name} has an invalid rest transform`)
      }
      rotation.normalize()
      return { id: String(indices.get(bone)), name: bone.name, parentId: parent && componentSet.has(parent) ? String(indices.get(parent)) : null,
        rest: { position: position.toArray(), rotation: rotation.toArray(), scale: scale.toArray() }, deform: true }
    })
    const family = isMixamo65Skeleton(profileBones) ? 'mixamo65' as const : 'custom-preserved' as const
    const rootBoneId = String(indices.get(rootBone))
    const profile = { id: randomUUID(), family, bones: profileBones, rootBoneId, metersPerUnit, basisToScene, nativeFingerprint: null,
      provenance: { sourceKey: 'fbx', sourceVersion: `three-${REVISION}`, sourceHash: upload.sha256, original } }
    const fingerprintData = { family, bones: profileBones, rootBoneId, metersPerUnit, basisToScene: profile.basisToScene }
    return { ...profile, fingerprint: createHash('sha256').update(canonical(fingerprintData)).digest('hex') }
  })
  const profileIdsByTrackNode = new Map<string, Set<string>>()
  for (const profile of skeletonProfiles) for (const bone of profile.bones) for (const key of [bone.name, bones[Number(bone.id)]?.uuid]) {
    if (!key) continue
    const profiles = profileIdsByTrackNode.get(key) ?? new Set<string>()
    profiles.add(profile.id); profileIdsByTrackNode.set(key, profiles)
  }
  const issues: NonNullable<ImportedAsset['issues']> = []
  const motions = root.animations.flatMap((clip, clipIndex) => {
    if (clip.duration === 0 && clip.tracks.length === 0) return []
    if (!(clip.duration > 0) || !Number.isFinite(clip.duration) || !clip.tracks.length) throw new TypeError(`FBX clip ${clip.name || clipIndex} has no valid duration or channels`)
    if (!skeletonProfiles.length) throw new TypeError('Animated FBX has no skeleton')
    const selectedProfiles = new Set<string>(), ambiguous = new Set<string>()
    for (const track of clip.tracks) {
      let nodeName: string
      try { nodeName = PropertyBinding.parseTrackName(track.name).nodeName }
      catch { continue }
      const matches = profileIdsByTrackNode.get(nodeName)
      if (matches?.size === 1) selectedProfiles.add(matches.values().next().value as string)
      else if (matches && matches.size > 1) ambiguous.add(nodeName)
    }
    if (ambiguous.size || selectedProfiles.size > 1 || !selectedProfiles.size && skeletonProfiles.length !== 1) {
      const code = ambiguous.size ? 'FBX_ACTION_SKELETON_AMBIGUOUS' : selectedProfiles.size > 1 ? 'FBX_ACTION_SPANS_SKELETONS' : 'FBX_ACTION_SKELETON_UNRESOLVED'
      issues.push({ code, actionIndex: clipIndex,
        message: `Action ${clip.name || clipIndex + 1} cannot be assigned to one imported skeleton by node identity; it remains in the source FBX and is not listed as an assignable Motion.` })
      return []
    }
    const skeleton = skeletonProfiles.find((profile) => profile.id === [...selectedProfiles][0]) ?? skeletonProfiles[0]!
    const intervals = clip.tracks.flatMap((track) => {
      const times = track.times
      return Array.from({ length: Math.max(0, times.length - 1) }, (_, index) => times[index + 1]! - times[index]!).filter((value) => value > 1e-6)
    }).sort((a, b) => a - b)
    if (!intervals.length) throw new TypeError(`FBX clip ${clip.name || clipIndex} does not expose a sample rate`)
    const sourceFps = 1 / intervals[Math.floor(intervals.length / 2)]!
    if (!Number.isFinite(sourceFps) || sourceFps <= 0) throw new TypeError(`FBX clip ${clip.name || clipIndex} has no valid sample rate`)
    const motion: Motion = {
      id: randomUUID(), assetId, skeletonId: skeleton.id, durationSeconds: clip.duration,
      sourceFps: Math.round(sourceFps * 1000) / 1000, sourceClip: original,
      evaluator: 'retarget-9.12', edit: null, derivedFrom: null,
    }
    return [{ motion, name: clip.name || `Clip ${clipIndex + 1}`, clipIndex, nativeFingerprint: legacyFbxFingerprint(upload.name, clip) }]
  })
  let hasGeometry = false
  root.traverse((object) => { if ('isMesh' in object && object.isMesh) hasGeometry = true })
  return { skeleton: skeletonProfiles[0] ?? null, skeletonProfiles, motions, issues, hasGeometry }
}

export function buildImportedAsset(upload: StagedAssetUpload, format: string, unitMeters = 1, basisToScene: number[] = [1, 0, 0, 0, 1, 0, 0, 0, 1], skeletonOverride?: SkeletonProfile): ImportedAsset {
  const extension = path.extname(upload.name).toLowerCase()
  const selected = format === 'auto' ? extension.slice(1) : format
  const hash = upload.sha256
  const id = `sha256:${hash}` as const
  const basename = safeName(upload.name)
  const mediaType = selected === 'glb' ? 'model/gltf-binary' : selected === 'gltf' ? 'model/gltf+json' : selected === 'png' ? 'image/png' : selected === 'jpg' || selected === 'jpeg' ? 'image/jpeg' : selected === 'fbx' ? 'application/vnd.autodesk.fbx' : AUDIO_FORMATS[selected] ?? 'application/octet-stream'
  if (AUDIO_FORMATS[selected]) {
    // B16 audio lane: stored as-is, no derivatives; cues reference it by asset ID.
    if (skeletonOverride || unitMeters !== 1) throw new TypeError('Audio files take no skeleton or unit options')
    const source = { path: `assets/${hash}/${basename}`, sha256: hash, mediaType, byteLength: upload.byteLength }
    const original = { path: `originals/${hash}/${basename}`, sha256: hash, mediaType, byteLength: upload.byteLength }
    const asset: Asset = { id, kind: 'other', displayName: basename.replace(/\.[^.]+$/, '') || basename, source, derivatives: {},
      provenance: { sourceKey: 'audio', sourceVersion: '1', sourceHash: hash, original }, license: null, dependencies: [] }
    return { asset, skeleton: null, skeletonProfiles: [], motions: [] }
  }
  if (!['glb', 'gltf', 'fbx', 'png', 'jpg', 'jpeg'].includes(selected)) throw new TypeError(`No importer is available for ${selected || 'unknown'} files`)
  if (skeletonOverride && !['glb', 'gltf'].includes(selected)) throw new TypeError('A target skeleton override is only supported for animation-only glTF files')
  const source = { path: `assets/${hash}/${basename}`, sha256: hash, mediaType, byteLength: upload.byteLength }
  const original = { path: `originals/${hash}/${basename}`, sha256: hash, mediaType, byteLength: upload.byteLength }
  const fbx = selected === 'fbx' ? importFbx(upload, original, id, unitMeters, basisToScene) : null
  if ((selected === 'glb' || selected === 'gltf') && unitMeters !== 1) throw new TypeError('glTF files use meter units; FBX unit conversion must be selected explicitly')
  let gltfDocument: Record<string, unknown> | null = null
  let skeletonProfiles = fbx?.skeletonProfiles ?? []
  let skeleton: SkeletonProfile | null = skeletonProfiles[0] ?? null
  let gltfMotionIssue: { code: string; message: string } | undefined
  let importIssues: ImportedAsset['issues'] = fbx?.issues
  if (selected === 'glb' || selected === 'gltf') {
    gltfDocument = selected === 'glb' ? glbJson(upload.bytes) : gltfJson(upload.bytes)
    if (!gltfDocument || !gltfDocument.asset || typeof gltfDocument.asset !== 'object' || (gltfDocument.asset as { version?: unknown }).version !== '2.0') throw new TypeError(`Invalid glTF 2.0 ${selected.toUpperCase()} file`)
    if (selected === 'gltf' && !embeddedGltfOnly(gltfDocument)) throw new TypeError('Standalone glTF must embed buffers and images as data URIs; import a self-contained GLB instead')
    skeletonProfiles = glbSkeletons(gltfDocument, original, basisToScene)
    skeleton = skeletonProfiles[0] ?? null
    if (!skeletonProfiles.length && skeletonOverride) {
      if (!Array.isArray(gltfDocument.animations) || !gltfDocument.animations.length) throw new TypeError('A target skeleton can only be assigned to an animation-only glTF with animation clips')
      skeleton = skeletonOverride
      skeletonProfiles = [skeletonOverride]
    } else if (skeletonOverride) throw new TypeError('A target skeleton override is only valid for animation-only glTF without an embedded skin')
  }
  let motions = fbx?.motions ?? []
  if (gltfDocument) {
    const imported = importGltfMotions(gltfDocument, id, original, basename, skeletonProfiles)
    motions = imported.motions
    gltfMotionIssue = imported.issue
    importIssues = imported.issues ?? (imported.issue ? [imported.issue] : undefined)
  }
  const hasGltfGeometry = Array.isArray(gltfDocument?.meshes) && gltfDocument!.meshes.length > 0
  const kind = selected === 'png' || selected === 'jpg' || selected === 'jpeg' ? 'texture' as const : fbx?.hasGeometry || hasGltfGeometry ? 'model' as const : motions.length ? 'motion' as const : selected === 'fbx' ? 'other' as const : 'model' as const
  const asset: Asset = {
    id, kind, displayName: basename.replace(/\.[^.]+$/, '') || basename, source, derivatives: {},
    provenance: { sourceKey: selected === 'glb' || selected === 'gltf' ? 'gltf2' : selected === 'fbx' ? 'fbx' : 'image', sourceVersion: selected === 'glb' || selected === 'gltf' ? '2' : selected === 'fbx' ? `three-${REVISION}` : '1', sourceHash: hash, original },
    license: null, dependencies: [],
  }
  const issue = selected === 'fbx' && !fbx?.hasGeometry
    ? { code: 'FBX_NO_GEOMETRY', message: 'FBX source, skeleton and clips are preserved; the file has no mesh to place in Scene.' }
    : importIssues?.[0] ?? gltfMotionIssue ?? (!skeleton && kind === 'model'
      ? { code: 'SKELETON_NOT_FOUND', message: 'Model imported; no skin was found, so it cannot yet be used as a character.' }
      : undefined)
  return { asset, skeleton, skeletonProfiles, motions, ...(kind === 'model' ? { modelInfo: { format: selected === 'fbx' ? 'fbx' as const : 'gltf' as const, metersPerUnit: selected === 'fbx' ? unitMeters : 1, basisToScene } } : {}), ...(issue ? { issue } : {}), ...(importIssues?.length ? { issues: importIssues } : {}) }
}

export async function resolveUnifiedAssetFile(project: UnifiedProject, assetId: string, variant: string): Promise<{ bytes: Buffer; mediaType: string }> {
  const asset = project.assets[assetId as keyof typeof project.assets]
  if (!asset) throw new TypeError('Asset not found')
  const ref = variant === 'source' ? asset.source : asset.derivatives[variant]
  if (!ref) throw new TypeError('Asset variant not found')
  const projectRoot = await realpath(path.join(root(), project.projectId))
  const target = path.resolve(projectRoot, ...ref.path.split('/'))
  if (!target.startsWith(`${projectRoot}${path.sep}`)) throw new TypeError('Asset path escapes project')
  const resolved = await realpath(target)
  if (!resolved.startsWith(`${projectRoot}${path.sep}`)) throw new TypeError('Asset symlink escapes project')
  const info = await stat(resolved)
  if (!info.isFile() || info.size !== ref.byteLength) throw new TypeError('Asset size mismatch')
  const bytes = await readFile(resolved)
  if (createHash('sha256').update(bytes).digest('hex') !== ref.sha256) throw new TypeError('Asset hash mismatch')
  return { bytes, mediaType: ref.mediaType }
}

export async function persistImportedAssetFiles(projectId: string, imported: ImportedAsset, bytes: Buffer): Promise<void> {
  await writeImmutable(projectId, imported.asset.source, bytes)
  await writeImmutable(projectId, imported.asset.provenance.original, bytes)
  if (imported.normalizationReport) await writeImmutable(projectId, imported.normalizationReport.ref, imported.normalizationReport.bytes)
  if (imported.modelRebindReport) await writeImmutable(projectId, imported.modelRebindReport.ref, imported.modelRebindReport.bytes)
}

export async function persistRelinkedAssetFiles(projectId: string, asset: Asset, bytes: Buffer): Promise<boolean> {
  if (createHash('sha256').update(bytes).digest('hex') !== asset.source.sha256 || bytes.byteLength !== asset.source.byteLength) throw new TypeError('Relinked file does not match the asset content hash')
  const sourceRestored = await writeImmutable(projectId, asset.source, bytes)
  const originalRestored = asset.provenance.original.sha256 === asset.source.sha256 && asset.provenance.original.byteLength === bytes.byteLength
    ? await writeImmutable(projectId, asset.provenance.original, bytes)
    : false
  return sourceRestored || originalRestored
}
