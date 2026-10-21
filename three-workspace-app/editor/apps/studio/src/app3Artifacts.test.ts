import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { UnifiedProject } from '@bbs/animation-workspace-shared'
import { executeApp3Bridge } from './app3Bridge'
import { executeApp3Artifacts, validateApp3ResultPython, validateApp3ShotPython } from './app3Artifacts'
import { stageAssetUpload } from './unifiedAssetFiles'
import { readUnifiedJobFile } from './unifiedJobs'
import { validateResult, type PackageFiles } from './shotPackage'

const identity=(l:Record<string,unknown>)=>Object.fromEntries(['sessionId','epoch','characterId','serverInstance'].map(k=>[k,l[k]]))
const receiver=(l:Record<string,unknown>)=>({...identity(l),receiverToken:l.receiverToken})
test('real Python TASK-2 result validator accepts the contract example and rejects hash/unsafe packages',async()=>{
 const docs=await readFile(new URL('../../../../../docs/SHOT-PACKAGE-CONTRACT.md',import.meta.url),'utf8'),shot:PackageFiles={},result:PackageFiles={}
 for(const m of docs.matchAll(/<!-- example:(shot|result)\/(.*?) -->\s*```json\n([\s\S]*?)\n```/g))(m[1]==='shot'?shot:result)[m[2]!]=Buffer.from(m[3]+'\n')
 shot['characters/hero.glb']=Buffer.from('shot-contract-fixture-v1\n');shot['references/stage.glb']=Buffer.from('shot-contract-reference-v1\n');result['edits/hero.glb']=Buffer.from('shot-contract-edited-v1\n')
 assert.deepEqual(validateResult(result,shot),[])
 await validateApp3ShotPython(shot)
 await validateApp3ResultPython(result,shot)
 await assert.rejects(validateApp3ResultPython({...result,'edits/hero.glb':Buffer.from('tampered')},shot),/VALIDATION_FAILED/)
 await assert.rejects(validateApp3ResultPython({...result,'../escape':Buffer.from('unsafe')},shot),/VALIDATION_FAILED/)
})
test('artifact publication authenticates retries, rejects generic success bypass, and cleans stale async outputs',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'app3-artifacts-')),prior=process.env.BBS_UNIFIED_PROJECTS_DIR;process.env.BBS_UNIFIED_PROJECTS_DIR=dir
 try{
  const projectId=randomUUID(),characterId=randomUUID(),assetId=randomUUID(),sha='a'.repeat(64)
  const p={projectId,revision:3,characters:{[characterId]:{id:characterId,assetId}},assets:{[assetId]:{source:{sha256:sha}}},motions:{},bindings:{}} as unknown as UnifiedProject
  const call=(command:string,args:Record<string,unknown>,revision?:number)=>executeApp3Bridge(p,command,args,randomUUID(),false,revision)
  const lease=call('app3.session.register',{sessionId:randomUUID(),epoch:randomUUID(),characterId,sourceSha256:sha,ready:true,active:true,context:{revision:'native'}})
  const queued=()=>{const t=call('app3.command.submit',{...identity(lease),tool:'export_animation',parameters:{format:'fbx'},expectedAnimationRevision:'native'},3);call('app3.session.poll',{...receiver(lease),ready:true,active:true,context:{revision:'native'}});return t}
  const ticket=queued(),bytes=Buffer.concat([Buffer.from('Kaydara FBX Binary  \0\x1a\0'),Buffer.alloc(100)])
  const upload=await stageAssetUpload('animation.fbx',new ReadableStream({start(c){c.enqueue(bytes);c.close()}}))
  const args={...receiver(lease),commandId:ticket.commandId,uploadId:upload.id,animationRevision:'native',context:{revision:'native'}}
  assert.throws(()=>call('app3.session.result',{...receiver(lease),commandId:ticket.commandId,result:{ok:true,value:{data:'bypass'}},context:{}}),/ARTIFACT_VALIDATION_REQUIRED/)
  const acknowledgment=await executeApp3Artifacts(p,'app3.session.artifact',args,randomUUID())
  assert.deepEqual(await executeApp3Artifacts(p,'app3.session.artifact',args,randomUUID()),acknowledgment)
  await assert.rejects(executeApp3Artifacts(p,'app3.session.artifact',{...args,receiverToken:randomUUID()},randomUUID()),/RECEIVER_REJECTED/)
  const result=call('app3.command.result',{...identity(lease),commandId:ticket.commandId}) as any,value=result.result.value
  assert.equal(value.data,undefined);assert.deepEqual((await readUnifiedJobFile(value.jobId,projectId,value.fileId))!.bytes,bytes)
  const stale=queued(),up=await stageAssetUpload('stale.fbx',new ReadableStream({start(c){c.enqueue(bytes);c.close()}})),before=await readdir(path.join(dir,projectId,'.jobs'));let reads=0
  await assert.rejects(executeApp3Artifacts(p,'app3.session.artifact',{...args,commandId:stale.commandId,uploadId:up.id},randomUUID(),false,undefined,async()=>{reads++;return reads===1?p:{...p,revision:4}}),/REVISION_CONFLICT/)
  assert.deepEqual(await readdir(path.join(dir,projectId,'.jobs')),before,'stale publication must remove job and binary')
 }finally{if(prior===undefined)delete process.env.BBS_UNIFIED_PROJECTS_DIR;else process.env.BBS_UNIFIED_PROJECTS_DIR=prior;await rm(dir,{recursive:true,force:true})}
})

