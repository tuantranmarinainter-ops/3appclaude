/** Disposable production-server browser acceptance; run after Studio build. */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { chromium } from 'playwright'
import { makeEmptyDraft } from '@topview/3d-builder'
import { rebuildLibraryIndex } from '../../../packages/library/index'
import { bobjModelToGlb, parseBobjModel } from '../../../packages/retarget/src/bobjModel'
import { addLibraryCharacterToProject } from '../src/libraryCommands'
import { executeUnifiedCommand, readUnifiedProject } from '../src/unifiedProjectStore'
import { fixture, sha } from './b34Fixtures'

async function main() {
  const temp = mkdtempSync(path.join(tmpdir(), 'b34-browser-'))
  const previousLibrary = process.env.W01_LIBRARY, previousProjects = process.env.BBS_UNIFIED_PROJECTS_DIR
  process.env.W01_LIBRARY = path.join(temp, 'library')
  process.env.BBS_UNIFIED_PROJECTS_DIR = path.join(temp, 'projects')
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
  let server: ReturnType<typeof spawn> | undefined
  try {
    const data = fixture(process.env.W01_LIBRARY, temp)
    const bytes = bobjModelToGlb(parseBobjModel(data.bobj)).bytes
    const extraPack = path.join(process.env.W01_LIBRARY, 'packs', '3400000000000003')
    mkdirSync(extraPack)
    writeFileSync(path.join(extraPack, 'anim.glb'), bytes)
    const actions = [
      { uuid: randomUUID(), name: 'Own idle', ownerCharId: data.den.charId },
      { uuid: randomUUID(), name: 'Hero idle', ownerCharId: data.hero.charId },
      { uuid: randomUUID(), name: 'Shared idle' },
    ].map(action => ({ ...action, durationSeconds: 1, fps: 30, category: 'idle', tags: [], loop: false, inPlace: true, glbAnimationIndex: 0, status: 'draft', version: 1 }))
    writeFileSync(path.join(extraPack, 'meta.json'), JSON.stringify({ kind: 'motion-pack', libraryVersion: '1.1.0', packId: '3400000000000003', rig: 'minecraft20', glbSha256: sha(bytes), createdAt: '2026-10-26T00:00:00Z', license: { id: 'test', commitable: false }, actions }))
    writeFileSync(path.join(extraPack, 'anim.manifest.json'), JSON.stringify({ version: '1.0.0', rig: 'minecraft20', glbSha256: sha(bytes), actions }))
    rebuildLibraryIndex()
    const created = await executeUnifiedCommand({ requestId: randomUUID(), command: 'project.create', args: { name: 'B34 browser', scene: makeEmptyDraft('B34 browser', 30, 180) } })
    const added = await addLibraryCharacterToProject({ projectId: created.projectId, expectedRevision: created.revision, charId: data.den.charId })
    const packCount = () => readdirSync(path.join(process.env.W01_LIBRARY!, 'packs')).length
    const before = packCount()
    const port = Number(process.env.B34_SMOKE_PORT ?? 32134), base = `http://127.0.0.1:${port}`
    let serverLog = ''
    server = spawn(process.execPath, [path.resolve('apps/studio/node_modules/next/dist/bin/next'), 'start', '--hostname', '127.0.0.1', '--port', String(port)], { cwd: path.resolve('apps/studio'), env: process.env, stdio: ['ignore', 'pipe', 'pipe'] })
    server.stdout!.on('data', chunk => { serverLog += chunk })
    server.stderr!.on('data', chunk => { serverLog += chunk })
    const deadline = Date.now() + 30000
    while (true) {
      try { if ((await fetch(`${base}/api/library?characters=1`)).ok) break } catch { /* starting */ }
      if (Date.now() > deadline || server.exitCode !== null) throw new Error(`Studio did not start: ${serverLog}`)
      await new Promise(resolve => setTimeout(resolve, 200))
    }
    browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? (process.platform === 'win32' ? undefined : '/usr/bin/chromium'), args: ['--no-sandbox'] })
    const page = await browser.newPage()
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(`${base}/library?unified=${created.projectId}&assignTo=${added.nodeId}`)
    for (const label of ['Của nhân vật này (1)', 'Mixamo65 (tự chuyển) (1)', 'Minecraft20 cùng rig (2)']) await page.getByRole('heading', { name: label, exact: true }).waitFor()
    const cards = page.getByRole('region', { name: 'Danh sách động tác' }).locator('article')
    assert.equal(await cards.count(), 4)
    for (const card of await cards.all()) assert.equal(await card.getByRole('button', { name: /^Gán cho / }).count(), 1)
    const source = cards.filter({ hasText: 'Synthetic wave' })
    await source.getByRole('button', { name: /^Gán cho / }).click()
    await page.getByRole('status').filter({ hasText: 'Đã gán “Synthetic wave”' }).waitFor()
    assert.equal(packCount(), before)
    let project = await readUnifiedProject(created.projectId)
    assert.equal(project.scene.content.timeline.animation.motionClips.length, 1)
    const recipes = project.extensions.libraryMotionConversions!
    assert.equal(Object.keys(recipes).length, 1)
    const repeatResponse = page.waitForResponse(response => response.url() === `${base}/api/library` && response.request().method() === 'POST')
    await source.getByRole('button', { name: /^Gán cho / }).click()
    assert.equal((await repeatResponse).status(), 200)
    project = await readUnifiedProject(created.projectId)
    assert.equal(project.scene.content.timeline.animation.motionClips.length, 2)
    assert.deepEqual(project.extensions.libraryMotionConversions, recipes)
    assert.equal(packCount(), before)
    const bytesBefore = readFileSync(path.join(data.pack, 'anim.glb'))
    writeFileSync(path.join(data.pack, 'anim.glb'), Buffer.concat([bytesBefore, Buffer.from('changed')]))
    await source.getByRole('button', { name: /^Gán cho / }).click()
    await page.getByRole('button', { name: 'Chuyển lại và gán', exact: true }).waitFor()
    assert.equal((await readUnifiedProject(created.projectId)).scene.content.timeline.animation.motionClips.length, 2)
    await page.getByRole('button', { name: 'Chuyển lại và gán', exact: true }).click()
    await page.getByRole('button', { name: 'Chuyển lại và gán', exact: true }).waitFor({ state: 'hidden' })
    project = await readUnifiedProject(created.projectId)
    assert.equal(project.scene.content.timeline.animation.motionClips.length, 3)
    assert.equal(packCount(), before)
    assert.equal(Object.keys(project.extensions.libraryMotionConversions!).length, 2)
    const latestRecipes = project.extensions.libraryMotionConversions
    const latestResponse = page.waitForResponse(response => response.url() === `${base}/api/library` && response.request().method() === 'POST')
    await source.getByRole('button', { name: /^Gán cho / }).click()
    assert.equal((await latestResponse).status(), 200)
    project = await readUnifiedProject(created.projectId)
    assert.equal(project.scene.content.timeline.animation.motionClips.length, 4)
    assert.deepEqual(project.extensions.libraryMotionConversions, latestRecipes)
    assert.equal(packCount(), before)
    assert.deepEqual(errors, [])
    console.log(JSON.stringify({ result: 'PASS', groups: 3, cards: 4, assignmentButtons: 4, packCountDelta: packCount() - before, clipsAfterReconvertAndReuse: 4, recipes: 2, pageErrors: errors }))
  } finally {
    await browser?.close()
    if (server) { server.kill('SIGTERM'); await new Promise<void>(resolve => { if (server!.exitCode !== null) resolve(); else server!.once('exit', () => resolve()) }) }
    rmSync(temp, { recursive: true, force: true })
    if (previousLibrary === undefined) delete process.env.W01_LIBRARY; else process.env.W01_LIBRARY = previousLibrary
    if (previousProjects === undefined) delete process.env.BBS_UNIFIED_PROJECTS_DIR; else process.env.BBS_UNIFIED_PROJECTS_DIR = previousProjects
  }
}
void main().catch(error => { console.error(error); process.exitCode = 1 })
