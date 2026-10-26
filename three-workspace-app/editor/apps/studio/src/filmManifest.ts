import { Euler, Matrix4, Quaternion, Vector3 } from 'three'
import { evaluateBobjAction, MIXAMO_TO_VERITY, parseBobjActions, parseBobjArmature, projectVerityFrame, VERITY_METRES_PER_UNIT } from '@bbs/retarget'
import { bobjModelNodeName, buildBobjModel, parseBobjModel } from '../../../packages/retarget/src/bobjModel'
import { bakeProjectFilmPoseTracks } from './unifiedFilmSampling'

type FilmInput = Awaited<ReturnType<typeof import('./unifiedFilmSampling').sampleProjectFilm>>

export interface ConvertedFilmModelProfile {
  schemaVersion: 1
  sourceSha256: string
  modelId: string
  metersPerUnit: number
  bones: Array<{ name: string; sourceName?: string; parent: string | null; bobjRestMatrixRowMajor: number[] }>
  actions: string[]
  textureRequired: boolean
  files: Array<{ sourcePath: string; targetPath: string; sha256: string }>
  /** In-memory context for an original library BOBJ. Never serialized into the worker manifest. */
  originalRig?: { bobj: string; wingAction?: string; nativeOnly?: boolean; sourcePositionScale?: number }
  /** BBS FS 2.7 Form.transform.s/t; model bytes and native bone coordinates stay immutable. */
  formScale?: number
  formOffsetY?: number
}

const HASH = /^[a-f0-9]{64}$/
const MODEL_ID = /^unified\/[A-Za-z0-9_.-]{1,128}$/
const FLOAT_MAX = 3.4028234663852886e38

function fail(message: string): never { throw new TypeError(message) }

/**
 * Converted BOBJ models face the opposite way to App 2 nodes in BBS actors. Calibrated in BBS FS 2.7 with Minecraft20
 * and Mixamo65 actors at yaw 0 (every unturned actor showed its back to a camera it should face) and with prop sets.
 */
export const FILM_MODEL_FACING_OFFSET = 180

export interface FilmActorTransformIssue { code: string; message: string }
export function inspectFilmActorTransform(matrixValues: number[], tick: number, priorYaw?: number, expectedScale = 1): { issues: FilmActorTransformIssue[]; transform?: { tick: number; x: number; y: number; z: number; pitch: number; yaw: number } } {
  const issues: FilmActorTransformIssue[] = []
  const add = (code: string, message: string) => issues.push({ code, message })
  if (!Array.isArray(matrixValues) || matrixValues.length !== 16 || matrixValues.some((value) => !Number.isFinite(value))) {
    add('MATRIX_INVALID', 'Film actor matrix must contain 16 finite values')
    return { issues }
  }
  const matrix = new Matrix4().fromArray(matrixValues)
  const position = new Vector3(), rotation = new Quaternion(), scale = new Vector3()
  matrix.decompose(position, rotation, scale)
  const rebuilt = new Matrix4().compose(position, rotation, scale)
  if (!rebuilt.elements.every((value, index) => Math.abs(value - matrix.elements[index]!) <= 1e-6 * Math.max(1, Math.abs(value), Math.abs(matrix.elements[index]!)))) add('TRANSFORM_SHEAR', 'Film actor transform contains shear')
  if (scale.toArray().some((value) => value <= 0 || !Number.isFinite(expectedScale) || expectedScale <= 0 || Math.abs(value - expectedScale) > 1e-6 * Math.max(1, expectedScale))) add('TRANSFORM_SCALE', 'Film export requires unit actor scale; bake actor scale into the converted model first')
  const forward = new Vector3(0, 0, 1).applyQuaternion(rotation)
  const horizontal = Math.hypot(forward.x, forward.z)
  const yaw = horizontal < 1e-10 ? priorYaw ?? 0 : Math.atan2(-forward.x, forward.z) * 180 / Math.PI
  const pitch = -Math.atan2(forward.y, horizontal) * 180 / Math.PI
  const continuousYaw = priorYaw === undefined ? yaw : yaw + 360 * Math.round((priorYaw - yaw) / 360)
  const expected = new Quaternion().setFromEuler(new Euler(pitch * Math.PI / 180, -continuousYaw * Math.PI / 180, 0, 'YXZ')).normalize()
  if (1 - Math.abs(expected.dot(rotation.normalize())) > 1e-6) add('TRANSFORM_ROLL', 'Film actor roll is not supported by the BBS replay transform schema')
  const values = [position.x, position.y, position.z, pitch, continuousYaw].map((value) => Object.is(value, -0) ? 0 : value)
  if (values.some((value) => !Number.isFinite(value) || Math.abs(value) > FLOAT_MAX)) add('TRANSFORM_NUMERIC_RANGE', 'Film actor transform exceeds the BBS numeric range')
  return { issues, ...(issues.length ? {} : { transform: { tick, x: values[0]!, y: values[1]!, z: values[2]!, pitch: values[3]!, yaw: values[4]! } }) }
}

