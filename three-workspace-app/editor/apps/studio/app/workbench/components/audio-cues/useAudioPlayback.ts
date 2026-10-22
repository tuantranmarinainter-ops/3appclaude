import { useEffect, useRef, useState } from 'react'
import type { UnifiedProject } from '@bbs/animation-workspace-shared'
import type { AudioCue } from '../../../../src/audioCues'
import { getLiveStudio, subscribeLiveStudio } from '../../../../src/devtools/liveStudio'
import { activeSubtitle, audioCuesToStart } from './playback'

/**
 * Plays the project's audio lane with App 2's timeline: while the stage plays, each cue starts when the playhead reaches
 * it (or mid-way after a jump); pause, seek or stop silence everything. Returns the voice subtitle for the playhead.
 */
export function useAudioPlayback(project: UnifiedProject | null): AudioCue | null {
  const raw = (project?.extensions as { audioCues?: { cues?: unknown } } | undefined)?.audioCues?.cues
  const cues = Array.isArray(raw) ? raw as AudioCue[] : []
  const key = JSON.stringify(cues)
  const fps = project?.scene.content.timeline.fps ?? 30
  const projectId = project?.projectId
  const [subtitle, setSubtitle] = useState<AudioCue | null>(null)
  const buffers = useRef(new Map<string, AudioBuffer>())
  const context = useRef<AudioContext | null>(null)
  const playing = useRef(new Map<string, AudioBufferSourceNode>())

  useEffect(() => {
    if (!projectId || !cues.length) return
    let cancelled = false
    const ctx = context.current ?? (typeof AudioContext === 'undefined' ? null : (context.current = new AudioContext()))
    if (!ctx) return
    for (const assetId of new Set(cues.map((cue) => cue.assetId))) {
      if (buffers.current.has(assetId)) continue
      void fetch(`/api/unified/projects/${projectId}/assets/${encodeURIComponent(assetId)}/source`, { credentials: 'same-origin' })
        .then((response) => response.arrayBuffer()).then((bytes) => ctx.decodeAudioData(bytes))
        .then((buffer) => { if (!cancelled) buffers.current.set(assetId, buffer) }).catch(() => { /* an undecodable file stays silent */ })
    }
    return () => { cancelled = true }
    // `key` stands for the cue list contents.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, key])

  useEffect(() => {
    const stopAll = () => { for (const node of playing.current.values()) { try { node.stop() } catch { /* already ended */ } } playing.current.clear() }
    let last: number | null = null
    let detach: (() => void) | null = null
    const attach = () => {
      detach?.()
      const stage = getLiveStudio()?.stage
      if (!stage) return
      detach = stage.on('frame', (frame) => {
        const durations = new Map([...buffers.current].map(([assetId, buffer]) => [assetId, buffer.duration]))
        setSubtitle(activeSubtitle(cues, durations, frame, fps))
        const jumped = last === null || frame < last || frame - last > 3
        last = frame
        if (!stage.playing) { stopAll(); return }
        if (jumped) stopAll()
        const ctx = context.current
        if (!ctx) return
        if (ctx.state === 'suspended') void ctx.resume()
        for (const { cue, offset } of audioCuesToStart(cues, durations, frame, fps)) {
          if (playing.current.has(cue.id)) continue
          const node = ctx.createBufferSource(), gain = ctx.createGain()
          node.buffer = buffers.current.get(cue.assetId)!
          gain.gain.value = 10 ** (cue.gainDb / 20)
          node.connect(gain).connect(ctx.destination)
          node.onended = () => { if (playing.current.get(cue.id) === node) playing.current.delete(cue.id) }
          node.start(0, offset)
          playing.current.set(cue.id, node)
        }
      })
    }
    attach()
    const unsubscribe = subscribeLiveStudio(attach)
    return () => { unsubscribe(); detach?.(); stopAll() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, fps])

  useEffect(() => () => { void context.current?.close(); context.current = null }, [])
  return subtitle
}
