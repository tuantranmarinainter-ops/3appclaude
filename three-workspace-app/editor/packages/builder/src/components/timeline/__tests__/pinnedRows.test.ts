import { test } from 'vitest'
import assert from 'node:assert/strict'
import { orderPinnedRows, readPinnedRows, togglePinned, writePinnedRows } from '../utils/pinnedRows'
import { clampMenuPosition } from '../utils/clipMenu'
import { defaultRulerVisibility, readRulerVisibility, toggleRuler, visibleRulers, writeRulerVisibility } from '../utils/rulers'

const row = (nodeId: string, depth: number, kind = depth === 0 ? 'node' : 'kf') => ({ row: { nodeId, kind }, depth })
const rows = [row('a', 0), row('a', 1), row('b', 0), row('b', 1), row('b', 1), row('c', 0)]
const ids = (list: typeof rows) => list.map((item) => `${item.row.nodeId}${item.depth}`).join(',')

test('pinned roots move to the top in pin order with their children; unpin restores order', () => {
  assert.equal(ids(orderPinnedRows(rows, ['c', 'b'])), 'c0,b0,b1,b1,a0,a1')
  assert.equal(ids(orderPinnedRows(rows, [])), 'a0,a1,b0,b1,b1,c0')
  assert.equal(ids(orderPinnedRows(rows, ['gone'])), 'a0,a1,b0,b1,b1,c0')
  assert.deepEqual(togglePinned(togglePinned([], 'a'), 'a'), [])
})

test('pinned rows persist per project in storage and survive bad data', () => {
  const data = new Map<string, string>()
  const storage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) }
  writePinnedRows(storage, 'p1', ['x', 'y'])
  assert.deepEqual(readPinnedRows(storage, 'p1'), ['x', 'y'])
  assert.deepEqual(readPinnedRows(storage, 'p2'), [])
  data.set('topview.builder.timeline.pinned.p3', '{oops')
  assert.deepEqual(readPinnedRows(storage, 'p3'), [])
  assert.deepEqual(readPinnedRows(null, 'p1'), [])
})

test('rulers: at least one stays visible, order is seconds/frames/ticks, choice persists', () => {
  let vis = defaultRulerVisibility('frames')
  assert.deepEqual(visibleRulers(vis), ['seconds', 'frames', 'ticks'], 'all three by default')
  vis = toggleRuler(toggleRuler(vis, 'ticks'), 'seconds')
  assert.deepEqual(visibleRulers(vis), ['frames'])
  assert.equal(toggleRuler(vis, 'frames'), vis)
  vis = toggleRuler(toggleRuler(vis, 'ticks'), 'seconds')
  assert.deepEqual(visibleRulers(vis), ['seconds', 'frames', 'ticks'])
  const data = new Map<string, string>()
  const storage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) }
  writeRulerVisibility(storage, vis)
  assert.deepEqual(readRulerVisibility(storage, 'frames'), vis)
  data.set('topview.builder.timeline.rulers', JSON.stringify({ seconds: false, frames: false, ticks: false }))
  assert.deepEqual(visibleRulers(readRulerVisibility(storage, 'ticks')), ['seconds', 'frames', 'ticks'])
})

test('context menu flips up/left near the viewport edges', () => {
  const size = { width: 120, height: 200 }
  const view = { width: 1000, height: 800 }
  assert.deepEqual(clampMenuPosition(100, 100, size, view), { x: 100, y: 100 })
  assert.deepEqual(clampMenuPosition(950, 700, size, view), { x: 830, y: 500 })
  assert.deepEqual(clampMenuPosition(10, 790, { width: 120, height: 900 }, view), { x: 10, y: 4 })
})
