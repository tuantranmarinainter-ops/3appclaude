import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'
import { makeEmptyDraft } from '@topview/3d-builder'

const base = process.env.STUDIO_URL, output = process.env.SMOKE_OUTPUT
if (!base || !/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(base) || !output) throw new Error('Set loopback STUDIO_URL and SMOKE_OUTPUT; use isolated test storage.')
await mkdir(output, { recursive: true })
const browser = await chromium.launch()
const errors = [], external = [], checks = []
let projectId
try {
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 }, locale: 'vi-VN' })
  await context.route('**/*', (route) => {
    const url = new URL(route.request().url())
    if (['data:', 'blob:'].includes(url.protocol) || ['127.0.0.1', 'localhost'].includes(url.hostname)) return route.continue()
    external.push(url.href); return route.abort()
  })
  assert.ok((await context.request.post(`${base}/api/unified/session`, { headers: { Origin: base } })).ok())
  const scene = makeEmptyDraft('Feature navigation smoke', 30, 90, { fov: 50, position: { x: 3, y: 2, z: 4 }, rotation: { x: 0, y: 0, z: 0 }, lookAt: { x: 0, y: 0.5, z: 0 } })
  scene.content.nodes.push({ id: 'box', name: 'Box', type: 'primitive', visible: true, locked: false,
    transform: { position: { x: 0, y: 0.5, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
    primitive: { kind: 'BoxGeometry', parameters: { width: 1, height: 1, depth: 1 } },
  })
  const creation = await (await context.request.post(`${base}/api/unified/commands`, { headers: { Origin: base }, data: {
    requestId: randomUUID(), command: 'project.create', args: { name: 'Feature navigation smoke', scene },
  } })).json()
  assert.equal(creation.ok, true, JSON.stringify(creation)); projectId = creation.projectId
  const page = await context.newPage()
  page.setDefaultTimeout(45_000)
  page.on('pageerror', (error) => errors.push(error.message))
  const search = page.locator('#wb-feature-search')
  const item = (id) => page.locator(`[data-feature-id="${id}"]`)
  const state = async () => (await (await context.request.get(`${base}/api/unified/projects/${projectId}`)).json())
  const ready = () => page.waitForFunction(() => window.__stage?.ready && window.__store?.getState().ready)
  const focused = (selector) => page.waitForFunction((selector) => document.activeElement?.matches(selector), selector)
  const featureIds = () => page.getByRole('treeitem').evaluateAll((nodes) => nodes.map((node) => node.dataset.featureId))
  await page.goto(`${base}/?unified=${projectId}`)
  await ready()
  await page.getByRole('button', { name: 'Thu gọn', exact: true }).click()
  const collapsed = await featureIds()
  assert.equal(collapsed.length, 8)
  for (const query of ['xuong', 'XƯƠNG', '1.3.2']) {
    await search.fill(query)
    assert.deepEqual(await featureIds(), ['1.3', '1.3.2'])
    assert.equal(await item('1.3.2').getAttribute('aria-disabled'), 'true')
    assert.match(await item('1.3.2').innerText(), /FBX Motion/)
    await item('1.3.2').focus()
    await page.keyboard.press('Enter')
    assert.equal(await page.locator('.wb-retarget').count(), 0)
  }
  checks.push('accent/case/ID search, correct ancestors, disabled reason and no activation')
  await search.fill('camera')
  assert.deepEqual(await featureIds(), ['1.2', '1.2.4', '1.4', '1.4.2'])
  await page.getByRole('button', { name: 'Thu gọn', exact: true }).click()
  assert.deepEqual(await featureIds(), ['1.2', '1.4'])
  await page.getByRole('button', { name: 'Mở hết', exact: true }).click()
  await item('1.4.2').click()
  await focused('.t3d-leftrail-pane-title')
  assert.equal(await page.evaluate(() => window.__store.getState().libraryTab), 'camera')
  await search.fill('')
  assert.deepEqual(await featureIds(), collapsed)
  checks.push('camera leaf opens camera library and focuses its heading; search leaves expansion preference intact')

  await item('1.4').focus()
  await page.keyboard.press('ArrowRight')
  assert.equal(await item('1.4').getAttribute('aria-expanded'), 'true')
  await page.keyboard.press('ArrowRight'); await focused('[data-feature-id="1.4.1"]')
  await page.keyboard.press('ArrowDown'); await focused('[data-feature-id="1.4.2"]')
  await page.keyboard.press('ArrowUp'); await focused('[data-feature-id="1.4.1"]')
  await page.keyboard.press('ArrowLeft'); await focused('[data-feature-id="1.4"]')
  await page.keyboard.press('ArrowLeft')
  assert.equal(await item('1.4').getAttribute('aria-expanded'), 'false')
  await page.keyboard.press('Home'); await focused('[data-feature-id="1.1"]')
  await page.keyboard.press('End'); await focused('[data-feature-id="2"]')
  assert.equal(await page.locator('[role="treeitem"][tabindex="0"]').count(), 1)
  await page.keyboard.press('Control+k'); await focused('#wb-feature-search')
  await search.fill('camera')
  await search.press('Escape'); await focused('[data-feature-id="2"]')
  assert.equal(await search.inputValue(), '')
  const frameInput = page.getByLabel('Frame cần render', { exact: true })
  await frameInput.focus(); await page.keyboard.press('Control+k')
  await focused('.wb-scene-render input')
  checks.push('roving tabindex, arrows, Home/End, Escape restoration, Ctrl+K skips editing fields')

  await page.evaluate(() => { const state = window.__store.getState(); state.setFrame(33); state.select({ kind: 'node', nodeId: 'box' }) })
  await search.fill('1.2.2')
  await item('1.2.2').focus(); await page.keyboard.press('Enter')
  await focused('.t3d-inspector-title')
  await search.fill('1.3.1'); await item('1.3.1').click()
  await focused('#wb-retarget-title')
  await search.fill('1.4.3'); await item('1.4.3').click()
  await ready(); await focused('#wb-scene-render-title')
  assert.deepEqual(await page.evaluate(() => ({ frame: window.__store.getState().frame, selection: window.__store.getState().selection })), { frame: 33, selection: { kind: 'node', nodeId: 'box' } })
  const navigated = await state()
  assert.equal(navigated.project.revision, 0)
  assert.equal(navigated.history.canUndo, false)
  checks.push('Enter opens selected-object inspector; cross-workspace focus preserves NodeID/playhead/revision/history')

  await search.fill('')
  for (let index = 0; index < 20; index++) {
    const target = index % 3 === 0 ? '1.3' : index % 3 === 1 ? '1.5' : '1.4'
    await item(target).click()
    if (target === '1.3') await focused('#wb-retarget-title')
    else {
      await ready()
      await page.waitForFunction(() => window.__store.getState().frame === 33)
      assert.equal(await page.locator('.studio-root').count(), 1)
    }
  }
  await item('1.4').click(); await ready()
  assert.equal((await state()).project.revision, 0)
  checks.push('20 workspace switches retain playhead and do not add project history or duplicate editor roots')

  const failSave = (route) => route.request().postDataJSON()?.command === 'scene.apply'
    ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ ok: false, error: { code: 'TEST_FAILURE', message: 'Forced navigation save failure' } }) })
    : route.continue()
  await page.route('**/api/unified/commands', failSave)
  await page.evaluate(() => window.__store.getState().renameNode('box', 'Saved before navigation'))
  await item('1.3').click()
  await page.locator('.wb-unified-error').waitFor()
  assert.equal(await page.locator('.studio-root').count(), 1)
  assert.equal(await page.locator('.wb-retarget').count(), 0)
  assert.equal((await state()).project.revision, 0)
  await page.unroute('**/api/unified/commands', failSave)
  await item('1.3').click(); await focused('#wb-retarget-title')
  const saved = await state()
  assert.equal(saved.project.scene.content.nodes.find((node) => node.id === 'box').name, 'Saved before navigation')
  assert.equal(saved.project.revision, 1)
  checks.push('save failure retains the current workspace; retry saves exactly one revision before unmount')

  await page.getByRole('button', { name: 'Thu gọn', exact: true }).click()
  await page.reload(); await ready()
  await page.locator('.t3d-boot').waitFor({ state: 'hidden' })
  assert.deepEqual(await featureIds(), collapsed)
  await search.fill('camera')
  for (const viewport of [{ width: 1366, height: 768 }, { width: 1920, height: 1080 }]) {
    await page.setViewportSize(viewport)
    assert.ok(await page.getByRole('treeitem').evaluateAll((nodes) => nodes.every((node) => node.getBoundingClientRect().height >= 32)))
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    await page.screenshot({ path: path.join(output, `navigation-${viewport.width}.png`) })
  }
  checks.push('expansion preference survives reload; desktop targets >=32px and no horizontal overflow')
  assert.deepEqual(errors, []); assert.deepEqual(external, [])
  const report = { passed: true, projectId, browserVersion: browser.version(), checks, errors, external }
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify(report, null, 2))
} catch (error) {
  await writeFile(path.join(output, 'report.json'), JSON.stringify({ passed: false, projectId, checks, errors, external, error: String(error) }, null, 2) + '\n')
  throw error
} finally { await browser.close() }