function actorTransform(matrixValues: number[], tick: number, priorYaw?: number, expectedScale = 1) {
  const result = inspectFilmActorTransform(matrixValues, tick, priorYaw, expectedScale)
  if (result.issues.length || !result.transform) fail(result.issues[0]?.message ?? 'Film actor matrix is invalid')
  return result.transform
}

function validateConvertedProfile(input: FilmInput, model: FilmInput['models'][number], profile: ConvertedFilmModelProfile): void {
  if (!profile || profile.schemaVersion !== 1 || profile.sourceSha256 !== model.source.sha256 || input.sourceHashes[model.assetId] !== profile.sourceSha256 ||
      profile.metersPerUnit !== model.metersPerUnit || !HASH.test(profile.sourceSha256) ||
      typeof profile.modelId !== 'string' || !MODEL_ID.test(profile.modelId) ||
      !Array.isArray(profile.bones) || !Array.isArray(profile.actions) || !Array.isArray(profile.files) ||
      typeof profile.textureRequired !== 'boolean') fail(`Converted BOBJ profile does not match Character ${model.characterId}`)
  if ((!profile.originalRig && profile.bones.length !== model.sourceBones.length) || profile.bones.some((bone) => !bone || typeof bone.name !== 'string' ||
      !Array.isArray(bone.bobjRestMatrixRowMajor) || bone.bobjRestMatrixRowMajor.length !== 16 ||
      bone.bobjRestMatrixRowMajor.some((value) => !Number.isFinite(value)))) fail(`Converted BOBJ profile is incomplete for Character ${model.characterId}`)
  if (profile.formScale !== undefined && (!Number.isFinite(profile.formScale) || profile.formScale <= 0 || profile.formScale > 1000) || profile.formOffsetY !== undefined && !Number.isFinite(profile.formOffsetY)) fail('Converted BOBJ height transform is invalid')
  const sourceNames = new Set(model.sourceBones.map((bone) => bone.name))
  if (!profile.originalRig && (profile.bones.some((bone) => bone.sourceName !== undefined && (typeof bone.sourceName !== 'string' || !sourceNames.has(bone.sourceName))) ||
      new Set(profile.bones.map((bone) => bone.sourceName ?? bone.name)).size !== profile.bones.length)) fail(`Converted BOBJ source bone mapping is invalid for Character ${model.characterId}`)
  const targets = new Set<string>()
  for (const file of profile.files) {
    if (!file || typeof file.sourcePath !== 'string' || !/^(?:[A-Za-z]:[\\/]|\\\\|\/)/.test(file.sourcePath) ||
        !(file.targetPath === 'model.bobj' || file.targetPath === 'model.png' || /^textures\/(?!.*(?:^|\/)\.\.?(?:\/|$))[A-Za-z0-9_.\/-]+\/default\.png$/.test(file.targetPath)) ||
        targets.has(file.targetPath.toLowerCase()) || !HASH.test(file.sha256)) fail(`Converted BOBJ files are invalid for Character ${model.characterId}`)
    targets.add(file.targetPath.toLowerCase())
  }
  const hasTexture = targets.has('model.png') || [...targets].some((target) => target.startsWith('textures/') && target.endsWith('/default.png'))
  if (!targets.has('model.bobj') || profile.textureRequired !== hasTexture) fail(`Converted BOBJ files do not match the texture profile for Character ${model.characterId}`)
  if (profile.actions.some((action) => typeof action !== 'string' || !action) || new Set(profile.actions).size !== profile.actions.length) fail('Converted BOBJ action list is invalid')
}

