import assert from 'node:assert/strict'
import test, { after, before } from 'node:test'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { runInNewContext } from 'node:vm'
import { request } from 'node:http'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadAsset } from '../cli/loadAsset.ts'
import { loadBobj } from '../cli/loadBobj.ts'
import { startWorkbench, type Workbench } from '../workbench/server.ts'
import { createCharacter, getAction, listCharacterActions, registerBaseModel, registerLibraryCharacter, resolveLibraryPath } from '../../library/index.ts'
import { evaluateBobjAction, parseBobjActions } from '../src/index.ts'
import { parseBobjArmature } from '../src/reverse.ts'
import { VERITY_TO_MIXAMO } from '../src/verityRig.ts'
import { decodeGlb, encodeGlb } from '../cli/glb.ts'
import { AnimationMixer, LoopOnce, Vector3 } from 'three'
import { executeTransfer, suggestActionKey } from '../workbench/public/transfer.js'

const here = dirname(fileURLToPath(import.meta.url))
const bobjDir = resolve(here, '../../../apps/studio/public/retarget/v9.12')
const characters = resolve(here, '../../../../builtin-assets/characters')
const xbot = 'C:/w01-samples/Xbot.glb'
const haveXbot = existsSync(xbot)

function syntheticVerity(helperCount: number, wingCount: number): string {
  const matrix = (x: number, y: number, z: number) => `1 0 0 ${x} 0 1 0 ${y} 0 0 1 ${z} 0 0 0 1`
  const bone = (name: string, parent: string | null, x = 0, y = 1, z = 0) => `arm_bone ${name}${parent ? ` ${parent}` : ''} ${x} ${y + .1} ${z} ${matrix(x, y, z)}`
  const mapped = Object.keys(VERITY_TO_MIXAMO).filter((name) => name !== 'COG').map((name, index) => bone(name,
    name === 'Upper_Leg_L' || name === 'Upper_Leg_R' ? 'Pelvis' : name === 'Head' ? 'COG' : 'Root',
    name === 'Upper_Leg_L' ? -.2 : name === 'Upper_Leg_R' ? .2 : index * .001, name === 'Head' ? 2 : 1.2))
  const actions = ['idle', 'crouching', 'crouching_idle', 'dead', 'dying', 'running', 'sprinting', 'swipe'].flatMap((name) => [
    `an ${name}`, 'ao Root', 'ag rotation 1', 'kf 0 1.5707963267948966 LINEAR 0 1.5707963267948966 0 1.5707963267948966',
    ...(name === 'idle' ? Array.from({ length: wingCount }, (_, index) => [`ao Wing_Bone_${index}`, 'ag rotation 2', 'kf 0 0 LINEAR 0 0 0 0', 'kf 2 .4 LINEAR 2 .4 2 .4']).flat() : []),
  ])
  return ['arm_name verity.mdl', bone('Root', null, 0, 0, 0), bone('COG', 'Root', 0, 1, 0), bone('Pelvis', 'COG', 0, 1.1, 0), ...mapped,
    bone('Jaw', 'Head', 0, 1.9, .1), ...Array.from({ length: wingCount }, (_, index) => bone(`Wing_Bone_${index}`, 'COG', -.4 - index * .1, 1.5, 0)),
    bone('camera', 'Root', 0, -2, 0), bone('Jaw_end_end', 'Jaw', 0, 1.8, .1), ...Array.from({ length: helperCount }, (_, index) => bone(`Helper_${index}`, 'Root', 0, 0, index * .01)),
    'o body', 'v 0 0 0', 'vw COG 1', ...actions].join('\n') + '\n'
}

function syntheticAnimatedMixamo(glbPath: string, animationName: string): Uint8Array {
  const { json, bin } = decodeGlb(readFileSync(glbPath))
  const hips = json.nodes.findIndex((node: any) => /(^|:)Hips$/i.test(node.name ?? ''))
  assert.ok(hips >= 0, 'fixture has a Hips joint')
  const offset = Math.ceil(bin.length / 4) * 4, extra = Buffer.alloc(offset - bin.length + 40)
  extra.writeFloatLE(0, offset - bin.length); extra.writeFloatLE(1, offset - bin.length + 4)
  ;[0, 0, 0, 1, 0, 0.04, 0, Math.sqrt(1 - 0.04 ** 2)].forEach((value, index) => extra.writeFloatLE(value, offset - bin.length + 8 + index * 4))
  const fullBin = Buffer.concat([Buffer.from(bin), extra])
  json.bufferViews ??= []; json.accessors ??= []
  const timeView = json.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: 8 }) - 1
  const rotationView = json.bufferViews.push({ buffer: 0, byteOffset: offset + 8, byteLength: 32 }) - 1
  const timeAccessor = json.accessors.push({ bufferView: timeView, componentType: 5126, count: 2, type: 'SCALAR', min: [0], max: [1] }) - 1
  const rotationAccessor = json.accessors.push({ bufferView: rotationView, componentType: 5126, count: 2, type: 'VEC4' }) - 1
  json.buffers[0].byteLength = fullBin.length
  json.animations = [{ name: animationName, samplers: [{ input: timeAccessor, output: rotationAccessor, interpolation: 'LINEAR' }], channels: [{ sampler: 0, target: { node: hips, path: 'rotation' } }] }]
  return encodeGlb(json, fullBin)
}

function syntheticMixamoAnimations(glbPath: string, actions: Array<{ name: string; duration: number }>): Uint8Array {
  const { json, bin } = decodeGlb(readFileSync(glbPath))
  const hips = json.nodes.findIndex((node: any) => /(^|:)Hips$/i.test(node.name ?? ''))
  assert.ok(hips >= 0, 'fixture has a Hips joint')
  const offset = Math.ceil(bin.length / 4) * 4
  const extra = Buffer.alloc(offset - bin.length + actions.length * 40)
  json.bufferViews ??= []; json.accessors ??= []; json.animations = []
  actions.forEach(({ name, duration }, index) => {
    const base = offset - bin.length + index * 40
    extra.writeFloatLE(0, base); extra.writeFloatLE(duration, base + 4)
    ;[0, 0, 0, 1, 0, 0.04, 0, Math.sqrt(1 - 0.04 ** 2)].forEach((value, valueIndex) => extra.writeFloatLE(value, base + 8 + valueIndex * 4))
    const timeView = json.bufferViews.push({ buffer: 0, byteOffset: offset + index * 40, byteLength: 8 }) - 1
    const rotationView = json.bufferViews.push({ buffer: 0, byteOffset: offset + index * 40 + 8, byteLength: 32 }) - 1
    const timeAccessor = json.accessors.push({ bufferView: timeView, componentType: 5126, count: 2, type: 'SCALAR', min: [0], max: [duration] }) - 1
    const rotationAccessor = json.accessors.push({ bufferView: rotationView, componentType: 5126, count: 2, type: 'VEC4' }) - 1
    json.animations.push({ name, samplers: [{ input: timeAccessor, output: rotationAccessor, interpolation: 'LINEAR' }], channels: [{ sampler: 0, target: { node: hips, path: 'rotation' } }] })
  })
  const fullBin = Buffer.concat([Buffer.from(bin), extra])
  json.buffers[0].byteLength = fullBin.length
  return encodeGlb(json, fullBin)
}

