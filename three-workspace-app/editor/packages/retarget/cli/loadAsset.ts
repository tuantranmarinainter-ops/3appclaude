import { readFileSync } from 'node:fs'
import { isAbsolute, relative, resolve } from 'node:path'
import { LoadingManager, type Bone, type Mesh, type Object3D } from 'three'
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { decodeGlb, encodeGlb } from './glb.ts'
import { loadBobj } from './loadBobj.ts'

export type AssetFormat = 'glb' | 'gltf' | 'fbx' | 'bobj'

export function formatFromPath(path: string): AssetFormat {
  const extension = path.toLowerCase().split('.').pop()
  if (extension === 'glb' || extension === 'gltf' || extension === 'fbx' || extension === 'bobj') return extension
  throw new TypeError(`Unsupported source format .${extension}; App 1 reads FBX/GLB/glTF and Minecraft20 .bobj only`)
}

const MESH_EXTENSIONS = ['KHR_draco_mesh_compression', 'EXT_meshopt_compression', 'KHR_mesh_quantization']

/**
 * Animation-only output needs nodes, skins and animations, not geometry. Dropping meshes avoids Draco/meshopt
 * decoders (Worker/fetch based, unavailable in Node); skin joints are still marked as Bones by GLTFLoader.
 */
function stripGltfMeshes(json: Record<string, any>): Record<string, any> {
  const copy = structuredClone(json)
  for (const node of copy.nodes ?? []) delete node.mesh
  delete copy.meshes
  for (const key of ['extensionsUsed', 'extensionsRequired']) if (copy[key]) copy[key] = copy[key].filter((name: string) => !MESH_EXTENSIONS.includes(name))
  return copy
}

type FbxNode = Object3D & { isBone?: boolean; ID?: number }

/**
 * FBXLoader adds an identity child Bone (same FBX model ID and name) when one bone deforms several meshes; the
 * duplicate name makes animation tracks ambiguous. Same rule as `isFbxBoneAlias` in packages/builder
 * (src/evaluate/retarget/fbxSourceBones.ts), copied because retarget must not depend on builder.
 */
export function removeFbxBoneAliases(root: Object3D): number {
  const aliases: FbxNode[] = []
  root.traverse((node: FbxNode) => {
    const parent = node.parent as FbxNode | null
    if (!node.isBone || !parent?.isBone || node.name !== parent.name || !Number.isSafeInteger(node.ID) || node.ID !== parent.ID) return
    if ('transformData' in node.userData || node.position.lengthSq() !== 0 || node.scale.x !== 1 || node.scale.y !== 1 || node.scale.z !== 1 ||
        node.quaternion.x !== 0 || node.quaternion.y !== 0 || node.quaternion.z !== 0 || node.quaternion.w !== 1) return
    aliases.push(node)
  })
  for (const alias of aliases) {
    for (const child of [...alias.children]) alias.parent!.add(child)
    alias.removeFromParent()
  }
  return aliases.length
}

/**
 * FBXLoader touches the DOM for textures (`window.URL.createObjectURL`, `document.createElementNS('img')`) and cameras
 * (`window.innerWidth`). Skeleton-only loads never use those results, so a throwaway stub is installed for the parse only.
 */
function withDomStub<T>(parse: () => T): T {
  const scope = globalThis as Record<string, unknown>, saved = { window: scope.window, document: scope.document }
  const image = () => ({ addEventListener() {}, removeEventListener() {}, src: '', crossOrigin: '' })
  scope.window ??= { URL: { createObjectURL: () => 'data:,', revokeObjectURL() {} }, innerWidth: 1, innerHeight: 1 }
  scope.document ??= { createElementNS: image }
  try { return parse() } finally { scope.window = saved.window; scope.document = saved.document }
}

/**
 * `.gltf` exports (wow.export writes one .bin per animation) keep buffers next to the JSON. They are packed into a single
 * in-memory GLB (buffers concatenated 4-byte aligned, bufferView offsets shifted) — GLTFLoader's FileLoader path needs
 * browser-only APIs in Node. Buffers are read from `resourceDir` only: absolute paths or `..` escapes are refused, so a
 * crafted file cannot read elsewhere. Images are not read (skeleton-only loads drop materials with the meshes).
 */
