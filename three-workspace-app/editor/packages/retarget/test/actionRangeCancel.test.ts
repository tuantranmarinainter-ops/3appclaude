import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { createThreeRigAdapter } from '../src/threeRigAdapter.ts'
import { loadAsset } from '../cli/loadAsset.ts'
import { startWorkbench } from '../workbench/server.ts'
import { describeSource, parseOptions, runPipeline, sha256 } from '../workbench/pipeline.ts'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const sourcePath = join(root, 'apps/studio/public/retarget/v9.12/minecraft-actions.bobj')
const targetPath = resolve(root, '../builtin-assets/characters/a3d_char_30ec53c93eae4173946b38639691ebe0.glb')
const source = describeSource(sourcePath, 'actions.bobj', false, 'test')
const target = { id: 'test', file: 'target.glb', path: targetPath, sha256: sha256(readFileSync(targetPath)), hipsHeightMeters: 1 }
const options = parseOptions({ actions: [0], ground: 'off' })

test('CLI --range exports the selected duration and starts at the source range pose', async () => {
 const dir = mkdtempSync(join(tmpdir(), 'w01-range-'))
 try {
  const full = await runPipeline(source, target, options, null, undefined, dir, () => {})
  assert.equal(full.status, 'PASS')
  const fullBytes = readFileSync(join(dir, 'actions.glb'))
  const duration = (full.manifest as any).actions[0].durationSeconds
  const start = duration / 4, end = duration * 3 / 4
  const cli = spawnSync(process.execPath, ['--import', 'tsx', '../retarget/cli/normalize.ts', '--src', sourcePath, '--target', targetPath, '--out', dir, '--action', '0', '--ground', 'off', '--armature', join(root, 'apps/studio/public/retarget/v9.12/minecraft20-armature.bobj'), '--range', `${start}:${end}`], { cwd: join(root, 'packages/builder'), encoding: 'utf8' })
  assert.equal(cli.status, 0, cli.stderr + cli.stdout)
  const stem = 'minecraft-actions'
  const manifest = JSON.parse(readFileSync(join(dir, `${stem}.manifest.json`), 'utf8'))
  assert.ok(Math.abs(manifest.actions[0].durationSeconds - (end-start)) < 1e-6)
  const fullRig = createThreeRigAdapter(await loadAsset(fullBytes, 'glb'), { fingerprint: 'full' })
  const cutRig = createThreeRigAdapter(await loadAsset(readFileSync(join(dir, `${stem}.glb`)), 'glb'), { fingerprint: 'cut' })
  try {
   const expected = fullRig.sample(0, start), actual = cutRig.sample(0, 0)
   assert.equal(expected.length, actual.length)
   for (let i=0;i<expected.length;i++) for(let j=0;j<16;j++) assert.ok(Math.abs(expected[i]!.world[j]! - actual[i]!.world[j]!) < 1e-4, `${i}:${j}`)
  } finally { fullRig.dispose(); cutRig.dispose() }
 } finally { rmSync(dir, { recursive:true, force:true }) }
})

test('AbortSignal during bake and before commit leaves no staged outputs', async () => {
 for (const stage of ['bake', 'commit']) {
  const dir = mkdtempSync(join(tmpdir(), 'w01-abort-')), controller = new AbortController()
  try {
   await assert.rejects(runPipeline(source, target, options, null, undefined, dir, (current) => { if(current === stage) controller.abort() }, controller.signal), { name: 'AbortError' })
   assert.deepEqual(readdirSync(dir), [])
  } finally { rmSync(dir, { recursive:true, force:true }) }
 }
})

test('Workbench cancel reaches CANCELLED, removes output directory, and accepts a new run', async () => {
 const bench = await startWorkbench({ port:0 })
 const post = async (path:string, body:unknown={}) => (await fetch(bench.url+path, {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)})).json() as Promise<any>
 try {
  const { targets } = await (await fetch(bench.url+'/api/targets')).json()
  const { sourceId } = await post('/api/sources', {path:sourcePath})
  const run = await post('/api/runs', {sourceId,targetId:targets[0].id,options:{preview:true},wait:false})
  await post(`/api/runs/${run.runId}/cancel`)
  let state:any
  for(let i=0;i<200;i++) { state=await (await fetch(`${bench.url}/api/runs/${run.runId}`)).json(); if(state.state!=='running') break; await new Promise(r=>setTimeout(r,10)) }
  assert.equal(state.state, 'CANCELLED'); assert.equal(state.result, undefined)
  assert.ok(!readdirSync(join(bench.sessionDir,'runs')).includes(run.runId))
  const next = await post('/api/runs', {sourceId,targetId:targets[0].id,options:{actions:[0],actionRanges:{0:[0,0.1]} }})
  assert.equal(next.status,'PASS'); assert.ok(Math.abs(next.manifest.actions[0].durationSeconds-0.1)<1e-6)
 } finally { await bench.close() }
})

test('ranges reject malformed, negative, empty and reversed intervals', () => {
 for(const range of [[-1,1],[1,1],[2,1],[0,Infinity],['0',1]]) assert.throws(()=>parseOptions({actionRanges:{0:range}}), /actionRanges/)
})
