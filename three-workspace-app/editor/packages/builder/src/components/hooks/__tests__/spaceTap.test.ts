import { test } from 'vitest'
import assert from 'node:assert/strict'
import { createSpaceTap } from '../spaceTap'

test('a clean Space tap toggles play once on release', () => {
  let toggles = 0
  const tap = createSpaceTap(() => { toggles++ })
  tap.keyDown(false)
  assert.equal(toggles, 0)
  assert.equal(tap.keyUp(), true)
  assert.equal(toggles, 1)
  assert.equal(tap.keyUp(), false)
})

test('Space held while pressing the pointer (viewport pan) or auto-repeating does not toggle', () => {
  let toggles = 0
  const tap = createSpaceTap(() => { toggles++ })
  tap.keyDown(false)
  tap.pointerDown()
  assert.equal(tap.keyUp(), false)
  tap.keyDown(false)
  tap.keyDown(true)
  assert.equal(tap.keyUp(), false)
  tap.pointerDown()
  tap.keyDown(false)
  assert.equal(tap.keyUp(), true)
  assert.equal(toggles, 1)
})
