/**
 * Minecraft20 preview model for the Workbench: the exported `.bobj` Actions sampled per tick as bone-local tracks, played
 * in the browser on a three.js SkinnedMesh.
 * Default model: a generated blocky mannequin on the repo's own Minecraft20 armature (Steve proportions, rigid boxes,
 * left limbs blue / right orange, visor on the face) — no game asset needed.
 * Optional: the Emoticons Steve (`default_simple.bobj` + `steve.png`, Mojang/mod assets, never in the repo) when the user
 * points W01_STEVE_DIR at a folder holding both.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { Matrix4, Quaternion, Vector3 } from 'three'
import { evaluateBobjAction, parseBobjActions } from '../src/index.ts'
import { parseBobjArmature } from '../src/reverse.ts'
import { DEFAULT_ARMATURE } from './pipeline.ts'

export const STEVE_TICKS_PER_SECOND = 20
const MAX_INFLUENCES = 4

export interface PreviewMesh {
  kind: 'mannequin' | 'steve'
  bones: Array<{ name: string; parent: string | null; restLocal: number[] }>
  /** Non-indexed triangles: one entry per face corner. `colors` (mannequin) or `uvs` + texture (Steve). */
  positions: number[]; uvs: number[]; colors: number[]; skinIndices: number[]; skinWeights: number[]
}
type Armature = ReturnType<typeof parseBobjArmature>

/** Steve files, only when W01_STEVE_DIR is set and holds both. */
export function steveFiles() {
  const dir = process.env.W01_STEVE_DIR?.trim()
  if (!dir) return null
  const files = { dir: resolve(dir), model: join(resolve(dir), 'default_simple.bobj'), texture: join(resolve(dir), 'steve.png') }
  return existsSync(files.model) && existsSync(files.texture) ? files : null
}

const emptyMesh = (kind: PreviewMesh['kind'], armature: Armature): PreviewMesh => ({ kind, positions: [], uvs: [], colors: [], skinIndices: [], skinWeights: [],
  bones: armature.bones.map((bone) => ({ name: bone.name, parent: bone.parent, restLocal: [...bone.restLocal] })) })

// Minecraft pixels (1 block = 16 px = 1 unit): head 8³, torso 8×12×4, limbs 4×12×4, split at elbow/knee like the rig.
const PX = 1 / 16
const COLORS = { skin: [0.85, 0.68, 0.55], visor: [0.12, 0.14, 0.18], torso: [0.25, 0.62, 0.62], waist: [0.2, 0.5, 0.52],
  left: [0.38, 0.62, 0.98], leftDark: [0.23, 0.45, 0.85], right: [0.98, 0.57, 0.24], rightDark: [0.85, 0.42, 0.13] } as const
/** [bone, min xyz, max xyz (px), color]. Rigid boxes: no blended weights, so no wedge at elbows/knees. */
const BOXES: ReadonlyArray<readonly [string, readonly [number, number, number], readonly [number, number, number], readonly number[]]> = [
  ['head', [-4, 24, -4], [4, 32, 4], COLORS.skin], ['head', [-3, 26, 4], [3, 28, 5], COLORS.visor],
  ['low_body', [-4, 18, -2], [4, 24, 2], COLORS.torso], ['body', [-4, 12, -2], [4, 18, 2], COLORS.waist],
  ['left_arm', [4, 18, -2], [8, 24, 2], COLORS.left], ['low_left_arm', [4, 14, -2], [8, 18, 2], COLORS.leftDark], ['low_left_arm.end', [4, 12, -2], [8, 14, 2], COLORS.skin],
  ['right_arm', [-8, 18, -2], [-4, 24, 2], COLORS.right], ['low_right_arm', [-8, 14, -2], [-4, 18, 2], COLORS.rightDark], ['low_right_arm.end', [-8, 12, -2], [-4, 14, 2], COLORS.skin],
  ['left_leg', [0, 6, -2], [4, 12, 2], COLORS.left], ['low_left_leg', [0, 0, -2], [4, 6, 2], COLORS.leftDark],
  ['right_leg', [-4, 6, -2], [0, 12, 2], COLORS.right], ['low_leg_right', [-4, 0, -2], [0, 6, 2], COLORS.rightDark],
]
const FACES = [[0, 1, 3, 2], [4, 6, 7, 5], [0, 4, 5, 1], [2, 3, 7, 6], [0, 2, 6, 4], [1, 5, 7, 3]] as const

