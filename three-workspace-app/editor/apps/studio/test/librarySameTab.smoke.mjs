import { chromium } from 'playwright'
import assert from 'node:assert/strict'
// Supply a disposable empty project and a server with at least one library character.
const seed = { projectId: process.env.LIBRARY_SMOKE_PROJECT_ID }
if (!seed.projectId) throw new Error('LIBRARY_SMOKE_PROJECT_ID must name a disposable empty project')
const base = process.env.STUDIO_URL ?? 'http://127.0.0.1:32084'
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/usr/bin/chromium', args: ['--no-sandbox'] })
try {
 const page = await browser.newPage()
 await page.goto(`${base}/library?unified=${seed.projectId}`)
 assert.equal(await page.evaluate(() => !!window.opener), false)
 await page.getByRole('button', { name: 'Nhân vật', exact: true }).click()
 await page.getByRole('button', { name: 'Thêm vào cảnh App 2' }).first().waitFor()
 const before = await page.evaluate(async id => (await (await fetch(`/api/unified/projects/${id}`)).json()).project, seed.projectId)
 assert.equal(Object.keys(before.characters).length, 0, 'smoke requires an empty scene')
 await page.getByRole('button', { name: 'Thêm vào cảnh App 2' }).first().click()
 await page.getByRole('status').filter({ hasText: 'Đã thêm nhân vật' }).waitFor()
 const project = await page.evaluate(async id => (await (await fetch(`/api/unified/projects/${id}`)).json()).project, seed.projectId)
 assert.equal(Object.keys(project.characters).length, 1)
 const url = project.scene.content.nodes.find(node => node.metadata?.libraryCharacterId)?.metadata.modelUrl
 assert.match(url, /^\/api\/library\?modelCharacter=/)
 assert.equal((await page.request.get(`${base}${url}`)).status(), 200)
 assert.equal(await page.getByRole('link', { name: 'Quay lại cảnh App 2' }).getAttribute('href'), `/?unified=${seed.projectId}`)
 console.log('PASS same-tab empty scene -> first character; real API persists node/model; return link')
 let copied
 await page.route('**/api/library**', async route => {
   const request = route.request(), url = new URL(request.url())
   if (request.method() === 'POST') { copied = request.postDataJSON(); return route.fulfill({ json: {} }) }
   if (url.searchParams.has('characters')) return route.fulfill({ json: { characters: [{charId:'owner', name:'Owner', rig:'mixamo65', baseModelId:'a'.repeat(16)}, {charId:'target', name:'Target', rig:'mixamo65', baseModelId:'a'.repeat(16)}] } })
   if (url.searchParams.has('charId')) return route.fulfill({ json: {actions:[{uuid:'10000000-0000-7000-8000-000000000001',name:'Owned idle', rig:'mixamo65',ownerCharId:'owner',status:'draft',durationSeconds:1,fps:30,tags:[],category:'idle',glbAnimationIndex:0}] } })
   return route.fulfill({ json: {} })
 })
 await page.goto(`${base}/library?charId=owner`)
 await page.getByRole('button', {name:'Sao chép sang…'}).click()
 await page.getByRole('status').filter({ hasText: 'Đã sao chép' }).waitFor()
 assert.equal(copied.toCharId, 'target')
 console.log('PASS Copy defaults to compatible target, never hidden owner')
} finally { await browser.close() }
