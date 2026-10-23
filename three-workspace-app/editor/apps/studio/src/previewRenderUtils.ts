const GLB_MAGIC = 0x46546c67
const JSON_CHUNK = 0x4e4f534a

export function glbUsesDraco(data: ArrayBuffer): boolean {
  if (data.byteLength < 20) throw new Error('Invalid GLB: header or JSON chunk is missing')
  const view = new DataView(data)
  if (view.getUint32(0, true) !== GLB_MAGIC || view.getUint32(4, true) !== 2 || view.getUint32(8, true) !== data.byteLength) {
    throw new Error('Invalid GLB header')
  }
  const jsonLength = view.getUint32(12, true)
  if (view.getUint32(16, true) !== JSON_CHUNK || jsonLength < 2 || 20 + jsonLength > data.byteLength) {
    throw new Error('Invalid GLB JSON chunk')
  }
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(data, 20, jsonLength))) as {
    extensionsUsed?: unknown
    extensionsRequired?: unknown
  }
  const extensions = [...(Array.isArray(json.extensionsUsed) ? json.extensionsUsed : []), ...(Array.isArray(json.extensionsRequired) ? json.extensionsRequired : [])]
  return extensions.includes('KHR_draco_mesh_compression')
}
