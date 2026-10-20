import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { extname, isAbsolute, relative, resolve } from 'node:path'
import { Matrix4, Quaternion, Vector3, type Bone, type BufferAttribute, type Object3D, type SkinnedMesh } from 'three'
import { MIXAMO65_BONE_PARENTS } from '../src/mixamo65.ts'
import { transferSkinWeights } from '../src/universalSkin.ts'
import { canonical } from './autoMapping.ts'
import { decodeGlb, encodeGlb } from './glb.ts'
import { loadAsset, packGltf, type AssetFormat } from './loadAsset.ts'
import type { runNormalize } from './normalizeCore.ts'

/**
 * `--mode model`: Model+Rig+Animation GLB (contract v1.0.0). The Action GLB from `runNormalize` already holds the Mixamo65
 * target skeleton and every Action; this module appends the source meshes skinned to that skeleton. It writes glTF JSON
 * itself instead of using GLTFExporter: the exporter needs FileReader/canvas for textures, which Node does not have, and
 * it would re-encode images. Source image bytes are copied untouched into the BIN chunk (bufferView, no external URI).
 * Phase 1: only `mixamo` family sources — weights map 1:1 onto the target joints and the mesh keeps its original shape.
 */
export const MAX_INFLUENCES = 4
const DRACO_EXTENSIONS = ['KHR_draco_mesh_compression', 'EXT_meshopt_compression']
const SKIN_EXTENSION_NAMES = [...DRACO_EXTENSIONS, 'KHR_mesh_quantization']
/** Meters between source and target joint rest positions above which the mesh visibly does not sit on the skeleton. */
const JOINT_FIT_WARN_METERS = 0.05
const REST_ERROR_LIMIT_METERS = 1e-3

export class ModelBlockedError extends Error {
  constructor(readonly code: string, message: string) { super(message) }
}

export interface ModelSourceFiles { json: Record<string, any>; bin: Uint8Array; resourceDir?: string }
type NormalizeResult = Awaited<ReturnType<typeof runNormalize>>
type GlbResult = Extract<NormalizeResult, { glb: Uint8Array }>
/** Same shape as `runNormalize`'s result, with the manifest's `glb.mode` widened to include 'model'. */
export type PipelineResult = NormalizeResult | (Omit<GlbResult, 'manifest'> & { manifest: Omit<GlbResult['manifest'], 'glb'> & { glb: { bytes: number; mode: 'animation-only' | 'model' } } })
type Json = Record<string, any>

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const MIXAMO_NAMES = new Map(MIXAMO65_BONE_PARENTS.map(([name]) => [canonical(name), name]))

/** glTF/GLB sources: JSON + BIN for image copying and the Draco gate. FBX has no glTF materials (returns null). */
export function readModelSourceFiles(bytes: Uint8Array, format: AssetFormat, resourceDir?: string): ModelSourceFiles | null {
  if (format === 'fbx') return null
  if (format === 'bobj') throw new ModelBlockedError('MODEL_MODE_FAMILY_UNSUPPORTED', 'Model mode needs a source with meshes; .bobj is an Action library')
  const glb = format === 'gltf' ? packGltf(JSON.parse(new TextDecoder().decode(bytes)), resourceDir) : bytes
  const { json, bin } = decodeGlb(glb)
  const used = [...(json.extensionsRequired ?? []), ...(json.extensionsUsed ?? [])]
  const compressed = DRACO_EXTENSIONS.filter((name) => used.includes(name))
  if (compressed.length) throw new ModelBlockedError('DRACO_UNSUPPORTED', `Source uses ${compressed.join(', ')}; decompress it first (gltf-transform copy / gltf-pipeline -d)`)
  return { json, bin, ...(resourceDir ? { resourceDir } : {}) }
}

function sourceToScene(unitMeters: number, upAxis: 'y' | 'z') {
  const basis = upAxis === 'z' ? new Matrix4().makeRotationX(-Math.PI / 2) : new Matrix4()
  return basis.multiply(new Matrix4().makeScale(unitMeters, unitMeters, unitMeters))
}

