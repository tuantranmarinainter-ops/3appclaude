import { filmAnchorPlacement, type FilmAnchorPlacement } from './filmAnchorPreflight'
import { filmCharacterHeight } from './filmCharacterHeight'
import { filmCameraWarnings } from './filmCameraWarnings'
import { Matrix4, PropertyBinding, Quaternion, Vector3 } from 'three'
import type { SkeletonProfile, UnifiedProject } from '@bbs/animation-workspace-shared'
import { filmGridFrameStep, FILM_MAX_TICKS, FILM_TICK_RATE } from './filmFrame'
import { inspectFilmActorTransform } from './filmManifest'
import { inspectProjectFilm, type FilmSamplingArgs } from './unifiedFilmSampling'
import { reviewStatusForSequence } from './sceneReview'
import { resolveSceneBbsFilmArgs } from './sceneBbsFilm'
import { resolveFilmEffectsPolicy } from './filmEffectsPolicy'
import type { FilmSeriesSegment } from './filmSeries'

const canonicalFootBone = (name: string) => name.split(':').pop()!.replace(/^mixamorig[0-9]*/i, '').replace(/[^a-z0-9]/gi, '').toLowerCase()

/** Floor is scene world Y=0, in metres. Sample matrices already include model units, basis,
 * wrappers, animation and actor placement; never apply metersPerUnit a second time.
 * MC20 has equal upper/lower leg segments and no ankle joint. Extend the rest thigh→knee
 * vector once more, expressed in the shin's local frame, then evaluate that tip in world space.
 * Missing/ambiguous profiles leave evidence unavailable rather than claiming floor contact.
 */
export function measureFilmFeet(skeleton: { metersPerUnit: number; bones: Array<{ name: string; worldMatrix: number[] }> }, profile?: SkeletonProfile): { leftY?: number; rightY?: number } {
  const result: { leftY?: number; rightY?: number } = {}
  for (const side of ['left', 'right'] as const) {
    const foot = skeleton.bones.find((bone) => [side + 'foot', 'foot' + side, side[0] + 'foot', 'foot' + side[0]].includes(canonicalFootBone(bone.name)))
    if (foot) { result[side === 'left' ? 'leftY' : 'rightY'] = foot.worldMatrix[13]; continue }
    if (profile?.family !== 'minecraft20' || !Number.isFinite(profile.metersPerUnit) || profile.metersPerUnit <= 0 || profile.metersPerUnit !== skeleton.metersPerUnit) continue
    const shinName = side === 'left' ? 'lowleftleg' : 'lowlegright'
    const shins = profile.bones.filter((bone) => canonicalFootBone(bone.name) === shinName)
    const samples = skeleton.bones.filter((bone) => canonicalFootBone(bone.name) === shinName || shins.some((shin) => bone.name === PropertyBinding.sanitizeNodeName(shin.name)))
    if (shins.length !== 1 || samples.length !== 1) continue
    const shin = shins[0]!, sample = samples[0]!
    const parent = profile.bones.find((bone) => bone.id === shin.parentId)
    if (!parent || canonicalFootBone(parent.name) !== side + 'leg' || !isRecord(shin.rest)) continue
    const { position, rotation, scale } = shin.rest
    if (!Array.isArray(position) || position.length !== 3 || !Array.isArray(rotation) || rotation.length !== 4 || !Array.isArray(scale) || scale.length !== 3 ||
      ![...position, ...rotation, ...scale].every((v) => typeof v === 'number' && Number.isFinite(v)) || scale.some((v) => Math.abs(v) < 1e-12) ||
      Math.hypot(...position) < 1e-12 || Math.abs(Math.hypot(...rotation) - 1) > 1e-3 || sample.worldMatrix.length !== 16 || !sample.worldMatrix.every(Number.isFinite)) continue
    const local = new Matrix4().compose(new Vector3().fromArray(position), new Quaternion().fromArray(rotation), new Vector3().fromArray(scale))
    const tip = new Vector3().fromArray(position).multiplyScalar(2).applyMatrix4(local.invert()).applyMatrix4(new Matrix4().fromArray(sample.worldMatrix))
    if (Number.isFinite(tip.y)) result[side === 'left' ? 'leftY' : 'rightY'] = tip.y
  }
  return result
}

export interface FilmPreflightIssue {
  code: string
  message: { vi: string; en: string }
  nodeId?: string
  clipId?: string
  frame?: number
  segment?: number
}

