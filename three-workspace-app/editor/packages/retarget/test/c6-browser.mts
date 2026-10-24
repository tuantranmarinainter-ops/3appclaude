import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { createRequire } from 'node:module'
import { startWorkbench } from '../workbench/server.ts'

const data = resolve(process.argv[2]!), output = resolve(process.argv[3]!)
process.env.W01_LIBRARY = join(data, 'library')
const require = createRequire(new URL('../../../apps/studio/package.json', import.meta.url))
const { chromium } = require('playwright')
const bench = await startWorkbench({ port: 0 }), browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
page.setDefaultTimeout(120000)
const errors: string[] = [], requests: any[] = []
page.on('pageerror', (e: Error) => errors.push(e.message))
page.on('request', (r: any) => { if (r.method() === 'POST' && r.url().endsWith('/api/runs')) requests.push(r.postDataJSON()) })
mkdirSync(output, { recursive: true })
try {
  await page.goto(bench.url)
  await page.locator('#targets button').first().waitFor({ state: 'attached' })
  await page.locator('#pathInput').fill(join(data, 'Samba Dancing.fbx'))
  await page.locator('#pathBtn').click()
  await page.locator('#actionPickerList tbody tr').first().waitFor({ timeout: 60000 })
  await page.locator('#actionPickerList tbody tr').first().click()
  await page.locator('#actionPickerClose').click()
  await page.locator('#adjustFieldset').scrollIntoViewIfNeeded()
  await page.screenshot({ path: join(output, 'controls-before.png') })
  await page.selectOption('[name=adj_handPose]', 'natural')
  await page.selectOption('[name=adj_handSide]', 'left')
  await page.selectOption('#adjJoint', 'LeftArm')
  await page.selectOption('#adjJointAxes', 'world')
  await page.fill('#adjJointX', '10')
  await page.locator('#adjustPreview').click({ force: true, noWaitAfter: true })
  await page.waitForFunction(() => document.querySelector('#cancelBtn')?.hasAttribute('hidden'), null, { timeout: 120000 })
  assert.equal(requests.length, 1)
  assert.equal(requests[0].options.adjustments.handPose, 'natural')
  assert.equal(requests[0].options.adjustments.jointAxes.LeftArm, 'world')
  assert.equal(requests[0].options.previewAction, 0)
  await page.locator('#adjustFieldset').scrollIntoViewIfNeeded()
  await page.screenshot({ path: join(output, 'controls-after.png') })
  await page.locator('#adjustLive').check()
  await page.locator('[name=adj_upperArm]').evaluate((el: HTMLInputElement) => { el.value = '1.2'; el.dispatchEvent(new Event('input', { bubbles: true })) })
  await page.waitForFunction(() => !document.querySelector('#cancelBtn')?.hasAttribute('hidden'), null, { timeout: 60000 })
  await page.waitForFunction(() => document.querySelector('#cancelBtn')?.hasAttribute('hidden'), null, { timeout: 120000 })
  assert.equal(requests.length, 2)
  assert.equal(requests[1].options.adjustments.upperArm, 1.2)
  assert.deepEqual(errors, [])
  await page.screenshot({ path: join(output, 'live-preview.png') })
  writeFileSync(join(output, 'browser.json'), JSON.stringify({ requests, pageErrors: errors }, null, 2))
  console.log('C6 browser: preview button, live preview, scoped hands and World axes PASS')
} catch (error) {
  await page.screenshot({ path: join(output, 'browser-failure.png') })
  console.error(JSON.stringify({ errors, text: await page.locator('body').innerText() }))
  throw error
} finally { await browser.close(); await bench.close() }
