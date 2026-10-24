import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, copyFileSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { createRequire } from 'node:module'
import { startWorkbench } from '../workbench/server.ts'
const output = resolve(process.argv[2] ?? 'outputs/C17')
const fixture = process.env.W01_DRAG_FIXTURE
assert.ok(fixture, 'Set W01_DRAG_FIXTURE to a GLB with a humanoid skeleton')
mkdirSync(output, { recursive: true })
const temporary = mkdtempSync(join(tmpdir(), 'w01-c17-review-'))
process.env.W01_LIBRARY = join(temporary, 'library')
const source = join(temporary, 'source.glb'); copyFileSync(fixture, source)
const second = join(temporary, 'second.glb'); copyFileSync(process.env.W01_DRAG_SECOND ?? fixture, second)
const require = createRequire(new URL('../../../apps/studio/package.json', import.meta.url)), { chromium } = require('playwright')
const bench = await startWorkbench({ port: 0 }), browser = await chromium.launch(), page = await browser.newPage({ viewport: { width: 1800, height: 1100 } })
page.setDefaultTimeout(120000)
const errors: string[] = [], checks: string[] = []
page.on('pageerror', (error: Error) => errors.push(error.message))
const integration = process.env.W01_C13_PUBLIC
let combined: string | undefined
await page.route('**/app.js', async (route: any) => {
 const response = await route.fetch(); let body = await response.text()
 if (integration) {
  const c13 = readFileSync(join(integration, 'app.js'), 'utf8')
  const replace = (start: string, end: string) => {
   const a = body.indexOf(start), b = body.indexOf(end, a), x = c13.indexOf(start), y = c13.indexOf(end, x)
   assert.ok(a >= 0 && b > a && x >= 0 && y > x, `C13 patch anchors: ${start}`)
   body = body.slice(0, a) + c13.slice(x, y) + body.slice(b)
  }
  body = "import { mappingTransaction } from './mapping-transaction.js'\n" + body
  body = body.replace('let activeMappingTarget = null', 'let mappingUndo = null\nlet activeMappingTarget = null')
  replace('function syncMappingHighlights()', 'viewer.left.joints.onPick =')
  replace('function renderMapping()', 'function confirmMapping(')
  combined = body
 }
 await route.fulfill({ response, body: body + '\nwindow.mappingTest={state,viewer,openBatchMapping};' })
})
if (integration) await page.route('**/mapping-transaction.js', (route: any) => route.fulfill({ contentType: 'text/javascript', body: readFileSync(join(integration, 'mapping-transaction.js'), 'utf8') }))
const state = () => page.evaluate(() => JSON.stringify(window.mappingTest.state.rows))
const cameras = () => page.evaluate(() => [window.mappingTest.viewer.left, window.mappingTest.viewer.right].map(p => ({ position: p.camera.position.toArray(), quaternion: p.camera.quaternion.toArray(), target: p.controls.target.toArray(), enabled: p.controls.enabled, buttons: p.controls.mouseButtons })))
const markers = async (host: string) => page.locator(`#${host} .joint-marker`).evaluateAll((nodes: HTMLElement[]) => nodes.filter(n => !n.hidden).map(n => { const b = n.getBoundingClientRect(); return { name: n.dataset.bone, x: b.x + b.width / 2, y: b.y + b.height / 2 } }).filter(p => document.elementFromPoint(p.x, p.y)?.closest('.joint-marker')?.getAttribute('data-bone') === p.name))
let target: any, src: any
const begin = async () => { await page.mouse.move(target.x, target.y); await page.mouse.down(); await page.mouse.move(src.x, src.y, { steps: 12 }); await page.waitForTimeout(80) }
try {
 await page.goto(bench.url)
 await page.locator('#pathInput').fill(source); await page.locator('#pathBtn').click()
 await page.waitForFunction(() => window.mappingTest?.state.inspect && window.mappingTest.viewer.left.joints.entries.length)
 await page.evaluate(() => { const t = window.mappingTest; t.openBatchMapping(t.state.batch.entries[0]); t.viewer.playing = false; for (const p of [t.viewer.left, t.viewer.right]) p.controls.enableDamping = false; window.dragClicks = 0; document.addEventListener('click', e => { if (e.target.closest?.('#rightHost .joint-marker')) window.dragClicks++ }); document.addEventListener('pointerdown', e => { window.dragPointer = e.pointerId }, true) })
 await page.locator('#mapRows input[data-target="LeftFoot"]').focus(); await page.waitForTimeout(100)
 assert.ok(await page.evaluate(() => window.mappingTest.viewer.right.joints.selected.has('LeftFoot')))
 const right = await markers('rightHost'), left = await markers('leftHost'); assert.ok(right.length && left.length)
 target = right.find(p => /LeftFoot$/.test(p.name)) ?? right[0]
 src = left.find(p => /RightHand$/.test(p.name)) ?? left[left.length - 1]
 const name = target.name.replace(/^mixamorig:?/i, ''), before = await state(), cameraBefore = await cameras()
 await begin(); assert.equal(await page.locator('.mapping-wire').count(), 1)
 assert.equal(await page.evaluate(() => window.mappingTest.viewer.left.joints.hovered), src.name)
 assert.equal(await page.locator(`#leftHost .joint-marker[data-bone="${src.name}"] .bone-label`).isVisible(), true)
 assert.equal(await page.evaluate(() => document.querySelector('#rightHost .joint-marker[data-bone="' + window.mappingTest.viewer.right.joints.entries.find(e => e.marker.hasPointerCapture(window.dragPointer)).name + '"]').hasPointerCapture(window.dragPointer)), true)
 await page.screenshot({ path: join(output, 'wire-hover.png') })
 await page.locator('#mapRows input[data-target="RightFoot"]').evaluate((input: HTMLInputElement) => input.focus({ preventScroll: true }))
 await page.mouse.up()
 assert.equal(await page.locator('.mapping-wire').count(), 0)
 assert.equal(await page.locator(`#mapRows input[data-target="${name}"]`).inputValue(), src.name)
 assert.deepEqual(await cameras(), cameraBefore)
 assert.equal(await page.evaluate(() => window.mappingTest.viewer.playing), false)
 assert.equal(await page.evaluate(() => window.dragClicks), 0)
 checks.push('drag keeps starting target after focus moves to RightFoot', 'focus highlights target', 'native pointer capture', 'real drag + hover label + assignment', 'camera/control vectors unchanged', 'paused state restored', 'drag click suppressed')
 if (integration) {
  const assigned = await page.evaluate(() => window.mappingTest.state.rows)
  assert.equal(assigned.filter(row => row.source === src.name).length, 1)
  const originals = JSON.parse(before), displaced = originals.filter(row => row.source === src.name && row.target !== name)
  for (const row of displaced) assert.equal(assigned.find(item => item.target === row.target).source, null)
  await page.getByRole('button', { name: 'Hoàn tác', exact: true }).click()
  const undone = await page.evaluate(() => window.mappingTest.state.rows)
  const seen = new Set(); for (const row of undone) if (row.source) { assert.ok(!seen.has(row.source)); seen.add(row.source) }
  for (const row of displaced) assert.equal(undone.find(item => item.target === row.target).source, row.source)
  checks.push('C13 route-only integration: unique assignment and Undo restores displaced mapping')
 }
 for (const cancel of ['outside', 'Escape', 'pointercancel', 'blur', 'removed-target', 'replaced-source']) {
  const rows = await state(), camera = await cameras()
  await page.evaluate(() => { window.mappingTest.viewer.playing = true })
  await begin(); assert.equal(await page.evaluate(() => window.mappingTest.viewer.playing), false)
  if (cancel === 'outside') { await page.mouse.move(8, 8, { steps: 6 }); await page.mouse.up() }
  else if (cancel === 'Escape') await page.keyboard.press('Escape')
  else if (cancel === 'pointercancel') await page.evaluate(() => window.dispatchEvent(new PointerEvent('pointercancel', { pointerId: window.dragPointer })))
  else if (cancel === 'blur') await page.evaluate(() => window.dispatchEvent(new Event('blur')))
  else if (cancel === 'removed-target') await page.evaluate(() => { const overlay = window.mappingTest.viewer.right.joints; const marker = overlay.entries.find(e => e.marker.hasPointerCapture(window.dragPointer)).marker; window.removedMarker = marker; marker.remove() })
  else await page.evaluate(() => { const element = window.mappingTest.viewer.left.joints.element; element.replaceChildren(...element.childNodes) })
  await page.waitForFunction(() => !document.querySelector('.mapping-wire'))
  await page.mouse.up()
  if (cancel === 'removed-target') await page.evaluate(() => window.mappingTest.viewer.right.joints.element.append(window.removedMarker))
  assert.equal(await state(), rows, `${cancel} must not assign`)
  assert.equal(await page.evaluate(() => window.mappingTest.viewer.playing), true, `${cancel} restores playing`)
  assert.deepEqual(await cameras(), camera)
  assert.equal(await page.evaluate(() => window.mappingTest.viewer.left.joints.hovered), null)
  await page.evaluate(() => { window.mappingTest.viewer.playing = false })
  checks.push(`${cancel}: no assignment, camera unchanged, playback restored`)
 }
 // A simple click still picks a joint after drag/cancel paths have released capture.
 await page.mouse.click(target.x, target.y)
 assert.equal(await page.evaluate(() => window.dragClicks), 1)
 checks.push('simple marker click remains functional')
 await begin()
 await page.evaluate(path => { document.querySelector('#pathInput').value = path; document.querySelector('#pathBtn').click() }, second)
 await page.waitForFunction(() => !document.querySelector('.mapping-wire'))
 await page.mouse.up()
 await page.waitForFunction(() => window.mappingTest.state.source?.name === 'second.glb' && window.mappingTest.viewer.left.joints.entries.length)
 checks.push('real second source load cancels active drag')
 await page.screenshot({ path: join(output, 'assigned.png') })
 assert.deepEqual(errors, [])
 writeFileSync(join(output, 'browser.json'), JSON.stringify({ status: 'PASS', fixture, integration: !!integration, target: name, source: src.name, visibleTargets: right.length, visibleSources: left.length, checks, errors }, null, 2))
 console.log(JSON.stringify({ status: 'PASS', fixture, integration: !!integration, checks }))
} catch (error) { await page.screenshot({ path: join(output, 'failure.png') }); writeFileSync(join(output, 'failure.json'), JSON.stringify({ error: String(error), checks, errors }, null, 2)); throw error }
finally { if (combined) writeFileSync(join(output, 'combined-app.js'), combined); await browser.close(); await bench.close() }