export interface FilmPreflightArgs extends FilmSamplingArgs {
  /** Store supplied evidence after checking the immutable asset references on disk. */
  assetAvailability?: Record<string, boolean>
  /** Conservative source-profile bone counts supplied by the host for selected model props. */
  propBoneCounts?: Record<string, number>
  /** CPU skeleton samples; omitted when source evaluation is unavailable. */
  footSamples?: Record<string, Array<{ frame: number; leftY?: number; rightY?: number; airborne?: boolean; actorWorldMatrix?: number[] }>>
  /**
   * Host-supplied reason codes for why skeleton sampling did not run (inspection issue codes such as
   * TICK_LIMIT or SEQUENCE_INVALID, ASSET_FILE_MISSING, ...). When present, missing foot samples are
   * explained by those causes — the checks they block are already reported — instead of a misleading
   * CHARACTER_TRANSFORM_UNAVAILABLE.
   */
  samplingBlockers?: string[]
  /** Message from a skeleton sampling attempt that ran but threw; reported verbatim as the failure cause. */
  samplingError?: string
}

export interface FilmPreflightResult { placement?: FilmAnchorPlacement; errors: FilmPreflightIssue[]; warnings: FilmPreflightIssue[] }

/** Runs the same preflight independently for each planned series segment and annotates every issue. */
export function filmSeriesPreflight(segments: readonly FilmSeriesSegment[], evidence: ReadonlyMap<number, Pick<FilmPreflightArgs, 'assetAvailability' | 'propBoneCounts' | 'footSamples' | 'samplingBlockers' | 'samplingError'>> = new Map()): FilmPreflightResult {
  const result: FilmPreflightResult = { errors: [], warnings: [] }
  for (const segment of segments) {
    const entry = filmPreflight(segment.project, { ...segment.exportArgs, ...evidence.get(segment.order) })
    for (const planning of segment.planningIssues) {
      entry.errors.push(issue(`FILM_SERIES_${planning.code}`, `Đoạn ${segment.order}: ${planning.message}`, `Segment ${segment.order}: ${planning.message}`))
    }
    const append = (target: FilmPreflightIssue[], values: FilmPreflightIssue[]) => {
      for (const value of values) {
        const tagged = { ...value, segment: segment.order }
        if (!target.some((prior) => prior.segment === tagged.segment && prior.code === tagged.code && prior.nodeId === tagged.nodeId && prior.clipId === tagged.clipId && prior.frame === tagged.frame)) target.push(tagged)
      }
    }
    if (entry.placement) {
      if (!result.placement) result.placement = structuredClone(entry.placement)
      else {
        result.placement.min = result.placement.min.map((n, axis) => Math.min(n, entry.placement!.min[axis]!))
        result.placement.max = result.placement.max.map((n, axis) => Math.max(n, entry.placement!.max[axis]!))
        const distances = [result.placement.nearestActorDistance, entry.placement.nearestActorDistance].filter((n): n is number => n !== undefined)
        result.placement.nearestActorDistance = distances.length ? Math.min(...distances) : undefined
      }
    }
    append(result.errors, entry.errors)
    append(result.warnings, entry.warnings)
  }
  return result
}

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
const issue = (code: string, vi: string, en: string, details: Pick<FilmPreflightIssue, 'nodeId' | 'clipId' | 'frame'> = {}): FilmPreflightIssue => ({ code, message: { vi, en }, ...details })

function hasAirborneMotion(project: UnifiedProject, nodeId: string, frame: number): boolean {
  return project.scene.content.timeline.animation.motionClips.some((clip) => {
    if (clip.target.nodeId !== nodeId || frame < clip.frameStart || frame > clip.frameEnd) return false
    const motion = project.motions[clip.motion.assetId]
    const assetId = motion?.assetId
    const name = assetId ? project.assets[assetId as keyof typeof project.assets]?.displayName ?? '' : ''
    return /jump|fall|leap|hop|nhay|roi/i.test(name)
  })
}

