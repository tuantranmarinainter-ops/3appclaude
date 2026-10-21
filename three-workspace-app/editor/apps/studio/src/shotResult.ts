import { randomUUID } from 'node:crypto'
import { isRecord, type UnifiedProject } from '@bbs/animation-workspace-shared'
import { FCurveSet } from '@topview/3d-builder/evaluate'
import { attachApp1Manifest } from './app1Manifest'
import { buildImportedAsset, persistImportedAssetFiles, readStagedAssetUpload } from './unifiedAssetFiles'
import { loadShotExport } from './shotExchange'
import { readPackageJson, unzipPackage, validateResult, sha256, type ShotResult } from './shotPackage'

/** Policy seam: edited actor travel belongs only to placement keys, never rebaked into root. */
export const SHOT_PLACEMENT_POLICY = 'placement-keys' as const
export async function prepareShotResult(project: UnifiedProject,args: Record<string, unknown>) {
  if(Object.keys(args).some(k=>!['file','shotId'].includes(k))||typeof args.file!=='string'||typeof args.shotId!=='string')throw new TypeError('shot.result.import requires file and shotId')
  const base=await loadShotExport(project.projectId,args.shotId)
  if(base.saved.sourceRevision!==project.revision)throw Object.assign(new Error('Exported shot revision is stale'),{code:'REVISION_CONFLICT'})
  const upload=await readStagedAssetUpload(args.file),files=unzipPackage(upload.bytes),issues=validateResult(files,base.files)
  if(issues.length)throw new TypeError(JSON.stringify(issues))
  const result=readPackageJson<ShotResult>(files,'result.json')
  const edits=result.edits.map(edit=>{
    const binding=base.saved.clips[edit.characterId],character=project.characters[edit.characterId],original=project.motions[edit.originalActionUuid]
    if(!binding||!character||!original||binding.motionId!==original.id||project.bindings[binding.clipId]?.motionId!==original.id)throw new TypeError('Shot clip or original Motion changed')
    if(project.motions[edit.newActionUuid])throw new TypeError('New Action UUID already exists')
    const clip=project.scene.content.timeline.animation.motionClips.find(c=>c.id===binding.clipId)
    if(!clip||clip.frameStart!==base.shot.frameRange[0]||clip.frameEnd!==base.shot.frameRange[1])throw new TypeError('MVP result import requires the complete MotionClip range')
    const node=project.scene.content.nodes.find(n=>n.id===character.nodeId)
    if(!node||node.locked)throw new TypeError('Result Character is missing or locked')
    const bytes=Buffer.from(files[edit.glb]!),manifest=readPackageJson<Record<string,unknown>>(files,edit.manifest)
    const staged={id:randomUUID(),name:`${edit.characterId}.glb`,sha256:sha256(bytes),byteLength:bytes.length,bytes}
    const imported=buildImportedAsset(staged,'glb',1,[1,0,0,0,1,0,0,0,1]);attachApp1Manifest(imported,bytes,manifest)
    const motion=imported.motions.find(m=>m.motion.id===edit.newActionUuid)
    if(!motion||imported.skeleton?.family!=='mixamo65'||project.skeletons[character.skeletonId]?.family!=='mixamo65')throw new TypeError('Result requires a compatible Mixamo65 Action')
    const duration=(base.shot.frameRange[1]-base.shot.frameRange[0])/30
    if(Math.abs(motion.motion.durationSeconds-duration)>1/30+1e-6)throw new TypeError('Result Action duration must match the exported shot range')
    return {edit,binding,character,original,imported,bytes,motion}
  })
  return {base,result,edits,uploadId:upload.id}
}
export async function applyShotResult(project: UnifiedProject,prepared: Awaited<ReturnType<typeof prepareShotResult>>) {
  const metadata={...(isRecord(project.extensions.retargetMotionMetadata)?project.extensions.retargetMotionMetadata:{})},manifests={...(isRecord(project.extensions.app1Manifests)?project.extensions.app1Manifests:{})}
  const raw=project.extensions.topview?.fcurves,curves=raw?FCurveSet.parse(raw):null,userKeys=FCurveSet.parseUserKeys(raw)
  const [start,end]=prepared.base.shot.frameRange
  for(const {edit,binding,character,original,imported,bytes,motion} of prepared.edits) {
    await persistImportedAssetFiles(project.projectId,imported,bytes)
    project.assets[imported.asset.id]??=imported.asset
    project.motions[edit.newActionUuid]={...motion.motion,skeletonId:character.skeletonId,derivedFrom:original.id}
    metadata[edit.newActionUuid]={name:motion.name,clipIndex:motion.clipIndex,nativeFingerprint:motion.nativeFingerprint,boneNames:motion.boneNames}
    manifests[imported.asset.id]=imported.app1Manifest
    const clip=project.scene.content.timeline.animation.motionClips.find(c=>c.id===binding.clipId)!
    // Partial clip replacement needs a split transaction, so reject rather than lose other frames.
    if(clip.frameStart!==start||clip.frameEnd!==end)throw new TypeError('MVP result import requires a shot matching the complete MotionClip range')
    const url=`/api/unified/projects/${project.projectId}/assets/${encodeURIComponent(imported.asset.id)}/source?format=glb`
    clip.motion={...clip.motion,assetId:edit.newActionUuid,url,name:motion.name,clipIndex:motion.clipIndex,time:0,sourceLengthSeconds:motion.motion.durationSeconds,speed:1,loop:false,reverse:false}
    clip.sourceDuration=motion.motion.durationSeconds;clip.playback.speed=1;clip.playback.loop=false
    project.bindings[clip.id]={...project.bindings[clip.id]!,motionId:edit.newActionUuid,sourceStartSeconds:0,sourceLengthSeconds:motion.motion.durationSeconds,reverse:false,fadeInSeconds:0,fadeOutSeconds:0}
    project.scene.content.asset.motionPath.push({id:edit.newActionUuid,path:url})
    const nodeKeys=userKeys[character.nodeId]??={}
    const retain=<T extends {frame:number}>(keys:T[]|undefined)=>keys?.filter(k=>k.frame<start||k.frame>end)??[]
    nodeKeys.position=[...retain(nodeKeys.position),...edit.placementKeys.map(k=>({id:randomUUID(),frame:k.frame,value:k.position,interpolation:'linear' as const}))].sort((a,b)=>a.frame-b.frame)
    nodeKeys.rotation=[...retain(nodeKeys.rotation),...edit.placementKeys.map(k=>({id:randomUUID(),frame:k.frame,value:[0,k.yawDegrees,0],interpolation:'linear' as const}))].sort((a,b)=>a.frame-b.frame)
  }
  project.extensions.retargetMotionMetadata=metadata;project.extensions.app1Manifests=manifests
  project.extensions.topview={...(project.extensions.topview??{}),fcurves:FCurveSet.persist(curves,userKeys)}
  return {shotId:prepared.result.shotId,motionIds:prepared.edits.map(e=>e.edit.newActionUuid),policy:SHOT_PLACEMENT_POLICY}
}
