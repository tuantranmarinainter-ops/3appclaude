export type WorkspaceId = 'normalize' | 'scene' | 'animation' | 'vfx' | 'library'

export type WorkspaceUrls = Partial<Record<Exclude<WorkspaceId, 'scene' | 'library'>, string | undefined>>

export const WORKSPACES: ReadonlyArray<{ id: WorkspaceId; number: number; label: string }> = [
  { id: 'normalize', number: 1, label: 'Chuẩn hoá' },
  { id: 'scene', number: 2, label: 'Dựng cảnh' },
  { id: 'animation', number: 3, label: 'Animation' },
  { id: 'vfx', number: 4, label: 'VFX' },
  { id: 'library', number: 5, label: 'Thư viện' },
]

/** App 1 Workbench khi chưa đặt NEXT_PUBLIC_RETARGET_WORKBENCH_URL (biến môi trường vẫn ghi đè được). */
export const DEFAULT_WORKBENCH_URL = 'http://127.0.0.1:3101'

/** Danh sách project của Studio: đích của Animation/VFX khi đang ở ngoài project. */
export const PROJECT_LIST_PATH = '/'

/** Gợi ý kèm link Animation/VFX ngoài project (hai workspace này chỉ dùng được bên trong một project). */
export const OPEN_PROJECT_HINT = 'Mở một project để dùng Animation/VFX'

/**
 * Nhãn tab Chuẩn hoá bên trong project: đó là công cụ V9.12 cũ của Studio, không phải App 1 Workbench,
 * nên ghi rõ để khỏi nhầm với nút "1 Chuẩn hoá" (App 1) ở ngoài project.
 */
export const QUICK_NORMALIZE_LABEL = 'Chuẩn hoá nhanh (V9.12)'

export function withUnified(url: string, unified: string | null): string {
  if (!unified) return url
  const parsed = new URL(url, 'http://workspace.local')
  parsed.searchParams.set('unified', unified)
  return parsed.origin === 'http://workspace.local' ? `${parsed.pathname}${parsed.search}${parsed.hash}` : parsed.toString()
}

export function safeWorkspaceUrl(value: string | undefined): string | null {
  if (!value) return null
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.toString() : null
  } catch { return null }
}

export function workspaceHref(id: WorkspaceId, urls: WorkspaceUrls, unified: string | null): string {
  if (id === 'scene') return withUnified(PROJECT_LIST_PATH, unified)
  if (id === 'library') return withUnified('/library', unified)
  if (id === 'normalize') return withUnified(safeWorkspaceUrl(urls.normalize) ?? DEFAULT_WORKBENCH_URL, unified)
  // Animation/VFX chưa cấu hình URL ngoài: dẫn tới danh sách project (kèm gợi ý qua workspaceProjectListHint).
  return withUnified(safeWorkspaceUrl(urls[id]) ?? PROJECT_LIST_PATH, unified)
}

/** Gợi ý hiển thị kèm link khi Animation/VFX rơi về danh sách project vì chưa cấu hình URL ngoài; null nếu không rơi. */
export function workspaceProjectListHint(id: WorkspaceId, urls: WorkspaceUrls): string | null {
  if (id !== 'animation' && id !== 'vfx') return null
  return safeWorkspaceUrl(urls[id]) ? null : OPEN_PROJECT_HINT
}