function mannequin(): { armature: Armature; mesh: PreviewMesh } {
  const armature = parseBobjArmature(readFileSync(DEFAULT_ARMATURE, 'utf8'))
  const mesh = emptyMesh('mannequin', armature)
  for (const [bone, min, max, color] of BOXES) {
    const index = armature.bones.findIndex((item) => item.name === bone)
    if (index < 0) continue
    const corner = (i: number) => [i & 4 ? max[0] : min[0], i & 2 ? max[1] : min[1], i & 1 ? max[2] : min[2]].map((value) => value * PX)
    for (const [a, b, c, d] of FACES) for (const i of [a, b, c, a, c, d]) {
      mesh.positions.push(...corner(i)); mesh.uvs.push(0, 0); mesh.colors.push(...color)
      mesh.skinIndices.push(index, 0, 0, 0); mesh.skinWeights.push(1, 0, 0, 0)
    }
  }
  return { armature, mesh }
}

function steve(files: NonNullable<ReturnType<typeof steveFiles>>): { armature: Armature; mesh: PreviewMesh } {
  const text = readFileSync(files.model, 'utf8')
  const armature = parseBobjArmature(text)
  const boneIndex = new Map(armature.bones.map((bone, index) => [bone.name, index]))
  const v: number[][] = [], vt: number[][] = [], weights: Array<Array<[number, number]>> = []
  const mesh = emptyMesh('steve', armature)
  for (const line of text.split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/)
    if (parts[0] === 'v') { v.push(parts.slice(1, 4).map(Number)); weights.push([]) }
    else if (parts[0] === 'vw') { const bone = boneIndex.get(parts[1]!); if (bone !== undefined && weights.length) weights.at(-1)!.push([bone, Number(parts[2])]) }
    else if (parts[0] === 'vt') vt.push(parts.slice(1, 3).map(Number))
    else if (parts[0] === 'f') for (const corner of parts.slice(1)) {
      const [a, b] = corner.split('/').map((value) => Number(value) - 1)
      const top = [...(weights[a!] ?? [])].sort((x, y) => y[1] - x[1]).slice(0, MAX_INFLUENCES)
      const sum = top.reduce((total, [, weight]) => total + weight, 0) || 1
      mesh.positions.push(...v[a!]!); mesh.uvs.push(...(vt[b!] ?? [0, 0])); mesh.colors.push(1, 1, 1)
      for (let slot = 0; slot < MAX_INFLUENCES; slot++) { mesh.skinIndices.push(top[slot]?.[0] ?? 0); mesh.skinWeights.push((top[slot]?.[1] ?? 0) / sum) }
    }
  }
  return { armature, mesh }
}

/**
 * Minecraft skin layout (64×64, classic 4 px arms): [bone, part]. Part = texture origin (u, v), size w×h×d px and the top
 * of the whole limb in model px, so a rig segment (upper arm, forearm, hand) takes its own rows of the limb's side faces.
 */
const SKIN_PARTS = {
  head: { u: 0, v: 0, w: 8, h: 8, d: 8, top: 32 }, body: { u: 16, v: 16, w: 8, h: 12, d: 4, top: 24 },
  rarm: { u: 40, v: 16, w: 4, h: 12, d: 4, top: 24 }, larm: { u: 32, v: 48, w: 4, h: 12, d: 4, top: 24 },
  rleg: { u: 0, v: 16, w: 4, h: 12, d: 4, top: 12 }, lleg: { u: 16, v: 48, w: 4, h: 12, d: 4, top: 12 },
} as const
const SKIN_BOXES: ReadonlyArray<readonly [string, keyof typeof SKIN_PARTS]> = [
  ['head', 'head'], ['low_body', 'body'], ['body', 'body'], ['left_arm', 'larm'], ['low_left_arm', 'larm'], ['low_left_arm.end', 'larm'],
  ['right_arm', 'rarm'], ['low_right_arm', 'rarm'], ['low_right_arm.end', 'rarm'], ['left_leg', 'lleg'], ['low_left_leg', 'lleg'],
  ['right_leg', 'rleg'], ['low_leg_right', 'rleg'],
]

