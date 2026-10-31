import { spawn } from 'node:child_process'
import { appendFileSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const editor = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const workspace = resolve(editor, '..')
const builder = join(editor, 'packages/builder')
const app3 = join(workspace, 'animation-studio')
const app3Work = join(app3, 'work/material_alpha_v1_31_8')
const output = join(editor, '.test-results')
mkdirSync(output, { recursive: true })

// Use the invoking pnpm executable on every platform, including Windows.
const pnpm = process.env.npm_execpath
  ? [process.execPath, process.env.npm_execpath]
  : [process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm']
const files = (directory) => readdirSync(directory).filter(name => name.endsWith('.test.ts')).sort().map(name => join(directory, name))
const nodeTests = (directory) => [process.execPath, '--import', 'tsx', '--test', '--test-reporter=tap', '--test-concurrency=1', ...files(directory)]
const steps = [
  ['install', [...pnpm, 'install', '--frozen-lockfile'], editor],
  ['builder-build', [...pnpm, '--filter', '@topview/3d-builder', 'build'], editor],
  ['typecheck', [...pnpm, 'typecheck'], editor],
  ['lint', [...pnpm, 'lint'], editor],
  ['builder-tests', [...pnpm, 'test:evaluate'], editor, 'vitest'],
  ['retarget-tests', nodeTests(join(editor, 'packages/retarget/test')), builder, 'tap'],
  ['studio-tests', nodeTests(join(editor, 'apps/studio/test')), builder, 'tap'],
  ['python-tests', [process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3'), '-m', 'unittest', '-v', 'agent.test_unified_cli', 'agent.test_unified_mcp', 'agent.test_shot_package'], workspace, 'python'],
  ['app3-build', [process.execPath, 'src/build.mjs'], app3Work],
  ['app3-features', [process.execPath, 'tools/check-features.mjs', '../editor/apps/studio/public/animation-studio/v1.31.8/index.html', 'outputs/Animation_Studio_v1_33_0.html'], app3],
  // The previously embedded copy must not lose controls either (see apps/studio/src/app3Embed.ts).
  ['app3-features-previous-embed', [process.execPath, 'tools/check-features.mjs', '../editor/apps/studio/public/animation-studio/v1.33.0/index.html', 'outputs/Animation_Studio_v1_33_0.html'], app3],
  ['app3-tests', [process.execPath, '--test', '--test-reporter=tap', 'src/shot_package.test.mjs', 'src/app3_workflow_steps.test.mjs', 'src/shot_lab.test.mjs'], app3Work, 'tap'],
]

function counts(text, format) {
  const clean = text.replace(/\x1b\[[0-9;]*m/g, '')
  if (format === 'tap') {
    const value = name => Number(clean.match(new RegExp('^# ' + name + ' (\\d+)$', 'm'))?.[1] ?? NaN)
    return { total: value('tests'), passed: value('pass'), failed: value('fail'), skipped: value('skipped'), cancelled: value('cancelled'), todo: value('todo') }
  }
  if (format === 'vitest') {
    const summary = clean.match(/^\s*Tests\s+(.+)$/m)?.[1] ?? ''
    const value = name => Number(summary.match(new RegExp('(\\d+) ' + name))?.[1] ?? 0)
    return { total: Number(summary.match(/\((\d+)\)/)?.[1] ?? NaN), passed: value('passed'), failed: value('failed'), skipped: value('skipped') }
  }
  const total = Number(clean.match(/Ran (\d+) tests? in /)?.[1] ?? NaN)
  const value = name => Number(clean.match(new RegExp(name + '=(\\d+)'))?.[1] ?? 0)
  const failed = value('failures') + value('errors') + value('unexpected successes')
  const skipped = value('skipped')
  const expectedFailures = value('expected failures')
  return { total, passed: total - failed - skipped - expectedFailures, failed, skipped, expectedFailures }
}

async function run([name, command, cwd, format]) {
  console.log(`\n=== ${name}: ${command.join(' ')} ===`)
  let text = ''
  const start = Date.now()
  const code = await new Promise(resolveCode => {
    const child = spawn(command[0], command.slice(1), { cwd, env: { ...process.env, FORCE_COLOR: '0' }, stdio: ['inherit', 'pipe', 'pipe'] })
    for (const [stream, destination] of [[child.stdout, process.stdout], [child.stderr, process.stderr]]) {
      stream.on('data', chunk => { text += chunk.toString(); destination.write(chunk) })
    }
    child.on('error', error => { text += error.stack; console.error(error.message) })
    child.on('close', code => resolveCode(code ?? 1))
  })
  writeFileSync(join(output, name + '.log'), text)
  const result = { name, status: code === 0 ? 'PASS' : 'FAIL', exitCode: code, seconds: Math.round((Date.now() - start) / 1000) }
  if (format) {
    result.counts = counts(text, format)
    if (!Number.isFinite(result.counts.total) || result.counts.total < 1) {
      result.status = 'FAIL'
      result.error = 'Test summary missing; see log. No test counts inferred.'
    }
  }
  return result
}

mkdirSync(join(app3, 'outputs'), { recursive: true })
const results = []
for (const step of steps) results.push(await run(step))
writeFileSync(join(output, 'summary.json'), JSON.stringify(results, null, 2) + '\n')
const rows = results.map(r => `| ${r.name} | ${r.status} | ${r.counts?.passed ?? '—'} | ${r.counts?.failed ?? '—'} | ${r.counts?.skipped ?? '—'} | ${r.seconds} |`)
const summary = ['## Test all', '', '| Suite / gate | Result | Passed | Failed | Skipped | Seconds |', '| --- | --- | ---: | ---: | ---: | ---: |', ...rows, '', 'Full logs and machine-readable counts: `three-workspace-app/editor/.test-results/`.', ''].join('\n')
console.log('\n' + summary)
writeFileSync(join(output, 'summary.md'), summary)
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary)
process.exitCode = results.some(result => result.status !== 'PASS') ? 1 : 0
