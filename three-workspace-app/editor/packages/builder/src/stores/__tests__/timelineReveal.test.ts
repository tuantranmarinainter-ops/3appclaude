import { describe, expect, test } from 'vitest'
import { EditorStore } from '../EditorStore'

describe('timeline reveal clip (C27)', () => {
  test('reveal selects the node, opens the timeline and records the request with a nonce', () => {
    const editor = new EditorStore('draft')
    expect(editor.timelineRevealClip).toBeNull()

    editor.revealTimelineClip({ clipId: 'clip-1', nodeId: 'node-1', frameStart: 90, frameEnd: 119 })
    expect(editor.selection).toEqual({ kind: 'node', nodeId: 'node-1' })
    expect(editor.timelineVisible).toBe(true)
    expect(editor.timelineOpen).toBe(true)
    expect(editor.timelineRevealClip).toEqual({ clipId: 'clip-1', nodeId: 'node-1', frameStart: 90, frameEnd: 119, nonce: 1 })

    editor.revealTimelineClip({ clipId: 'clip-2', nodeId: 'node-1', frameStart: 180, frameEnd: 208 })
    expect(editor.timelineRevealClip?.nonce).toBe(2)
    expect(editor.timelineRevealClip?.clipId).toBe('clip-2')

    editor.clearTimelineReveal()
    expect(editor.timelineRevealClip).toBeNull()
  })
})
