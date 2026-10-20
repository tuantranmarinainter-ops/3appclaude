export type SceneCheck = 'grounding' | 'overlap' | 'frustum'

export interface SceneCheckInput {
  document: any
  frame: number
  checks: SceneCheck[]
  cameraNodeId?: string
  fcurves?: unknown
  localAssets?: Record<string, string>
  transformOverrides?: Record<string, { position: { x: number; y: number; z: number }; rotation: { x: number; y: number; z: number }; scale: { x: number; y: number; z: number } }>
}

export function evaluateSceneChecks(body: SceneCheckInput): Promise<{
  checks: Partial<Record<SceneCheck, any>>
  issues: Array<{ code: string; path: string; message: string }>
  warnings: string[]
  blockedRequests: string[]
}>
