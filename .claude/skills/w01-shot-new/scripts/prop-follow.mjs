// Prop follows a bone for the whole shot with the grip it has at --grip-frame (default 0 = end of the previous shot).
//   node prop-follow.mjs <shot.json> [--grip-frame 0]
// shot.json: "prop": { "node": "user_prop_…", "follow": "hero", "bone": "low_right_arm_end", "tip": [0, 1.0, 0] }
// Saves the grip matrix to <work>/grip.json (probe CONTACT uses it). Re-run after any change to the follower's motion/path.
import { loadShot, api, applyScene, runProbe, near, evalKeys, r4, writeJson } from './lib.mjs'
const shot = loadShot()
const gi = process.argv.indexOf('--grip-frame'); const G = gi > 0 ? Number(process.argv[gi + 1]) : 0
if (!shot.prop?.follow || !shot.prop?.bone) throw new Error('set prop.follow and prop.bone in shot.json')
const { Euler, Matrix4, Quaternion, Vector3 } = await import(`file:///${shot.editor}/node_modules/.pnpm/node_modules/three/build/three.module.js`)
const { project } = await api()
let { project: p } = await project(shot.project)
const { data } = await runProbe(shot)
const D2R = Math.PI / 180, R2D = 180 / Math.PI
const curve = (path, i) => p.extensions.topview.fcurves.fcurves.find((c) => c.t[1] === shot.prop.node && c.p === path && c.i === i)
const node = p.scene.content.nodes.find((n) => n.id === shot.prop.node)
const val = (path, i, f, rest) => { const c = curve(path, i); return c ? evalKeys(c.k, f) : rest }
const t = node.transform
const propG = new Matrix4().compose(
  new Vector3(val('transform.position', 0, G, t.position.x), val('transform.position', 1, G, t.position.y), val('transform.position', 2, G, t.position.z)),
  new Quaternion().setFromEuler(new Euler(val('transform.rotation', 0, G, t.rotation.x) * D2R, val('transform.rotation', 1, G, t.rotation.y) * D2R, val('transform.rotation', 2, G, t.rotation.z) * D2R, 'XYZ')),
  new Vector3(1, 1, 1))
const grip = new Matrix4().fromArray(near(data, G)[shot.prop.follow].bone).invert().multiply(propG)
writeJson(`${shot.work}/grip.json`, grip.toArray())
const ch = [[], [], [], [], [], []]; let prev = null
for (let f = 0; f < shot.end; f++) {
  const row = data[f]?.[shot.prop.follow]; if (!row?.bone) continue
  const pos = new Vector3(), q = new Quaternion(), s = new Vector3()
  new Matrix4().fromArray(row.bone).multiply(grip).decompose(pos, q, s)
  const e = new Euler().setFromQuaternion(q, 'XYZ')
  let v = [pos.x, pos.y, pos.z, e.x * R2D, e.y * R2D, e.z * R2D]
  if (prev) v = v.map((x, i) => { if (i < 3) return x; while (x - prev[i] > 180) x -= 360; while (x - prev[i] < -180) x += 360; return x })
  v.forEach((x, i) => ch[i].push([f, r4(x), 'linear', `kf_prop_${i}_${f}`])); prev = v
}
;({ project: p } = await project(shot.project))
const fc = structuredClone(p.extensions.topview.fcurves)
fc.fcurves = fc.fcurves.filter((c) => !(c.t[1] === shot.prop.node && c.p !== 'transform.scale'))
const names = ['position', 'position', 'position', 'rotation', 'rotation', 'rotation']
ch.forEach((k, i) => fc.fcurves.push({ id: `fc_prop_${names[i]}_${i % 3}`, t: ['node', shot.prop.node], p: `transform.${names[i]}`, i: i % 3, k }))
const r = await applyScene(shot, p.scene, fc)
console.log(`rev ${r.revision}: prop follows ${shot.prop.follow}.${shot.prop.bone} (${ch[0].length} keys, grip from frame ${G})`)
