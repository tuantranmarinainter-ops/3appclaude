import { inflateRawSync } from 'node:zlib'

/** Minimal reader for one entry of a ZIP we produced ourselves (stored or deflate, no ZIP64). */
export function readZipEntries(zip: Buffer): Array<{ name: string; read: () => Buffer }> {
  let end = -1
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 0xffff); i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) { end = i; break }
  }
  if (end < 0) throw new Error('ZIP không hợp lệ: thiếu mục lục.')
  const count = zip.readUInt16LE(end + 10)
  let offset = zip.readUInt32LE(end + 16)
  const entries: Array<{ name: string; read: () => Buffer }> = []
  for (let n = 0; n < count; n++) {
    if (zip.readUInt32LE(offset) !== 0x02014b50) throw new Error('ZIP không hợp lệ: mục lục hỏng.')
    const method = zip.readUInt16LE(offset + 10)
    const compressedSize = zip.readUInt32LE(offset + 20)
    const size = zip.readUInt32LE(offset + 24)
    const nameLength = zip.readUInt16LE(offset + 28)
    const extraLength = zip.readUInt16LE(offset + 30)
    const commentLength = zip.readUInt16LE(offset + 32)
    const local = zip.readUInt32LE(offset + 42)
    const name = zip.subarray(offset + 46, offset + 46 + nameLength).toString('utf8')
    entries.push({ name, read: () => {
      if (zip.readUInt32LE(local) !== 0x04034b50) throw new Error('ZIP không hợp lệ: thiếu đầu mục.')
      const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28)
      const raw = zip.subarray(start, start + compressedSize)
      const data = method === 0 ? Buffer.from(raw) : method === 8 ? inflateRawSync(raw) : null
      if (!data || data.length !== size) throw new Error('ZIP dùng kiểu nén không hỗ trợ.')
      return data
    } })
    offset += 46 + nameLength + extraLength + commentLength
  }
  return entries
}

/** B56: the single Film `.dat` inside an exported package (`films/<name>.dat`). */
export function readFilmDat(zip: Buffer): { name: string; data: Buffer } {
  const films = readZipEntries(zip).filter((entry) => /(^|\/)films\/[^/]+\.dat$/i.test(entry.name))
  if (films.length !== 1) throw new Error(films.length ? 'Gói có nhiều film; hãy lưu cả ZIP.' : 'Gói không có file .dat.')
  return { name: films[0]!.name.split('/').pop()!, data: films[0]!.read() }
}
