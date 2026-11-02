/** Phần tối thiểu của StudioSession mà lệnh Hoàn tác/Làm lại của host cần. */
export interface FlushableSession {
  readonly dirty: boolean
  readonly saveState: string
  flushPendingUserWrites(): Promise<void>
  save(options?: { captureCover?: boolean }): Promise<string | null>
}

/**
 * Hoàn tác/Làm lại của host chạy trên lịch sử đã lưu của dự án. Sửa đổi trong Studio (trộn clip,
 * kéo đè, bảng Trộn clip...) được lưu theo chu kỳ tự lưu, nên nếu bấm Ctrl+Z ngay sau khi sửa,
 * lệnh sẽ hoàn tác bước TRƯỚC (hoặc không làm gì) rồi nạp lại dự án và xoá luôn sửa đổi chưa lưu.
 * Gọi hàm này trước khi chạy history.* để mọi sửa đổi đang chờ được ghi xuống host.
 * Trả về false khi lưu lỗi (không nên chạy Hoàn tác trên trạng thái cũ).
 */
export async function flushStudioBeforeHistory(session: FlushableSession | null | undefined): Promise<boolean> {
  if (!session) return true
  await session.flushPendingUserWrites()
  if (session.dirty || session.saveState === 'saving') {
    const error = await session.save({ captureCover: false })
    if (error) return false
  }
  return true
}
