import { app3HeightHint } from './app3Height'
import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, writeFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { UnifiedProject } from '@bbs/animation-workspace-shared'
import { executeApp3Bridge, app3ArtifactClaim, app3ArtifactReplay, validateApp3Export, App3BridgeError, type App3ShotProof, type App3LibraryActionProof } from './app3Bridge'
import { readUnifiedJobFile, storeApp3Artifact, discardApp3Artifact } from './unifiedJobs'
import { readStagedAssetUpload, removeStagedAssetUploads, resolveUnifiedAssetFile } from './unifiedAssetFiles'
import { loadShotExport } from './shotExchange'
import { unzipPackage, validateShot, validateResult, readPackageJson, sha256, type PackageFiles, type Shot } from './shotPackage'
import { formatBilingual, getAction } from '../../../packages/library/index'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

function fail(code: string): never { throw new App3BridgeError(code) }
function packageFiles(bytes:Uint8Array):PackageFiles { try{return unzipPackage(bytes)}catch{return fail('VALIDATION_FAILED')} }
const locks = new Map<string, Promise<Record<string, unknown>>>()
const published = new Map<string, { fingerprint: string; result: Record<string, unknown> }>()
async function freshProject(project: UnifiedProject, fresh: () => Promise<UnifiedProject>) {
 const current=await fresh();if(current.revision!==project.revision)fail('REVISION_CONFLICT');return current
}
async function prepareShot(project: UnifiedProject, parameters: unknown): Promise<App3ShotProof> {
 validateApp3Export('shotOpen',parameters)
 const jobId=String(parameters.jobId),fileId=String(parameters.fileId),artifact=await readUnifiedJobFile(jobId,project.projectId,fileId)
 if(!artifact||artifact.mimeType!=='application/zip')fail('SHOT_PACKAGE_REQUIRED')
 const files=packageFiles(artifact.bytes)
 if(validateShot(files).length)fail('VALIDATION_FAILED')
 const shot=readPackageJson<Shot>(files,'shot.json'),base=await loadShotExport(project.projectId,shot.shotId)
 if(sha256(artifact.bytes)!==base.saved.zipSha256||base.saved.sourceRevision!==project.revision)fail('REVISION_CONFLICT')
 await validateApp3ShotPython(files)
 const editable=shot.characters.filter(c=>c.editable)
 if(editable.length!==1)fail('CONTRACT_UNSUPPORTED')
 const c=editable[0]!
 if(!project.characters[c.characterId]||!project.motions[c.actionUuid]||base.saved.clips[c.characterId]?.motionId!==c.actionUuid)fail('IDENTITY_MISMATCH')
 return {shotId:shot.shotId,baseShotSha256:sha256(files['shot.json']!),characterId:c.characterId,actionUuid:c.actionUuid,glbSha256:c.glbSha256,zipSha256:sha256(artifact.bytes),frameRange:shot.frameRange,fps:shot.fps,sourceRevision:project.revision,jobId,fileId}
}
async function agentRoot() {
 let dir=path.resolve(process.cwd())
 for(let i=0;i<8;i++){try{await stat(path.join(dir,'agent','shot_package.py'));return dir}catch{}const parent=path.dirname(dir);if(parent===dir)break;dir=parent}
 throw Error('Local shot validator unavailable')
}
/** Run the actual TASK-2 Python validator on safe extracted broker-owned files. */
export async function validateApp3ResultPython(files:PackageFiles,base:PackageFiles) { return validateApp3PackagePython(files,base) }
export async function validateApp3ShotPython(files:PackageFiles) { return validateApp3PackagePython(files) }
async function validateApp3PackagePython(files:PackageFiles,base?:PackageFiles) {
 const temp=await mkdtemp(path.join(tmpdir(),'app3-result-'))
 try {
  for(const [folder,entries] of (base?[['result',files],['shot',base]]:[['shot',files]]) as Array<[string,PackageFiles]>)for(const [name,bytes] of Object.entries(entries)){
   if(!name||name.includes('\\')||name.startsWith('/')||name.split('/').some(x=>!x||x==='.'||x==='..')||/^[A-Za-z]:/.test(name))fail('VALIDATION_FAILED')
   const target=path.join(temp,folder,...name.split('/'));await mkdir(path.dirname(target),{recursive:true});await writeFile(target,bytes,{flag:'wx'})
  }
  const cwd=await agentRoot(),python=process.env.BBS_PYTHON?.trim()||(process.platform==='win32'?'python':'python3')
  await new Promise<void>((resolve,reject)=>{
   const args=base?['validate-result',path.join(temp,'result'),'--shot',path.join(temp,'shot')]:['validate-shot',path.join(temp,'shot')]
   const child=spawn(python,['-m','agent.shot_package',...args],{cwd,windowsHide:true,env:{...process.env,PYTHONIOENCODING:'utf-8'},stdio:['ignore','pipe','pipe']})
   let size=0;const timer=setTimeout(()=>{child.kill();reject(Error('Shot validator timed out'))},30000)
   child.stdout.on('data',b=>{size+=b.length;if(size>1024*1024)child.kill()});child.stderr.on('data',b=>{size+=b.length;if(size>1024*1024)child.kill()})
   child.once('error',e=>{clearTimeout(timer);reject(e)});child.once('close',code=>{clearTimeout(timer);code===0?resolve():reject(new App3BridgeError('VALIDATION_FAILED'))})
  })
 }finally{await rm(temp,{recursive:true,force:true})}
}

