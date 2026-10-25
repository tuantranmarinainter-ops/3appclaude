import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { makeEmptyDraft } from '@topview/3d-builder'
const base = process.env.STUDIO_URL
const output = process.env.SMOKE_OUTPUT
const mode = process.env.A10_BASELINE === '1' ? 'before' : 'after'
if (!base || !/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(base) || !output || process.env.SMOKE_ISOLATED_STORAGE !== '1') throw new Error('Use loopback STUDIO_URL, SMOKE_OUTPUT and SMOKE_ISOLATED_STORAGE=1 with disposable server storage.')
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
let diagnosticPage
try {
 const context = await browser.newContext({ viewport: { width:1600, height:1000 }, locale:'vi-VN' })
 await context.request.post(`${base}/api/unified/session`, { headers: { Origin:base } })
 const scene = makeEmptyDraft('A10 disposable toolbar fixture', 30, 90, { fov:50, position:{x:3,y:2,z:4}, rotation:{x:0,y:0,z:0}, lookAt:{x:0,y:.5,z:0} })
 const response = await context.request.post(`${base}/api/unified/commands`, { headers:{Origin:base}, data:{requestId:randomUUID(),command:'project.create',args:{name:'A10 disposable toolbar fixture',scene}} })
 const created = await response.json(); assert.equal(created.ok,true,JSON.stringify(created))
 const page = await context.newPage(); diagnosticPage=page; page.setDefaultTimeout(60000)
 await page.goto(`${base}/?unified=${created.projectId}`,{waitUntil:'domcontentloaded'}); console.log('host loaded')
 await page.waitForFunction(() => window.__stage?.ready); console.log('stage ready')
 await page.evaluate(() => window.dispatchEvent(new CustomEvent('bbs-workspace-request',{detail:{workspace:'animation'}})))
 const iframe = page.locator('.wb-animation-creation-frame'); await iframe.waitFor(); console.log('iframe attached')
 const frame = page.frameLocator('.wb-animation-creation-frame')
 await frame.locator('#minimalSidebar').waitFor(); console.log('sidebar ready')
 if(mode==='after') await frame.locator('#bbsHostControls').waitFor()
 await page.waitForTimeout(1500)
 const metrics = { mode, iframe:await iframe.boundingBox(), viewport:await frame.locator('#editViewport').boundingBox(), controls:await (mode==='after' ? frame.locator('#bbsHostControls') : page.locator('.wb-animation-creation-toolbar').first()).boundingBox() }
 if(mode==='after') {
  const baseline=await readFile(`${output}/before.json`,'utf8').then(JSON.parse).catch(()=>null)
  if(baseline) { metrics.viewportHeightGain=metrics.viewport.height-baseline.viewport.height; assert.ok(metrics.viewportHeightGain>=baseline.viewport.height*.2 && metrics.iframe.height-baseline.iframe.height>=150,JSON.stringify(metrics)) }
  assert.equal(await page.locator('.wb-animation-creation-toolbar').count(),0)
  const toolbars=frame.locator('#bbsHostControls .wb-animation-creation-toolbar')
  const first=await toolbars.first().boundingBox(),second=await toolbars.nth(1).boundingBox()
  assert.ok(first.y+first.height<=second.y+1,'Toolbar groups must not overlap')
  const dock=frame.locator('#bbsHostControls')
  for(const text of ['Nhân vật','Animation đã lưu','Camera','Từ frame','Đến frame','Kèm .bobj']) await dock.getByLabel(new RegExp('^'+text)).waitFor()
  for(const text of ['Tạo animation','Lưu vào project','Mở shot từ cảnh','Trả kết quả về cảnh']) assert.equal(await dock.getByRole('button',{name:text,exact:true}).count(),1)
  assert.equal(await dock.locator('.cross-app-button').evaluateAll(nodes=>nodes.every(node=>getComputedStyle(node).borderTopColor==='rgb(255, 140, 26)')),true)
  await dock.locator('summary').click(); assert.equal(await dock.getByRole('button',{name:'Tạo animation',exact:true}).isVisible(),false)
  await dock.locator('summary').click()
  await dock.getByText('Kèm .bobj',{exact:true}).click(); assert.equal(await dock.locator('input[type=checkbox]').isChecked(),true)
  await dock.getByLabel('Từ frame',{exact:true}).fill('10')
  await dock.getByLabel('Đến frame',{exact:true}).fill('80')
  await Promise.all([page.waitForEvent('framenavigated',{predicate:child=>child.parentFrame()===page.mainFrame() && child.url().includes('/animation-studio/')}),iframe.evaluate(node=>node.contentWindow.location.reload())])
  await frame.locator('#bbsHostControls').waitFor(); assert.equal(await frame.locator('#bbsHostControls').count(),1)
  assert.equal(await frame.locator('#bbsHostControls').getByLabel('Từ frame',{exact:true}).inputValue(),'10')
  assert.equal(await frame.locator('#bbsHostControls input[type=checkbox]').isChecked(),true)
  await frame.locator('#editViewport canvas').first().waitFor()
  await page.setViewportSize({width:1280,height:768})
  await frame.getByRole('button',{name:'Trả kết quả về cảnh',exact:true}).scrollIntoViewIfNeeded()
  await frame.getByRole('tab',{name:'Thuộc tính',exact:true}).scrollIntoViewIfNeeded()
  assert.ok((await frame.getByRole('tab',{name:'Thuộc tính',exact:true}).boundingBox()).height>0)
  await page.screenshot({path:`${output}/after-1280.png`,fullPage:true})
  await page.setViewportSize({width:1600,height:1000})
  await frame.locator('#bbsHostControls summary').scrollIntoViewIfNeeded()
 }
 await page.screenshot({path:`${output}/${mode}.png`,fullPage:true})
 await writeFile(`${output}/${mode}.json`,JSON.stringify(metrics,null,2))
 console.log(JSON.stringify(metrics))
} catch(error) { await diagnosticPage?.screenshot({path:`${output}/${mode}-failure.png`,fullPage:true}).catch(()=>{}); throw error } finally { await browser.close() }
