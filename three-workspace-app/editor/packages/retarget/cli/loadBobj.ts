import { inflateSync } from 'node:zlib'
import { readFileSync } from 'node:fs'
import { resolve, relative, isAbsolute } from 'node:path'
import { buildBobjModel, parseBobjModel, type BobjModelOptions } from '../src/bobjModel.ts'
import { AnimationClip, Bone, DataTexture, RGBAFormat, UnsignedByteType, SRGBColorSpace, NearestFilter, Group, Matrix4, Quaternion, QuaternionKeyframeTrack, Vector3, VectorKeyframeTrack, type KeyframeTrack } from 'three'
import { evaluateBobjAction, parseBobjActions } from '../src/index.ts'
import { parseBobjArmature } from '../src/reverse.ts'

const BOBJ_TICKS_PER_SECOND = 20
const BAKE_FPS = 30

/** Three.js track names use '.' as the node/property separator, so `low_left_arm.end` becomes `low_left_arm_end`. */
export const bobjNodeName = (name: string) => name.replace(/\./g, '_')

/**
 * Minecraft20 BOBJ (BBS/Blockbuster V9.12) → Object3D rig with baked clips, so `.bobj` actions go through the same
 * normalize pipeline as FBX/glTF. Poses come from `evaluateBobjAction` (the V9.12 reference evaluator, ticks at 20/s)
 * sampled at 30 FPS — the library's keys sit on 30 FPS frames (1 frame = 2/3 tick).
 *
 * Several V9.12 rest matrices are mirrored (`body`, `low_body`: determinant −1, a Blender bone-roll artefact) and the
 * solver only accepts orientation-preserving matrices. Bone axes are arbitrary for retargeting, so every bone gets a
 * translation-only rest frame C and each pose W is re-expressed as W·R⁻¹·C (R = original rest). World deltas
 * (W·R⁻¹) and joint positions are unchanged; only the arbitrary — here mirrored — axis convention is dropped.
 */
export function loadBobj(actionsText: string, armatureText: string, options: { resourceDir?: string; skeletonOnly?: boolean; unitMeters?: number; bakeFps?: number } = {}): Group {
  if (/^o\s+/m.test(actionsText) && /^v\s+/m.test(actionsText)) {
    const readTexture: BobjModelOptions['readTexture'] = options.resourceDir ? (path) => {
      const base = resolve(options.resourceDir!), target = resolve(base, path), inside = relative(base, target)
      if (inside.startsWith('..') || isAbsolute(inside)) throw new Error(`BOBJ texture outside model folder: ${path}`)
      try { return readFileSync(target) } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
        throw error
      }
    } : undefined
    const { root } = buildBobjModel(parseBobjModel(actionsText, { unitMeters: options.unitMeters }), { readTexture, decodeTexture: options.skeletonOnly ? undefined : decodeBobjPng })
    if (options.skeletonOnly) {
      const meshes = root.children.filter(node => node.type === 'SkinnedMesh')
      for (const mesh of meshes) root.remove(mesh)
    }
    return root
  }
  const armature = parseBobjArmature(armatureText), actions = parseBobjActions(actionsText)
  const rest = new Map(armature.bones.map((bone) => [bone.name, new Matrix4().fromArray([...bone.restWorld])]))
  const frame = new Map(armature.bones.map((bone) => [bone.name, new Matrix4().copyPosition(rest.get(bone.name)!)]))
  const rebase = new Map(armature.bones.map((bone) => [bone.name, rest.get(bone.name)!.clone().invert().multiply(frame.get(bone.name)!)]))
  const parent = new Map(armature.bones.map((bone) => [bone.name, bone.parent]))

  const root = new Group(), nodes = new Map<string, Bone>()
  root.name = 'minecraft20'
  for (const bone of armature.bones) {
    const node = new Bone(); node.name = bobjNodeName(bone.name)
    const parentFrame = bone.parent ? frame.get(bone.parent)! : new Matrix4()
    parentFrame.clone().invert().multiply(frame.get(bone.name)!).decompose(node.position, node.quaternion, node.scale)
    ;(bone.parent ? nodes.get(bone.parent)! : root).add(node)
    nodes.set(bone.name, node)
  }

  root.animations = [...actions.values()].map((action) => {
    const duration = action.durationTicks / BOBJ_TICKS_PER_SECOND
    // 30 fps misses every odd 20 Hz tick; callers that must match BBS tick for tick pass 60 (a multiple of both).
    const fps = options.bakeFps ?? BAKE_FPS
    const times = Array.from({ length: Math.ceil(duration * fps - 1e-9) + 1 }, (_, index) => Math.min(index / fps, duration))
    const values = new Map(armature.bones.map((bone) => [bone.name, { position: [] as number[], quaternion: [] as number[], scale: [] as number[] }]))
    for (const time of times) {
      const worlds = new Map(evaluateBobjAction(armature, action, time * BOBJ_TICKS_PER_SECOND)
        .map((bone) => [bone.name, new Matrix4().fromArray([...bone.worldMatrix]).multiply(rebase.get(bone.name)!)]))
      for (const bone of armature.bones) {
        const parentName = parent.get(bone.name)
        const local = parentName ? worlds.get(parentName)!.clone().invert().multiply(worlds.get(bone.name)!) : worlds.get(bone.name)!
        const position = new Vector3(), quaternion = new Quaternion(), scale = new Vector3()
        local.decompose(position, quaternion, scale)
        const entry = values.get(bone.name)!
        entry.position.push(...position.toArray()); entry.quaternion.push(...quaternion.normalize().toArray()); entry.scale.push(...scale.toArray())
      }
    }
    const tracks: KeyframeTrack[] = armature.bones.flatMap((bone) => {
      const name = bobjNodeName(bone.name), entry = values.get(bone.name)!
      return [new VectorKeyframeTrack(`${name}.position`, times, entry.position), new QuaternionKeyframeTrack(`${name}.quaternion`, times, entry.quaternion),
        ...(entry.scale.some((value) => Math.abs(value - 1) > 1e-6) ? [new VectorKeyframeTrack(`${name}.scale`, times, entry.scale)] : [])]
    })
    return new AnimationClip(action.name, duration, tracks)
  })
  return root
}

