import { unzipSync } from 'node:zlib'

/**
 * B64: which assets does a BBS film still need?
 *
 * A film `.dat` is the BBS binary codec ("BBS1" + length-prefixed strings), usually gzip-compressed. Models are
 * referenced by id (`unified/<hash>`), effects by `assets:effeks/<namespace>/<name>.efkefc`, other files by
 * `assets:<path>`. We do not need the whole codec: every reference is a plain string inside the decompressed bytes,
 * so each candidate asset derives a key and we look for that key as text. The search only ever over-keeps
 * (substring match, no right boundary), never under-keeps, because deleting a needed model breaks later films.
 */

const MAX_FILM_BYTES = 256 * 1024 * 1024
/** Sub-folders of a model folder; they never belong to the model id. */
const MODEL_SUBFOLDERS = new Set(['textures', 'animations', 'sounds'])

/** Decompress (gzip or zlib) when the bytes look compressed, else use them as they are. Throws on corrupt data. */
export function filmReferenceText(bytes: Uint8Array): string {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const compressed = buffer.length > 1 && (buffer[0] === 0x1f && buffer[1] === 0x8b || buffer[0] === 0x78 && ((buffer[0]! << 8) + buffer[1]!) % 31 === 0)
  const raw = compressed ? unzipSync(buffer, { maxOutputLength: MAX_FILM_BYTES }) : buffer
  // latin1 keeps every byte one character, so UTF-8 names compare byte for byte against keys built the same way.
  return raw.toString('latin1').toLowerCase()
}

const asBytesText = (value: string) => Buffer.from(value, 'utf8').toString('latin1').toLowerCase()

/** Key that a film must contain for the asset (path relative to `config/bbs/assets`) to still be needed. */
export function assetReferenceKey(relativePath: string): string {
  const parts = relativePath.split('/').filter(Boolean)
  const head = parts[0]?.toLowerCase()
  if (head === 'models' && parts.length >= 3) {
    const folders = parts.slice(1, -1)
    const cut = folders.findIndex((part) => MODEL_SUBFOLDERS.has(part.toLowerCase()))
    const id = (cut >= 0 ? folders.slice(0, cut) : folders).slice(0, 2)
    if (id.length) return asBytesText(id.join('/'))
  }
  if (head === 'effeks' && parts.length >= 3) return asBytesText(parts.slice(0, 2).join('/'))
  return asBytesText(parts.join('/'))
}

function containsKey(text: string, key: string): boolean {
  if (!key) return true
  for (let at = text.indexOf(key); at >= 0; at = text.indexOf(key, at + 1)) {
    if (at === 0) return true
    const before = text.charCodeAt(at - 1)
    // Left boundary: path separator, `assets:` colon, a control byte, or the single length byte BBS writes before a string.
    if (before === 0x2f || before === 0x3a || before < 0x20 || at === 1 || text.charCodeAt(at - 2) < 0x20) return true
  }
  return false
}

export interface FilmReferenceIndex {
  /** Films that could not be read; their references are unknown, so nothing may be treated as unreferenced. */
  unreadable: string[]
  isReferenced(relativeAssetPath: string): boolean
}

/** `films` are the films that remain after a cleanup/uninstall, in any world of the game. */
export function buildReferenceIndex(films: ReadonlyArray<{ name: string; bytes: Uint8Array }>): FilmReferenceIndex {
  const texts: string[] = [], unreadable: string[] = []
  for (const film of films) {
    try { texts.push(filmReferenceText(film.bytes)) } catch { unreadable.push(film.name) }
  }
  const cache = new Map<string, boolean>()
  return {
    unreadable,
    isReferenced(relativeAssetPath) {
      if (unreadable.length) return true
      const key = assetReferenceKey(relativeAssetPath)
      let known = cache.get(key)
      if (known === undefined) { known = texts.some((text) => containsKey(text, key)); cache.set(key, known) }
      return known
    },
  }
}