test('shot-open resolves immutable broker-owned package proof and rejects cross-project or stale sources',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'app3-shot-proof-')),prior=process.env.BBS_UNIFIED_PROJECTS_DIR;process.env.BBS_UNIFIED_PROJECTS_DIR=dir
 try{
  const {saveShotExport}=await import('./shotExchange'),{storeShotArtifact}=await import('./unifiedJobs'),{jsonBytes,zipPackage}=await import('./shotPackage')
  const docs=await readFile(new URL('../../../../../docs/SHOT-PACKAGE-CONTRACT.md',import.meta.url),'utf8'),files:PackageFiles={}
  for(const m of docs.matchAll(/<!-- example:shot\/(.*?) -->\s*```json\n([\s\S]*?)\n```/g))files[m[1]!]=Buffer.from(m[2]+'\n')
  files['characters/hero.glb']=Buffer.from('shot-contract-fixture-v1\n');files['references/stage.glb']=Buffer.from('shot-contract-reference-v1\n')
  const shot=JSON.parse(Buffer.from(files['shot.json']!).toString()),projectId=randomUUID(),characterId=randomUUID(),assetId=randomUUID(),sourceSha256='a'.repeat(64)
  shot.shotId=randomUUID();shot.sceneId=projectId;shot.characters[0].characterId=characterId
  files['shot.json']=jsonBytes(shot);const actionUuid=shot.characters[0].actionUuid
  const p={projectId,revision:4,characters:{[characterId]:{id:characterId,assetId}},assets:{[assetId]:{source:{sha256:sourceSha256}}},motions:{[actionUuid]:{id:actionUuid}},bindings:{}} as unknown as UnifiedProject
  const bytes=Buffer.from(zipPackage(files));await saveShotExport(p,{shot,files,bytes,clips:{[characterId]:{clipId:randomUUID(),motionId:actionUuid}}})
  const job=await storeShotArtifact(p,bytes,shot.shotId),lease=executeApp3Bridge(p,'app3.session.register',{sessionId:randomUUID(),epoch:randomUUID(),characterId,sourceSha256,ready:true,active:true,context:{revision:'r'}},randomUUID())
  const args={...identity(lease),tool:'shotOpen',parameters:{jobId:job.jobId,fileId:'0'},expectedAnimationRevision:'r'}
  const dry=await executeApp3Artifacts(p,'app3.command.submit',args,randomUUID(),true,4);assert.equal(dry.valid,true)
  await assert.rejects(executeApp3Artifacts({...p,projectId:randomUUID()},'app3.command.submit',args,randomUUID(),false,4),/APP3_NOT_OPEN/)
  await assert.rejects(executeApp3Artifacts(p,'app3.command.submit',args,randomUUID(),false,4,async()=>({...p,revision:5})),/REVISION_CONFLICT/)
  const ticket=await executeApp3Artifacts(p,'app3.command.submit',args,randomUUID(),false,4)
  const poll=executeApp3Bridge(p,'app3.session.poll',{...receiver(lease),ready:true,active:true,context:{revision:'r'}},randomUUID()) as any
  assert.equal(poll.commands[0].commandId,ticket.commandId);assert.equal(poll.commands[0].shot.glbSha256,shot.characters[0].glbSha256);assert.notEqual(poll.commands[0].shot.glbSha256,sourceSha256)
  const proof=poll.commands[0].shot,ack=executeApp3Bridge(p,'app3.session.result',{...receiver(lease),commandId:ticket.commandId,result:{ok:true,value:{shotId:proof.shotId,baseShotSha256:proof.baseShotSha256,characterId,actionUuid,sourceSha256:proof.glbSha256,frameRange:proof.frameRange,fps:30}},context:{ready:true,revision:'r2'}},randomUUID()) as any
  const next=ack.nextLease,exported=executeApp3Bridge(p,'app3.command.submit',{...identity(next),tool:'shotExport',parameters:{},expectedAnimationRevision:'r2'},randomUUID(),false,4)
  executeApp3Bridge(p,'app3.session.poll',{...receiver(next),ready:true,active:true,context:{ready:true,revision:'r2'}},randomUUID())
  const malformed=await stageAssetUpload('malformed.zip',new ReadableStream({start(c){c.enqueue(Buffer.from('not a zip'));c.close()}}))
  await assert.rejects(executeApp3Artifacts(p,'app3.session.artifact',{...receiver(next),commandId:exported.commandId,uploadId:malformed.id,animationRevision:'r2',context:{revision:'r2'}},randomUUID()),/VALIDATION_FAILED/)

 }finally{if(prior===undefined)delete process.env.BBS_UNIFIED_PROJECTS_DIR;else process.env.BBS_UNIFIED_PROJECTS_DIR=prior;await rm(dir,{recursive:true,force:true})}
})
