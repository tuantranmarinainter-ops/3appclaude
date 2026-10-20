import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'
import { playwrightDir } from '../playwright.mjs'

test('Playwright resolves from the director-cli package under Node loaders', () => {
  assert.equal(path.basename(playwrightDir()), 'playwright')
})
