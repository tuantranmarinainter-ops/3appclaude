import type { TutorialStep } from './types'

/** 顶栏教程按钮：新开页并直达「3D Builder」小节。 */
export const TUTORIAL_PAGE_URL = 'https://www.topview.ai/academy/spatial-control'
export const TUTORIAL_PAGE_HASH = '3-1-3d-builder-build-scenes-stage-action-and-move-the-camera'

export const TUTORIAL_CARD_WIDTH = 340
export const TUTORIAL_CARD_MIN_HEIGHT = 168
export const TUTORIAL_CARD_GAP = 14
export const TUTORIAL_VIEW_PAD = 12
export const TUTORIAL_HOLE_PAD = 8

export const TUTORIAL_STEPS: TutorialStep[] = [
  {
    id: 'viewport',
    titleKey: 'tutorial.viewportTitle',
    bodyKey: 'tutorial.viewportBody',
    side: 'bottom',
  },
  {
    id: 'tools',
    titleKey: 'tutorial.toolsTitle',
    bodyKey: 'tutorial.toolsBody',
    side: 'top',
  },
  {
    id: 'leftrail',
    titleKey: 'tutorial.leftrailTitle',
    bodyKey: 'tutorial.leftrailBody',
    side: 'right',
  },
  {
    id: 'inspector',
    titleKey: 'tutorial.inspectorTitle',
    bodyKey: 'tutorial.inspectorBody',
    side: 'left',
  },
  {
    id: 'timeline',
    titleKey: 'tutorial.timelineTitle',
    bodyKey: 'tutorial.timelineBody',
    side: 'top',
  },
  {
    id: 'filmMode',
    titleKey: 'tutorial.filmModeTitle',
    bodyKey: 'tutorial.filmModeBody',
    side: 'top',
  },
]
