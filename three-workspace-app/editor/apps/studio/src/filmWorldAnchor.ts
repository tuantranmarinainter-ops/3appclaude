export { parseMinecraftTp } from './minecraftTp'
/** One scene metre is one Minecraft block; both spaces use +Y up and +Z forward. */
export interface FilmWorldAnchor {
  yawDegrees?: number
  pivot?: [number, number, number]
  pivotCharacterId?: string
  dimension?: string
  roundToBlock?: boolean
  mode?: 'local-origin' | 'scene-origin'
  /** Explicit world coordinates, never inferred from a live player. */
  destination?: [number, number, number]
  /** Fixed source pivot shared by every segment of a series. */
  sourceOrigin?: [number, number, number]
}

export const DEFAULT_FILM_WORLD_ANCHOR: FilmWorldAnchor = { mode: 'local-origin', destination: [0, 64, 0] }
type Point = { x: number; y: number; z: number; yaw?: number }
type Manifest = { actors: Array<{ transformSamples: Point[] }>; cameras: Array<{ keyframes: Point[] }> }

/** Resolve once for a whole sequence, before splitting it into worker segments. */
export function resolveFilmWorldAnchor(anchor: FilmWorldAnchor | undefined, source: readonly number[]) {
  const choice = anchor ?? DEFAULT_FILM_WORLD_ANCHOR
  const mode = choice?.mode ?? 'local-origin'
  if (!choice || typeof choice !== 'object' || Array.isArray(choice) || Object.keys(choice).some((key) => !['mode', 'destination', 'sourceOrigin', 'yawDegrees', 'pivot', 'pivotCharacterId', 'dimension', 'roundToBlock'].includes(key)) || !['local-origin', 'scene-origin'].includes(mode)) throw new TypeError('Invalid Film world anchor mode')
  if (choice.yawDegrees !== undefined && !Number.isFinite(choice.yawDegrees) || choice.roundToBlock !== undefined && typeof choice.roundToBlock !== 'boolean' || choice.pivotCharacterId !== undefined && typeof choice.pivotCharacterId !== 'string' || choice.dimension !== undefined && (typeof choice.dimension !== 'string' || !/^[a-z0-9_.-]+:[a-z0-9_./-]+$/.test(choice.dimension))) throw new TypeError('Điểm neo hoặc hướng nhìn không hợp lệ')
  const rawDestination = choice.destination ?? [0, 64, 0]
  const destination = choice.roundToBlock && Array.isArray(rawDestination) ? rawDestination.map((v, i) => i === 1 ? Math.round(v) : Math.floor(v) + 0.5) : rawDestination
  if (!Array.isArray(destination) || destination.length !== 3 || destination.some((n) => !Number.isFinite(n) || Math.abs(n) > 30_000_000) || source.length !== 3 || source.some((n) => !Number.isFinite(n))) throw new TypeError('Film world anchor requires finite XYZ coordinates within the world border')
  const origin = mode === 'scene-origin' ? [0, 0, 0] : [...(choice.pivot ?? choice.sourceOrigin ?? source)]
  if (origin.length !== 3 || origin.some((n) => !Number.isFinite(n))) throw new TypeError('Invalid Film source origin')
  const offset = mode === 'scene-origin' ? [0, 0, 0] : destination.map((n, i) => n - origin[i]!)
  return { yawDegrees: mode === 'scene-origin' ? 0 : choice.yawDegrees ?? 0, dimension: choice.dimension, mode, sourceOrigin: origin, destination: mode === 'scene-origin' ? [0, 0, 0] : [...destination], offset, units: 'metres-to-blocks-1:1', axes: '+Y-up,+Z-forward', playerPositionRead: false }
}

export function applyFilmWorldAnchor(manifest: Manifest, resolved: ReturnType<typeof resolveFilmWorldAnchor>, effects: Point[] = []) {
  for (const point of [...manifest.actors.flatMap((actor) => actor.transformSamples), ...manifest.cameras.flatMap((camera) => camera.keyframes), ...effects]) {
    const radians = resolved.yawDegrees * Math.PI / 180
    const x = point.x - resolved.sourceOrigin[0]!, z = point.z - resolved.sourceOrigin[2]!
    point.x = resolved.destination[0]! + Math.cos(radians) * x - Math.sin(radians) * z
    point.y += resolved.offset[1]!
    point.z = resolved.destination[2]! + Math.sin(radians) * x + Math.cos(radians) * z
    if (typeof point.yaw === 'number') point.yaw += resolved.yawDegrees
  }
}
