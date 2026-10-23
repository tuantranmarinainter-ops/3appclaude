/**
 * Minecraft-style block characters on the native Minecraft20 skeleton (BBS/Blockbuster V9.12, 20 bones), for App 2 scenes
 * and BBS FS. Geometry is Steve's box layout (1 px = 1/16 block: head 8³, torso 8×12×4, limbs 4×12×4 split upper/lower),
 * each box rigidly skinned to its bone and flat-coloured per role; no Mojang skin texture is used. Actions stay on the same
 * 20 bones, so App 2 binds them by name without retargeting.
 *
 *   node --import tsx ../retarget/cli/minecraftBlockCharacters.ts --out <dir>      (from packages/builder)
 * writes `<role>.mc20.glb` per role and `minecraft20-actions.glb` (the 85 V9.12 Actions, GPL-3.0 like their source).
 * `--skin ga=ga.png,den=den.png [--staff hero]` instead writes characters wearing 64x64 Minecraft player skins.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { Quaternion, Vector3, type AnimationClip, type Bone, type Object3D } from 'three'
import { encodeGlb } from './glb.ts'
import { loadAsset } from './loadAsset.ts'

const PX = 1 / 16
type Rgb = [number, number, number]
/** Box in rest world space (px units, Minecraft20 rest: feet at y=0, model faces +Z), owned by one bone. */
export interface Box { bone: string; min: [number, number, number]; max: [number, number, number]; color: Rgb }
export interface Role { name: string; boxes: Box[] }

const hex = (value: string): Rgb => [1, 3, 5].map((i) => (parseInt(value.slice(i, i + 2), 16) / 255) ** 2.2) as Rgb
const box = (bone: string, min: [number, number, number], max: [number, number, number], color: string): Box => ({ bone, min, max, color: hex(color) })

/** Steve's layout; `limb` widens/narrows arms and legs, `torso` the body depth/width, colours per part. */
function humanoid(c: { head: string; hair?: string; eyes: string; eyeWhite?: string; shirt: string; sleeve: string; hand: string; pants: string; shoes: string }, limb = 4, torso = 8): Box[] {
  const half = torso / 2, l = limb, armX = half + l
  const boxes: Box[] = [
    box('head', [-4, 24, -4], [4, 32, 4], c.head),
    box('low_body', [-half, 18, -2], [half, 24, 2], c.shirt),
    box('body', [-half, 12, -2], [half, 18, 2], c.pants),
    box('left_arm', [half, 18, -l / 2], [armX, 24, l / 2], c.sleeve), box('low_left_arm', [half, 12, -l / 2], [armX, 18, l / 2], c.hand),
    box('right_arm', [-armX, 18, -l / 2], [-half, 24, l / 2], c.sleeve), box('low_right_arm', [-armX, 12, -l / 2], [-half, 18, l / 2], c.hand),
    box('left_leg', [0, 6, -l / 2], [l, 12, l / 2], c.pants), box('low_left_leg', [0, 0, -l / 2], [l, 6, l / 2], c.shoes),
    box('right_leg', [-l, 6, -l / 2], [0, 12, l / 2], c.pants), box('low_leg_right', [-l, 0, -l / 2], [0, 6, l / 2], c.shoes),
    // Eyes sit 0.05 px proud of the face so they never z-fight.
    box('head', [-3, 27, 4], [-1, 28, 4.05], c.eyes), box('head', [1, 27, 4], [3, 28, 4.05], c.eyes),
  ]
  if (c.eyeWhite) boxes.push(box('head', [-3, 27, 4.05], [-2, 28, 4.1], c.eyeWhite), box('head', [2, 27, 4.05], [3, 28, 4.1], c.eyeWhite))
  if (c.hair) boxes.push(box('head', [-4.05, 30, -4.05], [4.05, 32.05, 4.05], c.hair), box('head', [-4.05, 26, -4.05], [4.05, 30, -3.5], c.hair))
  return boxes
}

/** Rainbow staff of episode 15: seven 1x1 px segments held in the right hand, pointing forward. */
function rainbowStaff(): Box[] {
  return ['#FF3B30', '#FF9500', '#FFCC00', '#34C759', '#00C7FF', '#3A5BFF', '#AF52DE'].map((color, i) => box('low_right_arm', [-6.5, 12, -3 + i * 3], [-5.5, 13, i * 3], color))
}

