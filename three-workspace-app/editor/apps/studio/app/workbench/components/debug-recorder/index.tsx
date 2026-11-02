'use client'

import { useState, useSyncExternalStore } from 'react'
import { addDebugNote, clearDebug, debugState, formatDebugLog, startDebug, stopDebug, subscribeDebug } from '../../../../src/debugRecorder'

/** Bảng "Debug": bật/tắt ghi thao tác, đánh dấu lúc gặp lỗi, xem và tải log. */
export function DebugRecorderPanel() {
  const state = useSyncExternalStore(subscribeDebug, debugState, debugState)
  const [note, setNote] = useState('')
  const recent = state.entries.slice(-200).reverse()
  const download = () => {
    const blob = new Blob([formatDebugLog(state.entries)], { type: 'text/plain;charset=utf-8' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `debug-app2-${state.sessionId || 'log'}.txt`
    link.click()
    URL.revokeObjectURL(link.href)
  }
  const mark = () => { addDebugNote(note || 'Lỗi xảy ra ở đây'); setNote('') }
  return <div className="wb-debug-panel">
    <p>Bật ghi rồi làm lại thao tác gây lỗi. App ghi phím bấm, cú bấm chuột, các lần lưu lên server và lỗi của trang. Khi lỗi xảy ra, bấm <b>Đánh dấu lỗi</b> để Claude biết đúng chỗ.</p>
    <div className="wb-debug-actions">
      {state.active
        ? <button type="button" className="danger" onClick={stopDebug}>■ Dừng ghi</button>
        : <button type="button" className="primary" onClick={startDebug}>● Bắt đầu ghi</button>}
      <span role="status">{state.active ? `Đang ghi · ${state.entries.length} dòng` : `Đang tắt · ${state.entries.length} dòng`}</span>
    </div>
    <div className="wb-debug-actions">
      <input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Mô tả lỗi (vd: vừa mất camera)" maxLength={300} disabled={!state.active}
        onKeyDown={(event) => { if (event.key === 'Enter') mark() }} />
      <button type="button" onClick={mark} disabled={!state.active}>Đánh dấu lỗi</button>
    </div>
    <div className="wb-debug-actions">
      <button type="button" onClick={download} disabled={!state.entries.length}>Tải file log</button>
      <button type="button" onClick={clearDebug} disabled={!state.entries.length || state.active}>Xoá trên màn hình</button>
    </div>
    {state.logPath && <p><small>Log lưu trên máy: <code>{state.logPath}</code></small></p>}
    <ol className="wb-debug-log" aria-label="Nhật ký debug (mới nhất ở trên)">
      {recent.map((entry, index) => <li key={`${entry.at}-${index}`} data-kind={entry.kind}><time>{entry.at.slice(11, 19)}</time> {entry.text}</li>)}
    </ol>
  </div>
}
