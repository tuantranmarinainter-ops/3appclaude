import { useCallback, useEffect, useLayoutEffect, useRef, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'
import { CONTENT_WIDTH_MAX, CONTENT_WIDTH_MIN } from '../../../stores/EditorStore'
import { browserPanelStorage, clearPanelSize, readPanelSize, writePanelSize } from '../../common/panelLayout'

function clampWidth(value: number): number {
  return Math.min(CONTENT_WIDTH_MAX, Math.max(CONTENT_WIDTH_MIN, value))
}

export function usePanelResize(
  contentRef: RefObject<HTMLElement | null>,
  width: number,
  enabled: boolean,
  onCommit: (width: number) => void,
  options?: { invert?: boolean; clamp?: (value: number) => number; defaultValue?: number; storageKey?: string },
): {
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void
  onDoubleClick: () => void
} {
  const startX = useRef(0)
  const startW = useRef(0)
  const dragging = useRef(false)
  const handleRef = useRef<HTMLDivElement | null>(null)
  const stopRef = useRef<(() => void) | null>(null)

  useEffect(() => () => stopRef.current?.(), [])

  useEffect(() => {
    if (!options?.storageKey) return
    const clamp = options.clamp ?? clampWidth
    onCommit(readPanelSize(browserPanelStorage(), options.storageKey, options.defaultValue ?? width, clamp))
    // The saved value is loaded once per mounted panel. Store callbacks are stable actions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options?.storageKey])

  useEffect(() => {
    if (!enabled || !options?.storageKey || typeof ResizeObserver === 'undefined') return
    const el = contentRef.current
    const body = el?.closest('.t3d-body')
    if (!el || !body) return
    const fit = () => {
      if (dragging.current) return
      const clamp = options.clamp ?? clampWidth
      const next = clamp(el.getBoundingClientRect().width)
      if (Math.abs(next - width) < 1) return
      el.style.width = `${next}px`
      onCommit(next)
      writePanelSize(browserPanelStorage(), options.storageKey!, next)
    }
    const observer = new ResizeObserver(fit)
    observer.observe(body)
    return () => observer.disconnect()
  }, [contentRef, enabled, onCommit, options?.clamp, options?.storageKey, width])

  useLayoutEffect(() => {
    const el = contentRef.current
    if (el && enabled && !dragging.current) el.style.width = `${width}px`
  }, [contentRef, width, enabled])

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    const el = contentRef.current
    if (!el) return
    event.preventDefault()
    startX.current = event.clientX
    startW.current = el.getBoundingClientRect().width
    dragging.current = true
    handleRef.current = event.currentTarget
    handleRef.current.classList.add('is-dragging')
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    const clamp = options?.clamp ?? clampWidth
    const sign = options?.invert ? -1 : 1
    const onMove = (move: PointerEvent) => {
      el.style.width = `${clamp(startW.current + sign * (move.clientX - startX.current))}px`
    }
    const onUp = () => {
      stopRef.current = null
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      dragging.current = false
      handleRef.current?.classList.remove('is-dragging')
      handleRef.current = null
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      const next = clamp(el.getBoundingClientRect().width)
      onCommit(next)
      if (options?.storageKey) writePanelSize(browserPanelStorage(), options.storageKey, next)
    }
    stopRef.current = onUp
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }, [contentRef, onCommit, options?.clamp, options?.invert, options?.storageKey])

  const onDoubleClick = useCallback(() => {
    if (options?.defaultValue === undefined) return
    const clamp = options.clamp ?? clampWidth
    const next = clamp(options.defaultValue)
    if (options.storageKey) clearPanelSize(browserPanelStorage(), options.storageKey)
    onCommit(next)
  }, [onCommit, options?.clamp, options?.defaultValue, options?.storageKey])

  return { onPointerDown, onDoubleClick }
}

export function useVerticalResize(
  height: number,
  enabled: boolean,
  onCommit: (height: number) => void,
  clamp: (value: number) => number,
  options?: { defaultValue?: number; storageKey?: string },
): {
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void
  onDoubleClick: () => void
} {
  const startY = useRef(0)
  const startH = useRef(0)
  const currentH = useRef(0)
  const dragging = useRef(false)
  const handleRef = useRef<HTMLDivElement | null>(null)
  const stopRef = useRef<(() => void) | null>(null)

  useEffect(() => () => stopRef.current?.(), [])

  useEffect(() => {
    if (!options?.storageKey) return
    onCommit(readPanelSize(browserPanelStorage(), options.storageKey, options.defaultValue ?? height, clamp))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options?.storageKey])

  useEffect(() => {
    if (!options?.storageKey) return
    const fit = () => {
      const next = clamp(height)
      if (Math.abs(next - height) < 1) return
      onCommit(next)
      writePanelSize(browserPanelStorage(), options.storageKey!, next)
    }
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [clamp, height, onCommit, options?.storageKey])

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!enabled || event.button !== 0) return
    event.preventDefault()
    startY.current = event.clientY
    startH.current = height
    currentH.current = height
    dragging.current = true
    handleRef.current = event.currentTarget
    handleRef.current.classList.add('is-dragging')
    document.body.style.cursor = 'row-resize'
    document.body.style.userSelect = 'none'

    const onMove = (move: PointerEvent) => {
      const next = clamp(startH.current - (move.clientY - startY.current))
      currentH.current = next
      handleRef.current?.parentElement?.style.setProperty('--t3d-timeline-height', `${next}px`)
    }
    const cleanup = () => {
      stopRef.current = null
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
      dragging.current = false
      handleRef.current?.classList.remove('is-dragging')
      handleRef.current = null
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    const commit = () => {
      const next = clamp(currentH.current)
      onCommit(next)
      if (options?.storageKey) writePanelSize(browserPanelStorage(), options.storageKey, next)
    }
    const onUp = () => { cleanup(); commit() }
    const onCancel = () => { cleanup(); commit() }
    stopRef.current = cleanup
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
  }, [clamp, enabled, height, onCommit, options?.storageKey])

  const onDoubleClick = useCallback(() => {
    if (options?.defaultValue === undefined) return
    const next = clamp(options.defaultValue)
    if (options.storageKey) clearPanelSize(browserPanelStorage(), options.storageKey)
    onCommit(next)
  }, [clamp, onCommit, options?.defaultValue, options?.storageKey])

  return { onPointerDown, onDoubleClick }
}
