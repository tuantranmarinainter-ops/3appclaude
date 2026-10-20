import { createHash } from 'node:crypto'
import { AnimationClip, Matrix4, PropertyBinding, type Bone, type Object3D, type SkinnedMesh } from 'three'
import { MIXAMO65_BONE_PARENTS } from '../src/mixamo65.ts'
import { normalizeAnimation } from '../src/normalizeAnimation.ts'
import { createThreeRigAdapter } from '../src/threeRigAdapter.ts'
import { buildAutoMapping, buildPresetMapping, canonical, type AutoMapping } from './autoMapping.ts'
import { buildCalibration, type CalibrationMode } from './calibration.ts'
import { loadAsset } from './loadAsset.ts'
import { renderContactSheet, type PreviewFrame } from './previewPng.ts'

export const CONTRACT_VERSION = '1.0.0'
export const CONTRACT_FPS = 30
const PREVIEW_FRAMES = 8
/** float32 round-off on a unit quaternion stays below ~1e-7; anything larger is a real non-unit key. */
const QUATERNION_EPSILON = 1e-6

export type GateStatus = 'NOT_RUN' | 'BLOCKED' | 'FAIL' | 'PASS'
export interface NormalizeRequest {
  source: Object3D; sourceLabel: string; sourceSha256: string
  target: Object3D; targetLabel: string; targetSha256: string
  actionIndex?: number
  /** Source units → meters (glTF 1, FBX usually 0.01). */
  unitMeters?: number
  upAxis?: 'y' | 'z'
  rootPolicy?: 'preserve' | 'in-place'
  rootScale?: number
  mappingPreset?: unknown
  /** A/T calibration of limb directions against the target rest (default 'limbs'). */
  calibrate?: CalibrationMode
  /** Source→target facing yaw override in degrees (default: measured, quarter turns only). */
  facingDegrees?: number
  preview?: boolean
}

const sha256 = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex')
/** Node names as written in the GLB JSON chunk; GLTFLoader sanitizes names (drops ':') so a reload cannot see the prefix. */
function glbNodeNames(glb: Uint8Array): string[] {
  const length = new DataView(glb.buffer, glb.byteOffset).getUint32(12, true)
  return (JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + length))).nodes ?? []).map((node: { name?: string }) => node.name ?? '')
}
const mixamoName = (name: string) => MIXAMO65_BONE_PARENTS.find(([joint]) => canonical(joint) === canonical(name))?.[0]

