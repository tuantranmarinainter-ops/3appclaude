import { createHash } from 'node:crypto'
import { lstat, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises'
import path from 'node:path'

const MAX_FILE = 64 * 1024 * 1024
const MAX_TOTAL = 128 * 1024 * 1024
const MAX_FILES = 2048
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const inside = (root: string, file: string) => file.startsWith(`${root}${path.sep}`)

/** Effekseer 1.80.6 IO/EfkEfc.cs: EFKE container, INFO dependency list (no native runtime required).
 * Unknown exporter versions fail closed instead of silently dropping future resource types.
 */
export function aaaEffectDependencies(bytes: Buffer): string[] {
  if (bytes.length > MAX_FILE || bytes.length < 24 || bytes.toString('ascii', 0, 4) !== 'EFKE' || bytes.readInt32LE(4) !== 0) throw new TypeError('AAA cần tài liệu .efkefc hợp lệ; không đổi đuôi .efk')
  const chunks = new Map<string, Buffer>()
  for (let cursor = 8; cursor < bytes.length;) {
    if (cursor + 8 > bytes.length) throw new TypeError('AAA: chunk .efkefc bị cắt')
    const name = bytes.toString('ascii', cursor, cursor + 4), size = bytes.readUInt32LE(cursor + 4)
    cursor += 8
    if (size > bytes.length - cursor || chunks.has(name)) throw new TypeError('AAA: chunk .efkefc không hợp lệ')
    chunks.set(name, bytes.subarray(cursor, cursor + size)); cursor += size
  }
  const info = chunks.get('INFO')
  if (!info || !chunks.get('EDIT')?.length || !chunks.get('BIN_')?.length) throw new TypeError('AAA: thiếu INFO/EDIT/BIN_ trong .efkefc')
  let cursor = 0
  const int = () => {
    if (cursor + 4 > info.length) throw new TypeError('AAA: INFO bị cắt')
    const value = info.readInt32LE(cursor); cursor += 4; return value
  }
  const count = () => { const value = int(); if (value < 0 || value > MAX_FILES) throw new TypeError('AAA: quá nhiều tài nguyên'); return value }
  const string = () => {
    const units = int(), size = units * 2
    if (units < 1 || units > 32768 || size > info.length - cursor || info.readUInt16LE(cursor + size - 2) !== 0) throw new TypeError('AAA: đường dẫn INFO không hợp lệ')
    const value = info.toString('utf16le', cursor, cursor + size - 2); cursor += size
    if (value.includes('\0') || value.includes('\ufffd')) throw new TypeError('AAA: đường dẫn INFO không hợp lệ')
    return value
  }
  const version = int(), result: string[] = []
  if (![1500, 1600, 1601, 1602, 1603, 1604, 1605, 1606, 1607, 1608, 1610, 1700, 1701, 1702, 1703, 1704, 1705, 1710, 1800, 1801, 1802, 1810].includes(version)) throw new TypeError(`AAA: chưa hỗ trợ INFO phiên bản ${version}`)
  if (version <= 1610) {
    for (let kind = 0; kind < (version === 1500 ? 6 : 7); kind++) {
      const length = count()
      if (kind === 4 && length) throw new TypeError('AAA addon chưa hỗ trợ âm thanh trong hiệu ứng')
      for (let index = 0; index < length; index++) result.push(string())
    }
  } else {
    const length = count()
    for (let index = 0; index < length; index++) {
      const kind = int(), flags = int() // FileType, color-space flags
      if (flags < 0 || flags > 3 || (kind !== 1 && flags !== 0)) throw new TypeError('AAA: cờ tài nguyên INFO không hợp lệ')
      // Effekseer FileType: Texture=1, Sound=2, Model=3, Material=4, Curve=5.
      if (kind === 2) throw new TypeError('AAA addon chưa hỗ trợ âm thanh trong hiệu ứng')
      if (![1, 3, 4, 5].includes(kind)) throw new TypeError(`AAA: loại tài nguyên chưa hỗ trợ ${kind}`)
      result.push(string())
    }
  }
  if (cursor !== info.length || result.length > MAX_FILES) throw new TypeError('AAA: INFO không hợp lệ')
  return [...new Set(result.filter(Boolean))]
}

function portableName(value: string): void {
  if (!value || /[\\:\x00-\x1f<>"|?*]/.test(value) || /[ .]$/.test(value) || /^(con|prn|aux|nul|conin\$|conout\$|com[1-9¹²³]|lpt[1-9¹²³])(?:\..*)?$/i.test(value)) throw new TypeError('AAA: tên tài nguyên không an toàn')
}

async function sourceBytes(root: string, file: string): Promise<Buffer> {
  if (!inside(root, file)) throw new TypeError('AAA: tài nguyên vượt ngoài W01_AAA_ASSETS')
  let current = root
  for (const part of path.relative(root, file).split(path.sep)) {
    portableName(part); current = path.join(current, part)
    const info = await lstat(current)
    if (info.isSymbolicLink()) throw new TypeError('AAA: không dùng liên kết tượng trưng cho tài nguyên')
  }
  const info = await lstat(file)
  if (!info.isFile() || info.size > MAX_FILE || await realpath(file) !== file) throw new TypeError('AAA: tài nguyên không phải file an toàn hoặc quá lớn')
  const bytes = await readFile(file)
  if (bytes.length > MAX_FILE) throw new TypeError('AAA: tài nguyên quá lớn')
  return bytes
}

export interface FilmAaaAssetPackage {
  namespace: string
  effectPaths: ReadonlyMap<string, string>
  files: Array<{ path: string; sha256: string; bytes: Buffer }>
}

/** Read-only source root; retain relative dependency layout, including safe ../ references inside root. */
export async function collectFilmAaaAssets(projectId: string, effects: readonly { effect: string }[], sourceRoot = process.env.W01_AAA_ASSETS?.trim(), signal?: AbortSignal): Promise<FilmAaaAssetPackage> {
  const namespace = `project-${hash(Buffer.from(projectId)).slice(0, 24)}`
  const effectPaths = new Map<string, string>(), files = new Map<string, FilmAaaAssetPackage['files'][number]>(), caseNames = new Map<string, string>()
  if (!effects.length) return { namespace, effectPaths, files: [] }
  if (!sourceRoot) throw new TypeError('Đặt W01_AAA_ASSETS tới thư mục nguồn .efkefc và tài nguyên trước khi kèm hiệu ứng')
  const requestedRoot = path.resolve(sourceRoot)
  if ((await lstat(requestedRoot)).isSymbolicLink()) throw new TypeError('AAA: thư mục nguồn không được là liên kết tượng trưng')
  const root = await realpath(requestedRoot)
  const candidates = new Map<string, string[]>(), names = new Set(effects.map((item) => item.effect))
  let entries = 0
  const visit = async (folder: string, depth: number): Promise<void> => {
    if (depth > 32) throw new TypeError('AAA: thư mục nguồn quá sâu')
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      signal?.throwIfAborted()
      if (++entries > 10000) throw new TypeError('AAA: thư mục nguồn quá nhiều file; chọn thư mục nhỏ hơn')
      if (entry.isSymbolicLink()) continue // Never traverse links; selected dependencies are checked separately.
      const file = path.join(folder, entry.name)
      if (entry.isDirectory()) await visit(file, depth + 1)
      else if (entry.isFile() && entry.name.endsWith('.efkefc')) {
        const name = entry.name.slice(0, -7)
        if (names.has(name)) candidates.set(name, [...(candidates.get(name) ?? []), file])
      }
    }
  }
  await visit(root, 0)
  let total = 0
  const add = (relative: string, bytes: Buffer) => {
    const target = `assets/effeks/${namespace}/${relative}`, key = target.normalize('NFC').toLowerCase(), prior = caseNames.get(key)
    if (prior && prior !== target) throw new TypeError('AAA: tên tài nguyên trùng khi không phân biệt hoa thường')
    caseNames.set(key, target)
    const sha256 = hash(bytes), existing = files.get(target)
    if (existing && existing.sha256 !== sha256) throw new TypeError('AAA: nội dung tài nguyên thay đổi khi đóng gói')
    if (!existing) { total += bytes.length; files.set(target, { path: target, sha256, bytes }) }
    if (total > MAX_TOTAL || files.size > MAX_FILES) throw new TypeError('AAA: gói tài nguyên vượt giới hạn')
  }
  for (const name of [...names].sort()) {
    signal?.throwIfAborted()
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(name)) throw new TypeError('AAA: mã hiệu ứng không hợp lệ')
    const matches = candidates.get(name) ?? []
    if (matches.length !== 1) throw new TypeError(`AAA: ${matches.length ? 'trùng tên' : 'thiếu'} ${name}.efkefc trong W01_AAA_ASSETS; giữ đúng một tài liệu cho mỗi mã hiệu ứng`)
    const file = matches[0]!, bytes = await sourceBytes(root, file)
    const relative = path.relative(root, file).split(path.sep).join('/')
    // Minecraft identifiers need lowercase paths. Resources are placed relative to this mapped parent,
    // so their byte-for-byte document references (including original case) still resolve.
    const output = relative.toLowerCase()
    if (!/^[a-z0-9/._-]+$/.test(output)) throw new TypeError('AAA: đường dẫn hiệu ứng phải dùng ký tự ASCII chữ, số hoặc /._- để BBS đọc được')
    add(output, bytes); effectPaths.set(name, `effeks/${namespace}/${output}`)
    for (const dependency of aaaEffectDependencies(bytes)) {
      const normalized = dependency.replace(/\\/g, '/')
      if (normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized)) throw new TypeError('AAA: tham chiếu tài nguyên tuyệt đối không được hỗ trợ')
      const target = path.resolve(path.dirname(file), ...normalized.split('/'))
      const dependencyBytes = await sourceBytes(root, target)
      const resourceOutput = path.posix.normalize(path.posix.join(path.posix.dirname(output), normalized))
      if (resourceOutput === '..' || resourceOutput.startsWith('../') || resourceOutput.startsWith('/')) throw new TypeError('AAA: tài nguyên vượt ngoài namespace')
      add(resourceOutput, dependencyBytes)
    }
  }
  return { namespace, effectPaths, files: [...files.values()].sort((a, b) => a.path.localeCompare(b.path)) }
}

export async function writeFilmAaaAssets(packageRoot: string, assets: FilmAaaAssetPackage): Promise<void> {
  for (const file of assets.files) {
    const target = path.join(packageRoot, ...file.path.split('/'))
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, file.bytes, { flag: 'wx' })
  }
  if (assets.files.length) await writeFile(path.join(packageRoot, 'aaa-assets.json'), `${JSON.stringify({ version: 1, namespace: assets.namespace, effects: Object.fromEntries(assets.effectPaths), files: assets.files.map(({ bytes: _bytes, ...file }) => file) }, null, 2)}\n`, { flag: 'wx' })
}
