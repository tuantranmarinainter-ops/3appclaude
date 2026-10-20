import { widthFromAspectHeight } from '../../contract/aspectRatio'
import { framesToSeconds, secondsToFrame } from '../../evaluate/timecode'

/** Scene / 成片导出共用的输出高度档位。 */
export const EXPORT_RESOLUTIONS = [
  { height: 720, label: '720p' },
  { height: 1080, label: '1080p' },
  { height: 1440, label: '1440p' },
] as const

export type ExportHeight = (typeof EXPORT_RESOLUTIONS)[number]['height']

export const DEFAULT_EXPORT_HEIGHT: ExportHeight = 1080

export function parseExportHeight(value: string): ExportHeight | null {
  const height = Number(value)
  return EXPORT_RESOLUTIONS.find((item) => item.height === height)?.height ?? null
}

export function exportResolutionOptions(aspect: number): { value: string; label: string }[] {
  return EXPORT_RESOLUTIONS.map((item) => ({
    value: String(item.height),
    label: `${item.label} · ${widthFromAspectHeight(item.height, aspect)} × ${item.height}`,
  }))
}

/** 顶栏 / 预览导出共用：默认机位跟预览下拉当前选中的一致。 */
export function resolveDefaultExportCameraId(
  cameras: readonly { id: string }[],
  activeCameraId: string | null,
  fallbackId: string,
): string {
  if (activeCameraId && cameras.some((camera) => camera.id === activeCameraId)) {
    return activeCameraId
  }
  return cameras[0]?.id ?? fallbackId
}

export type ExportTimeUnit = 'frames' | 'seconds'

export function formatExportTime(frame: number, fps: number, unit: ExportTimeUnit): string {
  if (unit === 'frames') return String(Math.round(frame))
  return String(Number(framesToSeconds(frame, fps).toFixed(2)))
}

/** 裸数字按当前单位解析；后缀 `s` / `f` 强制按秒 / 帧，与当前单位无关。 */
export function parseExportTime(text: string, fps: number, unit: ExportTimeUnit): number | null {
  const match = text.trim().match(/^(\d+(?:\.\d*)?|\.\d+)\s*([sf])?$/i)
  if (!match) return null
  const value = Number(match[1])
  const suffix = match[2]?.toLowerCase()
  const asSeconds = suffix ? suffix === 's' : unit === 'seconds'
  return asSeconds ? secondsToFrame(value, fps) : Math.round(value)
}
