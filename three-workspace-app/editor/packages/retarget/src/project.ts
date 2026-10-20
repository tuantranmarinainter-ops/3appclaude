type JsonRecord = Record<string, unknown>

const controls = new Set([
  'adjArmSpace', 'adjShoulderWidth', 'adjUpperArm', 'adjForearm', 'adjLegLength', 'handPoseStrength', 'adjVertical', 'adjStride',
  'adjTrimStart', 'adjTrimEnd', 'adjIntensity', 'adjOverdrive', 'handPosePreset', 'leftHandPose', 'rightHandPose', 'rootMotion',
  'adjMirror', 'exportFormat', 'exportRigMode', 'exportIncludeSkin', 'exportFpsV99', 'reduceKeysV99', 'reducePosV99',
  'reduceAngleV99', 'abEnabledV99', 'abStartV99', 'abEndV99', 'worldBasisV99',
])
const numericControls: Record<string, [number, number]> = {
  adjArmSpace: [-50, 100], adjShoulderWidth: [70, 140], adjUpperArm: [70, 140], adjForearm: [70, 140], adjLegLength: [80, 125],
  handPoseStrength: [0, 100], adjVertical: [0, 200], adjStride: [0, 200], adjTrimStart: [0, 99], adjTrimEnd: [1, 100],
  adjIntensity: [0, 200], adjOverdrive: [0.25, 2], reducePosV99: [0, 0.1], reduceAngleV99: [0, 10], abStartV99: [0, Number.MAX_VALUE], abEndV99: [0, Number.MAX_VALUE],
}
const booleans = new Set(['rootMotion', 'adjMirror', 'exportIncludeSkin', 'reduceKeysV99', 'abEnabledV99'])
const interpolationModes = new Set(['original', 'step', 'linear', 'smooth'])

function record(value: unknown): value is JsonRecord { return !!value && typeof value === 'object' && !Array.isArray(value) }
function finite(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value) }
function entries(value: unknown): [string, unknown][] { return record(value) ? Object.entries(value) : [] }

function safeJson(value: unknown): boolean {
  let count = 0
  const visit = (node: unknown, depth: number): boolean => {
    if (++count > 200_000 || depth > 15) return false
    if (typeof node === 'number') return Number.isFinite(node)
    if (node === null || typeof node === 'string' || typeof node === 'boolean') return true
    if (Array.isArray(node)) return node.every((item) => visit(item, depth + 1))
    if (!record(node)) return false
    return Object.entries(node).every(([key, child]) => !['__proto__', 'constructor', 'prototype'].includes(key) && visit(child, depth + 1))
  }
  return visit(value, 0)
}

function validJoint(value: unknown): boolean {
  if (!record(value) || !Array.isArray(value.angles) || value.angles.length !== 3 || value.angles.some((angle) => !finite(angle) || Math.abs(angle) > 180) ||
    !['local', 'world'].includes(String(value.space)) || typeof value.reference !== 'string' || value.basis !== undefined && !['native', 'blender'].includes(String(value.basis))) return false
  if (value.q !== undefined) return Array.isArray(value.q) && value.q.length === 4 && value.q.every(finite) && Math.abs(Math.hypot(...value.q) - 1) <= 0.01
  return true
}

function validControls(value: unknown, targetRig: string): boolean {
  if (!record(value)) return false
  for (const [id, setting] of Object.entries(value)) {
    if (!controls.has(id)) return false
    if (booleans.has(id)) { if (typeof setting !== 'boolean') return false; continue }
    if (numericControls[id]) {
      const numeric = typeof setting === 'number' ? setting : typeof setting === 'string' && setting.trim() ? Number(setting) : NaN
      const [min, max] = numericControls[id]!
      if (!Number.isFinite(numeric) || numeric < min || numeric > max) return false
      continue
    }
    if (id === 'exportFpsV99') { if (!['15', '24', '30', 15, 24, 30].includes(setting as string | number)) return false; continue }
    const choices: Record<string, string[]> = {
      handPosePreset: ['original', 'open', 'natural', 'fist'], leftHandPose: ['original', 'natural', 'fist', 'open'],
      rightHandPose: ['original', 'natural', 'fist', 'open'], exportFormat: targetRig === 'bobj20' ? ['bobj', 'bobjJson'] : ['glb', 'fbx', 'bvh'],
      exportRigMode: ['animation', 'skeleton'], worldBasisV99: ['native', 'blender'],
    }
    if (!choices[id]?.includes(String(setting))) return false
  }
  return true
}