let bench: Workbench
// The server reads App 5 library characters at start: use an empty library so the user's own characters don't count.
const emptyLibrary = mkdtempSync(join(tmpdir(), 'w01-wb-empty-library-')), startLibrary = process.env.W01_LIBRARY
before(async () => { process.env.W01_LIBRARY = emptyLibrary; bench = await startWorkbench({ port: 0 }) })
after(async () => {
  await bench.close()
  if (startLibrary === undefined) delete process.env.W01_LIBRARY
  else process.env.W01_LIBRARY = startLibrary
  rmSync(emptyLibrary, { recursive: true, force: true })
})

const call = async (path: string, init?: RequestInit) => {
  const response = await fetch(bench.url + path, init)
  const text = await response.text()
  let json: any
  try { json = JSON.parse(text) } catch { json = undefined }
  return { status: response.status, json, text, headers: response.headers }
}
const post = (path: string, body: unknown) => call(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
/** Raw request line, so `..` reaches the server un-normalized (fetch would collapse it client-side). */
const raw = (path: string, headers: Record<string, string> = {}) => new Promise<{ status: number; body: string }>((ok, fail) => {
  const url = new URL(bench.url)
  const req = request({ host: url.hostname, port: url.port, path, headers }, (res) => {
    const chunks: Buffer[] = []
    res.on('data', (chunk) => chunks.push(chunk)).on('end', () => ok({ status: res.statusCode!, body: Buffer.concat(chunks).toString() }))
  })
  req.on('error', fail).end()
})

test('serves the page, the app module and a bound loopback address only', async () => {
  assert.match(bench.url, /^http:\/\/127\.0\.0\.1:\d+$/)
  const index = await call('/')
  assert.equal(index.status, 200)
  assert.match(index.text, /importmap/)
  assert.match(index.text, /data-resize-panel="steps"/)
  assert.match(index.text, /data-resize-panel="viewer"/)
  assert.match(index.text, /data-resize-panel="timeline"/)
  assert.match(index.text, /data-resize-panel="results"/)
  assert.match(index.text, /id="fileInput"[^>]*multiple/)
  assert.match(index.text, /id="folderInput"[^>]*webkitdirectory/)
  assert.equal((await call('/app.js')).status, 200)
  const panels = await call('/resizable-panels.js')
  assert.equal(panels.status, 200)
  assert.match(panels.text, /localStorage/)
  assert.match(panels.text, /dblclick/)
  assert.equal((await call('/styles.css')).status, 200)
})

test('source Action picker is pinned, persisted, and closes only through its X button', async () => {
  const html = (await call('/')).text, app = (await call('/app.js')).text, css = (await call('/styles.css')).text
  assert.match(html, /id="actionPicker"[^>]*hidden/)
  assert.match(html, /id="actionPickerClose"/)
  assert.match(html, /id="actionPickerInvert"/)
  assert.match(app, /pickerStorageKey = 'w01\.actionPicker\.v1'/)
  assert.match(app, /actionPickerClose'\)\.addEventListener\('click', closeActionPicker\)/)
  assert.doesNotMatch(app, /Escape[\s\S]{0,100}closeActionPicker/)
  assert.doesNotMatch(app, /picker[^\n]*addEventListener\('click'[^\n]*closeActionPicker/)
  assert.match(css, /\.action-picker[^}]*resize: both/)
  assert.match(app, /executeTransfer\(\{ indices, toCharacter, toShared/)
  assert.match(app, /transferRetry[\s\S]*transferSelected\(failed, config\)/)
  assert.match(app, /renderBatchActionPicker/)
  assert.match(app, /selectedBatchGroups/)
  assert.match(app, /\/api\/batches/)
  assert.match(app, /state\.batch && character\.rig === 'minecraft20'/)
  assert.match(app, /function syncBatchDestinationOptions\(\)[\s\S]*?elements\.bobj\.checked = true/)
  assert.match(app, /durationSeconds > 0/)
  assert.match(app, /Tên Anh \$\{entry\.name\}/)
})

test('one-click transfer orchestrator uses the exact selection, supports shared-only, and retries only failures', async () => {
  const normalized: number[][] = [], characterImports: number[][] = [], sharedImports: number[][] = []
  const normalize = async (indices: number[]) => {
    normalized.push(indices)
    const completed = indices.filter((index) => index !== 2 || normalized.length > 1)
    return { runId: `run-${normalized.length}`, manifest: { actions: completed.map((sourceActionIndex) => ({ sourceActionIndex, uuid: `uuid-${sourceActionIndex}` })) } }
  }
  const importCharacter = async (_run: unknown, actions: any[]) => { characterImports.push(actions.map((action) => action.sourceActionIndex)); return { drafts: actions.map((action) => ({ uuid: action.uuid })) } }
  const importShared = async (_run: unknown, actions: any[]) => { sharedImports.push(actions.map((action) => action.sourceActionIndex)); return { packId: 'shared' } }

  const both = await executeTransfer({ indices: [0, 2], toCharacter: true, toShared: true, normalize, importCharacter, importShared })
  assert.deepEqual(normalized[0], [0, 2]); assert.deepEqual(characterImports[0], [0]); assert.deepEqual(sharedImports[0], [0])
  assert.equal(both.drafts.length, 1); assert.deepEqual(both.failed, [2])
  const retry = await executeTransfer({ indices: both.failed, toCharacter: true, toShared: true, normalize, importCharacter, importShared })
  assert.deepEqual(normalized[1], [2]); assert.deepEqual(retry.failed, []); assert.equal(retry.drafts.length, 1)

  const sharedOnly = await executeTransfer({ indices: [1, 3], toCharacter: false, toShared: true, normalize, importCharacter, importShared })
  assert.deepEqual(normalized[2], [1, 3]); assert.equal(sharedOnly.drafts.length, 0)
  assert.equal(characterImports.length, 2, 'shared-only must not create character drafts')
  assert.deepEqual(sharedImports[2], [1, 3])
})

test('transfer suggests a required action key from selected animation names', () => {
  const required = [{ key: 'idle', label: 'Đứng yên' }, { key: 'walking', label: 'Đi bộ' }, { key: 'running', label: 'Chạy' }, { key: 'fall', label: 'Ngã' }]
  assert.equal(suggestActionKey(required, ['Fast Walking']), 'walking')
  assert.equal(suggestActionKey(required, ['Chạy nhanh']), 'running')
  assert.equal(suggestActionKey(required, ['dead']), 'fall')
  assert.equal(suggestActionKey(required, ['sprinting']), 'running')
  assert.equal(suggestActionKey(required, ['Unmatched clip']), null)
})

test('canonical runs without original sidecars enable both Verity destination cards', async () => {
  const app = (await call('/app.js')).text
  const implementation = app.match(/function compatibleLibraryCharacter\(character\) \{[\s\S]*?\n\}/)![0]
  for (const rig of ['mixamo65', 'mixamo65+verity']) {
    const compatible = runInNewContext(`(${implementation})`, { state: { result: { manifest: { rig }, files: [{ kind: 'glb' }] } } })
    const destinations = [{ charId: 'verity84', rig: 'verity' }, { charId: 'verity101', rig: 'verity' }]
    assert.ok(destinations.every((character) => compatible(character).enabled), rig)
    assert.equal(compatible({ rig: 'custom' }).enabled, false)
    assert.equal(compatible({ rig: 'minecraft20' }).enabled, false, 'MC20 still requires BOBJ output')
  }
})

test('workspace navigation endpoint reads optional app URLs from the environment', async () => {
  const prior = [process.env.W01_STUDIO_URL, process.env.W01_ANIMATION_STUDIO_URL, process.env.W01_VFX_URL]
  process.env.W01_STUDIO_URL = 'http://127.0.0.1:3002'
  process.env.W01_ANIMATION_STUDIO_URL = 'http://127.0.0.1:3102'
  delete process.env.W01_VFX_URL
  try {
    const result = await call('/api/workspace-navigation')
    assert.equal(result.status, 200)
    assert.deepEqual(result.json, { studioUrl: 'http://127.0.0.1:3002', animationUrl: 'http://127.0.0.1:3102', vfxUrl: null })
  } finally {
    const keys = ['W01_STUDIO_URL', 'W01_ANIMATION_STUDIO_URL', 'W01_VFX_URL'] as const
    keys.forEach((key, index) => { if (prior[index] === undefined) delete process.env[key]; else process.env[key] = prior[index] })
  }
})

test('every module the browser imports resolves through the server (import map + relative imports)', async () => {
  const map = JSON.parse((await call('/')).text.match(/<script type="importmap">([\s\S]*?)<\/script>/)![1]!).imports as Record<string, string>
  const seen = new Set<string>()
  const visit = async (path: string) => {
    if (seen.has(path)) return
    seen.add(path)
    const { status, text } = await call(path)
    assert.equal(status, 200, path)
    for (const [, spec] of text.matchAll(/(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\s*['"]([^'"]+)['"]/g).flatMap((m) => [[m[0], m[1] ?? m[2]]] as const)) {
      let next: string | undefined
      if (spec!.startsWith('.')) next = new URL(spec!, bench.url + path).pathname
      else if (map[spec!]) next = map[spec!]
      else { const prefix = Object.keys(map).find((key) => key.endsWith('/') && spec!.startsWith(key)); if (prefix) next = map[prefix] + spec!.slice(prefix.length) }
      assert.ok(next, `${path} imports ${spec} which the import map does not cover`)
      await visit(next!)
    }
  }
  await visit('/app.js')
  assert.ok(seen.has('/viewer.js') && seen.has('/vendor/three/examples/jsm/loaders/GLTFLoader.js') && seen.has('/vendor/three/examples/jsm/libs/meshopt_decoder.module.js'))
})

test('lists the four built-in Mixamo65 characters with hips heights', async () => {
  const { status, json } = await call('/api/targets')
  assert.equal(status, 200)
  assert.equal(json.targets.length, 4)
  for (const target of json.targets) {
    assert.ok(readdirSync(characters).includes(target.file))
    assert.ok(target.hipsHeightMeters > 0.4 && target.hipsHeightMeters < 1.5, `hips ${target.hipsHeightMeters}`)
  }
  assert.equal((await call(json.targets[0].url)).status, 200, 'target GLB is served to the viewer')
})

test('adds a Mixamo65 character from a local path as a library target and refuses other files', async () => {
  const library = mkdtempSync(join(tmpdir(), 'w01-targets-'))
  const priorLibrary = process.env.W01_LIBRARY
  process.env.W01_LIBRARY = library
  try {
    const glb = join(characters, readdirSync(characters).find((name) => name.endsWith('.glb'))!)
    const added = await post('/api/targets', { path: glb, name: 'Nhân vật chính' })
    assert.equal(added.status, 200, added.text)
    assert.equal(added.json.name, 'Nhân vật chính')
    assert.equal(added.json.library, true)
    assert.ok(added.json.hipsHeightMeters > 0.5)
    const listed = (await call('/api/targets')).json.targets
    assert.ok(listed.some((target: { id: string }) => target.id === added.json.id))
    assert.ok(existsSync(join(library, 'characters')))
    assert.equal((await post('/api/targets', { path: join(characters, 'missing.glb') })).status, 400)
    assert.equal((await post('/api/targets', { path: join(bobjDir, 'minecraft20-armature.bobj') })).status, 400)
  } finally {
    if (priorLibrary === undefined) delete process.env.W01_LIBRARY
    else process.env.W01_LIBRARY = priorLibrary
    rmSync(library, { recursive: true, force: true })
  }
})

test('vendor route serves three modules and refuses traversal', async () => {
  for (const path of ['/vendor/three/build/three.module.js', '/vendor/three/examples/jsm/loaders/GLTFLoader.js', '/vendor/three/examples/jsm/controls/OrbitControls.js',
    '/vendor/three/examples/jsm/utils/SkeletonUtils.js', '/vendor/three/examples/jsm/libs/draco/gltf/draco_decoder.wasm']) {
    const { status } = await call(path)
    assert.equal(status, 200, path)
  }
  for (const path of ['/vendor/three/../../package.json', '/vendor/three/%2e%2e/%2e%2e/package.json', '/vendor/three/build/../../package.json', '/vendor/three/..%5c..%5cpackage.json',
    '/vendor/three/package.json', '/%2e%2e/%2e%2e/server.ts', '/../server.ts']) {
    const { status } = await raw(path)
    assert.ok(status === 403 || status === 404, `${path} -> ${status}`)
  }
})

test('rejects foreign Host headers and malformed bodies without leaking stacks', async () => {
  assert.equal((await raw('/api/targets', { host: 'evil.example' })).status, 403)
  const bad = await call('/api/inspect', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{nope' })
  assert.equal(bad.status, 400)
  assert.ok(typeof bad.json.error === 'string' && !/\bat .*\.ts:\d+/.test(bad.text))
  assert.equal((await post('/api/inspect', { sourceId: 'missing', targetId: 'x', options: {} })).status, 404)
  assert.equal((await call('/api/runs/nope')).status, 404)
  assert.equal((await post('/api/sources', { path: 'C:/definitely/not/here.glb' })).status, 400)
  assert.equal((await post('/api/sources', { path: join(bobjDir, 'README.md') })).status, 400, 'unsupported format')
})

test('upload keeps the file out of the repo and inspect reports a Mixamo target without Actions as BLOCKED NO_ACTION', async () => {
  const target = (await call('/api/targets')).json.targets[0]
  // A builtin character is a perfectly valid rig that carries no animation: inspect must explain, not crash.
  const bytes = readFileSync(join(characters, target.file))
  const upload = await call('/api/sources', { method: 'POST', headers: { 'x-file-name': encodeURIComponent('hero.glb') }, body: bytes })
  assert.equal(upload.status, 200, upload.text)
  assert.ok(upload.json.sourceId)
  const inspect = await post('/api/inspect', { sourceId: upload.json.sourceId, targetId: target.id, options: {} })
  assert.equal(inspect.status, 200, inspect.text)
  assert.equal(inspect.json.mapping.family, 'mixamo')
  assert.equal(inspect.json.mapping.joints.length, 65)
  assert.equal(inspect.json.blocker.code, 'NO_ACTION')
  const file = await call(`/api/sources/${upload.json.sourceId}/file`)
  assert.equal(file.status, 200)
})

test('batch inspection walks folders recursively and isolates a corrupt file as one entry error', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'w01-batch-inspect-'))
  const nested = join(folder, 'nested'); mkdirSync(nested)
  writeFileSync(join(folder, 'broken.glb'), 'not a GLB')
  writeFileSync(join(nested, 'also-broken.fbx'), 'not an FBX')
  writeFileSync(join(nested, 'ignore.txt'), 'not supported')
  try {
    const target = (await call('/api/targets')).json.targets[0]
    const started = await post('/api/batches', { paths: [folder], targetId: target.id, options: {} })
    assert.equal(started.status, 202, started.text)
    let current = started.json
    for (let attempt = 0; attempt < 100 && current.state === 'running'; attempt++) {
      await new Promise((ok) => setTimeout(ok, 10))
      current = (await call(`/api/batches/${started.json.batchId}`)).json
    }
    assert.equal(current.state, 'done')
    assert.equal(current.total, 2)
    assert.deepEqual(current.entries.map((entry: any) => entry.status), ['error', 'error'])
    assert.ok(current.entries.every((entry: any) => typeof entry.error === 'string'))
    assert.equal((await post(`/api/batches/${started.json.batchId}/cancel`, {})).status, 202)
    assert.equal((await call('/api/batches/missing')).status, 404)
    const tooMany = await post('/api/batches', { paths: Array(2001).fill(join(folder, 'broken.glb')), targetId: target.id, options: {} })
    assert.equal(tooMany.status, 413)
    const upload = await call('/api/batch-uploads', { method: 'POST' })
    assert.equal(upload.status, 201)
    const staged = await call(`/api/batch-uploads/${upload.json.uploadId}`, { method: 'POST', headers: { 'x-file-path': encodeURIComponent('Nested/broken.glb') }, body: readFileSync(join(folder, 'broken.glb')) })
    assert.equal(staged.status, 201)
    assert.equal((await call(`/api/batch-uploads/${upload.json.uploadId}`, { method: 'POST', headers: { 'x-file-path': encodeURIComponent('../escape.glb') }, body: readFileSync(join(folder, 'broken.glb')) })).status, 400)
    const uploadedBatch = await post('/api/batches', { uploadId: upload.json.uploadId, targetId: target.id, options: {} })
    assert.equal(uploadedBatch.status, 202)
  } finally { rmSync(folder, { recursive: true, force: true }) }
})

test('batch picker names Mixamo mixamo.com Actions from the file and hides zero-duration Take 001 clips', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'w01-batch-mixamo-names-'))
  try {
    const builtin = join(characters, readdirSync(characters).find((name) => name.endsWith('.glb'))!)
    const source = join(folder, 'Samba Dancing.glb')
    writeFileSync(source, syntheticMixamoAnimations(builtin, [{ name: 'mixamo.com', duration: 1 }, { name: 'Take 001', duration: 0 }]))
    const target = (await call('/api/targets')).json.targets[0]
    const started = await post('/api/batches', { paths: [source], targetId: target.id, options: {} })
    assert.equal(started.status, 202, started.text)
    let batch = started.json
    for (let attempt = 0; attempt < 200 && batch.state === 'running'; attempt++) {
      await new Promise((ok) => setTimeout(ok, 20))
      batch = (await call(`/api/batches/${started.json.batchId}`)).json
    }
    assert.equal(batch.state, 'done')
    assert.equal(batch.entries[0].status, 'ready', batch.entries[0].error)
    assert.deepEqual(batch.entries[0].inspect.actions.map((action: any) => action.name), ['Samba Dancing'])
    assert.equal(batch.entries[0].inspect.actions[0].nameVi, 'Nhảy samba')
    assert.equal(batch.entries[0].inspect.actions[0].displayName, 'Samba Dancing | Nhảy samba')
    assert.equal(batch.entries[0].inspect.actions[0].sourceName, 'mixamo.com')
    const sourceId = batch.entries[0].sourceId
    const run = await post('/api/runs', { sourceId, targetId: target.id, options: { actions: [0], actionNames: { 0: { name: 'Samba Dancing', nameVi: 'Nhảy samba' } } } })
    assert.equal(run.status, 200, run.text)
    assert.equal(run.json.status, 'PASS', JSON.stringify(run.json.report))
    assert.equal(run.json.manifest.actions[0].name, 'Samba Dancing')
    assert.equal(run.json.manifest.actions[0].nameVi, 'Nhảy samba')
    assert.equal(run.json.manifest.actions[0].sourceName, 'mixamo.com')
  } finally { rmSync(folder, { recursive: true, force: true }) }
})

test('three-file Mixamo batch normalizes two Actions, imports per-file packs/drafts, and flags re-imports', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'w01-batch-transfer-'))
  const library = mkdtempSync(join(tmpdir(), 'w01-batch-library-'))
  const priorLibrary = process.env.W01_LIBRARY
  process.env.W01_LIBRARY = library
  try {
    const builtin = join(characters, readdirSync(characters).find((name) => name.endsWith('.glb'))!)
    const first = join(folder, 'Samba Dancing.glb'), second = join(folder, 'Walking.glb')
    writeFileSync(first, syntheticAnimatedMixamo(builtin, 'Samba Dancing'))
    writeFileSync(second, syntheticAnimatedMixamo(builtin, 'Walking'))
    writeFileSync(join(folder, 'broken.glb'), 'broken')
    const character = await post('/api/targets', { path: builtin, name: 'Batch target' })
    assert.equal(character.status, 200, character.text)
    const started = await post('/api/batches', { paths: [folder], targetId: character.json.id, options: {} })
    assert.equal(started.status, 202, started.text)
    let batch = started.json
    for (let attempt = 0; attempt < 200 && batch.state === 'running'; attempt++) {
      await new Promise((ok) => setTimeout(ok, 20))
      batch = (await call(`/api/batches/${started.json.batchId}`)).json
    }
    assert.equal(batch.state, 'done')
    assert.equal(batch.entries.length, 3)
    assert.deepEqual(batch.entries.map((entry: any) => entry.status).sort(), ['error', 'ready', 'ready'])
    const charId = character.json.id.replace(/^lib-/, '')
    for (const entry of batch.entries.filter((item: any) => item.status === 'ready')) {
      const run = await post('/api/runs', { sourceId: entry.sourceId, targetId: character.json.id, options: { actions: [0] } })
      assert.equal(run.status, 200, run.text)
      assert.equal(run.json.status, 'PASS', JSON.stringify(run.json.report))
      const action = run.json.manifest.actions[0]
      assert.equal((await post(`/api/runs/${run.json.runId}/character-library`, { charIds: [charId], actions: [{ uuid: action.uuid, key: 'idle' }] })).status, 200)
      const shared = await post(`/api/runs/${run.json.runId}/library`, { actions: [{ uuid: action.uuid, key: 'dance' }], license: { id: 'internal-only', commitable: false, source: 'Mixamo (Adobe)' } })
      assert.equal(shared.status, 200, shared.text)
      assert.ok(getAction({ actionUuid: action.uuid }).tags.includes('dance'))
    }
    assert.equal(listCharacterActions({ charId }).length, 2)
    const sharedPacks = readdirSync(join(library, 'packs'), { withFileTypes: true }).filter((item) => item.isDirectory()).filter((item) => {
      const meta = JSON.parse(readFileSync(join(library, 'packs', item.name, 'meta.json'), 'utf8'))
      return meta.actions.every((action: any) => !action.ownerCharId)
    })
    assert.equal(sharedPacks.length, 2)
    const external = syntheticAnimatedMixamo(builtin, 'External Walk'), externalParts = decodeGlb(external), externalJson = externalParts.json
    externalJson.buffers = [{ uri: 'animation.bin', byteLength: externalParts.bin.length }]
    const upload = await call('/api/batch-uploads', { method: 'POST' })
    assert.equal(upload.status, 201)
    assert.equal((await call(`/api/batch-uploads/${upload.json.uploadId}`, { method: 'POST', headers: { 'x-file-path': encodeURIComponent('Folder/animation.gltf') }, body: Buffer.from(JSON.stringify(externalJson)) })).status, 201)
    assert.equal((await call(`/api/batch-uploads/${upload.json.uploadId}`, { method: 'POST', headers: { 'x-file-path': encodeURIComponent('Folder/animation.bin') }, body: externalParts.bin })).status, 201)
    const externalStarted = await post('/api/batches', { uploadId: upload.json.uploadId, targetId: character.json.id, options: {} })
    let externalBatch = externalStarted.json
    for (let attempt = 0; attempt < 200 && externalBatch.state === 'running'; attempt++) {
      await new Promise((ok) => setTimeout(ok, 20))
      externalBatch = (await call(`/api/batches/${externalStarted.json.batchId}`)).json
    }
    assert.equal(externalBatch.entries[0].status, 'ready', externalBatch.entries[0].error)
    const again = await post('/api/batches', { paths: [folder], targetId: character.json.id, options: {} })
    let repeated = again.json
    for (let attempt = 0; attempt < 200 && repeated.state === 'running'; attempt++) {
      await new Promise((ok) => setTimeout(ok, 20))
      repeated = (await call(`/api/batches/${again.json.batchId}`)).json
    }
    assert.deepEqual(repeated.entries.map((entry: any) => entry.status).sort(), ['duplicate', 'duplicate', 'error'])
    assert.ok(repeated.entries.filter((entry: any) => entry.status === 'duplicate').every((entry: any) => entry.inLibrary))
  } finally {
    if (priorLibrary === undefined) delete process.env.W01_LIBRARY
    else process.env.W01_LIBRARY = priorLibrary
    rmSync(library, { recursive: true, force: true }); rmSync(folder, { recursive: true, force: true })
  }
})

