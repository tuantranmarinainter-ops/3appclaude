/**
 * Verity characters (Gỗ Xưa, Tiểu Nhị, Chirity: BBS `model.bbs.bobj`, rig `verity.mdl`) as Workbench targets that keep their
 * ORIGINAL skeleton. The solver runs on a Mixamo65 view of the rig (`model.glb` in the library); this module carries every
 * normalized Action back onto the original bones:
 * - `.bobj`: the original file byte for byte (all bones incl. Jaw, meshes, built-in Actions) with the new Actions appended;
 * - GLB: same original skeleton, textures, built-in Actions + new Actions (Y-up, metres).
 * Jaw and other bones outside the 65 keep their rest pose; wing bones loop the wings of a built-in Action (`idle`); Root
 * takes the constant turn every built-in Action has (BBS facing comes from it).
 *
 * View transform (must match the library `model.glb`): v = s·R·(p − ground), R = turn about the vertical bringing the rig's
 * left to +X, s = 1.9 m / 3.865407 units (Gỗ Xưa body), ground = lowest vertex outside the `camera`-only helper object.
 */
import { AnimationMixer, Euler, Matrix4, Quaternion, Vector3, type Object3D } from 'three'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { evaluateBobjChannel, parseBobjActions, type BobjAction } from '../src/index.ts'
import { parseBobjArmature } from '../src/reverse.ts'
import { encodeGlb } from '../cli/glb.ts'
import { loadAsset } from '../cli/loadAsset.ts'
import { appendVerityActions, projectVerityFrame, VERITY_METRES_PER_UNIT, VERITY_WORKBENCH_TO_MIXAMO, type VerityAddedAction, type VerityLocals } from '../src/verityRig.ts'

const TICKS = 20, GLB_FPS = 30
const CAMERA_OBJECT = 'verity.mdl/Verity.smd'
export { VERITY_METRES_PER_UNIT, VERITY_WORKBENCH_TO_MIXAMO as VERITY_TO_MIXAMO }

type Locals = VerityLocals
export type AddedAction = VerityAddedAction

