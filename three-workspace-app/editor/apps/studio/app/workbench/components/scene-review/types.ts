import type { SceneReviewStatus } from '../../../../src/sceneReview'

export interface SceneReviewClip {
  id: string
  name: string
  frameStart: number
  frameEnd: number
  frames: number[]
  status: SceneReviewStatus
  note: string
}

export type SceneReviewFilter = 'pending' | 'note' | 'ok' | 'all'
