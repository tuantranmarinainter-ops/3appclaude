/**
 * Kết quả tính vùng trộn (K2) để dải X hiển thị: độ dời/xoay của clip sau và trạng thái khóa chân.
 * Engine ghi, giao diện timeline đọc (không phụ thuộc React store để viewport/sampler/film dùng chung).
 */
export interface BlendLockRun {
  side: 'left' | 'right'
  /** Khung timeline (có thể lẻ) bắt đầu/kết thúc khóa. */
  startFrame: number
  endFrame: number
  /** Số khung nhả êm sau endFrame. */
  easeFrames: number
}

export interface BlendStatus {
  /** Khoảng dời của clip sau (mét thế giới) và góc xoay yaw (độ) để nối tiếp chỗ đứng. */
  offsetMeters: number
  yawDegrees: number
  /** false khi không thể căn (thiếu xương chân/hông hoặc kiểu root không phải skeletal). */
  aligned: boolean
  locks: BlendLockRun[]
  /** K3: chân trước (chân xa hơn về phía hướng đi) của clip trước tại khung bắt đầu trộn và của clip sau (đã lật/dời nhịp, đã căn). */
  leadA: FootLead | null
  leadB: FootLead | null
  /** true khi hai chân trước khác nhau: cảnh báo vàng "ngược nhịp". */
  leadMismatch: boolean
  mirror: boolean
  phaseOffsetSeconds: number
  /** Độ dời nhịp nhỏ nhất (giây động tác gốc) để chân trước của clip sau trùng clip trước; null khi không tìm thấy / không cần. */
  suggestedPhaseSeconds: number | null
}

export type FootLead = 'left' | 'right'

export const OFF_BEAT_TEXT = 'Ngược nhịp bước: chân trước của clip sau ngược clip trước — bấm Đảo chân hoặc Khớp nhịp bước'

export function blendOffBeatText(status: BlendStatus | null | undefined): string {
  return status?.leadMismatch ? OFF_BEAT_TEXT : ''
}

interface Registry { statuses: Map<string, BlendStatus>; listeners: Set<() => void>; version: number }
// Giữ trên globalThis để bản ESM/CJS của cùng gói (và UI) dùng chung một sổ.
const registryKey = Symbol.for('topview.blendStatusRegistry')
const registry: Registry = ((globalThis as Record<symbol, unknown>)[registryKey] ??= { statuses: new Map(), listeners: new Set(), version: 0 }) as Registry
const statuses = registry.statuses
const listeners = registry.listeners

export function setBlendStatus(clipId: string, status: BlendStatus | null): void {
  const before = statuses.get(clipId)
  if (!status) {
    if (before && statuses.delete(clipId)) emit()
    return
  }
  if (before && JSON.stringify(before) === JSON.stringify(status)) return
  statuses.set(clipId, status)
  emit()
}

export function getBlendStatus(clipId: string): BlendStatus | null {
  return statuses.get(clipId) ?? null
}

export function clearBlendStatuses(): void {
  if (!statuses.size) return
  statuses.clear()
  emit()
}

export function subscribeBlendStatus(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function blendStatusVersion(): number {
  return registry.version
}

function emit(): void {
  registry.version += 1
  for (const listener of [...listeners]) listener()
}

function vnNumber(value: number, digits: number): string {
  return value.toFixed(digits).replace('.', ',')
}

export function blendPhaseText(status: BlendStatus | null | undefined): string {
  if (!status || !status.phaseOffsetSeconds) return ''
  return `Khớp nhịp bước +${vnNumber(status.phaseOffsetSeconds, 2)} s`
}

export function blendOffsetText(status: BlendStatus | null | undefined): string {
  if (!status || !status.aligned) return ''
  return `Clip sau dời ${vnNumber(status.offsetMeters, 2)} m, xoay ${vnNumber(status.yawDegrees, 0)}°`
}

export function blendLockText(status: BlendStatus | null | undefined, fps: number): string {
  if (!status) return ''
  if (!status.locks.length) return 'Không khóa chân: không có chân chạm đất'
  void fps
  return status.locks
    .map((run) => `Chân ${run.side === 'left' ? 'trái' : 'phải'} khóa ${Math.round(run.startFrame)}–${Math.round(run.endFrame)}`)
    .join(' · ')
}
