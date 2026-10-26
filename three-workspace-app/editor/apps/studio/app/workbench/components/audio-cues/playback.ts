import type { AudioCue } from '../../../../src/audioCues'

/** Pure timing for the App 2 audio lane: which cues should sound at `frame`, and from which offset (seconds). */
export function audioCuesToStart(cues: readonly AudioCue[], durations: ReadonlyMap<string, number>, frame: number, fps: number): Array<{ cue: AudioCue; offset: number }> {
  const out: Array<{ cue: AudioCue; offset: number }> = []
  for (const cue of cues) {
    const duration = durations.get(cue.assetId)
    const offset = (cue.offsetSeconds ?? 0) + (frame - cue.frameStart) / fps
    if (duration !== undefined && frame >= cue.frameStart && frame <= (cue.frameEnd ?? Infinity) && offset >= 0 && offset < duration) out.push({ cue, offset })
  }
  return out
}

/** The subtitle shown at `frame`: the latest voice cue still speaking. */
export function activeSubtitle(cues: readonly AudioCue[], durations: ReadonlyMap<string, number>, frame: number, fps: number): AudioCue | null {
  let best: AudioCue | null = null
  for (const { cue } of audioCuesToStart(cues, durations, frame, fps)) {
    if (cue.kind === 'voice' && cue.text && (!best || cue.frameStart > best.frameStart)) best = cue
  }
  return best
}
