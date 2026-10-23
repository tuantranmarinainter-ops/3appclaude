import assert from 'node:assert/strict'
import test, { after, before } from 'node:test'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { request } from 'node:http'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadAsset } from '../cli/loadAsset.ts'
import { startWorkbench, type Workbench } from '../workbench/server.ts'

const here = dirname(fileURLToPath(import.meta.url))
const bobjDir = resolve(here, '../../../apps/studio/public/retarget/v9.12')
const characters = resolve(here, '../../../../builtin-assets/characters')
const xbot = 'C:/w01-samples/Xbot.glb'
const haveXbot = existsSync(xbot)

let bench: Workbench
before(async () => { bench = await startWorkbench({ port: 0 }) })
after(async () => { await bench.close() })

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
  assert.equal((await call('/app.js')).status, 200)
  assert.equal((await call('/styles.css')).status, 200)
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