test('Xbot upload → inspect → run: PASS, files downloadable, GLB parses', { skip: haveXbot ? false : 'C:/w01-samples/Xbot.glb not present' }, async () => {
  const target = (await call('/api/targets')).json.targets[0]
  const upload = await call('/api/sources', { method: 'POST', headers: { 'x-file-name': 'Xbot.glb' }, body: readFileSync(xbot) })
  assert.equal(upload.status, 200, upload.text)
  const { sourceId } = upload.json
  const inspect = await post('/api/inspect', { sourceId, targetId: target.id, options: {} })
  assert.equal(inspect.status, 200, inspect.text)
  assert.equal(inspect.json.blocker, null)
  assert.equal(inspect.json.mapping.family, 'mixamo')
  assert.equal(inspect.json.mapping.joints.length, 65)
  assert.equal(inspect.json.mapping.mapped, 65)
  assert.equal(inspect.json.actions.length, 7)
  assert.ok(inspect.json.sourceBones.length >= 65)
  assert.ok(inspect.json.proportions.suggestedRootScale > 0)

  const run = await post('/api/runs', { sourceId, targetId: target.id, options: { actions: [0, 1] } })
  assert.equal(run.status, 200, run.text)
  assert.equal(run.json.report.status, 'PASS')
  assert.equal(run.json.manifest.actions.length, 2)
  assert.equal(run.json.report.contract.noNamePrefix, 'PASS')
  const kinds = new Map<string, string>(run.json.files.map((file: { kind: string; url: string }) => [file.kind, file.url]))
  for (const kind of ['glb', 'manifest', 'report']) assert.ok(kinds.has(kind), kind)
  const glb = await fetch(bench.url + kinds.get('glb'))
  assert.equal(glb.status, 200)
  const bytes = new Uint8Array(await glb.arrayBuffer())
  const scene = await loadAsset(bytes, 'glb')
  assert.equal(scene.animations.length, 2)
  const manifest = await (await fetch(bench.url + kinds.get('manifest')!)).json()
  assert.equal(manifest.version, '1.0.0')
  // Polling endpoint keeps the finished state and the files list.
  const state = await call(`/api/runs/${run.json.runId}`)
  assert.equal(state.json.state, 'done')
  assert.equal(state.json.result.report.status, 'PASS')
  assert.equal((await call(`/api/runs/${run.json.runId}/files/..%2f..%2fpackage.json`)).status, 404)
  assert.equal((await call(`/api/runs/${run.json.runId}/files/not-a-file`)).status, 404)

  // "Gửi sang App 2": the PASS run becomes one App 5 library pack; sending again reuses it.
  const library = mkdtempSync(join(tmpdir(), 'w01-library-'))
  const priorLibrary = process.env.W01_LIBRARY
  process.env.W01_LIBRARY = library
  try {
    const sent = await post(`/api/runs/${run.json.runId}/library`, {})
    assert.equal(sent.status, 200, sent.text)
    assert.equal(sent.json.created, true)
    assert.equal(sent.json.actions, 2)
    assert.equal(sent.json.rig, 'mixamo65')
    assert.ok(existsSync(join(library, 'packs', sent.json.packId, 'anim.glb')))
    const again = await post(`/api/runs/${run.json.runId}/library`, {})
    assert.equal(again.json.created, false)
    assert.equal(again.json.packId, sent.json.packId)
    assert.equal((await post('/api/runs/nope/library', {})).status, 404)
  } finally {
    if (priorLibrary === undefined) delete process.env.W01_LIBRARY
    else process.env.W01_LIBRARY = priorLibrary
    rmSync(library, { recursive: true, force: true })
  }
})