type PoseKey = { tick: number; t: [number, number, number]; s: [number, number, number]; r: [number, number, number]; r2: [0, 0, 0]; fix: 0; color: -1; lighting: 0 }

/** Bake native BOBJ samples directly, or invert canonical Mixamo samples through the original Verity hierarchy. */
/** Empty BOBJ action mapped to the idle slot so BBS does not add the model's own idle under Film pose tracks (B30). */
export const FILM_REST_ACTION = 'w01_rest'

export function projectOriginalVerityPoseTracks(input: FilmInput, modelIndex: number, original: { bobj: string; wingAction?: string; nativeOnly?: boolean; sourcePositionScale?: number }) {
  const model = input.models[modelIndex]!
  const armature = parseBobjArmature(original.bobj)
  const modelReport = buildBobjModel(parseBobjModel(original.bobj)).report
  const actions = parseBobjActions(original.bobj)
  const nativeAction = actions.get(original.wingAction || 'idle') ?? actions.values().next().value
  if (!nativeAction && !original.nativeOnly) fail(`Original BOBJ has no native action for Character ${model.characterId}`)
  const restWorld = new Map(armature.bones.map((bone) => [bone.name, new Matrix4().fromArray([...bone.restWorld])]))
  const restLocal = new Map(armature.bones.map((bone) => [bone.name, new Matrix4().fromArray([...bone.restLocal])]))
  const nativeAtZero = new Map(nativeAction ? evaluateBobjAction(armature, nativeAction, 0).map((bone) => [bone.name, new Matrix4().fromArray([...bone.worldMatrix])] as const) : restWorld)
  const rootName = armature.bones.find((bone) => bone.parent === null)?.name
  if (!rootName) fail('Original BOBJ has no root bone')
  const rootLocal = nativeAtZero.get(rootName)!
  const rootActionDelta = rootLocal.clone().multiply(restWorld.get(rootName)!.clone().invert())
  const side = new Vector3().fromArray(modelReport.restFacing?.left ?? [1, 0, 0]); side.y = 0
  const facing = side.lengthSq() > 1e-12 ? new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), -Math.atan2(-side.z, side.x)) : new Quaternion()
  const sourceFacingInverse = facing.clone().invert()
  const groundUnits = modelReport.floorNative
  const sourceNames = new Set(model.sourceBones.map((bone) => bone.name))
  const nativeTopology = armature.bones.every((bone) => sourceNames.has(bobjModelNodeName(bone.name)))
  if (original.nativeOnly && !nativeTopology) fail(`Film Character ${model.characterId} must retain its original BOBJ topology`)
  const wrapperInverse = new Matrix4().makeScale(1 / modelReport.unitMeters, 1 / modelReport.unitMeters, 1 / modelReport.unitMeters)
    .multiply(new Matrix4().makeTranslation(0, groundUnits * modelReport.unitMeters, 0))
  let duration = 1
  for (const group of nativeAction?.groups.values() ?? []) for (const channel of group.channels) for (const key of channel.keys) duration = Math.max(duration, key.t)
  const positionScale = original.sourcePositionScale ?? 1
  if (!(positionScale > 0) || !Number.isFinite(positionScale)) fail('Original BOBJ source position scale must be positive')
  const scaledPosition = (matrix: Matrix4) => { matrix.elements[12]! *= positionScale; matrix.elements[13]! *= positionScale; matrix.elements[14]! *= positionScale; return matrix }
  const projected = input.frames.map((frame) => {
    const sample = frame.skeletons.find((item) => item.nodeId === model.nodeId)
    if (!sample) fail(`Film sample is missing Character ${model.characterId}`)
    const actorInverse = new Matrix4().fromArray(sample.actorWorldMatrix).invert()
    if (nativeTopology) {
      const sampled = new Map(sample.bones.map((bone) => [bone.name, bone]))
      const worlds = new Map(armature.bones.map((bone) => {
        const value = sampled.get(bobjModelNodeName(bone.name))
        if (!value) fail(`Film sample is missing original bone ${bone.name}`)
        return [bone.name, wrapperInverse.clone().multiply(scaledPosition(actorInverse.clone().multiply(new Matrix4().fromArray(value.worldMatrix))))] as const
      }))
      return new Map(armature.bones.map((bone) => [bone.name, bone.name === 'Jaw' ? restLocal.get(bone.name)!.clone() :
        bone.parent ? worlds.get(bone.parent)!.clone().invert().multiply(worlds.get(bone.name)!) : worlds.get(bone.name)!]))
    }
    const solverWorlds = new Map(sample.bones.map((bone) => [bone.name, scaledPosition(actorInverse.clone().multiply(new Matrix4().fromArray(bone.worldMatrix)))]))
    const native = new Map(evaluateBobjAction(armature, nativeAction!, frame.tick % duration).map((bone) => [bone.name, new Matrix4().fromArray([...bone.worldMatrix])]))
    const wingLocals = new Map<string, Matrix4>()
    for (const bone of armature.bones.filter((item) => item.name.startsWith('Wing'))) {
      const world = native.get(bone.name)!, parent = bone.parent ? native.get(bone.parent) : undefined
      wingLocals.set(bone.name, parent ? parent.clone().invert().multiply(world) : world)
    }
    return projectVerityFrame(solverWorlds, armature.bones.map((bone) => ({ name: bone.name, parent: bone.parent,
      restWorld: restWorld.get(bone.name)!, restLocal: restLocal.get(bone.name)! })),
    { metresPerUnit: modelReport.unitMeters || model.metersPerUnit || VERITY_METRES_PER_UNIT, groundUnits, sourceFacingInverse, rootActionDelta }, rootName, rootLocal, wingLocals)
  })
  const prior = new Map<string, Euler>()
  const trackedOriginalNames = new Set(Object.values(MIXAMO_TO_VERITY))
  trackedOriginalNames.add('Jaw')
  return armature.bones.filter((bone) => nativeTopology ? !/^camera(?:_|$)/i.test(bone.name) : trackedOriginalNames.has(bone.name))
    .map((bone) => ({ boneName: bone.name, keyframes: projected.map((locals, index): PoseKey => {
      const tick = input.frames[index]!.tick
      const delta = bone.restLocal ? new Matrix4().fromArray([...bone.restLocal]).invert().multiply(locals.get(bone.name)!) : locals.get(bone.name)!
      const p = new Vector3(), q = new Quaternion(), s = new Vector3(); delta.decompose(p, q, s)
      const e = new Euler().setFromQuaternion(q, 'ZYX'), old = prior.get(bone.name)
      if (old) { e.x += 2 * Math.PI * Math.round((old.x - e.x) / (2 * Math.PI)); e.y += 2 * Math.PI * Math.round((old.y - e.y) / (2 * Math.PI)); e.z += 2 * Math.PI * Math.round((old.z - e.z) / (2 * Math.PI)) }
      prior.set(bone.name, e.clone())
      return { tick, t: p.toArray() as [number, number, number], s: s.toArray() as [number, number, number], r: [e.x, e.y, e.z], r2: [0, 0, 0], fix: 0, color: -1, lighting: 0 }
    }) }))
}

