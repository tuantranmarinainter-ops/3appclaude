/**
 * Block backdrops for the Tập 15 storyboard (docs/storyboards): (A) ruined arena at sunset, (B) ruined street where Gà wakes.
 * Flat-coloured boxes in metres around the origin, deterministic (seeded), imported into App 2 as props.
 *
 *   node --import tsx ../retarget/cli/minecraftSets.ts --out <dir>      (from packages/builder)
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { setGlb, type SetBox } from './minecraftBlockCharacters.ts'

function random(seed: number) {
  return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296 }
}
const STONE = ['#6B6E73', '#5F6267', '#55585D', '#4A4D52'], MOSS = '#5C6B45', LANTERN = '#FFB347', SUN = '#FFE08A'
const cube = (x: number, y: number, z: number, sx: number, sy: number, sz: number, color: string): SetBox => ({ min: [x - sx / 2, y, z - sz / 2], max: [x + sx / 2, y + sy, z + sz / 2], color })

/** Stone floor of 2 m tiles (two shades), replacing the editor grid. */
function floor(half: number, rnd: () => number): SetBox[] {
  const boxes: SetBox[] = []
  for (let x = -half; x < half; x += 2) for (let z = -half; z < half; z += 2) boxes.push({ min: [x, -0.1, z], max: [x + 2, 0, z + 2], color: rnd() < 0.5 ? '#3E3F43' : '#47484C' })
  return boxes
}

export function arena(): SetBox[] {
  const rnd = random(15), boxes = floor(30, rnd)
  const ring = 24, radius = 11
  const top: number[] = []
  for (let i = 0; i < ring; i++) {
    const a = (i / ring) * Math.PI * 2, x = Math.sin(a) * radius, z = -Math.cos(a) * radius
    const height = 4 + rnd() * 5; top.push(height)
    // Pillar of stacked 1 m blocks with random shades, some missing near the top (ruined).
    for (let y = 0; y < height; y += 1) if (y < 3 || rnd() > 0.15) boxes.push(cube(x, y, z, 1.4, 1, 1.4, y > 2 && rnd() < 0.2 ? MOSS : STONE[Math.floor(rnd() * STONE.length)]!))
    if (rnd() < 0.35) boxes.push(cube(x * 0.97, 2.2, z * 0.97, 0.35, 0.35, 0.35, LANTERN))
  }
  // Lintels between neighbouring pillars that are both tall enough form the arches; a few are broken.
  for (let i = 0; i < ring; i++) {
    const j = (i + 1) % ring, h = Math.min(top[i]!, top[j]!) - 1
    if (h < 4 || rnd() < 0.3) continue
    const a = ((i + 0.5) / ring) * Math.PI * 2, x = Math.sin(a) * radius, z = -Math.cos(a) * radius, span = 2 * Math.PI * radius / ring
    const yaw = -a, cx = Math.cos(yaw), sz = Math.sin(yaw)
    for (let k = -1; k <= 1; k++) boxes.push(cube(x + cx * k * span / 3, h, z + sz * k * span / 3, 1.2, 1, 1.2, STONE[(i + k + 4) % 4]!))
  }
  // Second ring further out: taller silhouettes (towers) for the horizon.
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2 + 0.2, x = Math.sin(a) * 22, z = -Math.cos(a) * 22, h = 6 + rnd() * 8
    boxes.push(cube(x, 0, z, 3, h, 3, STONE[3]!))
    if (rnd() < 0.5) boxes.push(cube(x, h, z, 1.5, 2, 1.5, STONE[2]!))
  }
  // Rubble on the floor and debris floating in the air (the storyboard's flying blocks).
  // Keep the 7 m around the origin clear: actors stand there and cameras sit within ~6 m.
  for (let i = 0; i < 40; i++) { const a = rnd() * Math.PI * 2, r = 7 + rnd() * 3, s = 0.4 + rnd() * 0.6; boxes.push(cube(Math.sin(a) * r, 0, -Math.cos(a) * r, s, s, s, STONE[Math.floor(rnd() * 4)]!)) }
  for (let i = 0; i < 30; i++) { const a = rnd() * Math.PI * 2, r = 8 + rnd() * 6, s = 0.3 + rnd() * 0.5; boxes.push(cube(Math.sin(a) * r, 3 + rnd() * 6, -Math.cos(a) * r, s, s, s, STONE[Math.floor(rnd() * 4)]!)) }
  boxes.push(cube(0, 5, -45, 6, 6, 0.5, SUN), cube(28, 5, -35, 5, 5, 0.5, SUN))
  return boxes
}

export function street(): SetBox[] {
  const rnd = random(18), boxes = floor(30, rnd)
  for (let z = 6; z > -60; z -= 1.5) boxes.push({ min: [-3, -0.05, z - 1.5], max: [3, 0.02, z], color: rnd() < 0.5 ? '#5B5B5E' : '#66666A' })
  for (const side of [-1, 1]) {
    for (let z = 4; z > -58; z -= 2) {
      if (rnd() < 0.12) continue // gaps between ruined houses
      const h = 2 + rnd() * 5, x = side * (4 + rnd() * 0.6)
      for (let y = 0; y < h; y += 1) boxes.push(cube(x, y, z, 2, 1, 2, rnd() < 0.15 ? MOSS : STONE[Math.floor(rnd() * 4)]!))
      if (rnd() < 0.25) boxes.push(cube(x - side * 1.1, 0, z + 0.6, 0.6, 0.6, 0.6, STONE[1]!))
    }
    for (let z = 2; z > -54; z -= 7) { boxes.push(cube(side * 3.2, 0, z, 0.2, 2.6, 0.2, '#3A2E22'), cube(side * 3.2, 2.6, z, 0.45, 0.45, 0.45, LANTERN)) }
  }
  boxes.push(cube(0, 4, -64, 6, 6, 0.5, SUN))
  return boxes
}

async function main(out: string) {
  mkdirSync(out, { recursive: true })
  for (const [name, boxes] of [['arena', arena()], ['street', street()]] as const) {
    const bytes = setGlb(name, boxes); writeFileSync(join(out, `${name}.set.glb`), bytes); console.log(`wrote ${name}.set.glb ${bytes.length} B, ${boxes.length} boxes`)
  }
}

if (process.argv[1]?.endsWith('minecraftSets.ts')) {
  const { values } = parseArgs({ options: { out: { type: 'string' } } })
  if (!values.out) throw new TypeError('--out <dir> is required')
  void main(values.out)
}
