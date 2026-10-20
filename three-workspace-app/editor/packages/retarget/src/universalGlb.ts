import { Matrix4, Quaternion, Vector3 } from 'three'
import { isMixamo65Topology } from './mixamo65'
import type { UniversalBakeFrame } from './universalBake'
import type { RetargetRig } from './universal'

/** Animation-only interchange: preserves target rest hierarchy; no mesh, materials, or source action is rewritten. */
export function universalFramesToGlb(rig: RetargetRig, jointIds: readonly string[], frames: readonly UniversalBakeFrame[], name = 'Normalized motion'): Uint8Array {
  const byId = new Map(rig.bones.map((bone, index) => [bone.id, { bone, index }]))
  if (byId.size !== rig.bones.length || !jointIds.length || new Set(jointIds).size !== jointIds.length || !frames.length || frames.length > 18_000) throw new TypeError('GLB export requires a unique target hierarchy, joints, and 1–18000 sampled frames')
  const joints = new Set(jointIds)
  const topology = jointIds.map((id) => {
    const entry = byId.get(id)
    if (!entry) throw new TypeError(`Target joint not found: ${id}`)
    let parentId = entry.bone.parentId
    const seen = new Set([id])
    while (parentId && !joints.has(parentId)) {
      if (seen.has(parentId) || !byId.has(parentId)) throw new TypeError('Target contains a cycle or missing parent')
      seen.add(parentId); parentId = byId.get(parentId)!.bone.parentId
    }
    return { id, name: entry.bone.name ?? id, parentId, deform: true }
  })
  if (!isMixamo65Topology(topology)) throw new TypeError('Animation-only output requires the canonical Mixamo65 joint topology')
  const parts: Uint8Array[] = []
  let byteLength = 0
  const bufferViews: Array<{ buffer: number; byteOffset: number; byteLength: number }> = []
  const accessors: Array<Record<string, unknown>> = []
  function floats(values: number[], size: number, bounds = false): number {
    if (!values.length || values.length % size || values.some((value) => !Number.isFinite(value) || Math.abs(value) > 3.4028234663852886e38)) throw new TypeError('Animation data must fit finite float32 values')
    const bytes = new Uint8Array(values.length * 4), view = new DataView(bytes.buffer)
    values.forEach((value, index) => view.setFloat32(index * 4, value, true))
    const bufferView = bufferViews.length
    bufferViews.push({ buffer: 0, byteOffset: byteLength, byteLength: bytes.length })
    parts.push(bytes); byteLength += bytes.length
    const accessor = accessors.length
    accessors.push({ bufferView, componentType: 5126, count: values.length / size, type: size === 1 ? 'SCALAR' : size === 3 ? 'VEC3' : 'VEC4',
      ...(bounds ? { min: [Math.min(...values)], max: [Math.max(...values)] } : {}) })
    return accessor
  }
  const times = frames.map((frame, index) => {
    if (!Number.isFinite(frame.timeSeconds) || (index && frame.timeSeconds <= frames[index - 1]!.timeSeconds)) throw new TypeError('Frame times must be finite and strictly increasing')
    return frame.timeSeconds - frames[0]!.timeSeconds
  })
  const input = floats(times, 1, true)
  const frameMaps = frames.map((frame) => {
    const poses = new Map(frame.bones.map((bone) => [bone.targetBoneId, bone]))
    if (poses.size !== frame.bones.length || frame.bones.some((bone) => !byId.has(bone.targetBoneId)) || rig.bones.some((bone) => !poses.has(bone.id))) throw new TypeError('Export frames must contain every target node exactly once and no unknown nodes')
    return poses
  })
  const samplers: Array<{ input: number; output: number; interpolation: string }> = []
  const channels: Array<{ sampler: number; target: { node: number; path: string } }> = []
  const matrices = new Map(rig.bones.map((bone) => {
    if (bone.restWorld.length !== 16 || bone.restWorld.some((value) => !Number.isFinite(value))) throw new TypeError(`Invalid target rest matrix: ${bone.id}`)
    const matrix = new Matrix4().fromArray(bone.restWorld)
    if (!Number.isFinite(matrix.determinant()) || matrix.determinant() === 0) throw new TypeError(`Singular target rest matrix: ${bone.id}`)
    return [bone.id, matrix] as const
  }))
  const roots: number[] = []
  const nodes = rig.bones.map((bone, index) => {
    const parent = bone.parentId ? matrices.get(bone.parentId) : undefined
    if (bone.parentId && !parent) throw new TypeError(`Missing target parent: ${bone.parentId}`)
    if (!bone.parentId) roots.push(index)
    const local = parent ? parent.clone().invert().multiply(matrices.get(bone.id)!) : matrices.get(bone.id)!
    const position = new Vector3(), rotation = new Quaternion(), scale = new Vector3()
    local.decompose(position, rotation, scale)
    const reconstructed = new Matrix4().compose(position, rotation, scale)
    if (local.elements.some((value, axis) => Math.abs(value - reconstructed.elements[axis]!) > 1e-6 * Math.max(1, Math.abs(value)))) throw new TypeError(`Target rest contains unsupported shear: ${bone.id}`)
    for (const [key, path, size] of [['position', 'translation', 3], ['rotation', 'rotation', 4], ['scale', 'scale', 3]] as const) {
        const output = floats(frameMaps.flatMap((poses) => {
          const values = poses.get(bone.id)![key]
          if (values.length !== size) throw new TypeError(`Invalid ${path} size for ${bone.id}`)
          if (key === 'rotation' && Math.abs(Math.hypot(...values) - 1) > 1e-5) throw new TypeError(`Invalid rotation for ${bone.id}`)
          return values
        }), size)
        channels.push({ sampler: samplers.length, target: { node: index, path } })
        samplers.push({ input, output, interpolation: 'LINEAR' })
    }
    return { name: bone.name || bone.id, translation: position.toArray(), rotation: rotation.normalize().toArray(), scale: scale.toArray(), children: [] as number[] }
  })
  for (const [index, bone] of rig.bones.entries()) if (bone.parentId) nodes[byId.get(bone.parentId)!.index]!.children.push(index)
  const visited = new Set<number>(), queue = [...roots]
  for (let index = 0; index < queue.length; index++) { const node = queue[index]!; if (visited.has(node)) throw new TypeError('Target contains a hierarchy cycle'); visited.add(node); queue.push(...nodes[node]!.children) }
  if (visited.size !== nodes.length) throw new TypeError('Target contains a hierarchy cycle')
  const document = { asset: { version: '2.0', generator: 'BBS Universal Animation Retargeting', extras: { targetFingerprint: rig.fingerprint } },
    scene: 0, scenes: [{ nodes: roots }], nodes, skins: [{ joints: jointIds.map((id) => byId.get(id)!.index) }],
    buffers: [{ byteLength }], bufferViews, accessors, animations: [{ name, samplers, channels }] }
  const json = new TextEncoder().encode(JSON.stringify(document)), jsonLength = Math.ceil(json.length / 4) * 4
  const result = new Uint8Array(28 + jsonLength + byteLength), header = new DataView(result.buffer)
  header.setUint32(0, 0x46546c67, true); header.setUint32(4, 2, true); header.setUint32(8, result.length, true)
  header.setUint32(12, jsonLength, true); header.setUint32(16, 0x4e4f534a, true)
  result.fill(32, 20, 20 + jsonLength); result.set(json, 20)
  header.setUint32(20 + jsonLength, byteLength, true); header.setUint32(24 + jsonLength, 0x004e4942, true)
  let offset = 28 + jsonLength
  for (const part of parts) { result.set(part, offset); offset += part.length }
  return result
}
