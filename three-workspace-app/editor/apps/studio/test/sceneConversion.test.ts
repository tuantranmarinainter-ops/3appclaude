import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { makeEmptyDraft } from '@topview/3d-builder'
import { executeUnifiedCommand, readUnifiedProject } from '../src/unifiedProjectStore'
import { getUnifiedJob, readUnifiedJobFile, cancelUnifiedJob } from '../src/unifiedJobs'
import { validateSceneConversionArgs } from '../src/sceneConversion'
import { unzipPackage } from '../src/shotPackage'

const dir=mkdtempSync(path.join(tmpdir(),'scene-conversion-')),app=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../../..')
process.env.BBS_UNIFIED_PROJECTS_DIR=dir
const python=process.platform==='win32'?'python':'python3'
const blender=process.env.BBS_BLENDER_EXE||'blender'
const available=spawnSync(blender,['--version']).status===0
test.after(()=>rmSync(dir,{recursive:true,force:true}))
const hash=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex')
async function fixture() {
 const created=await executeUnifiedCommand({requestId:randomUUID(),command:'project.create',args:{name:'Scene conversion',scene:makeEmptyDraft('Scene conversion',30,60)}})
 const project=await readUnifiedProject(created.projectId),jobId=randomUUID(),folder=path.join(dir,project.projectId,'.jobs',jobId)
 const source=spawnSync(python,['-c','from agent.test_scene_model_converter import fixture_glb; import sys; sys.stdout.buffer.write(fixture_glb())'],{cwd:app})
 assert.equal(source.status,0,source.stderr.toString())
 mkdirSync(path.join(folder,'output'),{recursive:true});writeFileSync(path.join(folder,'output','scene.glb'),source.stdout)
 const now=new Date().toISOString(),record={jobId,projectId:project.projectId,type:'scene.export.glb',state:'succeeded',sourceRevision:0,sourceSha256:hash(Buffer.from(JSON.stringify(project))),progress:1,createdAt:now,updatedAt:now,result:{files:[{id:'0',name:'scene.glb',mimeType:'model/gltf-binary',sizeBytes:source.stdout.length,sha256:hash(source.stdout),path:'output/scene.glb'}],provenance:{},warnings:[],blockedRequests:[]}}
 writeFileSync(path.join(folder,'job.json'),JSON.stringify(record))
 return {project,jobId}
}

test('conversion preflight rejects paths, unknown IDs and stale revisions; dry-run is immutable',async()=>{
 const {project,jobId}=await fixture(),id=project.projectId
 for(const args of [{glbJobId:'../scene.glb'},{glbJobId:jobId,path:'/tmp/foo'}]) await assert.rejects(validateSceneConversionArgs(project,args as any),/glbJobId/)
 await assert.rejects(validateSceneConversionArgs({...project,revision:1},{glbJobId:jobId}),/stale/)
 const dry=await executeUnifiedCommand({requestId:randomUUID(),projectId:id,command:'scene.export.blend-fbx',args:{glbJobId:jobId},dryRun:true})
 assert.equal(dry.result.valid,true);assert.equal((await readUnifiedProject(id)).revision,0)
})

test('queued conversion cancellation terminates without publishing output',async()=>{
 const {project,jobId}=await fixture()
 const response=await executeUnifiedCommand({requestId:randomUUID(),projectId:project.projectId,command:'scene.export.blend-fbx',args:{glbJobId:jobId}})
 const result=await cancelUnifiedJob(response.result.jobId as string,project.projectId)
 assert.equal(result.state,'cancelled');assert.equal(result.committed,false)
 assert.equal(await readUnifiedJobFile(response.result.jobId as string,project.projectId,'0'),null)
})

test('Blender job exports verified .blend and FBX ZIP artifacts and replays without a new job',{skip:available?false:'NOT_RUN: Blender is not installed'},async()=>{
 const {project,jobId}=await fixture(),envelope={requestId:randomUUID(),projectId:project.projectId,expectedRevision:0,command:'scene.export.blend-fbx',args:{glbJobId:jobId}}
 const response=await executeUnifiedCommand(envelope);assert.deepEqual(await executeUnifiedCommand(envelope),response)
 let job=await getUnifiedJob(response.result.jobId as string,project.projectId)
 for(let attempt=0;attempt<300&&['queued','running'].includes(job.state);attempt++) {await new Promise(r=>setTimeout(r,100));job=await getUnifiedJob(job.jobId,project.projectId)}
 assert.equal(job.state,'succeeded',JSON.stringify(job))
 const artifact=await readUnifiedJobFile(job.jobId,project.projectId,'0');assert.ok(artifact)
 const files=unzipPackage(artifact.bytes);assert.deepEqual(Object.keys(files).sort(),['report.json','scene.blend','scene.fbx'])
 assert.ok(Buffer.from(files['scene.blend']!).subarray(0,7).equals(Buffer.from('BLENDER')))
 assert.ok(Buffer.from(files['scene.fbx']!).subarray(0,18).toString().startsWith('Kaydara FBX Binary'))
 const report=JSON.parse(Buffer.from(files['report.json']!).toString())
 for(const file of report.files)assert.equal(hash(Buffer.from(files[file.name]!)),file.sha256)
 assert.equal((await readUnifiedProject(project.projectId)).revision,0)
})