/** Binary chunk builder: every view starts 4-byte aligned. */
class BinBuilder {
  readonly chunks: Uint8Array[] = []
  length = 0
  constructor(base: Uint8Array) { this.push(base) }
  push(bytes: Uint8Array) { const offset = this.length; this.chunks.push(bytes); this.length += Math.ceil(bytes.length / 4) * 4; return offset }
  toBytes() {
    const out = new Uint8Array(this.length)
    let cursor = 0
    for (const chunk of this.chunks) { out.set(chunk, cursor); cursor += Math.ceil(chunk.length / 4) * 4 }
    return out
  }
}

const bytesOf = (array: ArrayBufferView) => new Uint8Array(array.buffer, array.byteOffset, array.byteLength)

function imageBytes(image: Json, files: ModelSourceFiles): { bytes: Uint8Array; mimeType: string } {
  const mimeFromExt = (path: string) => ({ '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ktx2': 'image/ktx2' } as Record<string, string>)[extname(path).toLowerCase()]
  if (image.bufferView !== undefined) {
    const view = files.json.bufferViews[image.bufferView]
    return { bytes: files.bin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength), mimeType: image.mimeType }
  }
  const uri = String(image.uri ?? '')
  if (uri.startsWith('data:')) {
    const comma = uri.indexOf(','), mime = uri.slice(5, comma).split(';')[0]!
    return { bytes: Buffer.from(uri.slice(comma + 1), 'base64'), mimeType: image.mimeType ?? mime }
  }
  const dir = files.resourceDir
  if (!dir) throw new ModelBlockedError('MODEL_IMAGE_UNREADABLE', `Image ${uri} is external; pass the .gltf path so its folder can be read`)
  const decoded = decodeURIComponent(uri), path = resolve(dir, decoded), inside = relative(resolve(dir), path)
  if (isAbsolute(decoded) || !inside || inside.startsWith('..') || isAbsolute(inside) || !existsSync(path)) throw new ModelBlockedError('MODEL_IMAGE_UNREADABLE', `Image ${uri} is missing or outside the glTF folder`)
  const mimeType = image.mimeType ?? mimeFromExt(path)
  if (!mimeType) throw new ModelBlockedError('MODEL_IMAGE_UNREADABLE', `Image ${uri} has an unknown type`)
  return { bytes: readFileSync(path), mimeType }
}

function nodeMatrix(node: Json) {
  if (node.matrix) return new Matrix4().fromArray(node.matrix)
  return new Matrix4().compose(new Vector3().fromArray(node.translation ?? [0, 0, 0]), new Quaternion().fromArray(node.rotation ?? [0, 0, 0, 1]), new Vector3().fromArray(node.scale ?? [1, 1, 1]))
}

/** Joint node index per Mixamo name plus rest world matrices, read from the Action GLB's own node tree. */
function readTargetSkeleton(json: Json) {
  const nodes: Json[] = json.nodes ?? [], skin = json.skins?.[0]
  if (!skin || json.skins.length !== 1) throw new TypeError('Action GLB must hold exactly one skin')
  const parent = new Map<number, number>()
  nodes.forEach((node, index) => { for (const child of node.children ?? []) parent.set(child, index) })
  const world = new Map<number, Matrix4>()
  const worldOf = (index: number): Matrix4 => {
    let cached = world.get(index)
    if (!cached) { const up = parent.get(index); cached = up === undefined ? nodeMatrix(nodes[index]!) : worldOf(up).clone().multiply(nodeMatrix(nodes[index]!)); world.set(index, cached) }
    return cached
  }
  const joints: number[] = skin.joints, names = joints.map((joint) => nodes[joint].name as string)
  if (joints.length !== 65 || names.some((name) => !MIXAMO_NAMES.has(canonical(name)) || MIXAMO_NAMES.get(canonical(name)) !== name)) throw new TypeError('Action GLB skin must list the 65 unprefixed Mixamo joints')
  return { joints, names, worldOf, jointWorld: new Map(names.map((name, i) => [name, worldOf(joints[i]!)] as const)) }
}

function isTexturePath(key: string) { return key.endsWith('Texture') }

