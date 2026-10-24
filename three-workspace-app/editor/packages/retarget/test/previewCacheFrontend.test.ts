import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

const app = readFileSync(new URL('../workbench/public/app.js', import.meta.url), 'utf8')
const implementation = (name: string) => {
  const match = app.match(new RegExp(`(?:async )?function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?^\\}`, 'm'))
  assert.ok(match, `extract ${name}`)
  return match[0]
}
const cacheBlock = app.slice(app.indexOf('const previewResults ='), app.indexOf('// ---------------------------------------------------------------- batch review list'))
const deferred = () => {
  let resolve!: (value?: any) => void, reject!: (error: Error) => void
  const promise = new Promise<any>((ok, fail) => { resolve = ok; reject = fail })
  return { promise, resolve, reject }
}
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve() }
const plain = (value: any) => JSON.parse(JSON.stringify(value))

function harness() {
  const requests: any[] = [], finishes: any[] = [], preloads: string[] = [], timers = new Map<number, { callback: () => any; delay: number }>()
  const elements = new Map<string, any>()
  let timerId = 0
  const state: any = { source: { sourceId: 'source' }, target: { id: 'target' }, selected: 0, actionRanges: {},
    preset: { joints: { Hips: 'pelvis' } }, presetFamily: 'mixamo', inspect: { actions: [{ index: 0 }, { index: 1 }], mapping: {} },
    batch: {}, batchCurrent: 'row0', reviewRows: [], running: false, run: null }
  const options: any = { mode: 'animation', rootPolicy: 'preserve', rootScale: 1, ground: 'lift', calibrate: 'limbs',
    facingDegrees: 0, swapSides: 'auto', unitMeters: .01, upAxis: 'y', bobj: false, bobjRoot: 'inPlace', adjustments: { speed: 1 } }
  const context: any = {
    structuredClone, viewer: { preloadResult: async (url: string) => { preloads.push(url); return [] } },
    state, options, readOptions: () => structuredClone(options),
    api: (path: string, init: any) => {
      const gate = deferred(); requests.push({ path, init, sent: plain(init?.json ?? {}), ...gate }); return gate.promise
    },
    $: (id: string) => {
      if (!elements.has(id)) elements.set(id, { hidden: true, textContent: '', dataset: {}, classList: { contains: () => false } })
      return elements.get(id)
    },
    setTimeout: (callback: () => any, delay: number) => { timers.set(++timerId, { callback, delay }); return timerId },
    clearTimeout: (id: number) => timers.delete(id),
    sleep: () => new Promise<void>(ok => setImmediate(ok)),
    canRunReason: () => null, runActions: () => [state.selected], setOverlay: () => {}, toast: () => {},
    setProgress: () => {}, refreshSteps: () => {},
    finishRun: async (result: any, opts: any, quiet: boolean) => { finishes.push({ result, options: plain(opts), quiet }) },
  }
  const api = runInNewContext(`let previewTimer = 0, previewSeq = 0;
    ${cacheBlock}
    ${implementation('schedulePreview')}
    ${implementation('runPreview')}
    ${implementation('runNow')}
    ({ schedulePreview, previewPayload, cachedPreview, prefetchNextPreview, runPreview, runNow, previewResults, previewPending })`, context)
  return { ...api, state, options, requests, finishes, timers, preloads, setFinish: (fn: any) => { context.finishRun = fn } }
}

