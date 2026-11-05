import type { PanelSizeStorage } from '../../common/panelLayout'

/** "Cho chồng để trộn": nhớ theo người dùng như các tuỳ chọn timeline khác; mặc định bật. */
export const CLIP_BLEND_OVERLAP_STORAGE_KEY = 'topview.builder.timeline.clipBlendOverlap'

export function readClipBlendOverlap(storage: PanelSizeStorage | null): boolean {
  if (!storage) return true
  try {
    return storage.getItem(CLIP_BLEND_OVERLAP_STORAGE_KEY) !== '0'
  } catch {
    return true
  }
}

export function writeClipBlendOverlap(storage: PanelSizeStorage | null, enabled: boolean): void {
  if (!storage) return
  try {
    storage.setItem(CLIP_BLEND_OVERLAP_STORAGE_KEY, enabled ? '1' : '0')
  } catch {
    // Storage can be disabled; the toggle still works for this session.
  }
}

/** "Tự dời": nhớ theo người dùng; mặc định tắt (cắt/xoá/kéo clip không làm clip khác thụt vào hay bị đẩy). */
// v2: bản cũ tự ghi '1' (mặc định bật) vào máy người dùng; đổi khoá để mặc định mới (tắt) có hiệu lực.
export const CLIP_RIPPLE_STORAGE_KEY = 'topview.builder.timeline.clipRipple.v2'

export function readClipRipple(storage: PanelSizeStorage | null): boolean {
  if (!storage) return false
  try {
    return storage.getItem(CLIP_RIPPLE_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

export function writeClipRipple(storage: PanelSizeStorage | null, enabled: boolean): void {
  if (!storage) return
  try {
    storage.setItem(CLIP_RIPPLE_STORAGE_KEY, enabled ? '1' : '0')
  } catch {
    // Storage can be disabled; the toggle still works for this session.
  }
}