const samplingMessages: Record<string, [string, string]> = {
  PROJECT_INVALID: ['Dự án không hợp lệ để kiểm tra film.', 'The project is not valid for Film preflight.'],
  ARGUMENTS_INVALID: ['Tham số kiểm tra film không hợp lệ.', 'Film preflight arguments are invalid.'],
  CHARACTER_SELECTION_INVALID: ['Hãy chọn 1–64 nhân vật có trong dự án, không trùng lặp.', 'Select 1–64 unique Characters in this project.'],
  RANGE_INVALID: ['Khoảng xuất hoặc tỉ lệ khung hình không hợp lệ.', 'The export range or viewport aspect is invalid.'],
  TICK_LIMIT: ['Đoạn xuất phải nằm trên lưới 20 Hz và có 1–255 tick.', 'The export range must align to the 20 Hz grid and contain 1–255 ticks.'],
  SEQUENCE_INVALID: ['Cần một chuỗi camera hợp lệ.', 'A valid camera sequence is required.'],
  CAMERA_LIMIT: ['BBS Film hỗ trợ tối đa 3 camera trong một đoạn.', 'BBS Film supports up to 3 cameras per segment.'],
  SEQUENCE_GAP: ['Các cảnh phải nối tiếp nhau và phủ khoảng xuất.', 'Shots must be contiguous and cover the export range.'],
  CAMERA_CUT_GRID: ['Điểm cắt camera phải nằm trên lưới 20 Hz.', 'Camera cuts must align to the 20 Hz grid.'],
  CAMERA_PROJECTION: ['BBS Film cần camera phối cảnh.', 'BBS Film requires perspective cameras.'],
  SEQUENCE_COVERAGE: ['Các cảnh phải phủ chính xác khoảng xuất.', 'Shots must cover the export range exactly.'],
  RIG_UNSUPPORTED: ['Nhân vật cần rig đã nhập trực tiếp và không có pose thư viện chưa giải quyết.', 'Characters need imported direct rigs without unresolved library poses.'],
  MODEL_FORMAT_UNSUPPORTED: ['Nguồn model phải là FBX hoặc GLB.', 'Model sources must be FBX or GLB.'],
  BONE_PROFILE_INVALID: ['Tên hoặc số lượng xương vượt giới hạn BOBJ.', 'Bone names or count exceed the BOBJ profile limit.'],
  MODEL_UNITS_INVALID: ['Đơn vị nhân vật không khớp hồ sơ skeleton.', 'Character units do not match the skeleton profile.'],
  BONE_BUDGET: ['Đoạn xuất vượt ngân sách lấy mẫu xương; hãy rút ngắn đoạn hoặc chọn ít nhân vật hơn.', 'The export exceeds the bone sampling budget; shorten the range or select fewer characters.'],
  PROP_BONE_COUNT_UNAVAILABLE: ['Không thể xác định số xương của hậu cảnh được chọn từ hồ sơ nguồn.', 'Could not determine the selected backdrop bone count from its source profile.'],
}

