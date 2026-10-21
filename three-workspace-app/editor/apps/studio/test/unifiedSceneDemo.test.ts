import assert from 'node:assert/strict'
import test from 'node:test'
import {createServer} from 'node:http'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {randomUUID,createHash} from 'node:crypto'
import {mkdtempSync,readFileSync,writeFileSync,copyFileSync,mkdirSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {chromium} from 'playwright'
import {makeEmptyDraft} from '@topview/3d-builder'
import {executeUnifiedCommand,readUnifiedProject} from '../src/unifiedProjectStore'
import {stageAssetUpload} from '../src/unifiedAssetFiles'
import {POST as session} from '../app/api/unified/session/route'
import {POST as command} from '../app/api/unified/commands/route'
import {GET as project} from '../app/api/unified/projects/[id]/route'
import {GET as file} from '../app/api/unified/projects/[id]/jobs/[jobId]/files/[fileId]/route'

const exec=promisify(execFile)
const workspace=path.resolve(process.cwd(),'../../..')
const dir=mkdtempSync(path.join(tmpdir(),'g4-mcp-scene-'));process.env.BBS_UNIFIED_PROJECTS_DIR=path.join(dir,'projects')
test.after(()=>rmSync(dir,{recursive:true,force:true}))

/** HTTP transport around the actual route handlers: real sessions, broker, jobs, renderer and downloads. */
async function serve(){
 let base=''
 const server=createServer(async(req,res)=>{
  try{
   const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk))
   const headers=new Headers();for(const [key,value] of Object.entries(req.headers))if(value)headers.set(key,Array.isArray(value)?value.join(','):value)
   const request=new Request(base+req.url,{method:req.method,headers,...(req.method==='POST'?{body:new Uint8Array(Buffer.concat(chunks))}:{})})
   const route=req.url!,asset=/^\/api\/unified\/projects\/([^/]+)\/jobs\/([^/]+)\/files\/([^/]+)$/.exec(route),snapshot=/^\/api\/unified\/projects\/([^/]+)$/.exec(route)
   let response:Response
   if(route==='/api/unified/session'&&req.method==='POST')response=await session(request)
   else if(route==='/api/unified/commands'&&req.method==='POST')response=await command(request)
   else if(asset)response=await file(request,{params:Promise.resolve({id:asset[1]!,jobId:asset[2]!,fileId:asset[3]!})})
   else if(snapshot)response=await project(request,{params:Promise.resolve({id:snapshot[1]!})})
   else response=Response.json({error:'NOT_FOUND'},{status:404})
   res.writeHead(response.status,Object.fromEntries(response.headers.entries()));res.end(Buffer.from(await response.arrayBuffer()))
  }catch(error){res.writeHead(500,{'content-type':'application/json'});res.end(JSON.stringify({error:String(error)}))}
 })
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve))
 const address=server.address();assert.ok(address&&typeof address!=='string');base=`http://127.0.0.1:${address.port}`
 return {base,close:()=>new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()))}
}

