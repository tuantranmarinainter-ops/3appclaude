/** Minimal GLB container codec (JSON chunk + optional BIN chunk), shared by the CLI loaders and the contract writer. */
export function decodeGlb(bytes: Uint8Array): { json: Record<string, any>; bin: Uint8Array } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (bytes.length < 20 || view.getUint32(0, true) !== 0x46546c67 || view.getUint32(16, true) !== 0x4e4f534a) throw new TypeError('Not a binary glTF (GLB) file')
  const jsonLength = view.getUint32(12, true)
  const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength)))
  const binStart = 20 + jsonLength
  const bin = binStart + 8 <= bytes.length && view.getUint32(binStart + 4, true) === 0x004e4942
    ? bytes.subarray(binStart + 8, binStart + 8 + view.getUint32(binStart, true)) : new Uint8Array(0)
  return { json, bin }
}

export function encodeGlb(json: Record<string, any>, bin: Uint8Array): Uint8Array {
  const text = new TextEncoder().encode(JSON.stringify(json)), jsonLength = Math.ceil(text.length / 4) * 4
  const binLength = Math.ceil(bin.length / 4) * 4, hasBin = bin.length > 0
  const result = new Uint8Array(20 + jsonLength + (hasBin ? 8 + binLength : 0)), header = new DataView(result.buffer)
  header.setUint32(0, 0x46546c67, true); header.setUint32(4, 2, true); header.setUint32(8, result.length, true)
  header.setUint32(12, jsonLength, true); header.setUint32(16, 0x4e4f534a, true)
  result.fill(32, 20, 20 + jsonLength); result.set(text, 20)
  if (hasBin) {
    header.setUint32(20 + jsonLength, binLength, true); header.setUint32(24 + jsonLength, 0x004e4942, true)
    result.set(bin, 28 + jsonLength)
  }
  return result
}
