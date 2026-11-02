/** Runs the actual React hooks in Chromium, with an isolated synthetic network/clock. */
import { chromium } from 'playwright'
import { readFile, mkdtemp, rm } from 'node:fs/promises'
import { realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const temp = await mkdtemp(path.join(tmpdir(), 'b43-hooks-'))
let browser
try {
  const require = createRequire(realpathSync(new URL('../../../packages/builder/node_modules/tsx/package.json', import.meta.url)))
  const output = path.join(temp, 'hooks.js')
  require('esbuild').buildSync({ entryPoints: [fileURLToPath(new URL('./b43Hooks.browser.tsx', import.meta.url))], bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic', outfile: output })
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? (process.platform === 'win32' ? undefined : '/usr/bin/chromium'), args: ['--no-sandbox'] })
  const page = await browser.newPage()
  const errors = []; page.on('pageerror', error => errors.push(error.message))
  await page.route('http://127.0.0.1/b43-hooks', route => route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' }))
  await page.goto('http://127.0.0.1/b43-hooks')
  await page.addScriptTag({ content: await readFile(output, 'utf8') })
  console.log(JSON.stringify(await page.evaluate(() => window.run())))
  if (errors.length) throw Error(errors.join('\n'))
} finally { await browser?.close(); await rm(temp, { recursive: true, force: true }) }
