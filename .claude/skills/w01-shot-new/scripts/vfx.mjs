// VFX cues with the effect's real length (from the App 2 preview sheet.json), placed at a bone position if asked.
//   node vfx.mjs <shot.json> add <effect> <start> [--at go:head@101 | --pos x,y,z] [--dy 0.1] [--scale 0.4] [--end E]
//   node vfx.mjs <shot.json> keep <effect> [--every 230 --overlap 23]   long-lived effect over the whole shot (dome):
//                                                                       chained cues that overlap, because one cue stops
//   node vfx.mjs <shot.json> list | remove <effect|cueId>
// Lessons: a cue longer than a one-shot effect replays it (Shot 03 landing twice); barrior01 vanishes after ~250 frames;
// pixelfx (tap15-*) only preview in App 2 (shot.previews must include them) and do not reach the BBS film yet.
import { readFileSync, existsSync } from 'node:fs'
import { loadShot, api, near, readJson, probeFile } from './lib.mjs'
const shot = loadShot()
const [, , , cmd, effect, startArg] = process.argv
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d }
const previews = shot.previews
if (!previews) throw new Error('set "previews" in shot.json (the W01_VFX_PREVIEWS folder of the sandbox server)')
const length = (e) => { const f = `${previews}/${e}/sheet.json`; if (!existsSync(f)) return null; const s = JSON.parse(readFileSync(f, 'utf8')); return { frames: s.frames, loop: !!s.loop } }
const { command, project } = await api()
const { project: p } = await project(shot.project)
const cues = p.extensions.vfxCues?.cues ?? []
if (cmd === 'list') { for (const c of cues) { const L = length(c.effect); console.log(c.id, c.effect, c.frameStart, c.frameEnd, L ? `(effect ${L.frames}f${L.loop ? ' loop' : ''})` : '(no preview)', JSON.stringify(c.position)) } process.exit(0) }
if (cmd === 'remove') { for (const c of cues.filter((c) => c.id === effect || c.effect === effect)) { await command(shot.project, 'vfx.cue.remove', { id: c.id }); console.log('removed', c.effect, c.frameStart) } process.exit(0) }
const L = length(effect); if (!L) throw new Error(`no preview for ${effect} in ${previews} (add it to the sandbox previews folder)`)
if (cmd === 'add') {
  const start = Number(startArg)
  let pos
  const at = arg('--at')
  if (at) { const [, k, bone, f] = /^(\w+):(\w+)@(\d+)$/.exec(at); const d = near(readJson(probeFile(shot)).data, Number(f))[k]; pos = [...(d[bone] ?? d.head)]; pos[1] += Number(arg('--dy', 0)) }
  else pos = arg('--pos', '0,0,0').split(',').map(Number)
  const end = Number(arg('--end', start + L.frames - 1))
  if (!L.loop && end > start + L.frames - 1) throw new Error(`${effect} is ${L.frames} frames, one-shot: end must be <= ${start + L.frames - 1} or it replays`)
  const cue = { effect, frameStart: start, frameEnd: Math.min(end, shot.end), position: { x: +pos[0].toFixed(3), y: +pos[1].toFixed(3), z: +pos[2].toFixed(3) }, yaw: 0, scale: Number(arg('--scale', 1)) }
  const r = await command(shot.project, 'vfx.cue.add', { cue }); console.log('rev', r.revision, JSON.stringify(cue))
}
if (cmd === 'keep') {
  const every = Number(arg('--every', 230)), overlap = Number(arg('--overlap', 23))
  const same = cues.filter((c) => c.effect === effect).sort((a, b) => a.frameStart - b.frameStart)
  if (!same.length) throw new Error('add the first cue of ' + effect + ' first (its position/scale is copied)')
  const base = same[0]
  for (const c of same.slice(1)) await command(shot.project, 'vfx.cue.remove', { id: c.id })
  let s = 0, first = true
  while (s < shot.end) {
    const e = Math.min(shot.end, s + every + overlap)
    if (first) await command(shot.project, 'vfx.cue.update', { id: base.id, patch: { frameStart: s, frameEnd: e } })
    else await command(shot.project, 'vfx.cue.add', { cue: { effect, frameStart: s, frameEnd: e, position: base.position, yaw: base.yaw, scale: base.scale } })
    console.log(effect, s, e); first = false; s += every
  }
}
