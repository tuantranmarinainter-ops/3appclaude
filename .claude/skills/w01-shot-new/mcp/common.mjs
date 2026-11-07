// Helpers shared by the shot_read / shot_edit tools (not a tool module itself).
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

export const clipsOf = (p) => p.scene.content.timeline.animation.motionClips
export const nodesOf = (p) => p.scene.content.nodes

/** clips.json in the work folder: { key: clipId } (empty when absent). */
export function readClipKeys(shot) {
  const f = path.join(shot.work, 'clips.json')
  return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : {}
}

/** char key (shot.chars) or raw node id -> node id */
export function nodeId(shot, ref) {
  if (shot.chars?.[ref]) return shot.chars[ref].node
  return ref
}
export const charKeyOf = (shot) => Object.fromEntries(Object.entries(shot.chars ?? {}).map(([k, v]) => [v.node, k]))

/** clip key (clips.json) or clip id -> clip id */
export function clipId(shot, ref) {
  const keys = readClipKeys(shot)
  return keys[ref] ?? ref
}

export function writeMcpFile(shot, name, data) {
  const dir = path.join(shot.work, 'mcp')
  mkdirSync(dir, { recursive: true })
  const f = path.join(dir, name)
  writeFileSync(f, JSON.stringify(data, null, 2))
  return f
}

/** Prints at most `max` rows; when more, writes everything to <work>/mcp/<file> and notes it. */
export function limitRows(shot, rows, fileName, data, max = 22) {
  if (rows.length <= max) return rows
  const f = writeMcpFile(shot, fileName, data)
  return [...rows.slice(0, max), `… ${rows.length - max} more rows; full JSON: ${f}`]
}

export const num = (v) => (typeof v === 'number' && Number.isFinite(v))
export const int = (v) => Number.isInteger(v)
