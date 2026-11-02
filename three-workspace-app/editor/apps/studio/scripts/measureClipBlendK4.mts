/**
 * K4 measurement (docs/CLIP-BLEND-TASK-2026-11-02.md section 8, "Film = App 2") on a COPY of the Go Xua project.
 *
 *   BBS_UNIFIED_PROJECTS_DIR=S:\Claude\w01-samples\clip-blend-k2-projects \
 *   pnpm --filter @topview/3d-builder exec tsx <abs>/apps/studio/scripts/measureClipBlendK4.mts [--out report.json] [--no-blend-hash]
 *
 * Reads project.json directly (never writes). Runs sampleProjectFilm -> buildFilmExportManifest (the typed data the
 * .dat worker encodes: actor transformSamples + bone poseTracks) with a synthetic same-rig BOBJ profile (no Blender),
 * decodes the pose tracks back to actor-space bone poses and compares them per bone per tick with an independent
 * App 2 sampler pass (sampleProjectSkeletonRange from a different start frame).
 */
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { Euler, Matrix4, Quaternion, Vector3 } from 'three'
import type { UnifiedProject } from '@bbs/animation-workspace-shared'

const { values } = parseArgs({ options: { project: { type: 'string' }, out: { type: 'string' }, dir: { type: 'string' }, 'no-blend-hash': { type: 'boolean' }, start: { type: 'string' }, end: { type: 'string' } } })
const projectId = values.project ?? 'e901aadb-453f-4f69-b6f7-8eceda1f41f3'
const dir = values.dir ?? process.env.BBS_UNIFIED_PROJECTS_DIR
if (!dir) throw new TypeError('Set BBS_UNIFIED_PROJECTS_DIR to a COPY of the projects folder')
process.env.BBS_UNIFIED_PROJECTS_DIR = dir
const { sampleProjectFilm, turnFilmSkeletonsByRotationKeys, projectEvaluationScene: _unused } = await import('../src/unifiedFilmSampling.ts') as any
void _unused
const { projectEvaluationScene, sampleProjectSkeletonRange } = await import('../src/unifiedSkeletonEvaluation.ts')
const { buildFilmExportManifest } = await import('../src/filmManifest.ts')
const { stageOriginalLibraryBobjProfile } = await import('../src/unifiedJobs.ts')
const { bobjModelNodeName } = await import('../../../packages/retarget/src/bobjModel.ts')
const tmpRoot = mkdtempSync(path.join(tmpdir(), 'k4-measure-'))

const project = JSON.parse(readFileSync(path.join(dir, projectId, 'project.json'), 'utf8')) as UnifiedProject
const nodeId = 'user_chr_tazf97vk'
const character = Object.values(project.characters).find((c) => c.nodeId === nodeId)!
const clipB = 'user_mc_osedj00q'
const fps = project.scene.content.timeline.fps
const rangeStart = Number(values.start ?? 0), rangeEnd = Number(values.end ?? 149)

function profileFor(model: any) {
  const unit = new Matrix4().makeScale(model.metersPerUnit, model.metersPerUnit, model.metersPerUnit)
  const b = model.basisToScene as number[]
  const basis = new Matrix4().set(b[0], b[1], b[2], 0, b[3], b[4], b[5], 0, b[6], b[7], b[8], 0, 0, 0, 0, 1)
  const world = new Map<string, Matrix4>()
  const nameById = new Map<string, string>(model.sourceBones.map((x: any) => [x.id, x.name]))
  for (const bone of model.sourceBones) {
    const r = bone.rest
    const local = new Matrix4().compose(new Vector3(...r.position), new Quaternion(...r.rotation), new Vector3(...r.scale))
    world.set(bone.name, bone.parentId ? world.get(nameById.get(bone.parentId)!)!.clone().multiply(local) : local)
  }
  const rowMajor = (m: Matrix4) => Array.from({ length: 16 }, (_, i) => m.elements[(i % 4) * 4 + Math.floor(i / 4)]!)
  return { schemaVersion: 1 as const, sourceSha256: model.source.sha256, modelId: 'unified/k4', metersPerUnit: model.metersPerUnit,
    bones: model.sourceBones.map((x: any) => ({ name: x.name, parent: x.parentId ? nameById.get(x.parentId)! : null,
      bobjRestMatrixRowMajor: rowMajor(basis.clone().multiply(unit).multiply(world.get(x.name)!)) })),
    actions: [], textureRequired: false, files: [{ sourcePath: 'C:\\k4\\model.bobj', targetPath: 'model.bobj', sha256: 'a'.repeat(64) }] }
}

let stageCounter = 0
async function film(p: UnifiedProject, range: { startFrame: number; endFrame: number }) {
  const input = await sampleProjectFilm(p, { characterIds: [character.id], sequenceId: 'tap15', range, viewportAspect: 16 / 9 })
  // Gỗ Xưa is a library Verity character: the real export bakes it through the original BOBJ profile (read-only library access).
  const staged = await stageOriginalLibraryBobjProfile(p, input.models[0], path.join(tmpRoot, `stage-${stageCounter++}`))
  const profile: any = staged ?? profileFor(input.models[0])
  const manifest = buildFilmExportManifest(input, new Map([[character.id, profile]]), 'k4-measure')
  return { input, profile, manifest, actor: manifest.actors[0]!, original: !!staged }
}
const sha = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex')

