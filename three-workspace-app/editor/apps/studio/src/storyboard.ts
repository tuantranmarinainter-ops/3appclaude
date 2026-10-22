import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { makeEmptyDraft } from '@topview/3d-builder'
import { FCurveSet } from '@topview/3d-builder/evaluate'
import { stageAssetUpload } from './unifiedAssetFiles'
import { executeUnifiedCommand, readUnifiedProject } from './unifiedProjectStore'

/**
 * B14 "Kịch bản → cảnh": build a whole App 2 project from one self-contained storyboard file (format:
 * docs/STORYBOARD-FORMAT.md). Each shot gets its own area along +X, its own Character instances, timed Actions,
 * position/turn keys, a camera aimed by target/azimuth/elevation/distance with an optional library camera move, an
 * optional backdrop prop and VFX cues; the shots become one editorial sequence. Every step goes through the normal
 * unified commands, so the result is an ordinary, editable, undoable project.
 */

type V3 = [number, number, number]
export interface StoryboardActor { who: string; at: V3; yaw?: number; acts: Array<[string, number, number]>; moves?: Array<[number, number, number, number, number?]> }
export interface StoryboardShot {
  id: string
  sec: number
  set?: string
  camera: { target: V3; az: number; el: number; dist: number; fov?: number; motion?: { presetId: string; config?: Record<string, number> } }
  actors: StoryboardActor[]
  fx?: Array<{ effect: string; at: V3; yaw?: number; scale?: number; t0: number; t1: number }>
  lines?: Array<[string, string, number]>
}
export interface Storyboard {
  version: 'storyboard.v1'
  name: string
  fps?: number
  area?: number
  sequenceId?: string
  skyColor?: string
  /** `manifest`: App 1 manifest, imported with the GLB and naming its Actions; `names`: explicit names in clip order. */
  actionSets: Record<string, { glb: string; manifest?: string; names?: string[] }>
  cast: Record<string, { model: string; actions: string }>
  sets?: Record<string, string>
  shots: StoryboardShot[]
}

export interface StoryboardIssue { path: string; message: string }
export class StoryboardError extends Error {
  constructor(readonly issues: StoryboardIssue[]) { super(issues.map((item) => `${item.path}: ${item.message}`).join('; ')) }
}

const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const vec = (value: unknown): value is V3 => Array.isArray(value) && value.length === 3 && value.every(finite)