/** The mannequin boxes UV-mapped to a Minecraft player skin (front +Z, character left +X), drawn with a library skin. */
function skinnedMannequin(): { armature: Armature; mesh: PreviewMesh } {
  const armature = parseBobjArmature(readFileSync(DEFAULT_ARMATURE, 'utf8'))
  const mesh = emptyMesh('steve', armature)
  for (const [bone, partName] of SKIN_BOXES) {
    const index = armature.bones.findIndex((item) => item.name === bone)
    const box = BOXES.find(([name, min]) => name === bone && !(name === 'head' && min[2] === 4))
    if (index < 0 || !box) continue
    const [, [x0, y0, z0], [x1, y1, z1]] = box, p = SKIN_PARTS[partName]
    const row0 = p.v + p.d + (p.top - y1), row1 = p.v + p.d + (p.top - y0)
    // [corners TL, TR, BR, BL seen from outside, UV rect u0, v0, u1, v1 in skin px]
    const quads: Array<[number[][], number[]]> = [
      [[[x0, y1, z1], [x1, y1, z1], [x1, y0, z1], [x0, y0, z1]], [p.u + p.d, row0, p.u + p.d + p.w, row1]], // front
      [[[x1, y1, z0], [x0, y1, z0], [x0, y0, z0], [x1, y0, z0]], [p.u + 2 * p.d + p.w, row0, p.u + 2 * p.d + 2 * p.w, row1]], // back
      [[[x0, y1, z0], [x0, y1, z1], [x0, y0, z1], [x0, y0, z0]], [p.u, row0, p.u + p.d, row1]], // character right (−X)
      [[[x1, y1, z1], [x1, y1, z0], [x1, y0, z0], [x1, y0, z1]], [p.u + p.d + p.w, row0, p.u + 2 * p.d + p.w, row1]], // character left (+X)
      [[[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], [p.u + p.d, p.v, p.u + p.d + p.w, p.v + p.d]], // top
      [[[x0, y0, z1], [x1, y0, z1], [x1, y0, z0], [x0, y0, z0]], [p.u + p.d + p.w, p.v, p.u + p.d + 2 * p.w, p.v + p.d]], // bottom
    ]
    for (const [corners, [u0, v0, u1, v1]] of quads) {
      const uv = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]].map(([u, v]) => [u! / 64, 1 - v! / 64])
      for (const i of [0, 3, 2, 0, 2, 1]) {
        mesh.positions.push(...corners[i]!.map((value) => value * PX)); mesh.uvs.push(...uv[i]!); mesh.colors.push(1, 1, 1)
        mesh.skinIndices.push(index, 0, 0, 0); mesh.skinWeights.push(1, 0, 0, 0)
      }
    }
  }
  return { armature, mesh }
}
let skinned: ReturnType<typeof skinnedMannequin> | null = null
/** Mannequin wearing a library character's skin (`textureUrl` serves that skin PNG). */
export function skinnedPreviewModel(textureUrl: string) { skinned ??= skinnedMannequin(); return { mesh: skinned.mesh, textureUrl } }

let cached: { key: string; armature: Armature; mesh: PreviewMesh } | null = null
function load() {
  const files = steveFiles(), key = files ? `steve:${files.model}` : 'mannequin'
  if (cached?.key !== key) cached = { key, ...(files ? steve(files) : mannequin()) }
  return cached
}

export function previewModel() { const { mesh } = load(); const files = steveFiles(); return { mesh, textureUrl: files ? '/api/steve/texture' : null } }

/** Every Action of a Minecraft20 `.bobj` sampled each tick as bone-local position/quaternion/scale on the preview rig. */
export function previewClips(bobjText: string) {
  const { armature } = load()
  const parentIndex = armature.bones.map((bone) => armature.bones.findIndex((other) => other.name === bone.parent))
  return [...parseBobjActions(bobjText).values()].map((action) => {
    const times: number[] = [], tracks = armature.bones.map(() => ({ position: [] as number[], quaternion: [] as number[], scale: [] as number[] }))
    for (let tick = 0; tick <= action.durationTicks; tick++) {
      times.push(tick / STEVE_TICKS_PER_SECOND)
      const worlds = evaluateBobjAction(armature, action, tick).map((bone) => new Matrix4().fromArray([...bone.worldMatrix]))
      worlds.forEach((world, index) => {
        const parent = parentIndex[index]!
        const local = parent >= 0 ? worlds[parent]!.clone().invert().multiply(world) : world
        const p = new Vector3(), q = new Quaternion(), s = new Vector3(); local.decompose(p, q, s)
        tracks[index]!.position.push(...p.toArray()); tracks[index]!.quaternion.push(...q.toArray()); tracks[index]!.scale.push(...s.toArray())
      })
    }
    return { name: action.name, duration: action.durationTicks / STEVE_TICKS_PER_SECOND, times,
      tracks: armature.bones.map((bone, index) => ({ bone: bone.name, ...tracks[index]! })) }
  })
}
