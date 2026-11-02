/**
 * K5: yêu cầu "Sửa chỗ nối trong App 3" từ dải X của timeline (builder) tới panel Animation của host.
 * Builder chỉ gọi `adapter.editBlendInAnimation`; adapter phát sự kiện này và lưu sessionStorage để panel
 * Animation (mount muộn) vẫn nhận được yêu cầu. Hàm thuần, kiểm thử không cần trình duyệt.
 */
export const BLEND_EDIT_REQUEST_EVENT = 'bbs-edit-blend-in-app3'
export const BLEND_EDIT_REQUEST_KEY = 'bbs-edit-blend-in-app3'

export interface BlendEditRequest { projectId: string; characterNodeId: string; clipId: string; frameStart: number; frameEnd: number }

export function parseBlendEditRequest(value: unknown): BlendEditRequest | null {
  if (!value || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  if (typeof v.projectId !== 'string' || typeof v.characterNodeId !== 'string' || typeof v.clipId !== 'string') return null
  if (!Number.isSafeInteger(v.frameStart) || !Number.isSafeInteger(v.frameEnd) || (v.frameEnd as number) <= (v.frameStart as number)) return null
  return { projectId: v.projectId, characterNodeId: v.characterNodeId, clipId: v.clipId, frameStart: v.frameStart as number, frameEnd: v.frameEnd as number }
}

/** Lấy (và xóa) yêu cầu đang chờ cho `projectId`; yêu cầu của project khác bị bỏ qua. */
export function takePendingBlendEditRequest(projectId: string, storage: Pick<Storage, 'getItem' | 'removeItem'> | undefined = typeof sessionStorage === 'undefined' ? undefined : sessionStorage): BlendEditRequest | null {
  try {
    const raw = storage?.getItem(BLEND_EDIT_REQUEST_KEY)
    if (!raw) return null
    const request = parseBlendEditRequest(JSON.parse(raw))
    if (!request || request.projectId !== projectId) return null
    storage?.removeItem(BLEND_EDIT_REQUEST_KEY)
    return request
  } catch { return null }
}
