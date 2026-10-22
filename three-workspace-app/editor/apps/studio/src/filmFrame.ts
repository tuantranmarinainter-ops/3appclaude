/** Persisted framing preference for BBS Film exports and preview. */
export type FilmFrameAspect = '16:9' | '9:16' | '1:1' | number

export const DEFAULT_FILM_FRAME_ASPECT = 16 / 9

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

/** Validate and immutably write the extension value; the project store owns revision checks and persistence. */
export function writeFilmFrameAspect(extensions: Extensions, aspect: FilmFrameAspect): Record<string, unknown> {
  if (!(aspect === '16:9' || aspect === '9:16' || aspect === '1:1' ||
      (typeof aspect === 'number' && Number.isFinite(aspect) && aspect > 0))) {
    throw new TypeError('Film frame aspect must be 16:9, 9:16, 1:1, or a positive finite number')
  }
  const source = isRecord(extensions) ? extensions : {}
  return { ...source, filmFrame: { aspect } }
}
