/**
 * Minecraft-style block characters on the native Minecraft20 skeleton (BBS/Blockbuster V9.12, 20 bones), for App 2 scenes
 * and BBS FS. Geometry is Steve's box layout (1 px = 1/16 block: head 8³, torso 8×12×4, limbs 4×12×4 split upper/lower),
 * each box rigidly skinned to its bone and flat-coloured per role; no Mojang skin texture is used. Actions stay on the same
 * 20 bones, so App 2 binds them by name without retargeting.
 *
 *   node --import tsx ../retarget/cli/minecraftBlockCharacters.ts --out <dir>      (from packages/builder)
 * writes `<role>.mc20.glb` per role and `minecraft20-actions.glb` (the 85 V9.12 Actions, GPL-3.0 like their source).
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

export const ROLES: Role[] = [
  { name: 'herobrine', boxes: humanoid({ head: '#B98A68', hair: '#3B2A1E', eyes: '#F4F4F4', shirt: '#2C9AA0', sleeve: '#2C9AA0', hand: '#B98A68', pants: '#3542A0', shoes: '#4A4A4A' }) },
  { name: 'steve', boxes: humanoid({ head: '#B98A68', hair: '#3B2A1E', eyes: '#4B3A8A', eyeWhite: '#F4F4F4', shirt: '#2C9AA0', sleeve: '#2C9AA0', hand: '#B98A68', pants: '#3542A0', shoes: '#4A4A4A' }) },
  { name: 'enderman', boxes: humanoid({ head: '#151515', eyes: '#C04BFF', shirt: '#151515', sleeve: '#151515', hand: '#151515', pants: '#151515', shoes: '#151515' }, 2, 8) },
  { name: 'chicken', boxes: [
    box('head', [-2, 24, -1.5], [2, 30, 1.5], '#F2F2F2'), box('head', [-2, 26, 1.5], [2, 28, 3.5], '#F2B233'), box('head', [-1, 24, 1.5], [1, 26, 2.5], '#D23B2B'),
    box('head', [-2.05, 28, 0.5], [-1, 29, 1.55], '#151515'), box('head', [1, 28, 0.5], [2.05, 29, 1.55], '#151515'),
    box('low_body', [-3, 16, -4], [3, 24, 4], '#F2F2F2'), box('body', [-3, 12, -4], [3, 16, 4], '#F2F2F2'),
    box('left_arm', [3, 16, -3], [4, 22, 3], '#E6E6E6'), box('low_left_arm', [3, 13, -3], [4, 16, 3], '#E6E6E6'),
    box('right_arm', [-4, 16, -3], [-3, 22, 3], '#E6E6E6'), box('low_right_arm', [-4, 13, -3], [-3, 16, 3], '#E6E6E6'),
    box('left_leg', [0.5, 6, -0.5], [1.5, 12, 0.5], '#F2B233'), box('low_left_leg', [0, 0, -1], [2, 6, 1.5], '#F2B233'),
    box('right_leg', [-1.5, 6, -0.5], [-0.5, 12, 0.5], '#F2B233'), box('low_leg_right', [-2, 0, -1], [0, 6, 1.5], '#F2B233')] },
]

const ARMATURE = resolve(import.meta.dirname, '../../../apps/studio/public/retarget/v9.12')

export async function loadMinecraft20(): Promise<Object3D & { animations: AnimationClip[] }> {
  const root = await loadAsset(readFileSync(join(ARMATURE, 'minecraft-actions.bobj')), 'bobj', { bobjArmature: readFileSync(join(ARMATURE, 'minecraft20-armature.bobj')) })
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
    const size = { SCALAR: 1, VEC3: 3, VEC4: 4, MAT4: 16 }[type]!, count = data.length / size, extra: Record<string, unknown> = {}
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
export function writeSkeleton(w: Writer, root: Object3D, rootName = 'minecraft20') {
  const bones: Bone[] = []
  root.traverse((object) => { if ((object as Bone).isBone) bones.push(object as Bone) })
  const index = new Map(bones.map((bone, i) => [bone, i + 1]))
  const tops = bones.filter((bone) => !index.has(bone.parent as Bone)), holder = tops[0]?.parent
  const [p, q, sc] = [new Vector3(), new Quaternion(), new Vector3()]
  if (holder && holder !== root) holder.matrixWorld.decompose(p, q, sc)
  w.json.nodes.push({ name: rootName, children: tops.map((bone) => index.get(bone)!), ...(holder && holder !== root ? { translation: p.toArray(), rotation: q.toArray(), scale: sc.toArray() } : {}) })
  for (const bone of bones) {
    const children = bone.children.filter((child) => index.has(child as Bone)).map((child) => index.get(child as Bone)!)
    w.json.nodes.push({ name: bone.name, translation: bone.position.toArray(), rotation: bone.quaternion.toArray(), ...(children.length ? { children } : {}) })
  }
  w.json.scenes[0].nodes.push(0)
  return { bones, index }
}

export function characterGlb(root: Object3D, role: Role): Uint8Array {
  const w = new Writer(), { bones, index } = writeSkeleton(w, root)
  const jointOf = new Map(bones.map((bone, i) => [bone.name, i]))
  const ibm = new Float32Array(bones.length * 16)
  bones.forEach((bone, i) => ibm.set(bone.matrixWorld.clone().invert().toArray(), i * 16))
  const byColor = new Map<string, Box[]>()
  for (const item of role.boxes) {
    if (!jointOf.has(item.bone)) throw new TypeError(`Unknown Minecraft20 bone ${item.bone}`)
    const key = item.color.join(','); byColor.set(key, [...(byColor.get(key) ?? []), item])
  }
  w.json.materials = []; const primitives: any[] = []
  for (const [, boxes] of byColor) {
    const position: number[] = [], normal: number[] = [], joints: number[] = [], weights: number[] = [], indices: number[] = []
    for (const item of boxes) {
      const [x0, y0, z0] = item.min.map((v) => v * PX), [x1, y1, z1] = item.max.map((v) => v * PX)
      const faces: Array<[number[], number[][]]> = [
        [[1, 0, 0], [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]]], [[-1, 0, 0], [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]]],
        [[0, 1, 0], [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]]], [[0, -1, 0], [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]]],
        [[0, 0, 1], [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]]], [[0, 0, -1], [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]]],
      ]
      for (const [n, corners] of faces) {
        const base = position.length / 3
        for (const corner of corners) { position.push(...corner); normal.push(...n); joints.push(jointOf.get(item.bone)!, 0, 0, 0); weights.push(1, 0, 0, 0) }
        indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
      }
    }
    w.json.materials.push({ pbrMetallicRoughness: { baseColorFactor: [...boxes[0]!.color, 1], metallicFactor: 0, roughnessFactor: 0.9 } })
    primitives.push({ attributes: { POSITION: w.accessor(new Float32Array(position), 'VEC3', 5126, 34962, true), NORMAL: w.accessor(new Float32Array(normal), 'VEC3', 5126, 34962),
      JOINTS_0: w.accessor(new Uint16Array(joints), 'VEC4', 5123, 34962), WEIGHTS_0: w.accessor(new Float32Array(weights), 'VEC4', 5126, 34962) },
    indices: w.accessor(new Uint16Array(indices), 'SCALAR', 5123, 34963), material: w.json.materials.length - 1 })
  }
  w.json.meshes = [{ name: role.name, primitives }]
  w.json.skins = [{ joints: bones.map((bone) => index.get(bone)!), inverseBindMatrices: w.accessor(ibm, 'MAT4', 5126) }]
  w.json.nodes.push({ name: `${role.name}_mesh`, mesh: 0, skin: 0 }); w.json.scenes[0].nodes.push(w.json.nodes.length - 1)
  return w.glb()
}

/** Skeleton (with a mesh-less skin) plus every Action (bone-local translation/rotation tracks, linear) on the same Minecraft20 node names. */
export function actionsGlb(root: Object3D & { animations: AnimationClip[] }): Uint8Array {
  const w = new Writer(), { bones, index } = writeSkeleton(w, root), byName = new Map(bones.map((bone) => [bone.name, index.get(bone)!]))
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

async function main(out: string) {
  mkdirSync(out, { recursive: true })
  const root = await loadMinecraft20()
  for (const role of ROLES) { const bytes = characterGlb(root, role); writeFileSync(join(out, `${role.name}.mc20.glb`), bytes); console.log(`wrote ${role.name}.mc20.glb ${bytes.length} B`) }
  const actions = actionsGlb(root); writeFileSync(join(out, 'minecraft20-actions.glb'), actions); console.log(`wrote minecraft20-actions.glb ${actions.length} B, ${root.animations.length} Actions`)
}

if (process.argv[1]?.endsWith('minecraftBlockCharacters.ts')) {
  const { values } = parseArgs({ options: { out: { type: 'string' } } })
  if (!values.out) throw new TypeError('--out <dir> is required')
  void main(values.out)
}
