import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createServer } from 'node:http'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

const require = createRequire(new URL('../../../apps/studio/package.json', import.meta.url))
const { chromium } = require('playwright')
const publicDir = new URL('../workbench/public/', import.meta.url)

test('review splitter: drag, persist, keyboard, bounds, hide and responsive height', async () => {
  const server = createServer(async (req, res) => {
    const name = req.url === '/' ? 'index.html' : req.url.slice(1)
    if (!['index.html', 'styles.css', 'resizable-panels.js'].includes(name)) { res.writeHead(404).end(); return }
    let content = await readFile(new URL(name, publicDir), 'utf8')
    // Isolate layout interactions from retarget jobs and user libraries.
    if (name === 'index.html') content = content.replace(/<script type="module" src="\/app.js"><\/script>/, '')
    res.setHeader('Content-Type', name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html; charset=utf-8')
    res.end(content)
  })
  await new Promise(ok => server.listen(0, '127.0.0.1', ok))
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1000 } })
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    const url = `http://127.0.0.1:${server.address().port}`
    const show = () => page.evaluate(() => { document.querySelector('#review').hidden = false; document.querySelector('.viewers').classList.add('has-review'); document.querySelector('#reviewInner').style.height = '11200px' })
    const handle = page.locator('[data-resize-panel="review"]')
    const size = () => page.locator('#review').boundingBox()
    const settle = () => page.waitForTimeout(100)
    const drag = async (dx, dy = 0) => {
      await handle.scrollIntoViewIfNeeded()
      const box = await handle.boundingBox()
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy, { steps: 8 }); await page.mouse.up(); await settle()
    }
    await page.goto(url); await show(); await settle()
    assert.equal(await handle.getAttribute('aria-orientation'), 'vertical')
    const before = await size()
    await drag(-80)
    const after = await size()
    assert.ok(after.width >= before.width + 79)
    await page.reload(); await show(); await settle()
    assert.equal((await size()).width, after.width)
    await page.evaluate(() => { window.splitterLeakedKeys = 0; window.addEventListener('keydown', () => window.splitterLeakedKeys++) })
    await handle.focus(); await page.keyboard.press('ArrowLeft'); await settle()
    assert.equal(await page.evaluate(() => window.splitterLeakedKeys), 0)
    assert.equal((await size()).width, after.width + 10)
    await page.keyboard.press('Home'); await settle(); assert.equal((await size()).width, 240)
    await page.keyboard.press('End'); await settle()
    const panes = await page.locator('.pane').evaluateAll(nodes => nodes.map(n => n.getBoundingClientRect().width))
    assert.ok(panes.every(w => w >= 180), JSON.stringify(panes))
    assert.equal(Number(await handle.getAttribute('aria-valuenow')), (await size()).width)
    await handle.dblclick(); await settle(); assert.equal((await size()).width, 300)
    const output = process.env.C8_OUTPUT
    if (output) { await mkdir(output, { recursive: true }); await page.screenshot({ path: resolve(output, 'splitter-wide.png') }) }
    await page.setViewportSize({ width: 700, height: 1000 }); await settle()
    assert.equal(await handle.getAttribute('aria-orientation'), 'horizontal')
    assert.ok(await page.locator('.stage').evaluate(n => n.clientHeight < 1000))
    assert.ok(await page.locator('.viewers').evaluate(n => n.clientWidth <= n.parentElement.clientWidth))
    const lowBefore = await size(); await drag(0, -40); const lowAfter = await size()
    assert.ok(lowAfter.height > lowBefore.height, JSON.stringify({ lowBefore, lowAfter }))
    await page.reload(); await show(); await settle(); assert.equal((await size()).height, lowAfter.height)
    await handle.focus(); await page.keyboard.press('ArrowUp'); await settle(); assert.equal((await size()).height, lowAfter.height + 10)
    await page.keyboard.press('Home'); await settle(); assert.equal((await size()).height, 220)
    await page.keyboard.press('End'); await settle()
    const belowPanes = await page.locator('.pane').evaluateAll(nodes => nodes.map(n => n.getBoundingClientRect().height))
    assert.ok(belowPanes.every(h => h >= 180))
    if (output) {
      await page.screenshot({ path: resolve(output, 'splitter-below.png'), fullPage: true })
      await writeFile(resolve(output, 'splitter-numerics.json'), JSON.stringify({ before, after, panes, lowBefore, lowAfter, errors }, null, 2))
    }
    await page.evaluate(() => { document.querySelector('#review').hidden = true; document.querySelector('.viewers').classList.remove('has-review') })
    await settle(); assert.equal(await handle.isVisible(), false)
    assert.deepEqual(errors, [])
  } finally { await browser.close(); await new Promise(ok => server.close(ok)) }
})