const den = humanoid({ head: '#202024', eyes: '#3FA9FF', shirt: '#141418', sleeve: '#141418', hand: '#26262A', pants: '#141418', shoes: '#0E0E10' })
const ga = humanoid({ head: '#F2D65C', eyes: '#151515', shirt: '#EFE6CC', sleeve: '#F2D65C', hand: '#F2D65C', pants: '#6B3E26', shoes: '#4A2A18' })
const mystery = humanoid({ head: '#141414', eyes: '#141414', shirt: '#1A1A1A', sleeve: '#1A1A1A', hand: '#1A1A1A', pants: '#1A1A1A', shoes: '#101010' })

/** Roles from the Tập 15 storyboard (docs/storyboards); `steve` and `enderman` are plain references. */
export const ROLES: Role[] = [
  // Herobrine: grey skin, white glowing eyes with pink glow under them, black hair, bare grey torso, dark grey trousers.
  { name: 'herobrine', boxes: [...humanoid({ head: '#C9C9C9', hair: '#1F1F1F', eyes: '#FFFFFF', shirt: '#BEBEBE', sleeve: '#BEBEBE', hand: '#C9C9C9', pants: '#4A4A4A', shoes: '#333333' }),
    box('head', [-3, 26, 4], [-1, 27, 4.05], '#E86BB8'), box('head', [1, 26, 4], [3, 27, 4.05], '#E86BB8')] },
  // Herobrine with the rainbow staff of Tập 15: seven 1x1 px segments held in the right hand, pointing forward.
  { name: 'herobrine_staff', boxes: [...humanoid({ head: '#C9C9C9', hair: '#1F1F1F', eyes: '#FFFFFF', shirt: '#BEBEBE', sleeve: '#BEBEBE', hand: '#C9C9C9', pants: '#4A4A4A', shoes: '#333333' }),
    box('head', [-3, 26, 4], [-1, 27, 4.05], '#E86BB8'), box('head', [1, 26, 4], [3, 27, 4.05], '#E86BB8'), ...rainbowStaff()] },
  { name: 'steve', boxes: humanoid({ head: '#B98A68', hair: '#3B2A1E', eyes: '#4B3A8A', eyeWhite: '#F4F4F4', shirt: '#2C9AA0', sleeve: '#2C9AA0', hand: '#B98A68', pants: '#3542A0', shoes: '#4A4A4A' }) },
  { name: 'enderman', boxes: humanoid({ head: '#151515', eyes: '#C04BFF', shirt: '#151515', sleeve: '#151515', hand: '#151515', pants: '#151515', shoes: '#151515' }, 2, 8) },
  // Đen: charcoal body, blue eyes, black coat with a red scarf, red front trim and gold studs.
  { name: 'den', boxes: [...den,
    box('low_body', [-4.05, 22, -2.05], [4.05, 24, 2.05], '#B3262E'), box('low_body', [-1, 18, 2], [1, 22, 2.05], '#B3262E'), box('body', [-1, 12, 2], [1, 18, 2.05], '#B3262E'),
    box('low_body', [-3, 20, 2], [-2, 21, 2.1], '#D4A017'), box('low_body', [2, 20, 2], [3, 21, 2.1], '#D4A017'),
    box('left_arm', [4, 22, -2.05], [8.05, 24, 2.05], '#B3262E'), box('right_arm', [-8.05, 22, -2.05], [-4, 24, 2.05], '#B3262E')] },
  // Gà: chicken-headed humanoid, orange beak, red head band, bandaged cream torso, brown trousers.
  { name: 'ga', boxes: [...ga,
    box('head', [-1.5, 25.5, 4], [1.5, 27, 5.5], '#F28C28'), box('head', [-4.1, 29, -4.1], [4.1, 30.5, 4.1], '#C8302A'), box('head', [-1, 28, -5], [1, 30, -4.1], '#C8302A'),
    box('low_body', [-4.05, 21, -2.05], [4.05, 22, 2.05], '#FFFFFF'), box('body', [-4.05, 15, -2.05], [4.05, 16, 2.05], '#FFFFFF'),
    box('left_arm', [3.95, 20, -2.05], [8.05, 21, 2.05], '#FFFFFF'), box('low_right_arm', [-8.05, 14, -2.05], [-3.95, 15, 2.05], '#FFFFFF')] },
  // Người bí ẩn: hooded black cloak with red trim; no face.
  { name: 'mystery', boxes: [...mystery,
    box('head', [-4.4, 23.6, -4.4], [4.4, 32.4, 4.4], '#1A1A1A'), box('low_body', [-4.6, 18, -2.6], [4.6, 24, 2.6], '#1A1A1A'), box('body', [-4.6, 9, -2.6], [4.6, 18, 2.6], '#1A1A1A'),
    box('low_body', [-4.65, 18, 2.6], [-3.6, 24, 2.65], '#8E1C1C'), box('low_body', [3.6, 18, 2.6], [4.65, 24, 2.65], '#8E1C1C'),
    box('body', [-4.65, 9, 2.6], [-3.6, 18, 2.65], '#8E1C1C'), box('body', [3.6, 9, 2.6], [4.65, 18, 2.65], '#8E1C1C')] },
]

