import type { TranslateFn } from './types'

const MESSAGES: Record<string, string> = {
  "Loading draft…": "errors.loadingDraft",
  "Ready": "errors.ready",
  "Connection interrupted. Generation may still be running; refresh later.": "errors.streamInterrupted",
  "This browser cannot encode video offline. Use the latest Chrome or Edge with H.264 or VP9 WebCodecs support.": "errors.videoUnsupported",
  "Export failed: no video data was generated": "errors.videoEmpty",
  "Image capture failed: no image data was generated": "errors.imageEmpty",
  "Model failed to load": "errors.modelLoad",
  "Prop model failed to load": "errors.propLoad",
  "The path is missing or has too few points": "errors.pathInvalid",
  "Select a character, camera, prop or primitive as the target": "errors.pathTarget",
  "The playhead is at the end of the timeline. No path clip can be created.": "errors.pathEnd"
}

const PREFIXES: Array<[string, string]> = [
  [
    "Loading character model: ",
    "errors.loadingCharacter"
  ],
  [
    "Loading motion: ",
    "errors.loadingMotion"
  ],
  [
    "Loading failed: ",
    "errors.loadingFailed"
  ],
  [
    "Motion failed to load: ",
    "errors.motionLoad"
  ],
  [
    "Camera not found: ",
    "errors.cameraMissing"
  ],
  [
    "Video not found: ",
    "errors.filmMissing"
  ],
  [
    "Cannot resolve video frame: ",
    "errors.frameInvalid"
  ]
]

/** Localize known application messages; preserve host errors and user-authored text. */
export function localizeMessage(t: TranslateFn, value: unknown): string {
  const message = value instanceof Error ? value.message : String(value ?? '')
  if (MESSAGES[message]) return t(MESSAGES[message])
  for (const [prefix, key] of PREFIXES) {
    if (message.startsWith(prefix)) return t(key, { detail: localizeMessage(t, message.slice(prefix.length)) })
  }
  return message
}
