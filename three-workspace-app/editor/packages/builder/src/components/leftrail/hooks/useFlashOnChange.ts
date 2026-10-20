import { useEffect, useRef, type RefObject } from 'react'

const FLASH_CLASS = 'is-flashing'
/** 与 library.css 里 `t3d-leftrail-flash` 的时长一致 */
const FLASH_MS = 400

/** `signal` 变化时给元素重播一次高亮动画；首次挂载不播 */
export function useFlashOnChange(ref: RefObject<HTMLElement | null>, signal: number): void {
  const last = useRef(signal)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])

  useEffect(() => {
    if (signal === last.current) return
    last.current = signal
    const el = ref.current
    if (!el) return
    if (timer.current) clearTimeout(timer.current)
    el.classList.remove(FLASH_CLASS)
    void el.offsetWidth
    el.classList.add(FLASH_CLASS)
    timer.current = setTimeout(() => {
      timer.current = null
      el.classList.remove(FLASH_CLASS)
    }, FLASH_MS)
  }, [ref, signal])
}