const ARMATURE = resolve(import.meta.dirname, '../../../apps/studio/public/retarget/v9.12')

/** The V9.12 rig with its 85 Actions, or another Minecraft20 Action library (e.g. App 1 `--bobj` output) on the same rig. */
export async function loadMinecraft20(actionsFile = join(ARMATURE, 'minecraft-actions.bobj')): Promise<Object3D & { animations: AnimationClip[] }> {
  const root = await loadAsset(readFileSync(actionsFile), 'bobj', { bobjArmature: readFileSync(join(ARMATURE, 'minecraft20-armature.bobj')) })
  root.updateMatrixWorld(true)
  return root as Object3D & { animations: AnimationClip[] }
}

export class Writer {
  json: Record<string, any> = { asset: { version: '2.0', generator: 'w01 minecraftBlockCharacters' }, scene: 0, scenes: [{ nodes: [] }], nodes: [], buffers: [{ byteLength: 0 }], bufferViews: [], accessors: [] }
  chunks: Buffer[] = []; length = 0
  view(data: ArrayBufferView, target?: number) {
    const bytes = Buffer.from(data.buffer, data.byteOffset, data.byteLength), pad = (4 - (this.length % 4)) % 4
    if (pad) { this.chunks.push(Buffer.alloc(pad)); this.length += pad }
    this.json.bufferViews.push({ buffer: 0, byteOffset: this.length, byteLength: bytes.length, ...(target ? { target } : {}) })
    this.chunks.push(bytes); this.length += bytes.length
    return this.json.bufferViews.length - 1
  }
  accessor(data: Float32Array | Uint16Array, type: string, componentType: number, target?: number, bounds = false) {
    const size = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }[type]!, count = data.length / size, extra: Record<string, unknown> = {}
    if (bounds) {
      const min = Array(size).fill(Infinity), max = Array(size).fill(-Infinity)
      for (let i = 0; i < data.length; i++) { min[i % size] = Math.min(min[i % size], data[i]!); max[i % size] = Math.max(max[i % size], data[i]!) }
      Object.assign(extra, { min, max })
    }
    this.json.accessors.push({ bufferView: this.view(data, target), componentType, count, type, ...extra })
    return this.json.accessors.length - 1
  }
  glb() { const bin = Buffer.concat(this.chunks); this.json.buffers[0].byteLength = bin.length; return encodeGlb(this.json, bin) }
}

/**
 * Node per bone (rest local TRS), parented as in the source under one root node that carries the top bones' parent world
 * transform (identity for Minecraft20; a GLB armature's rotation/scale for Topview characters).
 */
