/** Persisted framing preference for BBS Film exports and preview. */
export type FilmFrameAspect = '16:9' | '9:16' | '1:1' | number

export const DEFAULT_FILM_FRAME_ASPECT = 16 / 9

export interface FilmFrameDimensions { width: number; height: number; aspect: number; aspectError: number }

type Extensions = Record<string, unknown> | null | undefined

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Resolve a saved frame aspect. Older projects and malformed extension data use the historical 16:9 default. */
export function readFilmFrameAspect(extensions: Extensions): number {
  if (!isRecord(extensions) || !isRecord(extensions.filmFrame)) return DEFAULT_FILM_FRAME_ASPECT
  const value = extensions.filmFrame.aspect
  if (value === '16:9') return 16 / 9
  if (value === '9:16') return 9 / 16
  if (value === '1:1') return 1
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : DEFAULT_FILM_FRAME_ASPECT
}

/** A per-command numeric aspect wins; otherwise use the saved value or the legacy 16:9 default. */
export function resolveFilmFrameAspect(extensions: Extensions, override?: unknown): number {
  if (override === undefined) return readFilmFrameAspect(extensions)
  if (typeof override !== 'number' || !Number.isFinite(override) || override <= 0) {
    throw new TypeError('viewportAspect must be a positive finite number')
  }
  return override
}

/** Fit output dimensions inside the caller's requested bounds without stretching the selected film aspect. */
export function fitFilmFrameDimensions(maxWidth: number, maxHeight: number, aspect: number): FilmFrameDimensions {
  if (![maxWidth, maxHeight, aspect].every(Number.isFinite) || !Number.isInteger(maxWidth) || !Number.isInteger(maxHeight) ||
      maxWidth < 64 || maxHeight < 64 || aspect <= 0) {
    throw new RangeError('Render bounds must be integers >=64 and film aspect must be positive and finite')
  }
  const namedRatios: Array<[number, number]> = [[16, 9], [9, 16], [1, 1]]
  const namedRatio = namedRatios.find(([numerator, denominator]) => Math.abs(aspect - numerator / denominator) < 1e-12)
  let width: number
  let height: number
  if (namedRatio) {
    const [numerator, denominator] = namedRatio
    const multiple = Math.floor(Math.min(maxWidth / numerator, maxHeight / denominator))
    width = numerator * multiple
    height = denominator * multiple
  } else {
    width = maxWidth
    height = maxHeight
    if (maxWidth / maxHeight > aspect) width = Math.round(maxHeight * aspect)
    else height = Math.round(maxWidth / aspect)
  }
  if (width < 64 || height < 64) throw new RangeError('Film aspect does not fit inside render bounds at the minimum 64 pixel output size')
  const actualAspect = width / height
  return { width, height, aspect: actualAspect, aspectError: Math.abs(actualAspect - aspect) }
}

/** Validate and immutably write the extension value; the project store owns revision checks and persistence. */
export function writeFilmFrameAspect(extensions: Extensions, aspect: FilmFrameAspect): Record<string, unknown> {
  if (!(aspect === '16:9' || aspect === '9:16' || aspect === '1:1' ||
      (typeof aspect === 'number' && Number.isFinite(aspect) && aspect > 0))) {
    throw new TypeError('Film frame aspect must be 16:9, 9:16, 1:1, or a positive finite number')
  }
  const source = isRecord(extensions) ? extensions : {}
  return { ...source, filmFrame: { aspect } }
}
