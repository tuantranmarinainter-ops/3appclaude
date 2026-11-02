import assert from 'node:assert/strict'
import test from 'node:test'
// @ts-expect-error next.config.mjs is plain JavaScript without declarations.
import { devDistDir } from '../next.config.mjs'

test('B25: each dev port gets its own Next build folder; the default port keeps .next-dev', () => {
  assert.equal(devDistDir('3002'), '.next-dev')
  assert.equal(devDistDir('3025'), '.next-dev-3025')
  assert.equal(devDistDir('3033'), '.next-dev-3033')
  assert.equal(devDistDir(''), '.next-dev')
  assert.equal(devDistDir('../x'), '.next-dev', 'never builds a path from an odd port value')
})