function packGltf(json: Record<string, any>, resourceDir: string | undefined): Uint8Array {
  const parts = (json.buffers ?? []).map((buffer: { uri?: string }) => {
    if (typeof buffer.uri !== 'string') throw new TypeError('glTF buffer without uri is not supported')
    if (buffer.uri.startsWith('data:')) return Buffer.from(buffer.uri.slice(buffer.uri.indexOf(',') + 1), 'base64')
    if (!resourceDir) throw new TypeError(`glTF buffer ${buffer.uri} is external; pass the .gltf path so its folder can be read`)
    const uri = decodeURIComponent(buffer.uri), path = resolve(resourceDir, uri), inside = relative(resolve(resourceDir), path)
    if (isAbsolute(uri) || !inside || inside.startsWith('..') || isAbsolute(inside)) throw new TypeError(`glTF buffer ${buffer.uri} is outside the glTF folder`)
    return readFileSync(path)
  })
  const offsets: number[] = []
  let total = 0
  for (const part of parts) { offsets.push(total); total += Math.ceil(part.length / 4) * 4 }
  const bin = new Uint8Array(total)
  parts.forEach((part: Uint8Array, index: number) => bin.set(part, offsets[index]!))
  for (const view of json.bufferViews ?? []) { view.byteOffset = (view.byteOffset ?? 0) + offsets[view.buffer]!; view.buffer = 0 }
  json.buffers = total ? [{ byteLength: total }] : []
  return encodeGlb(json, bin)
}

/** Node-side loading: external resources are refused (except .gltf buffers in `resourceDir`), so files must be self-contained. */
export async function loadAsset(bytes: Uint8Array, format: AssetFormat, options: { skeletonOnly?: boolean; resourceDir?: string; bobjArmature?: Uint8Array } = {}): Promise<Object3D> {
  if (format === 'bobj') {
    const text = new TextDecoder().decode(bytes)
    // Action libraries carry no `arm_bone` records; the rig comes from a separate armature file (--armature).
    const armature = options.bobjArmature ? new TextDecoder().decode(options.bobjArmature) : /^arm_bone /m.test(text) ? text : null
    if (!armature) throw new TypeError('This .bobj has no arm_bone records; pass its rig with --armature <armature.bobj>')
    return loadBobj(text, armature)
  }
  const manager = new LoadingManager()
  // Skeleton-only loads ignore textures, so external texture paths resolve to an empty data URL instead of failing.
  manager.setURLModifier((url) => {
    if (url.startsWith('data:') || options.skeletonOnly) return url.startsWith('data:') ? url : 'data:,'
    throw new TypeError(`External resource not supported headless: ${url}`)
  })
  const buffer = Uint8Array.from(bytes).buffer
  if (format === 'fbx') {
    const root = options.skeletonOnly ? withDomStub(() => new FBXLoader(manager).parse(buffer, '')) : new FBXLoader(manager).parse(buffer, '')
    if (options.skeletonOnly) {
      // Same reason as glTF: geometry is unused; per-mesh Skeleton copies would otherwise read as competing skeletons.
      const meshes: Object3D[] = []
      root.traverse((node) => { if ((node as Mesh).isMesh) meshes.push(node) })
      for (const mesh of meshes) mesh.removeFromParent()
      removeFbxBoneAliases(root)
    }
    return root
  }
  const glb = format === 'gltf' ? packGltf(JSON.parse(new TextDecoder().decode(bytes)), options.resourceDir) : bytes
  let data: ArrayBuffer = Uint8Array.from(glb).buffer
  if (options.skeletonOnly) { const { json, bin } = decodeGlb(glb); data = encodeGlb(stripGltfMeshes(json), bin).buffer as ArrayBuffer }
  const gltf = await new GLTFLoader(manager).parseAsync(data, '')
  gltf.scene.animations = gltf.animations
  return gltf.scene
}