test('preview key covers source, target, mapping/family, range, action and every readOptions field', () => {
  const h = harness(), key = () => JSON.stringify(h.previewPayload(h.state.selected)), initial = key()
  const fields = [...app.matchAll(/get\('([^']+)'\)/g)].map(m => m[1])
  for (const field of Object.keys(h.options)) {
    const old = h.options[field]
    h.options[field] = typeof old === 'boolean' ? !old : typeof old === 'number' ? old + 1 : typeof old === 'object' ? { speed: 2 } : `${old}-changed`
    assert.notEqual(key(), initial, field); h.options[field] = old
  }
  // Guard against readOptions growing beyond the representative options above.
  const read = implementation('readOptions')
  for (const field of fields.filter(f => read.includes(`get('${f}')`))) assert.ok(field in h.options, field)
  for (const mutate of [() => { h.state.source.sourceId += 'x' }, () => { h.state.target.id += 'x' },
    () => { h.state.preset.joints.Hips += 'x' }, () => { h.state.presetFamily += 'x' },
    () => { h.state.actionRanges[0] = [0, .5] }, () => { h.state.selected++ }]) {
    const before = key(); mutate(); assert.notEqual(key(), before)
  }
  const payload = h.previewPayload(1)
  assert.equal(payload.options.review, true); assert.equal(payload.wait, true); assert.equal(payload.options.preview, false)
  assert.deepEqual(plain(payload.options.actions), [1]); assert.equal(payload.options.previewAction, 1)
})

test('same pending key deduplicates; distinct previews serialize; errors retry and do not poison queue', async () => {
  const h = harness(), payload = h.previewPayload(0)
  const first = h.cachedPreview(payload), duplicate = h.cachedPreview(payload), next = h.cachedPreview(h.previewPayload(1))
  assert.equal(first, duplicate)
  await flush(); assert.equal(h.requests.length, 1)
  h.requests[0].resolve({ status: 'PASS', id: 0 }); await first; await flush()
  assert.equal(h.requests.length, 2)
  h.requests[1].reject(Error('offline')); await assert.rejects(next, /offline/)
  const retry = h.cachedPreview(h.previewPayload(1)); await flush()
  h.requests[2].resolve({ status: 'CANCELLED' }); await retry
  const again = h.cachedPreview(h.previewPayload(1)); await flush()
  assert.equal(h.requests.length, 4)
  h.requests[3].resolve({ status: 'PASS' }); await again
  assert.equal(h.previewPending.size, 0)
})

test('completed cache holds 12 LRU entries and promotes hits', async () => {
  const h = harness()
  for (let i = 0; i < 12; i++) {
    const promise = h.cachedPreview(h.previewPayload(i)); await flush()
    h.requests.at(-1).resolve({ status: 'PASS', index: i }); await promise
  }
  await h.cachedPreview(h.previewPayload(0))
  const thirteenth = h.cachedPreview(h.previewPayload(12)); await flush()
  h.requests.at(-1).resolve({ status: 'PASS' }); await thirteenth
  assert.equal(h.previewResults.size, 12)
  assert.ok(h.previewResults.has(JSON.stringify(h.previewPayload(0))))
  assert.ok(!h.previewResults.has(JSON.stringify(h.previewPayload(1))))
})

test('next-row precache waits 90ms, stays in source, and cancels on selection/running changes', async () => {
  const h = harness()
  h.state.reviewRows = [{ key: 'row0', entry: { sourceId: 'source' }, action: { index: 0 } },
    { key: 'row1', entry: { sourceId: 'source' }, action: { index: 1 } }]
  h.prefetchNextPreview(); assert.equal(h.timers.size, 1)
  let timer: any = [...h.timers.values()][0]; assert.equal(timer.delay, 90)
  h.state.batchCurrent = 'row1'; timer.callback(); await flush(); assert.equal(h.requests.length, 0)
  h.state.batchCurrent = 'row0'; h.prefetchNextPreview(); timer = [...h.timers.values()][0]
  h.state.running = true; timer.callback(); await flush(); assert.equal(h.requests.length, 0)
  h.state.running = false; h.prefetchNextPreview(); timer = [...h.timers.values()][0]
  timer.callback(); await flush(); assert.equal(h.requests[0].sent.options.previewAction, 1)
  h.requests[0].resolve({ status: 'PASS' }); await flush()
  h.state.reviewRows[1].entry.sourceId = 'other'; h.prefetchNextPreview(); assert.equal(h.timers.size, 0)
})

test('quiet foreground uses wait=true/preview=false and discards obsolete selection/options', async () => {
  for (const change of [(h: any) => { h.state.selected = 1 }, (h: any) => { h.options.ground = 'off' }, (h: any) => { h.state.runAbort = true }]) {
    const h = harness(), run = h.runNow([0], null, { quiet: true }); await flush()
    assert.equal(h.requests[0].sent.wait, true); assert.equal(h.requests[0].sent.options.preview, false)
    change(h); h.requests[0].resolve({ status: 'PASS' }); await run
    assert.equal(h.finishes.length, 0); assert.equal(h.state.running, false)
  }
})

test('rapid runPreview requests keep only latest selection after current quiet run completes', async () => {
  const h = harness(), first = h.runPreview(); await flush()
  h.state.selected = 1; const middle = h.runPreview()
  h.state.selected = 2; const latest = h.runPreview()
  h.requests[0].resolve({ status: 'PASS', index: 0 }); await first
  await new Promise(ok => setImmediate(ok)); await flush()
  assert.equal(h.requests.length, 2); assert.equal(h.requests[1].sent.options.actions[0], 2)
  h.requests[1].resolve({ status: 'PASS', index: 2 }); await Promise.all([middle, latest])
  assert.deepEqual(h.finishes.map((f: any) => f.result.index), [2])
})

test('normal run awaits background preview queue and retains preview=true/wait=false', async () => {
  const h = harness(), prefetch = h.cachedPreview(h.previewPayload(1)); await flush()
  const normal = h.runNow([0]); await flush(); assert.equal(h.requests.length, 1)
  h.requests[0].resolve({ status: 'PASS' }); await prefetch; await flush()
  assert.equal(h.requests.length, 2); assert.equal(h.requests[1].sent.wait, false)
  assert.equal(h.requests[1].sent.options.preview, true)
  h.requests[1].resolve({ runId: 'normal', state: 'done', result: { status: 'PASS' } }); await normal
  assert.equal(h.finishes.length, 1)
})

test('queued payload stays identical to its cache key after ranges/mapping mutate', async () => {
  const h = harness(), blocking = h.cachedPreview(h.previewPayload(9)); await flush()
  h.state.actionRanges[0] = [0, 1]
  const payload = h.previewPayload(0), original = plain(payload), pending = h.cachedPreview(payload)
  h.state.actionRanges[0][1] = 2; h.state.preset.joints.Hips = 'changed'
  h.requests[0].resolve({ status: 'PASS' }); await blocking; await flush()
  const sent = h.requests[1].sent
  h.requests[1].resolve({ status: 'PASS' }); await pending
  assert.deepEqual(sent, original)
})

test('normal run cannot overlap quiet finishRun while viewer GLB load is pending', async () => {
  const h = harness(), gate = deferred()
  // Same asynchronous boundary as finishRun awaiting viewer.loadResult.
  h.setFinish(async () => gate.promise)
  const quiet = h.runNow([0], null, { quiet: true }); await flush()
  h.requests[0].resolve({ status: 'PASS' }); await flush()
  const normal = h.runNow([0]); await flush()
  const overlap = h.requests.length > 1
  gate.resolve(); await quiet
  await new Promise(ok => setImmediate(ok)); await flush()
  assert.equal(h.requests.length, 2, 'normal starts after quiet finishRun completes')
  h.requests[1].resolve({ state: 'done', result: { status: 'PASS' } })
  await normal
  assert.equal(overlap, false)
})

test('cached selection starts immediately without debounce or another server request', async () => {
  const h = harness(), pending = h.cachedPreview(h.previewPayload(0)); await flush()
  h.requests[0].resolve({ status: 'PASS', index: 0 }); await pending
  h.schedulePreview(70); await flush()
  assert.equal(h.timers.size, 0)
  assert.equal(h.requests.length, 1)
  assert.equal(h.finishes.length, 1)
  assert.equal(h.finishes[0].result.index, 0)
})

test('next-row prefetch warms animation clips only, excluding model and original-skeleton results', async () => {
  for (const [result, expected] of [
    [{ status: 'PASS', files: [{ kind: 'glb', url: '/animation.glb' }], report: {}, manifest: {} }, ['/animation.glb']],
    [{ status: 'PASS', files: [{ kind: 'glb', url: '/model.glb' }], report: { model: {} }, manifest: {} }, []],
    [{ status: 'PASS', files: [{ kind: 'glb', url: '/model.glb' }], report: {}, manifest: { glb: { mode: 'model' } } }, []],
    [{ status: 'PASS', files: [{ kind: 'glb', url: '/canonical.glb' }, { kind: 'originalGlb', url: '/original.glb' }], report: {}, manifest: {} }, []],
  ] as const) {
    const h = harness()
    h.state.reviewRows = [{ key: 'row0', entry: { sourceId: 'source' }, action: { index: 0 } },
      { key: 'row1', entry: { sourceId: 'source' }, action: { index: 1 } }]
    h.prefetchNextPreview()
    const timer: any = [...h.timers.values()][0]; timer.callback(); await flush()
    h.requests[0].resolve(result); await flush()
    assert.deepEqual(h.preloads, expected)
  }
})
