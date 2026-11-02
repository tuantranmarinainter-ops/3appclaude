import { randomUUID } from 'node:crypto'
import { Matrix4, PropertyBinding, Quaternion, Vector3 } from 'three'
import type { UnifiedProject } from '@bbs/animation-workspace-shared'
import { resolveCharacter } from '../../../packages/library/index'
import { libraryCharacterModel, packLibraryGlb, unpackLibraryGlb } from './libraryModels'
import { sha256 } from './shotPackage'
import { resolveUnifiedAssetFile } from './unifiedAssetFiles'
import { sampleProjectSkeletonRange } from './unifiedSkeletonEvaluation'

/**
 * K5: nướng một đoạn chuyển động đã trộn (tư thế xương cục bộ từng khung, lấy từ cùng bộ lấy mẫu với viewport / film)
 * thành một animation GLB duy nhất trên model nhân vật. Mỗi xương có kênh quay; kênh vị trí chỉ cho xương có đổi vị trí
 * (hoặc khác vị trí nghỉ của model), nên App 3 thấy đúng những gì App 2 thấy mà không phình dung lượng.
 */
export interface BakedBoneSample { name: string; position: number[]; rotation: number[]; scale?: number[]; worldMatrix?: number[] }
/** Một khung nướng: tư thế cục bộ từng xương + ma trận thế giới của nút actor (để suy ra nút bọc trên xương gốc). */
export interface BakedFrame { bones: readonly BakedBoneSample[]; actorWorld?: number[] }

const EPSILON = 1e-7

function align4(buffer: Buffer): Buffer {
  const padded = Buffer.alloc(Math.ceil(buffer.length / 4) * 4)
  buffer.copy(padded)
  return padded
}