/** Structural validation; names of Actions are checked later against the imported action sets. */
export function validateStoryboard(value: unknown): Storyboard {
  const issues: StoryboardIssue[] = []
  const add = (at: string, message: string) => { issues.push({ path: at, message }) }
  const sb = value as Storyboard
  if (!sb || typeof sb !== 'object' || sb.version !== 'storyboard.v1') throw new StoryboardError([{ path: 'version', message: 'must be "storyboard.v1"' }])
  if (typeof sb.name !== 'string' || !sb.name.trim() || sb.name.length > 120) add('name', 'must be 1-120 characters')
  if (sb.fps !== undefined && (!Number.isInteger(sb.fps) || sb.fps < 1 || sb.fps > 120)) add('fps', 'must be an integer 1-120')
  if (sb.area !== undefined && (!finite(sb.area) || sb.area < 5)) add('area', 'must be at least 5 metres')
  if (sb.sequenceId !== undefined && (typeof sb.sequenceId !== 'string' || !ID.test(sb.sequenceId))) add('sequenceId', 'must be a safe id')
  const sets = sb.actionSets && typeof sb.actionSets === 'object' ? sb.actionSets : (add('actionSets', 'is required'), {})
  for (const [key, set] of Object.entries(sets)) {
    if (!ID.test(key)) add(`actionSets.${key}`, 'key must be a safe id')
    if (typeof set?.glb !== 'string' || !set.glb) add(`actionSets.${key}.glb`, 'must be a GLB path')
    if (set?.manifest !== undefined && typeof set.manifest !== 'string') add(`actionSets.${key}.manifest`, 'must be a path')
    if (set?.names !== undefined && (!Array.isArray(set.names) || !set.names.every((name) => typeof name === 'string'))) add(`actionSets.${key}.names`, 'must be a list of Action names')
  }
  const cast = sb.cast && typeof sb.cast === 'object' ? sb.cast : (add('cast', 'is required'), {})
  for (const [who, member] of Object.entries(cast)) {
    if (!ID.test(who)) add(`cast.${who}`, 'key must be a safe id')
    if (typeof member?.model !== 'string' || !member.model) add(`cast.${who}.model`, 'must be a GLB path')
    if (typeof member?.actions !== 'string' || !(member.actions in sets)) add(`cast.${who}.actions`, 'must name an actionSets entry')
  }
  for (const [key, file] of Object.entries(sb.sets ?? {})) if (!ID.test(key) || typeof file !== 'string' || !file) add(`sets.${key}`, 'must map a safe id to a GLB path')
  if (!Array.isArray(sb.shots) || !sb.shots.length || sb.shots.length > 500) add('shots', 'must contain 1-500 shots')
  const shotIds = new Set<string>()
  for (const [index, shot] of (Array.isArray(sb.shots) ? sb.shots : []).entries()) {
    const at = `shots[${index}]`
    if (typeof shot?.id !== 'string' || !ID.test(shot.id) || shotIds.has(shot.id)) add(`${at}.id`, 'must be a unique safe id')
    shotIds.add(shot?.id)
    if (!finite(shot?.sec) || shot.sec <= 0 || shot.sec > 60) add(`${at}.sec`, 'must be 0-60 seconds')
    if (shot?.set !== undefined && !(sb.sets && shot.set in sb.sets)) add(`${at}.set`, 'must name a sets entry')
    const camera = shot?.camera
    if (!camera || !vec(camera.target) || !finite(camera.az) || !finite(camera.el) || !finite(camera.dist) || camera.dist <= 0 ||
        (camera.fov !== undefined && (!finite(camera.fov) || camera.fov < 5 || camera.fov > 120))) add(`${at}.camera`, 'needs target [x,y,z], az, el, dist > 0 and optional fov 5-120')
    if (camera?.motion !== undefined && (typeof camera.motion.presetId !== 'string' || !camera.motion.presetId)) add(`${at}.camera.motion.presetId`, 'is required')
    for (const [k, actor] of (Array.isArray(shot?.actors) ? shot.actors : (add(`${at}.actors`, 'must be an array'), [])).entries()) {
      const where = `${at}.actors[${k}]`
      if (!(actor?.who in cast)) add(`${where}.who`, 'must name a cast member')
      if (!vec(actor?.at)) add(`${where}.at`, 'must be [x, y, z]')
      if (actor?.yaw !== undefined && !finite(actor.yaw)) add(`${where}.yaw`, 'must be a number')
      for (const [j, act] of (Array.isArray(actor?.acts) ? actor.acts : (add(`${where}.acts`, 'must be an array'), [])).entries()) {
        if (!Array.isArray(act) || typeof act[0] !== 'string' || !finite(act[1]) || !finite(act[2]) || act[1] < 0 || act[2] <= act[1] || act[2] > shot.sec + 1e-6) add(`${where}.acts[${j}]`, 'must be [action, t0, t1] inside the shot')
      }
      for (const [j, move] of (actor?.moves ?? []).entries()) {
        if (!Array.isArray(move) || move.length < 4 || move.length > 5 || !move.every(finite) || move[0] < 0 || move[0] > shot.sec + 1e-6) add(`${where}.moves[${j}]`, 'must be [t, x, y, z, yaw?] inside the shot')
      }
    }
    for (const [k, fx] of (shot?.fx ?? []).entries()) {
      if (typeof fx?.effect !== 'string' || !vec(fx.at) || !finite(fx.t0) || !finite(fx.t1) || fx.t1 <= fx.t0) add(`${at}.fx[${k}]`, 'needs effect, at [x,y,z] and t0 < t1')
    }
    for (const [k, line] of (shot?.lines ?? []).entries()) {
      if (!Array.isArray(line) || typeof line[0] !== 'string' || typeof line[1] !== 'string' || !finite(line[2])) add(`${at}.lines[${k}]`, 'must be [speaker, text, t]')
    }
  }
  if (issues.length) throw new StoryboardError(issues)
  return sb
}

/** Action names of a GLB in clip order: the App 1 manifest when given, else the GLB's own animation names. */
export async function actionNames(glb: string, manifest?: string): Promise<string[]> {
  if (manifest) return (JSON.parse(await readFile(manifest, 'utf8')) as { actions: Array<{ name: string }> }).actions.map((action) => action.name)
  const bytes = await readFile(glb)
  if (bytes.readUInt32LE(0) !== 0x46546c67) throw new TypeError(`${glb} is not a binary glTF`)
  const length = bytes.readUInt32LE(12)
  const json = JSON.parse(bytes.subarray(20, 20 + length).toString('utf8')) as { animations?: Array<{ name?: string }> }
  return (json.animations ?? []).map((animation, index) => animation.name ?? `Action${index}`)
}

