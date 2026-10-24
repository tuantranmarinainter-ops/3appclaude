import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, statSync, writeFileSync, copyFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import { startWorkbench } from '../workbench/server.ts'
// Usage: ... cameraPreference.browser.mts <output-dir> <Xbot400.glb> <Samba.fbx>
const output = resolve(process.argv[2] ?? 'outputs/C15')
const inputs = [process.argv[3] ?? process.env.C15_SOURCE_GLB, process.argv[4] ?? process.env.C15_SOURCE_FBX]
for (const [index, path] of inputs.entries()) {
 assert.ok(path, `Provide ${index === 0 ? 'Xbot400.glb as argv[3] or C15_SOURCE_GLB' : 'Samba FBX as argv[4] or C15_SOURCE_FBX'}`)
 assert.ok(existsSync(resolve(path)) && statSync(resolve(path)).isFile(), `Fixture file missing: ${path}`)
}
mkdirSync(output, { recursive: true })
const temporary = mkdtempSync(join(tmpdir(), 'w01-c15-camera-'))
process.env.W01_LIBRARY = join(temporary, 'library')
const source = join(temporary, 'source.glb'), second = join(temporary, 'second.fbx')
copyFileSync(resolve(inputs[0]!), source)
copyFileSync(resolve(inputs[1]!), second)
const require = createRequire(new URL('../../../apps/studio/package.json', import.meta.url)), { chromium } = require('playwright')
const bench = await startWorkbench({ port: 0 }), browser = await chromium.launch()
const evidence: any = { errors: [], note: 'Damping disabled only in test to isolate camera resets; view chosen by real mouse drag/wheel.' }
const page = await browser.newPage({ viewport: { width: 1800, height: 1100 } }); page.setDefaultTimeout(120000)
page.on('pageerror', (error: Error) => evidence.errors.push(error.message))
try {
 await page.goto(bench.url)
 await page.evaluate(async () => {
  const { Viewer } = await import('/viewer.js')
  const original = Viewer.prototype.select
  Viewer.prototype.select = function (args: any) {
   const info = original.call(this, args); (window as any).__cameraViewer = this
   if (info.right) (window as any).__cameraDone = { source: args.sourceIndex, clip: this.right.clip.name }
   return info
  }
 })
 assert.equal(await page.locator('#autoFitCamera').isChecked(), false)
 const load = async (path: string) => { await page.locator('#pathInput').fill(path); await page.locator('#pathBtn').click(); await page.waitForFunction(() => (window as any).__cameraViewer?.right.clip && document.querySelector('#cancelBtn')?.hasAttribute('hidden')) }
 await load(source)
 await page.locator('#playBtn').click()
 await page.evaluate(() => { const v = (window as any).__cameraViewer; for (const pane of [v.left, v.right]) pane.controls.enableDamping = false })
 const snapshot = () => page.evaluate(() => { const v = (window as any).__cameraViewer; return [v.left, v.right].map(p => [...p.camera.position.toArray(), ...p.camera.quaternion.toArray(), p.camera.zoom, ...p.controls.target.toArray()]) })
 const maxDelta = (a: number[][], b: number[][]) => Math.max(...a.flatMap((row, i) => row.map((n, j) => Math.abs(n - b[i][j]))))
 const orbit = async () => { for (const id of ['leftHost', 'rightHost']) { const box = await page.locator(`#${id} canvas`).boundingBox(); assert.ok(box); await page.mouse.move(box.x + box.width*.5, box.y + box.height*.4); await page.mouse.down(); await page.mouse.move(box.x + box.width*.5 + 44, box.y + box.height*.4 + 28, { steps: 8 }); await page.mouse.up(); await page.mouse.wheel(0, -120) } await page.waitForTimeout(250) }
 const change = async (index: number) => { await page.selectOption('#actionSel', String(index)); await page.waitForFunction(i => (window as any).__cameraDone?.source === i && document.querySelector('#cancelBtn')?.hasAttribute('hidden'), index) }
 await orbit(); const before = await snapshot(); await change(1); const after = await snapshot()
 evidence.off = { before, after, maxDelta: maxDelta(before, after) }; assert.ok(evidence.off.maxDelta < 1e-8)
 await page.screenshot({ path: join(output, 'camera-held.png') })
 await page.locator('#autoFitCamera').check(); await orbit(); const enabledBefore = await snapshot(); await change(2); const enabledAfter = await snapshot()
 evidence.on = { before: enabledBefore, after: enabledAfter, maxDelta: maxDelta(enabledBefore, enabledAfter) }; assert.ok(evidence.on.maxDelta > .01)
 await page.screenshot({ path: join(output, 'camera-autofit.png') })
 await page.reload(); assert.equal(await page.locator('#autoFitCamera').isChecked(), true)
 await page.locator('#autoFitCamera').uncheck(); await page.reload(); assert.equal(await page.locator('#autoFitCamera').isChecked(), false)
 evidence.persistence = 'PASS'
 // Both panes keep the chosen view even when another source file is selected.
 await page.evaluate(async () => {
  const { Viewer } = await import('/viewer.js'), original = Viewer.prototype.select
  Viewer.prototype.select = function (args: any) { const info = original.call(this, args); (window as any).__cameraViewer = this; if (info.right) (window as any).__cameraDone = { source: args.sourceIndex }; return info }
 })
 await load(source); await page.evaluate(() => { for (const pane of [(window as any).__cameraViewer.left, (window as any).__cameraViewer.right]) pane.controls.enableDamping = false })
 await orbit(); const fileBefore = await snapshot(); await page.evaluate(() => { (window as any).__cameraDone = null });
 await page.locator('#pathInput').fill(second); await page.locator('#pathBtn').click()
 await page.waitForFunction(() => (window as any).__cameraDone && document.querySelector('#sourceInfo')?.textContent?.includes('second.fbx') && document.querySelector('#cancelBtn')?.hasAttribute('hidden'))
 const fileAfter = await snapshot(); evidence.sourceChange = { maxDelta: maxDelta(fileBefore, fileAfter) }; assert.ok(evidence.sourceChange.maxDelta < 1e-8)
 await page.locator('#frameBtn').click(); const manual = await snapshot(); evidence.manual = { maxDelta: maxDelta(fileAfter, manual) }; assert.ok(evidence.manual.maxDelta > .01)
 assert.deepEqual(evidence.errors, []); evidence.status = 'PASS'
 console.log(JSON.stringify(evidence))
} catch (error) { evidence.status = 'FAIL'; evidence.failure = String(error); await page.screenshot({ path: join(output, 'failure.png') }); throw error }
finally { writeFileSync(join(output, 'camera-numerics.json'), JSON.stringify(evidence, null, 2)); await browser.close(); await bench.close() }
