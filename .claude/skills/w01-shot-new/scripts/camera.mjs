// Camera keys from a list of [frame, eye[x,y,z], target[x,y,z]] (look-at, Euler XYZ degrees, bezier between keys).
//   node camera.mjs <shot.json> camera.json        camera.json: [[0,[0.6,1.3,8.8],[2,2,1.2]], [101,[2.3,2.8,6.8],[4.7,4,1.2]], …]
// Rhythm: far apart keys = slow moves (dialogue), close keys = fast push/pan (attacks). Check framing with stills.
import { readFileSync } from 'node:fs'
import { loadShot, api, applyScene, r4 } from './lib.mjs'
const shot = loadShot()
const list = JSON.parse(readFileSync(process.argv[3], 'utf8'))
const CAM = shot.camera ?? 'camera_1'
const { Euler, Matrix4, Quaternion, Vector3 } = await import(`file:///${shot.editor}/node_modules/.pnpm/node_modules/three/build/three.module.js`)
const R2D = 180 / Math.PI, ch = [[], [], [], [], [], []]; let prev = null
for (const [f, eye, target] of list) {
  const m = new Matrix4().lookAt(new Vector3(...eye), new Vector3(...target), new Vector3(0, 1, 0))
  const e = new Euler().setFromQuaternion(new Quaternion().setFromRotationMatrix(m), 'XYZ')
  let v = [...eye, e.x * R2D, e.y * R2D, e.z * R2D]
  if (prev) v = v.map((x, i) => { if (i < 3) return x; while (x - prev[i] > 180) x -= 360; while (x - prev[i] < -180) x += 360; return x })
  v.forEach((x, i) => ch[i].push([f, r4(x), 'bezier', `kf_cam_${i}_${f}`])); prev = v
}
const { project } = await api()
const { project: p } = await project(shot.project)
const fc = structuredClone(p.extensions.topview.fcurves)
fc.fcurves = fc.fcurves.filter((c) => c.t[1] !== CAM)
const names = ['position', 'position', 'position', 'rotation', 'rotation', 'rotation']
ch.forEach((k, i) => fc.fcurves.push({ id: `fc_cam_${names[i]}_${i % 3}`, t: ['node', CAM], p: `transform.${names[i]}`, i: i % 3, k }))
const r = await applyScene(shot, p.scene, fc)
console.log(`rev ${r.revision}: ${CAM} ${list.length} keys`)
