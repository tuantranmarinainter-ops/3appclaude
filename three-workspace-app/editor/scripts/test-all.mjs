import { spawn } from 'node:child_process'
import { appendFileSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const editor = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const app = resolve(editor, '..')
const app3 = join(app, 'animation-studio')
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
const python = process.env.PYTHON_EXECUTABLE || (process.platform === 'win32' ? 'python' : 'python3')
const tests = dir => readdirSync(join(editor, dir)).filter(n => n.endsWith('.test.ts')).sort().map(n => join(editor, dir, n))
const steps = [
  ['Builder build', editor, pnpm, ['--filter', '@topview/3d-builder', 'build']],
  ['Typecheck', editor, pnpm, ['typecheck']],
  ['Lint/locales', editor, pnpm, ['lint']],
  ['Builder tests', editor, pnpm, ['test:evaluate']],
  ['Retarget tests', join(editor,'packages/builder'), pnpm, ['exec','tsx','--test','--test-reporter=tap',...tests('packages/retarget/test')]],
  ['Studio tests', join(editor,'packages/builder'), pnpm, ['exec','tsx','--test','--test-reporter=tap',...tests('apps/studio/test')]],
  ['Python tests', app, python, ['-m','unittest','agent.test_unified_cli','agent.test_unified_mcp','agent.test_shot_package']],
  ['App 3 build', app3, process.execPath, ['work/material_alpha_v1_31_8/src/build.mjs']],
  ['App 3 features', app3, process.execPath, ['tools/check-features.mjs','../editor/apps/studio/public/animation-studio/v1.31.8/index.html','outputs/Animation_Studio_v1_32_0.html']],
  ['App 3 tests', join(app3,'work/material_alpha_v1_31_8'), process.execPath, ['--test','--test-reporter=tap','src/shot_package.test.mjs']],
]
mkdirSync(join(app3,'outputs'),{recursive:true})
const results=[]
for (const [name,cwd,command,args] of steps) {
  console.log(`\n>>> ${name}`)
  const started=Date.now()
  let output=''
  const code=await new Promise(resolveExit=>{
    const child=spawn(command,args,{cwd,env:{...process.env,FORCE_COLOR:'0'},stdio:['ignore','pipe','pipe']})
    for(const stream of [child.stdout,child.stderr]) stream.on('data',chunk=>{output+=chunk;process.stdout.write(chunk)})
    child.on('error',err=>{output+=String(err);console.error(err)})
    child.on('close',code=>resolveExit(code ?? 1))
  })
  const count = label => Number(output.match(new RegExp(`^# ${label} (\\d+)`,'m'))?.[1] ?? 0)
  let counts
  if(/^# tests /m.test(output)) counts={tests:count('tests'),passed:count('pass'),failed:count('fail'),skipped:count('skipped')}
  else if(name==='Python tests') { const n=Number(output.match(/Ran (\d+) tests?/)?.[1] ?? 0); const skips=Number(output.match(/skipped=(\d+)/)?.[1] ?? 0); const failed=Number(output.match(/failures=(\d+)/)?.[1] ?? 0)+Number(output.match(/errors=(\d+)/)?.[1] ?? 0); counts={tests:n,passed:code===0?n-skips:Math.max(0,n-skips-failed),failed,skipped:skips} }
  else if(name==='Builder tests') { const line=output.match(/^\s*Tests\s+(.+)$/m)?.[1] ?? ''; const n=kind=>Number(line.match(new RegExp(`(\\d+) ${kind}`))?.[1]??0); counts={passed:n('passed'),failed:n('failed'),skipped:n('skipped')};counts.tests=counts.passed+counts.failed+counts.skipped }
  results.push({name,status:code===0?'PASS':'FAIL',exitCode:code,elapsedMs:Date.now()-started,...counts})
  // Keep independent suites running to give a complete report, but never hide a nonzero exit status.
}
const summaryDir=join(editor,'.test-results')
mkdirSync(summaryDir,{recursive:true})
writeFileSync(join(summaryDir,'summary.json'),JSON.stringify({results},null,2)+'\n')
console.table(results.map(({name,status,tests,passed,failed,skipped})=>({name,status,tests,passed,failed,skipped})))
if(process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY,'## Test results\n\n| Suite | Status | Passed | Failed | Skipped |\n| --- | --- | --- | --- | --- |\n'+results.map(r=>`| ${r.name} | ${r.status} | ${r.passed??'—'} | ${r.failed??'—'} | ${r.skipped??'—'} |`).join('\n')+'\n')
process.exitCode=results.some(r=>r.exitCode!==0)?1:0