export interface ModelReport {
  meshes: number; primitives: number; vertices: number; maxInfluencesBefore: number; maxInfluencesAfter: number
  droppedWeight: number; affectedVertices: number
  images: { count: number; bytes: number; embedded: boolean; sourceImages: number }
  materials: number
  restMaxErrorMeters: number
  jointFit: { meanMeters: number; maxMeters: number; worstJoint: string }
  reassignedBones: Array<{ bone: string; owner: string }>
  checks: Record<string, 'PASS' | 'FAIL'>
  warnings: Array<{ code: string; message: string }>
  status: 'PASS' | 'FAIL'
}

export interface ExportModelOptions {
  animationGlb: Uint8Array
  /** Mesh-keeping source (`loadAsset` with `keepMeshes`), not yet scaled. */
  source: Object3D
  files: ModelSourceFiles | null
  unitMeters: number
  upAxis: 'y' | 'z'
  /** Target Mixamo name → source bone name (from the auto mapping), used before the ancestor fallback. */
  mappedSources: ReadonlyMap<string, string>
  facingYawDegrees: number
}

export async function exportModelGlb(options: ExportModelOptions): Promise<{ glb: Uint8Array; report: ModelReport }> {
  const basis = sourceToScene(options.unitMeters, options.upAxis)
  const { json, bin } = decodeGlb(options.animationGlb)
  const skeleton = readTargetSkeleton(json)
  const jointSlot = new Map(skeleton.names.map((name, slot) => [name, slot]))
  const out: Json = structuredClone(json)
  const builder = new BinBuilder(bin)
  const bufferViews: Json[] = out.bufferViews ??= [], accessors: Json[] = out.accessors ??= []
  const addView = (data: Uint8Array, target?: number) => {
    bufferViews.push({ buffer: 0, byteOffset: builder.push(data), byteLength: data.length, ...(target ? { target } : {}) })
    return bufferViews.length - 1
  }
  const addAccessor = (view: number, componentType: number, count: number, type: string, extra: Json = {}) => {
    accessors.push({ bufferView: view, componentType, count, type, ...extra })
    return accessors.length - 1
  }

  options.source.updateMatrixWorld(true)
  const meshes: SkinnedMesh[] = []
  options.source.traverse((node) => { if ((node as SkinnedMesh).isSkinnedMesh) meshes.push(node as SkinnedMesh) })
  if (!meshes.length) throw new ModelBlockedError('MODEL_NO_SKINNED_MESH', 'Source has no skinned mesh; Model mode needs a skinned model')

  // Material/texture/image registries: only what primitives use is copied, indices are remapped.
  const outMaterials: Json[] = [], outTextures: Json[] = [], outSamplers: Json[] = [], outImages: Json[] = []
  const materialSlot = new Map<string, number>(), textureSlot = new Map<number, number>(), samplerSlot = new Map<number, number>(), imageSlot = new Map<number, number>()
  const files = options.files
  let imageBytesTotal = 0
  const copyImage = (index: number) => {
    if (imageSlot.has(index)) return imageSlot.get(index)!
    const image = files!.json.images[index], { bytes, mimeType } = imageBytes(image, files!)
    imageBytesTotal += bytes.length
    outImages.push({ ...(image.name ? { name: image.name } : {}), mimeType, bufferView: addView(bytes) })
    imageSlot.set(index, outImages.length - 1)
    return outImages.length - 1
  }
  const copyTexture = (index: number) => {
    if (textureSlot.has(index)) return textureSlot.get(index)!
    const texture = structuredClone(files!.json.textures[index]) as Json
    if (texture.source !== undefined) texture.source = copyImage(texture.source)
    for (const extension of Object.values<Json>(texture.extensions ?? {})) if (typeof extension?.source === 'number') extension.source = copyImage(extension.source)
    if (texture.sampler !== undefined) {
      if (!samplerSlot.has(texture.sampler)) { outSamplers.push(structuredClone(files!.json.samplers[texture.sampler])); samplerSlot.set(texture.sampler, outSamplers.length - 1) }
      texture.sampler = samplerSlot.get(texture.sampler)
    }
    outTextures.push(texture)
    textureSlot.set(index, outTextures.length - 1)
    return outTextures.length - 1
  }
  const remapTextures = (value: unknown) => {
    if (!value || typeof value !== 'object') return
    for (const [key, child] of Object.entries(value as Json)) {
      if (isTexturePath(key) && child && typeof child.index === 'number') child.index = copyTexture(child.index)
      else remapTextures(child)
    }
  }
  const materialFor = (mesh: SkinnedMesh, slot: number): number | undefined => {
    const sourceIndex = (mesh.userData.w01MaterialIndices as Array<number | undefined> | undefined)?.[slot]
    const material = (Array.isArray(mesh.material) ? mesh.material[slot] : mesh.material) as unknown as { name?: string; color?: { toArray(): number[] }; opacity?: number; transparent?: boolean; side?: number } | undefined
    if (!material) return undefined
    const key = files && sourceIndex !== undefined ? `gltf:${sourceIndex}` : `three:${mesh.uuid}:${slot}`
    if (materialSlot.has(key)) return materialSlot.get(key)
    let definition: Json
    if (files && sourceIndex !== undefined) { definition = structuredClone(files.json.materials[sourceIndex]); remapTextures(definition) }
    else {
      const [r = 1, g = 1, b = 1] = material.color?.toArray() ?? []
      definition = { name: material.name || `material_${outMaterials.length}`, pbrMetallicRoughness: { baseColorFactor: [r, g, b, material.opacity ?? 1], metallicFactor: 0, roughnessFactor: 1 },
        ...(material.side === 2 ? { doubleSided: true } : {}), ...(material.transparent ? { alphaMode: 'BLEND' } : {}) }
    }
    outMaterials.push(definition)
    materialSlot.set(key, outMaterials.length - 1)
    return outMaterials.length - 1
  }

  const owners = new Map<string, string>()
  const reassigned = new Map<string, string>()
  const ownerOf = (bone: Bone, byName: Map<string, string>): string => {
    for (let current: Object3D | null = bone; current; current = current.parent) {
      const mapped = byName.get(current.name) ?? MIXAMO_NAMES.get(canonical(current.name))
      if (mapped) { if (current !== bone) reassigned.set(bone.name, mapped); return mapped }
    }
    reassigned.set(bone.name, 'Hips')
    return 'Hips'
  }
  const bySource = new Map([...options.mappedSources].map(([target, source]) => [source, target] as const))

  const meshNodes: number[] = [], outMeshes: Json[] = []
  const writtenWeights: Array<{ accessor: number; count: number }> = []
  const expected: Array<{ positions: Float32Array }> = []
  let vertices = 0, primitives = 0, maxBefore = 0, maxAfter = 0, dropped = 0, affected = 0, morphMeshes = 0
  const usedNames = new Set<string>((out.nodes as Json[]).map((node) => node.name))
  const rotationOnly = (matrix: Matrix4) => new Matrix4().extractRotation(matrix)

  for (const mesh of meshes) {
    const geometry = mesh.geometry, position = geometry.getAttribute('position') as BufferAttribute
    const skinIndex = [geometry.getAttribute('skinIndex'), geometry.getAttribute('skinIndex1')].filter(Boolean) as BufferAttribute[]
    const skinWeight = [geometry.getAttribute('skinWeight'), geometry.getAttribute('skinWeight1')].filter(Boolean) as BufferAttribute[]
    if (!skinIndex.length || skinIndex.length !== skinWeight.length) throw new ModelBlockedError('MODEL_SKIN_INVALID', `${mesh.name || 'mesh'} has no skin attributes`)
    const bones = mesh.skeleton.bones
    if (new Set(bones.map((bone) => bone.name)).size !== bones.length) throw new ModelBlockedError('MODEL_SKIN_INVALID', 'Source joint names are ambiguous')
    for (const bone of bones) if (!owners.has(bone.name)) owners.set(bone.name, ownerOf(bone, bySource))
    mesh.skeleton.update()
    const boneMatrices = mesh.skeleton.boneMatrices
    if (!boneMatrices) throw new ModelBlockedError('MODEL_SKIN_INVALID', 'Source skeleton did not produce bone matrices')
    const normal = geometry.getAttribute('normal') as BufferAttribute | undefined
    const tangent = geometry.getAttribute('tangent') as BufferAttribute | undefined
    const color = geometry.getAttribute('color') as BufferAttribute | undefined
    const uvs = ['uv', 'uv1', 'uv2', 'uv3'].map((name) => geometry.getAttribute(name) as BufferAttribute | undefined)
    if (geometry.morphAttributes && Object.keys(geometry.morphAttributes).length) morphMeshes++
    const count = position.count
    // Rest pose as the source displays it: world = A · Σ(w·boneMatrix) · bindMatrix · v, then source units → meters.
    const A = basis.clone().multiply(mesh.matrixWorld).multiply(mesh.bindMatrixInverse)
    const influences: Array<{ boneId: string; weight: number }[]> = new Array(count)
    const outPosition = new Float32Array(count * 3), outNormal = normal ? new Float32Array(count * 3) : null, outTangent = tangent ? new Float32Array(count * 4) : null
    const skinned = new Matrix4(), term = new Matrix4(), full = new Matrix4(), v = new Vector3()
    for (let vertex = 0; vertex < count; vertex++) {
      const list: Array<{ boneId: string; weight: number }> = []
      skinned.elements.fill(0)
      let total = 0
      for (let set = 0; set < skinIndex.length; set++) for (let slot = 0; slot < 4; slot++) {
        const weight = skinWeight[set]!.getComponent(vertex, slot)
        if (!(weight > 0)) continue
        const joint = skinIndex[set]!.getComponent(vertex, slot), bone = bones[joint]
        if (!bone || !Number.isFinite(weight)) throw new ModelBlockedError('MODEL_SKIN_INVALID', `Vertex ${vertex} of ${mesh.name} references an invalid joint`)
        list.push({ boneId: bone.name, weight })
        term.fromArray(boneMatrices, joint * 16)
        for (let e = 0; e < 16; e++) skinned.elements[e]! += term.elements[e]! * weight
        total += weight
      }
      if (!(total > 0)) throw new ModelBlockedError('MODEL_SKIN_INVALID', `Vertex ${vertex} of ${mesh.name} has no skin weight`)
      for (let e = 0; e < 16; e++) skinned.elements[e]! /= total
      maxBefore = Math.max(maxBefore, list.length)
      influences[vertex] = list
      full.multiplyMatrices(A, skinned).multiply(mesh.bindMatrix)
      v.fromBufferAttribute(position, vertex).applyMatrix4(full).toArray(outPosition, vertex * 3)
      if (outNormal || outTangent) {
        const rotation = rotationOnly(full)
        if (normal) { v.fromBufferAttribute(normal, vertex).applyMatrix4(rotation).normalize().toArray(outNormal!, vertex * 3) }
        if (tangent) { v.set(tangent.getX(vertex), tangent.getY(vertex), tangent.getZ(vertex)).applyMatrix4(rotation).normalize().toArray(outTangent!, vertex * 4); outTangent![vertex * 4 + 3] = tangent.getW(vertex) }
      }
    }
    const transfer = transferSkinWeights(influences.map((list) => ({ influences: list })), owners, MAX_INFLUENCES)
    dropped += transfer.droppedWeight; affected += transfer.affectedVertices
    const joints = new Uint16Array(count * 4), weights = new Float32Array(count * 4)
    transfer.vertices.forEach((vertex, index) => {
      maxAfter = Math.max(maxAfter, vertex.influences.length)
      vertex.influences.forEach((influence, slot) => { joints[index * 4 + slot] = jointSlot.get(influence.boneId)!; weights[index * 4 + slot] = influence.weight })
    })
    // Float32 rounding of the weights must not move the sum off 1.
    for (let index = 0; index < count; index++) {
      let sum = 0
      for (let slot = 0; slot < 4; slot++) sum += weights[index * 4 + slot]!
      if (Math.abs(sum - 1) > 1e-7) for (let slot = 0; slot < 4; slot++) weights[index * 4 + slot]! /= sum
    }

    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity]
    for (let i = 0; i < count * 3; i++) { min[i % 3] = Math.min(min[i % 3]!, outPosition[i]!); max[i % 3] = Math.max(max[i % 3]!, outPosition[i]!) }
    const attributes: Json = { POSITION: addAccessor(addView(bytesOf(outPosition), 34962), 5126, count, 'VEC3', { min, max }) }
    if (outNormal) attributes.NORMAL = addAccessor(addView(bytesOf(outNormal), 34962), 5126, count, 'VEC3')
    if (outTangent) attributes.TANGENT = addAccessor(addView(bytesOf(outTangent), 34962), 5126, count, 'VEC4')
    uvs.forEach((uv, set) => { if (uv) attributes[`TEXCOORD_${set}`] = addAccessor(addView(bytesOf(Float32Array.from({ length: count * 2 }, (_, i) => uv.getComponent(Math.floor(i / 2), i % 2))), 34962), 5126, count, 'VEC2') })
    if (color) {
      const size = color.itemSize === 4 ? 4 : 3
      attributes.COLOR_0 = addAccessor(addView(bytesOf(Float32Array.from({ length: count * size }, (_, i) => color.getComponent(Math.floor(i / size), i % size))), 34962), 5126, count, size === 4 ? 'VEC4' : 'VEC3')
    }
    attributes.JOINTS_0 = addAccessor(addView(bytesOf(joints), 34962), 5123, count, 'VEC4')
    attributes.WEIGHTS_0 = addAccessor(addView(bytesOf(weights), 34962), 5126, count, 'VEC4')
    writtenWeights.push({ accessor: attributes.WEIGHTS_0, count })

    const indexArray = geometry.index ? Array.from({ length: geometry.index.count }, (_, i) => geometry.index!.getX(i)) : Array.from({ length: count }, (_, i) => i)
    const groups = Array.isArray(mesh.material) && geometry.groups.length ? geometry.groups : [{ start: 0, count: indexArray.length, materialIndex: 0 }]
    const primitiveList: Json[] = []
    for (const group of groups) {
      const slice = indexArray.slice(group.start, Math.min(indexArray.length, group.start + group.count))
      if (!slice.length) continue
      const wide = count > 65535
      const data = wide ? Uint32Array.from(slice) : Uint16Array.from(slice)
      const material = materialFor(mesh, group.materialIndex ?? 0)
      primitiveList.push({ attributes, indices: addAccessor(addView(bytesOf(data), 34963), wide ? 5125 : 5123, slice.length, 'SCALAR'), mode: 4, ...(material === undefined ? {} : { material }) })
    }
    // GLTFLoader yields one SkinnedMesh per primitive, in order; each shares this vertex data.
    for (let i = 0; i < primitiveList.length; i++) expected.push({ positions: outPosition })
    primitives += primitiveList.length; vertices += count
    outMeshes.push({ name: mesh.name || `mesh_${outMeshes.length}`, primitives: primitiveList })
    let nodeName = mesh.name || `mesh_${outMeshes.length - 1}`
    while (usedNames.has(nodeName)) nodeName += '_mesh'
    usedNames.add(nodeName)
    ;(out.nodes as Json[]).push({ name: nodeName, mesh: outMeshes.length - 1, skin: 0 })
    meshNodes.push(out.nodes.length - 1)
  }

  // Inverse bind matrices: skinning at rest is the identity, so the stored positions are the source rest shape.
  const ibm = new Float32Array(65 * 16)
  skeleton.names.forEach((name, slot) => new Matrix4().copy(skeleton.jointWorld.get(name)!).invert().toArray(ibm, slot * 16))
  out.skins[0].inverseBindMatrices = addAccessor(addView(bytesOf(ibm)), 5126, 65, 'MAT4')
  out.scenes[out.scene ?? 0].nodes.push(...meshNodes)
  out.meshes = outMeshes
  if (outMaterials.length) out.materials = outMaterials
  if (outSamplers.length) out.samplers = outSamplers
  if (outTextures.length) out.textures = outTextures
  if (outImages.length) out.images = outImages
  const finalBin = builder.toBytes()
  out.buffers = [{ byteLength: finalBin.length }]
  const used = (files?.json.extensionsUsed as string[] | undefined ?? []).filter((name) => !SKIN_EXTENSION_NAMES.includes(name))
  const body = JSON.stringify({ ...out, extensionsUsed: undefined })
  const extensionsUsed = used.filter((name) => body.includes(`"${name}"`))
  if (extensionsUsed.length) out.extensionsUsed = extensionsUsed
  const glb = encodeGlb(out, finalBin)

  // Validate what was written: reload through GLTFLoader and read the weight accessors back from the bytes.
  const reloaded = await loadAsset(glb, 'glb', { keepMeshes: true })
  reloaded.updateMatrixWorld(true)
  const reloadedMeshes: SkinnedMesh[] = []
  reloaded.traverse((node) => { if ((node as SkinnedMesh).isSkinnedMesh) reloadedMeshes.push(node as SkinnedMesh) })
  let restMax = 0
  const skins = new Set(reloadedMeshes.map((mesh) => mesh.skeleton))
  const reloadedJoints = [...skins][0]?.bones.map((bone) => bone.name) ?? []
  for (const mesh of reloadedMeshes) {
    mesh.skeleton.update()
    const target = new Vector3(), expectedMesh = expected[reloadedMeshes.indexOf(mesh)]
    if (!expectedMesh) continue
    const position = mesh.geometry.getAttribute('position')
    for (let vertex = 0; vertex < position.count; vertex++) {
      mesh.applyBoneTransform(vertex, target.fromBufferAttribute(position, vertex)).applyMatrix4(mesh.matrixWorld)
      restMax = Math.max(restMax, Math.hypot(target.x - expectedMesh.positions[vertex * 3]!, target.y - expectedMesh.positions[vertex * 3 + 1]!, target.z - expectedMesh.positions[vertex * 3 + 2]!))
    }
  }
  const finalJson = decodeGlb(glb).json
  const view = (accessorIndex: number) => { const a = finalJson.accessors[accessorIndex], bv = finalJson.bufferViews[a.bufferView]; return new Float32Array(finalBin.buffer.slice(finalBin.byteOffset + (bv.byteOffset ?? 0), finalBin.byteOffset + (bv.byteOffset ?? 0) + a.count * 16)) }
  let weightSumError = 0, overLimit = 0
  for (const { accessor, count } of writtenWeights) {
    const data = view(accessor)
    for (let vertex = 0; vertex < count; vertex++) {
      let sum = 0, nonZero = 0
      for (let slot = 0; slot < 4; slot++) { const w = data[vertex * 4 + slot]!; sum += w; if (w > 0) nonZero++ }
      weightSumError = Math.max(weightSumError, Math.abs(sum - 1)); if (nonZero > MAX_INFLUENCES) overLimit++
    }
  }
  const joints = skeleton.names
  const unprefixed = (finalJson.nodes as Json[]).filter((node) => /^mixamorig/i.test(node.name ?? '')).length === 0
  const hasExternalUri = [...(finalJson.images ?? []), ...(finalJson.buffers ?? [])].some((item: Json) => item.uri !== undefined)
  const imagesViaView = (finalJson.images ?? []).every((image: Json) => image.bufferView !== undefined)

  // Mesh fit: Phase 1 keeps the source shape, so large joint offsets mean skeleton and mesh proportions differ.
  const fit = joints.map((name) => {
    const sourceName = options.mappedSources.get(name)
    const bone = sourceName ? findBone(options.source, sourceName) : undefined
    if (!bone) return null
    const p = new Vector3().setFromMatrixPosition(bone.matrixWorld).applyMatrix4(basis), q = new Vector3().setFromMatrixPosition(skeleton.jointWorld.get(name)!)
    return { name, distance: p.distanceTo(q) }
  }).filter((item): item is { name: string; distance: number } => !!item)
  const worst = fit.reduce((a, b) => (b.distance > a.distance ? b : a), { name: '-', distance: 0 })
  const warnings: Array<{ code: string; message: string }> = []
  if (worst.distance > JOINT_FIT_WARN_METERS) warnings.push({ code: 'MODEL_NOT_REFIT', message: `Mesh keeps its source shape but joints differ from the target rest by up to ${worst.distance.toFixed(3)} m (${worst.name}); fitting the rig to the model is a later phase` })
  if (Math.abs(options.facingYawDegrees) > 1e-6) warnings.push({ code: 'MODEL_FACING_NOT_APPLIED', message: `Animation was calibrated with a ${options.facingYawDegrees.toFixed(0)} degree facing yaw; the mesh was not rotated` })
  if (morphMeshes) warnings.push({ code: 'MORPH_TARGETS_DROPPED', message: `${morphMeshes} mesh(es) have morph targets; they are not exported` })
  if (!files && outMaterials.length) warnings.push({ code: 'TEXTURES_NOT_EXPORTED', message: 'FBX textures are not extracted headless; materials keep their base colour only' })
  const checks: Record<string, 'PASS' | 'FAIL'> = {
    singleSkin65: finalJson.skins?.length === 1 && reloadedJoints.length === 65 && skins.size === 1 ? 'PASS' : 'FAIL',
    jointNamesUnprefixed: unprefixed && reloadedJoints.every((name) => MIXAMO_NAMES.has(canonical(name))) ? 'PASS' : 'FAIL',
    maxInfluences4: overLimit === 0 ? 'PASS' : 'FAIL',
    weightsSum1: weightSumError < 1e-4 ? 'PASS' : 'FAIL',
    animationsPreserved: (finalJson.animations ?? []).length === (json.animations ?? []).length ? 'PASS' : 'FAIL',
    texturesEmbedded: !hasExternalUri && imagesViaView ? 'PASS' : 'FAIL',
    restPoseWithin1mm: restMax < REST_ERROR_LIMIT_METERS ? 'PASS' : 'FAIL',
  }
  const report: ModelReport = { meshes: meshes.length, primitives, vertices, maxInfluencesBefore: maxBefore, maxInfluencesAfter: maxAfter, droppedWeight: dropped, affectedVertices: affected,
    images: { count: outImages.length, bytes: imageBytesTotal, embedded: !hasExternalUri && imagesViaView, sourceImages: files?.json.images?.length ?? 0 }, materials: outMaterials.length,
    restMaxErrorMeters: restMax, jointFit: { meanMeters: fit.length ? fit.reduce((s, i) => s + i.distance, 0) / fit.length : 0, maxMeters: worst.distance, worstJoint: worst.name },
    reassignedBones: [...reassigned].map(([bone, owner]) => ({ bone, owner })), checks, warnings,
    status: Object.values(checks).every((c) => c === 'PASS') ? 'PASS' : 'FAIL' }
  return { glb, report }
}

