import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { APP3_BRIDGE_CHANNEL, APP3_BRIDGE_URL, APP3_EMBED_VERSION, APP3_FRAME_URL, APP3_TITLE } from '../src/app3Embed'

const studio = new URL('../', import.meta.url)
const file = (relative: string) => fileURLToPath(new URL(relative, studio))
const folder = `public/animation-studio/v${APP3_EMBED_VERSION}/`
const sha = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex')

test('embedded App 3 folder has the runtime, a byte-identical bridge and its GPL notices', () => {
  for (const name of ['index.html', 'host-bridge.js', 'README.md', 'LICENSE', 'NOTICE'])
    assert.ok(existsSync(file(folder + name)), `${folder}${name} missing`)
  assert.equal(APP3_FRAME_URL, `/animation-studio/v${APP3_EMBED_VERSION}/index.html`)
  assert.equal(APP3_BRIDGE_URL, `/animation-studio/v${APP3_EMBED_VERSION}/host-bridge.js`)
  assert.equal(APP3_TITLE, `Animation Studio ${APP3_EMBED_VERSION}`)
  assert.match(readFileSync(file(folder + 'LICENSE'), 'utf8'), /GNU GENERAL PUBLIC LICENSE/)
  const readme = readFileSync(file(folder + 'README.md'), 'utf8')
  assert.ok(readme.includes(sha(file(folder + 'index.html'))), 'README records index.html SHA-256')
  assert.ok(readme.includes(sha(file(folder + 'host-bridge.js'))), 'README records host-bridge.js SHA-256')
})

test('bridge channel is the protocol id App 3 speaks, independent of the build version', () => {
  const bridge = readFileSync(file(folder + 'host-bridge.js'), 'utf8')
  assert.ok(bridge.includes(`'${APP3_BRIDGE_CHANNEL}'`), 'embedded host-bridge.js uses APP3_BRIDGE_CHANNEL')
  const source = readFileSync(file('../../../animation-studio/work/material_alpha_v1_31_8/src/host_bridge.js'), 'utf8')
  assert.ok(source.includes(`'${APP3_BRIDGE_CHANNEL}'`), 'App 3 source bridge uses the same channel')
})

test('App 2 embed code reads versions only from app3Embed.ts and never imports App 3 code', () => {
  const dir = file('app/workbench/components/animation-creation/')
  const sources = [dir + 'index.tsx', ...readdirSync(dir + 'hooks').map((name) => dir + 'hooks/' + name)]
  for (const path of sources) {
    const text = readFileSync(path, 'utf8')
    assert.doesNotMatch(text, /animation-studio\/v\d|bbs-animation-studio-v\d/, `${path} hard-codes an App 3 version`)
    assert.doesNotMatch(text, /from ['"][^'"]*animation-studio\/work/, `${path} imports App 3 source`)
  }
})
