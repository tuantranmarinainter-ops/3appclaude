// Run probe.mts and print the gates (CONTINUITY / SEAM_JUMP / FLOOR / CONTACT). Exit 1 when any gate FAILs.
//   node gates.mjs <shot.json>
// shot.json knobs: "floor": [["go", 118, true]] (char, from frame, must stay on the floor), "fastFrames": [[96, 108]] (fast action,
// excluded from SEAM_JUMP), "contact": { "frame": 101, "char": "go" } (prop tip vs head top), "prev": { dir, id, frame }.
import { loadShot, runProbe } from './lib.mjs'
const shot = loadShot()
const { report } = await runProbe(shot)
console.log(report.trim())
process.exitCode = /^FAIL/m.test(report) ? 1 : 0