test('async run exposes progress and refuses a second run while one is active', { skip: haveXbot ? false : 'C:/w01-samples/Xbot.glb not present' }, async () => {
  const target = (await call('/api/targets')).json.targets[0]
  const { sourceId } = (await call('/api/sources', { method: 'POST', headers: { 'x-file-name': 'Xbot.glb' }, body: readFileSync(xbot) })).json
  const started = await post('/api/runs', { sourceId, targetId: target.id, options: { preview: true }, wait: false })
  assert.equal(started.status, 202, started.text)
  const second = await post('/api/runs', { sourceId, targetId: target.id, options: {}, wait: false })
  assert.equal(second.status, 409)
  assert.equal(second.json.runId, started.json.runId)
  let state: any
  for (let attempt = 0; attempt < 200; attempt++) {
    state = (await call(`/api/runs/${started.json.runId}`)).json
    assert.ok(['running', 'done'].includes(state.state), state.state)
    if (state.state === 'done') break
    assert.ok(typeof state.stage === 'string')
    await new Promise((ok) => setTimeout(ok, 50))
  }
  assert.equal(state.state, 'done')
  assert.equal(state.result.report.status, 'PASS')
  assert.ok(state.result.files.some((file: { kind: string }) => file.kind === 'preview'), 'preview png requested')
  assert.ok(state.result.report.roundtrip.perAction[0].quality.contactRanges, 'report carries contact ranges for the timeline')
})

