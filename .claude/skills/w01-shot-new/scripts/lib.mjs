// Shared helpers for w01-shot-new scripts. Every script takes the path of a shot config (shot.json) as its first argument.
// shot.json (written by new-shot.py, edited by hand):
// {
//   "project": "<uuid>", "api": "http://127.0.0.1:3141", "projectsDir": "S:/Claude/w01-samples/s4-projects",
//   "library": "S:/Claude/w01-samples/s4-lib", "editor": "S:/Claude/w01-film/three-workspace-app/editor",
//   "work": "S:/Claude/w01/work/shot04", "end": 300, "camera": "camera_1",
//   "chars": { "hero": { "node": "user_chr_…", "char": "<characterId>", "hand": "low_right_arm_end" }, "go": { … } },
//   "prop": { "node": "user_prop_…", "follow": "hero", "bone": "low_right_arm_end", "tip": [0, 1.0, 0] }
// }
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'

export const here = path.dirname(fileURLToPath(import.meta.url))
export function loadShot(file = process.argv[2]) {
  if (!file || !existsSync(file)) throw new Error('usage: <script> <shot.json> …  (shot.json from new-shot.py)')
  const shot = JSON.parse(readFileSync(file, 'utf8'))
  shot.file = path.resolve(file)
  shot.work ??= path.dirname(shot.file)
  process.env.W01_API = shot.api
  if (/:(3016|3002)\b/.test(shot.api)) throw new Error('shot.json points at the real App 2: these scripts only write sandboxes')
  return shot
}
export async function api() {
  return import(pathToFileURL(path.join(here, '../../w01-shot-edit/scripts/w01api.mjs')).href)
}
export const three = async (shot) => import(pathToFileURL(path.join(shot.editor, 'node_modules/.pnpm/node_modules/three/build/three.module.js')).href)
export const r4 = (v) => Math.round(v * 10000) / 10000
export const kid = (prefix, f) => `${prefix}_${f}_${Math.random().toString(36).slice(2, 6)}`
export function readJson(file, fallback) { return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : fallback }
export function writeJson(file, value) { writeFileSync(file, JSON.stringify(value, null, 2)) }
/** clips.json in the work folder: { key: clipId } created by place.mjs and continue-from.mjs */
export const clipsFile = (shot) => path.join(shot.work, 'clips.json')
export const probeFile = (shot) => path.join(shot.work, 'probe.json')
/** Replace the whole scene and F-curves in one undoable command. */
export async function applyScene(shot, scene, fcurves) {
  const { command } = await api()
  return command(shot.project, 'scene.apply', { operations: [{ type: 'document.replace', document: scene, fcurves }] })
}
/** Nearest sampled frame (the sampler skips a few frames at clip seams). */
export function near(data, f) {
  for (let d = 0; d < 12; d++) { if (data[f - d]) return data[f - d]; if (data[f + d]) return data[f + d] }
  throw new Error(`no probe data near frame ${f}: run probe.mts first`)
}
/** Piecewise-linear value of an App 2 F-curve key list [[frame, value, interp, id], …] (bezier treated as linear). */
export function evalKeys(k, f) {
  if (!k.length) return 0
  if (f <= k[0][0]) return k[0][1]
  for (let i = 0; i < k.length - 1; i++) if (f >= k[i][0] && f <= k[i + 1][0]) { const t = (f - k[i][0]) / (k[i + 1][0] - k[i][0] || 1); return k[i][1] + (k[i + 1][1] - k[i][1]) * t }
  return k.at(-1)[1]
}
/** Runs probe.mts (tsx, in-process skeleton sampling) and returns its JSON. */
export async function runProbe(shot, extra = []) {
  const { spawnSync } = await import('node:child_process')
  const cmd = ['pnpm', '--filter', '@topview/3d-builder', 'exec', 'tsx', JSON.stringify(path.join(here, 'probe.mts')), JSON.stringify(shot.file), ...extra].join(' ')
  const r = spawnSync(cmd, { cwd: shot.editor, shell: true, encoding: 'utf8', env: { ...process.env, W01_LIBRARY: shot.library, BBS_UNIFIED_PROJECTS_DIR: shot.projectsDir } })
  if (r.status !== 0) throw new Error('probe failed:\n' + (r.stderr || r.stdout).slice(-2000))
  const json = readJson(probeFile(shot))
  return { report: r.stdout, data: json.data, revision: json.revision }
}
