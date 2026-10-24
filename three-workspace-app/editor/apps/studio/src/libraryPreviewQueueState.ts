export type PreviewQueueJob = { uuid: string; state: 'queued' | 'running' | 'complete' | 'failed'; message?: string; renderer?: string }

export type PreviewQueueState = {
  jobs: Map<string, PreviewQueueJob>
  active: boolean
  appOrigin: string
}

/** Keep background preview work alive when Next dev replaces this module. */
export function getPreviewQueueState(): PreviewQueueState {
  const host = globalThis as typeof globalThis & { __topviewLibraryPreviewQueueState?: PreviewQueueState }
  return host.__topviewLibraryPreviewQueueState ??= { jobs: new Map(), active: false, appOrigin: '' }
}
