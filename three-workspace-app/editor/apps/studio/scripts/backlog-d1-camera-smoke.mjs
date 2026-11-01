// Run against an isolated Studio test server; creates a disposable camera project.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'
import { makeEmptyDraft } from '../../../packages/builder/dist/index.mjs'

const base = process.env.STUDIO_URL
const output = process.env.SMOKE_OUTPUT
if (!base || !/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(base) || !output) throw new Error('Set loopback STUDIO_URL and SMOKE_OUTPUT; use isolated test storage.')
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), args: ['--no-sandbox'] })
const errors = [], external = []
let projectId
try {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, locale: 'en-US' })
  await context.route('**/*', (route) => {
    const url = new URL(route.request().url())
    if (['data:', 'blob:'].includes(url.protocol) || ['127.0.0.1', 'localhost'].includes(url.hostname)) return route.continue()
    external.push(url.href); return route.abort()
  })
  assert.ok((await context.request.post(`${base}/api/unified/session`, { headers: { Origin: base } })).ok())
  const scene = makeEmptyDraft('Render browser smoke', 30, 90, { fov: 50, position: { x: 3, y: 2, z: 4 }, rotation: { x: 0, y: 0, z: 0 }, lookAt: { x: 0, y: 0.5, z: 0 } })
  const second = structuredClone(scene.content.nodes.find((node) => node.type === 'camera'))
  second.id = 'camera_2'; second.name = 'Camera 2'; second.transform.position.x = -3
  scene.content.nodes.push(second, { id: 'box', name: 'Box', type: 'primitive', visible: true, locked: false,
    transform: { position: { x: 0, y: 0.5, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
    primitive: { kind: 'BoxGeometry', parameters: { width: 1, height: 1, depth: 1 } },
  })
  scene.content.editorial = {version:1, activeSequenceId:'tap15', sequences:[{id:'tap15',clips:[{id:'shot01',cameraNodeId:'camera_1',sourceFrameStart:0,sourceFrameEnd:89}]}]}
  const created = await context.request.post(`${base}/api/unified/commands`, { headers: { Origin: base }, data: {
    requestId: randomUUID(), command: 'project.create', args: { name: 'Render browser smoke', scene },
  } })
  const creation = await created.json()
  assert.equal(creation.ok, true, JSON.stringify(creation)); projectId = creation.projectId
  const page = await context.newPage()
  const debugReceipts = [], debugFlushTasks = []
  page.on('response', response => {
    if (new URL(response.url()).pathname === '/api/unified/debug-log') {
      debugFlushTasks.push(response.json().then(body => debugReceipts.push({status:response.status(),...body})))
    }
  })
  page.setDefaultTimeout(45_000)
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(`${base}/?unified=${projectId}`)
  await page.waitForFunction(() => window.__stage?.ready && window.__store?.getState().ready)

  await page.getByRole('button',{name:'Debug',exact:true}).click()
  const debugDrawer = page.getByRole('dialog',{name:'Debug · ghi thao tác',exact:true})
  await debugDrawer.getByRole('button',{name:/Bắt đầu ghi/}).click()
  await debugDrawer.getByRole('button',{name:'Đóng bảng',exact:true}).click()
  await debugDrawer.waitFor({state:'hidden'})
  const layoutSamples = []
  async function assertLayout(label, needsHint = false) {
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    const sample = await page.evaluate(() => {
      const host = document.querySelector('.t3d-studio-host')
      const wrapper = host.closest('.studio-root')
      const viewport = document.querySelector('.t3d-viewport')
      const hint = document.querySelector('.t3d-pose-editor-hint')
      return {host:host.getBoundingClientRect().toJSON(),wrapper:wrapper.getBoundingClientRect().toJSON(),viewport:viewport.getBoundingClientRect().toJSON(),hint:hint?.getBoundingClientRect().toJSON(),hintText:hint?.textContent,hintOverflow:hint ? hint.scrollWidth-hint.clientWidth : 0}
    })
    layoutSamples.push({label,...sample})
    assert.ok(Math.abs(sample.host.width-sample.wrapper.width)<=1,`${label}: builder must fill its host`)
    if (needsHint) {
      assert.ok(sample.hint,`${label}: camera status must be visible`)
      assert.ok(sample.hint.left>=sample.viewport.left-1 && sample.hint.right<=sample.viewport.right+1,`${label}: camera hint must fit viewport`)
      assert.ok(sample.hintOverflow<=1,`${label}: camera hint must not clip text`)
    }
  }
  console.log('Ready',projectId)
  await assertLayout('before-interaction')
  await page.screenshot({path:path.join(output,'camera-before-interaction.png'),fullPage:true})
  const before = await page.evaluate(() => {
    const state = window.__store.getState(); const id = state.doc.content.nodes.find(n=>n.type==='camera').id
    state.setActiveCamera(id); state.setCameraPilot(id)
    return {id,doc:JSON.parse(JSON.stringify(state.doc))}
  })
  await page.getByRole('button',{name:'Khoá camera',exact:true}).waitFor({state:'visible'})
  await assertLayout('pilot-desktop',true)
  await page.screenshot({path:path.join(output,'camera-after-code-pilot.png'),fullPage:true})
  const canvas = page.locator('canvas').first(); const bounds = await canvas.boundingBox()
  await page.mouse.click(bounds.x+bounds.width/2,bounds.y+bounds.height/2)
  const start=Date.now()
  for (let i=0;i<12;i++) {
    const key=['w','a','s','d','q','e'][i%6]
    await page.keyboard.down(key); await page.waitForTimeout(2500); await page.keyboard.up(key)
  }
  await page.getByRole('button', { name: 'Khoá camera', exact: true }).click()
  await page.evaluate(() => window.__store.getState().setTimelineRange(0,100))
  await assertLayout('locked-desktop',true)
  const lockedBounds = await canvas.boundingBox()
  const locked = await page.evaluate(() => JSON.stringify(window.__store.getState().doc))
  await page.mouse.move(lockedBounds.x+lockedBounds.width/2,lockedBounds.y+lockedBounds.height/2)
  await page.mouse.down(); await page.mouse.move(lockedBounds.x+lockedBounds.width/2+80,lockedBounds.y+lockedBounds.height/2+40); await page.mouse.up()
  await page.mouse.wheel(0,200)
  await page.keyboard.down('e'); await page.waitForTimeout(500); await page.keyboard.up('e')
  assert.equal(await page.evaluate(() => JSON.stringify(window.__store.getState().doc)),locked)
  console.log('PASS locked mouse/wheel/E leaves shot unchanged')
  const ranges=await page.locator('input[type=range]').evaluateAll(es=>es.map(e=>({label:e.getAttribute('aria-label'),min:e.min,max:e.max})))
  console.log('ranges',JSON.stringify(ranges))
  const lens=page.getByRole('slider', {name: 'Tiêu cự', exact: true})

  console.log('lensCount',await lens.count())
  await lens.focus(); await page.keyboard.press('Home')
  await page.waitForTimeout(2000)
  const saveError = await page.evaluate(() => window.__store.getState().save({captureCover:false}))
  assert.equal(saveError,null)
  const persistedBefore = await (await context.request.get(`${base}/api/unified/projects/${projectId}`)).json()
  const beforeRevision=(persistedBefore.project ?? persistedBefore).revision
  assert.ok(Number.isInteger(beforeRevision),'Expected a persisted project revision')
  const lensBefore=await page.evaluate(()=>JSON.parse(JSON.stringify(window.__store.getState().doc)))
  await page.waitForTimeout(5000)
  const persistedAfter = await (await context.request.get(`${base}/api/unified/projects/${projectId}`)).json()
  const afterRevision=(persistedAfter.project ?? persistedAfter).revision
  assert.equal(beforeRevision,afterRevision)
  console.log('PASS idle5s persisted revision',beforeRevision,'→',afterRevision)
  const lensAfter=await page.evaluate(()=>JSON.parse(JSON.stringify(window.__store.getState().doc)))
  assert.equal((persistedAfter.project ?? persistedAfter).scene.content.nodes.find(n=>n.type==='camera').camera.fov,lensAfter.content.nodes.find(n=>n.type==='camera').camera.fov)
  assert.equal(lensBefore.content.nodes.find(n=>n.type==='camera')?.camera?.fov,lensAfter.content.nodes.find(n=>n.type==='camera')?.camera?.fov)
  await writeFile(path.join(output,'camera-lens-stable.json'),JSON.stringify({lensBefore,lensAfter,beforeRevision,afterRevision,persistedAfter,errors},null,2))
  await page.screenshot({path:path.join(output,'camera-after-lock-idle.png'),fullPage:true})
  await page.setViewportSize({width:700,height:1000})
  await assertLayout('locked-700px',true)
  await page.screenshot({path:path.join(output,'camera-locked-700px.png'),fullPage:true})
  await writeFile(path.join(output,'camera-layout.json'),JSON.stringify(layoutSamples,null,2))
  const after=await page.evaluate(() => {const s=window.__store.getState(); return {doc:JSON.parse(JSON.stringify(s.doc)),follow:s.followMode,pilot:s.cameraPilotId} })
  assert.ok(after.doc.content.nodes.some(n=>n.id===before.id))
  assert.equal(after.doc.content.editorial.sequences[0].clips[0].cameraNodeId,before.id)
  assert.equal(after.follow,true)
  await writeFile(path.join(output,'camera-pilot-30s.json'),JSON.stringify({projectId,durationMs:Date.now()-start,before,after,ranges,errors,external},null,2))
  await page.getByRole('button',{name:'Debug',exact:true}).click()
  const stopFlush = page.waitForResponse(response => new URL(response.url()).pathname === '/api/unified/debug-log')
  await debugDrawer.getByRole('button',{name:/Dừng ghi/}).click()
  await stopFlush
  const serverLogPath = await debugDrawer.locator('code').innerText()
  const downloading = page.waitForEvent('download')
  await debugDrawer.getByRole('button',{name:'Tải file log',exact:true}).click()
  const download = await downloading
  await download.saveAs(path.join(output,'camera-debug.txt'))
  await Promise.all(debugFlushTasks)
  const debugText = await readFile(path.join(output,'camera-debug.txt'),'utf8')
  assert.match(debugText,/\[PHÍM\] E ·/)
  assert.match(debugText,/\[SERVER\].*scene\.apply.*→ 200/)
  assert.match(debugText,/\[DỪNG\]/)
  assert.ok(debugReceipts.some(receipt => receipt.status === 200 && receipt.written > 0 && receipt.path === serverLogPath))
  await writeFile(path.join(output,'camera-debug-proof.json'),JSON.stringify({serverLogPath,debugReceipts,keyE:true,sceneApply:true,projectId},null,2))
  await debugDrawer.getByRole('button',{name:'Đóng bảng',exact:true}).click()
  assert.deepEqual(errors,[])
  console.log('PASS Debug recorder captures E + scene.apply; downloaded camera-debug.txt; server log',serverLogPath)
  console.log('PASS 30s pilot + timeline preserves camera and shot; lens idle revision stable')

} finally {await browser.close()}
