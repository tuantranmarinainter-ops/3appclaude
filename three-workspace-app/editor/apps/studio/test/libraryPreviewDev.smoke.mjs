import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { chromium } from 'playwright'

const studio = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const port = 3300 + process.pid % 1000
const origin = `http://127.0.0.1:${port}`
const output = `.next-library-preview-smoke-${process.pid}`

test('preview page resolves its result under next dev without waiting for HMR to go idle', async () => {
  const tsconfig = path.join(studio, 'tsconfig.json')
  const initialTsconfig = await readFile(tsconfig, 'utf8')
  const server = spawn(process.execPath, [path.join(studio, 'node_modules/next/dist/bin/next'), 'dev', '--hostname', '127.0.0.1', '--port', String(port)], {
    cwd: studio,
    env: { ...process.env, NEXT_DIST_DIR: output },
    stdio: ['ignore', 'ignore', 'pipe'],
  })
  let browser
  let stderr = ''
  server.stderr.on('data', chunk => { stderr = `${stderr}${String(chunk)}`.slice(-4000) })
  try {
    let ready = false
    for (let attempt = 0; attempt < 120; attempt++) {
      if (server.exitCode !== null) throw new Error(`next dev exited early: ${stderr}`)
      try { if ((await fetch(`${origin}/library/preview-render`)).ok) { ready = true; break } } catch { /* server still starting */ }
      await delay(500)
    }
    assert.equal(ready, true, `next dev did not become ready: ${stderr}`)

    browser = await chromium.launch({ headless: true })
    const page = await browser.newPage()
    await page.goto(`${origin}/library/preview-render?${new URLSearchParams({ actionUuid: 'missing-action', charId: 'missing-character' })}`, { waitUntil: 'load', timeout: 45_000 })
    await page.waitForFunction(() => Boolean(window.__libraryPreviewResult), undefined, { timeout: 30_000 })
    const preview = await page.evaluate(() => window.__libraryPreviewResult)
    assert.equal(typeof preview?.error, 'string')
    await page.close()
  } finally {
    await browser?.close().catch(() => undefined)
    if (server.exitCode === null) server.kill('SIGTERM')
    await Promise.race([new Promise(resolve => server.once('exit', resolve)), delay(5000)])
    if (server.exitCode === null) server.kill('SIGKILL')
    await rm(path.join(studio, output), { recursive: true, force: true })
    await writeFile(tsconfig, initialTsconfig)
  }
})
