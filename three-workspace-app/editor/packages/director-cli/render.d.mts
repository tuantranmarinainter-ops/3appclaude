interface RenderFile {
  frame: number
  path: string
  mimeType: 'image/png'
  sizeBytes: number
  sha256: string
}

interface RenderImage {
  path: string
  mimeType: 'image/png'
  sizeBytes: number
  sha256: string
}

interface RenderResult {
  outputDir: string
  manifest: string
  cameraNodeId?: string
  sceneSequence?: string
  frames: RenderFile[]
  contactSheet: RenderImage
  blank: boolean
  blockedRequests: string[]
  warnings: string[]
  renderer: {
    kind: 'gpu' | 'cpu'
    name: string
    raw: string
  }
}

export function renderFrames(body: {
  document: unknown
  fcurves?: unknown
  frames?: number[]
  width?: number
  height?: number
  cameraNodeId?: string
  sceneSequence?: string
  outputDir: string
  localAssets?: Record<string, string>
}, options?: { signal?: AbortSignal; onProgress?: (completed: number, total: number) => void | Promise<void> }): Promise<RenderResult>
