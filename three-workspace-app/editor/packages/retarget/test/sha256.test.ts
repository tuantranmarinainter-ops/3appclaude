import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import { sha256Hex } from '../src/sha256'

test('pure-JS sha256 matches node:crypto for fixed inputs', () => {
  assert.equal(sha256Hex(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
  assert.equal(sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  for (const length of [0, 1, 55, 56, 63, 64, 65, 119, 120, 1000]) {
    const data = Uint8Array.from({ length }, (_, i) => (i * 31 + 7) & 255)
    assert.equal(sha256Hex(data), createHash('sha256').update(data).digest('hex'), `length ${length}`)
  }
  const text = JSON.stringify([['Root', null, [1, 0, 0.12345]], ['Hé', 'Root', [0]]])
  assert.equal(sha256Hex(text), createHash('sha256').update(text).digest('hex'))
})
