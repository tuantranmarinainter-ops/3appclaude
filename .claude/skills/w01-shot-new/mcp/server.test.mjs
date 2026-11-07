import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const PID = 'proj-1'
const fixture = () => ({
  revision: 7,
  scene: { content: {
    nodes: [{ id: 'n_hero', type: 'character', name: 'Hero' }, { id: 'camera_1', type: 'camera', name: 'Cam' }],
    timeline: { frameEnd: 300, animation: { cameraMotionClips: [], pathMotionClips: [], motionClips: [
      { id: 'clip_a', frameStart: 0, frameEnd: 50, target: { nodeId: 'n_hero' }, motion: { name: 'Idle' }, playback: { speed: 1, loop: true } },
      { id: 'clip_b', frameStart: 50, frameEnd: 100, target: { nodeId: 'n_hero' }, motion: { name: 'Punch' }, playback: { speed: 1.5 } },
    ] } },
  } },
  bindings: { clip_b: { rootPolicy: 'in-place' } },
  assets: {},
  extensions: {
    topview: { fcurves: { version: 1, encoding: 'compact-v1', fcurves: [{ id: 'fc1', t: ['node', 'n_hero'], p: 'transform.position', i: 1, k: [[0, 0, 'linear', 'k0'], [40, 1, 'linear', 'k1']] }] } },
    vfxCues: { version: 1, cues: [{ id: 'cue1', effect: 'bonk', frameStart: 10, frameEnd: 30, position: { x: 0, y: 1, z: 0 }, yaw: 0, scale: 1 }] },
  },
})

let server, port, posts = [], tmp, shotFile, child, nextId = 1, buf = '', waiters = new Map()

before(async () => {
  server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (d) => (body += d))
    req.on('end', () => {
      if (req.url === '/api/unified/session') { res.setHeader('set-cookie', 'sid=abc; Path=/'); return res.end('{}') }
      if (req.url === `/api/unified/projects/${PID}`) { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ project: fixture() })) }
      if (req.url === '/api/unified/commands') { const b = JSON.parse(body); posts.push(b); res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ revision: 7 + posts.length, result: {} })) }
      res.statusCode = 404; res.end('{}')
    })
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  port = server.address().port
  tmp = mkdtempSync(path.join(os.tmpdir(), 'w01mcp-'))
  shotFile = path.join(tmp, 'shot.json')
  writeFileSync(shotFile, JSON.stringify({ project: PID, api: `http://127.0.0.1:${port}`, work: tmp, end: 300, chars: { hero: { node: 'n_hero', char: 'chr1' } } }))
  writeFileSync(path.join(tmp, 'clips.json'), JSON.stringify({ heroIdle: 'clip_a', heroPunch: 'clip_b' }))
  child = spawn(process.execPath, [path.join(here, 'server.mjs')], { stdio: ['pipe', 'pipe', 'inherit'] })
  child.stdout.on('data', (d) => {
    buf += d
    let i
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1)
      const m = JSON.parse(line)
      waiters.get(m.id)?.(m); waiters.delete(m.id)
    }
  })
})
after(() => { child?.kill(); server?.close() })

const rpc = (method, params) => new Promise((resolve) => {
  const id = nextId++
  waiters.set(id, resolve)
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
})
const call = async (name, args) => { const r = await rpc('tools/call', { name, arguments: args }); return r.result }
const text = (r) => r.content[0].text

test('initialize + tools/list + unknown method', async () => {
  const init = await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '0' } })
  assert.equal(init.result.protocolVersion, '2025-03-26')
  assert.equal(init.result.serverInfo.name, 'w01-shot')
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n')
  const list = await rpc('tools/list', {})
  const names = list.result.tools.map((t) => t.name)
  for (const n of ['shot_read', 'shot_edit', 'shot_undo', 'shot_build']) assert.ok(names.includes(n), n)
  assert.equal((await rpc('nope', {})).error.code, -32601)
  assert.deepEqual((await rpc('ping', {})).result, {})
})

test('bad call returns isError', async () => {
  const r = await call('shot_read', { shot: path.join(tmp, 'missing'), what: 'clips' })
  assert.equal(r.isError, true)
  assert.match(text(r), /^ERROR:/)
  assert.equal((await call('no_such_tool', {})).isError, true)
})