export function writeSkeleton(w: Writer, root: Object3D, rootName = 'minecraft20', size = 1) {
  let bones: Bone[] = []
  root.traverse((object) => { if ((object as Bone).isBone) bones.push(object as Bone) })
  // Minecraft20 also has three global item bones (`misc_gbone_*`) beside `anchor`. They carry no mesh and the Film pose
  // bake needs one connected skeleton root, so App 2 assets keep only the `anchor` tree (17 bones); App 1 `.bobj` is unaffected.
  const anchor = bones.find((bone) => bone.name === 'anchor')
  if (anchor) bones = bones.filter((bone) => { for (let o: Object3D | null = bone; o; o = o.parent) if (o === anchor) return true; return false })
  const index = new Map(bones.map((bone, i) => [bone, i + 1]))
  const tops = bones.filter((bone) => !index.has(bone.parent as Bone)), holder = tops[0]?.parent
  const [p, q, sc] = [new Vector3(), new Quaternion(), new Vector3()]
  if (holder && holder !== root) holder.matrixWorld.decompose(p, q, sc)
  // `size` is baked into the root node: placed Characters keep unit scale, which Film replay requires.
  w.json.nodes.push({ name: rootName, children: tops.map((bone) => index.get(bone)!), ...(holder && holder !== root ? { translation: p.toArray(), rotation: q.toArray(), scale: sc.toArray().map((v) => v * size) } : size !== 1 ? { scale: [size, size, size] } : {}) })
  for (const bone of bones) {
    const children = bone.children.filter((child) => index.has(child as Bone)).map((child) => index.get(child as Bone)!)
    w.json.nodes.push({ name: bone.name, translation: bone.position.toArray(), rotation: bone.quaternion.toArray(), ...(children.length ? { children } : {}) })
  }
  w.json.scenes[0].nodes.push(0)
  return { bones, index }
}

/** One primitive per colour; `joint` set → rigid skin weights (JOINTS_0/WEIGHTS_0). Box corners are multiplied by `unit`. */
function boxPrimitives(w: Writer, items: Array<{ min: number[]; max: number[]; color: Rgb; joint?: number }>, unit: number) {
  const byColor = new Map<string, typeof items>()
  for (const item of items) { const key = item.color.join(','); byColor.set(key, [...(byColor.get(key) ?? []), item]) }
  w.json.materials ??= []; const primitives: any[] = []
  for (const [, boxes] of byColor) {
    const skinned = boxes[0]!.joint !== undefined
    const position: number[] = [], normal: number[] = [], joints: number[] = [], weights: number[] = [], indices: number[] = []
    for (const item of boxes) {
      const [x0, y0, z0] = item.min.map((v) => v * unit), [x1, y1, z1] = item.max.map((v) => v * unit)
      const faces: Array<[number[], number[][]]> = [
        [[1, 0, 0], [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]]], [[-1, 0, 0], [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]]],
        [[0, 1, 0], [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]]], [[0, -1, 0], [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]]],
        [[0, 0, 1], [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]]], [[0, 0, -1], [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]]],
      ]
      for (const [n, corners] of faces) {
        const base = position.length / 3
        for (const corner of corners) { position.push(...corner); normal.push(...n); if (skinned) { joints.push(item.joint!, 0, 0, 0); weights.push(1, 0, 0, 0) } }
        indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
      }
    }
    if (position.length / 3 > 65535) throw new RangeError('Too many box vertices for one colour; split the set')
    w.json.materials.push({ pbrMetallicRoughness: { baseColorFactor: [...boxes[0]!.color, 1], metallicFactor: 0, roughnessFactor: 0.9 } })
    const attributes: Record<string, number> = { POSITION: w.accessor(new Float32Array(position), 'VEC3', 5126, 34962, true), NORMAL: w.accessor(new Float32Array(normal), 'VEC3', 5126, 34962) }
    if (skinned) Object.assign(attributes, { JOINTS_0: w.accessor(new Uint16Array(joints), 'VEC4', 5123, 34962), WEIGHTS_0: w.accessor(new Float32Array(weights), 'VEC4', 5126, 34962) })
    primitives.push({ attributes, indices: w.accessor(new Uint16Array(indices), 'SCALAR', 5123, 34963), material: w.json.materials.length - 1 })
  }
  return primitives
}

/** Static block set (props/backdrops): boxes in metres, flat colours, one unskinned mesh. */
export interface SetBox { min: [number, number, number]; max: [number, number, number]; color: string }
export function setGlb(name: string, boxes: readonly SetBox[]): Uint8Array {
  const w = new Writer()
  w.json.meshes = [{ name, primitives: boxPrimitives(w, boxes.map((item) => ({ min: item.min, max: item.max, color: hex(item.color) })), 1) }]
  w.json.nodes.push({ name, mesh: 0 }); w.json.scenes[0].nodes.push(0)
  return w.glb()
}

