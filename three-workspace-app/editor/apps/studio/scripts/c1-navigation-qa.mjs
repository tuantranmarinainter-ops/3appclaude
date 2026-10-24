import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const base = process.env.C1_BASE_URL ?? 'http://127.0.0.1:3003'
const projectId = process.env.C1_NAV_PROJECT_ID
assert.ok(projectId, 'C1_NAV_PROJECT_ID must identify a prepared QA copy with three covering clips')
const evidence = process.env.C1_EVIDENCE_DIR ?? fileURLToPath(new URL('../../../../../qa-c1/evidence', import.meta.url))
mkdirSync(evidence, { recursive: true })
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, locale: 'vi-VN' })
  page.setDefaultTimeout(15000)
  await page.request.post(`${base}/api/unified/session`, { headers: { Origin: base } })
  await page.goto(`${base}/?unified=${projectId}`)
  const oldNav = page.locator('nav[aria-label="Chế độ biên tập trong App 2"]')
  const legacyNavigation = await oldNav.count() > 0
  const nav = legacyNavigation ? oldNav : page.locator('nav[aria-label="5 workspace"]')
  const animation = nav.getByRole('button', { name: /Animation/ })
  if (legacyNavigation) { await animation.focus(); await animation.press('Enter') }
  else await animation.click()
  const panel = page.locator('.wb-animation-creation')
  await panel.waitFor()
  await page.waitForFunction(() => document.activeElement?.matches('.wb-animation-creation'))
  const project = await (await page.request.get(`${base}/api/unified/projects/${projectId}`)).json()
  const actor = Object.values(project.project.characters).find(c => c.name.startsWith('Gỗ Xưa'))
  await panel.locator('select').nth(0).selectOption(actor.id)
  const toolbar = panel.locator('header[aria-label="Shot từ cảnh"]')
  await toolbar.locator('input[type=number]').nth(0).fill('0')
  await toolbar.locator('input[type=number]').nth(1).fill('300')
  const open = toolbar.getByRole('button', { name: 'Mở shot từ cảnh' })
  await open.click()
  await panel.getByRole('status').filter({ hasText: 'Đã mở shot' }).waitFor()
  const frame = page.frame({ url: /animation-studio\/v1\.\d+\.\d+\/index\.html/ })
  await frame.evaluate(() => {
    const studio = window.__studio
    const bone = studio.recordNames().find(b => /spine|chest|hips/i.test(b.name))
    studio.seek(1 / 30); studio.selectUser(bone.id, false)
    const input = document.getElementById('rx')
    input.value = '18'; input.dispatchEvent(new Event('change', { bubbles: true }))
    document.getElementById('keyBtn').click()
  })
  const discard = panel.getByRole('button', { name: 'Bỏ sửa' })
  await discard.waitFor()
  let bridgeReloads = 0
  await page.route('**/host-bridge.js', async route => {
    bridgeReloads++
    await new Promise(resolve => setTimeout(resolve, 800))
    await route.continue()
  })
  await discard.click()
  assert.equal(await open.isDisabled(), true, 'Open must wait for the reloaded bridge')
  assert.equal(await panel.getByRole('button', { name: 'Lưu vào project' }).isDisabled(), true)
  assert.equal(await toolbar.getByRole('button', { name: 'Trả kết quả về cảnh' }).isDisabled(), true, 'Discard must clear stale shot identity')
  await page.waitForFunction(() => {
    const button = [...document.querySelectorAll('.wb-animation-creation button')].find(b => b.textContent === 'Mở shot từ cảnh')
    return button && !button.disabled
  }, null, { timeout: 15000 })
  assert.equal(bridgeReloads, 1)
  await open.click()
  await panel.getByRole('status').filter({ hasText: 'Đã mở shot' }).waitFor()
  assert.equal(await panel.getByRole('button', { name: 'Lưu vào project' }).isDisabled(), false)
  assert.equal(await panel.getByRole('alert').count(), 0)
  await page.screenshot({ path: `${evidence}/c1-navigation-reload.png`, fullPage: true })
  const report = { pass: true, projectId, navigation: legacyNavigation ? 'legacy keyboard' : 'C7 mouse click', bridgeReloads, staleShotCleared: true, reopenedAfterHandshake: true }
  writeFileSync(`${evidence}/c1-navigation-report.json`, JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify(report))
} finally {
  await browser.close()
}
