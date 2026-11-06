// Floor contact + fast fall for one character, from measured skeletons (no guessing):
//   node ground.mjs <shot.json> <char> [--hit H --land L] [--knock dx] [--from F]
// Without --hit: the character is kept on the floor from --from (default 0).
// With --hit/--land: no change before H; small pop-up then gravity fall to the floor at L; on the floor after L.
// Floor rule: torso rests on the floor (8 cm body radius), limbs may sink at most 5 cm.
// Always resets the character's Y curve to its base value and re-probes first (re-running never accumulates offsets).
import { loadShot, api, applyScene, runProbe, near, r4 } from './lib.mjs'
const shot = loadShot()
const key = process.argv[3]; const ch = shot.chars[key]; if (!ch) throw new Error('unknown char ' + key)
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? Number(process.argv[i + 1]) : d }
const HIT = arg('--hit', null), LAND = arg('--land', null), KNOCK = arg('--knock', 0), FROM = arg('--from', 0), END = shot.end
const { project, command } = await api()
async function curves() {
  const { project: p } = await project(shot.project)
  const fc = structuredClone(p.extensions.topview.fcurves)
  const node = p.scene.content.nodes.find((n) => n.id === ch.node)
  const get = (i) => { let c = fc.fcurves.find((x) => x.t[1] === ch.node && x.p === 'transform.position' && x.i === i); if (!c) { c = { id: `fc_${ch.node}_p${i}`, t: ['node', ch.node], p: 'transform.position', i, k: [] }; fc.fcurves.push(c) } return c }
  return { p, fc, node, get }
}
let { p, fc, node, get } = await curves()
const baseY = node.transform.position.y
get(1).k = [[0, baseY, 'linear', 'kgy_base']]
await applyScene(shot, p.scene, fc)
const { data } = await runProbe(shot)
const d = (f) => near(data, f)[key]
const hip = (f) => d(f).hip[1], low = (f) => Math.min(d(f).torso[0] - 0.08, d(f).low[0] + 0.05)
const y = [[0, baseY, 'linear', 'kgy_0']]
const start = HIT ?? FROM
if (start > 0) y.push([start - 1, baseY, 'linear', 'kgy_pre'])
const hip0 = HIT != null ? hip(HIT) : 0, hipLand = LAND != null ? hip(LAND) - low(LAND) : 0
for (let f = start; f < END; f += f < (LAND ?? start) + 90 ? 1 : 4) {
  let o
  if (HIT != null && f < LAND) {
    const t = (f - HIT) / (LAND - HIT)
    const bump = 0.15 * Math.sin(Math.PI * Math.min(1, t * 3)) * (t < 1 / 3 ? 1 : 0)
    o = Math.max(hip0 + (hipLand - hip0) * t ** 1.6 + bump - hip(f), -low(f))
  } else o = -low(f)
  y.push([f, r4(baseY + o), 'linear', `kgy_${f}`])
}
;({ p, fc, get } = await curves())
get(1).k = y
if (HIT != null && KNOCK) {
  const x = get(0); const x0 = x.k.length ? x.k[0][1] : node.transform.position.x
  x.k = [[0, x0, 'linear', 'kgx0'], [HIT, x0, 'linear', 'kgx1'], [HIT + Math.round((LAND - HIT) * 0.6), r4(x0 + KNOCK * 0.8), 'bezier', 'kgx2'], [LAND, r4(x0 + KNOCK), 'linear', 'kgx3']]
}
const r = await applyScene(shot, p.scene, fc)
console.log(`rev ${r.revision}: ${key} Y keys ${y.length}${HIT != null ? `, hit ${HIT} -> floor ${LAND}` : `, on floor from ${FROM}`}. Check: node gates.mjs (FLOOR)`)
