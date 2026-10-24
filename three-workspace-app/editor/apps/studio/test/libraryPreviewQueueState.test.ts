import assert from 'node:assert/strict'
import test from 'node:test'
import { getPreviewQueueState } from '../src/libraryPreviewQueueState'

test('preview jobs and the active drain lock survive a module reload in Next dev', () => {
  const host = globalThis as typeof globalThis & { __topviewLibraryPreviewQueueState?: ReturnType<typeof getPreviewQueueState> }
  const previous = host.__topviewLibraryPreviewQueueState
  try {
    delete host.__topviewLibraryPreviewQueueState
    const firstModuleState = getPreviewQueueState()
    firstModuleState.jobs.set('queued-action', { uuid: 'queued-action', state: 'queued' })
    firstModuleState.active = true

    // A re-evaluated Next route module calls the same global state initializer.
    const reloadedModuleState = getPreviewQueueState()
    assert.strictEqual(reloadedModuleState, firstModuleState)
    assert.equal(reloadedModuleState.jobs.get('queued-action')?.state, 'queued')
    assert.equal(reloadedModuleState.active, true)
  } finally {
    if (previous) host.__topviewLibraryPreviewQueueState = previous
    else delete host.__topviewLibraryPreviewQueueState
  }
})
