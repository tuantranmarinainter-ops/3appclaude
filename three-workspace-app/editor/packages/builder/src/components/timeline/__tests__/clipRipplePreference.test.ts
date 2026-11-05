import { expect, it } from 'vitest'
import { readClipRipple, writeClipRipple } from '../utils/blendPreference'

const memory = (initial: string | null) => {
  let value = initial
  return { getItem: () => value, setItem: (_key: string, next: string) => { value = next }, removeItem: () => { value = null } }
}

it('"Tự dời" mặc định tắt: chưa lưu / không có lưu trữ thì false, chỉ "1" mới bật, ghi rồi đọc lại đúng', () => {
  expect(readClipRipple(null)).toBe(false)
  expect(readClipRipple(memory(null))).toBe(false)
  expect(readClipRipple(memory('0'))).toBe(false)
  expect(readClipRipple(memory('1'))).toBe(true)
  const store = memory(null)
  writeClipRipple(store, true)
  expect(readClipRipple(store)).toBe(true)
})
