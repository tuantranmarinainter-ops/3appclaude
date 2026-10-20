import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { GizmoHoverPayload, GizmoHoverTipData } from '../types'

const CURSOR_OFFSET_X = 14
const CURSOR_OFFSET_Y = 18
const VIEW_PAD = 8

interface GizmoHoverSource {
  onGizmoHover(fn: (info: GizmoHoverPayload | null) => void): () => void
}

/**
 * 订阅操作轴手柄悬停。只有「悬停的手柄」变化才触发 React 更新；
 * 鼠标在同一手柄上移动时只直接改 DOM 位置，避免每次 pointermove 重渲染视口。
 */
export function useGizmoHoverTip(stage: GizmoHoverSource) {
  const [tip, setTip] = useState<GizmoHoverTipData | null>(null)
  const tipRef = useRef<HTMLDivElement | null>(null)
  const pointerRef = useRef({ x: 0, y: 0 })

  const place = useCallback(() => {
    const el = tipRef.current
    if (!el) return
    const { x, y } = pointerRef.current
    const left = Math.min(x + CURSOR_OFFSET_X, window.innerWidth - el.offsetWidth - VIEW_PAD)
    const top = Math.min(y + CURSOR_OFFSET_Y, window.innerHeight - el.offsetHeight - VIEW_PAD)
    el.style.left = `${Math.max(VIEW_PAD, left)}px`
    el.style.top = `${Math.max(VIEW_PAD, top)}px`
  }, [])

  useEffect(() => stage.onGizmoHover((info) => {
    if (!info) {
      setTip(null)
      return
    }
    pointerRef.current = { x: info.clientX, y: info.clientY }
    setTip((prev) => (
      prev && prev.mode === info.mode && prev.kind === info.kind && prev.axis === info.axis
        ? prev
        : { mode: info.mode, kind: info.kind, axis: info.axis }
    ))
    place()
  }), [stage, place])

  useLayoutEffect(() => {
    if (tip) place()
  }, [tip, place])

  return { tip, tipRef }
}
