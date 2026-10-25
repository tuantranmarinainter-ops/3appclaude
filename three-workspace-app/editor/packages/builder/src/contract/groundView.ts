/**
 * Tuỳ chọn sàn UV checker (N6) — CHỈ là hiển thị trong khung 3D:
 * không ghi vào tài liệu project, không vào film/xuất. Lựa chọn của người dùng
 * được nhớ ở localStorage phía UI (components/viewport), engine chỉ nhận bản đã chuẩn hoá.
 */
export type GroundViewStyle = 'bw' | 'color' | 'numbers'

export interface GroundViewOptions {
  enabled: boolean
  style: GroundViewStyle
  /** Cạnh một ô checker, theo mét (1 block Minecraft = 1 m). */
  cellSize: number
  /** Độ mờ của mặt sàn checker: 0.15 (rất trong) .. 1 (đặc). */
  opacity: number
}

/** Các cỡ ô cho chọn nhanh. */
export const GROUND_CELL_SIZES: readonly number[] = [0.5, 1, 2, 5]

export const GROUND_OPACITY_MIN = 0.15
export const GROUND_OPACITY_MAX = 1

export const DEFAULT_GROUND_VIEW_OPTIONS: GroundViewOptions = {
  enabled: false,
  style: 'bw',
  cellSize: 1,
  opacity: 0.9,
}

const GROUND_VIEW_STYLES: readonly GroundViewStyle[] = ['bw', 'color', 'numbers']

/** Đưa dữ liệu thô (localStorage / UI) về tuỳ chọn hợp lệ; không sửa đầu vào. */
export function normalizeGroundViewOptions(
  input: Partial<GroundViewOptions> | null | undefined,
): GroundViewOptions {
  const style = GROUND_VIEW_STYLES.includes(input?.style as GroundViewStyle)
    ? (input!.style as GroundViewStyle)
    : DEFAULT_GROUND_VIEW_OPTIONS.style
  const cellSize = GROUND_CELL_SIZES.includes(input?.cellSize as number)
    ? (input!.cellSize as number)
    : DEFAULT_GROUND_VIEW_OPTIONS.cellSize
  const rawOpacity = typeof input?.opacity === 'number' && Number.isFinite(input.opacity)
    ? input.opacity
    : DEFAULT_GROUND_VIEW_OPTIONS.opacity
  return {
    enabled: input?.enabled === true,
    style,
    cellSize,
    opacity: Math.min(GROUND_OPACITY_MAX, Math.max(GROUND_OPACITY_MIN, rawOpacity)),
  }
}