export async function executeApp3Artifacts(project:UnifiedProject,command:string,args:Record<string,unknown>,requestId:string,dryRun=false,expectedRevision?:number,fresh:()=>Promise<UnifiedProject>=async()=>project):Promise<Record<string,unknown>> {
 if(command==='app3.command.submit'&&args.tool==='libraryActionOpen'){
  executeApp3Bridge(project,command,args,requestId,true,expectedRevision)
  validateApp3Export('libraryActionOpen',args.parameters)
  const actionUuid=(args.parameters as Record<string,unknown>).actionUuid as string
  const character=project.characters[String(args.characterId)],profile=character&&project.skeletons[character.skeletonId],characterAsset=character&&project.assets[character.assetId]
  let action:ReturnType<typeof getAction>
  try{action=getAction({actionUuid})}catch{fail('ASSET_MISSING')}
  const rigMatches=!!profile&&(action.rig===profile.family||action.rig.startsWith('mixamo65+')&&profile.family==='mixamo65')
  if(!character||!profile||!characterAsset||characterAsset.source.mediaType!=='model/gltf-binary'||!rigMatches)fail('PROFILE_MISMATCH')
  const bytes=await readFile(action.glbPath),target=await resolveUnifiedAssetFile(project,characterAsset.id,'source')
  const glbSha256=createHash('sha256').update(bytes).digest('hex'),characterSha256=createHash('sha256').update(target.bytes).digest('hex')
  if(characterSha256!==characterAsset.source.sha256)fail('IDENTITY_MISMATCH')
  const node=project.scene.content.nodes.find((item)=>item.id===character.nodeId),height=app3HeightHint(node?.metadata)
  const proof:App3LibraryActionProof={...(height?{heightBlocks:height.heightBlocks}:{}),actionUuid:action.uuid,characterId:character.id,characterAssetId:characterAsset.id,characterSha256,packId:action.packId,glbSha256,glbAnimationIndex:action.glbAnimationIndex,name:formatBilingual(action.name,action.nameVi)}
  return executeApp3Bridge(await freshProject(project,fresh),command,args,requestId,dryRun,expectedRevision,proof)
 }
 if(command==='app3.command.submit'&&args.tool==='shotOpen'){
  // Schema/lease/revision checks precede package I/O; dry-run never opens an editor.
  executeApp3Bridge(project,command,args,requestId,true,expectedRevision)
  const proof=await prepareShot(project,args.parameters)
  return executeApp3Bridge(await freshProject(project,fresh),command,args,requestId,dryRun,expectedRevision,proof)
 }
 if(command!=='app3.session.artifact')return executeApp3Bridge(project,command,args,requestId,dryRun,expectedRevision)
 const allowed=['sessionId','epoch','characterId','serverInstance','receiverToken','commandId','uploadId','animationRevision','context']
 if(Object.keys(args).some(k=>!allowed.includes(k))||typeof args.uploadId!=='string'||typeof args.animationRevision!=='string'||!args.context||typeof args.context!=='object'||Array.isArray(args.context))fail('VALIDATION_FAILED')
 app3ArtifactReplay(project,args)
 const key=JSON.stringify([project.projectId,args.sessionId,args.epoch,args.commandId]),fingerprint=JSON.stringify([args.receiverToken,args.uploadId,args.animationRevision,args.context])
 const done=published.get(key)
 if(done){if(done.fingerprint!==fingerprint)fail('RESULT_CONFLICT');return done.result}
 const running=locks.get(key);if(running)return running.then(result=>{if(published.get(key)?.fingerprint!==fingerprint)fail('RESULT_CONFLICT');return result})
 const work=(async()=>{
  const claim=app3ArtifactClaim(project,args)
  if(args.animationRevision!==claim.expectedAnimationRevision||(args.context as Record<string,unknown>).revision!==claim.expectedAnimationRevision)fail('REVISION_CONFLICT')
  if(dryRun)return {valid:true}
  const upload=await readStagedAssetUpload(args.uploadId)
  let name:string,mime:string
  if(claim.tool==='shotExport'){
   const proof=claim.proof;if(!proof||!('zipSha256' in proof))fail('SHOT_PACKAGE_REQUIRED')
   const base=await loadShotExport(project.projectId,proof.shotId),files=packageFiles(upload.bytes)
   if(base.saved.sourceRevision!==project.revision||sha256(base.files['shot.json']!)!==proof.baseShotSha256)fail('REVISION_CONFLICT')
   if(validateResult(files,base.files).length)fail('VALIDATION_FAILED')
   await validateApp3ResultPython(files,base.files)
   name=`shot-${proof.shotId}.result.zip`;mime='application/zip'
  }else{
   const format=claim.parameters.format
   name=`animation.${format}`;mime=format==='bobj'?'text/plain':'application/octet-stream'
   if(format==='bobj'&&!upload.bytes.toString('utf8').trim()||format==='fbx'&&!upload.bytes.subarray(0,23).equals(Buffer.from('Kaydara FBX Binary  \0\x1a\0')))fail('VALIDATION_FAILED')
  }
  const current=await freshProject(project,fresh);app3ArtifactClaim(current,args)
  const job=await storeApp3Artifact(current,upload.bytes,name,mime,{commandId:args.commandId,sessionId:args.sessionId,epoch:args.epoch,animationRevision:args.animationRevision,...(claim.proof?{shot:claim.proof}:{})})
  try {
   const latest=await freshProject(project,fresh);app3ArtifactClaim(latest,args)
   const file=job.result!.files[0]!,value={jobId:job.jobId,fileId:file.id,filename:file.name,mimeType:file.mimeType,sizeBytes:file.sizeBytes,sha256:file.sha256}
   const result=executeApp3Bridge(latest,'app3.session.result',{sessionId:args.sessionId,epoch:args.epoch,characterId:args.characterId,serverInstance:args.serverInstance,receiverToken:args.receiverToken,commandId:args.commandId,result:{ok:true,value,animationRevision:args.animationRevision},context:args.context},requestId,false,undefined,undefined,true)
   published.set(key,{fingerprint,result});if(published.size>512)published.delete(published.keys().next().value!)
   await removeStagedAssetUploads([String(args.uploadId)]).catch(()=>undefined)
   return result
  }catch(error){await discardApp3Artifact(project.projectId,job.jobId);throw error}
 })()
 locks.set(key,work)
 try{return await work}finally{locks.delete(key)}
}
