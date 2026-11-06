// Lay a lying character flat: tilts the whole body about the horizontal axis across it so head and feet are level.
//   node flat.mjs <shot.json> <char> --in A --hold B C --out D      (ramp A→B, flat B..C, back to normal C→D)
// The tilt angle is measured from probe.json at the middle of B..C (head vs feet). Uses the node's user rotation keys
// (or its rest rotation). Run ground.mjs again afterwards: tilting moves the body.
import { loadShot, api, applyScene, near, evalKeys } from './lib.mjs'
const shot = loadShot()
const key = process.argv[3]; const ch = shot.chars[key]
const arg = (n, i = 1) => { const k = process.argv.indexOf(n); return k > 0 ? Number(process.argv[k + i]) : null }
const A = arg('--in'), B = arg('--hold'), C = arg('--hold', 2), D = arg('--out')
if ([A, B, C, D].some((v) => v == null)) throw new Error('usage: flat.mjs <shot.json> <char> --in A --hold B C --out D')
const { Euler, Quaternion, Vector3 } = await import(`file:///${shot.editor}/node_modules/.pnpm/node_modules/three/build/three.module.js`)
const { readFileSync } = await import('node:fs')
const { data } = JSON.parse(readFileSync(`${shot.work}/probe.json`, 'utf8'))
const mid = near(data, Math.round((B + C) / 2))[key]
const head = new Vector3(...mid.head), feet = new Vector3(...mid.feet)
const along = new Vector3(feet.x - head.x, 0, feet.z - head.z).normalize()
const horizontal = Math.hypot(feet.x - head.x, feet.z - head.z)
// axis = up × (head→feet); a positive angle about it turns the feet end downward (feet above head -> lower them)
const angle = Math.atan2(feet.y - head.y, horizontal)
const axis = new Vector3(0, 1, 0).cross(along).normalize()
const { project } = await api()
const { project: p } = await project(shot.project)
const fc = structuredClone(p.extensions.topview.fcurves)
const D2R = Math.PI / 180, R2D = 180 / Math.PI
fc.userKeys ??= {}; fc.userKeys[ch.node] ??= {}
const node = p.scene.content.nodes.find((n) => n.id === ch.node)
const rotKeys = [...(fc.userKeys[ch.node].rotation ?? [])].sort((a, b) => a.frame - b.frame)
const rest = [node.transform.rotation.x, node.transform.rotation.y, node.transform.rotation.z]
const rotAt = (f) => rotKeys.length ? [0, 1, 2].map((i) => evalKeys(rotKeys.map((k) => [k.frame, k.value[i]]), f)) : rest
const base = rotAt(A)                                  // pose before the ramp (kept as is)
const q0 = new Quaternion().setFromEuler(new Euler(...base.map((v) => v * D2R), 'XYZ'))
// measured tilt is relative to the rotation already applied at the hold (re-running adds a correction, never undoes one)
const qMid = new Quaternion().setFromEuler(new Euler(...rotAt(Math.round((B + C) / 2)).map((v) => v * D2R), 'XYZ'))
const q1 = new Quaternion().setFromAxisAngle(axis, angle).multiply(qMid)
const keys = []
const at = (f, t) => { const e = new Euler().setFromQuaternion(q0.clone().slerp(q1, t), 'XYZ'); const v = [e.x, e.y, e.z].map((x, i) => { x *= R2D; while (x - base[i] > 180) x -= 360; while (x - base[i] < -180) x += 360; return Math.round(x * 1000) / 1000 }); keys.push({ id: `kf_flat_${f}`, frame: f, value: v, interpolation: 'linear' }) }
for (const k of rotKeys.filter((k) => k.frame < A)) keys.push(k)
if (!keys.length) at(0, 0)
at(A, 0)
for (let f = A + 2; f < B; f += 2) at(f, (f - A) / (B - A))
at(B, 1); at(C, 1)
for (let f = C + 4; f < D; f += 4) at(f, 1 - (f - C) / (D - C))
at(D, 0)
for (const k of rotKeys.filter((k) => k.frame > D)) keys.push(k)
fc.userKeys[ch.node].rotation = keys
const r = await applyScene(shot, p.scene, fc)
console.log(`rev ${r.revision}: ${key} tilted ${(angle * R2D).toFixed(1)}° flat over ${B}-${C}. Now: node ground.mjs <shot.json> ${key} …`)
