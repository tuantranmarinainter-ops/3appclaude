import { readFileSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { AnimationMixer, LoopOnce, Matrix4, Quaternion, Vector3, type Object3D } from 'three'
import { bobjModelToGlb, parseBobjModel } from '../src/bobjModel.ts'
import { evaluateBobjAction, parseBobjActions, type BobjAction } from '../src/index.ts'
import { parseBobjArmature } from '../src/reverse.ts'
import { appendVerityActions, projectVerityFrame, VERITY_TO_MIXAMO, type VerityAddedAction, type VerityBoneTransform } from '../src/verityRig.ts'
import { loadAsset } from './loadAsset.ts'

const TICKS_PER_SECOND = 20

export interface VerityOriginalArtifacts {
  bobj: string
  glb: Uint8Array
  report: {
    bones: number
    originalActions: number
    addedActions: number
    selectedWingAction: string | null
    unitMeters: number
    unitSource: string
    floorNative: number
    originalPrefixBytes: number
    roundtripMaxPositionErrorUnits: number
    maxHipAngleDegrees: number
    maxHeadAngleDegrees: number
    sampledTimestamps: number
  }
}

function worldMatrices(armature: ReturnType<typeof parseBobjArmature>, action: BobjAction, tick: number) {
  return new Map(evaluateBobjAction(armature, action, tick).map((bone) => [bone.name, new Matrix4().fromArray([...bone.worldMatrix])]))
}

function localsAt(armature: ReturnType<typeof parseBobjArmature>, action: BobjAction, tick: number) {
  const worlds = worldMatrices(armature, action, tick)
  return new Map(armature.bones.map((bone) => [bone.name, bone.parent
    ? worlds.get(bone.parent)!.clone().invert().multiply(worlds.get(bone.name)!)
    : worlds.get(bone.name)!.clone()]))
}

function safeTextureReader(directory: string) {
  return (path: string) => {
    const base = resolve(directory), target = resolve(base, path), inside = relative(base, target)
    if (!inside || inside.startsWith('..') || isAbsolute(inside)) throw new Error(`BOBJ texture outside model folder: ${path}`)
    try { return readFileSync(target) } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw error
    }
  }
}

/**
 * Carries the normalized Mixamo65 Actions back to a full Verity BOBJ rig. The source text is kept as an exact prefix;
 * parsing it again is only used to produce the companion original-rig GLB.
 */