const result: Record<string, unknown> = {}
const noBlend = structuredClone(project)
noBlend.scene.content.timeline.animation.motionClips = noBlend.scene.content.timeline.animation.motionClips.map((c) => {
  if (c.id === clipB) { delete (c.playback as any).blendIn; c.frameStart = 59; c.frameEnd = 149 }
  return c
})
const noBlendFilm = await film(noBlend, { startFrame: rangeStart, endFrame: rangeEnd })
result.noBlendFilmHash = sha({ t: noBlendFilm.actor.transformSamples, p: noBlendFilm.actor.poseTracks })
if (values['no-blend-hash']) { console.log(JSON.stringify(result, null, 2)); if (values.out) writeFileSync(values.out, JSON.stringify(result, null, 2)); process.exit(0) }

const blended = structuredClone(project)
const B = blended.scene.content.timeline.animation.motionClips.find((c) => c.id === clipB)!
const zoneStart = B.frameStart, zoneEnd = B.frameStart + B.playback.blendIn!.frames - 1
const full = await film(blended, { startFrame: rangeStart, endFrame: rangeEnd })
result.blendZones = (full.input as any).blendZones?.map((z: any) => z.text)
result.blendFilmHash = sha({ t: full.actor.transformSamples, p: full.actor.poseTracks })

// Independent App 2 sampler pass: different start frame (grid start offset), same 20 Hz frames.
const refStart = rangeStart + 3
const scene = projectEvaluationScene(blended)
const ref = new Map<number, any>()
for await (const sample of sampleProjectSkeletonRange(blended, { startFrame: refStart, endFrame: rangeEnd, sampleFps: 20 }, [character.id])) {
  turnFilmSkeletonsByRotationKeys(scene, sample)
  ref.set(Math.round(sample.frame * 100), sample.skeletonSamples[0])
}

