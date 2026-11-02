import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createHeightProfileCache } from '../app/workbench/components/character-height/utils'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

test('height profiles coalesce in-flight loads, cache by fingerprint, and never refresh on their own', async () => {
  let calls = 0
  const result = deferred<number>()
  const cache = createHeightProfileCache(async () => { calls++; return result.promise })
  const profile = { charId: 'hero', fingerprint: 'model-A:1.8' }
  const first = cache.read(profile)
  assert.equal(cache.read(profile), first)
  result.resolve(1.8)
  assert.equal(await first, 1.8)
  assert.equal(await cache.read(profile), 1.8)
  await new Promise(resolve => setTimeout(resolve, 30))
  assert.equal(calls, 1)
  await cache.read({ ...profile, fingerprint: 'model-B:1.8' })
  assert.equal(calls, 2)
})

test('explicit invalidation replaces only the affected character and stale responses cannot repopulate it', async () => {
  const old = deferred<number>()
  const fresh = deferred<number>()
  let heroLoads = 0
  const cache = createHeightProfileCache(async id => id === 'hero' ? (++heroLoads === 1 ? old.promise : fresh.promise) : 3.6)
  const hero = { charId: 'hero', fingerprint: 'model-A:1.8' }
  const verity = { charId: 'verity', fingerprint: 'model-V:3.6' }
  const stale = cache.read(hero)
  const retained = cache.read(verity)
  await Promise.resolve()
  cache.invalidate('hero')
  const replacement = cache.read(hero)
  assert.notEqual(stale, replacement)
  assert.equal(cache.read(verity), retained)
  fresh.resolve(2.1)
  assert.equal(await replacement, 2.1)
  old.resolve(1.8)
  await stale
  assert.equal(await cache.read(hero), 2.1)
  assert.equal(heroLoads, 2)
})

test('failed requests are retryable and cannot evict a newer invalidated request', async () => {
  const failure = deferred<number>()
  let calls = 0
  const cache = createHeightProfileCache(async () => ++calls === 1 ? failure.promise : 2.2)
  const profile = { charId: 'hero', fingerprint: 'A' }
  const first = cache.read(profile)
  await Promise.resolve()
  cache.invalidate('hero')
  const replacement = cache.read(profile)
  failure.reject(new Error('offline'))
  await assert.rejects(first, /offline/)
  assert.equal(await replacement, 2.2)
  assert.equal(cache.read(profile), replacement)
  assert.equal(calls, 2)
})