test('mapping preset round-trips: edit a joint, build a bbs.mixamo65-mapping-preset, run with it', { skip: haveXbot ? false : 'C:/w01-samples/Xbot.glb not present' }, async () => {
  const target = (await call('/api/targets')).json.targets[0]
  const { sourceId } = (await call('/api/sources', { method: 'POST', headers: { 'x-file-name': 'Xbot.glb' }, body: readFileSync(xbot) })).json
  const first = (await post('/api/inspect', { sourceId, targetId: target.id, options: {} })).json
  const assignments = Object.fromEntries(first.mapping.joints.map((joint: { target: string; source: string | null }) => [joint.target, joint.source]))
  assignments.LeftHandThumb3 = null // user unmaps one finger joint
  const preset = await post('/api/preset', { sourceId, targetId: target.id, assignments })
  assert.equal(preset.status, 200, preset.text)
  assert.equal(preset.json.preset.type, 'bbs.mixamo65-mapping-preset')
  assert.equal(preset.json.preset.roles.length, 65)
  const again = (await post('/api/inspect', { sourceId, targetId: target.id, options: {}, mappingPreset: preset.json.preset })).json
  assert.equal(again.mapping.mapped, 64)
  assert.ok(again.mapping.joints.every((joint: { via: string | null; source: string | null }) => !joint.source || joint.via === 'preset'))
  const run = await post('/api/runs', { sourceId, targetId: target.id, options: { actions: [0] }, mappingPreset: preset.json.preset })
  assert.equal(run.status, 200, run.text)
  assert.equal(run.json.report.input.mapping, 'preset')
  assert.equal(run.json.report.status, 'PASS')
  // Preset from a wrong joint name is a user error, not a server crash.
  const wrong = await post('/api/preset', { sourceId, targetId: target.id, assignments: { Hips: 'no_such_bone' } })
  assert.equal(wrong.status, 400)
})

