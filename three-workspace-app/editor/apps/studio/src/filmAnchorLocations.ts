import { resolveFilmWorldAnchor, type FilmWorldAnchor } from './filmWorldAnchor'

export interface FilmAnchorLocation { name: string; anchor: FilmWorldAnchor }
export function readFilmAnchorLocations(extensions: Record<string, unknown>): FilmAnchorLocation[] {
  const extension = extensions.filmAnchorLocations as { version?: unknown; locations?: unknown } | undefined
  const raw = extension?.version === 1 ? extension.locations : undefined
  if (!Array.isArray(raw)) return []
  return raw.filter((v): v is FilmAnchorLocation => {
    if (!v || typeof v !== 'object' || typeof v.name !== 'string' || !v.name.trim()) return false
    try { resolveFilmWorldAnchor(v.anchor, [0, 0, 0]); return true } catch { return false }
  })
}
export function writeFilmAnchorLocation(extensions: Record<string, unknown>, name: unknown, anchor: FilmWorldAnchor): Record<string, unknown> {
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 100) throw new TypeError('Tên địa điểm cần 1–100 ký tự')
  if (!anchor || typeof anchor !== 'object' || Array.isArray(anchor)) throw new TypeError('Điểm neo không hợp lệ')
  resolveFilmWorldAnchor(anchor, [0, 0, 0])
  // A location stores the game destination/direction, so another shot can choose its own pivot.
  const { pivot: _pivot, pivotCharacterId: _character, sourceOrigin: _origin, ...location } = anchor
  const entries = readFilmAnchorLocations(extensions).filter((v) => v.name !== name.trim())
  if (entries.length >= 100) throw new TypeError('Dự án đã có 100 địa điểm')
  return { ...extensions, filmAnchorLocations: { version: 1, locations: [...entries, { name: name.trim(), anchor: location }] } }
}
