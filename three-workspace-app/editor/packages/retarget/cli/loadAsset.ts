import { LoadingManager, type Object3D } from 'three'
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'

export type AssetFormat = 'glb' | 'gltf' | 'fbx'

export function formatFromPath(path: string): AssetFormat {
  const extension = path.toLowerCase().split('.').pop()
  if (extension === 'glb' || extension === 'gltf' || extension === 'fbx') return extension
  throw new TypeError(`Unsupported source format .${extension}; App 1 reads FBX/GLB/glTF only`)
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

function rewriteGlbJson(bytes: Uint8Array, edit: (json: Record<string, any>) => Record<string, any>): ArrayBuffer {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(16, true) !== 0x4e4f534a) throw new TypeError('Not a binary glTF (GLB) file')
  const jsonLength = view.getUint32(12, true)
  const json = new TextEncoder().encode(JSON.stringify(edit(JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength))))))
  const padded = Math.ceil(json.length / 4) * 4, rest = bytes.subarray(20 + jsonLength)
  const result = new Uint8Array(20 + padded + rest.length), header = new DataView(result.buffer)
  header.setUint32(0, 0x46546c67, true); header.setUint32(4, 2, true); header.setUint32(8, result.length, true)
  header.setUint32(12, padded, true); header.setUint32(16, 0x4e4f534a, true)
  result.fill(32, 20, 20 + padded); result.set(json, 20); result.set(rest, 20 + padded)
  return result.buffer
}

/** Node-side loading: external resources are refused, so only self-contained files work headless. */
export async function loadAsset(bytes: Uint8Array, format: AssetFormat, options: { skeletonOnly?: boolean } = {}): Promise<Object3D> {
  const manager = new LoadingManager()
  manager.setURLModifier((url) => { if (url.startsWith('data:')) return url; throw new TypeError(`External resource not supported headless: ${url}`) })
  const buffer = Uint8Array.from(bytes).buffer
  if (format === 'fbx') return new FBXLoader(manager).parse(buffer, '')
  const data = format === 'gltf'
    ? JSON.stringify((options.skeletonOnly ? stripGltfMeshes : (json: Record<string, any>) => json)(JSON.parse(new TextDecoder().decode(bytes))))
    : options.skeletonOnly ? rewriteGlbJson(bytes, stripGltfMeshes) : buffer
  const gltf = await new GLTFLoader(manager).parseAsync(data, '')
  gltf.scene.animations = gltf.animations
  return gltf.scene
}
