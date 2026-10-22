import type { UnifiedProject } from '@bbs/animation-workspace-shared'
import { preflightProjectFilm, type FilmSamplingArgs } from './unifiedFilmSampling'
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
  propIds?: string[]
  /** Store supplied evidence after checking the immutable asset references on disk. */
  assetAvailability?: Record<string, boolean>
  /** CPU skeleton samples; omitted when source evaluation is unavailable. */
  footSamples?: Record<string, Array<{ frame: number; leftY?: number; rightY?: number; airborne?: boolean }>>
}

export interface FilmPreflightResult {
  errors: FilmPreflightIssue[]
  warnings: FilmPreflightIssue[]
}

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
const issue = (code: string, vi: string, en: string, details: Pick<FilmPreflightIssue, 'nodeId' | 'clipId' | 'frame'> = {}): FilmPreflightIssue => ({ code, message: { vi, en }, ...details })

function classifySamplingFailure(message: string): FilmPreflightIssue {
  if (message.includes('1-255 ticks')) return issue('FILM_TICK_LIMIT', 'Đoạn xuất phải nằm trên lưới 20 Hz và có 1–255 tick.', 'The export range must align to the 20 Hz grid and contain 1–255 ticks.')
  if (message.includes('1-3 camera shots')) return issue('FILM_CAMERA_LIMIT', 'BBS Film hỗ trợ tối đa 3 camera trong một đoạn.', 'BBS Film supports up to 3 cameras per segment.')
  if (message.includes('bone sample budget')) return issue('FILM_BONE_BUDGET', 'Đoạn xuất vượt ngân sách lấy mẫu xương; hãy rút ngắn đoạn hoặc chọn ít nhân vật hơn.', 'The export exceeds the bone sampling budget; shorten the range or select fewer characters.')
  return issue('FILM_SAMPLING_INVALID', message, message)
}

function hasAirborneMotion(project: UnifiedProject, nodeId: string, frame: number): boolean {
  return project.scene.content.timeline.animation.motionClips.some((clip) => {
    if (clip.target.nodeId !== nodeId || frame < clip.frameStart || frame > clip.frameEnd) return false
    const motion = project.motions[clip.motion.assetId]
    const assetId = motion?.assetId
    const name = assetId ? project.assets[assetId as keyof typeof project.assets]?.displayName ?? '' : ''
    return /jump|fall|leap|hop|nhay|roi/i.test(name)
  })
}

