'use client'

import { useCharacterHeightNotice } from './hooks/useCharacterHeightNotice'
import type { UnifiedProject } from '@bbs/animation-workspace-shared'

export function CharacterHeightNotice({ project, selectedNodeId }: { project: UnifiedProject; selectedNodeId: string | null }) {
  const { changed, selected, displayed, update, busy, message } = useCharacterHeightNotice(project, selectedNodeId)
  return <div style={{ position: 'absolute', top: 8, left: 8, zIndex: 5, background: '#20242cee', padding: 8, borderRadius: 6 }}>
    <small>Lưới: 1 ô = 1 block · vạch đậm mỗi 5 block</small>
    {displayed !== undefined && <div>{selected!.name} · {displayed.toLocaleString('vi-VN', { maximumFractionDigits: 2 })} block</div>}
    {!!changed.length && <div role="status">Nhân vật đã đổi chiều cao — cập nhật trong cảnh? <button type="button" disabled={busy} onClick={() => void update()}>{busy ? 'Đang cập nhật…' : 'Đồng ý cập nhật'}</button><small> Chỉ cập nhật khi anh/chị đồng ý.</small></div>}
    {message && <div role="status">{message}</div>}
  </div>
}