export function characterGlb(root: Object3D, role: Role, size = 1): Uint8Array {
  const w = new Writer(), { bones, index } = writeSkeleton(w, root, 'minecraft20', size)
  const jointOf = new Map(bones.map((bone, i) => [bone.name, i]))
  const ibm = new Float32Array(bones.length * 16)
  bones.forEach((bone, i) => ibm.set(bone.matrixWorld.clone().invert().toArray(), i * 16))
  for (const item of role.boxes) if (!jointOf.has(item.bone)) throw new TypeError(`Unknown Minecraft20 bone ${item.bone}`)
  const primitives = boxPrimitives(w, role.boxes.map((item) => ({ ...item, joint: jointOf.get(item.bone)! })), PX)
  w.json.meshes = [{ name: role.name, primitives }]
  w.json.skins = [{ joints: bones.map((bone) => index.get(bone)!), inverseBindMatrices: w.accessor(ibm, 'MAT4', 5126) }]
  w.json.nodes.push({ name: `${role.name}_mesh`, mesh: 0, skin: 0 }); w.json.scenes[0].nodes.push(w.json.nodes.length - 1)
  return w.glb()
}

/**
 * Minecraft skin layout (64x64 player skin, classic 4 px arms): part texture origin (u, v), size w x h x d px and the top of
 * the whole limb in px, so each rig segment (upper/lower arm, upper/lower leg, torso halves) takes its own rows of the sides.
 */
const SKIN_PARTS = {
  head: { u: 0, v: 0, w: 8, h: 8, d: 8, top: 32 }, body: { u: 16, v: 16, w: 8, h: 12, d: 4, top: 24 },
  rarm: { u: 40, v: 16, w: 4, h: 12, d: 4, top: 24 }, larm: { u: 32, v: 48, w: 4, h: 12, d: 4, top: 24 },
  rleg: { u: 0, v: 16, w: 4, h: 12, d: 4, top: 12 }, lleg: { u: 16, v: 48, w: 4, h: 12, d: 4, top: 12 },
} as const
const SKIN_BOXES: ReadonlyArray<readonly [string, keyof typeof SKIN_PARTS, [number, number, number], [number, number, number]]> = [
  ['head', 'head', [-4, 24, -4], [4, 32, 4]], ['low_body', 'body', [-4, 18, -2], [4, 24, 2]], ['body', 'body', [-4, 12, -2], [4, 18, 2]],
  ['left_arm', 'larm', [4, 18, -2], [8, 24, 2]], ['low_left_arm', 'larm', [4, 12, -2], [8, 18, 2]],
  ['right_arm', 'rarm', [-8, 18, -2], [-4, 24, 2]], ['low_right_arm', 'rarm', [-8, 12, -2], [-4, 18, 2]],
  ['left_leg', 'lleg', [0, 6, -2], [4, 12, 2]], ['low_left_leg', 'lleg', [0, 0, -2], [4, 6, 2]],
  ['right_leg', 'rleg', [-4, 6, -2], [0, 12, 2]], ['low_leg_right', 'rleg', [-4, 0, -2], [0, 6, 2]],
]

/**
 * Block character wearing a 64x64 Minecraft player skin (base layer, nearest filtering) on the same Minecraft20 skeleton as
 * `characterGlb`, so Actions bound to these node names keep working. `extras` are flat-coloured boxes (e.g. the staff).
 */