/** Node-only PNG decoding for source preview materials. GLB export copies original bytes unchanged. */
function decodeBobjPng(bytes: Uint8Array): DataTexture {
  const buffer = Buffer.from(bytes)
  if (!buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error('BOBJ texture is not a PNG')
  let width = 0, height = 0, depth = 0, color = 0, palette: Buffer | undefined, alpha: Buffer | undefined
  const compressed: Buffer[] = []
  for (let offset = 8; offset + 12 <= buffer.length;) {
    const length = buffer.readUInt32BE(offset), type = buffer.toString('ascii', offset + 4, offset + 8)
    if (offset + length + 12 > buffer.length) throw new Error('BOBJ truncated PNG chunk')
    const data = buffer.subarray(offset + 8, offset + 8 + length)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4); depth = data[8]; color = data[9]
      if (data[10] || data[11] || data[12]) throw new Error('BOBJ PNG requires non-interlaced standard compression/filtering')
    } else if (type === 'PLTE') palette = data
    else if (type === 'tRNS') alpha = data
    else if (type === 'IDAT') compressed.push(data)
    offset += length + 12
    if (type === 'IEND') break
  }
  const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[color]
  if (!width || !height || !channels || ![1, 2, 4, 8, 16].includes(depth) || (color !== 0 && color !== 3 && depth < 8) || (color === 3 && (!palette || depth === 16))) throw new Error('BOBJ unsupported PNG color format')
  const stride = Math.ceil(width * channels * depth / 8), bpp = Math.max(1, Math.ceil(channels * depth / 8))
  if (height * width > 64 * 1024 * 1024) throw new Error('BOBJ PNG exceeds 64 megapixels')
  const raw = inflateSync(Buffer.concat(compressed), { maxOutputLength: (stride + 1) * height })
  if (raw.length !== (stride + 1) * height) throw new Error('BOBJ invalid PNG scanline length')
  const decoded = new Uint8Array(stride * height), rgba = new Uint8Array(width * height * 4)
  const paeth = (a: number, b: number, c: number) => { const p = a + b - c, x = Math.abs(p - a), y = Math.abs(p - b), z = Math.abs(p - c); return x <= y && x <= z ? a : y <= z ? b : c }
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]
    if (filter > 4) throw new Error('BOBJ invalid PNG filter')
    for (let x = 0; x < stride; x++) {
      const i = y * stride + x, a = x >= bpp ? decoded[i - bpp] : 0, b = y ? decoded[i - stride] : 0, c = y && x >= bpp ? decoded[i - stride - bpp] : 0
      decoded[i] = raw[y * (stride + 1) + x + 1] + [0, a, b, Math.floor((a + b) / 2), paeth(a, b, c)][filter]
    }
    const sample = (x: number, c: number) => {
      const bit = (x * channels + c) * depth, byte = y * stride + (bit >> 3)
      return depth >= 8 ? depth === 16 ? decoded[byte] * 256 + decoded[byte + 1] : decoded[byte] : (decoded[byte] >> (8 - depth - bit % 8)) & ((1 << depth) - 1)
    }
    const maximum = (1 << depth) - 1, to8 = (v: number) => Math.round(v * 255 / maximum)
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4, values = Array.from({ length: channels }, (_, c) => sample(x, c))
      let r: number, g: number, b: number, a = 255
      if (color === 3) {
        const idx = values[0]; if (idx * 3 + 2 >= palette!.length) throw new Error('BOBJ PNG palette index out of bounds')
        r = palette![idx * 3]; g = palette![idx * 3 + 1]; b = palette![idx * 3 + 2]; a = alpha?.[idx] ?? 255
      } else if (color === 0 || color === 4) {
        r = g = b = to8(values[0]); if (color === 4) a = to8(values[1]); else if (alpha && values[0] === alpha.readUInt16BE(0)) a = 0
      } else {
        [r, g, b] = values.slice(0, 3).map(to8); if (color === 6) a = to8(values[3]); else if (alpha && values.slice(0, 3).every((v, c) => v === alpha!.readUInt16BE(c * 2))) a = 0
      }
      rgba.set([r, g, b, a], i)
    }
  }
  const texture = new DataTexture(rgba, width, height, RGBAFormat, UnsignedByteType)
  texture.colorSpace = SRGBColorSpace; texture.magFilter = NearestFilter; texture.minFilter = NearestFilter; texture.flipY = false; texture.needsUpdate = true
  return texture
}
