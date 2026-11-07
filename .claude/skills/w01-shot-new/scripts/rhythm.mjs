// Put clips on the timeline from a rhythm table (slow dialogue / fast attack is just start, end and speed per clip).
//   node rhythm.mjs <shot.json> rhythm.json
// rhythm.json: [ { "key": "heroAttack", "start": 94, "end": 117, "speed": 1.5, "loop": false, "loopMode": "repeat",
//                  "blend": 4, "root": "in-place" }, … ]       keys are clips.json keys (place.mjs / continue-from.mjs)
// - blend N: blendIn of N frames (smooth, foot lock OFF); the clip must overlap the previous one by N frames. 0 removes it;
//   leaving "blend" out keeps the clip's blendIn (a continued skeletal blend aligns the clip to its partner: CONTINUITY).
// - root: skeletal | in-place | trajectory (in-place for anything whose path you drive with curves; skeletal for falls).
//   Root changes go through motion.binding.set with the clip parked (avoids the overlap check), then the scene is applied.
// - { "key": "oldClip", "remove": true } takes a clip off the timeline (its binding goes with it).
// - Parked clips (frame >= 1000) not listed are removed from the timeline. A non-loop clip that ends before the shot does
//   NOT hold: the character snaps to the rest pose. Stretch the last clip of each character to the end.
import { readFileSync } from 'node:fs'
import { loadShot, api, applyScene, readJson, clipsFile } from './lib.mjs'
const shot = loadShot()
const plan = JSON.parse(readFileSync(process.argv[3], 'utf8'))
const ids = readJson(clipsFile(shot), {})
const { command, project } = await api()
let { project: p } = await project(shot.project)
for (const it of plan) {
  const id = ids[it.key]; if (!id) throw new Error('unknown clip key ' + it.key)
  const b = p.bindings[id]
  if (it.remove) continue
  if (it.root && b && b.rootPolicy !== it.root) {
    const c = p.scene.content.timeline.animation.motionClips.find((x) => x.id === id)
    await command(shot.project, 'motion.binding.set', { binding: { ...b, rootPolicy: it.root }, clipPatch: { frameStart: 5000 + plan.indexOf(it) * 200, frameEnd: 5000 + plan.indexOf(it) * 200 + (c.frameEnd - c.frameStart) } })
    ;({ project: p } = await project(shot.project))
  }
}
const scene = structuredClone(p.scene)
const listed = new Set(plan.filter((it) => !it.remove).map((it) => ids[it.key]))
const removed = new Set(plan.filter((it) => it.remove).map((it) => ids[it.key]))
const tl = scene.content.timeline
tl.animation.motionClips = tl.animation.motionClips.filter((c) => !removed.has(c.id) && (listed.has(c.id) || c.frameStart < 1000))
for (const it of plan.filter((x) => !x.remove)) {
  const c = tl.animation.motionClips.find((x) => x.id === ids[it.key])
  Object.assign(c, { frameStart: it.start, frameEnd: it.end })
  if (it.speed != null) c.playback.speed = it.speed
  if (it.loop != null) c.playback.loop = it.loop
  if (it.loopMode) c.playback.loopMode = it.loopMode
  // no "blend" in the entry = keep the clip's blendIn (continue-from keeps skeletal blends: their root alignment); 0 = none
  if (it.blend != null) { delete c.playback.blendIn; if (it.blend > 0) c.playback.blendIn = { frames: it.blend, curve: 'smooth', footLock: false } }
}
tl.frameEnd = shot.end
const r = await applyScene(shot, scene, p.extensions.topview.fcurves)
;({ project: p } = await project(shot.project))
console.log('rev', r.revision)
const nodeKey = Object.fromEntries(Object.entries(shot.chars).map(([k, v]) => [v.node, k]))
for (const c of p.scene.content.timeline.animation.motionClips.filter((c) => c.frameStart < 1000).sort((a, b) => (nodeKey[a.target.nodeId] ?? '').localeCompare(nodeKey[b.target.nodeId] ?? '') || a.frameStart - b.frameStart)) {
  console.log(`${(nodeKey[c.target.nodeId] ?? c.target.nodeId).padEnd(6)} ${String(c.frameStart).padStart(4)}-${String(c.frameEnd).padEnd(4)} ${c.motion.name.padEnd(34)} x${c.playback.speed}${c.motion.reverse ? ' REV' : ''}${c.playback.blendIn ? ' blend ' + c.playback.blendIn.frames : ''} ${p.bindings[c.id]?.rootPolicy ?? ''}`)
}
for (const [k, node] of Object.entries(shot.chars).map(([k, v]) => [k, v.node])) {
  const last = p.scene.content.timeline.animation.motionClips.filter((c) => c.target.nodeId === node && c.frameStart < 1000).sort((a, b) => b.frameEnd - a.frameEnd)[0]
  if (last && last.frameEnd < shot.end) console.log(`WARN ${k}: last clip ends at ${last.frameEnd} < ${shot.end} -> rest pose after it`)
}