export function loadVerityModel(bobjPath: string, wingActionName = 'idle') {
  const text = readFileSync(bobjPath, 'utf8'), dir = join(bobjPath, '..')
  const armature = parseBobjArmature(text), actions = parseBobjActions(text)
  const restWorld = new Map(armature.bones.map((b) => [b.name, new Matrix4().fromArray([...b.restWorld])]))
  const restLocal = new Map(armature.bones.map((b) => [b.name, new Matrix4().fromArray([...b.restLocal])]))
  const at = (name: string) => new Vector3().setFromMatrixPosition(restWorld.get(name)!)
  const left = at('Upper_Leg_L').sub(at('Upper_Leg_R')).setY(0).normalize()
  const R = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.atan2(left.z, left.x)), Rinv = R.clone().invert()
  const scale = VERITY_METRES_PER_UNIT

  // geometry (OBJ-style global indices); ground skips the camera-only helper object
  const positions: number[][] = [], weights: Array<Array<[string, number]>> = [], uvs: number[][] = [], normals: number[][] = []
  const objects: Array<{ name: string; faces: number[][][] }> = []
  let ground = Infinity
  for (const raw of text.split(/\r?\n/)) {
    if (raw.startsWith('an ')) break
    const p = raw.trim().split(/\s+/)
    if (p[0] === 'o') objects.push({ name: p[1]!, faces: [] })
    else if (p[0] === 'v') { positions.push(p.slice(1, 4).map(Number)); weights.push([]); if (objects.at(-1)?.name !== CAMERA_OBJECT) ground = Math.min(ground, Number(p[2])) }
    else if (p[0] === 'vw') weights.at(-1)!.push([p[1]!, Number(p[2])])
    else if (p[0] === 'vt') uvs.push(p.slice(1, 3).map(Number))
    else if (p[0] === 'vn') normals.push(p.slice(1, 4).map(Number))
    else if (p[0] === 'f') objects.at(-1)!.faces.push(p.slice(1).map((c) => c.split('/').map((n) => Number(n) - 1)))
  }

  const channelDelta = (action: BobjAction, bone: string, tick: number) => {
    const loc = [0, 0, 0], rot = [0, 0, 0], scl = [1, 1, 1]
    for (const channel of action.groups.get(bone)?.channels ?? []) {
      const target = channel.path === 'location' ? loc : channel.path === 'rotation' ? rot : channel.path === 'scale' ? scl : null
      if (target && channel.index >= 0 && channel.index < 3) target[channel.index] = evaluateBobjChannel(channel, tick)
    }
    return new Matrix4().makeTranslation(loc[0]!, loc[1]!, loc[2]!).multiply(new Matrix4().makeRotationFromEuler(new Euler(rot[0], rot[1], rot[2], 'ZYX'))).multiply(new Matrix4().makeScale(scl[0]!, scl[1]!, scl[2]!))
  }
  const actionLocals = (action: BobjAction, tick: number): Locals => new Map(armature.bones.map((b) => [b.name, restLocal.get(b.name)!.clone().multiply(channelDelta(action, b.name, tick))]))

  const wingAction = actions.get(wingActionName) ?? actions.values().next().value
  const isWing = (name: string) => name.startsWith('Wing')
  const rootName = armature.bones.find((b) => !b.parent)!.name
  const rootLocal = wingAction ? actionLocals(wingAction, 0).get(rootName)! : restLocal.get(rootName)!
  const turn = rootLocal.clone().multiply(restLocal.get(rootName)!.clone().invert())

  /** Normalized GLB (Mixamo65 view, every animation) → original-space locals per tick. */
  async function convertNormalized(glb: Uint8Array): Promise<AddedAction[]> {
    const scene = await loadAsset(glb, 'glb', { skeletonOnly: true })
    const nodes = new Map<string, Object3D>(); scene.traverse((o) => { if (o.name) nodes.set(o.name.replace(/^mixamorig\d*:?/i, ''), o) })
    const used = new Set(actions.keys()), added: AddedAction[] = []
    for (const clip of scene.animations) {
      let name = clip.name.replace(/[.\[\]:/\\]|[^\w-]+/g, '_').replace(/^_+|_+$/g, '') || 'action'
      for (let n = 2; used.has(name); n++) name = `${name.replace(/_\d+$/, '')}_${n}`
      used.add(name)
      const mixer = new AnimationMixer(scene), playing = mixer.clipAction(clip).play()
      const ticks = Math.max(1, Math.round(clip.duration * TICKS)), frames: Locals[] = []
      for (let tick = 0; tick <= ticks; tick++) {
        mixer.setTime(Math.min(tick / TICKS, clip.duration)); scene.updateMatrixWorld(true)
        const wings = wingAction ? actionLocals(wingAction, tick % Math.max(1, wingAction.durationTicks)) : null
        const solverWorlds = new Map([...nodes].map(([name, node]) => [name, node.matrixWorld]))
        frames.push(projectVerityFrame(solverWorlds, armature.bones.map((bone) => ({ name: bone.name, parent: bone.parent,
          restWorld: restWorld.get(bone.name)!, restLocal: restLocal.get(bone.name)! })),
        { metresPerUnit: scale, groundUnits: ground, sourceFacingInverse: Rinv, rootActionDelta: turn },
        rootName, rootLocal, wings, VERITY_WORKBENCH_TO_MIXAMO))
      }
      playing.stop(); mixer.uncacheRoot(scene)
      added.push({ name, ticks, frames })
    }
    return added
  }

  /** Original `.bobj` byte for byte + `an` blocks (location/rotation[/scale] per tick, Z·Y·X Euler unwrapped). */
  function appendBobj(added: AddedAction[]): string {
    return appendVerityActions(text, armature.bones.map((bone) => ({ name: bone.name, restLocal: restLocal.get(bone.name)! })), added)
  }

  /** Re-evaluates appended Actions from `bobjText` with the reference evaluator: max joint position error (units). */
  function roundTripError(bobjText: string, added: AddedAction[]) {
    const written = parseBobjActions(bobjText)
    let max = 0
    for (const action of added) for (const tick of [...new Set([0, Math.floor(action.ticks / 3), Math.floor(action.ticks * 2 / 3), action.ticks])]) {
      const evaluated = actionLocals(written.get(action.name)!, tick), a = new Map<string, Matrix4>(), b = new Map<string, Matrix4>()
      for (const bone of armature.bones) {
        a.set(bone.name, (bone.parent ? a.get(bone.parent)!.clone() : new Matrix4()).multiply(evaluated.get(bone.name)!))
        b.set(bone.name, (bone.parent ? b.get(bone.parent)!.clone() : new Matrix4()).multiply(action.frames[tick]!.get(bone.name)!))
        max = Math.max(max, new Vector3().setFromMatrixPosition(a.get(bone.name)!).distanceTo(new Vector3().setFromMatrixPosition(b.get(bone.name)!)))
      }
    }
    return max
  }

  /** GLB with the original skeleton under a node lifting the feet to y = 0 and scaling to metres; built-in + added Actions. */
  function buildGlb(added: AddedAction[], textureDir = dir): Uint8Array {
    const chunks: Uint8Array[] = []; let offset = 0
    const json: any = { asset: { version: '2.0', generator: 'W01 Workbench verity' }, scene: 0, scenes: [{ nodes: [] }], nodes: [], meshes: [], materials: [], textures: [], images: [], samplers: [{ magFilter: 9728, minFilter: 9728 }], accessors: [], bufferViews: [], buffers: [], skins: [], animations: [] }
    const view = (data: ArrayBufferView) => {
      const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength), pad = (4 - (offset % 4)) % 4
      if (pad) { chunks.push(new Uint8Array(pad)); offset += pad }
      json.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length }); chunks.push(bytes); offset += bytes.length
      return json.bufferViews.length - 1
    }
    const accessor = (data: Float32Array | Uint16Array | Uint32Array, type: string, componentType: number, count: number, minmax = false) => {
      const acc: any = { bufferView: view(data), componentType, count, type }
      if (minmax) { const n = data.length / count, min = Array(n).fill(Infinity), max = Array(n).fill(-Infinity); data.forEach((v, i) => { min[i % n] = Math.min(min[i % n], v); max[i % n] = Math.max(max[i % n], v) }); Object.assign(acc, { min, max }) }
      json.accessors.push(acc); return json.accessors.length - 1
    }
    const index = new Map(armature.bones.map((b, i) => [b.name, i]))
    for (const b of armature.bones) {
      const t = new Vector3(), q = new Quaternion(), s = new Vector3(); restLocal.get(b.name)!.decompose(t, q, s)
      json.nodes.push({ name: b.name, translation: t.toArray(), rotation: q.normalize().toArray(), scale: s.toArray() })
    }
    for (const b of armature.bones) if (b.parent) (json.nodes[index.get(b.parent)!].children ??= []).push(index.get(b.name)!)
    const rootNode = json.nodes.length
    json.nodes.push({ name: 'Verity', translation: [0, -ground * scale, 0], scale: [scale, scale, scale], children: armature.bones.filter((b) => !b.parent).map((b) => index.get(b.name)!) })
    json.scenes[0].nodes.push(rootNode)
    const ibm = new Float32Array(armature.bones.length * 16)
    armature.bones.forEach((b, i) => ibm.set(restWorld.get(b.name)!.clone().invert().toArray(), i * 16))
    json.skins.push({ joints: armature.bones.map((_, i) => i), inverseBindMatrices: accessor(ibm, 'MAT4', 5126, armature.bones.length), skeleton: rootNode })
    for (const obj of objects) {
      const png = join(textureDir, 'textures', ...obj.name.split('/'), 'default.png')
      if (!existsSync(png)) continue
      const key = new Map<string, number>(), P: number[] = [], N: number[] = [], T: number[] = [], J: number[] = [], W: number[] = [], I: number[] = []
      const vert = (c: number[]) => {
        const k = c.join('/'); let id = key.get(k); if (id !== undefined) return id
        id = key.size; key.set(k, id); P.push(...positions[c[0]!]!); N.push(...(normals[c[2]!] ?? [0, 1, 0])); const uv = uvs[c[1]!] ?? [0, 0]; T.push(uv[0]!, 1 - uv[1]!)
        const ws = weights[c[0]!]!.filter(([, x]) => x > 0).sort((a, b) => b[1] - a[1]).slice(0, 4), sum = ws.reduce((a, [, x]) => a + x, 0) || 1
        for (let i = 0; i < 4; i++) { const [bone, x] = ws[i] ?? [rootName, 0]; J.push(index.get(bone) ?? 0); W.push(ws.length ? x / sum : i === 0 ? 1 : 0) }
        return id
      }
      for (const f of obj.faces) { const ids = f.map(vert); for (let i = 1; i + 1 < ids.length; i++) I.push(ids[0]!, ids[i]!, ids[i + 1]!) }
      const count = P.length / 3
      json.images.push({ bufferView: view(readFileSync(png)), mimeType: 'image/png', name: obj.name }); json.textures.push({ source: json.images.length - 1, sampler: 0 })
      json.materials.push({ name: obj.name, pbrMetallicRoughness: { baseColorTexture: { index: json.textures.length - 1 }, metallicFactor: 0, roughnessFactor: 1 }, alphaMode: 'MASK', alphaCutoff: 0.5, doubleSided: true })
      json.meshes.push({ name: obj.name, primitives: [{ attributes: { POSITION: accessor(new Float32Array(P), 'VEC3', 5126, count, true), NORMAL: accessor(new Float32Array(N), 'VEC3', 5126, count),
        TEXCOORD_0: accessor(new Float32Array(T), 'VEC2', 5126, count), JOINTS_0: accessor(new Uint16Array(J), 'VEC4', 5123, count), WEIGHTS_0: accessor(new Float32Array(W), 'VEC4', 5126, count) },
        indices: accessor(new Uint32Array(I), 'SCALAR', 5125, I.length), material: json.materials.length - 1 }] })
      json.nodes.push({ name: obj.name.replace(/\//g, '_'), mesh: json.meshes.length - 1, skin: 0 }); json.scenes[0].nodes.push(json.nodes.length - 1)
    }
    const animation = (name: string, ticks: number, localsAt: (tick: number) => Locals) => {
      const count = Math.round(ticks / TICKS * GLB_FPS) + 1, times = new Float32Array(count)
      const samples = Array.from({ length: count }, (_, f) => { times[f] = Math.min(f / GLB_FPS, ticks / TICKS); return localsAt(Math.min(f / GLB_FPS * TICKS, ticks)) })
      const input = accessor(times, 'SCALAR', 5126, count, true), channels: any[] = [], samplers: any[] = []
      armature.bones.forEach((b, i) => {
        const tr = new Float32Array(count * 3), ro = new Float32Array(count * 4), sc = new Float32Array(count * 3)
        samples.forEach((locals, f) => { const t = new Vector3(), q = new Quaternion(), s = new Vector3(); locals.get(b.name)!.decompose(t, q, s); tr.set(t.toArray(), f * 3); ro.set(q.normalize().toArray(), f * 4); sc.set(s.toArray(), f * 3) })
        for (const [path, data, type] of [['translation', tr, 'VEC3'], ['rotation', ro, 'VEC4'], ['scale', sc, 'VEC3']] as const) {
          samplers.push({ input, output: accessor(data, type, 5126, count), interpolation: 'LINEAR' }); channels.push({ sampler: samplers.length - 1, target: { node: i, path } })
        }
      })
      json.animations.push({ name, channels, samplers })
    }
    for (const [name, action] of actions) animation(name, Math.max(1, action.durationTicks), (tick) => actionLocals(action, tick))
    for (const action of added) animation(action.name, action.ticks, (tick) => {
      const lo = Math.floor(tick), hi = Math.min(action.ticks, lo + 1), f = tick - lo
      if (f < 1e-6) return action.frames[lo]!
      return new Map(armature.bones.map((b) => {
        const ta = new Vector3(), qa = new Quaternion(), sa = new Vector3(), tb = new Vector3(), qb = new Quaternion(), sb = new Vector3()
        action.frames[lo]!.get(b.name)!.decompose(ta, qa, sa); action.frames[hi]!.get(b.name)!.decompose(tb, qb, sb)
        return [b.name, new Matrix4().compose(ta.lerp(tb, f), qa.slerp(qb, f), sa.lerp(sb, f))]
      }))
    })
    const bin = new Uint8Array(offset); let at = 0; for (const c of chunks) { bin.set(c, at); at += c.length }
    json.buffers.push({ byteLength: bin.length })
    return encodeGlb(json, bin)
  }

  return { text, dir, boneCount: armature.bones.length, builtInActions: [...actions.keys()], wingAction: wingAction?.name ?? null,
    hasWings: armature.bones.some((b) => isWing(b.name)), groundUnits: ground, metresPerUnit: scale, convertNormalized, appendBobj, roundTripError, buildGlb }
}
export type VerityModel = ReturnType<typeof loadVerityModel>
