// Uses a real OPFS directory handle; the operating-system folder picker still needs manual acceptance.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'
import { makeEmptyDraft } from '@topview/3d-builder'

const base = process.env.STUDIO_URL
const output = process.env.SMOKE_OUTPUT
if (!base || !/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(base) || !output) throw new Error('Set loopback STUDIO_URL and SMOKE_OUTPUT; use isolated test storage.')
await mkdir(output, { recursive: true })
const browser = await chromium.launch()
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
  const created = await context.request.post(`${base}/api/unified/commands`, { headers: { Origin: base }, data: {
    requestId: randomUUID(), command: 'project.create', args: { name: 'Render browser smoke', scene },
  } })
  const creation = await created.json()
  assert.equal(creation.ok, true, JSON.stringify(creation)); projectId = creation.projectId
  const page = await context.newPage()
  page.setDefaultTimeout(45_000)
  page.on('pageerror', (error) => errors.push(error.message))
  await page.addInitScript(() => { window.showDirectoryPicker = () => navigator.storage.getDirectory() })
  await page.goto(`${base}/?unified=${projectId}`)
  await page.waitForFunction(() => window.__stage?.ready && window.__store?.getState().ready)
  const panel = page.getByRole('region', { name: 'Render cảnh' })
  await panel.getByLabel('Frame cần render').fill('0,45,89')
  await panel.getByLabel('Camera cần render').selectOption(['camera_1', 'camera_2'])
  const [started] = await Promise.all([
    page.waitForResponse((res) => res.url().endsWith('/api/unified/commands') && res.request().postDataJSON()?.command === 'scene.render'),
    panel.getByRole('button', { name: 'Render PNG', exact: true }).click(),
  ])
  const startedBody = await started.json()
  assert.equal(startedBody.ok, true, JSON.stringify(startedBody))
  const jobId = startedBody.result.jobId
  await Promise.race([
    panel.getByRole('status').filter({ hasText: 'Đã lưu 9 file' }).waitFor({ timeout: 60_000 }),
    panel.getByRole('alert').waitFor({ timeout: 60_000 }).then(async () => { throw new Error(await panel.getByRole('alert').textContent()) }),
  ])
  const saved = await page.evaluate(async (id) => {
    const root = await navigator.storage.getDirectory()
    const dir = await root.getDirectoryHandle(`render-${id}`)
    const files = []
    for await (const [name, handle] of dir.entries()) {
      const file = await handle.getFile()
      const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer())), (byte) => byte.toString(16).padStart(2, '0')).join('')
      files.push({ name, sizeBytes: file.size, sha256: hash })
    }
    const manifest = JSON.parse(await (await (await dir.getFileHandle('render.json')).getFile()).text())
    return { files, manifest }
  }, jobId)
  assert.equal(saved.files.length, 9)
  assert.deepEqual(saved.manifest.frames, [0, 45, 89])
  assert.equal(saved.manifest.cameras.length, 2)
  for (const file of saved.manifest.files) assert.deepEqual(saved.files.find((item) => item.name === file.name), { name: file.name, sizeBytes: file.sizeBytes, sha256: file.sha256 })
  const state = await (await context.request.get(`${base}/api/unified/projects/${projectId}`)).json()
  assert.equal(state.project.revision, 0); assert.equal(state.history.canUndo, false)
  await panel.getByRole('button', { name: 'Lưu lại file…' }).click()
  await panel.getByRole('alert').filter({ hasText: 'Thư mục render đã tồn tại' }).waitFor()
  await page.screenshot({ path: path.join(output, 'render-panel.png') })
  assert.deepEqual(errors, []); assert.deepEqual(external, [])
  const report = { passed: true, projectId, jobId, browserVersion: browser.version(), files: saved.files,
    cameras: saved.manifest.cameras, frames: saved.manifest.frames, sourceRevision: saved.manifest.sourceRevision,
    sourceSha256: saved.manifest.sourceSha256, errors, external, directory: 'real OPFS; OS picker substituted, not verified',
    checks: ['two cameras × three frames', 'nine SHA-verified output files', 'shared revision/history unchanged', 'save-again error handled without overwriting'] }
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify(report))
} catch (error) {
  await writeFile(path.join(output, 'report.json'), JSON.stringify({ passed: false, projectId, errors, external, error: String(error) }, null, 2) + '\n')
  throw error
} finally { await browser.close() }
