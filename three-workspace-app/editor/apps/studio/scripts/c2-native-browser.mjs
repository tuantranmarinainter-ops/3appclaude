import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { makeEmptyDraft } from '@topview/3d-builder'

const editor = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const output = path.resolve(process.env.C2_EVIDENCE_DIR || path.join(editor, 'work/qa/c2-native-browser'))
const base = process.env.STUDIO_URL
assert.ok(base && ['localhost', '127.0.0.1', '[::1]'].includes(new URL(base).hostname) && ['http:', 'https:'].includes(new URL(base).protocol), 'Set loopback STUDIO_URL')
assert.equal(process.env.SMOKE_ISOLATED_STORAGE, '1', 'Server must use copied library and isolated projects')
await mkdir(output, { recursive: true })
const report = { passed: false, startedAt: new Date().toISOString(), base, actors: [], errors: [] }
const persist = () => writeFile(path.join(output, 'production-host-save.json'), JSON.stringify(report, null, 2))
async function bounded(promise, label, milliseconds = 10_000) {
  let timer
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} timed out after ${milliseconds}ms`)), milliseconds) })]) }
  finally { clearTimeout(timer) }
}
const browser = await chromium.launch({ headless: true })
try {
  for (const [name, charId, count] of [
    ['Hero', 'aab3befd-227d-4dd7-8986-f8caf194f232', 20],
    ['Den', '5747a1ad-06fd-4021-b304-788f85554ba3', 20],
    ['GoXua', '3bc37c74-0209-4413-90f4-c69302a43625', 84],
  ]) {
    const actor = { name, charId, expectedJoints: count, steps: [], errors: [], hostErrors: [] }
    report.actors.push(actor)
    const context = await browser.newContext({ viewport: { width: 1800, height: 1100 }, locale: 'en-US' })
    const page = await context.newPage()
    page.setDefaultTimeout(30_000)
    page.on('pageerror', error => (/Minified React error #418/.test(error.message) ? actor.hostErrors : actor.errors).push(error.message))
    page.on('console', msg => { if (msg.type() === 'error') actor.errors.push(msg.text()) })
    page.on('dialog', dialog => dialog.dismiss())
    try {
      await page.goto(base)
      const api = context.request
      assert.ok((await api.post(`${base}/api/unified/session`, { headers: { Origin: base } })).ok())
      const createResponse = await api.post(`${base}/api/unified/commands`, { headers: { Origin: base }, data: {
        requestId: randomUUID(), command: 'project.create', args: { name: `C2 native browser ${name}`, scene: makeEmptyDraft(name, 30, 9000, { fov: 50, position: { x: 0, y: 2, z: 5 }, rotation: { x: 0, y: 0, z: 0 }, lookAt: { x: 0, y: 1, z: 0 } }) },
      } })
      const created = await createResponse.json()
      assert.equal(created.ok, true, JSON.stringify(created))
      actor.projectId = created.projectId
      const post = async (url, data) => {
        const response = await api.post(`${base}${url}`, { headers: { Origin: base }, data })
        const body = await response.json()
        assert.ok(response.ok(), JSON.stringify(body))
        return body
      }
      const project = async () => (await (await api.get(`${base}/api/unified/projects/${actor.projectId}`)).json()).project
      const added = await post('/api/library', { operation: 'add-to-scene', projectId: actor.projectId, expectedRevision: (await project()).revision, charId })
      actor.characterId = added.characterId
      const actions = await (await api.get(`${base}/api/library?charId=${charId}&status=draft`)).json()
      const action = actions.actions.find(a => a.ownerCharId === charId && a.version === 1)
      assert.ok(action, `${name}: owned draft v1 missing`)
      actor.actionUuid = action.uuid
      const placed = await post('/api/unified/commands', { requestId: randomUUID(), projectId: actor.projectId, expectedRevision: (await project()).revision, command: 'library.place', args: { actionUuid: action.uuid, characterId: actor.characterId } })
      assert.equal(placed.ok, true, JSON.stringify(placed))
      const p = await project()
      const character = p.characters[actor.characterId]
      const clip = p.scene.content.timeline.animation.motionClips.find(c => c.target.nodeId === character.nodeId)
      assert.ok(clip)
      actor.range = [clip.frameStart, clip.frameEnd]
      assert.ok(clip.frameEnd <= p.scene.content.timeline.frameEnd, 'Full clip must fit the QA project')
      const metadata = p.scene.content.nodes.find(n => n.id === character.nodeId).metadata
      actor.library = metadata
      assert.equal(metadata.libraryCharacterId, charId)
      const modelUrl = `${base}/api/library?modelCharacter=${charId}&fingerprint=${encodeURIComponent(metadata.libraryModelFingerprint)}`
      await page.goto(`${base}/?unified=${actor.projectId}`)
      const animationTab = page.getByRole('navigation', { name: '5 workspace', exact: true }).getByRole('button', { name: 'Animation', exact: true })
      await animationTab.click()
      await page.locator('.wb-animation-creation-frame').waitFor()
      const frame = await (await page.locator('.wb-animation-creation-frame').elementHandle()).contentFrame()
      assert.ok(frame)
      await frame.waitForFunction(() => window.__studio?.ready === true && !!window.__app3LocalBridge, null, { polling: 100 })
      actor.bridge = await frame.evaluate(() => ({ bridge: !!window.__app3LocalBridge, scripts: [...document.scripts].filter(s => s.src).map(s => s.src) }))
      await persist()
      await page.getByLabel('Từ frame', { exact: true }).fill(String(clip.frameStart))
      await page.getByLabel('Đến frame', { exact: true }).fill(String(actor.range[1]))
      await page.getByRole('button', { name: 'Mở shot từ cảnh', exact: true }).click()
      await page.waitForFunction(() => !!document.querySelector('iframe.wb-animation-creation-frame')?.contentWindow?.__studio?.shot?.session || !!document.querySelector('.wb-animation-creation-error')?.textContent, null, { polling: 100 })
      assert.deepEqual(await page.locator('.wb-animation-creation-error').allTextContents(), [])
      actor.shotId = await frame.evaluate(() => window.__studio.shot.session.shot.shotId)
      // Compare geometry and decoded texture pixels to the server's own library model.
      actor.expected = await frame.evaluate(async url => {
        const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js')
        const gltf = await new GLTFLoader().loadAsync(url)
        window.__c2Expected = gltf.scene
        return { loaded: true }
      }, modelUrl)
      const inspect = () => frame.evaluate(async () => {
        const hash = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(n => n.toString(16).padStart(2, '0')).join('')
        const describe = async meshes => {
          const geometry = [], textures = [], joints = new Set()
          for (const mesh of meshes) {
            const positions = mesh.geometry?.attributes.position
            if (positions) geometry.push(await hash(new Float32Array(Array.from({ length: positions.count * 3 }, (_, i) => [positions.getX, positions.getY, positions.getZ][i % 3].call(positions, Math.floor(i / 3)))).buffer))
            for (const bone of mesh.skeleton?.bones ?? []) joints.add(bone.name)
            for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
              const image = material?.map?.image
              if (!image) continue
              const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height
              const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0)
              textures.push({ width: image.width, height: image.height, sha256: await hash(ctx.getImageData(0, 0, image.width, image.height).data.buffer) })
            }
          }
          return { meshes: meshes.length, geometry: geometry.sort(), joints: [...joints].sort(), textures: textures.sort((a, b) => a.sha256.localeCompare(b.sha256)) }
        }
        const expectedMeshes = []; window.__c2Expected.traverse(n => { if (n.isMesh) expectedMeshes.push(n) })
        return { actual: await describe(window.__studio.rig().mesh), expected: await describe(expectedMeshes), stateErrors: window.__studio.state.errors, records: window.__studio.recordNames(), fingerprint: window.__studio.rig().fingerprint }
      })
      let before
      for (const [step, id] of [['Blocking', 'workflowBlocking'], ['Refine', 'workflowRefine'], ['Export', 'workflowExport']]) {
        await frame.locator(`#${id}`).click()
        await frame.waitForFunction(id => document.getElementById(id).getAttribute('aria-current') === 'step', id, { polling: 100 })
        const numerical = await inspect()
        actor.steps.push({ step, ...numerical })
        await page.screenshot({ path: path.join(output, `host-${name}-${step}.png`), fullPage: true })
        await persist()
        assert.equal(numerical.actual.joints.length, count, `${name} ${step} joint count`)
        assert.deepEqual(numerical.actual, numerical.expected, `${name} ${step}: library model/skin mismatch`)
        assert.ok(numerical.actual.textures.length > 0, `${name} textures missing`)
        assert.deepEqual(numerical.stateErrors, [])
        if (before) assert.deepEqual(numerical.actual, before, `${name} step changed native model`)
        before = numerical.actual
      }
      await frame.locator('#workflowRefine').click()
      actor.edit = await frame.evaluate(() => {
        const s = window.__studio
        const bone = s.recordNames().find(b => /spine|body|chest/i.test(b.name)) ?? s.recordNames().find(b => b.id !== 'root')
        s.selectUser(bone.id, false); s.seek(0)
        const input = document.getElementById('rx'); const before = s.pose()[bone.id]
        input.value = String((Number(input.value) || 0) + 12); input.dispatchEvent(new Event('change', { bubbles: true }))
        document.getElementById('keyBtn').click()
        return { bone, before, after: s.pose()[bone.id], keys: Object.values(s.project().keys).reduce((n, keys) => n + keys.length, 0), draft: s.state.draft }
      })
      assert.notDeepEqual(actor.edit.after, actor.edit.before, `${name}: pose did not change`)
      assert.ok(actor.edit.keys > 0)
      const save = async () => {
        const draftPost = page.waitForResponse(r => /\/shots\/[^/]+\/draft$/.test(new URL(r.url()).pathname) && r.request().method() === 'POST', { timeout: 30_000 }).catch(() => null)
        await page.getByRole('button', { name: 'Lưu vào project', exact: true }).click()
        const saved = await Promise.race([draftPost, page.waitForFunction(() => !!document.querySelector('.wb-animation-creation-error')?.textContent, null, { polling: 100 }).then(() => null).catch(() => null)])
        actor.saveResponse = { status: saved?.status() ?? null, receivedAt: new Date().toISOString(), bodyReadComplete: false }
        await persist()
        const body = saved ? await bounded(saved.text(), `${name} draft POST response body`) : null
        actor.saveResponse.bodyReadComplete = true
        return { status: saved?.status() ?? null, body, alert: await page.locator('.wb-animation-creation-error').allTextContents(), statusText: await page.locator('.wb-animation-creation-status').allTextContents() }
      }
      actor.refineSave = await save()
      await page.screenshot({ path: path.join(output, `host-${name}-Refine-save.png`), fullPage: true })
      await persist()
      actor.save = actor.refineSave
      await page.screenshot({ path: path.join(output, `host-${name}-hostSave.png`), fullPage: true })
      await persist()
      assert.equal(actor.save.status, 200, `${name}: actual host Save failed ${JSON.stringify(actor.save)}`)
      const reopened = await api.get(`${base}/api/unified/projects/${actor.projectId}/shots/${actor.shotId}/draft`, { timeout: 10_000 })
      actor.save.getStatus = reopened.status(); actor.save.bytes = (await bounded(reopened.body(), `${name} draft GET body`)).length
      assert.equal(reopened.status(), 200); assert.ok(actor.save.bytes > 0)
      assert.deepEqual(actor.errors, [])
      actor.passed = true
    } catch (error) {
      actor.failure = error.stack
      actor.finalHostStatus = await page.locator('.wb-animation-creation-status').allTextContents().catch(() => [])
      actor.finalHostAlerts = await page.locator('.wb-animation-creation-error').allTextContents().catch(() => [])
      actor.frameDiagnostics = await Promise.all(page.frames().map(async f => ({ url: f.url(), state: await f.evaluate(() => ({ ready: window.__studio?.ready, studioKeys: Object.keys(window.__studio ?? {}), state: window.__studio?.state, bridge: !!window.__app3LocalBridge, status: document.getElementById('status')?.textContent })).catch(e => ({ error: e.message })) })))
      await page.screenshot({ path: path.join(output, `host-${name}-failure.png`), fullPage: true }).catch(() => {})
      console.error(`${name}: ${error.message}`)
    } finally { await persist(); await context.close() }
  }
  report.passed = report.actors.length === 3 && report.actors.every(actor => actor.passed)
} catch (error) { report.errors.push(error.stack) }
finally { await persist(); await browser.close() }
console.log(JSON.stringify({ passed: report.passed, actors: report.actors.map(a => ({ name: a.name, passed: a.passed, failure: a.failure, save: a.save })), output }))
process.exitCode = report.passed ? 0 : 1
