import { shotPlacementAtHeight } from './app3Height'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { isRecord, type UnifiedProject } from '@bbs/animation-workspace-shared'
import { FCurveSet } from '@topview/3d-builder/evaluate'
import { attachApp1Manifest } from './app1Manifest'
import { buildImportedAsset, persistImportedAssetFiles, readStagedAssetUpload } from './unifiedAssetFiles'
import { loadShotExport } from './shotExchange'
import { readPackageJson, unzipPackage, validateResult, sha256, type ShotResult } from './shotPackage'
import { getAction, listCharacterActions, resolveCharacter, saveCharacterActionVersion, setActionMetadata } from '../../../packages/library/index'
import { defaultMergedClipInfo } from './shotChain'
import { nativeShotBobj } from './nativeShotVersion'
import { nativeSkeletonFingerprint } from '../../../packages/retarget/src/nativeSkeleton'
import { libraryBaseGlb } from './libraryModels'

type MotionClip=UnifiedProject['scene']['content']['timeline']['animation']['motionClips'][number]
interface MergeInfo { name: string; description: string; libraryBaseUuid?: string }
function parseMergeArgs(value: unknown): { name: string; description: string } {
  if(!isRecord(value)||Object.keys(value).some(k=>!['name','description'].includes(k))||typeof value.name!=='string'||typeof value.description!=='string')throw new TypeError('merge requires name and description strings')
  const name=value.name.trim(),description=value.description.trim()
  if(!name||name.length>120)throw new TypeError('Tên clip gộp phải có 1–120 ký tự')
  if(description.length>1000)throw new TypeError('Mô tả clip gộp tối đa 1000 ký tự')
  return {name,description}
}
/** K5: tên + mô tả clip gộp (mặc định theo các clip) và Action gốc của nhân vật thư viện để đánh số phiên bản. */
function mergeInfo(project: UnifiedProject,chain: NonNullable<import('./shotExchange').SavedShotClip['chain']>,chainClips: MotionClip[],given: {name:string;description:string}|undefined,libraryCharacterId: string|undefined): MergeInfo {
  const defaults=defaultMergedClipInfo(chainClips as never)
  let libraryBaseUuid: string|undefined
  if(libraryCharacterId){
    const metadata=isRecord(project.extensions.retargetMotionMetadata)?project.extensions.retargetMotionMetadata:{}
    for(const item of chain){
      const meta=metadata[item.motionId],uuid=isRecord(meta)&&typeof meta.libraryActionUuid==='string'?meta.libraryActionUuid:item.motionId
      try { if(getAction({actionUuid:uuid}).ownerCharId===libraryCharacterId){libraryBaseUuid=uuid;break} } catch { /* motion is not a library Action */ }
    }
    libraryBaseUuid??=listCharacterActions({charId:libraryCharacterId}).find(a=>a.ownerCharId===libraryCharacterId)?.uuid
    if(!libraryBaseUuid)throw new TypeError('Nhân vật thư viện chưa có Action riêng nào để làm gốc phiên bản cho clip gộp; hãy thêm một animation vào nhân vật trong Thư viện trước.')
  }
  return {name:given?.name??defaults.name,description:given?.description??defaults.description,libraryBaseUuid}
}
/** Policy seam: edited actor travel belongs only to placement keys, never rebaked into root. */
export const SHOT_PLACEMENT_POLICY = 'placement-keys' as const
export async function prepareShotResult(project: UnifiedProject,args: Record<string, unknown>, draftBytes?: Uint8Array) {
  if(Object.keys(args).some(k=>!['file','shotId','merge'].includes(k))||typeof args.file!=='string'||typeof args.shotId!=='string')throw new TypeError('shot.result.import requires file and shotId')
  const mergeArgs=args.merge===undefined?undefined:parseMergeArgs(args.merge)
  const base=await loadShotExport(project.projectId,args.shotId)
  if(base.saved.sourceRevision!==project.revision)throw Object.assign(new Error('Exported shot revision is stale'),{code:'REVISION_CONFLICT'})
  const upload=draftBytes?{id:'draft',bytes:draftBytes}:await readStagedAssetUpload(args.file),files=unzipPackage(upload.bytes),issues=validateResult(files,base.files)
  if(issues.length)throw new TypeError(JSON.stringify(issues))
  const result=readPackageJson<ShotResult>(files,'result.json')
  // Only the native editor's actor displacement is scaled. Base world coordinates and Action bones stay canonical.
  for (const edit of result.edits) {
    const character = base.shot.characters.find((item) => item.characterId === edit.characterId)
    if (character?.heightScale !== undefined) edit.placementKeys = shotPlacementAtHeight(edit.placementKeys, character.placement.position, character.heightScale)
  }
  const edits=await Promise.all(result.edits.map(async edit=>{
    const binding=base.saved.clips[edit.characterId],character=project.characters[edit.characterId]
    const chainClips=binding?.chain?binding.chain.map(item=>project.scene.content.timeline.animation.motionClips.find(c=>c.id===item.clipId&&c.frameStart===item.frameStart&&c.frameEnd===item.frameEnd)):undefined
    if(binding?.chain&&(chainClips!.some(c=>!c)||binding.motionId!==edit.originalActionUuid))throw new TypeError('Các clip của chuỗi đã trộn đã đổi sau khi xuất shot: hãy mở lại shot')
    const original=binding?.chain?project.motions[binding.chain[0]!.motionId]:project.motions[edit.originalActionUuid]
    if(!binding||!character||!original||!binding.chain&&(binding.motionId!==original.id||project.bindings[binding.clipId]?.motionId!==original.id))throw new TypeError('Shot clip or original Motion changed')
    if(project.motions[edit.newActionUuid])throw new TypeError('New Action UUID already exists')
    const clip=project.scene.content.timeline.animation.motionClips.find(c=>c.id===binding.clipId)
    if(binding.chain){
      const last=Math.max(...binding.chain.map(c=>c.frameEnd))
      if(!clip||clip.frameStart!==base.shot.frameRange[0]||last!==base.shot.frameRange[1])throw new TypeError('Chuỗi clip đã trộn không còn khớp khoảng shot: hãy mở lại shot')
    } else if(!clip||clip.frameStart!==base.shot.frameRange[0]||clip.frameEnd!==base.shot.frameRange[1])throw new TypeError('MVP result import requires the complete MotionClip range')
    const node=project.scene.content.nodes.find(n=>n.id===character.nodeId)
    if(!node||node.locked)throw new TypeError('Result Character is missing or locked')
    const bytes=Buffer.from(files[edit.glb]!),manifest=readPackageJson<Record<string,unknown>>(files,edit.manifest)
    const staged={id:randomUUID(),name:`${edit.characterId}.glb`,sha256:sha256(bytes),byteLength:bytes.length,bytes}
    let imported: ReturnType<typeof buildImportedAsset>
    try { imported=buildImportedAsset(staged,'glb',1,[1,0,0,0,1,0,0,0,1]) }
    catch(error) { throw new TypeError(`Result native skeleton is invalid: ${error instanceof Error?error.message:String(error)}`) }
    const libraryNode=project.scene.content.nodes.find(n=>n.id===character.nodeId),libraryCharacterId=typeof libraryNode?.metadata?.libraryCharacterId==='string'?libraryNode.metadata.libraryCharacterId:null
    const libraryCharacter=libraryCharacterId?resolveCharacter(libraryCharacterId):null
    let nativeLibrary=false
    if(libraryCharacter?.baseModel?.format==='bobj'&&['verity','minecraft20'].includes(libraryCharacter.baseModel.rig)) {
      // Chuỗi trộn: Action nướng chưa có trong thư viện; nhân vật native là đủ, gốc phiên bản lấy từ Action của clip đầu chuỗi.
      if(binding.chain)nativeLibrary=true
      else { try { nativeLibrary=getAction({actionUuid:edit.originalActionUuid}).ownerCharId===libraryCharacterId } catch {} }
    }
    const nativeBobj=nativeLibrary?await nativeShotBobj(libraryCharacterId!,bytes,edit.newActionUuid):undefined
    attachApp1Manifest(imported,bytes,manifest,nativeLibrary?nativeSkeletonFingerprint(bytes):undefined)
    const motion=imported.motions.find(m=>m.motion.id===edit.newActionUuid)
    const targetSkeleton=project.skeletons[character.skeletonId]
    const nativeBase=nativeLibrary?await libraryBaseGlb(libraryCharacterId!):undefined
    const baseSkeleton=nativeBase?buildImportedAsset({id:randomUUID(),name:'native-base.glb',bytes:nativeBase,sha256:sha256(nativeBase),byteLength:nativeBase.length},'glb').skeleton:undefined
    const compatible=nativeLibrary
      ? !!nativeBobj&&!!targetSkeleton&&targetSkeleton.fingerprint===baseSkeleton?.fingerprint
      : imported.skeleton?.family==='mixamo65'&&targetSkeleton?.family==='mixamo65'
    if(!motion||!compatible)throw new TypeError(nativeLibrary?'Result requires the character native skeleton':'Result requires a compatible Mixamo65 Action')
    const duration=(base.shot.frameRange[1]-base.shot.frameRange[0])/30
    if(Math.abs(motion.motion.durationSeconds-duration)>1/30+1e-6)throw new TypeError('Result Action duration must match the exported shot range')
    const merge=binding.chain?mergeInfo(project,binding.chain,chainClips as MotionClip[],mergeArgs,nativeLibrary?libraryCharacterId!:undefined):undefined
    return {edit,binding,character,original,imported,bytes,motion,nativeBobj,nativeLibraryId:nativeLibrary?libraryCharacterId:undefined,nativeLibraryRig:nativeLibrary?libraryCharacter!.baseModel!.rig:undefined,merge}
  }))
  return {base,result,edits,uploadId:upload.id}
}
export async function saveNativeShotVersions(prepared: Awaited<ReturnType<typeof prepareShotResult>>) {
  const saved: string[]=[]
  for(const {edit,bytes,nativeLibraryId,nativeLibraryRig,nativeBobj,merge} of prepared.edits) if(nativeLibraryId){
    const temp=await mkdtemp(path.join(os.tmpdir(),'bbs-app3-')),file=path.join(temp,`${edit.newActionUuid}.glb`)
    try {
      await writeFile(file,bytes)
      const version=saveCharacterActionVersion({charId:nativeLibraryId,baseUuid:merge?.libraryBaseUuid??edit.originalActionUuid,glbFile:file,status:'edited',rig:nativeLibraryRig,actionUuid:edit.newActionUuid,nativeBobj,notes:merge?merge.description:'Animation Studio App3 shot edit'})
      // Clip gộp mang tên người dùng đặt (Vietnamese) thay cho tên Action gốc; mô tả nằm ở notes.
      if(merge)setActionMetadata({actionUuid:version.uuid,name:merge.name,nameVi:merge.name})
      saved.push(version.uuid)
    }
    finally { await rm(temp,{recursive:true,force:true}) }
  }
  return saved
}
export async function applyShotResult(project: UnifiedProject,prepared: Awaited<ReturnType<typeof prepareShotResult>>) {
  const metadata={...(isRecord(project.extensions.retargetMotionMetadata)?project.extensions.retargetMotionMetadata:{})},manifests={...(isRecord(project.extensions.app1Manifests)?project.extensions.app1Manifests:{})}
  const raw=project.extensions.topview?.fcurves,curves=raw?FCurveSet.parse(raw):null,userKeys=FCurveSet.parseUserKeys(raw)
  const [start,end]=prepared.base.shot.frameRange
  const savedLibraryVersions=await saveNativeShotVersions(prepared)
  let mergedClipId: string|undefined
  for(const {edit,binding,character,original,imported,bytes,motion,nativeLibraryId,nativeLibraryRig,merge} of prepared.edits) {
    let libraryActionUuid: string | undefined
    if(nativeLibraryId){
      libraryActionUuid=edit.newActionUuid
    }
    await persistImportedAssetFiles(project.projectId,imported,bytes)
    project.assets[imported.asset.id]??=imported.asset
    project.motions[edit.newActionUuid]={...motion.motion,skeletonId:character.skeletonId,derivedFrom:original.id}
    metadata[edit.newActionUuid]={name:motion.name,clipIndex:motion.clipIndex,nativeFingerprint:motion.nativeFingerprint,boneNames:motion.boneNames,...(libraryActionUuid?{libraryActionUuid}:{}),...(nativeLibraryRig?{nativeRig:nativeLibraryRig}:{})}
    manifests[imported.asset.id]=imported.app1Manifest
    const timelineClips=project.scene.content.timeline.animation.motionClips
    const clip=timelineClips.find(c=>c.id===binding.clipId)!
    const url=`/api/unified/projects/${project.projectId}/assets/${encodeURIComponent(imported.asset.id)}/source?format=glb`
    if(merge&&binding.chain){
      // K5: thay cả chuỗi clip trộn bằng MỘT clip phủ [đầu clip đầu, cuối clip cuối]; Action gốc, bindings của chúng vẫn nằm trong project.motions.
      const ids=new Set(binding.chain.map(c=>c.clipId)),last=Math.max(...binding.chain.map(c=>c.frameEnd))
      if(clip.frameStart!==start||last!==end)throw new TypeError('Chuỗi clip đã trộn không còn khớp khoảng shot')
      const { blendIn: _blend, ...playback } = clip.playback as Record<string, unknown>
      void _blend
      const mergedName=merge.name
      const merged={...clip,frameEnd:end,sourceDuration:motion.motion.durationSeconds,playback:{...playback,speed:1,loop:false,loopMode:'repeat'} as typeof clip.playback,
        motion:{...clip.motion,assetId:edit.newActionUuid,url,name:mergedName,clipIndex:motion.clipIndex,time:0,sourceLengthSeconds:motion.motion.durationSeconds,speed:1,loop:false,reverse:false}}
      project.scene.content.timeline.animation.motionClips=timelineClips.filter(c=>!ids.has(c.id)||c.id===clip.id).map(c=>c.id===clip.id?merged:c)
      for(const id of ids)if(id!==clip.id)delete project.bindings[id]
      project.bindings[clip.id]={...project.bindings[clip.id]!,motionId:edit.newActionUuid,sourceStartSeconds:0,sourceLengthSeconds:motion.motion.durationSeconds,reverse:false,fadeInSeconds:0,fadeOutSeconds:0}
      mergedClipId=clip.id
    } else {
    // Partial clip replacement needs a split transaction, so reject rather than lose other frames.
    if(clip.frameStart!==start||clip.frameEnd!==end)throw new TypeError('MVP result import requires a shot matching the complete MotionClip range')
    clip.motion={...clip.motion,assetId:edit.newActionUuid,url,name:motion.name,clipIndex:motion.clipIndex,time:0,sourceLengthSeconds:motion.motion.durationSeconds,speed:1,loop:false,reverse:false}
    clip.sourceDuration=motion.motion.durationSeconds;clip.playback.speed=1;clip.playback.loop=false
    project.bindings[clip.id]={...project.bindings[clip.id]!,motionId:edit.newActionUuid,sourceStartSeconds:0,sourceLengthSeconds:motion.motion.durationSeconds,reverse:false,fadeInSeconds:0,fadeOutSeconds:0}
    }
    project.scene.content.asset.motionPath.push({id:edit.newActionUuid,path:url})
    const nodeKeys=userKeys[character.nodeId]??={}
    const retain=<T extends {frame:number}>(keys:T[]|undefined)=>keys?.filter(k=>k.frame<start||k.frame>end)??[]
    nodeKeys.position=[...retain(nodeKeys.position),...edit.placementKeys.map(k=>({id:randomUUID(),frame:k.frame,value:k.position,interpolation:'linear' as const}))].sort((a,b)=>a.frame-b.frame)
    nodeKeys.rotation=[...retain(nodeKeys.rotation),...edit.placementKeys.map(k=>({id:randomUUID(),frame:k.frame,value:[0,k.yawDegrees,0],interpolation:'linear' as const}))].sort((a,b)=>a.frame-b.frame)
  }
  project.extensions.retargetMotionMetadata=metadata;project.extensions.app1Manifests=manifests
  project.extensions.topview={...(project.extensions.topview??{}),fcurves:FCurveSet.persist(curves,userKeys)}
  return {shotId:prepared.result.shotId,motionIds:prepared.edits.map(e=>e.edit.newActionUuid),libraryActionUuids:savedLibraryVersions,policy:SHOT_PLACEMENT_POLICY,...(mergedClipId?{mergedClipId}:{})}
}
