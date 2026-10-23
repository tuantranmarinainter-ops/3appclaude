import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'

const DEFAULT_LEFT = 240
const DEFAULT_RIGHT = 300
const LEFT_MIN = 180
const LEFT_MAX = 360
const RIGHT_MIN = 240
const RIGHT_MAX = 420

type Side = 'left' | 'right'

function readSize(side: Side, fallback: number): number {
  if (typeof window === 'undefined') return fallback
  try {
    const value = Number(window.localStorage.getItem(`topview.studio.retarget.${side}Width`))
    return Number.isFinite(value) && value > 0 ? value : fallback
  } catch { return fallback }
}

function storeSize(side: Side, value: number): void {
  try { window.localStorage.setItem(`topview.studio.retarget.${side}Width`, String(Math.round(value))) } catch { /* optional preference */ }
}

function clearSize(side: Side): void {
  try { window.localStorage.removeItem(`topview.studio.retarget.${side}Width`) } catch { /* reset still applies */ }
}

function fitWidths(total: number, requestedLeft: number, requestedRight: number): [number, number] {
  let left = Math.min(LEFT_MAX, Math.max(LEFT_MIN, Math.round(requestedLeft)))
  let right = Math.min(RIGHT_MAX, Math.max(RIGHT_MIN, Math.round(requestedRight)))
  const available = Math.max(LEFT_MIN + RIGHT_MIN, total - 372)
  const excess = left + right - available
  if (excess > 0) {
    const leftRoom = left - LEFT_MIN
    const rightRoom = right - RIGHT_MIN
    const room = leftRoom + rightRoom
    if (room > 0) {
      left -= Math.min(leftRoom, Math.ceil(excess * leftRoom / room))
      right = Math.max(RIGHT_MIN, available - left)
    }
  }
  return [left, right]
}

export function useRetargetPanelLayout() {
  const workAreaRef = useRef<HTMLDivElement>(null)
  const [leftWidth, setLeftWidth] = useState(DEFAULT_LEFT)
  const [rightWidth, setRightWidth] = useState(DEFAULT_RIGHT)
  const widthsRef = useRef<[number, number]>([DEFAULT_LEFT, DEFAULT_RIGHT])
  const stopRef = useRef<(() => void) | null>(null)
  useEffect(() => () => stopRef.current?.(), [])

  useEffect(() => {
    const element = workAreaRef.current
    if (!element) return
    const [left, right] = fitWidths(element.clientWidth, readSize('left', DEFAULT_LEFT), readSize('right', DEFAULT_RIGHT))
    widthsRef.current = [left, right]
    setLeftWidth(left)
    setRightWidth(right)
    const observer = new ResizeObserver(() => {
      const [nextLeft, nextRight] = fitWidths(element.clientWidth, widthsRef.current[0], widthsRef.current[1])
      widthsRef.current = [nextLeft, nextRight]
      setLeftWidth(nextLeft)
      setRightWidth(nextRight)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useEffect(() => { widthsRef.current = [leftWidth, rightWidth] }, [leftWidth, rightWidth])

  const clamp = (side: Side, value: number) => {
    const total = workAreaRef.current?.clientWidth ?? window.innerWidth
    const opposite = side === 'left' ? rightWidth : leftWidth
    const min = side === 'left' ? LEFT_MIN : RIGHT_MIN
    const fixedMax = side === 'left' ? LEFT_MAX : RIGHT_MAX
    const availableMax = total - opposite - 360 - 12
    return Math.min(fixedMax, Math.max(min, Math.round(Math.min(value, availableMax))))
  }

  const startResize = (side: Side) => (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    const startX = event.clientX
    const startWidth = side === 'left' ? leftWidth : rightWidth
    let current = startWidth
    const setWidth = side === 'left' ? setLeftWidth : setRightWidth
    event.currentTarget.classList.add('is-dragging')
    const handle = event.currentTarget
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    const move = (moveEvent: PointerEvent) => {
      current = clamp(side, startWidth + (side === 'left' ? 1 : -1) * (moveEvent.clientX - startX))
      setWidth(current)
    }
    const cleanup = () => {
      stopRef.current = null
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
      handle.classList.remove('is-dragging')
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    const finish = () => { cleanup(); storeSize(side, current) }
    stopRef.current = cleanup
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', finish)
  }

  const reset = (side: Side) => () => {
    clearSize(side)
    if (side === 'left') setLeftWidth(clamp(side, DEFAULT_LEFT))
    else setRightWidth(clamp(side, DEFAULT_RIGHT))
  }

  return {
    workAreaRef,
    style: { '--wb-retarget-left-width': `${leftWidth}px`, '--wb-retarget-right-width': `${rightWidth}px` } as CSSProperties,
    leftDivider: { onPointerDown: startResize('left'), onDoubleClick: reset('left') },
    rightDivider: { onPointerDown: startResize('right'), onDoubleClick: reset('right') },
  }
}