/** Pure metadata/evidence preflight. Disk checks and CPU sampling are supplied by the Studio host. */
export function filmPreflight(project: UnifiedProject, args: FilmPreflightArgs): FilmPreflightResult {
  const result: FilmPreflightResult = { errors: [], warnings: [] }
  if (!isRecord(project) || !isRecord(args)) {
    result.errors.push(issue('INVALID_ARGUMENT', 'Dữ liệu kiểm tra không hợp lệ.', 'Invalid preflight input.'))
    return result
  }
  let samplingReady = false
  try {
    preflightProjectFilm(project, args)
    samplingReady = true
  } catch (error) {
    result.errors.push(classifySamplingFailure(error instanceof Error ? error.message : 'Film sampling arguments are invalid'))
  }

  result.errors.push(issue('PREFLIGHT_INCOMPLETE_TRANSFORMS', 'Chưa thể duyệt xuất: bộ kiểm dùng chung cho shear/tỉ lệ nhân vật và biến đổi hậu cảnh chưa được nối vào.', 'Export is blocked: the shared character shear/scale and backdrop transform validators are not connected yet.'))
  if (!samplingReady) result.errors.push(issue('PREFLIGHT_INCOMPLETE_LIMIT_AGGREGATION', 'Chưa thể liệt kê chắc chắn mọi lỗi giới hạn: bộ kiểm Film hiện chỉ trả lỗi đầu tiên.', 'Not all limit errors can be listed yet: the existing Film validator reports only its first failure.'))

  if (args.propIds !== undefined) {
    try {
      resolveSceneBbsFilmArgs(project, { sequenceId: args.sequenceId, frameStart: args.range?.startFrame, frameEnd: args.range?.endFrame,
        characterIds: args.characterIds, propIds: args.propIds, viewportAspect: args.viewportAspect })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Backdrop selection is invalid'
      const transformFailure = message.includes('unit scale') || message.includes('turn around the vertical axis')
      result.errors.push(issue(transformFailure ? 'PROP_TRANSFORM_INVALID' : 'PROP_SELECTION_INVALID',
        `Hậu cảnh được chọn không hợp lệ: ${message}`, `Selected backdrop is invalid: ${message}`))
    }
  }

  const sequence = project.scene.content.editorial?.sequences.find((item) => item.id === args.sequenceId)
  if (sequence) {
    for (const clip of sequence.clips) {
      if (args.range && (clip.sourceFrameEnd < args.range.startFrame || clip.sourceFrameStart > args.range.endFrame)) continue
      const status = reviewStatusForSequence(project, sequence.id, clip.id)
      if (status.status !== 'ok') {
        result.warnings.push(issue('SHOT_NOT_APPROVED', `Cảnh chưa được duyệt (${status.status}).`, `Shot is not approved (${status.status}).`, { clipId: clip.id }))
      }
    }
  }

  for (const characterId of Array.isArray(args.characterIds) ? args.characterIds : []) {
    const character = project.characters[characterId]
    if (!character) continue
    const assetId = character.assetId
    if (args.assetAvailability?.[assetId] === false) {
      result.errors.push(issue('ASSET_FILE_MISSING', `Thiếu file nguồn của nhân vật ${character.name}.`, `Source file for ${character.name} is missing.`, { nodeId: character.nodeId }))
    }
    for (const clip of project.scene.content.timeline.animation.motionClips) {
      if (clip.target.nodeId !== character.nodeId || !args.range || clip.frameEnd < args.range.startFrame || clip.frameStart > args.range.endFrame) continue
      const motion = project.motions[clip.motion.assetId]
      if (motion && args.assetAvailability?.[motion.assetId] === false) {
        result.errors.push(issue('ASSET_FILE_MISSING', `Thiếu file chuyển động của ${character.name}.`, `A motion source file for ${character.name} is missing.`, { nodeId: character.nodeId, clipId: clip.id }))
      }
    }
  }
  for (const propId of Array.isArray(args.propIds) ? args.propIds : []) {
    const node = project.scene.content.nodes.find((item) => item.id === propId && item.type === 'prop')
    const assetId = typeof node?.metadata?.assetId === 'string' ? node.metadata.assetId : undefined
    if (node && assetId && args.assetAvailability?.[assetId] === false) {
      result.errors.push(issue('ASSET_FILE_MISSING', `Thiếu file hậu cảnh ${node.name}.`, `Backdrop file ${node.name} is missing.`, { nodeId: node.id }))
    }
  }
  const extensions = project.extensions as Record<string, unknown>
  const vfx = isRecord(extensions.vfxCues) ? extensions.vfxCues : undefined
  const cues = Array.isArray(vfx?.cues) ? vfx.cues : []
  for (const raw of cues) {
    if (!isRecord(raw) || typeof raw.id !== 'string' || typeof raw.effect !== 'string' ||
        typeof raw.frameStart === 'number' && args.range && raw.frameStart > args.range.endFrame ||
        typeof raw.frameEnd === 'number' && args.range && raw.frameEnd < args.range.startFrame) continue
    result.warnings.push(issue('VFX_BBS_MISSING', `Hiệu ứng ${raw.effect} chưa được xác nhận có bản dùng được trong BBS FS.`, `Effect ${raw.effect} has no confirmed BBS FS representation.`, { clipId: raw.id }))
  }

  for (const characterId of Array.isArray(args.characterIds) ? args.characterIds : []) {
    const character = project.characters[characterId]
    if (!character) continue
    const samples = args.footSamples?.[characterId]
    if (!samples?.length || !samples.some((sample) => [sample.leftY, sample.rightY].some((value) => typeof value === 'number' && Number.isFinite(value)))) {
      result.warnings.push(issue('FOOT_EVALUATION_UNAVAILABLE', `Không đủ dữ liệu đo chân của ${character.name}; cần kiểm tra vị trí sàn trong khung nhìn.`, `Foot positions for ${character.name} could not be measured; check floor contact in the preview.`, { nodeId: character.nodeId }))
      continue
    }
    for (const sample of samples) {
      const feet = [sample.leftY, sample.rightY].filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
      if (feet.some((y) => y < -0.05)) {
        result.warnings.push(issue('CHARACTER_BELOW_FLOOR', `${character.name} chìm dưới sàn tại frame ${sample.frame}.`, `${character.name} is below the floor at frame ${sample.frame}.`, { nodeId: character.nodeId, frame: sample.frame }))
        break
      }
    }
    for (const sample of samples) {
      if (!(sample.airborne ?? hasAirborneMotion(project, character.nodeId, sample.frame)) && [sample.leftY, sample.rightY].filter((value): value is number => typeof value === 'number' && Number.isFinite(value)).length === 2 &&
          sample.leftY! > 0.3 && sample.rightY! > 0.3) {
        result.warnings.push(issue('CHARACTER_FLOATING', `${character.name} lơ lửng (cả hai chân cao hơn sàn 0,3 m) tại frame ${sample.frame}.`, `${character.name} is floating (both feet are over 0.3 m above the floor) at frame ${sample.frame}.`, { nodeId: character.nodeId, frame: sample.frame }))
        break
      }
    }
  }

  // Invalid sampling inputs cannot produce trusted foot samples; the evidence remains optional for pure callers.
  void samplingReady
  return result
}
