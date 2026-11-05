import { test } from 'vitest'
import assert from 'node:assert/strict'
import { makeEmptyDraft } from '../../../contract/emptyDraft'
import type { DirectorDocument } from '../../../contract/types'
import { makeTimelineBoxSelection } from '../../../stores/types'
import { buildTree, selectedTimelineNodeId, timelineSelectionNodeIds } from '../utils'

const t = ((key: string) => key) as Parameters<typeof buildTree>[1]

function docWithProps(): DirectorDocument {
  const doc = makeEmptyDraft('prop-row', 30, 300)
  for (const id of ['stick', 'box']) {
    doc.content.nodes.push({
      id, type: 'prop', name: id, visible: true, locked: false,
      transform: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
    } as DirectorDocument['content']['nodes'][number])
  }
  return doc
}

const propRows = (doc: DirectorDocument, ids: string[]) =>
  buildTree(doc, t, ids.length > 1 ? ids : ids[0] ?? null).filter((row) => row.kind === 'node').map((row) => row.nodeId)

test('rê khung chỉ trúng khóa fcurve của đạo cụ: dòng đạo cụ vẫn hiện (Shot 03 Gậy cầu vồng 150 khóa)', () => {
  const doc = docWithProps()
  const sel = makeTimelineBoxSelection([], [], [{ nodeId: 'stick', propPath: 'transform.position', frame: 0 }])
  assert.equal(selectedTimelineNodeId(doc, sel), 'stick')
  assert.deepEqual(propRows(doc, timelineSelectionNodeIds(doc, sel)), ['stick'])
})

test('hộp trúng khóa fcurve của hai đạo cụ: cả hai dòng còn hiện', () => {
  const doc = docWithProps()
  const sel = makeTimelineBoxSelection([], [], [
    { nodeId: 'stick', propPath: 'transform.position', frame: 0 },
    { nodeId: 'box', propPath: 'transform.rotation', frame: 5 },
  ])
  assert.deepEqual(propRows(doc, timelineSelectionNodeIds(doc, sel)).sort(), ['box', 'stick'])
})

test('không chọn gì: không hiện dòng đạo cụ', () => {
  const doc = docWithProps()
  assert.deepEqual(timelineSelectionNodeIds(doc, null), [])
  assert.deepEqual(propRows(doc, []), [])
})
