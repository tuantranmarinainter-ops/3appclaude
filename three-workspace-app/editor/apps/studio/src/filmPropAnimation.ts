import { deflateSync, inflateSync, crc32 } from 'node:zlib'
import { Matrix4, Quaternion, Vector3 } from 'three'
import type { UnifiedProject } from '@bbs/animation-workspace-shared'
import { bakeFilmPoseTracks } from './filmPoseBake'
import { filmSceneWorldMatrices } from './filmSceneWorld'

/**
 * Animated props in BBS Films (Tập 15 Shot 03 rainbow rod):
 *  - motion: one actor per prop with a transform per tick (position only, BBS replays have no roll) and the full rotation
 *    on the converted BOBJ "root" bone pose track;
 *  - visibility: props hidden in App 2 by a near-zero scale get a "visible" boolean track instead of a scale;
 *  - texture: a glTF material with extras.w01TextureAnimation (Minecraft .mcmeta-style vertical strip) is converted from a
 *    derived GLB whose UVs cover one whole frame; each frame is packaged as frames/<n>.png and a ModelForm "texture"
 *    link track steps through them (BBS reads the frame number from the file name).
 */
export interface PropTextureAnimation {
  version: 1
  layout: 'vertical-strip'
  frameCount: number
  frameOrder?: number[]
  frametimeTicks?: number
  ticksPerSecond?: number
  uvFrame?: number
}

export function readPropTextureAnimation(value: unknown): PropTextureAnimation | null {
  if (!value || typeof value !== 'object') return null
  const a = value as Partial<PropTextureAnimation>
  if (a.version !== 1 || a.layout !== 'vertical-strip' || !Number.isInteger(a.frameCount) || a.frameCount! < 2 || a.frameCount! > 1024) return null
  if (a.frameOrder !== undefined && (!Array.isArray(a.frameOrder) || !a.frameOrder.length || a.frameOrder.some((f) => !Number.isInteger(f) || f < 0 || f >= a.frameCount!))) return null
  if (a.uvFrame !== undefined && (!Number.isInteger(a.uvFrame) || a.uvFrame < 0 || a.uvFrame >= a.frameCount!)) return null
  return a as PropTextureAnimation
}

/** Same rule as the App 2 viewport (builder propTextureAnimation.ts): one entry every frametime ticks at 20 ticks/s. */
export function propTextureFrameAt(animation: PropTextureAnimation, timelineFrame: number, fps: number): number {
  const order = animation.frameOrder?.length ? animation.frameOrder : [...Array(animation.frameCount).keys()]
  const ticksPerSecond = animation.ticksPerSecond && animation.ticksPerSecond > 0 ? animation.ticksPerSecond : 20
  const frametime = animation.frametimeTicks && animation.frametimeTicks > 0 ? animation.frametimeTicks : 1
  const step = Math.floor(Math.max(0, timelineFrame) / (fps > 0 ? fps : 30) * ticksPerSecond / frametime + 1e-6)
  return order[step % order.length]!
}

// ---------- minimal PNG (8-bit RGB/RGBA, non-interlaced) ----------
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
interface RawImage { width: number; height: number; channels: 3 | 4; pixels: Buffer }

export function decodePng(bytes: Buffer): RawImage {
  if (bytes.length < 33 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) throw new TypeError('Animated prop texture must be a PNG')
  let offset = 8, width = 0, height = 0, channels: 3 | 4 = 4
  const idat: Buffer[] = []
  while (offset + 8 <= bytes.length) {
    const length = bytes.readUInt32BE(offset), type = bytes.toString('latin1', offset + 4, offset + 8)
    const data = bytes.subarray(offset + 8, offset + 8 + length)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4)
      const depth = data[8], colorType = data[9], interlace = data[12]
      if (depth !== 8 || (colorType !== 6 && colorType !== 2) || interlace !== 0) throw new TypeError('Animated prop texture must be an 8-bit RGB/RGBA non-interlaced PNG')
      channels = colorType === 6 ? 4 : 3
    } else if (type === 'IDAT') idat.push(data)
    else if (type === 'IEND') break
    offset += 12 + length
  }
  if (!width || !height || !idat.length) throw new TypeError('PNG has no image data')
  const raw = inflateSync(Buffer.concat(idat)), stride = width * channels
  if (raw.length < (stride + 1) * height) throw new TypeError('PNG image data is truncated')
  const pixels = Buffer.alloc(stride * height)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!, row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    const out = pixels.subarray(y * stride, (y + 1) * stride), prev = y ? pixels.subarray((y - 1) * stride, y * stride) : null
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? out[x - channels]! : 0, b = prev ? prev[x]! : 0, c = prev && x >= channels ? prev[x - channels]! : 0
      let v = row[x]!
      if (filter === 1) v += a
      else if (filter === 2) v += b
      else if (filter === 3) v += (a + b) >> 1
      else if (filter === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c }
      else if (filter !== 0) throw new TypeError(`Unsupported PNG filter ${filter}`)
      out[x] = v & 255
    }
  }
  return { width, height, channels, pixels }
}

