// Replace the shot's audio cues from a list, then download the mixdown and check its peak.
//   node audio.mjs <shot.json> audio.json [--keep]
// audio.json: [ ["<dir>/bonk.wav", "sfx", 100, 0], ["<dir>/voice.wav", "voice", 240, 0, "Gỗ Xưa", "Ây ây da... đau quá!"], … ]
//             [file, kind (sfx|voice|music), frameStart, gainDb, speaker?, text?]
// Writes <work>/mix.wav. Gate: peak <= -1 dBFS (prints the level at each cue start too). BBS does not play audio cues:
// for the game the film needs an audio camera clip (film export, Codex task).
import { readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { loadShot, api } from './lib.mjs'
const shot = loadShot()
const list = JSON.parse(readFileSync(process.argv[3], 'utf8'))
const { command, project, upload } = await api()
const { project: p } = await project(shot.project)
if (!process.argv.includes('--keep')) for (const c of p.extensions.audioCues?.cues ?? []) await command(shot.project, 'audio.cue.remove', { id: c.id })
for (const [file, kind, frameStart, gainDb, speaker, text] of list) {
  const up = await upload(file, file.split(/[\\/]/).pop())
  const imp = await command(shot.project, 'asset.import', { files: [up.uploadId], format: 'auto' })
  const r = await command(shot.project, 'audio.cue.add', { cue: { kind, assetId: imp.result.assetIds[0], frameStart, gainDb, ...(speaker ? { speaker } : {}), ...(text ? { text } : {}) } })
  console.log(frameStart, kind, file.split(/[\\/]/).pop(), 'rev', r.revision)
}
const base = shot.api
const s = await fetch(base + '/api/unified/session', { method: 'POST', headers: { origin: base, 'content-type': 'application/json' }, body: '{}' })
const cookie = (s.headers.get('set-cookie') ?? '').split(';')[0]
const m = await fetch(`${base}/api/unified/projects/${shot.project}/audio-mixdown?start=0&end=${shot.end - 1}`, { headers: { origin: base, cookie } })
const out = `${shot.work}/mix.wav`
writeFileSync(out, Buffer.from(await m.arrayBuffer()))
const vd = spawnSync('ffmpeg', ['-hide_banner', '-i', out, '-af', 'volumedetect', '-f', 'null', 'NUL'], { encoding: 'utf8' }).stderr
const peak = Number(/max_volume: (-?[\d.]+) dB/.exec(vd)?.[1])
console.log(`${peak <= -1 ? 'PASS' : 'FAIL'}    AUDIO_PEAK  ${peak} dB (mix ${out})`)