/** Deterministic UUID (RFC 9562 v8 layout) so re-running the same source keeps Action identity stable. */
export function actionUuid(sourceSha256: string, actionIndex: number, actionName: string): string {
  const hex = sha256(`w01-action:${sourceSha256}:${actionIndex}:${actionName}`)
  const variant = ((parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16)
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

function sourceToScene(unitMeters: number, upAxis: 'y' | 'z'): number[] {
  if (!Number.isFinite(unitMeters) || unitMeters <= 0) throw new RangeError('--unit-meters must be positive')
  const basis = upAxis === 'z' ? new Matrix4().makeRotationX(-Math.PI / 2) : new Matrix4()
  return basis.multiply(new Matrix4().makeScale(unitMeters, unitMeters, unitMeters)).toArray()
}

/**
 * Without a SkinnedMesh the adapter only sees Bone nodes; animated helpers outside `skin.joints` (e.g. Mixamo
 * HandPinky end bones) would then block the Action. Listing Bones ∪ animated nodes keeps them in the rig.
 */
export function sourceJointNames(root: Object3D): string[] | undefined {
  let skinned = false
  const nodes: Object3D[] = []
  root.traverse((node) => { nodes.push(node); if ((node as SkinnedMesh).isSkinnedMesh) skinned = true })
  if (skinned) return undefined
  const animated = new Set(root.animations.flatMap((clip) => clip.tracks.map((track) => PropertyBinding.parseTrackName(track.name).nodeName)))
  const names = nodes.filter((node) => node !== root && node.name && ((node as Bone).isBone || animated.has(node.name))).map((node) => node.name)
  const extra = names.some((name) => !nodes.some((node) => node.name === name && (node as Bone).isBone))
  return extra && new Set(names).size === names.length ? names : undefined
}

/** Source bone names of mapped joints (Mixamo targets) plus every ancestor in the first-pass rig. */
function mappingSourceNames(mapping: AutoMapping, bones: ReadonlyMap<string, { name?: string; parentId: string | null }>) {
  const mapped = new Set<string>(), retained = new Set<string>()
  for (const pair of mapping.pairs) for (const id of pair.sourceBoneIds ?? [pair.sourceBoneId]) {
    mapped.add(bones.get(id)?.name ?? id)
    for (let current: string | null = id; current; current = bones.get(current)?.parentId ?? null) retained.add(bones.get(current)?.name ?? current)
  }
  return { mapped, retained }
}

/**
 * Restricts the source to what the mapping uses. Tracks on other nodes (weapons, FX helpers, meshes) or with
 * non-TRS bindings (morph targets) are removed from `root.animations` — the loss is reported, never silent.
 * Helpers with non-uniform scale (LoL weapon smears) would otherwise shear their children and fail the solver.
 * Animated scale is dropped as well: the Mixamo65 contract carries rotation + translation only, and non-uniform scale
 * (WC3 breathing/twist volume, iClone float32 noise) shears children past the solver guard. DECISIONS: loss is exported
 * and reported, not blocked — the report keeps the largest relative deviation per node.
 * Quaternion keys are normalized: wow.export writes WoW's int16-compressed rotations as-is (|q| ≈ 0.99997), and a
 * non-unit quaternion composes into a sheared matrix. Count and largest |1 − |q|| are reported.
 */
export function pruneToMappedRig(root: Object3D, names: { mapped: ReadonlySet<string>; retained: ReadonlySet<string> }) {
  const nodes: Object3D[] = []
  root.traverse((node) => nodes.push(node))
  const unique = [...names.mapped].every((name) => nodes.filter((node) => node.name === name).length === 1)
  const dropped = new Map<string, number>()
  let count = 0
  const scaleDeviation = new Map<string, number>()
  let droppedScale = 0, normalizedQuaternions = 0, quaternionDeviation = 0
  root.animations = root.animations.map((clip) => {
    const tracks = clip.tracks.filter((track) => {
      const binding = PropertyBinding.parseTrackName(track.name)
      const keep = names.retained.has(binding.nodeName) && !binding.objectName && binding.propertyIndex === undefined &&
        ['position', 'quaternion', 'scale'].includes(binding.propertyName)
      if (!keep) { count++; dropped.set(binding.nodeName, (dropped.get(binding.nodeName) ?? 0) + 1); return false }
      if (binding.propertyName === 'scale') {
        const rest = nodes.find((node) => node.name === binding.nodeName)?.scale.toArray() ?? [1, 1, 1]
        const deviation = Array.from(track.values).reduce((max, value, index) => Math.max(max, Math.abs(value / rest[index % 3]! - 1)), 0)
        if (deviation > 0) { droppedScale++; scaleDeviation.set(binding.nodeName, Math.max(scaleDeviation.get(binding.nodeName) ?? 0, deviation)) }
        return false
      }
      return true
    }).map((track) => {
      if (!track.name.endsWith('.quaternion')) return track
      let deviation = 0
      for (let index = 0; index < track.values.length; index += 4) deviation = Math.max(deviation, Math.abs(1 - Math.hypot(...track.values.subarray(index, index + 4))))
      if (deviation < QUATERNION_EPSILON) return track
      const copy = track.clone()
      for (let index = 0; index < copy.values.length; index += 4) {
        const length = Math.hypot(...copy.values.subarray(index, index + 4))
        for (let axis = 0; axis < 4; axis++) copy.values[index + axis]! /= length
      }
      normalizedQuaternions++; quaternionDeviation = Math.max(quaternionDeviation, deviation)
      return copy
    })
    return new AnimationClip(clip.name, clip.duration, tracks)
  })
  const scaleNodes = [...scaleDeviation].sort((a, b) => b[1] - a[1]).map(([node, maxDeviation]) => ({ node, maxDeviation }))
  return { jointNames: unique ? [...names.mapped] : undefined, report: { count, nodes: [...dropped.keys()] },
    scale: { dropped: droppedScale, maxDeviation: scaleNodes[0]?.maxDeviation ?? 0, nodes: scaleNodes.slice(0, 10) },
    quaternions: { normalized: normalizedQuaternions, maxDeviation: quaternionDeviation } }
}

function blocked(code: string, message: string, extra: Record<string, unknown> = {}) {
  return { status: 'BLOCKED' as const, report: { status: 'BLOCKED' as GateStatus, blocker: { code, message }, ...extra } }
}

export async function runNormalize(request: NormalizeRequest) {
  const started = Date.now()
  const actionIndex = request.actionIndex ?? 0, rootPolicy = request.rootPolicy ?? 'preserve', rootScale = request.rootScale ?? 1
  const basis = sourceToScene(request.unitMeters ?? 1, request.upAxis ?? 'y')
  const jointNames = sourceJointNames(request.source)
  const sourceOptions = { fingerprint: request.sourceSha256, sourceToScene: basis, ...(jointNames ? { jointNames } : {}) }, targetOptions = { fingerprint: request.targetSha256 }
  const input = { source: request.sourceLabel, sourceSha256: request.sourceSha256, target: request.targetLabel, targetSha256: request.targetSha256,
    actionIndex, unitMeters: request.unitMeters ?? 1, upAxis: request.upAxis ?? 'y', rootPolicy, rootScale, fps: CONTRACT_FPS, mapping: request.mappingPreset ? 'preset' : 'auto', calibrate: request.calibrate ?? 'limbs' }

  const src = createThreeRigAdapter(request.source, { ...sourceOptions, collectUnsupportedTracks: true })
  const dst = createThreeRigAdapter(request.target, targetOptions)
  let mapping: AutoMapping & { fingerprintsMatch?: boolean }
  let targetRest: Map<string, number[]>
  let sourceBones: Map<string, { name?: string; parentId: string | null }>
  let sourceHipsHeight: number | null = null
  const actions = src.actions.map((action) => ({ index: action.index, name: action.name, durationSeconds: action.durationSeconds, ready: action.ready, issues: action.issues }))
  try {
    mapping = request.mappingPreset ? buildPresetMapping(request.mappingPreset, src.rig, dst.rig) : buildAutoMapping(src.rig, dst.rig)
    sourceBones = new Map(src.rig.bones.map((bone) => [bone.id, bone]))
    const hipsId = mapping.joints.find((joint) => joint.target === 'Hips')?.sourceId
    sourceHipsHeight = hipsId ? src.rig.bones.find((bone) => bone.id === hipsId)!.restWorld[13]! : null
    targetRest = new Map(dst.rig.bones.flatMap((bone) => { const name = mixamoName(bone.name ?? ''); return name ? [[name, bone.restWorld] as const] : [] }))
  } finally { src.dispose(); dst.dispose() }
  const mappingReport = { family: mapping.family, mapped: mapping.pairs.length, missingRequired: mapping.missingRequired,
    ...(mapping.fingerprintsMatch === undefined ? {} : { presetFingerprintsMatch: mapping.fingerprintsMatch }),
    joints: mapping.joints.map(({ target, source, via, ambiguous }) => ({ target, source, via, ...(ambiguous ? { ambiguous } : {}) })) }

  if (!actions.length) return blocked('NO_ACTION', 'Source has no Action', { input, actions })
  if (mapping.missingRequired.length) return blocked('MISSING_REQUIRED_JOINTS', `Missing main joints: ${mapping.missingRequired.join(', ')}`, { input, actions, mapping: mappingReport })

  // Second pass: rig = mapped bones (+ ancestors, kept by the adapter); other channels are dropped and reported.
  const prune = pruneToMappedRig(request.source, mappingSourceNames(mapping, sourceBones))
  const ranked = createThreeRigAdapter(request.source, { ...sourceOptions, ...(prune.jointNames ? { jointNames: prune.jointNames } : {}), collectUnsupportedTracks: true })
  const prunedActions = ranked.actions.map((item) => ({ index: item.index, name: item.name, durationSeconds: item.durationSeconds, ready: item.ready, issues: item.issues }))
  ranked.dispose()
  const action = prunedActions[actionIndex]
  if (!action) return blocked('NO_ACTION', `Action ${actionIndex} does not exist (source has ${actions.length})`, { input, actions })
  if (!(action.durationSeconds > 0)) return blocked('ACTION_EMPTY', `Action ${action.name} has no duration (single-pose export?)`, { input, actions: prunedActions })
  if (!action.ready) return blocked('ACTION_UNSUPPORTED', `Action ${action.name} has unsupported channels`, { input, actions: prunedActions, prunedTracks: prune.report })
  if (prune.jointNames) Object.assign(sourceOptions, { jointNames: prune.jointNames })

  // Calibration must cover the exact rigs normalizeAnimation builds, so it is computed from adapters with the same options.
  let calibration: ReturnType<typeof buildCalibration>
  const finalSource = createThreeRigAdapter(request.source, sourceOptions), finalTarget = createThreeRigAdapter(request.target, targetOptions)
  try { calibration = buildCalibration(finalSource.rig, finalTarget.rig, mapping.joints, input.calibrate, request.facingDegrees) } finally { finalSource.dispose(); finalTarget.dispose() }
  const normalized = await normalizeAnimation({ source: request.source, target: request.target, sourceOptions, targetOptions, pairs: mapping.pairs,
    actionIndex, fps: CONTRACT_FPS, rootTranslationPolicy: rootPolicy, rootTranslationScale: rootScale, requiredTargetJointIds: mapping.requiredTargetIds,
    calibration: calibration.runtime })
  const glb = normalized.bytes, glbSha256 = sha256(glb)

  // Roundtrip: reload the written bytes with GLTFLoader and sample them, instead of trusting in-memory frames.
  const reloaded = createThreeRigAdapter(await loadAsset(glb, 'glb'), { fingerprint: glbSha256 })
  let roundtrip, previewFrames: PreviewFrame[] = []
  try {
    const clip = reloaded.actions[0]!
    const names = new Map(reloaded.rig.bones.flatMap((bone) => { const name = mixamoName(bone.name ?? ''); return name ? [[bone.id, name] as const] : [] }))
    const sampleAt = (time: number) => new Map(reloaded.sample(0, time).flatMap((bone) => names.has(bone.id) ? [[names.get(bone.id)!, bone.world.slice(12, 15)] as const] : []))
    const first = sampleAt(0), last = sampleAt(clip.durationSeconds)
    let finite = true, minHips = Infinity, maxHips = -Infinity, excursion = 0
    for (let frame = 0; frame <= Math.round(clip.durationSeconds * CONTRACT_FPS); frame++) {
      const pose = sampleAt(Math.min(frame / CONTRACT_FPS, clip.durationSeconds))
      finite &&= [...pose.values()].every((p) => p.every(Number.isFinite))
      const hips = pose.get('Hips')!, start = first.get('Hips')!
      minHips = Math.min(minHips, hips[1]!); maxHips = Math.max(maxHips, hips[1]!)
      excursion = Math.max(excursion, Math.hypot(hips[0]! - start[0]!, hips[2]! - start[2]!))
    }
    if (request.preview) previewFrames = Array.from({ length: PREVIEW_FRAMES }, (_, index) => {
      const time = clip.durationSeconds * index / (PREVIEW_FRAMES - 1)
      return { label: `${time.toFixed(2)}s`, joints: sampleAt(time) }
    })
    const durationError = Math.abs(clip.durationSeconds - action.durationSeconds)
    roundtrip = { status: (names.size === 65 && reloaded.joints.length === 65 && finite && durationError < 1e-4 ? 'PASS' : 'FAIL') as GateStatus,
      jointCount: reloaded.joints.length, durationSeconds: clip.durationSeconds, durationErrorSeconds: durationError, allFinite: finite,
      hipsTravelMeters: Math.hypot(last.get('Hips')![0]! - first.get('Hips')![0]!, last.get('Hips')![2]! - first.get('Hips')![2]!),
      hipsHeightRangeMeters: [minHips, maxHips], hipsMaxExcursionMeters: excursion, prefixedJointNames: glbNodeNames(glb).filter((name) => /^mixamorig/i.test(name)).length }
  } finally { reloaded.dispose() }

  const boneLengthsMeters = Object.fromEntries(MIXAMO65_BONE_PARENTS.flatMap(([name, parent]) => {
    if (!parent) return []
    const a = targetRest.get(name)!, b = targetRest.get(parent)!
    return [[name, Math.hypot(a[12]! - b[12]!, a[13]! - b[13]!, a[14]! - b[14]!)]]
  }))
  const manifest = {
    version: CONTRACT_VERSION,
    glb: { bytes: glb.length, mode: 'animation-only' as const },
    glbSha256,
    actions: [{ uuid: actionUuid(request.sourceSha256, actionIndex, action.name), name: action.name, durationSeconds: action.durationSeconds, fps: CONTRACT_FPS }],
    rootPolicy: { mode: rootPolicy, translationScale: rootScale, units: 'meters' },
    source: { file: request.sourceLabel, sha256: request.sourceSha256, actionIndex },
    target: { file: request.targetLabel, sha256: request.targetSha256 },
    fingerprint: { boneLengthsMeters, hipsHeightMeters: targetRest.get('Hips')![13]! },
  }
  const gates = { mapping: 'PASS' as GateStatus, roundtrip: roundtrip.status }
  const contract = {
    joints65: roundtrip.jointCount === 65 ? 'PASS' : 'FAIL',
    noNamePrefix: roundtrip.prefixedJointNames === 0 ? 'PASS' : 'FAIL',
    fps30: 'PASS',
    multiActionInOneGlb: prunedActions.length > 1 ? 'FAIL' : 'PASS',
    manifestSidecar: 'PASS',
  } satisfies Record<string, GateStatus>
  const { metrics, unmappedSourceBoneIds, resourceCost, sampleCount } = normalized.report
  const report = {
    status: (Object.values(gates).every((gate) => gate === 'PASS') ? 'PASS' : 'FAIL') as GateStatus,
    gates, contract, input, actions: prunedActions.map(({ issues, ...rest }) => ({ ...rest, issueCount: issues.length, issues: issues.slice(0, 5) })),
    mapping: mappingReport,
    calibration: { mode: input.calibrate, facingYawDegrees: calibration.facingYawDegrees, measuredFacingYawDegrees: calibration.measuredFacingYawDegrees,
      facingAmbiguous: calibration.facingAmbiguous, facingSource: calibration.facingSource,
      maxDegrees: Math.max(0, ...calibration.corrections.map((item) => item.degrees)), corrections: calibration.corrections },
    // Root travel is copied in meters by default (DECISIONS); for very different body sizes pass --root-scale <suggested>.
    proportions: { sourceHipsHeightMeters: sourceHipsHeight, targetHipsHeightMeters: targetRest.get('Hips')![13]!,
      suggestedRootScale: sourceHipsHeight && sourceHipsHeight > 0 ? targetRest.get('Hips')![13]! / sourceHipsHeight : null },
    loss: { prunedTracks: prune.report, scaleTracks: prune.scale, quaternionTracks: prune.quaternions, unmappedSourceBones: unmappedSourceBoneIds.length, unmappedTargetJoints: mapping.joints.filter((joint) => !joint.sourceId).map((joint) => joint.target),
      note: 'Unmapped target joints keep their rest pose relative to the parent.' },
    sampleCount, metrics, resourceCost, roundtrip, glbSha256, elapsedMs: 0 }
  const preview = request.preview ? renderContactSheet(previewFrames, new Map(MIXAMO65_BONE_PARENTS)) : undefined
  report.elapsedMs = Date.now() - started
  return { status: report.status, glb, manifest, report, preview }
}