test('shot_read tables', async () => {
  const s = text(await call('shot_read', { shot: shotFile, what: 'summary' }))
  assert.match(s, /revision 7/); assert.match(s, /end frame 300/)
  const c = text(await call('shot_read', { shot: shotFile, what: 'clips' }))
  assert.match(c, /heroPunch\s+hero\s+50-100\s+x1\.5.*in-place\s+Punch/)
  assert.match(text(await call('shot_read', { shot: shotFile, what: 'clips', frames: [60, 70] })), /heroPunch/)
  assert.ok(!/heroIdle/.test(text(await call('shot_read', { shot: shotFile, what: 'clips', frames: [60, 70] }))))
  assert.match(text(await call('shot_read', { shot: shotFile, what: 'keys', char: 'hero' })), /hero position\.y\s+2 keys\s+0,40\s+0\.\.1/)
  assert.match(text(await call('shot_read', { shot: shotFile, what: 'cues' })), /cue1\s+vfx\s+bonk\s+10-30/)
  assert.match(text(await call('shot_read', { shot: shotFile, what: 'cast' })), /hero\s+n_hero\s+chr1\s+Hero/)
})

test('shot_edit: 2 scene ops -> exactly one scene.apply', async () => {
  posts = []
  const r = await call('shot_edit', { shot: shotFile, ops: [
    { op: 'moveClip', clip: 'heroPunch', start: 60 },
    { op: 'setKeys', node: 'hero', channel: 'position.y', keys: [[20, 0.5]] },
  ] })
  assert.ok(!r.isError, text(r))
  assert.equal(posts.length, 1)
  assert.equal(posts[0].command, 'scene.apply')
  assert.equal(posts[0].expectedRevision, 7)
  const op = posts[0].args.operations[0]
  assert.equal(op.type, 'document.replace')
  const moved = op.document.content.timeline.animation.motionClips.find((c) => c.id === 'clip_b')
  assert.deepEqual([moved.frameStart, moved.frameEnd], [60, 110])
  const ks = op.fcurves.fcurves[0].k
  assert.deepEqual(ks.map((k) => k[0]), [0, 20, 40])
  assert.match(text(r), /^rev 7 -> 8/)
})

test('shot_edit: cue ops go as separate commands after scene.apply', async () => {
  posts = []
  const r = await call('shot_edit', { shot: shotFile, ops: [
    { op: 'setClip', clip: 'clip_a', end: 60 },
    { op: 'addCue', kind: 'vfx', effect: 'spark', start: 5, end: 20, pos: [0, 1, 0] },
    { op: 'removeCue', id: 'cue1' },
  ] })
  assert.ok(!r.isError, text(r))
  assert.deepEqual(posts.map((p) => p.command), ['scene.apply', 'vfx.cue.add', 'vfx.cue.remove'])
  assert.equal(posts[1].args.cue.frameStart, 5)
  assert.deepEqual(posts[2].args, { id: 'cue1' })
})

test('shot_edit: validation error sends nothing', async () => {
  posts = []
  for (const ops of [
    [{ op: 'moveClip', clip: 'heroPunch', start: 60 }, { op: 'bogus' }],
    [{ op: 'moveClip', clip: 'nope', start: 60 }],
    [{ op: 'setKeys', node: 'hero', channel: 'position.w', keys: [[1, 2]] }],
  ]) {
    const r = await call('shot_edit', { shot: shotFile, ops })
    assert.equal(r.isError, true)
  }
  assert.equal(posts.length, 0)
})

test('shot_edit: dryRun sends nothing', async () => {
  posts = []
  const r = await call('shot_edit', { shot: shotFile, dryRun: true, ops: [{ op: 'removeClip', clip: 'heroPunch' }, { op: 'addCue', kind: 'vfx', effect: 'x', start: 1, end: 9 }] })
  assert.ok(!r.isError, text(r))
  assert.match(text(r), /DRY RUN/); assert.match(text(r), /would removeClip/)
  assert.equal(posts.length, 0)
})

test('shot_undo sends history.undo', async () => {
  posts = []
  const r = await call('shot_undo', { shot: shotFile })
  assert.ok(!r.isError, text(r))
  assert.deepEqual(posts.map((p) => p.command), ['history.undo'])
})

test('refuses real ports', async () => {
  const f = path.join(tmp, 'real.json')
  writeFileSync(f, JSON.stringify({ project: PID, api: 'http://127.0.0.1:3016', work: tmp }))
  const r = await call('shot_read', { shot: f, what: 'summary' })
  assert.equal(r.isError, true)
})
