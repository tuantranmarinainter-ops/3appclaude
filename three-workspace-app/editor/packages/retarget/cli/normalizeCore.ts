import { createHash } from 'node:crypto'
import { Matrix4, type Object3D } from 'three'
import { MIXAMO65_BONE_PARENTS } from '../src/mixamo65.ts'
import { normalizeAnimation } from '../src/normalizeAnimation.ts'
import { createThreeRigAdapter } from '../src/threeRigAdapter.ts'
import { buildAutoMapping, buildPresetMapping, canonical, type AutoMapping } from './autoMapping.ts'
import { loadAsset } from './loadAsset.ts'
import { renderContactSheet, type PreviewFrame } from './previewPng.ts'

export const CONTRACT_VERSION = '1.0.0'
export const CONTRACT_FPS = 30
const PREVIEW_FRAMES = 8

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

function blocked(code: string, message: string, extra: Record<string, unknown> = {}) {
  return { status: 'BLOCKED' as const, report: { status: 'BLOCKED' as GateStatus, blocker: { code, message }, ...extra } }
}

export async function runNormalize(request: NormalizeRequest) {
  const started = Date.now()
  const actionIndex = request.actionIndex ?? 0, rootPolicy = request.rootPolicy ?? 'preserve', rootScale = request.rootScale ?? 1
  const basis = sourceToScene(request.unitMeters ?? 1, request.upAxis ?? 'y')
  const sourceOptions = { fingerprint: request.sourceSha256, sourceToScene: basis }, targetOptions = { fingerprint: request.targetSha256 }
  const input = { source: request.sourceLabel, sourceSha256: request.sourceSha256, target: request.targetLabel, targetSha256: request.targetSha256,
    actionIndex, unitMeters: request.unitMeters ?? 1, upAxis: request.upAxis ?? 'y', rootPolicy, rootScale, fps: CONTRACT_FPS, mapping: request.mappingPreset ? 'preset' : 'auto' }

  const src = createThreeRigAdapter(request.source, { ...sourceOptions, collectUnsupportedTracks: true })
  const dst = createThreeRigAdapter(request.target, targetOptions)
  let mapping: AutoMapping & { fingerprintsMatch?: boolean }
  let targetRest: Map<string, number[]>
  const actions = src.actions.map((action) => ({ index: action.index, name: action.name, durationSeconds: action.durationSeconds, ready: action.ready, issues: action.issues }))
  try {
    mapping = request.mappingPreset ? buildPresetMapping(request.mappingPreset, src.rig, dst.rig) : buildAutoMapping(src.rig, dst.rig)
    targetRest = new Map(dst.rig.bones.flatMap((bone) => { const name = mixamoName(bone.name ?? ''); return name ? [[name, bone.restWorld] as const] : [] }))
  } finally { src.dispose(); dst.dispose() }
  const mappingReport = { family: mapping.family, mapped: mapping.pairs.length, missingRequired: mapping.missingRequired,
    ...(mapping.fingerprintsMatch === undefined ? {} : { presetFingerprintsMatch: mapping.fingerprintsMatch }),
    joints: mapping.joints.map(({ target, source, via, ambiguous }) => ({ target, source, via, ...(ambiguous ? { ambiguous } : {}) })) }

  const action = actions[actionIndex]
  if (!action) return blocked('NO_ACTION', actions.length ? `Action ${actionIndex} does not exist (source has ${actions.length})` : 'Source has no Action', { input, actions })
  if (!action.ready) return blocked('ACTION_UNSUPPORTED', `Action ${action.name} has unsupported channels`, { input, actions })
  if (mapping.missingRequired.length) return blocked('MISSING_REQUIRED_JOINTS', `Missing main joints: ${mapping.missingRequired.join(', ')}`, { input, actions, mapping: mappingReport })

  const normalized = await normalizeAnimation({ source: request.source, target: request.target, sourceOptions, targetOptions, pairs: mapping.pairs,
    actionIndex, fps: CONTRACT_FPS, rootTranslationPolicy: rootPolicy, rootTranslationScale: rootScale, requiredTargetJointIds: mapping.requiredTargetIds })
  const glb = normalized.bytes, glbSha256 = sha256(glb)

  // Roundtrip: reload the written bytes with GLTFLoader and sample them, instead of trusting in-memory frames.
  const reloaded = createThreeRigAdapter(await loadAsset(glb, 'glb'), { fingerprint: glbSha256 })
  let roundtrip, previewFrames: PreviewFrame[] = []
  try {
    const clip = reloaded.actions[0]!
    const names = new Map(reloaded.rig.bones.flatMap((bone) => { const name = mixamoName(bone.name ?? ''); return name ? [[bone.id, name] as const] : [] }))
    const sampleAt = (time: number) => new Map(reloaded.sample(0, time).flatMap((bone) => names.has(bone.id) ? [[names.get(bone.id)!, bone.world.slice(12, 15)] as const] : []))
    const first = sampleAt(0), last = sampleAt(clip.durationSeconds)
    let finite = true, minHips = Infinity, maxHips = -Infinity
    for (let frame = 0; frame <= Math.round(clip.durationSeconds * CONTRACT_FPS); frame++) {
      const pose = sampleAt(Math.min(frame / CONTRACT_FPS, clip.durationSeconds))
      finite &&= [...pose.values()].every((p) => p.every(Number.isFinite))
      minHips = Math.min(minHips, pose.get('Hips')![1]!); maxHips = Math.max(maxHips, pose.get('Hips')![1]!)
    }
    if (request.preview) previewFrames = Array.from({ length: PREVIEW_FRAMES }, (_, index) => {
      const time = clip.durationSeconds * index / (PREVIEW_FRAMES - 1)
      return { label: `${time.toFixed(2)}s`, joints: sampleAt(time) }
    })
    const durationError = Math.abs(clip.durationSeconds - action.durationSeconds)
    roundtrip = { status: (names.size === 65 && reloaded.joints.length === 65 && finite && durationError < 1e-4 ? 'PASS' : 'FAIL') as GateStatus,
      jointCount: reloaded.joints.length, durationSeconds: clip.durationSeconds, durationErrorSeconds: durationError, allFinite: finite,
      hipsTravelMeters: Math.hypot(last.get('Hips')![0]! - first.get('Hips')![0]!, last.get('Hips')![2]! - first.get('Hips')![2]!),
      hipsHeightRangeMeters: [minHips, maxHips], prefixedJointNames: glbNodeNames(glb).filter((name) => /^mixamorig/i.test(name)).length }
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
    multiActionInOneGlb: actions.length > 1 ? 'FAIL' : 'PASS',
    manifestSidecar: 'PASS',
  } satisfies Record<string, GateStatus>
  const { metrics, unmappedSourceBoneIds, resourceCost, sampleCount } = normalized.report
  const report = {
    status: (Object.values(gates).every((gate) => gate === 'PASS') ? 'PASS' : 'FAIL') as GateStatus,
    gates, contract, input, actions: actions.map(({ issues, ...rest }) => ({ ...rest, issueCount: issues.length })),
    mapping: mappingReport,
    loss: { unmappedSourceBones: unmappedSourceBoneIds.length, unmappedTargetJoints: mapping.joints.filter((joint) => !joint.sourceId).map((joint) => joint.target),
      note: 'Unmapped target joints keep their rest pose relative to the parent.' },
    sampleCount, metrics, resourceCost, roundtrip, glbSha256, elapsedMs: 0 }
  const preview = request.preview ? renderContactSheet(previewFrames, new Map(MIXAMO65_BONE_PARENTS)) : undefined
  report.elapsedMs = Date.now() - started
  return { status: report.status, glb, manifest, report, preview }
}