/** Build the exact typed JSON accepted by the pinned BBS 2.4 Film worker. */
export function buildFilmExportManifest(input: FilmInput, convertedModels: ReadonlyMap<string, ConvertedFilmModelProfile>, filmName: string) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(filmName) || filmName.endsWith('.')) fail('Film name must use 1-64 safe ASCII characters')
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(input.projectId) || !HASH.test(input.sourceSha256) || !Number.isSafeInteger(input.sourceRevision) || input.sourceRevision < 0 || input.targetVersion !== '2.4' || input.sampleFps !== 20 ||
      !Number.isSafeInteger(input.durationTicks) || input.durationTicks < 1 || input.durationTicks > 255 ||
      input.frames.length !== input.durationTicks + 1 || input.frames.some((frame, tick) => frame.tick !== tick) ||
      input.cameras.length < 1 || input.cameras.length > 3) fail('Film sampling input does not match the BBS 2.4 worker limits')
  const sourceHashes = Object.fromEntries(Object.entries(input.sourceHashes).sort(([a], [b]) => a.localeCompare(b)))
  if (Object.values(sourceHashes).some((hash) => typeof hash !== 'string' || !HASH.test(hash))) fail('Film source dependency hashes are invalid')

  const profileByCharacter = new Map<string, ConvertedFilmModelProfile>()
  const models = input.models.map((model) => {
    const profile = convertedModels.get(model.characterId) ?? convertedModels.get(model.assetId)
    if (!profile) fail(`Converted BOBJ profile is missing for Character ${model.characterId}`)
    validateConvertedProfile(input, model, profile)
    profileByCharacter.set(model.characterId, profile)
    return { id: profile.modelId, bones: profile.bones.map((bone) => bone.name), actions: profile.actions,
      textureRequired: profile.textureRequired, files: profile.files }
  })
  const modelsById = new Map<string, (typeof models)[number]>()
  for (const model of models) {
    const prior = modelsById.get(model.id)
    if (prior && JSON.stringify(prior) !== JSON.stringify(model)) fail(`Converted model ID ${model.id} has conflicting profiles`)
    modelsById.set(model.id, model)
  }
  const uniqueModels = [...modelsById.values()]
  const regularProfiles = new Map(convertedModels)
  for (const model of input.models) {
    const profile = profileByCharacter.get(model.characterId)!
    if (!profile.originalRig) regularProfiles.set(model.assetId, profile)
  }
  const regularInput = { ...input, models: input.models.filter((model) => !profileByCharacter.get(model.characterId)!.originalRig) }
  const bakedRegular = bakeProjectFilmPoseTracks(regularInput as FilmInput, regularProfiles)
  const bakedByCharacter = new Map(bakedRegular.map((item) => [item.characterId, item]))
  const actors = input.models.map((model, modelIndex) => {
    const profile = profileByCharacter.get(model.characterId)!
    const name = model.name
    if (typeof name !== 'string' || !name.trim() || name.length > 64) fail(`Film actor name must contain 1-64 characters: ${model.characterId}`)
    let previousYaw: number | undefined
    // B30 in game: posed original Verity models faced away from their target (Gỗ Xưa cast away from Đen),
    // so their replay yaw needs the opposite offset from Minecraft20/converted models.
    const facingOffset = FILM_MODEL_FACING_OFFSET + (profile.originalRig && !profile.originalRig.nativeOnly ? 180 : 0)
    const transformSamples = input.frames.map((frame) => {
      const sample = frame.skeletons.find((item) => item.nodeId === model.nodeId)
      if (!sample) fail(`Film sample is missing Character ${model.characterId}`)
      const transform = actorTransform(sample.actorWorldMatrix, frame.tick, previousYaw, model.actorScale ?? 1)
      previousYaw = transform.yaw
      return { ...transform, yaw: transform.yaw + facingOffset }
    })
    const original = profile.originalRig
    const nativeTopology = original && parseBobjArmature(original.bobj).bones.every((bone) => model.sourceBones.some((source) => source.name === bobjModelNodeName(bone.name)))
    const poseTracks = original ? projectOriginalVerityPoseTracks(input, modelIndex, original) : bakedByCharacter.get(model.characterId)!.poseTracks
    return { characterId: model.characterId, name, modelId: profile.modelId, transformSamples, poseTracks,
      ...((profile.formScale ?? model.actorScale ?? 1) !== 1 || profile.formOffsetY ? { formScale: profile.formScale ?? model.actorScale ?? 1, formOffsetY: profile.formOffsetY ?? 0 } : {}),
      ...(original && !nativeTopology ? { animationKeyframes: [{ tick: 0, animationName: original.wingAction || 'idle', actionTick: 0 }] }
        : original && parseBobjActions(original.bobj).has(FILM_REST_ACTION) ? { animationKeyframes: [{ tick: 0, animationName: FILM_REST_ACTION, actionTick: 0, slot: 'idle' }] } : {}) }
  })
  return {
    schemaVersion: 1 as const, targetVersion: '2.4' as const, projectId: input.projectId,
    sourceRevision: input.sourceRevision, sourceSha256: input.sourceSha256, sourceHashes,
    filmName, mode: 'editable' as const, durationTicks: input.durationTicks,
    models: uniqueModels, actors, cameras: input.cameras,
  }
}
