import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { shotFile } from '../util.mjs'

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../scripts/build.mjs')

export default {
  name: 'shot_build',
  description: 'Run the shot.json "build" sequence (scripts/build.mjs) and return its report plus exit status.',
  inputSchema: {
    type: 'object',
    properties: { shot: { type: 'string' }, from: { type: 'string', description: 'step number or name' }, only: { type: 'string', description: 'step number or name' }, dry: { type: 'boolean' } },
    required: ['shot'],
  },
  async run({ shot, from, only, dry }) {
    const args = [script, shotFile(shot)]
    if (from != null) args.push('--from', String(from))
    if (only != null) args.push('--only', String(only))
    if (dry) args.push('--dry')
    const r = spawnSync(process.execPath, args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
    const out = ((r.stdout ?? '') + (r.stderr ? '\n' + r.stderr : '')).trim()
    return `${out}\nexit ${r.status}`
  },
}