function findBone(root: Object3D, name: string): Object3D | undefined {
  let found: Object3D | undefined
  root.traverse((node) => { if (!found && node.name === name) found = node })
  return found
}

export interface ApplyModelModeOptions {
  /** Loads the mesh-keeping source lazily — blocked results never pay for it. */
  loadSource: () => Promise<Object3D>
  files: ModelSourceFiles | null
  unitMeters: number
  upAxis: 'y' | 'z'
}

/** Turns an animation-mode result into the Model+Rig+Animation result (or a BLOCKED/FAIL one). Non-GLB results pass through. */
export async function applyModelMode(result: PipelineResult, options: ApplyModelModeOptions): Promise<PipelineResult> {
  if (!('glb' in result)) return result
  const report = result.report as Json
  const blocked = (code: string, message: string) => ({ status: 'BLOCKED' as const, report: { ...report, status: 'BLOCKED', blocker: { code, message } } })
  const family = report.mapping.family as string
  if (family !== 'mixamo') return blocked('MODEL_MODE_FAMILY_UNSUPPORTED', `Model mode phase 1 supports Mixamo-family sources only (detected: ${family}); fitting rig65 to other models is a later phase`) as PipelineResult
  try {
    const mappedSources = new Map<string, string>((report.mapping.joints as Array<{ target: string; source: string | null }>).flatMap((joint) => joint.source ? [[joint.target, joint.source] as const] : []))
    const { glb, report: model } = await exportModelGlb({ animationGlb: result.glb, source: await options.loadSource(), files: options.files, unitMeters: options.unitMeters, upAxis: options.upAxis,
      mappedSources, facingYawDegrees: report.calibration.facingYawDegrees })
    const glbSha256 = sha256(glb)
    const manifest = { ...result.manifest, glb: { bytes: glb.length, mode: 'model' as const }, glbSha256 }
    const gates = { ...report.gates, model: model.status }
    const nextReport = { ...report, gates, status: Object.values(gates).every((gate) => gate === 'PASS') ? 'PASS' : 'FAIL', model,
      contract: { ...report.contract, ...Object.fromEntries(Object.entries(model.checks).map(([key, value]) => [`model.${key}`, value])) },
      animationGlbSha256: report.glbSha256, glbSha256 }
    return { ...result, status: nextReport.status, glb, manifest, report: nextReport } as unknown as PipelineResult
  } catch (error) {
    if (error instanceof ModelBlockedError) return blocked(error.code, error.message) as PipelineResult
    throw error
  }
}
