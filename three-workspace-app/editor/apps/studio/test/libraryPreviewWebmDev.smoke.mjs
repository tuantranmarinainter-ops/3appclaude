import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { chromium } from 'playwright'

const studio = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const port = 14_000 + process.pid % 20_000
const origin = `http://127.0.0.1:${port}`
const output = `.next-library-preview-webm-${process.pid}`

function makeGlb({ animated = false } = {}) {
  const vertices = new Float32Array([-0.4, 0, 0, 0.4, 0, 0, 0, 1.5, 0])
  const indices = new Uint16Array([0, 1, 2])
  const times = new Float32Array([0, 1])
  const translations = new Float32Array([0, 0, 0, 0.3, 0, 0])
  const chunks = [Buffer.from(vertices.buffer), Buffer.from(indices.buffer)]
  const indexPadding = Buffer.alloc(2)
  chunks.push(indexPadding, Buffer.from(times.buffer), Buffer.from(translations.buffer))
  const binary = Buffer.concat(chunks)
  const json = {
    asset: { version: '2.0' },
    buffers: [{ byteLength: binary.length }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: vertices.byteLength, target: 34962 },
      { buffer: 0, byteOffset: 36, byteLength: indices.byteLength, target: 34963 },
      ...(animated ? [{ buffer: 0, byteOffset: 44, byteLength: times.byteLength }, { buffer: 0, byteOffset: 52, byteLength: translations.byteLength }] : []),
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [-0.4, 0, 0], max: [0.4, 1.5, 0] },
      { bufferView: 1, componentType: 5123, count: 3, type: 'SCALAR' },
      ...(animated ? [{ bufferView: 2, componentType: 5126, count: 2, type: 'SCALAR', min: [0], max: [1] }, { bufferView: 3, componentType: 5126, count: 2, type: 'VEC3' }] : []),
    ],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
    nodes: [{ name: 'Hips', mesh: 0 }],
    scenes: [{ nodes: [0] }],
    scene: 0,
    ...(animated ? { animations: [{ samplers: [{ input: 2, output: 3, interpolation: 'LINEAR' }], channels: [{ sampler: 0, target: { node: 0, path: 'translation' } }] }] } : {}),
  }
  const jsonBytes = Buffer.from(JSON.stringify(json))
  const jsonPadding = Buffer.alloc((4 - jsonBytes.length % 4) % 4, 0x20)
  const jsonChunk = Buffer.concat([jsonBytes, jsonPadding])
  const total = 12 + 8 + jsonChunk.length + 8 + binary.length
  const header = Buffer.alloc(12)
  header.write('glTF', 0, 'ascii'); header.writeUInt32LE(2, 4); header.writeUInt32LE(total, 8)
  const jsonHeader = Buffer.alloc(8); jsonHeader.writeUInt32LE(jsonChunk.length, 0); jsonHeader.writeUInt32LE(0x4e4f534a, 4)
  const binHeader = Buffer.alloc(8); binHeader.writeUInt32LE(binary.length, 0); binHeader.writeUInt32LE(0x004e4942, 4)
  return Buffer.concat([header, jsonHeader, jsonChunk, binHeader, binary])
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = '', stderr = ''
    child.stdout.on('data', chunk => { stdout += String(chunk) })
    child.stderr.on('data', chunk => { stderr += String(chunk) })
    child.once('error', reject)
    child.once('exit', code => code === 0 ? resolve(stdout) : reject(new Error(`${command} exited ${code}: ${stderr}`)))
  })
}

test('next dev renders a real WebM from a non-Draco GLB without requesting the Draco decoder', async () => {
  const tsconfig = path.join(studio, 'tsconfig.json')
  const initialTsconfig = await readFile(tsconfig, 'utf8')
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'library-preview-webm-'))
  const rawPath = path.join(temporary, 'browser.webm')
  const outputPath = path.join(temporary, 'preview.webm')
  const characterGlb = makeGlb()
  const actionGlb = makeGlb({ animated: true })
  const server = spawn(process.execPath, [path.join(studio, 'node_modules/next/dist/bin/next'), 'dev', '--hostname', '127.0.0.1', '--port', String(port)], {
    cwd: studio,
    env: { ...process.env, NEXT_DIST_DIR: output },
    stdio: ['ignore', 'ignore', 'pipe'],
  })
  let browser
  let stderr = ''
  server.stderr.on('data', chunk => { stderr = `${stderr}${String(chunk)}`.slice(-4000) })
  try {
    let ready = false
    for (let attempt = 0; attempt < 120; attempt++) {
      if (server.exitCode !== null) throw new Error(`next dev exited early: ${stderr}`)
      try { if ((await fetch(`${origin}/library/preview-render`)).ok) { ready = true; break } } catch { /* server still starting */ }
      await delay(500)
    }
    assert.equal(ready, true, `next dev did not become ready: ${stderr}`)

    browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] })
    const page = await browser.newPage()
    let decoderRequested = false
    await page.route('**/api/library/character/**', route => route.fulfill({ status: 200, contentType: 'model/gltf-binary', body: characterGlb }))
    await page.route('**/api/library/animation/**', route => route.fulfill({ status: 200, contentType: 'model/gltf-binary', body: actionGlb }))
    await page.route('**/draco/**', route => { decoderRequested = true; return route.abort() })
    const query = new URLSearchParams({ actionUuid: 'test-action', charId: 'test-character', animationIndex: '0' })
    await page.goto(`${origin}/library/preview-render?${query}`, { waitUntil: 'load', timeout: 45_000 })
    await page.waitForFunction(() => Boolean(window.__libraryPreviewResult), undefined, { timeout: 60_000 })
    const preview = await page.evaluate(() => window.__libraryPreviewResult)
    assert.equal(preview?.error, undefined, preview?.error)
    const raw = Buffer.from(preview.data, 'base64')
    assert.deepEqual([...raw.subarray(0, 4)], [0x1a, 0x45, 0xdf, 0xa3])
    assert.equal(decoderRequested, false)
    await writeFile(rawPath, raw)
    await run(process.env.FFMPEG_PATH || 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', rawPath, '-t', '1', '-vf', 'fps=15,scale=320:320:force_original_aspect_ratio=decrease,pad=320:320:(ow-iw)/2:(oh-ih)/2', '-an', '-c:v', 'libvpx-vp9', '-crf', '36', '-b:v', '0', '-deadline', 'realtime', '-cpu-used', '4', '-f', 'webm', outputPath])
    const info = JSON.parse(await run(process.env.FFPROBE_PATH || 'ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,width,height,r_frame_rate', '-show_entries', 'format=duration', '-of', 'json', outputPath]))
    assert.deepEqual([info.streams[0].codec_name, info.streams[0].width, info.streams[0].height, info.streams[0].r_frame_rate], ['vp9', 320, 320, '15/1'])
    assert.ok(Number(info.format.duration) > 0)
    console.log(`next dev WebM: ${raw.length} browser bytes → ${info.streams[0].codec_name} ${info.streams[0].width}×${info.streams[0].height} ${info.streams[0].r_frame_rate} fps, ${Number(info.format.duration).toFixed(2)} s`)
    await page.close()
  } finally {
    await browser?.close().catch(() => undefined)
    if (server.exitCode === null) server.kill('SIGTERM')
    await Promise.race([new Promise(resolve => server.once('exit', resolve)), delay(5000)])
    if (server.exitCode === null) server.kill('SIGKILL')
    await rm(path.join(studio, output), { recursive: true, force: true })
    await rm(temporary, { recursive: true, force: true })
    await writeFile(tsconfig, initialTsconfig)
  }
})