/** Pure metadata/evidence preflight. Disk checks and CPU sampling are supplied by the Studio host. */
export function filmPreflight(project: UnifiedProject, args: FilmPreflightArgs): FilmPreflightResult {
  const result: FilmPreflightResult = { errors: [], warnings: [] }
  if (!isRecord(project) || !isRecord(args)) {
    result.errors.push(issue('INVALID_ARGUMENT', 'Dữ liệu kiểm tra không hợp lệ.', 'Invalid preflight input.'))
    return result
  }
  const addError = (entry: FilmPreflightIssue) => {
    if (!result.errors.some((prior) => prior.code === entry.code && prior.nodeId === entry.nodeId && prior.clipId === entry.clipId && prior.frame === entry.frame)) result.errors.push(entry)
  }
  try {
    const measured = filmAnchorPlacement(project, args)
    if (measured) {
      result.placement = measured.placement
      if (measured.below) result.warnings.push(issue('WORLD_ANCHOR_BELOW_FLOOR', 'Có actor dưới vị trí đứng hơn 1 block; kiểm tra lại điểm gốc và mặt đất.', 'An actor is over one block below the standing position; check the pivot and floor.'))
      if (measured.far) result.warnings.push(issue('WORLD_ANCHOR_FAR', 'Có actor cách vị trí đứng hơn 64 block.', 'An actor is over 64 blocks from the standing position.'))
    }
  } catch (error) {
    result.errors.push(issue('WORLD_ANCHOR_INVALID', error instanceof Error ? error.message : 'Không đo được điểm neo', 'Could not evaluate the world anchor.'))
  }
  const inspection = inspectProjectFilm(project, args, { includePropBudget: true, propBoneCounts: args.propBoneCounts })
  for (const validation of inspection.issues) {
    let code = `FILM_${validation.code}`
    let [vi, en] = samplingMessages[validation.code] ?? [validation.message, validation.message]
    if (validation.code === 'TICK_LIMIT' && args.range) {
      // One inspection code covers two different causes; name the real one so the user can fix it.
      const fps = project.scene.content.timeline.fps
      const frames = args.range.endFrame - args.range.startFrame + 1
      const ticks = frames / fps * FILM_TICK_RATE
      if (Number.isFinite(ticks) && Math.abs(ticks - Math.round(ticks)) > 1e-7) {
        code = 'FILM_TICK_GRID'
        vi = `Khoảng xuất ${args.range.startFrame}–${args.range.endFrame} lệch lưới ${FILM_TICK_RATE} tick: ${frames} frame ở ${fps} fps = ${ticks.toFixed(2)} tick, không phải số nguyên. Hãy chọn độ dài khoảng là bội của ${filmGridFrameStep(fps)} frame (panel Xuất tự làm tròn khi xuất Film).`
        en = `Export range ${args.range.startFrame}–${args.range.endFrame} is off the ${FILM_TICK_RATE} Hz tick grid: ${frames} frames at ${fps} fps = ${ticks.toFixed(2)} ticks, not a whole number. Use a range length that is a multiple of ${filmGridFrameStep(fps)} frames (the export panel rounds for single Films).`
      } else if (Number.isFinite(ticks) && ticks > FILM_MAX_TICKS) {
        vi = `Đoạn xuất dài ${Math.round(ticks)} tick, vượt giới hạn ${FILM_MAX_TICKS} tick của BBS Film; hãy rút ngắn khoảng xuất hoặc xuất theo chế độ Cả tập.`
        en = `The export spans ${Math.round(ticks)} ticks, over the BBS Film limit of ${FILM_MAX_TICKS} ticks; shorten the range or export the entire episode.`
      }
    }
    const character = validation.characterId ? project.characters[validation.characterId] : undefined
    const nodeId = character?.nodeId ?? validation.propId
    addError(issue(code, vi, en, nodeId ? { nodeId } : {}))
  }
  // An existing sequence with no shots is not "invalid": say so, and drop the misleading camera-limit error
  // the inspection adds because it cannot see the sequence at all in that state.
  const targetSequence = project.scene.content.editorial?.sequences.find((item) => item.id === args.sequenceId)
  if (targetSequence && targetSequence.clips.length === 0 && result.errors.some((entry) => entry.code === 'FILM_SEQUENCE_INVALID')) {
    for (let index = result.errors.length - 1; index >= 0; index--) {
      if (result.errors[index]!.code === 'FILM_SEQUENCE_INVALID' || result.errors[index]!.code === 'FILM_CAMERA_LIMIT') result.errors.splice(index, 1)
    }
    addError(issue('FILM_SEQUENCE_EMPTY',
      'Chuỗi camera chưa có shot nào. Hãy bấm nút "Tạo shot camera cho khoảng này" trong panel Xuất (shot Main Camera sẽ phủ đúng khoảng đang chọn), hoặc dựng shot trong trình biên tập chuỗi camera.',
      'The camera sequence has no shots yet. Use the "Create a camera shot for this range" button in the export panel (a Main Camera shot covering the selected range), or build shots in the sequence editor.'))
  }

  const range = args.range
  const selectedCharacters = Array.isArray(args.characterIds) ? args.characterIds : []
  const selectedProps = Array.isArray(args.propIds) ? args.propIds : []
  for (const propId of selectedProps) {
    try {
      resolveSceneBbsFilmArgs(project, { sequenceId: args.sequenceId, frameStart: range?.startFrame, frameEnd: range?.endFrame,
        characterIds: args.characterIds, propIds: [propId], viewportAspect: args.viewportAspect })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Backdrop selection is invalid'
      const transformFailure = message.includes('unit scale') || message.includes('turn around the vertical axis')
      const nodeId = propId
      addError(issue(transformFailure ? 'PROP_TRANSFORM_INVALID' : 'PROP_SELECTION_INVALID',
        transformFailure ? `Hậu cảnh ${propId} cần tỉ lệ đơn vị và chỉ xoay quanh trục Y.` : `Hậu cảnh được chọn không hợp lệ: ${message}`,
        transformFailure ? `Backdrop ${propId} must have unit scale and rotate only around Y.` : `Selected backdrop is invalid: ${message}`, { nodeId }))
    }
  }

  const sequence = project.scene.content.editorial?.sequences.find((item) => item.id === args.sequenceId)
  if (args.range) result.warnings.push(...filmCameraWarnings(project, args.sequenceId, args.range, args.viewportAspect))
  if (sequence) for (const clip of sequence.clips) {
    if (range && (clip.sourceFrameEnd < range.startFrame || clip.sourceFrameStart > range.endFrame)) continue
    const status = reviewStatusForSequence(project, sequence.id, clip.id)
    if (status.status !== 'ok') result.warnings.push(issue('SHOT_NOT_APPROVED', `Cảnh chưa được duyệt (${status.status}).`, `Shot is not approved (${status.status}).`, { clipId: clip.id }))
  }

  for (const characterId of selectedCharacters) {
    const character = project.characters[characterId]
    if (!character) continue
    if (args.assetAvailability?.[character.assetId] === false) addError(issue('ASSET_FILE_MISSING', `Thiếu file nguồn của nhân vật ${character.name}.`, `Source file for ${character.name} is missing.`, { nodeId: character.nodeId }))
    for (const clip of project.scene.content.timeline.animation.motionClips) {
      if (clip.target.nodeId !== character.nodeId || !range || clip.frameEnd < range.startFrame || clip.frameStart > range.endFrame) continue
      const motion = project.motions[clip.motion.assetId]
      if (motion && args.assetAvailability?.[motion.assetId] === false) addError(issue('ASSET_FILE_MISSING', `Thiếu file chuyển động của ${character.name}.`, `A motion source file for ${character.name} is missing.`, { nodeId: character.nodeId, clipId: clip.id }))
    }
  }
  for (const propId of selectedProps) {
    const node = project.scene.content.nodes.find((item) => item.id === propId && item.type === 'prop')
    const assetId = typeof node?.metadata?.assetId === 'string' ? node.metadata.assetId : undefined
    if (node && assetId && args.assetAvailability?.[assetId] === false) addError(issue('ASSET_FILE_MISSING', `Thiếu file hậu cảnh ${node.name}.`, `Backdrop file ${node.name} is missing.`, { nodeId: node.id }))
  }

  const extensions = project.extensions as Record<string, unknown>
  const vfx = isRecord(extensions.vfxCues) ? extensions.vfxCues : undefined
  const cues = Array.isArray(vfx?.cues) ? vfx.cues : []
  for (const raw of cues) {
    if (!isRecord(raw) || typeof raw.id !== 'string' || typeof raw.effect !== 'string') continue
    if (range && typeof raw.frameStart === 'number' && typeof raw.frameEnd === 'number' && (raw.frameStart > range.endFrame || raw.frameEnd < range.startFrame)) continue
    if (resolveFilmEffectsPolicy(args.effectsPolicy).mode === 'omit') {
      result.warnings.push(issue('VFX_OMITTED', `Không kèm hiệu ứng ${raw.effect}; tránh replay thiếu renderer khi game không có addon AAA.`, `Effect ${raw.effect} omitted to avoid missing AAA renderer replays without the addon.`, { clipId: raw.id }))
      continue
    }
    result.warnings.push(issue('VFX_BBS_MISSING', `Hiệu ứng ${raw.effect} chưa được xác nhận có bản dùng được trong BBS FS.`, `Effect ${raw.effect} has no confirmed BBS FS representation.`, { clipId: raw.id }))
  }

  if (args.samplingError) {
    addError(issue('FILM_SAMPLING_FAILED', `Không lấy được mẫu skeleton để kiểm tra biến đổi và chân: ${args.samplingError}`, `Skeleton sampling for preflight failed: ${args.samplingError}`))
  }
  // When sampling never ran because a precondition failed (off-grid range, empty sequence, missing
  // files, ...), those causes are already reported above; blaming the Character's transform misleads.
  const samplingExplained = !!args.samplingError || !!args.samplingBlockers?.length
  for (const characterId of selectedCharacters) {
    const character = project.characters[characterId]
    if (!character) continue
    const samples = args.footSamples?.[characterId]
    if (!samples?.length) {
      if (!samplingExplained) {
        addError(issue('CHARACTER_TRANSFORM_UNAVAILABLE', `Không thể đo biến đổi thực của ${character.name}; chưa thể xác nhận tỉ lệ/shear.`, `The world transform for ${character.name} could not be measured, so scale and shear cannot be checked.`, { nodeId: character.nodeId }))
        result.warnings.push(issue('FOOT_EVALUATION_UNAVAILABLE', `Không đủ dữ liệu skeleton đo chân của ${character.name}; cần kiểm tra vị trí sàn trong khung nhìn.`, `Skeleton foot data for ${character.name} is unavailable; check floor contact in the preview.`, { nodeId: character.nodeId }))
      }
      continue
    }
    const seenTransformCodes = new Set<string>()
    for (const sample of samples) {
      if (!sample.actorWorldMatrix) continue
      for (const transformIssue of inspectFilmActorTransform(sample.actorWorldMatrix, 0, undefined, filmCharacterHeight(project, character.nodeId, args.range.startFrame).actorScale).issues) {
        if (seenTransformCodes.has(transformIssue.code)) continue
        seenTransformCodes.add(transformIssue.code)
        const localized: Record<string, { code: string; vi: string; en: string }> = {
          TRANSFORM_SHEAR: { code: 'CHARACTER_TRANSFORM_SHEAR', vi: `${character.name} có biến dạng shear.`, en: `${character.name} has shear in its world transform.` },
          TRANSFORM_SCALE: { code: 'CHARACTER_TRANSFORM_SCALE', vi: `${character.name} có tỉ lệ khác 1.`, en: `${character.name} has non-unit world scale.` },
          TRANSFORM_ROLL: { code: 'CHARACTER_TRANSFORM_ROLL', vi: `${character.name} xoay roll mà BBS Film không hỗ trợ.`, en: `${character.name} has roll that BBS Film does not support.` },
          TRANSFORM_NUMERIC_RANGE: { code: 'CHARACTER_TRANSFORM_RANGE', vi: `Biến đổi của ${character.name} vượt giới hạn số của BBS Film.`, en: `${character.name}'s transform exceeds the BBS Film numeric range.` },
          MATRIX_INVALID: { code: 'CHARACTER_TRANSFORM_INVALID', vi: `Ma trận biến đổi của ${character.name} không hợp lệ.`, en: `${character.name}'s world matrix is invalid.` },
        }
        const translated = localized[transformIssue.code] ?? { code: 'CHARACTER_TRANSFORM_UNSUPPORTED', vi: `Biến đổi của ${character.name} không được BBS Film hỗ trợ.`, en: `${character.name}'s transform is not supported by BBS Film.` }
        addError(issue(translated.code, translated.vi, translated.en, { nodeId: character.nodeId, frame: sample.frame }))
      }
    }
    if (!samples.some((sample) => sample.actorWorldMatrix)) addError(issue('CHARACTER_TRANSFORM_UNAVAILABLE', `Không có ma trận biến đổi để kiểm tra ${character.name}.`, `No world matrix is available to validate ${character.name}.`, { nodeId: character.nodeId }))
    if (!samples.some((sample) => [sample.leftY, sample.rightY].some((value) => typeof value === 'number' && Number.isFinite(value)))) {
      result.warnings.push(issue('FOOT_EVALUATION_UNAVAILABLE', `Không đủ dữ liệu skeleton đo chân của ${character.name}; cần kiểm tra vị trí sàn trong khung nhìn.`, `Skeleton foot data for ${character.name} is unavailable; check floor contact in the preview.`, { nodeId: character.nodeId }))
      continue
    }
    const below = samples.find((sample) => [sample.leftY, sample.rightY].some((value) => typeof value === 'number' && Number.isFinite(value) && value < -0.05))
    if (below) result.warnings.push(issue('CHARACTER_BELOW_FLOOR', `${character.name} chìm dưới sàn tại frame ${below.frame}.`, `${character.name} is below the floor at frame ${below.frame}.`, { nodeId: character.nodeId, frame: below.frame }))
    const floating = samples.find((sample) => !(sample.airborne ?? hasAirborneMotion(project, character.nodeId, sample.frame)) &&
      typeof sample.leftY === 'number' && sample.leftY > 0.3 && typeof sample.rightY === 'number' && sample.rightY > 0.3)
    if (floating) result.warnings.push(issue('CHARACTER_FLOATING', `${character.name} lơ lửng (cả hai chân cao hơn sàn 0,3 m) tại frame ${floating.frame}.`, `${character.name} is floating (both feet are over 0.3 m above the floor) at frame ${floating.frame}.`, { nodeId: character.nodeId, frame: floating.frame }))
  }
  return result
}