test('G4 text scenario uses real stdio MCP G1 → G2 → G3 and exports verified before/after scene renders',{timeout:180000},async t=>{
 let browser
 try{browser=await chromium.launch({headless:true})}catch(error){if(/Executable doesn't exist|playwright install/i.test(String(error))){t.skip('NOT_RUN: Chromium executable absent; install with pnpm --filter @topview/3d-studio exec playwright install chromium');return}throw error}
 await browser.close()
 // Asset bootstrap is a fixture, not part of the described scenario. Every scenario command below goes through MCP.
 const scene=makeEmptyDraft('G4: two actors',30,60,{fov:50,position:{x:0,y:2,z:8},rotation:{x:0,y:0,z:0},lookAt:{x:0,y:1,z:0}})
 scene.content.aspectRatio='16:9'
 const id=(await executeUnifiedCommand({requestId:randomUUID(),command:'project.create',args:{name:'G4 scenario',scene}})).projectId
 const bytes=readFileSync(path.join(workspace,'builtin-assets/characters/a3d_char_30ec53c93eae4173946b38639691ebe0.glb'))
 const upload=await stageAssetUpload('actor.glb',new ReadableStream({start(c){c.enqueue(bytes);c.close()}}))
 const imported=await executeUnifiedCommand({requestId:randomUUID(),projectId:id,expectedRevision:0,command:'asset.import',args:{files:[upload.id],format:'glb'}})
 const ids:string[]=[]
 for(const [name,x] of [['A',-2.5],['B',2.5]] as const){
  const result=await executeUnifiedCommand({requestId:randomUUID(),projectId:id,expectedRevision:ids.length+1,command:'character.add',args:{assetId:(imported.result.assetIds as string[])[0],skeletonId:(imported.result.skeletonIds as string[])[0],name,transform:{position:{x,y:0,z:0},rotation:{x:0,y:0,z:0},scale:{x:1,y:1,z:1}}}})
  ids.push(result.result.characterId as string)
 }
 const baseline=await readUnifiedProject(id),transport=await serve(),output=path.join(dir,'output');mkdirSync(output)
 try{
  const {stdout}=await exec(process.env.PYTHON??(process.platform==='win32'?'python':'python3'),['-m','agent.unified_scene_demo',id,...ids,'--output',output],{cwd:workspace,env:{...process.env,BBS_APP_URL:transport.base},timeout:150000,maxBuffer:1024*1024})
  assert.equal(JSON.parse(stdout).status,'PASS')
  const report=JSON.parse(readFileSync(path.join(output,'g4-report.json'),'utf8'))
  assert.ok(report.positionErrorMeters<=0.01);assert.ok(report.yawErrorDegrees<=1);assert.equal(report.revisionDelta,2);assert.ok(report.maxProjectedAbs<1)
  const commands=report.transcript.filter((r:any)=>r.request.method==='tools/call').map((r:any)=>r.request.params.arguments.command)
  for(const name of ['scene.layout.read','scene.layout.preview','scene.layout.apply','camera.framing.preview','camera.framing.apply'])assert.ok(commands.includes(name),name)
  assert.equal(commands.filter((n:string)=>n==='scene.render').length,2)
  assert.ok(commands.indexOf('scene.layout.read')<commands.indexOf('scene.layout.preview')&&commands.indexOf('scene.layout.apply')<commands.indexOf('camera.framing.preview'))
  assert.equal((await readUnifiedProject(id)).revision,baseline.revision+2)
  const artifact=path.resolve(process.cwd(),'../../.test-results/g4-scene-demo');mkdirSync(artifact,{recursive:true})
  const hashes:string[]=[]
  for(const name of ['before','after']){
   const png=readFileSync(report[name].image);assert.equal(png.subarray(1,4).toString(),'PNG');assert.equal(png.readUInt32BE(16),640);assert.equal(png.readUInt32BE(20),360);assert.ok(png.length>5000)
   assert.deepEqual(report[name].blockedRequests,[])
   hashes.push(createHash('sha256').update(png).digest('hex'));copyFileSync(report[name].image,path.join(artifact,`${name}.png`))
   report[name].image=`${name}.png`
  }
  assert.notEqual(hashes[0],hashes[1]);report.imageSha256={before:hashes[0],after:hashes[1]}
  writeFileSync(path.join(artifact,'report.json'),JSON.stringify(report,null,2))
  console.log('G4 measurements',JSON.stringify({positionErrorMeters:report.positionErrorMeters,yawErrorDegrees:report.yawErrorDegrees,maxProjectedAbs:report.maxProjectedAbs,revisionDelta:report.revisionDelta,imageSha256:report.imageSha256,artifacts:artifact}))
 }finally{await transport.close()}
})

test('G4 agent CLI/MCP unit coverage runs in test:all',async()=>{
 const {stderr}=await exec(process.env.PYTHON??(process.platform==='win32'?'python':'python3'),['-m','unittest','agent.unified_scene_demo_test','agent.unified_layout_test'],{cwd:workspace,env:process.env,timeout:30000})
 assert.match(stderr,/Ran [1-9][0-9]* tests/);assert.match(stderr,/OK/)
})
