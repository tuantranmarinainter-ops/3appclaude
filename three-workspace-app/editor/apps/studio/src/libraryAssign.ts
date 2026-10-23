import { randomUUID } from 'node:crypto'

// Keep the Node-only App 1 pipeline inside the server bundle without making the Studio
// TypeScript project compile the CLI's .ts-suffix import graph as part of its own app.
interface AssignActionResult { actionUuid: string; status: 'ok' | 'already-exists' | 'error'; assignedUuid?: string; name?: string; reason?: string }
const { assignToCharacter } = require('../../../packages/retarget/cli/assignToCharacter') as {
  assignToCharacter(options: { actionUuids: string[]; charId: string; createNew?: boolean; signal?: AbortSignal; onProgress?: (completed: number, total: number) => void }): Promise<AssignActionResult[]>
}

export type LibraryAssignJobStatus = 'queued' | 'running' | 'completed' | 'cancelled'
export interface LibraryAssignJob {
  jobId: string
  charId: string
  actionUuids: string[]
  createNew?: boolean
  status: LibraryAssignJobStatus
  completed: number
  total: number
  results: AssignActionResult[]
  error?: string
}
interface StoredJob { state: LibraryAssignJob; controller: AbortController }

const jobs = new Map<string, StoredJob>()
const queue: string[] = []
let active = false

function snapshot(job: StoredJob): LibraryAssignJob { return structuredClone(job.state) }

async function drain() {
  if (active) return
  active = true
  try {
    while (queue.length) {
      const id = queue.shift()!, job = jobs.get(id)
      if (!job || job.state.status !== 'queued') continue
      job.state.status = 'running'
      try {
        job.state.results = await assignToCharacter({ actionUuids: job.state.actionUuids, charId: job.state.charId, createNew: job.state.createNew, signal: job.controller.signal,
          onProgress: (completed) => { job.state.completed = completed } })
        job.state.status = job.controller.signal.aborted ? 'cancelled' : 'completed'
      } catch (error) {
        job.state.status = job.controller.signal.aborted ? 'cancelled' : 'completed'
        job.state.error = error instanceof Error ? error.message : String(error)
      }
    }
  } finally { active = false }
}

export function createLibraryAssignJob(input: { actionUuids: string[]; charId: string; createNew?: boolean }): LibraryAssignJob {
  const actionUuids = [...new Set(input.actionUuids)]
  if (!actionUuids.length || actionUuids.length > 200 || actionUuids.some((uuid) => typeof uuid !== 'string')) throw new TypeError('actionUuids must contain 1–200 action UUIDs')
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(input.charId)) throw new TypeError('Invalid charId')
  if (input.createNew !== undefined && typeof input.createNew !== 'boolean') throw new TypeError('createNew must be a boolean')
  const jobId = randomUUID(), job: StoredJob = { state: { jobId, charId: input.charId, actionUuids, createNew: input.createNew, status: 'queued', completed: 0, total: actionUuids.length, results: [] }, controller: new AbortController() }
  jobs.set(jobId, job); queue.push(jobId); void drain()
  return snapshot(job)
}

export function getLibraryAssignJob(jobId: string): LibraryAssignJob | null {
  const job = jobs.get(jobId)
  return job ? snapshot(job) : null
}

export function cancelLibraryAssignJob(jobId: string): LibraryAssignJob | null {
  const job = jobs.get(jobId)
  if (!job) return null
  if (job.state.status === 'queued' || job.state.status === 'running') {
    job.controller.abort()
    if (job.state.status === 'queued') job.state.status = 'cancelled'
  }
  return snapshot(job)
}
