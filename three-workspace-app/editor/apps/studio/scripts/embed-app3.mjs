#!/usr/bin/env node
// Builds App 3 (Animation Studio) from the committed source and publishes it as
// public/animation-studio/v<version>/ for App 2's iframe. Usage:
//   node scripts/embed-app3.mjs --version 1.34.0 [--force] [--allow-dirty]
// App 3 is GPL-3.0: its LICENSE and NOTICE travel with every embedded copy.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const args = process.argv.slice(2)
const option = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined }
const version = option('--version')
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error('Usage: node scripts/embed-app3.mjs --version <x.y.z> [--force] [--allow-dirty]')
  process.exit(2)
}
const studio = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const workspace = path.resolve(studio, '../../..') // three-workspace-app
const repo = path.resolve(workspace, '..')
const app3 = path.join(workspace, 'animation-studio')
const work = path.join(app3, 'work/material_alpha_v1_31_8')
const target = path.join(studio, 'public/animation-studio', 'v' + version)
const git = (...a) => execFileSync('git', a, { cwd: repo, encoding: 'utf8' }).trim()

// Dependencies and build output are not source; a symlinked node_modules is not matched by `node_modules/`.
const dirty = git('status', '--porcelain', '--', path.relative(repo, app3), ':!**/node_modules', ':!**/outputs')
if (dirty && !args.includes('--allow-dirty')) {
  console.error('animation-studio/ has uncommitted changes; commit them or pass --allow-dirty.\n' + dirty)
  process.exit(1)
}
if (existsSync(target)) {
  if (!args.includes('--force')) {
    console.error(`${path.relative(repo, target)} already exists; pass --force to rebuild it.`)
    process.exit(1)
  }
  rmSync(target, { recursive: true })
}
const commit = git('rev-parse', 'HEAD')
execFileSync(process.execPath, ['src/build.mjs'], { cwd: work, stdio: 'inherit' })
// build.mjs always writes this fixed name; the embedded folder carries the real version.
const built = path.join(app3, 'outputs/Animation_Studio_v1_33_0.html')
const bridge = path.join(work, 'src/host_bridge.js')
mkdirSync(target, { recursive: true })
copyFileSync(built, path.join(target, 'index.html'))
copyFileSync(bridge, path.join(target, 'host-bridge.js'))
copyFileSync(path.join(app3, 'LICENSE'), path.join(target, 'LICENSE'))
copyFileSync(path.join(app3, 'NOTICE'), path.join(target, 'NOTICE'))
const sha = (file) => createHash('sha256').update(readFileSync(file)).digest('hex')
const channel = readFileSync(bridge, 'utf8').match(/const CHANNEL = '([^']+)'/)?.[1] ?? '(không tìm thấy)'
writeFileSync(path.join(target, 'README.md'), `# Animation Studio ${version}

Bản App 3 nhúng trong App 2, build từ \`three-workspace-app/animation-studio/work/material_alpha_v1_31_8/src\`
tại commit \`${commit}\` bằng \`node scripts/embed-app3.mjs --version ${version}\` (trong \`editor/apps/studio\`).

| Tệp | SHA-256 |
| --- | --- |
| \`index.html\` | \`${sha(path.join(target, 'index.html'))}\` |
| \`host-bridge.js\` | \`${sha(path.join(target, 'host-bridge.js'))}\` (chép nguyên byte từ \`src/host_bridge.js\`) |

Kênh cầu nối: \`${channel}\` (phiên bản giao thức, không đổi theo số build).

Quay lại bản cũ: đổi \`APP3_EMBED_VERSION\` trong \`editor/apps/studio/src/app3Embed.ts\`.

App 3 phân phối theo GPL-3.0 (xem \`LICENSE\`, \`NOTICE\` bên cạnh). App 2 chỉ chạy App 3 trong iframe và trao đổi
bằng \`postMessage\`; không import mã App 3.
`)
console.log(`Embedded App 3 ${version} from ${commit.slice(0, 7)} → ${path.relative(repo, target)}`)
