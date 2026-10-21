/**
 * Steve preview for Minecraft20 results: the Emoticons `default_simple.bobj` mesh (Mojang/mod asset, never in the repo)
 * skinned to the same 20-bone rig, plus the exported `.bobj` Actions sampled per tick as bone-local tracks so the
 * browser can play them with a regular three.js SkinnedMesh + AnimationMixer.
 * Assets are read from W01_STEVE_DIR (default C:/w01-samples/steve): default_simple.bobj + steve.png.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { Matrix4, Quaternion, Vector3 } from 'three'
import { evaluateBobjAction, parseBobjActions } from '../src/index.ts'
import { parseBobjArmature } from '../src/reverse.ts'

export const STEVE_TICKS_PER_SECOND = 20
const MAX_INFLUENCES = 4

export function steveDir(): string { return resolve(process.env.W01_STEVE_DIR?.trim() || 'C:/w01-samples/steve') }
export function steveFiles() {
  const dir = steveDir()
  return { dir, model: join(dir, 'default_simple.bobj'), texture: join(dir, 'steve.png') }
}
export function steveAvailable() { const files = steveFiles(); return existsSync(files.model) && existsSync(files.texture) }

let cached: { text: string; armature: ReturnType<typeof parseBobjArmature>; mesh: SteveMesh } | null = null
export interface SteveMesh {
  bones: Array<{ name: string; parent: string | null; restLocal: number[] }>
  /** Non-indexed triangles: one entry per face corner. */
  positions: number[]; uvs: number[]; skinIndices: number[]; skinWeights: number[]
}

function load() {
  const text = readFileSync(steveFiles().model, 'utf8')
  if (cached?.text === text) return cached
  const armature = parseBobjArmature(text)
  const boneIndex = new Map(armature.bones.map((bone, index) => [bone.name, index]))
  const v: number[][] = [], vt: number[][] = [], weights: Array<Array<[number, number]>> = []
  const mesh: SteveMesh = { bones: armature.bones.map((bone) => ({ name: bone.name, parent: bone.parent, restLocal: [...bone.restLocal] })), positions: [], uvs: [], skinIndices: [], skinWeights: [] }
  for (const line of text.split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/)
    if (parts[0] === 'v') { v.push(parts.slice(1, 4).map(Number)); weights.push([]) }
    else if (parts[0] === 'vw') { const bone = boneIndex.get(parts[1]!); if (bone !== undefined && weights.length) weights.at(-1)!.push([bone, Number(parts[2])]) }
    else if (parts[0] === 'vt') vt.push(parts.slice(1, 3).map(Number))
    else if (parts[0] === 'f') for (const corner of parts.slice(1)) {
      const [a, b] = corner.split('/').map((value) => Number(value) - 1)
      const top = [...(weights[a!] ?? [])].sort((x, y) => y[1] - x[1]).slice(0, MAX_INFLUENCES)
      const sum = top.reduce((total, [, weight]) => total + weight, 0) || 1
      mesh.positions.push(...v[a!]!); mesh.uvs.push(...(vt[b!] ?? [0, 0]))
      for (let slot = 0; slot < MAX_INFLUENCES; slot++) { mesh.skinIndices.push(top[slot]?.[0] ?? 0); mesh.skinWeights.push((top[slot]?.[1] ?? 0) / sum) }
    }
  }
  cached = { text, armature, mesh }
  return cached
}

export function steveMesh(): SteveMesh { return load().mesh }

/** Every Action of a Minecraft20 `.bobj` sampled each tick as bone-local position/quaternion/scale on Steve's rig. */
export function steveClips(bobjText: string) {
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
