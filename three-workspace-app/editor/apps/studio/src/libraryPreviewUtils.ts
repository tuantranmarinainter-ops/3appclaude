export function previewPlaybackAction(intersectsViewport: boolean): 'play' | 'pause' {
  return intersectsViewport ? 'play' : 'pause'
}

export function shouldLoadPreview(intersectsNearViewport: boolean, hasPreview: boolean): boolean {
  return intersectsNearViewport && hasPreview
}
