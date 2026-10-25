/** One scene metre is one Minecraft block; both spaces use +Y up and +Z forward. */
export interface FilmWorldAnchor {
  mode: 'local-origin' | 'scene-origin'
  /** Explicit world coordinates, never inferred from a live player. */
  destination?: [number, number, number]
  /** Fixed source pivot shared by every segment of a series. */
  sourceOrigin?: [number, number, number]
}

export const DEFAULT_FILM_WORLD_ANCHOR: FilmWorldAnchor = { mode: 'local-origin', destination: [0, 64, 0] }
type Point = { x: number; y: number; z: number }
type Manifest = { actors: Array<{ transformSamples: Point[] }>; cameras: Array<{ keyframes: Point[] }> }

/** Resolve once for a whole sequence, before splitting it into worker segments. */
export function resolveFilmWorldAnchor(anchor: FilmWorldAnchor | undefined, source: readonly number[]) {
  const choice = anchor ?? DEFAULT_FILM_WORLD_ANCHOR
  if (!choice || Object.keys(choice).some((key) => !['mode', 'destination', 'sourceOrigin'].includes(key)) || !['local-origin', 'scene-origin'].includes(choice.mode)) throw new TypeError('Invalid Film world anchor mode')
  const destination = choice.destination ?? [0, 64, 0]
  if (!Array.isArray(destination) || destination.length !== 3 || destination.some((n) => !Number.isFinite(n) || Math.abs(n) > 30_000_000) || source.length !== 3 || source.some((n) => !Number.isFinite(n))) throw new TypeError('Film world anchor requires finite XYZ coordinates within the world border')
  const origin = choice.mode === 'scene-origin' ? [0, 0, 0] : [...(choice.sourceOrigin ?? source)]
  if (origin.length !== 3 || origin.some((n) => !Number.isFinite(n))) throw new TypeError('Invalid Film source origin')
  const offset = choice.mode === 'scene-origin' ? [0, 0, 0] : destination.map((n, i) => n - origin[i]!)
  return { mode: choice.mode, sourceOrigin: origin, destination: choice.mode === 'scene-origin' ? [0, 0, 0] : [...destination], offset, units: 'metres-to-blocks-1:1', axes: '+Y-up,+Z-forward', playerPositionRead: false }
}

export function applyFilmWorldAnchor(manifest: Manifest, resolved: ReturnType<typeof resolveFilmWorldAnchor>, effects: Point[] = []) {
  for (const point of [...manifest.actors.flatMap((actor) => actor.transformSamples), ...manifest.cameras.flatMap((camera) => camera.keyframes), ...effects]) {
    point.x += resolved.offset[0]!
    point.y += resolved.offset[1]!
    point.z += resolved.offset[2]!
  }
}