/** frames[i] = tư thế mọi xương ở khung i (cách nhau 1/fps giây). Trả GLB mới; model gốc không bị sửa. */
export function addBakedAnimationToGlb(modelBytes: Buffer, frames: readonly BakedFrame[], fps: number, name: string): Buffer {
  if (frames.length < 2) throw new TypeError('Cần ít nhất hai khung để nướng animation')
  const { json, binary } = unpackLibraryGlb(modelBytes)
  const nodes: Array<{ name?: string; translation?: number[] }> = json.nodes ?? []
  const byName = new Map<string, number>()
  nodes.forEach((node, index) => {
    if (typeof node.name !== 'string') return
    if (!byName.has(node.name)) byName.set(node.name, index)
    const sanitized = PropertyBinding.sanitizeNodeName(node.name)
    if (!byName.has(sanitized)) byName.set(sanitized, index)
  })
  const bones = frames[0]!.bones.map((bone) => bone.name)
  const missing = bones.filter((bone) => !byName.has(bone))
  if (missing.length) throw new TypeError(`Model của gói shot thiếu xương: ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? '…' : ''}`)
  if (frames.some((frame) => frame.bones.length !== bones.length || frame.bones.some((bone, i) => bone.name !== bones[i]))) throw new TypeError('Danh sách xương đổi giữa các khung')

  const chunks: Buffer[] = []
  let offset = Math.ceil(binary.length / 4) * 4
  const views: Array<Record<string, unknown>> = json.bufferViews ??= []
  const accessors: Array<Record<string, unknown>> = json.accessors ??= []
  const addAccessor = (values: Float32Array, type: 'SCALAR' | 'VEC3' | 'VEC4', count: number, extra: Record<string, unknown> = {}) => {
    const bytes = align4(Buffer.from(values.buffer, values.byteOffset, values.byteLength))
    views.push({ buffer: 0, byteOffset: offset, byteLength: values.byteLength })
    accessors.push({ bufferView: views.length - 1, componentType: 5126, count, type, ...extra })
    chunks.push(bytes); offset += bytes.length
    return accessors.length - 1
  }
  const count = frames.length
  const times = new Float32Array(count)
  for (let i = 0; i < count; i++) times[i] = i / fps
  const input = addAccessor(times, 'SCALAR', count, { min: [times[0]], max: [times[count - 1]] })
  const channels: Array<Record<string, unknown>> = [], samplers: Array<Record<string, unknown>> = []
  const addChannel = (node: number, path: 'rotation' | 'translation' | 'scale', output: number) => {
    samplers.push({ input, output, interpolation: 'LINEAR' })
    channels.push({ sampler: samplers.length - 1, target: { node, path } })
  }
  for (let b = 0; b < bones.length; b++) {
    const node = byName.get(bones[b]!)!
    const rotation = new Float32Array(count * 4)
    for (let i = 0; i < count; i++) {
      const q = frames[i]!.bones[b]!.rotation
      let sign = 1
      if (i > 0) {
        const p = rotation.subarray((i - 1) * 4, i * 4)
        if (p[0]! * q[0]! + p[1]! * q[1]! + p[2]! * q[2]! + p[3]! * q[3]! < 0) sign = -1
      }
      for (let k = 0; k < 4; k++) rotation[i * 4 + k] = sign * q[k]!
    }
    addChannel(node, 'rotation', addAccessor(rotation, 'VEC4', count))
    const rest = nodes[node]?.translation ?? [0, 0, 0]
    const first = frames[0]!.bones[b]!.position
    let moves = Math.hypot(first[0]! - rest[0]!, first[1]! - rest[1]!, first[2]! - rest[2]!) > 1e-6
    for (let i = 1; i < count && !moves; i++) {
      const p = frames[i]!.bones[b]!.position
      moves = Math.hypot(p[0]! - first[0]!, p[1]! - first[1]!, p[2]! - first[2]!) > EPSILON
    }
    if (!moves) continue
    const translation = new Float32Array(count * 3)
    for (let i = 0; i < count; i++) frames[i]!.bones[b]!.position.forEach((value, k) => { translation[i * 3 + k] = value })
    addChannel(node, 'translation', addAccessor(translation, 'VEC3', count))
  }
  // Nút bọc phía trên xương gốc (vd. "bobj-model" của model BOBJ) cũng mang chuyển động (phép căn chỗ đứng K2): suy ra từ ma trận thế giới.
  const parentOf = new Map<number, number>()
  nodes.forEach((node, index) => { for (const child of (node as { children?: number[] }).children ?? []) parentOf.set(child, index) })
  const sampled = new Set(bones.map((bone) => byName.get(bone)!))
  const topBoneIndex = bones.findIndex((bone) => { const parent = parentOf.get(byName.get(bone)!); return parent !== undefined && !sampled.has(parent) })
  if (topBoneIndex >= 0 && frames.every((frame) => frame.actorWorld && frame.bones[topBoneIndex]!.worldMatrix && frame.bones[topBoneIndex]!.scale)) {
    const wrapper = parentOf.get(byName.get(bones[topBoneIndex]!)!)!
    const above: number[] = []
    for (let up = parentOf.get(wrapper); up !== undefined; up = parentOf.get(up)) above.unshift(up)
    const restOf = (index: number) => {
      const node = nodes[index] as { matrix?: number[]; translation?: number[]; rotation?: number[]; scale?: number[] }
      return node.matrix ? new Matrix4().fromArray(node.matrix) : new Matrix4().compose(new Vector3(...(node.translation ?? [0, 0, 0])), new Quaternion(...(node.rotation ?? [0, 0, 0, 1])), new Vector3(...(node.scale ?? [1, 1, 1])))
    }
    const restAbove = above.reduce((matrix, index) => matrix.multiply(restOf(index)), new Matrix4())
    const inverseAbove = restAbove.clone().invert()
    const translation = new Float32Array(count * 3), rotation = new Float32Array(count * 4), scale = new Float32Array(count * 3)
    const p = new Vector3(), q = new Quaternion(), sc = new Vector3()
    for (let i = 0; i < count; i++) {
      const bone = frames[i]!.bones[topBoneIndex]!
      const local = new Matrix4().compose(new Vector3(...bone.position as [number, number, number]), new Quaternion(...bone.rotation as [number, number, number, number]), new Vector3(...bone.scale as [number, number, number]))
      const parentWorld = new Matrix4().fromArray(bone.worldMatrix!).multiply(local.invert())
      const wrapperLocal = inverseAbove.clone().multiply(new Matrix4().fromArray(frames[i]!.actorWorld!).invert()).multiply(parentWorld)
      wrapperLocal.decompose(p, q, sc)
      if (i > 0 && q.x * rotation[(i - 1) * 4]! + q.y * rotation[(i - 1) * 4 + 1]! + q.z * rotation[(i - 1) * 4 + 2]! + q.w * rotation[(i - 1) * 4 + 3]! < 0) q.set(-q.x, -q.y, -q.z, -q.w)
      p.toArray(translation, i * 3); q.toArray(rotation, i * 4); sc.toArray(scale, i * 3)
    }
    const rest = restOf(wrapper), rp = new Vector3(), rq = new Quaternion(), rs = new Vector3()
    rest.decompose(rp, rq, rs)
    const varies = (values: Float32Array, size: number, restValue: number[]) => {
      for (let i = 0; i < count; i++) for (let k = 0; k < size; k++) if (Math.abs(values[i * size + k]! - (i === 0 ? restValue[k]! : values[k]!)) > 1e-6) return true
      return false
    }
    if (varies(rotation, 4, [rq.x, rq.y, rq.z, rq.w])) addChannel(wrapper, 'rotation', addAccessor(rotation, 'VEC4', count))
    if (varies(translation, 3, rp.toArray())) addChannel(wrapper, 'translation', addAccessor(translation, 'VEC3', count))
    if (varies(scale, 3, rs.toArray())) addChannel(wrapper, 'scale', addAccessor(scale, 'VEC3', count))
  }
  json.animations = [{ name, channels, samplers }]
  const out = Buffer.concat([align4(binary), ...chunks])
  json.buffers[0].byteLength = out.length
  return packLibraryGlb(json, out)
}