export function encodePng(image: RawImage): Buffer {
  const stride = image.width * image.channels, raw = Buffer.alloc((stride + 1) * image.height)
  for (let y = 0; y < image.height; y++) image.pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  const chunk = (type: string, data: Buffer) => {
    const head = Buffer.alloc(8); head.writeUInt32BE(data.length, 0); head.write(type, 4, 'latin1')
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0)
    return Buffer.concat([head, data, crc])
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(image.width, 0); ihdr.writeUInt32BE(image.height, 4)
  ihdr[8] = 8; ihdr[9] = image.channels === 4 ? 6 : 2
  return Buffer.concat([PNG_SIGNATURE, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

/** Square frames of a vertical strip (frame 0 on top). */
export function splitVerticalStrip(png: Buffer, frameCount: number): Buffer[] {
  const image = decodePng(png)
  const size = image.height / frameCount
  if (!Number.isInteger(size) || size !== image.width) throw new TypeError(`Texture strip ${image.width}x${image.height} is not ${frameCount} square frames`)
  const stride = image.width * image.channels
  return [...Array(frameCount).keys()].map((frame) => encodePng({ ...image, height: size,
    pixels: Buffer.from(image.pixels.subarray(frame * size * stride, (frame + 1) * size * stride)) }))
}

// ---------- GLB ----------
interface Gltf { [key: string]: any }
function readGlb(bytes: Buffer): { json: Gltf; bin: Buffer } {
  if (bytes.length < 20 || bytes.readUInt32LE(0) !== 0x46546c67) throw new TypeError('Prop model is not a GLB')
  const jsonLength = bytes.readUInt32LE(12)
  const json = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8'))
  const binStart = 20 + jsonLength
  const bin = binStart + 8 <= bytes.length ? bytes.subarray(binStart + 8, binStart + 8 + bytes.readUInt32LE(binStart)) : Buffer.alloc(0)
  return { json, bin }
}
function writeGlb(json: Gltf, bin: Buffer): Buffer {
  const pad = (buffer: Buffer, fill: number) => Buffer.concat([buffer, Buffer.alloc((4 - buffer.length % 4) % 4, fill)])
  const binPadded = pad(bin, 0)
  json.buffers = [{ byteLength: binPadded.length }]
  const jsonBytes = pad(Buffer.from(JSON.stringify(json)), 0x20)
  const header = Buffer.alloc(12); header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4)
  header.writeUInt32LE(12 + 8 + jsonBytes.length + 8 + binPadded.length, 8)
  const chunkHead = (length: number, type: number) => { const b = Buffer.alloc(8); b.writeUInt32LE(length, 0); b.writeUInt32LE(type, 4); return b }
  return Buffer.concat([header, chunkHead(jsonBytes.length, 0x4e4f534a), jsonBytes, chunkHead(binPadded.length, 0x004e4942), binPadded])
}

export interface AnimatedPropModel { glb: Buffer; frames: Buffer[]; animation: PropTextureAnimation }

/**
 * Returns null for ordinary props. For an animated strip: a GLB whose texture is one whole frame (UV v scaled by the
 * frame count around the authored frame) plus every frame as its own PNG.
 */
export function deriveAnimatedPropModel(bytes: Buffer): AnimatedPropModel | null {
  const { json, bin } = readGlb(bytes)
  const materials: Gltf[] = json.materials ?? []
  const index = materials.findIndex((material) => readPropTextureAnimation(material?.extras?.w01TextureAnimation))
  if (index < 0) return null
  if (materials.filter((material) => material?.extras?.w01TextureAnimation).length !== 1) throw new TypeError('Only one animated material per prop is supported')
  const animation = readPropTextureAnimation(materials[index].extras.w01TextureAnimation)!
  const textureIndex = materials[index].pbrMetallicRoughness?.baseColorTexture?.index
  const imageIndex = json.textures?.[textureIndex]?.source
  const image = json.images?.[imageIndex]
  if (!image || typeof image.bufferView !== 'number') throw new TypeError('Animated prop texture must be embedded in the GLB')
  const view = json.bufferViews[image.bufferView]
  const frames = splitVerticalStrip(Buffer.from(bin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength)), animation.frameCount)
  const out = Buffer.from(bin)
  const uvFrame = animation.uvFrame ?? 0
  const touched = new Set<number>()
  for (const mesh of json.meshes ?? []) for (const primitive of mesh.primitives ?? []) {
    const accessorIndex = primitive.attributes?.TEXCOORD_0
    if (primitive.material !== index || typeof accessorIndex !== 'number' || touched.has(accessorIndex)) continue
    touched.add(accessorIndex)
    const accessor = json.accessors[accessorIndex], uvView = json.bufferViews[accessor.bufferView]
    if (accessor.componentType !== 5126 || accessor.type !== 'VEC2' || accessor.sparse) throw new TypeError('Animated prop UVs must be float VEC2')
    const stride = uvView.byteStride ?? 8, base = (uvView.byteOffset ?? 0) + (accessor.byteOffset ?? 0)
    for (let i = 0; i < accessor.count; i++) {
      const at = base + i * stride + 4
      out.writeFloatLE(out.readFloatLE(at) * animation.frameCount - uvFrame, at)
    }
    if (accessor.min) accessor.min[1] = accessor.min[1] * animation.frameCount - uvFrame
    if (accessor.max) accessor.max[1] = accessor.max[1] * animation.frameCount - uvFrame
  }
  if (!touched.size) throw new TypeError('Animated prop material has no UV primitives')
  const frame = frames[uvFrame]!
  const imageOffset = Math.ceil(out.length / 4) * 4
  json.bufferViews.push({ buffer: 0, byteOffset: imageOffset, byteLength: frame.length })
  image.bufferView = json.bufferViews.length - 1
  image.mimeType = 'image/png'
  delete materials[index].extras.w01TextureAnimation
  return { glb: writeGlb(json, Buffer.concat([out, Buffer.alloc(imageOffset - out.length), frame])), frames, animation }
}

// ---------- Film actor ----------
export interface PropFilmProfile {
  modelId: string
  metersPerUnit: number
  bones: Array<{ name: string; sourceName?: string; parent: string | null; bobjRestMatrixRowMajor: number[] }>
}
export interface PropPropertyTrack { property: 'visible' | 'texture'; type: 'boolean' | 'link'; keyframes: Array<{ tick: number; value: boolean | string }> }

/** True when the prop node has its own keyed transform (F-curves or user keys). */
export function propIsAnimated(project: UnifiedProject, nodeId: string): boolean {
  const fcurves = (project.extensions.topview as { fcurves?: { fcurves?: Array<{ t?: unknown[]; p?: string }>; userKeys?: Record<string, Record<string, unknown[]>> } } | undefined)?.fcurves
  return !!fcurves?.fcurves?.some((curve) => curve.t?.[1] === nodeId && typeof curve.p === 'string' && curve.p.startsWith('transform.')) ||
    Object.values(fcurves?.userKeys?.[nodeId] ?? {}).some((keys) => Array.isArray(keys) && keys.length > 0)
}

const HIDDEN_SCALE = 0.01

/**
 * Per-tick actor samples for a keyed prop. The actor carries position (yaw 0, so no roll is needed); the BOBJ root bone
 * carries the whole rotation. A near-zero scale means "hidden" in App 2 and becomes visible=false.
 */
export function sampleAnimatedProp(project: UnifiedProject, nodeId: string, profile: PropFilmProfile, ticks: ReadonlyArray<{ tick: number; sourceFrame: number }>,
  options: { unit?: number; basis?: number[]; animation?: PropTextureAnimation | null; fps: number }) {
  if ((options.unit ?? 1) !== 1 || (options.basis && options.basis.some((v, i) => v !== [1, 0, 0, 0, 1, 0, 0, 0, 1][i]))) {
    throw new TypeError('Animated props need a 1 m model unit and the identity scene basis')
  }
  const root = profile.bones.find((bone) => bone.parent === null)
  if (!root || profile.bones.length !== 1) throw new TypeError('Animated props must convert to a single root bone')
  const rest = new Matrix4().set(...(root.bobjRestMatrixRowMajor as [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number]))
  const restPosition = new Vector3(), restRotation = new Quaternion(), restScale = new Vector3()
  // The converter writes BOBJ turned 180 degrees about Y from glTF (Blender import Y-up -> Z-up, OBJ export back:
  // BOBJ (x, y, z) = glTF (-x, y, -z); the root rest [[-1,0,0],[0,0,1],[0,1,0]] is Blender's identity bone in that frame).
  // The pose bake needs the same bone at rest in glTF space, or the prop ends up turned 180 degrees in game
  // (Shot 03: the rod pointed back over Hero's shoulder instead of forward).
  const sourceRest = new Matrix4().makeRotationY(Math.PI).multiply(rest)
  sourceRest.decompose(restPosition, restRotation, restScale)
  const raw = ticks.map(({ tick, sourceFrame }) => {
    const world = filmSceneWorldMatrices(project, sourceFrame)(nodeId)
    const position = new Vector3(), rotation = new Quaternion(), scale = new Vector3()
    world.decompose(position, rotation, scale)
    return { tick, sourceFrame, position, rotation, visible: Math.min(scale.x, scale.y, scale.z) > HIDDEN_SCALE }
  })
  // A hidden prop keeps the pose of the nearest visible sample, so the hidden span never bakes a degenerate matrix.
  const firstVisible = raw.find((item) => item.visible) ?? raw[0]!
  let last = firstVisible
  const posed = raw.map((item) => { if (item.visible) last = item; return item.visible ? item : { ...item, position: last.position, rotation: last.rotation } })
  const actorWorld = (item: (typeof posed)[number]) => new Matrix4().makeTranslation(item.position.x, item.position.y, item.position.z)
  const samples = posed.map((item) => ({ tick: item.tick, skeleton: {
    nodeId, metersPerUnit: profile.metersPerUnit, placementMatrix: actorWorld(item).toArray(), trajectoryMatrix: new Matrix4().toArray(),
    actorWorldMatrix: actorWorld(item).toArray(),
    bones: [{ name: root.sourceName ?? root.name, position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1],
      worldMatrix: new Matrix4().compose(item.position, item.rotation, new Vector3(1, 1, 1)).multiply(sourceRest).toArray() }],
  } }))
  const poseTracks = bakeFilmPoseTracks([{ id: 'root', name: root.sourceName ?? root.name, parentId: null,
    rest: { position: restPosition.toArray(), rotation: restRotation.toArray(), scale: [1, 1, 1] } }], profile.metersPerUnit, profile as never, samples as never)
  const positions = posed.map((item) => ({ tick: item.tick, matrix: actorWorld(item).toArray() }))
  const propertyTracks: PropPropertyTrack[] = []
  if (raw.some((item) => !item.visible)) {
    const keys: PropPropertyTrack['keyframes'] = []
    raw.forEach((item, i) => { if (i === 0 || item.visible !== raw[i - 1]!.visible) keys.push({ tick: item.tick, value: item.visible }) })
    propertyTracks.push({ property: 'visible', type: 'boolean', keyframes: keys })
  }
  if (options.animation) {
    const keys: PropPropertyTrack['keyframes'] = []
    let previous = -1
    for (const item of raw) {
      const frame = propTextureFrameAt(options.animation, item.sourceFrame, options.fps)
      if (frame !== previous) keys.push({ tick: item.tick, value: `assets:models/${profile.modelId}/frames/${frame}.png` })
      previous = frame
    }
    propertyTracks.push({ property: 'texture', type: 'link', keyframes: keys })
  }
  return { positions, poseTracks, propertyTracks }
}
