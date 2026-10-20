import { deflateSync } from 'node:zlib'

export interface PreviewFrame { label: string; joints: Map<string, readonly number[]> }

const CELL = 180, HEIGHT = 220, MARGIN = 14, COLUMNS = 4
const COLOR = { background: [255, 255, 255], grid: [225, 225, 225], center: [40, 40, 40], left: [30, 100, 220], right: [210, 50, 50] } as const

const CRC = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0 })
function chunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  let crc = 0xffffffff
  for (const byte of body) crc = CRC[(crc ^ byte) & 0xff]! ^ (crc >>> 8)
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length)
  const tail = Buffer.alloc(4); tail.writeUInt32BE((crc ^ 0xffffffff) >>> 0)
  return Buffer.concat([length, body, tail])
}

function encodePng(width: number, height: number, rgb: Uint8Array): Buffer {
  const raw = Buffer.alloc((width * 3 + 1) * height)
  for (let y = 0; y < height; y++) { raw[y * (width * 3 + 1)] = 0; raw.set(rgb.subarray(y * width * 3, (y + 1) * width * 3), y * (width * 3 + 1) + 1) }
  const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

/** Skeleton contact sheet: each sampled frame drawn front (X/Y) and side (Z/Y) with one shared scale, so travel and pose are comparable. */
export function renderContactSheet(frames: readonly PreviewFrame[], parents: ReadonlyMap<string, string | null>): Buffer {
  const rows = Math.ceil(frames.length / COLUMNS), width = COLUMNS * CELL * 2, height = rows * HEIGHT
  const rgb = new Uint8Array(width * height * 3).fill(255)
  const plot = (x: number, y: number, color: readonly number[]) => {
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
      const px = Math.round(x) + dx, py = Math.round(y) + dy
      if (px >= 0 && py >= 0 && px < width && py < height) rgb.set(color, (py * width + px) * 3)
    }
  }
  const line = (x0: number, y0: number, x1: number, y1: number, color: readonly number[]) => {
    const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0)))
    for (let step = 0; step <= steps; step++) plot(x0 + (x1 - x0) * step / steps, y0 + (y1 - y0) * step / steps, color)
  }
  let minY = Infinity, maxY = -Infinity, span = 0
  for (const frame of frames) for (const [x, y, z] of frame.joints.values()) { minY = Math.min(minY, y!); maxY = Math.max(maxY, y!); void x; void z }
  // Horizontal extent is measured around each frame's hips so root travel does not shrink the figure.
  for (const frame of frames) {
    const hips = frame.joints.get('Hips') ?? [0, 0, 0]
    for (const [x, , z] of frame.joints.values()) span = Math.max(span, Math.abs(x! - hips[0]!), Math.abs(z! - hips[2]!))
  }
  const scale = Math.min((HEIGHT - 2 * MARGIN) / Math.max(maxY - minY, 1e-6), (CELL / 2 - MARGIN) / Math.max(span, 1e-6))
  frames.forEach((frame, index) => {
    const ox = (index % COLUMNS) * CELL * 2, oy = Math.floor(index / COLUMNS) * HEIGHT
    const hips = frame.joints.get('Hips') ?? [0, 0, 0]
    for (let x = 0; x < CELL * 2; x++) rgb.set(COLOR.grid, ((oy + HEIGHT - MARGIN) * width + ox + x) * 3)
    for (let y = oy; y < oy + HEIGHT; y++) rgb.set(COLOR.grid, (y * width + ox) * 3)
    for (const [view, axis] of [[0, 0], [1, 2]] as const) {
      const cx = ox + view * CELL + CELL / 2
      const project = (p: readonly number[]) => [cx + (p[axis]! - hips[axis]!) * scale * (axis === 2 ? -1 : 1), oy + HEIGHT - MARGIN - (p[1]! - minY) * scale] as const
      for (const [name, position] of frame.joints) {
        const parent = parents.get(name), from = parent ? frame.joints.get(parent) : undefined
        if (!from) continue
        const color = name.startsWith('Left') ? COLOR.left : name.startsWith('Right') ? COLOR.right : COLOR.center
        const [x0, y0] = project(from), [x1, y1] = project(position)
        line(x0, y0, x1, y1, color)
      }
    }
  })
  return encodePng(width, height, rgb)
}