type ChainClip = UnifiedProject['scene']['content']['timeline']['animation']['motionClips'][number]

/** Lấy mẫu mọi khung [start, end] (30 FPS) của nhân vật qua đường trộn App 2 (clip, K2 căn chỗ đứng + khóa chân, K3 đảo chân). */
export async function sampleChainFrames(project: UnifiedProject, characterId: string, range: [number, number]): Promise<BakedFrame[]> {
  const frames: BakedFrame[] = []
  const span = range[1] - range[0] + 1
  for await (const sample of sampleProjectSkeletonRange(project, { startFrame: range[0], endFrame: range[1], sampleFps: project.scene.content.timeline.fps }, [characterId])) {
    if (sample.side !== 'right' || frames.length >= span) continue
    const skeleton = sample.skeletonSamples[0]
    if (!skeleton) throw new TypeError('Không lấy được tư thế nhân vật để nướng shot')
    frames.push({ actorWorld: skeleton.actorWorldMatrix, bones: skeleton.bones.map((bone) => ({ name: bone.name, position: bone.position, rotation: bone.rotation, scale: bone.scale, worldMatrix: bone.worldMatrix })) })
  }
  if (frames.length !== span) throw new TypeError(`Lấy mẫu ${frames.length}/${span} khung khi nướng shot`)
  return frames
}

export interface BakedShotCharacter { bytes: Buffer; manifest: Record<string, unknown>; actionUuid: string; durationSeconds: number; name: string }

/**
 * K5: nướng cả chuỗi clip trộn của một nhân vật thành một animation 30 FPS trên model của gói shot.
 * Model: nhân vật thư viện dùng model có skin của thư viện (giống shot một clip); nhân vật khác dùng GLB nguồn của nhân vật.
 */
export async function bakeShotChain(project: UnifiedProject, character: UnifiedProject['characters'][string], chain: readonly ChainClip[], range: [number, number], libraryCharacterId: string | null): Promise<BakedShotCharacter> {
  if (project.scene.content.timeline.fps !== 30) throw new TypeError('Shot nướng chỉ hỗ trợ timeline 30 FPS')
  const trajectory = chain.find((clip) => clip.motion.rootMotion?.policy === 'trajectory')
  if (trajectory) throw new TypeError(`Clip ${trajectory.motion.name ?? trajectory.id} dùng root motion kiểu đường đi (trajectory): chuỗi clip loại này chưa nướng được sang App 3 — chuyển clip về "skeletal"/"in-place" hoặc mở từng clip riêng.`)
  let model: Buffer, rig: string | undefined
  if (libraryCharacterId) {
    model = (await libraryCharacterModel(libraryCharacterId)).bytes
    rig = resolveCharacter(libraryCharacterId).baseModel?.rig
  } else {
    const asset = await resolveUnifiedAssetFile(project, character.assetId, 'source')
    if (!['model/gltf-binary'].includes(asset.mediaType)) throw new TypeError('Nướng chuỗi clip chỉ hỗ trợ nhân vật có model GLB hoặc nhân vật thư viện')
    model = Buffer.from(asset.bytes)
  }
  const frames = await sampleChainFrames(project, character.id, range)
  const names = chain.map((clip) => clip.motion.name?.trim() || clip.id)
  const name = `Gộp ${names.join(' + ')}`
  const bytes = addBakedAnimationToGlb(model, frames, 30, name)
  const actionUuid = randomUUID()
  const durationSeconds = (range[1] - range[0]) / 30
  const native = !!rig && ['verity', 'minecraft20'].includes(rig)
  const manifest = {
    version: '1.0.0', glbSha256: sha256(bytes), ...(native ? { rig } : {}),
    ...(libraryCharacterId ? { glb: { bytes: bytes.length, mode: 'library-character-native' } } : {}),
    actions: [{ uuid: actionUuid, glbAnimationIndex: 0, name, fps: 30, durationSeconds }],
  }
  return { bytes, manifest, actionUuid, durationSeconds, name }
}
