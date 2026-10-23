export function previewPlaybackAction(intersectsViewport: boolean): 'play' | 'pause' {
  return intersectsViewport ? 'play' : 'pause'
}

export function shouldLoadPreview(intersectsNearViewport: boolean, hasPreview: boolean): boolean {
  return intersectsNearViewport && hasPreview
}

export function normalizeStudioOrigin(origin: string): string {
  const url = new URL(origin)
  if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') url.hostname = '127.0.0.1'
  return url.origin
}