test('.bobj by path (default armature) → run with bobj:true writes a .minecraft20.bobj', async () => {
  const target = (await call('/api/targets')).json.targets[0]
  const source = await post('/api/sources', { path: join(bobjDir, 'minecraft-actions.bobj') })
  assert.equal(source.status, 200, source.text)
  assert.equal(source.json.format, 'bobj')
  const run = await post('/api/runs', { sourceId: source.json.sourceId, targetId: target.id, options: { actions: [0, 1], bobj: true, bobjRoot: 'inPlace' } })
  assert.equal(run.status, 200, run.text)
  assert.equal(run.json.report.status, 'PASS')
  assert.equal(run.json.report.minecraft20.status, 'PASS')
  const kinds = new Map<string, string>(run.json.files.map((file: { kind: string; url: string; name: string }) => [file.kind, file.url]))
  assert.ok(kinds.has('bobj'))
  const bobj = await call(kinds.get('bobj')!)
  assert.equal(bobj.status, 200)
  assert.match(bobj.text, /# Animation data/)
  assert.ok(/\.minecraft20\.bobj$/.test(run.json.files.find((file: { kind: string }) => file.kind === 'bobj').name))
})

test('one transfer normalizes exactly 2 of 4 checked Actions into 2 drafts plus one shared pack; shared-only creates no drafts', async () => {
  const library = mkdtempSync(join(tmpdir(), 'w01-picker-transfer-')), priorLibrary = process.env.W01_LIBRARY
  process.env.W01_LIBRARY = library
  try {
    const model = join(characters, readdirSync(characters).find((name) => name.endsWith('.glb'))!)
    const destination = registerLibraryCharacter({ name: 'Đích Picker', rig: 'mixamo65', modelFile: model })
    const target = (await call('/api/targets')).json.targets[0]
    const source = await post('/api/sources', { path: join(bobjDir, 'minecraft-actions.bobj') })
    const inspected = await post('/api/inspect', { sourceId: source.json.sourceId, targetId: target.id, options: {} })
    assert.ok(inspected.json.actions.length >= 4)
    const checked = [inspected.json.actions[1].index, inspected.json.actions[3].index]
    const originalNames = checked.map((index) => inspected.json.actions.find((action: any) => action.index === index).name)
    const run = await post('/api/runs', { sourceId: source.json.sourceId, targetId: target.id, options: { actions: checked, bobj: true, actionNames: { [checked[0]!]: { name: 'Edited Walk', nameVi: 'Đi bộ mới' }, [checked[1]!]: { name: 'Edited Attack', nameVi: 'Tấn công mới' } } } })
    assert.equal(run.status, 200, run.text)
    assert.deepEqual(run.json.manifest.actions.map((action: any) => action.sourceActionIndex), checked)
    assert.deepEqual(run.json.manifest.actions.map((action: any) => [action.name, action.sourceName, action.nameVi]), [['Edited Walk', originalNames[0], 'Đi bộ mới'], ['Edited Attack', originalNames[1], 'Tấn công mới']])
    const glbFile = run.json.files.find((file: any) => file.kind === 'glb')
    const glbResponse = await fetch(bench.url + glbFile.url); const glbJson = decodeGlb(new Uint8Array(await glbResponse.arrayBuffer())).json
    assert.deepEqual(glbJson.animations.map((animation: any) => animation.name), ['Edited Walk', 'Edited Attack'])
    const bobjFile = run.json.files.find((file: any) => file.kind === 'bobj')
    const bobjResponse = await call(bobjFile.url)
    assert.match(bobjResponse.text, /an Edited Walk/); assert.match(bobjResponse.text, /an Edited Attack/)
    const shared = await post(`/api/runs/${run.json.runId}/library`, {})
    assert.equal(shared.status, 200, shared.text); assert.equal(shared.json.actions, 2)
    const drafts = await post(`/api/runs/${run.json.runId}/character-library`, { charIds: [destination.charId], actions: run.json.manifest.actions.map((action: any) => ({ uuid: action.uuid, key: 'idle' })) })
    assert.equal(drafts.status, 200, drafts.text); assert.equal(drafts.json.drafts.length, 2)
    assert.equal(listCharacterActions({ charId: destination.charId, latestOnly: true }).length, 2)
    assert.deepEqual(run.json.manifest.actions.map((action: any) => getAction({ actionUuid: action.uuid }).sourceName), originalNames)

    const sharedOnlyDestination = registerLibraryCharacter({ name: 'Chỉ kho chung', rig: 'mixamo65', modelFile: model })
    const sharedOnlyRun = await post('/api/runs', { sourceId: source.json.sourceId, targetId: target.id, options: { actions: [0] } })
    const sharedOnly = await post(`/api/runs/${sharedOnlyRun.json.runId}/library`, {})
    assert.equal(sharedOnly.status, 200, sharedOnly.text)
    assert.equal(listCharacterActions({ charId: sharedOnlyDestination.charId, latestOnly: true }).length, 0)
  } finally {
    if (priorLibrary === undefined) delete process.env.W01_LIBRARY
    else process.env.W01_LIBRARY = priorLibrary
    rmSync(library, { recursive: true, force: true })
  }
})

test('a PASS run sends only selected Actions to multiple compatible Mixamo65 and Minecraft20 character folders as tagged drafts', async () => {
  const library = mkdtempSync(join(tmpdir(), 'w01-character-library-'))
  const priorLibrary = process.env.W01_LIBRARY
  process.env.W01_LIBRARY = library
  try {
    const model = join(characters, readdirSync(characters).find((name) => name.endsWith('.glb'))!)
    const first = registerLibraryCharacter({ name: 'Đích Một', rig: 'mixamo65', modelFile: model })
    const second = registerLibraryCharacter({ name: 'Đích Hai', rig: 'mixamo65', modelFile: model })
    const minecraft = registerLibraryCharacter({ name: 'Đích Minecraft', rig: 'minecraft20', modelFile: join(bobjDir, 'minecraft20-armature.bobj') })
    const listed = await call('/api/library/characters')
    assert.equal(listed.status, 200, listed.text)
    assert.deepEqual(listed.json.characters.filter((item: any) => [first.charId, second.charId].includes(item.charId)).map((item: any) => item.counts), [
      { draft: 0, edited: 0, approved: 0 }, { draft: 0, edited: 0, approved: 0 },
    ])

    const target = (await call('/api/targets')).json.targets[0]
    const source = await post('/api/sources', { path: join(bobjDir, 'minecraft-actions.bobj') })
    const run = await post('/api/runs', { sourceId: source.json.sourceId, targetId: target.id, options: { actions: [0, [...parseBobjActions(readFileSync(join(bobjDir, 'minecraft-actions.bobj'), 'utf8')).keys()].indexOf('running')], bobj: true } })
    assert.equal(run.status, 200, run.text)
    const rawImport = await post(`/api/runs/${run.json.runId}/library`, { tags: ['legacy'] })
    assert.equal(rawImport.status, 200, rawImport.text)
    const selected = run.json.manifest.actions[1]
    const sent = await post(`/api/runs/${run.json.runId}/character-library`, {
      charIds: [first.charId, second.charId, minecraft.charId], actions: [{ uuid: selected.uuid, key: 'walk' }],
    })
    assert.equal(sent.status, 200, sent.text)
    assert.equal(sent.json.drafts.length, 3)
    for (const character of [first, second, minecraft]) {
      const drafts = listCharacterActions({ charId: character.charId, latestOnly: true })
      assert.equal(drafts.length, 1)
      assert.equal(drafts[0]!.status, 'draft')
      assert.deepEqual(drafts[0]!.tags, ['legacy', 'walk'])
      if (character.rig === 'mixamo65') assert.equal(drafts[0]!.parentUuid, selected.uuid)
      else assert.match(drafts[0]!.parentUuid!, /^[0-9a-f-]{36}$/)
      assert.ok(existsSync(join(library, 'packs', drafts[0]!.packId, 'anim.glb')))
      if (character.rig === 'minecraft20') {
        const draftPath = join(library, 'packs', drafts[0]!.packId), bobjPath = join(draftPath, 'anim.bobj')
        assert.ok(existsSync(bobjPath))
        const glb = await loadAsset(readFileSync(join(draftPath, 'anim.glb')), 'glb', { skeletonOnly: true })
        const bobj = loadBobj(readFileSync(bobjPath, 'utf8'), readFileSync(join(bobjDir, 'minecraft20-armature.bobj'), 'utf8'))
        const glbBones = new Map<string, any>(), bobjBones = new Map<string, any>()
        glb.traverse((object: any) => { if (object.isBone) glbBones.set(object.name, object) }); bobj.traverse((object: any) => { if (object.isBone) bobjBones.set(object.name, object) })
        assert.equal(glbBones.size, 20); assert.equal(bobjBones.size, 20)
        const clip = glb.animations[drafts[0]!.glbAnimationIndex], reference = bobj.animations[0]!
        assert.ok(clip && reference && clip.name === reference.name)
        const a = new AnimationMixer(glb), b = new AnimationMixer(bobj), aa = a.clipAction(clip), bb = b.clipAction(reference)
        aa.clampWhenFinished = true; bb.clampWhenFinished = true
        aa.setLoop(LoopOnce, 1).play(); bb.setLoop(LoopOnce, 1).play()
        const armature = parseBobjArmature(readFileSync(join(bobjDir, 'minecraft20-armature.bobj'), 'utf8')), action = [...parseBobjActions(readFileSync(bobjPath, 'utf8')).values()][0]!
        let maxEndpointError = 0
        for (const time of [0, clip.duration / 2, clip.duration]) {
          a.setTime(time); b.setTime(time); glb.updateMatrixWorld(true); bobj.updateMatrixWorld(true)
          const evaluated = new Map(evaluateBobjAction(armature, action, time * 20).map((bone) => [bone.name.replace(/\./g, '_'), bone.worldMatrix]))
          for (const [name, bone] of glbBones) maxEndpointError = Math.max(maxEndpointError,
            new Vector3().setFromMatrixPosition(bone.matrixWorld).distanceTo(new Vector3().fromArray(evaluated.get(name)!.slice(12, 15))))
        }
        assert.ok(maxEndpointError <= 1e-4, `Minecraft20 GLB vs evaluateBobjAction endpoints ${maxEndpointError}`)
        const raw = getAction({ actionUuid: drafts[0]!.parentUuid! }), report = JSON.parse(readFileSync(join(library, 'packs', raw.packId, 'anim.report.json'), 'utf8'))
        assert.equal(report.serializerRoundTrip.status, 'PASS'); assert.equal(report.serializerRoundTrip.joints, 20)
        assert.ok(report.serializerRoundTrip.sampledEndpoints >= 3)
        console.info('MC20 running serialized evaluator measurement', JSON.stringify({ maxEndpointError, ...report.serializerRoundTrip }))
      }
    }
    const updatedCounts = (await call('/api/library/characters')).json.characters.filter((item: any) => [first.charId, second.charId, minecraft.charId].includes(item.charId))
    assert.ok(updatedCounts.every((item: any) => item.counts.draft === 1 && item.counts.edited === 0 && item.counts.approved === 0))
    assert.equal((await post(`/api/runs/${run.json.runId}/character-library`, { charIds: [], actions: [{ uuid: selected.uuid, key: 'walk' }] })).status, 400)
  } finally {
    if (priorLibrary === undefined) delete process.env.W01_LIBRARY
    else process.env.W01_LIBRARY = priorLibrary
    rmSync(library, { recursive: true, force: true })
  }
})

test('selected Action is rebuilt against each Verity destination base without leaking other new Actions', async () => {
  const library = mkdtempSync(join(tmpdir(), 'w01-verity-library-')), fixtures = mkdtempSync(join(tmpdir(), 'w01-verity-models-'))
  const priorLibrary = process.env.W01_LIBRARY
  process.env.W01_LIBRARY = library
  try {
    const path84 = join(fixtures, 'verity84.bobj'), path101 = join(fixtures, 'verity101.bobj')
    const source84 = syntheticVerity(13, 1), source101 = syntheticVerity(29, 2)
    writeFileSync(path84, source84); writeFileSync(path101, source101)
    const base84 = registerBaseModel({ name: 'Verity 84', rig: 'verity', modelFile: path84 })
    const base101 = registerBaseModel({ name: 'Verity 101', rig: 'verity', modelFile: path101 })
    const char84 = createCharacter({ name: 'Gỗ 84', baseModelId: base84.modelId })
    const char101 = createCharacter({ name: 'Cánh 101', baseModelId: base101.modelId })
    const mixamoOriginal = registerLibraryCharacter({ name: 'Mixamo65 with original rig', rig: 'mixamo65', modelFile: join(characters, readdirSync(characters).find((name) => name.endsWith('.glb'))!) })
    const originalDir = join(resolveLibraryPath(), 'characters', mixamoOriginal.charId, 'original')
    mkdirSync(originalDir, { recursive: true }); copyFileSync(path84, join(originalDir, 'model.bbs.bobj'))
    const custom = registerLibraryCharacter({ name: 'Sai rig', rig: 'custom', modelFile: join(characters, readdirSync(characters).find((name) => name.endsWith('.glb'))!) })
    const target = (await call('/api/targets')).json.targets[0]
    const source = await post('/api/sources', { path: join(bobjDir, 'minecraft-actions.bobj') })
    const run = await post('/api/runs', { sourceId: source.json.sourceId, targetId: target.id, options: { actions: [0, 1] } })
    assert.equal(run.status, 200, run.text)
    const selected = run.json.manifest.actions[0]
    const rejected = await post(`/api/runs/${run.json.runId}/character-library`, { charIds: [char84.charId, custom.charId], actions: [{ uuid: selected.uuid, key: 'walk' }] })
    assert.equal(rejected.status, 409, rejected.text)
    assert.equal(listCharacterActions({ charId: char84.charId }).length, 0, 'prevalidation prevents a partial valid-character draft')

    const sent = await post(`/api/runs/${run.json.runId}/character-library`, { charIds: [char84.charId, char101.charId], actions: [{ uuid: selected.uuid, key: 'walk' }] })
    assert.equal(sent.status, 200, sent.text); assert.equal(sent.json.drafts.length, 2)
    for (const [character, original, bones, wings] of [[char84, source84, 84, 1], [char101, source101, 101, 2]] as const) {
      const draft = listCharacterActions({ charId: character.charId, latestOnly: true })[0]!
      const pack = join(library, 'packs', draft.packId), bobj = readFileSync(join(pack, 'anim.original.bbs.bobj'), 'utf8')
      assert.equal(bobj.slice(0, original.length), original, 'destination-specific original prefix is byte-preserved')
      assert.equal(parseBobjArmature(bobj).bones.length, bones)
      assert.equal(parseBobjArmature(bobj).bones.filter((bone) => bone.name.startsWith('Wing')).length, wings)
      const actions = [...parseBobjActions(bobj).keys()]
      assert.deepEqual(actions.slice(0, 8), ['idle', 'crouching', 'crouching_idle', 'dead', 'dying', 'running', 'sprinting', 'swipe'])
      assert.equal(actions.length, 9, 'eight built-ins plus only the one selected new Action')
      const glb = decodeGlb(readFileSync(join(pack, 'anim.original.glb'))).json
      assert.equal(glb.skins[0].joints.length, bones)
      assert.equal(glb.animations.length, 9)
      assert.equal(glb.animations.at(-1).name, actions.at(-1))
    }
    const mixamoRigSent = await post(`/api/runs/${run.json.runId}/character-library`, { charIds: [mixamoOriginal.charId], actions: [{ uuid: selected.uuid, key: 'walk' }] })
    assert.equal(mixamoRigSent.status, 200, mixamoRigSent.text)
    const mixamoDraft = listCharacterActions({ charId: mixamoOriginal.charId, latestOnly: true })[0]!
    assert.ok(existsSync(join(library, 'packs', mixamoDraft.packId, 'anim.original.bbs.bobj')), 'original BOBJ is attached based on file presence even with rig=mixamo65')
  } finally {
    if (priorLibrary === undefined) delete process.env.W01_LIBRARY
    else process.env.W01_LIBRARY = priorLibrary
    rmSync(library, { recursive: true, force: true }); rmSync(fixtures, { recursive: true, force: true })
  }
})

test('invalid options come back as a readable 400, a blocked source as a normal BLOCKED result', async () => {
  const target = (await call('/api/targets')).json.targets[0]
  const source = await post('/api/sources', { path: join(bobjDir, 'minecraft-actions.bobj') })
  const bad = await post('/api/runs', { sourceId: source.json.sourceId, targetId: target.id, options: { rootPolicy: 'sideways' } })
  assert.equal(bad.status, 400)
  assert.match(bad.json.error, /rootPolicy/)
  const noTarget = await post('/api/runs', { sourceId: source.json.sourceId, targetId: 'zzz', options: {} })
  assert.equal(noTarget.status, 404)
  const outOfRange = await post('/api/runs', { sourceId: source.json.sourceId, targetId: target.id, options: { actions: [9999] } })
  assert.equal(outOfRange.status, 200)
  assert.equal(outOfRange.json.report.status, 'BLOCKED')
  assert.equal(outOfRange.json.report.blocker.code, 'NO_ACTION')
})

test('model mode through the API embeds the mesh (manifest glb.mode = model)', { skip: haveXbot ? false : 'C:/w01-samples/Xbot.glb not present' }, async () => {
  const target = (await call('/api/targets')).json.targets[0]
  const { sourceId } = (await post('/api/sources', { path: xbot })).json
  const run = await post('/api/runs', { sourceId, targetId: target.id, options: { actions: [0], mode: 'model' } })
  assert.equal(run.status, 200, run.text)
  assert.equal(run.json.report.status, 'PASS')
  assert.equal(run.json.manifest.glb.mode, 'model')
  assert.ok(run.json.report.model.vertices > 0)
})

const seaGiant = 'C:/Users/Administrator/wow.export/creatures/SeaGiant.gltf'
test('.gltf with external .bin is served to the viewer as one GLB', { skip: existsSync(seaGiant) ? false : 'SeaGiant.gltf not present' }, async () => {
  const { json } = await post('/api/sources', { path: seaGiant })
  const response = await fetch(`${bench.url}/api/sources/${json.sourceId}/file`)
  assert.equal(response.status, 200)
  assert.equal(Buffer.from(await response.arrayBuffer()).subarray(0, 4).toString('latin1'), 'glTF')
})
