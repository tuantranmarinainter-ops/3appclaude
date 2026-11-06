// Place motions as clips (parked at frame 1000+; rhythm.mjs puts them on the timeline). Ids go to <work>/clips.json.
//   node place.mjs <shot.json> place.json
// place.json: [
//   { "key": "heroAttack", "char": "hero", "uuid": "<library action uuid>" },                                   // library.place
//   { "key": "goRise", "char": "go", "from": "goDeath", "start": 2.35, "len": 0.75, "speed": 0.3, "reverse": true } // motion.place (same motion as clip key `from`)
// ]
// Keys already in clips.json are skipped (re-runnable). Packs must be in the sandbox library (find-motion.py --copy).
import { readFileSync } from 'node:fs'
import { loadShot, api, readJson, writeJson, clipsFile } from './lib.mjs'
const shot = loadShot()
const list = JSON.parse(readFileSync(process.argv[3], 'utf8'))
const ids = readJson(clipsFile(shot), {})
const { command, project } = await api()
let park = 1000 + Object.keys(ids).length * 150
for (const it of list) {
  if (ids[it.key]) { console.log('skip', it.key, ids[it.key]); continue }
  const characterId = shot.chars[it.char].char
  park += 150
  try {
    if (it.uuid) ids[it.key] = (await command(shot.project, 'library.place', { actionUuid: it.uuid, characterId, frameStart: park })).result.libraryPlacement.clipId
    else {
      const { project: p } = await project(shot.project)
      const motionId = it.motionId ?? p.bindings[ids[it.from] ?? it.from]?.motionId
      if (!motionId) throw new Error(`no motion for ${it.from}`)
      ids[it.key] = (await command(shot.project, 'motion.place', { motionId, characterId, frameStart: park, sourceStartSeconds: it.start ?? 0, ...(it.len ? { sourceLengthSeconds: it.len } : {}), speed: it.speed ?? 1, loop: !!it.loop, reverse: !!it.reverse })).result.clipId
    }
    console.log(it.key, ids[it.key])
  } catch (e) { console.log(it.key, 'FAILED', String(e).slice(0, 240)) }
  writeJson(clipsFile(shot), ids)
}
