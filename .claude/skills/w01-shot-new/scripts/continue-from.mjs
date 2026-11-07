// Turn the copied previous-shot project into the START of the new shot: frame 0 = previous frame F (shot.prev.frame).
//   node continue-from.mjs <shot.json> [--frame F]
// - motion clips still playing at F are shifted by -F (negative frameStart is allowed, so loops / ping-pong keep their exact phase);
//   their blendIn partner chain is kept too (ends before 0): App 2 aligns a skeletal blended clip to its partner's root;
//   clips that ended before F are removed; the last clip of each character is stretched to the end (non-loop clips hold).
// - every F-curve and user key becomes one constant key holding its value at F (piecewise linear; check CONTINUITY afterwards).
// - VFX cues alive at F restart at 0 (App 2 cannot start a cue before 0: say so to the user); audio cues are removed.
// Then: node gates.mjs <shot.json>  (probe CONTINUITY must PASS <= 2 cm)
import { loadShot, api, applyScene, evalKeys, r4, writeJson, readJson, clipsFile, continueClips, blendPartner } from './lib.mjs'
const shot = loadShot()
const fi = process.argv.indexOf('--frame')
const F = fi > 0 ? Number(process.argv[fi + 1]) : shot.prev.frame
const END = shot.end
const { project, command } = await api()
const { project: p } = await project(shot.project)
const done = readJson(clipsFile(shot), {}).__continuedFrom != null   // re-runnable: never shift twice
const scene = structuredClone(p.scene)
const tl = scene.content.timeline
// clips running at F + their blend partner chain (a skeletal blendIn aligns the whole clip to its partner: keep both)
const keep = continueClips(tl.animation.motionClips, F)
for (const c of keep) if (c.playback.blendIn && c.frameStart + c.playback.blendIn.frames <= 0 && !blendPartner(keep, c)) delete c.playback.blendIn
for (const node of new Set(keep.map((c) => c.target.nodeId))) {
  const last = keep.filter((c) => c.target.nodeId === node).sort((a, b) => b.frameEnd - a.frameEnd)[0]
  if (last.frameEnd < END) last.frameEnd = END
}
tl.animation.motionClips = keep
tl.frameEnd = END
for (const seq of scene.content.editorial?.sequences ?? []) seq.clips = [{ ...seq.clips[0], sourceFrameStart: 0, sourceFrameEnd: END - 1 }]
const fc = structuredClone(p.extensions.topview.fcurves)
for (const c of fc.fcurves) c.k = [[0, r4(evalKeys(c.k, F)), 'linear', `kf_cont_${c.id}`]]
for (const [node, props] of Object.entries(fc.userKeys ?? {})) for (const [prop, ks] of Object.entries(props)) {
  const sorted = [...ks].sort((a, b) => a.frame - b.frame)
  const val = (i) => sorted.length === 1 ? sorted[0].value[i] : evalKeys(sorted.map((k) => [k.frame, k.value[i]]), F)
  props[prop] = [{ id: `kf_cont_${node}_${prop}`, frame: 0, value: sorted[0].value.map((_, i) => r4(val(i))), interpolation: 'linear' }]
}
// cues must stay inside the timeline at every step: fix them while the old (longer) timeline is still there
const maxCue = Math.max(0, ...(p.extensions.vfxCues?.cues ?? []).map((c) => c.frameEnd))
if (p.scene.content.timeline.frameEnd < maxCue) { const tmp = structuredClone(p.scene); tmp.content.timeline.frameEnd = maxCue; await applyScene(shot, tmp, p.extensions.topview.fcurves) }
const cueEnd = Math.max(p.scene.content.timeline.frameEnd, maxCue)
const restarted = []
const seen = new Set()
for (const c of p.extensions.vfxCues?.cues ?? []) {
  const sig = `${c.effect}|${JSON.stringify(c.position)}|${c.attachNodeId ?? ''}|${c.attachBone ?? ''}`
  // ended before F, or a chained copy of the same effect (dome chains): remove; keep one alive cue per effect/place
  if ((!done && c.frameEnd < F) || seen.has(sig)) { await command(shot.project, 'vfx.cue.remove', { id: c.id }); continue }
  seen.add(sig); restarted.push(c.effect)
  // long-lived effects (dome, eye glow) restart at 0; re-chain with `vfx.mjs keep` if they stop before the end
  if (!(c.frameStart === 0 && c.frameEnd === Math.min(END, cueEnd))) await command(shot.project, 'vfx.cue.update', { id: c.id, patch: { frameStart: 0, frameEnd: Math.min(END, cueEnd) } })
}
// audio cues are shot-specific: drop them before the timeline shrinks
for (const c of p.extensions.audioCues?.cues ?? []) await command(shot.project, 'audio.cue.remove', { id: c.id })
let r
if (!done) r = await applyScene(shot, scene, fc)
else { // re-run: clips were already shifted; only bring the timeline back to END (it may have been raised for the cue pass)
  const { project: cur } = await project(shot.project); const s2 = structuredClone(cur.scene); s2.content.timeline.frameEnd = END
  r = await applyScene(shot, s2, cur.extensions.topview.fcurves)
}
const ids = readJson(clipsFile(shot), {})
if (!done) { for (const c of keep) ids[`cont_${c.target.nodeId.slice(-6)}_${c.motion.name.split(' ')[0]}`] = c.id; ids.__continuedFrom = F }
writeJson(clipsFile(shot), ids)
console.log(`rev ${r.revision}: frame ${F} of the previous shot is now frame 0; ${keep.length} clips kept`)
for (const c of keep) console.log('  ', c.target.nodeId.slice(-8), c.frameStart, c.frameEnd, c.motion.name)
if (restarted.length) console.log('VFX restarted at frame 0 (cannot start before 0):', restarted.join(', '))
console.log('clip ids saved to', clipsFile(shot))