/** Camera position for a shot aimed at `target` from azimuth/elevation (degrees) and distance, never below 0.3 m. */
export function shotCameraPosition(target: { x: number; y: number; z: number }, az: number, el: number, dist: number) {
  const a = az * Math.PI / 180, e = el * Math.PI / 180
  return { x: target.x + Math.sin(a) * Math.cos(e) * dist, y: Math.max(0.3, target.y + Math.sin(e) * dist), z: target.z + Math.cos(a) * Math.cos(e) * dist }
}

export interface StoryboardBuildResult {
  projectId: string
  revision: number
  sequenceId: string
  shots: Array<{ shotId: string; start: number; end: number; ox: number; cameraId: string; characterIds: string[]; lines: Array<[string, string, number]> }>
}

/** Build a new project from a storyboard. Relative paths resolve against `baseDir` (the storyboard file's folder). */
export async function buildStoryboard(raw: unknown, baseDir: string): Promise<StoryboardBuildResult> {
  const sb = validateStoryboard(raw)
  const file = (value: string) => path.resolve(baseDir, value)
  const fps = sb.fps ?? 30, area = sb.area ?? 40, sequenceId = sb.sequenceId ?? 'storyboard'
  const total = sb.shots.reduce((sum, shot) => sum + Math.round(shot.sec * fps), 0)
  // Names first, so a missing Action fails before anything is written.
  const namesBySet = new Map<string, string[]>()
  for (const [key, set] of Object.entries(sb.actionSets)) namesBySet.set(key, set.names ?? await actionNames(file(set.glb), set.manifest && file(set.manifest)))
  const issues: StoryboardIssue[] = []
  for (const [index, shot] of sb.shots.entries()) for (const [k, actor] of shot.actors.entries()) for (const [j, act] of actor.acts.entries()) {
    if (!namesBySet.get(sb.cast[actor.who]!.actions)!.includes(act[0])) issues.push({ path: `shots[${index}].actors[${k}].acts[${j}]`, message: `unknown action ${act[0]} for ${actor.who}` })
  }
  if (issues.length) throw new StoryboardError(issues)

  const scene = makeEmptyDraft(sb.name, fps, total + fps * 2, { fov: 45, position: { x: 0, y: 1.5, z: 6 }, rotation: { x: 0, y: 0, z: 0 }, lookAt: { x: 0, y: 1, z: 0 } })
  const projectId = (await executeUnifiedCommand({ requestId: randomUUID(), command: 'project.create', args: { name: sb.name, scene } }) as { projectId: string }).projectId
  let revision = 0
  const run = async (command: string, args: Record<string, unknown>) => {
    const response = await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: revision, command, args }) as { revision: number; result: Record<string, unknown> }
    revision = response.revision
    return response.result
  }
  const importGlb = async (glb: string, manifest?: string) => {
    const upload = await stageAssetUpload(path.basename(glb), new ReadableStream({ async start(controller) { controller.enqueue(await readFile(glb)); controller.close() } }))
    return run('asset.import', { files: [upload.id], format: 'glb', ...(manifest ? { manifest: JSON.parse(await readFile(manifest, 'utf8')) } : {}) })
  }
  const motionsBySet = new Map<string, string[]>()
  for (const [key, set] of Object.entries(sb.actionSets)) motionsBySet.set(key, (await importGlb(file(set.glb), set.manifest && file(set.manifest))).motionIds as string[])
  const models = new Map<string, { assetIds: string[]; skeletonIds: string[] }>()
  for (const [who, member] of Object.entries(sb.cast)) models.set(who, await importGlb(file(member.model)) as { assetIds: string[]; skeletonIds: string[] })
  const setAssets = new Map<string, string>()
  for (const [key, glb] of Object.entries(sb.sets ?? {})) setAssets.set(key, ((await importGlb(file(glb))).assetIds as string[])[0]!)

  const curves = FCurveSet.empty()
  const shots: StoryboardBuildResult['shots'] = []
  const cameraMoves: Array<{ cameraId: string; frameStart: number; durationFrames: number; motion: NonNullable<StoryboardShot['camera']['motion']> }> = []
  let start = 0
  for (const [k, shot] of sb.shots.entries()) {
    const frames = Math.round(shot.sec * fps), end = start + frames - 1, ox = k * area
    const characterIds: string[] = []
    for (const actor of shot.actors) {
      const model = models.get(actor.who)!
      const added = await run('character.add', { assetId: model.assetIds[0], skeletonId: model.skeletonIds[0], name: `${actor.who} ${shot.id}`,
        transform: { position: { x: ox + actor.at[0], y: actor.at[1], z: actor.at[2] }, rotation: { x: 0, y: actor.yaw ?? 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } } }) as { characterId: string; nodeId: string }
      characterIds.push(added.characterId)
      const set = sb.cast[actor.who]!.actions
      const project = await readUnifiedProject(projectId)
      for (const [action, t0, t1] of actor.acts) {
        const motionId = motionsBySet.get(set)![namesBySet.get(set)!.indexOf(action)]!
        const clip = project.motions[motionId]!.durationSeconds
        for (let t = t0; t < t1 - 1e-6; t += clip) {
          await run('motion.place', { characterId: added.characterId, motionId, frameStart: start + Math.round(t * fps), sourceStartSeconds: 0, sourceLengthSeconds: Math.max(0.05, Math.min(clip, t1 - t)) })
        }
      }
      const moves = actor.moves ?? []
      for (const [t, x, y, z, yaw] of moves) {
        const frame = start + Math.round(t * fps)
        curves.upsertKey(added.nodeId, 'transform.position', 0, frame, ox + x)
        curves.upsertKey(added.nodeId, 'transform.position', 1, frame, y)
        curves.upsertKey(added.nodeId, 'transform.position', 2, frame, z)
        if (yaw !== undefined) curves.upsertKey(added.nodeId, 'transform.rotation', 1, frame, yaw)
      }
      if (moves.some((move) => move[4] !== undefined)) {
        // Rotation tracks need all three axes keyed; keep x/z at zero across the shot.
        for (const [t] of moves) for (const axis of [0, 2]) curves.upsertKey(added.nodeId, 'transform.rotation', axis, start + Math.round(t * fps), 0)
      }
    }
    if (shot.set) await run('prop.add', { assetId: setAssets.get(shot.set), name: `set_${shot.id}`, transform: { position: { x: ox, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } } })
    const cameraId = k === 0 ? 'camera_1' : `cam_${shot.id}`
    if (shot.camera.motion) cameraMoves.push({ cameraId, frameStart: start, durationFrames: frames, motion: shot.camera.motion })
    shots.push({ shotId: shot.id, start, end, ox, cameraId, characterIds, lines: shot.lines ?? [] })
    start = end + 1
  }

  const project = await readUnifiedProject(projectId), doc = structuredClone(project.scene)
  const base = doc.content.nodes.find((node) => node.id === 'camera_1')!
  for (const [k, shot] of sb.shots.entries()) {
    const node = k === 0 ? base : structuredClone(base)
    node.id = shots[k]!.cameraId; node.name = `Shot ${shot.id}`; node.camera!.isPrimary = k === 0
    const target = { x: shots[k]!.ox + shot.camera.target[0], y: shot.camera.target[1], z: shot.camera.target[2] }
    node.transform.position = shotCameraPosition(target, shot.camera.az, shot.camera.el, shot.camera.dist)
    node.camera!.lookAt = target; node.camera!.fov = shot.camera.fov ?? 50
    if (k > 0) doc.content.nodes.push(node)
  }
  doc.content.editorial = { version: 1, activeSequenceId: sequenceId, sequences: [{ id: sequenceId, clips: shots.map((shot) => ({ id: `shot_${shot.shotId}`, cameraNodeId: shot.cameraId, sourceFrameStart: shot.start, sourceFrameEnd: shot.end })) }] }
  if (sb.skyColor) doc.content.environment.background = { mode: 'color', skyColor: sb.skyColor }
  const fcurves = FCurveSet.persist(curves, FCurveSet.parseUserKeys(project.extensions.topview?.fcurves ?? null))
  await run('scene.apply', { operations: [{ type: 'document.replace', document: doc, fcurves }] })
  for (const move of cameraMoves) {
    await run('camera.motion.add', { cameraNodeId: move.cameraId, presetId: move.motion.presetId, frameStart: move.frameStart, durationFrames: move.durationFrames, ...(move.motion.config ? { config: move.motion.config } : {}) })
  }
  for (const [k, shot] of sb.shots.entries()) for (const fx of shot.fx ?? []) {
    const { start: shotStart, end: shotEnd, ox } = shots[k]!
    await run('vfx.cue.add', { cue: { effect: fx.effect, frameStart: shotStart + Math.round(fx.t0 * fps), frameEnd: Math.min(shotEnd, shotStart + Math.round(fx.t1 * fps) - 1),
      position: { x: ox + fx.at[0], y: fx.at[1], z: fx.at[2] }, yaw: fx.yaw ?? 0, scale: fx.scale ?? 1 } })
  }
  return { projectId, revision, sequenceId, shots }
}
