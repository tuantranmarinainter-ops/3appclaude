import { normalizeAspectRatio, resolveAspectRatio } from './aspectRatio'

/** 机位自己的画幅。没写过时沿用文档画幅，旧草稿行为不变。 */
export function cameraAspectSetting(
  camera: { aspectRatio?: string } | null | undefined,
  documentAspect: string | null | undefined,
): string {
  const own = camera?.aspectRatio?.trim()
  if (own) return normalizeAspectRatio(own)
  return normalizeAspectRatio(documentAspect)
}

export function cameraNumericAspect(
  camera: { aspectRatio?: string } | null | undefined,
  documentAspect: string | null | undefined,
  viewportAspect: number,
): number {
  return resolveAspectRatio(cameraAspectSetting(camera, documentAspect), viewportAspect)
}
