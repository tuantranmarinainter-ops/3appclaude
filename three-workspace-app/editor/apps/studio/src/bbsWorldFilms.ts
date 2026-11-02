import { lstat, readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { buildReferenceIndex, type FilmReferenceIndex } from './bbsFilmRefs'

const MAX_FILM_FILE = 128 * 1024 * 1024

export interface WorldFilm { world: string; name: string; relPath: string; absPath: string; sizeBytes: number; mtimeMs: number }

const isPlainDir = async (folder: string) => { try { const info = await lstat(folder); return info.isDirectory() && !info.isSymbolicLink() } catch { return false } }

/** Every `saves/<world>/bbs/films/*.dat` of the game (all worlds: a model installed for one world may serve another). Linked folders are skipped. */
export async function listWorldFilms(root: string, onlyWorld?: string): Promise<{ films: WorldFilm[]; unreadable: string[] }> {
  const films: WorldFilm[] = [], unreadable: string[] = []
  const saves = path.join(root, 'saves')
  if (!(await isPlainDir(saves))) return { films, unreadable }
  for (const world of await readdir(saves, { withFileTypes: true })) {
    if (!world.isDirectory() || world.isSymbolicLink() || (onlyWorld !== undefined && world.name !== onlyWorld)) continue
    const folder = path.join(saves, world.name, 'bbs', 'films')
    if (!(await isPlainDir(path.join(saves, world.name))) || !(await isPlainDir(path.join(saves, world.name, 'bbs'))) || !(await isPlainDir(folder))) continue
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      if (!/\.dat$/i.test(entry.name)) continue
      const absPath = path.join(folder, entry.name), relPath = `saves/${world.name}/bbs/films/${entry.name}`
      try {
        const info = await lstat(absPath)
        if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_FILM_FILE) { unreadable.push(relPath); continue }
        films.push({ world: world.name, name: entry.name, relPath, absPath, sizeBytes: info.size, mtimeMs: info.mtimeMs })
      } catch { unreadable.push(relPath) }
    }
  }
  return { films, unreadable }
}

/** Reference index over every film that stays on disk (`exclude` = absolute paths about to be removed). */
export async function remainingFilmIndex(root: string, exclude: ReadonlySet<string> = new Set()): Promise<FilmReferenceIndex> {
  const { films, unreadable } = await listWorldFilms(root)
  const keep = films.filter((film) => !exclude.has(path.resolve(film.absPath)))
  const loaded: Array<{ name: string; bytes: Uint8Array }> = []
  const failed = [...unreadable]
  for (const film of keep) {
    try { loaded.push({ name: film.relPath, bytes: await readFile(film.absPath) }) } catch { failed.push(film.relPath) }
  }
  const index = buildReferenceIndex(loaded)
  const all = [...failed, ...index.unreadable]
  return { unreadable: all, isReferenced: (relative) => all.length ? true : index.isReferenced(relative) }
}