function validContext(context: unknown, targetNames: Set<string>, sourceNames: Set<string>): boolean {
  if (!record(context)) return false
  for (const key of ['offsets', 'calibration', 'segments', 'mapping', 'sourcePose', 'interpolation']) if (!record(context[key])) return false
  for (const key of ['offsets', 'calibration']) {
    for (const [name, joint] of entries(context[key])) if (!targetNames.has(name) || !validJoint(joint)) return false
  }
  for (const [name, value] of entries(context.segments)) {
    if (!targetNames.has(name) || !Array.isArray(value) || value.length > 1000 || value.some((joint) => {
      if (!record(joint) || !validJoint(joint) || !finite(joint.start) || !finite(joint.end) || !finite(joint.fade)) return true
      return joint.start < 0 || joint.end <= joint.start || joint.fade < 0
    })) return false
  }
  for (const [name, value] of entries(context.mapping)) if (!targetNames.has(name) || value !== 'none' && (typeof value !== 'string' || !sourceNames.has(value))) return false
  for (const [name, value] of entries(context.sourcePose)) if (!sourceNames.has(name) || !Array.isArray(value) || value.length !== 4 || !value.every(finite) || Math.abs(Math.hypot(...value) - 1) > 0.01) return false
  for (const [name, node] of entries(context.interpolation)) {
    if (!targetNames.has(name) || !record(node)) return false
    for (const [path, axes] of Object.entries(node)) {
      if (!['rotation', 'position', 'scale'].includes(path) || !record(axes)) return false
      for (const [axis, setting] of Object.entries(axes)) {
        if (!['0', '1', '2'].includes(axis) || !record(setting) || !interpolationModes.has(String(setting.all)) || !record(setting.segments) ||
          Object.entries(setting.segments).some(([index, mode]) => !/^\d+$/.test(index) || !interpolationModes.has(String(mode)))) return false
      }
    }
  }
  const feet = context.feet
  return record(feet) && typeof feet.enabled === 'boolean' && ['auto', 'manual'].includes(String(feet.mode)) && ['both', 'left', 'right'].includes(String(feet.side)) &&
    ['floor', 'height', 'speed', 'start', 'end', 'fade'].every((key) => finite(feet[key])) && Math.abs(feet.floor as number) <= 100 &&
    (feet.height as number) >= 0 && (feet.height as number) <= 1 && (feet.speed as number) >= 0 && (feet.speed as number) <= 10 &&
    (feet.start as number) >= 0 && (feet.end as number) >= (feet.start as number) && (feet.fade as number) >= 0
}

export interface RetargetProjectV99 extends JsonRecord {
  type: 'mixamo-retarget-project'
  version: 1
  mode: 'test' | 'retarget'
  rig: { source: 'bobj20' | 'mixamo65'; target: 'bobj20' | 'mixamo65' }
  source: JsonRecord
  target: Array<[string, string | null, number[]]>
  tick: number
  previewSpeed: number
  state: JsonRecord
}

/** Server-side port of V9.12's validateProjectV99; runtime asset fingerprints are checked by the session command. */
export function isRetargetProjectV99(value: unknown): value is RetargetProjectV99 {
  if (!record(value) || value.type !== 'mixamo-retarget-project' || value.version !== 1 || !['test', 'retarget'].includes(String(value.mode)) ||
    !record(value.rig) || !['bobj20', 'mixamo65'].includes(String(value.rig.source)) || !['bobj20', 'mixamo65'].includes(String(value.rig.target)) || value.rig.source === value.rig.target ||
    !record(value.source) || !record(value.state) || !safeJson(value) || !finite(value.tick) || value.tick < 0 || !finite(value.previewSpeed) || value.previewSpeed < 0.1 || value.previewSpeed > 4) return false
  const source = value.source
  if (!['fbx', 'minecraft'].includes(String(source.kind)) || typeof source.name !== 'string' || !source.name || !finite(source.duration) || source.duration <= 0 ||
    source.kind === 'fbx' && (typeof source.clip !== 'string' || !Number.isInteger(source.tracks) || (source.tracks as number) <= 0 || typeof source.content !== 'string' || !/^[a-f0-9]{1,8}$/i.test(source.content))) return false
  if (!Array.isArray(value.target) || !value.target.length) return false
  const targetNames = new Set<string>()
  for (const bone of value.target) {
    if (!Array.isArray(bone) || bone.length !== 3 || typeof bone[0] !== 'string' || !bone[0] || !(bone[1] === null || typeof bone[1] === 'string') ||
      !Array.isArray(bone[2]) || bone[2].length !== 16 || !bone[2].every(finite) || targetNames.has(bone[0])) return false
    targetNames.add(bone[0])
  }
  if (value.target.some((bone) => bone[1] !== null && (!targetNames.has(bone[1]!) || bone[1] === bone[0]))) return false
  const sourceNames = new Set<string>()
  if (!record(value.state.context) || !record(value.state.context.sourcePose) || !record(value.state.context.mapping)) return false
  for (const sourceName of [...Object.keys(value.state.context.sourcePose), ...Object.values(value.state.context.mapping).filter((name): name is string => typeof name === 'string' && name !== 'none')]) sourceNames.add(sourceName)
  if (!record(value.state.controls) || !validControls(value.state.controls, String(value.rig.target)) || !record(value.state.sides) ||
    Object.entries(value.state.sides).some(([name, side]) => !['proportionSide', 'handSide', 'motionSide'].includes(name) || !['both', 'left', 'right'].includes(String(side))) ||
    !record(value.state.movement) || Object.values(value.state.movement).some((movement) => !['inPlace', 'follow'].includes(String(movement))) ||
    !validContext(value.state.context, targetNames, sourceNames)) return false
  return true
}
