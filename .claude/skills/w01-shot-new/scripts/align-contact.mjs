// Move the prop holder so the prop tip lands on the top of a character's head at a frame (e.g. a rod strike).
//   node align-contact.mjs <shot.json> --frame 101 --target go [--offset 0.1]
// Adds keys at F and F+1 to the holder's position curves (shot.prop.follow), then re-runs prop-follow.mjs and the gates.
// Pick F from the swing: the frame where the tip moves down fastest (probe prints nothing for this; use --list to see tip speeds).
import { loadShot, api, applyScene, runProbe, near, evalKeys, r4 } from './lib.mjs'
const shot = loadShot()
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d }
const F = Number(arg('--frame')), target = arg('--target'), OFF = Number(arg('--offset', 0.1))
const { Matrix4, Vector3 } = await import(`file:///${shot.editor}/node_modules/.pnpm/node_modules/three/build/three.module.js`)
const { readFileSync } = await import('node:fs')
const grip = new Matrix4().fromArray(JSON.parse(readFileSync(`${shot.work}/grip.json`, 'utf8')))
const { data } = await runProbe(shot)
const tip = (f) => new Vector3(...(shot.prop.tip ?? [0, 1, 0])).applyMatrix4(new Matrix4().fromArray(near(data, f)[shot.prop.follow].bone).multiply(grip))
if (process.argv.includes('--list')) {
  for (let f = F - 8; f <= F + 6; f++) { const a = tip(f - 1), b = tip(f); console.log(f, b.toArray().map((v) => v.toFixed(2)).join(','), 'speed', (a.distanceTo(b) * 30).toFixed(1), 'm/s', 'down', ((a.y - b.y) * 30).toFixed(1)) }
  process.exit(0)
}
const goal = new Vector3(...near(data, F)[target].head).add(new Vector3(0, OFF, 0))
const d = goal.clone().sub(tip(F))
const { project } = await api()
const { project: p } = await project(shot.project)
const fc = structuredClone(p.extensions.topview.fcurves)
const holder = shot.chars[shot.prop.follow].node
for (let i = 0; i < 3; i++) {
  const c = fc.fcurves.find((x) => x.t[1] === holder && x.p === 'transform.position' && x.i === i); if (!c) throw new Error('holder has no position curve ' + i)
  for (const f of [F, F + 1]) { const base = c.k.find((k) => k[0] === f)?.[1] ?? evalKeys(c.k, f); c.k = c.k.filter((k) => k[0] !== f); c.k.push([f, r4(base + d.getComponent(i)), 'linear', `kf_contact_${i}_${f}`]) }
  c.k.sort((a, b) => a[0] - b[0])
}
const r = await applyScene(shot, p.scene, fc)
console.log(`rev ${r.revision}: holder shifted ${d.toArray().map((v) => v.toFixed(3)).join(' ')} at ${F}. Next: node prop-follow.mjs, node gates.mjs`)
