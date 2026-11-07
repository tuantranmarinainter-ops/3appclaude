// Shared contract for the w01-shot MCP tools.
// Each tool module in ./tools exports: { name, description, inputSchema, run(args) => Promise<string> }
//   name: [a-z_]+ (e.g. "shot_read"); description: <= 2 short sentences; run returns plain text, <= ~20 lines.
//   Large data goes to a file under <shot.work>/mcp/ and the text returns its path plus a short summary.
//   Throw an Error with a one-line message on bad input; the server turns it into an MCP error result.
import { existsSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { loadShot } from '../scripts/lib.mjs'

export const WORK_ROOT = process.env.W01_SHOT_WORK ?? 'S:/Claude/w01/work'

/** `shot` is a path to shot.json, a folder holding one, or a slug under WORK_ROOT (e.g. "s5" -> S:/Claude/w01/work/s5/shot.json). */
export function shotFile(shot) {
  if (!shot || typeof shot !== 'string') throw new Error('missing "shot" (path to shot.json or slug)')
  const cands = [shot, path.join(shot, 'shot.json'), path.join(WORK_ROOT, shot, 'shot.json')]
  const f = cands.find((c) => c.endsWith('.json') && existsSync(c))
  if (!f) throw new Error(`shot.json not found for "${shot}"`)
  return path.resolve(f)
}

/** Loads shot.json (refuses the real App 2 ports 3016/3002 via lib.loadShot) and sets W01_API for w01api.mjs. */
export function getShot(shot) {
  return loadShot(shotFile(shot))
}

// HTTP client: ./client.mjs exports client(shot) -> { project(), command(cmd, args) } bound to shot.api
// (w01api.mjs reads W01_API once at import, so a long-lived MCP server cannot use it for several shots).

export const r2 = (v) => Math.round(v * 100) / 100
