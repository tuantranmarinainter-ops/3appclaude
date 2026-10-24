import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { startWorkbench } from '../workbench/server.ts'
import { decodeGlb, encodeGlb } from '../cli/glb.ts'

const here = dirname(fileURLToPath(import.meta.url))
const output = resolve(process.argv[2] ?? 'outputs/C12')
const sources = resolve(process.argv[3] ?? '../../..')
mkdirSync(output, { recursive: true })
const data = mkdtempSync(join(tmpdir(), 'w01-c12-drop-'))
process.env.W01_LIBRARY = join(data, 'library')
// Same two-key animated Mixamo fixture as workbench.test.ts; binaries stay outside Git.
const builtin = resolve(here, '../../../../builtin-assets/characters')
const { json, bin } = decodeGlb(readFileSync(join(builtin, readdirSync(builtin).find(name => name.endsWith('.glb'))!)))
const hips = json.nodes.findIndex((node: any) => /(^|:)Hips$/i.test(node.name ?? ''))
assert.ok(hips >= 0)
const offset = Math.ceil(bin.length / 4) * 4, extra = Buffer.alloc(offset - bin.length + 40)
extra.writeFloatLE(1, offset - bin.length + 4)
;[0, 0, 0, 1, 0, .04, 0, Math.sqrt(1 - .04 ** 2)].forEach((value, index) => extra.writeFloatLE(value, offset - bin.length + 8 + index * 4))
json.bufferViews ??= []; json.accessors ??= []
const tv = json.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: 8 }) - 1
const rv = json.bufferViews.push({ buffer: 0, byteOffset: offset + 8, byteLength: 32 }) - 1
const ta = json.accessors.push({ bufferView: tv, componentType: 5126, count: 2, type: 'SCALAR', min: [0], max: [1] }) - 1
const ra = json.accessors.push({ bufferView: rv, componentType: 5126, count: 2, type: 'VEC4' }) - 1
json.animations = [{ name: 'C12 tiny', samplers: [{ input: ta, output: ra, interpolation: 'LINEAR' }], channels: [{ sampler: 0, target: { node: hips, path: 'rotation' } }] }]
const fullBin = Buffer.concat([Buffer.from(bin), extra]); json.buffers[0].byteLength = fullBin.length
const tiny = encodeGlb(json, fullBin), glb = join(data, 'tiny.glb')
writeFileSync(glb, tiny)
const fbx = join(data, 'Samba Dancing.fbx'), bobj = join(data, 'minecraft-actions.bobj')
copyFileSync(join(sources, 'data-c6/Samba Dancing.fbx'), fbx)
copyFileSync(resolve(here, '../../../apps/studio/public/retarget/v9.12/minecraft-actions.bobj'), bobj)
const nested = join(data, 'Nested'); mkdirSync(join(nested, 'inner'), { recursive: true })
copyFileSync(glb, join(nested, 'inner/tiny.glb')); copyFileSync(bobj, join(nested, 'minecraft-actions.bobj'))
const large = join(data, 'FolderXbot400'); mkdirSync(large)
copyFileSync(join(sources, 'data-c9/Xbot400.glb'), join(large, 'Xbot400.glb'))
const paged = join(data, 'Paged400'); mkdirSync(paged)
for (let index = 0; index < 400; index++) writeFileSync(join(paged, `tiny-${String(index).padStart(3, '0')}.glb`), tiny)
const require = createRequire(new URL('../../../apps/studio/package.json', import.meta.url))
const { chromium } = require('playwright')
const baseline = execFileSync('git', ['show', 'main:three-workspace-app/editor/packages/retarget/workbench/public/app.js'], { cwd: here, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 })
writeFileSync(join(output, 'baseline-app.js'), baseline)
const bench = await startWorkbench({ port: 0 }), browser = await chromium.launch({ headless: true })
const results: any[] = []
async function run(name: string, paths: string[], expected: number, animations: number[], old = false) {
  const started = Date.now(), page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
  const posts: any[] = [], errors: string[] = []
  page.on('pageerror', (error: Error) => errors.push(error.message))
  page.on('request', (request: any) => { if (request.method() === 'POST' && /\/api\/(batch-uploads|batches)/.test(request.url())) posts.push({ url: new URL(request.url()).pathname, path: decodeURIComponent(request.headers()['x-file-path'] ?? '') }) })
  if (old) await page.route('**/app.js', (route: any) => route.fulfill({ body: baseline, contentType: 'text/javascript' }))
  const result: any = { name, mode: 'native-CDP-files', paths, expected, baseline: old }
  try {
    await page.goto(bench.url)
    await page.locator('#targets button').first().waitFor({ state: 'attached' })
    await page.locator('#drop').scrollIntoViewIfNeeded()
    const box = await page.locator('#drop').boundingBox(); assert.ok(box)
    const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
    result.hit = await page.evaluate(({ x, y }: any) => {
      const element = document.elementFromPoint(x, y)
      ;(window as any).readerPages = []
      document.addEventListener('drop', (event: any) => {
        const entry = [...event.dataTransfer.items].map((item: any) => item.webkitGetAsEntry()).find((entry: any) => entry?.isDirectory)
        if (!entry) return
        const prototype = Object.getPrototypeOf(entry.createReader()), nativeRead = prototype.readEntries
        prototype.readEntries = function (success: any, failure: any) {
          return nativeRead.call(this, (entries: any[]) => { (window as any).readerPages.push(entries.length); success(entries) }, failure)
        }
      }, { capture: true, once: true })
      const audit: any[] = []; (window as any).dropAudit = audit
      for (const type of ['dragenter', 'dragover', 'drop']) document.addEventListener(type, (event: any) => {
        audit.push({ type, prevented: event.defaultPrevented, trusted: event.isTrusted, files: event.dataTransfer.files.length, entries: [...event.dataTransfer.items].map((item: any) => { const entry = item.webkitGetAsEntry(); return { file: entry?.isFile, directory: entry?.isDirectory, fullPath: entry?.fullPath } }) })
      })
      return { tag: element?.tagName, id: element?.id, insideDrop: !!element?.closest('#drop') }
    }, point)
    assert.equal(result.hit.insideDrop, true, 'drop target must not be covered by an overlay')
    const cdp = await page.context().newCDPSession(page)
    for (const type of ['dragEnter', 'dragOver', 'drop']) await cdp.send('Input.dispatchDragEvent', { type, ...point, data: { items: [], files: paths, dragOperationsMask: 1 } })
    result.audit = await page.evaluate(() => (window as any).dropAudit)
    assert.ok(result.audit.some((event: any) => event.type === 'dragover' && event.prevented))
    assert.ok(result.audit.some((event: any) => event.type === 'drop' && event.trusted && event.entries.some((entry: any) => entry.file || entry.directory)), 'native FileSystemEntry required')
    if (old) {
      await page.waitForTimeout(2000)
      assert.equal(posts.length, 0, 'baseline silently loses native entry files')
      result.status = 'REPRODUCED'
    } else {
      const response = await page.waitForResponse((response: any) => /\/api\/batches\/[a-f0-9]+$/.test(response.url()) && response.request().method() === 'GET' && response.status() === 200, { timeout: 120000 })
      let batch = await response.json()
      while (batch.state === 'running') { await page.waitForTimeout(250); batch = await (await page.request.get(`${bench.url}/api/batches/${batch.batchId}`)).json() }
      assert.equal(batch.state, 'done'); assert.equal(batch.total, expected); assert.equal(batch.entries.length, expected)
      assert.equal(posts.filter(post => /^\/api\/batch-uploads\//.test(post.url)).length, expected)
      assert.equal(posts.filter(post => post.url === '/api/batch-uploads').length, 1)
      assert.equal(posts.filter(post => post.url === '/api/batches').length, 1)
      const expectedPaths = paths.flatMap(path => statSync(path).isDirectory()
        ? readdirSync(path, { recursive: true, withFileTypes: true }).filter(entry => entry.isFile()).map(entry => join(basename(path), entry.parentPath.slice(path.length), entry.name).replaceAll('\\', '/'))
        : [basename(path)])
      assert.deepEqual(posts.filter(post => post.path).map(post => post.path).sort(), expectedPaths.sort(), 'every staged relative path is preserved')
      assert.ok(batch.entries.every((entry: any) => ['ready', 'duplicate'].includes(entry.status)), JSON.stringify(batch.entries.filter((entry: any) => entry.status === 'error')))
      const counts = batch.entries.map((entry: any) => entry.inspect.actions.length)
      assert.deepEqual(counts.slice().sort((a: number, b: number) => a - b), animations.slice().sort((a, b) => a - b))
      if (paths.length === 1 && !paths[0].endsWith('.glb') && !paths[0].endsWith('.fbx') && !paths[0].endsWith('.bobj')) assert.ok(posts.filter(post => post.path).every(post => post.path.startsWith(`${basename(paths[0])}/`)))
      result.batch = batch; result.animationCounts = counts; result.status = 'PASS'
    }
    result.readerPages = await page.evaluate(() => (window as any).readerPages)
    if (name === 'directory-400-files') { assert.ok(result.readerPages.filter((count: number) => count > 0).length > 1); assert.equal(result.readerPages.reduce((sum: number, count: number) => sum + count, 0), 400); assert.equal(result.readerPages.at(-1), 0) }
    assert.deepEqual(errors, [])
    await page.screenshot({ path: join(output, `${name}.png`), fullPage: true })
  } catch (error) { result.status = 'FAIL'; result.error = String(error); await page.screenshot({ path: join(output, `${name}-failure.png`), fullPage: true }); throw error }
  finally { result.posts = posts; result.pageErrors = errors; result.durationMs = Date.now() - started; results.push(result); writeFileSync(join(output, 'browser.json'), JSON.stringify({ data, url: bench.url, results }, null, 2)); console.log(JSON.stringify({ name, status: result.status, durationMs: result.durationMs, posts: posts.length, error: result.error })); await page.close() }
}
try {
  await run('baseline-single-glb', [glb], 0, [], true)
  await run('single-glb', [glb], 1, [1])
  await run('single-fbx', [fbx], 1, [1])
  await run('single-bobj', [bobj], 1, [85])
  await run('multiple-files', [glb, fbx, bobj], 3, [1, 1, 85])
  await run('nested-directory', [nested], 2, [1, 85])
  await run('folder-xbot400', [large], 1, [400])
  await run('directory-400-files', [paged], 400, Array(400).fill(1))
} finally { await browser.close(); await bench.close() }