// Decode the .dat pose tracks: local = restLocal * delta, FK to actor space. The original-rig bake maps sampler worlds
// through one constant wrapper matrix W (unit scale / floor); calibrate W on the root at the first compared tick, then
// every other bone and tick must agree with W * (actor inverse * sampler bone world).
const bones = full.profile.bones
const sampleName = (name: string) => full.original ? bobjModelNodeName(name) : name
const restWorld = new Map<string, Matrix4>(), restLocal = new Map<string, Matrix4>()
for (const bone of bones) {
  const w = new Matrix4().fromArray(bone.bobjRestMatrixRowMajor).transpose()
  restWorld.set(bone.name, w)
  restLocal.set(bone.name, bone.parent ? restWorld.get(bone.parent)!.clone().invert().multiply(w) : w)
}
const tracks = new Map(full.actor.poseTracks.map((t: any) => [t.boneName, t.keyframes]))
const trackedBones = bones.filter((bone: any) => tracks.has(bone.name))
const angleDeg = (a: Quaternion, b: Quaternion) => 2 * Math.acos(Math.min(1, Math.abs(a.dot(b)))) * 180 / Math.PI
const decodeTick = (poseTracks: Map<string, any>, tick: number) => {
  const decoded = new Map<string, Matrix4>()
  for (const bone of bones) {
    const k = poseTracks.get(bone.name)?.[tick]
    const delta = k ? new Matrix4().compose(new Vector3(...k.t), new Quaternion().setFromEuler(new Euler(k.r[0], k.r[1], k.r[2], 'ZYX')), new Vector3(...k.s)) : new Matrix4()
    const local = restLocal.get(bone.name)!.clone().multiply(delta)
    decoded.set(bone.name, bone.parent ? decoded.get(bone.parent)!.clone().multiply(local) : local)
  }
  return decoded
}
const rootBone = bones.find((bone: any) => bone.parent === null)!
let W: Matrix4 | null = null
let unitMm = 1000
let worst = { posMm: 0, rotDeg: 0, tick: -1, bone: '' }, zoneWorst = { posMm: 0, rotDeg: 0, tick: -1, bone: '' }
let actorWorstMm = 0, actorWorstYawDeg = 0, compared = 0
const zoneTicks: number[] = []
for (const [tick, frame] of full.input.frames.entries()) {
  const key = Math.round(frame.sourceFrame * 100)
  const sample = ref.get(key)
  if (!sample) continue
  const inZone = frame.sourceFrame >= zoneStart - 1e-9 && frame.sourceFrame <= zoneEnd + 1e-9
  if (inZone) zoneTicks.push(tick)
  const actorInverse = new Matrix4().fromArray(sample.actorWorldMatrix).invert()
  const decoded = decodeTick(tracks, tick)
  const expectedOf = (name: string) => actorInverse.clone().multiply(new Matrix4().fromArray(sample.bones.find((b: any) => b.name === sampleName(name)).worldMatrix))
  if (!W) {
    W = decoded.get(rootBone.name)!.clone().multiply(expectedOf(rootBone.name).invert())
    const s = new Vector3(); W.decompose(new Vector3(), new Quaternion(), s)
    unitMm = 1000 / s.x
    result.wrapperScale = s.x
  }
  for (const bone of trackedBones) {
    if (bone.name === 'Jaw') continue
    const expected = W.clone().multiply(expectedOf(bone.name))
    const p1 = new Vector3(), q1 = new Quaternion(), s1 = new Vector3(), p2 = new Vector3(), q2 = new Quaternion(), s2 = new Vector3()
    decoded.get(bone.name)!.decompose(p1, q1, s1); expected.decompose(p2, q2, s2)
    const posMm = p1.distanceTo(p2) * unitMm, rotDeg = angleDeg(q1, q2)
    if (posMm > worst.posMm) { worst.posMm = posMm; worst.tick = tick; worst.bone = bone.name }
    worst.rotDeg = Math.max(worst.rotDeg, rotDeg)
    if (inZone) { zoneWorst.posMm = Math.max(zoneWorst.posMm, posMm); zoneWorst.rotDeg = Math.max(zoneWorst.rotDeg, rotDeg); zoneWorst.tick = tick; zoneWorst.bone = bone.name }
  }
  const t = full.actor.transformSamples[tick]!
  const m = new Matrix4().fromArray(sample.actorWorldMatrix)
  const pos = new Vector3().setFromMatrixPosition(m)
  const scale = (full.input.models[0] as any).actorScale ?? 1
  actorWorstMm = Math.max(actorWorstMm, Math.hypot(pos.x - t.x, pos.y - t.y, pos.z - t.z) * 1000)
  const rq = new Quaternion(); m.decompose(new Vector3(), rq, new Vector3())
  const forward = new Vector3(0, 0, 1).applyQuaternion(rq)
  const yaw = Math.atan2(-forward.x, forward.z) * 180 / Math.PI + 180 + (full.original ? 180 : 0)
  actorWorstYawDeg = Math.max(actorWorstYawDeg, Math.abs(((yaw - t.yaw) % 360 + 540) % 360 - 180))
  void scale
  compared++
}
result.filmVsApp2 = {
  rule: '.dat pose tracks (decoded, actor space) vs App 2 sampler, per bone per tick: <= 0.5 deg and <= 2 mm; actor x/y/z/yaw replay keys vs sampler actor matrix',
  range: [rangeStart, rangeEnd], zone: [zoneStart, zoneEnd], ticksCompared: compared, zoneTicks: zoneTicks.length, bones: bones.length,
  trackedBones: trackedBones.length, originalRigProfile: full.original, allTicksWorst: worst, zoneWorst, actorWorstMm, actorWorstYawDeg,
  pass: worst.posMm <= 2 && worst.rotDeg <= 0.5 && actorWorstMm <= 2 && actorWorstYawDeg <= 0.5,
}
// State independence: a shorter film that starts inside the zone must bake the same ticks.
const short = await film(blended, { startFrame: 42, endFrame: 77 })
let shortWorst = 0
for (let i = 0; i < short.input.frames.length; i++) {
  const f = short.input.frames[i]!.sourceFrame
  const j = full.input.frames.findIndex((x) => Math.abs(x.sourceFrame - f) < 1e-9)
  for (const bone of trackedBones) {
    const a = (tracks.get(bone.name) as any[] | undefined)?.[j], b = (short.actor.poseTracks.find((t: any) => t.boneName === bone.name)?.keyframes as any[] | undefined)?.[i]
    if (!a || !b) continue
    for (let c = 0; c < 3; c++) shortWorst = Math.max(shortWorst, Math.abs(a.t[c] - b.t[c]) * 1000, Math.abs(a.r[c] - b.r[c]) * 180 / Math.PI)
  }
  const ta = full.actor.transformSamples[j]!, tb = short.actor.transformSamples[i]!
  shortWorst = Math.max(shortWorst, Math.hypot(ta.x - tb.x, ta.y - tb.y, ta.z - tb.z) * 1000)
}
result.startIndependence = { shortRange: [42, 77], worstDiff: shortWorst, unit: 'mm or deg', pass: shortWorst < 1e-6 }
// Actor replay continuity across the zone (K2 alignment is in the transform): largest per-tick step.
const steps = full.actor.transformSamples.slice(1).map((t: any, i: number) => ({ tick: i + 1, cm: Math.hypot(t.x - full.actor.transformSamples[i]!.x, t.z - full.actor.transformSamples[i]!.z) * 100 }))
result.actorStepCm = { max: Math.max(...steps.map((s: any) => s.cm)), maxInZone: Math.max(...steps.filter((s: any) => zoneTicks.includes(s.tick)).map((s: any) => s.cm)) }
console.log(JSON.stringify(result, null, 2))
if (values.out) writeFileSync(values.out, JSON.stringify(result, null, 2))