export async function exportVerityOriginalArtifacts(options: {
  sourceText: string
  sourcePath: string
  normalizedGlb: Uint8Array
  unitMeters?: number
  wingActionName?: string
}): Promise<VerityOriginalArtifacts> {
  const parsedModel = parseBobjModel(options.sourceText.replace(/^[\t \uFEFF]+(?=arm_name\s)/gm, ''), options.unitMeters === undefined ? {} : { unitMeters: options.unitMeters })
  if (parsedModel.armatureName !== 'verity.mdl') throw new TypeError(`Original-rig export requires arm_name verity.mdl, got ${parsedModel.armatureName || '(missing)'}`)
  const armature = parsedModel.armature, actions = parsedModel.actions
  const imported = bobjModelToGlb(parsedModel).report
  const restWorld = new Map(armature.bones.map((bone) => [bone.name, new Matrix4().fromArray([...bone.restWorld])]))
  const restLocal = new Map(armature.bones.map((bone) => [bone.name, new Matrix4().fromArray([...bone.restLocal])]))
  const bones: VerityBoneTransform[] = armature.bones.map((bone) => ({ name: bone.name, parent: bone.parent,
    restWorld: restWorld.get(bone.name)!, restLocal: restLocal.get(bone.name)! }))
  const rootName = armature.bones.find((bone) => !bone.parent)?.name
  if (!rootName) throw new TypeError('Verity armature has no root bone')
  const wingAction = actions.get(options.wingActionName ?? 'idle') ?? actions.values().next().value ?? null
  const rootLocal = wingAction ? localsAt(armature, wingAction, 0).get(rootName)! : restLocal.get(rootName)!
  const rootActionDelta = rootLocal.clone().multiply(restLocal.get(rootName)!.clone().invert())
  const leftHip = restWorld.get('Upper_Leg_L'), rightHip = restWorld.get('Upper_Leg_R')
  if (!leftHip || !rightHip) throw new TypeError('Verity armature needs Upper_Leg_L and Upper_Leg_R')
  const left = new Vector3().setFromMatrixPosition(leftHip).sub(new Vector3().setFromMatrixPosition(rightHip)).setY(0)
  if (left.lengthSq() < 1e-12) throw new TypeError('Verity left/right hip direction is degenerate')
  left.normalize()
  const sourceFacingInverse = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), -Math.atan2(left.z, left.x))

  const normalized = await loadAsset(options.normalizedGlb, 'glb', { skeletonOnly: true })
  const nodes = new Map<string, Object3D>()
  normalized.traverse((node) => { if (node.name) nodes.set(node.name.replace(/^mixamorig\d*:?/i, ''), node) })
  for (const target of new Set(Object.values(VERITY_TO_MIXAMO))) if (!nodes.has(target)) throw new TypeError(`Normalized GLB is missing ${target}`)
  const used = new Set(actions.keys()), added: VerityAddedAction[] = []
  for (const clip of normalized.animations) {
    let name = clip.name.replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '') || 'action'
    const base = name
    for (let suffix = 2; used.has(name); suffix++) name = `${base}_${suffix}`
    used.add(name)
    const mixer = new AnimationMixer(normalized), playing = mixer.clipAction(clip)
    playing.setLoop(LoopOnce, 1); playing.clampWhenFinished = true; playing.play()
    const ticks = Math.max(1, Math.round(clip.duration * TICKS_PER_SECOND)), frames = []
    for (let tick = 0; tick <= ticks; tick++) {
      mixer.setTime(Math.min(tick / TICKS_PER_SECOND, clip.duration)); normalized.updateMatrixWorld(true)
      const solverWorlds = new Map([...nodes].map(([bone, node]) => [bone, node.matrixWorld.clone()]))
      const wings = wingAction ? localsAt(armature, wingAction, tick % Math.max(1, wingAction.durationTicks)) : null
      frames.push(projectVerityFrame(solverWorlds, bones, { metresPerUnit: parsedModel.unitMeters, groundUnits: imported.floorNative,
        sourceFacingInverse, rootActionDelta }, rootName, rootLocal, wings))
    }
    playing.stop(); mixer.uncacheRoot(normalized)
    added.push({ name, ticks, frames })
  }
  const bobj = appendVerityActions(options.sourceText, bones, added)
  const writtenActions = parseBobjActions(bobj)
  let maxPositionError = 0, maxHipAngle = 0, maxHeadAngle = 0, sampledTimestamps = 0
  for (const action of added) for (const tick of [...new Set([0, Math.floor(action.ticks / 3), Math.floor(action.ticks * 2 / 3), action.ticks])]) {
    const written = writtenActions.get(action.name)
    if (!written) throw new Error(`Appended Verity Action ${action.name} is missing`)
    const actual = worldMatrices(armature, written, tick), expected = new Map<string, Matrix4>()
    for (const bone of bones) {
      expected.set(bone.name, (bone.parent ? expected.get(bone.parent)!.clone() : new Matrix4()).multiply(action.frames[tick]!.get(bone.name)!))
      maxPositionError = Math.max(maxPositionError, new Vector3().setFromMatrixPosition(actual.get(bone.name)!)
        .distanceTo(new Vector3().setFromMatrixPosition(expected.get(bone.name)!)))
    }
    const hipDirection = (worlds: ReadonlyMap<string, Matrix4>) => new Vector3().setFromMatrixPosition(worlds.get('Upper_Leg_L')!)
      .sub(new Vector3().setFromMatrixPosition(worlds.get('Upper_Leg_R')!)).normalize()
    maxHipAngle = Math.max(maxHipAngle, hipDirection(actual).angleTo(hipDirection(expected)))
    const actualHead = new Quaternion(), expectedHead = new Quaternion()
    actual.get('Head')!.decompose(new Vector3(), actualHead, new Vector3()); expected.get('Head')!.decompose(new Vector3(), expectedHead, new Vector3())
    maxHeadAngle = Math.max(maxHeadAngle, actualHead.normalize().angleTo(expectedHead.normalize()))
    sampledTimestamps++
  }
  const outputModel = parseBobjModel(bobj.replace(/^[\t \uFEFF]+(?=arm_name\s)/gm, ''), { unitMeters: parsedModel.unitMeters })
  const { bytes: glb } = bobjModelToGlb(outputModel, { unitMeters: parsedModel.unitMeters, readTexture: safeTextureReader(dirname(options.sourcePath)) })
  return { bobj, glb, report: { bones: armature.bones.length, originalActions: actions.size, addedActions: added.length,
    selectedWingAction: wingAction?.name ?? null, unitMeters: parsedModel.unitMeters, unitSource: parsedModel.unitSource,
    floorNative: imported.floorNative, originalPrefixBytes: Buffer.byteLength(options.sourceText), roundtripMaxPositionErrorUnits: maxPositionError,
    maxHipAngleDegrees: maxHipAngle * 180 / Math.PI, maxHeadAngleDegrees: maxHeadAngle * 180 / Math.PI, sampledTimestamps } }
}