export function skinnedCharacterGlb(root: Object3D, name: string, skinPng: Uint8Array, extras: readonly Box[] = [], size = 1): Uint8Array {
  const w = new Writer(), { bones, index } = writeSkeleton(w, root, 'minecraft20', size)
  const jointOf = new Map(bones.map((bone, i) => [bone.name, i]))
  const ibm = new Float32Array(bones.length * 16)
  bones.forEach((bone, i) => ibm.set(bone.matrixWorld.clone().invert().toArray(), i * 16))
  const position: number[] = [], normal: number[] = [], uv: number[] = [], joints: number[] = [], weights: number[] = [], indices: number[] = []
  for (const [bone, part, [x0, y0, z0], [x1, y1, z1]] of SKIN_BOXES) {
    const joint = jointOf.get(bone)
    if (joint === undefined) throw new TypeError(`Unknown Minecraft20 bone ${bone}`)
    const p = SKIN_PARTS[part], row0 = p.v + p.d + (p.top - y1), row1 = p.v + p.d + (p.top - y0)
    // [normal, corners TL TR BR BL seen from outside, uv rect u0 v0 u1 v1 in skin px]; front +Z, character left +X
    const faces: Array<[number[], number[][], number[]]> = [
      [[0, 0, 1], [[x0, y1, z1], [x1, y1, z1], [x1, y0, z1], [x0, y0, z1]], [p.u + p.d, row0, p.u + p.d + p.w, row1]],
      [[0, 0, -1], [[x1, y1, z0], [x0, y1, z0], [x0, y0, z0], [x1, y0, z0]], [p.u + 2 * p.d + p.w, row0, p.u + 2 * p.d + 2 * p.w, row1]],
      [[-1, 0, 0], [[x0, y1, z0], [x0, y1, z1], [x0, y0, z1], [x0, y0, z0]], [p.u, row0, p.u + p.d, row1]],
      [[1, 0, 0], [[x1, y1, z1], [x1, y1, z0], [x1, y0, z0], [x1, y0, z1]], [p.u + p.d + p.w, row0, p.u + 2 * p.d + p.w, row1]],
      [[0, 1, 0], [[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], [p.u + p.d, p.v, p.u + p.d + p.w, p.v + p.d]],
      [[0, -1, 0], [[x0, y0, z1], [x1, y0, z1], [x1, y0, z0], [x0, y0, z0]], [p.u + p.d + p.w, p.v, p.u + p.d + 2 * p.w, p.v + p.d]],
    ]
    for (const [n, corners, [u0, v0, u1, v1]] of faces) {
      const base = position.length / 3, coords = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]]
      corners.forEach((corner, i) => { position.push(...corner.map((v) => v * PX)); normal.push(...n); uv.push(coords[i]![0]! / 64, coords[i]![1]! / 64); joints.push(joint, 0, 0, 0); weights.push(1, 0, 0, 0) })
      indices.push(base, base + 3, base + 2, base, base + 2, base + 1)
    }
  }
  w.json.images = [{ bufferView: w.view(skinPng), mimeType: 'image/png', name: `${name}_skin` }]
  w.json.samplers = [{ magFilter: 9728, minFilter: 9728 }]
  w.json.textures = [{ source: 0, sampler: 0 }]
  w.json.materials = [{ name: `${name}_skin`, pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 0, roughnessFactor: 0.9 }, alphaMode: 'MASK', alphaCutoff: 0.5 }]
  const primitives: any[] = [{ attributes: {
    POSITION: w.accessor(new Float32Array(position), 'VEC3', 5126, 34962, true), NORMAL: w.accessor(new Float32Array(normal), 'VEC3', 5126, 34962),
    TEXCOORD_0: w.accessor(new Float32Array(uv), 'VEC2', 5126, 34962), JOINTS_0: w.accessor(new Uint16Array(joints), 'VEC4', 5123, 34962),
    WEIGHTS_0: w.accessor(new Float32Array(weights), 'VEC4', 5126, 34962) }, indices: w.accessor(new Uint16Array(indices), 'SCALAR', 5123, 34963), material: 0 }]
  for (const item of extras) if (!jointOf.has(item.bone)) throw new TypeError(`Unknown Minecraft20 bone ${item.bone}`)
  if (extras.length) primitives.push(...boxPrimitives(w, extras.map((item) => ({ ...item, joint: jointOf.get(item.bone)! })), PX))
  w.json.meshes = [{ name, primitives }]
  w.json.skins = [{ joints: bones.map((bone) => index.get(bone)!), inverseBindMatrices: w.accessor(ibm, 'MAT4', 5126) }]
  w.json.nodes.push({ name: `${name}_mesh`, mesh: 0, skin: 0 }); w.json.scenes[0].nodes.push(w.json.nodes.length - 1)
  return w.glb()
}

