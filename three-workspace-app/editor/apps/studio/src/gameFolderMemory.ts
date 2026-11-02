/** B29/B50: remember game folders and the world chosen in each, per browser. */
export interface KeyValueStore { getItem(key: string): string | null; setItem(key: string, value: string): void }

export const GAME_DIR_KEY = 'topview-bbs-game-dir'
const RECENT_KEY = 'topview-bbs-game-dir-recent'
const WORLD_KEY = 'topview-bbs-world:'
const MAX_RECENT = 6

const folderKey = (gameDir: string) => gameDir.trim().replace(/[\\/]+$/, '').toLowerCase()

function read(store: KeyValueStore | undefined, key: string): string | null {
  try { return store?.getItem(key) ?? null } catch { return null }
}
function write(store: KeyValueStore | undefined, key: string, value: string): void {
  try { store?.setItem(key, value) } catch { /* Private mode: memory is a convenience only. */ }
}

export function recentGameDirs(store: KeyValueStore | undefined): string[] {
  try {
    const parsed = JSON.parse(read(store, RECENT_KEY) ?? '[]') as unknown
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string' && !!item.trim()).slice(0, MAX_RECENT) : []
  } catch { return [] }
}

/** Call once a folder was confirmed as a game folder (worlds read). */
export function rememberGameDir(store: KeyValueStore | undefined, gameDir: string): string[] {
  const next = [gameDir, ...recentGameDirs(store).filter((item) => folderKey(item) !== folderKey(gameDir))].slice(0, MAX_RECENT)
  write(store, GAME_DIR_KEY, gameDir)
  write(store, RECENT_KEY, JSON.stringify(next))
  return next
}

export function rememberWorld(store: KeyValueStore | undefined, gameDir: string, world: string): void {
  if (gameDir.trim() && world) write(store, WORLD_KEY + folderKey(gameDir), world)
}

/** The remembered world when it still exists, else the current choice, else the first world. */
export function pickWorld(store: KeyValueStore | undefined, gameDir: string, worlds: ReadonlyArray<{ name: string }>, current = ''): string {
  const names = worlds.map((world) => world.name)
  const remembered = read(store, WORLD_KEY + folderKey(gameDir))
  if (remembered && names.includes(remembered)) return remembered
  if (current && names.includes(current)) return current
  return names[0] ?? ''
}
