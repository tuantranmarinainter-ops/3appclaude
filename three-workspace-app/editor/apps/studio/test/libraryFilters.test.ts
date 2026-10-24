import assert from 'node:assert/strict'
import test from 'node:test'
import { filterLibraryActions, searchable } from '../src/libraryFilters.ts'

test('library filters match Vietnamese text and action groups', () => {
  const actions = [
    { name: 'Walk forward', nameVi: 'Đi tới trước', category: 'locomotion', tags: ['human'] },
    { name: 'Wave', nameVi: 'Vẫy tay', category: 'gesture', tags: ['greeting'] },
  ]
  assert.equal(searchable('ĐI TỚI'), 'di toi')
  assert.deepEqual(filterLibraryActions(actions, 'đi toi', ''), [actions[0]])
  assert.deepEqual(filterLibraryActions(actions, 'tay', 'gesture'), [actions[1]])
  assert.deepEqual(filterLibraryActions(actions, 'walk', 'gesture'), [])
})