/** Skeleton (with a mesh-less skin) plus every Action (bone-local translation/rotation tracks, linear) on the same Minecraft20 node names. */
export function actionsGlb(root: Object3D & { animations: AnimationClip[] }, size = 1): Uint8Array {
  const w = new Writer(), { bones, index } = writeSkeleton(w, root, 'minecraft20', size), byName = new Map(bones.map((bone) => [bone.name, index.get(bone)!]))
  // A skin (no mesh) makes importers such as App 2 read these nodes as the Actions' skeleton.
  const ibm = new Float32Array(bones.length * 16)
  bones.forEach((bone, i) => ibm.set(bone.matrixWorld.clone().invert().toArray(), i * 16))
  w.json.skins = [{ joints: bones.map((bone) => index.get(bone)!), inverseBindMatrices: w.accessor(ibm, 'MAT4', 5126) }]
  w.json.animations = root.animations.map((clip) => {
    const samplers: any[] = [], channels: any[] = []
    for (const track of clip.tracks) {
      const [name, property] = [track.name.slice(0, track.name.lastIndexOf('.')), track.name.slice(track.name.lastIndexOf('.') + 1)]
      const path = { position: 'translation', quaternion: 'rotation', scale: 'scale' }[property]
      if (!byName.has(name) || !path) continue
      samplers.push({ input: w.accessor(new Float32Array(track.times), 'SCALAR', 5126, undefined, true), output: w.accessor(new Float32Array(track.values), path === 'rotation' ? 'VEC4' : 'VEC3', 5126), interpolation: 'LINEAR' })
      channels.push({ sampler: samplers.length - 1, target: { node: byName.get(name), path } })
    }
    return { name: clip.name, samplers, channels }
  })
  return w.glb()
}

async function main(out: string, size = 1) {
  mkdirSync(out, { recursive: true })
  const root = await loadMinecraft20()
  for (const role of ROLES) { const bytes = characterGlb(root, role, size); writeFileSync(join(out, `${role.name}.mc20.glb`), bytes); console.log(`wrote ${role.name}.mc20.glb ${bytes.length} B`) }
  const actions = actionsGlb(root, size); writeFileSync(join(out, 'minecraft20-actions.glb'), actions); console.log(`wrote minecraft20-actions.glb ${actions.length} B, ${root.animations.length} Actions`)
}

/** `--skin name=skin.png,...` (`--staff name` adds the rainbow staff): `<name>.mc20.glb` wearing each 64x64 skin. */
async function packSkins(out: string, skins: string, staff: string | undefined, size = 1) {
  mkdirSync(out, { recursive: true })
  const root = await loadMinecraft20()
  for (const entry of skins.split(',')) {
    const [name, png] = entry.split('=') as [string, string]
    if (!name || !png) throw new TypeError('--skin expects name=skin.png[,name=skin.png]')
    const bytes = skinnedCharacterGlb(root, name, readFileSync(png), name === staff ? rainbowStaff() : [], size)
    writeFileSync(join(out, `${name}.mc20.glb`), bytes); console.log(`wrote ${name}.mc20.glb ${bytes.length} B`)
  }
}

/** `--actions <file.bobj> --name <stem>`: pack another Minecraft20 Action library as `<stem>.mc20-actions.glb`. */
async function packActions(out: string, file: string, name: string, size = 1) {
  mkdirSync(out, { recursive: true })
  const root = await loadMinecraft20(file), bytes = actionsGlb(root, size)
  writeFileSync(join(out, `${name}.mc20-actions.glb`), bytes); console.log(`wrote ${name}.mc20-actions.glb ${bytes.length} B, ${root.animations.length} Actions`)
}

if (process.argv[1]?.endsWith('minecraftBlockCharacters.ts')) {
  const { values } = parseArgs({ options: { out: { type: 'string' }, actions: { type: 'string' }, name: { type: 'string' }, size: { type: 'string' }, skin: { type: 'string' }, staff: { type: 'string' } } })
  if (!values.out) throw new TypeError('--out <dir> is required')
  const size = Number(values.size ?? 1)
  void (values.skin ? packSkins(values.out, values.skin, values.staff, size) : values.actions ? packActions(values.out, values.actions, values.name ?? 'library', size) : main(values.out, size))
}
