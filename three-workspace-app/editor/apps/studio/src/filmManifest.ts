import { Euler, Matrix4, Quaternion, Vector3 } from 'three'
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
}

const HASH = /^[a-f0-9]{64}$/
const MODEL_ID = /^unified\/[A-Za-z0-9_.-]{1,128}$/
const FLOAT_MAX = 3.4028234663852886e38

function fail(message: string): never { throw new TypeError(message) }

function actorTransform(matrixValues: number[], tick: number, priorYaw?: number) {
  if (!Array.isArray(matrixValues) || matrixValues.length !== 16 || matrixValues.some((value) => !Number.isFinite(value))) fail('Film actor matrix must contain 16 finite values')
  const matrix = new Matrix4().fromArray(matrixValues)
  const position = new Vector3(), rotation = new Quaternion(), scale = new Vector3()
  matrix.decompose(position, rotation, scale)
  const rebuilt = new Matrix4().compose(position, rotation, scale)
  if (!rebuilt.elements.every((value, index) => Math.abs(value - matrix.elements[index]!) <= 1e-6 * Math.max(1, Math.abs(value), Math.abs(matrix.elements[index]!)))) fail('Film actor transform contains shear')
  if (scale.toArray().some((value) => value <= 0 || Math.abs(value - 1) > 1e-6)) fail('Film export requires unit actor scale; bake actor scale into the converted model first')
  const forward = new Vector3(0, 0, 1).applyQuaternion(rotation)
  const horizontal = Math.hypot(forward.x, forward.z)
  const yaw = horizontal < 1e-10 ? priorYaw ?? 0 : Math.atan2(-forward.x, forward.z) * 180 / Math.PI
  const pitch = -Math.atan2(forward.y, horizontal) * 180 / Math.PI
  const continuousYaw = priorYaw === undefined ? yaw : yaw + 360 * Math.round((priorYaw - yaw) / 360)
  const expected = new Quaternion().setFromEuler(new Euler(pitch * Math.PI / 180, -continuousYaw * Math.PI / 180, 0, 'YXZ')).normalize()
  if (1 - Math.abs(expected.dot(rotation.normalize())) > 1e-6) fail('Film actor roll is not supported by the BBS replay transform schema')
  const values = [position.x, position.y, position.z, pitch, continuousYaw].map((value) => Object.is(value, -0) ? 0 : value)
  if (values.some((value) => !Number.isFinite(value) || Math.abs(value) > FLOAT_MAX)) fail('Film actor transform exceeds the BBS numeric range')
  return { tick, x: values[0]!, y: values[1]!, z: values[2]!, pitch: values[3]!, yaw: values[4]! }
}

function validateConvertedProfile(input: FilmInput, model: FilmInput['models'][number], profile: ConvertedFilmModelProfile): void {
  if (!profile || profile.schemaVersion !== 1 || profile.sourceSha256 !== model.source.sha256 || input.sourceHashes[model.assetId] !== profile.sourceSha256 ||
      profile.metersPerUnit !== model.metersPerUnit || !HASH.test(profile.sourceSha256) ||
      typeof profile.modelId !== 'string' || !MODEL_ID.test(profile.modelId) ||
      !Array.isArray(profile.bones) || !Array.isArray(profile.actions) || !Array.isArray(profile.files) ||
      typeof profile.textureRequired !== 'boolean') fail(`Converted BOBJ profile does not match Character ${model.characterId}`)
  if (profile.bones.length !== model.sourceBones.length || profile.bones.some((bone) => !bone || typeof bone.name !== 'string' ||
      !Array.isArray(bone.bobjRestMatrixRowMajor) || bone.bobjRestMatrixRowMajor.length !== 16 ||
      bone.bobjRestMatrixRowMajor.some((value) => !Number.isFinite(value)))) fail(`Converted BOBJ profile is incomplete for Character ${model.characterId}`)
  const sourceNames = new Set(model.sourceBones.map((bone) => bone.name))
  if (profile.bones.some((bone) => bone.sourceName !== undefined && (typeof bone.sourceName !== 'string' || !sourceNames.has(bone.sourceName))) ||
      new Set(profile.bones.map((bone) => bone.sourceName ?? bone.name)).size !== profile.bones.length) fail(`Converted BOBJ source bone mapping is invalid for Character ${model.characterId}`)
  const targets = new Set<string>()
  for (const file of profile.files) {
    if (!file || typeof file.sourcePath !== 'string' || !/^(?:[A-Za-z]:[\\/]|\\\\|\/)/.test(file.sourcePath) ||
        !['model.bobj', 'model.png'].includes(file.targetPath) || targets.has(file.targetPath) || !HASH.test(file.sha256)) fail(`Converted BOBJ files are invalid for Character ${model.characterId}`)
    targets.add(file.targetPath)
  }
  if (!targets.has('model.bobj') || profile.textureRequired !== targets.has('model.png')) fail(`Converted BOBJ files do not match the texture profile for Character ${model.characterId}`)
  if (profile.actions.some((action) => typeof action !== 'string' || !action) || new Set(profile.actions).size !== profile.actions.length) fail('Converted BOBJ action list is invalid')
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

  const profileByAsset = new Map<string, ConvertedFilmModelProfile>()
  const models = input.models.map((model) => {
    const profile = convertedModels.get(model.assetId)
    if (!profile) fail(`Converted BOBJ profile is missing for Character ${model.characterId}`)
    validateConvertedProfile(input, model, profile)
    const prior = profileByAsset.get(model.assetId)
    if (prior && prior.modelId !== profile.modelId) fail(`Characters sharing asset ${model.assetId} have different converted models`)
    profileByAsset.set(model.assetId, profile)
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
  const baked = bakeProjectFilmPoseTracks(input, convertedModels)
  const actors = input.models.map((model, modelIndex) => {
    const profile = profileByAsset.get(model.assetId)!
    const name = model.name
    if (typeof name !== 'string' || !name.trim() || name.length > 64) fail(`Film actor name must contain 1-64 characters: ${model.characterId}`)
    let previousYaw: number | undefined
    // Converted BOBJ models face the opposite way to App 2 characters in BBS actors. Calibrated in BBS FS 2.7 with
    // Minecraft20 and Mixamo65 actors at yaw 0: every unturned actor showed its back to a camera it should face.
    const facingOffset = 180
    const transformSamples = input.frames.map((frame) => {
      const sample = frame.skeletons.find((item) => item.nodeId === model.nodeId)
      if (!sample) fail(`Film sample is missing Character ${model.characterId}`)
      const transform = actorTransform(sample.actorWorldMatrix, frame.tick, previousYaw)
      previousYaw = transform.yaw
      return { ...transform, yaw: transform.yaw + facingOffset }
    })
    return { characterId: model.characterId, name, modelId: profile.modelId, transformSamples,
      poseTracks: baked[modelIndex]!.poseTracks }
  })
  return {
    schemaVersion: 1 as const, targetVersion: '2.4' as const, projectId: input.projectId,
    sourceRevision: input.sourceRevision, sourceSha256: input.sourceSha256, sourceHashes,
    filmName, mode: 'editable' as const, durationTicks: input.durationTicks,
    models: uniqueModels, actors, cameras: input.cameras,
  }
}
