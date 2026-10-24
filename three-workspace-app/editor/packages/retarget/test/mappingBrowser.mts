import { chromium } from '../../../apps/studio/node_modules/playwright/index.mjs'
import assert from 'node:assert/strict'
import { writeFile, mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
// Run from packages/builder: node --import tsx ../retarget/test/mappingBrowser.mts <zyra.glb> [evidence-directory]
const sample = process.argv[2]
assert.ok(sample, 'Provide the Zyra GLB fixture path (86 source bones); asset binaries are not committed')
const out = path.resolve(process.argv[3] ?? 'outputs/C13-browser')
await mkdir(out, { recursive: true })
const library = await mkdtemp(path.join(tmpdir(), 'c13-library-'))
process.env.W01_LIBRARY = library
const { startWorkbench } = await import('../workbench/server.ts')
const bench = await startWorkbench({ port: 0 })
const errors=[]
let browser, page
try {
browser = await chromium.launch({headless:true})
page = await browser.newPage({viewport:{width:1600,height:1000}})
page.on('pageerror', e=>errors.push(e.message))
await page.route('**/app.js',async route=>{
 const response=await route.fetch()
 await route.fulfill({response,body:await response.text()+'\nwindow.c13 = { state, viewer, assignMappingSource, syncMappingHighlights, get active() {return activeMappingTarget}, get hovered() {return hoveredMappingTarget} };'})
})
const results=[]
const snapshot = ()=>page.evaluate(()=>({ rows:structuredClone(c13.state.rows), dirty:c13.state.dirty, stale:c13.state.stale, active:c13.active, preset:c13.state.preset, family:c13.state.presetFamily }))
const unique = s=> { const names=s.rows.map(r=>r.source).filter(Boolean);assert.equal(new Set(names).size,names.length) }
const input=t=>page.locator(`#mapRows input[data-target="${t}"]`)
const typed=async(t,s)=>{await input(t).fill(s);await input(t).press('Tab')}
 await page.goto(bench.url)
 await page.locator('#pathInput').fill(path.resolve(sample))
 await page.locator('#pathBtn').click()
 await page.waitForFunction(()=>window.c13?.state.inspect && !c13.state.inspecting, {timeout:60000})
 await page.locator('#actionPickerBtn').click()
 await page.getByRole('button',{name:'Sửa mapping',exact:true}).first().click()
 const initial=await snapshot()
 const bones=await page.evaluate(()=>c13.state.inspect.sourceBones.length)
 assert.equal(bones,86)

 await page.screenshot({path:path.join(out,'loaded.png'),fullPage:true});
 await typed('LeftLeg','L_Foot')
 await input('LeftFoot').focus()
 const before=await snapshot();unique(before)
 await typed('LeftFoot','L_Foot')
 const moved=await snapshot();unique(moved)
 assert.equal(moved.rows.find(r=>r.target==='LeftLeg').source,null)
 assert.equal(moved.rows.find(r=>r.target==='LeftLeg').needsChoice,true)
 assert.equal(await page.locator('#mapRows tr[data-target="LeftLeg"]').getAttribute('class').then(s=>s.includes('needs-choice')),true)
 await page.screenshot({path:path.join(out,'typed-move.png'),fullPage:true})
 await page.getByRole('button',{name:'Hoàn tác',exact:true}).click()
 const undone=await snapshot();unique(undone);assert.deepEqual(undone,before)
 assert.equal(await page.getByRole('button',{name:'Hoàn tác',exact:true}).isDisabled(),true)
 results.push({case:'Zyra84 typed L_Foot LeftLeg → LeftFoot, Undo exact',status:'PASS',before,moved,undone})
 // Same assignment does not consume the last useful Undo.
 await typed('LeftFoot','L_Foot');const sameBefore=await snapshot()
 assert.equal(await page.evaluate(()=>c13.assignMappingSource('LeftFoot','L_Foot')),true)
 assert.deepEqual(await snapshot(),sameBefore)
 await page.getByRole('button',{name:'Hoàn tác',exact:true}).click()
 unique(await snapshot())
 // Chooser, selecting a used source closes popup and focuses the replacement input.
 await page.getByRole('button',{name:'Xương nguồn cho LeftFoot: mở danh sách',exact:true}).click()
 await page.getByRole('option',{name:'L_Foot',exact:true}).click()
 unique(await snapshot())
 assert.equal(await input('LeftFoot').evaluate(e=>e===document.activeElement),true)
 assert.equal(await page.locator('.bone-options').count(),0)
 assert.equal(await page.locator('#mapRows tr[data-target="LeftLeg"]').getAttribute('class').then(s=>s.includes('needs-choice')),true)
 await page.screenshot({path:path.join(out,'chooser-move.png'),fullPage:true})
 results.push({case:'chooser collision, popup teardown, focus',status:'PASS'})
 // C10 source point callback uses the same boundary, while old row is filtered out.
 await input('LeftLeg').focus()
 await page.getByRole('searchbox',{name:'Lọc mapping',exact:true}).fill('LeftLeg')
 assert.equal(await input('LeftFoot').count(),0)
 await page.evaluate(()=>c13.viewer.left.joints.onPick('L_Foot'))
 const point=await snapshot();unique(point)
 assert.equal(point.rows.find(r=>r.target==='LeftFoot').source,null)
 assert.equal(point.rows.find(r=>r.target==='LeftFoot').needsChoice,true)
 const highlights=await page.evaluate(()=>({left:[...c13.viewer.left.joints.selected],right:[...c13.viewer.right.joints.selected],mapped:[...c13.viewer.right.joints.mapped]}))
 assert.deepEqual(highlights.left,['L_Foot']);assert.deepEqual(highlights.right,['LeftLeg']);assert.equal(highlights.mapped.includes('LeftFoot'),false)
 await page.getByRole('searchbox',{name:'Lọc mapping',exact:true}).fill('')
 await page.screenshot({path:path.join(out,'point-hidden-row.png'),fullPage:true})
 results.push({case:'C10 source point, hidden old row, synced highlights',status:'PASS',point,highlights})
 const invalidBefore=await snapshot()
 assert.equal(await page.evaluate(()=>c13.assignMappingSource('LeftFoot','not-a-source')),false)
 assert.deepEqual(await snapshot(),invalidBefore)
 await typed('LeftFoot','not-a-source')
 assert.deepEqual(await snapshot(),{...invalidBefore,active:'LeftFoot'})
 assert.equal(await input('LeftFoot').inputValue(),'')
 results.push({case:'invalid boundary and typed source ignored',status:'PASS'})
 // Imported duplicates and optional joints are defended on the next valid user action.
 await page.evaluate(()=>{for(const t of ['LeftLeg','LeftFoot','LeftToeBase'])c13.state.rows.find(r=>r.target===t).source='L_Foot';c13.assignMappingSource('LeftFoot','L_Foot')})
 const repaired=await snapshot();unique(repaired)
 assert.equal(repaired.rows.find(r=>r.target==='LeftToeBase').needsChoice,true)
 await page.getByRole('button',{name:'Hoàn tác',exact:true}).click()
 unique(await snapshot())
 results.push({case:'all preexisting duplicate matches, optional rows, unique Undo',status:'PASS'})
 assert.deepEqual(errors,[])
 await writeFile(path.join(out,'browser.json'),JSON.stringify({url:page.url(),bones,initial,results,errors},null,2))
 console.log(JSON.stringify({status:'PASS',bones,cases:results.map(r=>r.case),errors}))
} catch (error) { console.log('errors',errors,await page?.locator('#tab-mapping').innerText().catch(() => '')); throw error } finally { await browser?.close(); await bench.close(); await rm(library, { recursive: true, force: true }) }
