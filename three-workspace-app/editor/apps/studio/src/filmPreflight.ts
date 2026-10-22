import type { UnifiedProject } from '@bbs/animation-workspace-shared'
import { inspectFilmActorTransform } from './filmManifest'
import { inspectProjectFilm, type FilmSamplingArgs } from './unifiedFilmSampling'
import { reviewStatusForSequence } from './sceneReview'
import { resolveSceneBbsFilmArgs } from './sceneBbsFilm'

export interface FilmPreflightIssue {
  code: string
  message: { vi: string; en: string }
  nodeId?: string
  clipId?: string
  frame?: number
}

export interface FilmPreflightArgs extends FilmSamplingArgs {
  /** Store supplied evidence after checking the immutable asset references on disk. */
  assetAvailability?: Record<string, boolean>
  /** Conservative source-profile bone counts supplied by the host for selected model props. */
  propBoneCounts?: Record<string, number>
  /** CPU skeleton samples; omitted when source evaluation is unavailable. */
  footSamples?: Record<string, Array<{ frame: number; leftY?: number; rightY?: number; airborne?: boolean; actorWorldMatrix?: number[] }>>
}

export interface FilmPreflightResult { errors: FilmPreflightIssue[]; warnings: FilmPreflightIssue[] }

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
  const inspection = inspectProjectFilm(project, args, { includePropBudget: true, propBoneCounts: args.propBoneCounts })
  for (const validation of inspection.issues) {
    const [vi, en] = samplingMessages[validation.code] ?? [validation.message, validation.message]
    const character = validation.characterId ? project.characters[validation.characterId] : undefined
    const nodeId = character?.nodeId ?? validation.propId
    addError(issue(`FILM_${validation.code}`, vi, en, nodeId ? { nodeId } : {}))
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
    result.warnings.push(issue('VFX_BBS_MISSING', `Hiệu ứng ${raw.effect} chưa được xác nhận có bản dùng được trong BBS FS.`, `Effect ${raw.effect} has no confirmed BBS FS representation.`, { clipId: raw.id }))
  }

  for (const characterId of selectedCharacters) {
    const character = project.characters[characterId]
    if (!character) continue
    const samples = args.footSamples?.[characterId]
    if (!samples?.length) {
      addError(issue('CHARACTER_TRANSFORM_UNAVAILABLE', `Không thể đo biến đổi thực của ${character.name}; chưa thể xác nhận tỉ lệ/shear.`, `The world transform for ${character.name} could not be measured, so scale and shear cannot be checked.`, { nodeId: character.nodeId }))
      result.warnings.push(issue('FOOT_EVALUATION_UNAVAILABLE', `Không đủ dữ liệu skeleton đo chân của ${character.name}; cần kiểm tra vị trí sàn trong khung nhìn.`, `Skeleton foot data for ${character.name} is unavailable; check floor contact in the preview.`, { nodeId: character.nodeId }))
      continue
    }
    const seenTransformCodes = new Set<string>()
    for (const sample of samples) {
      if (!sample.actorWorldMatrix) continue
      for (const transformIssue of inspectFilmActorTransform(sample.actorWorldMatrix, 0).issues) {
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
