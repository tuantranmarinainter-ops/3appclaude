import assert from 'node:assert/strict'
import test from 'node:test'
import { flushStudioBeforeHistory, type FlushableSession } from '../src/devtools/historyFlush'

function fake(initial: { dirty: boolean; saveState?: string; saveError?: string | null }) {
  const calls: string[] = []
  const session: FlushableSession & { dirty: boolean } = {
    dirty: initial.dirty,
    saveState: initial.saveState ?? 'saved',
    async flushPendingUserWrites() { calls.push('flush') },
    async save() { calls.push('save'); if (initial.saveError) return initial.saveError; session.dirty = false; return null },
  }
  return { session, calls }
}

test('sửa đổi chưa lưu được ghi xuống host trước khi Hoàn tác', async () => {
  const { session, calls } = fake({ dirty: true })
  assert.equal(await flushStudioBeforeHistory(session), true)
  assert.deepEqual(calls, ['flush', 'save'])
  assert.equal(session.dirty, false)
})

test('không có gì chưa lưu: không gọi save', async () => {
  const { session, calls } = fake({ dirty: false })
  assert.equal(await flushStudioBeforeHistory(session), true)
  assert.deepEqual(calls, ['flush'])
})

test('đang lưu dở: chờ lượt lưu hiện tại', async () => {
  const { session, calls } = fake({ dirty: false, saveState: 'saving' })
  assert.equal(await flushStudioBeforeHistory(session), true)
  assert.deepEqual(calls, ['flush', 'save'])
})

test('lưu lỗi: trả false để không Hoàn tác trên trạng thái cũ', async () => {
  const { session } = fake({ dirty: true, saveError: 'boom' })
  assert.equal(await flushStudioBeforeHistory(session), false)
})

test('không có Studio sống: bỏ qua', async () => {
  assert.equal(await flushStudioBeforeHistory(null), true)
})
