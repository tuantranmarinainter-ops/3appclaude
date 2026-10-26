import { libraryCharacterBoundingBoxHeight } from './libraryCharacterSpacing'
import { app3HeightHint } from './app3Height'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { Quaternion, Vector3, Euler } from 'three'
import { createFrameSnapshot, evaluateFrame } from '@topview/3d-builder/evaluate'
import { isRecord, type UnifiedProject } from '@bbs/animation-workspace-shared'
import { resolveProjectBlob, resolveUnifiedAssetFile } from './unifiedAssetFiles'
import { projectEvaluationScene } from './unifiedSkeletonEvaluation'
import { jsonBytes, sha256, validateShot, zipPackage, unzipPackage, readPackageJson, type PackageFiles, type Shot } from './shotPackage'
import { getAction, resolveCharacter } from '../../../packages/library/index'
import { composeLibraryActionGlb, libraryCharacterModel, libraryNativeAction } from './libraryModels'

export interface ShotExportArgs { cameraNodeId: string; frameStart: number; frameEnd: number; editableCharacterIds: string[] }
export interface SavedShot { sourceRevision: number; zipSha256: string; shot: Shot; clips: Record<string, { clipId: string; motionId: string }> }
function shotRoot(projectId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(projectId)) throw new TypeError('Invalid project ID')
  return path.join(path.resolve(process.env.BBS_UNIFIED_PROJECTS_DIR?.trim() || path.join(process.cwd(), 'unified-projects')), projectId, '.shots')
}
export async function createShotPackage(project: UnifiedProject, args: ShotExportArgs) {
  const timeline=project.scene.content.timeline
  if(Object.keys(args).some(key=>!['cameraNodeId','frameStart','frameEnd','editableCharacterIds'].includes(key)) || timeline.fps!==30 || !Number.isSafeInteger(args.frameStart)||!Number.isSafeInteger(args.frameEnd)||args.frameStart<timeline.frameStart||args.frameEnd<args.frameStart||args.frameEnd>timeline.frameEnd || args.frameEnd-args.frameStart>9000 || !Array.isArray(args.editableCharacterIds)||!args.editableCharacterIds.length||new Set(args.editableCharacterIds).size!==args.editableCharacterIds.length || args.editableCharacterIds.some(id=>!Object.hasOwn(project.characters,id))) throw new TypeError('Shot requires 30 FPS, a valid inclusive range and unique editable Character IDs')
  if(!project.scene.content.nodes.some(n=>n.type==='camera'&&n.id===args.cameraNodeId))throw new TypeError('Shot camera does not exist')
  const files: PackageFiles={},clips: SavedShot['clips']={},scene=projectEvaluationScene(project),snapshot=createFrameSnapshot()
  const shot: Shot={version:'1.0.0',shotId:randomUUID(),sceneId:project.projectId,fps:30,frameRange:[args.frameStart,args.frameEnd],camera:{keys:[]},characters:[],references:[]}
  const xyz=(v:{x:number;y:number;z:number})=>[v.x,v.y,v.z]
  for(let frame=args.frameStart;frame<=args.frameEnd;frame++) {
    evaluateFrame(scene,frame,snapshot)
    const camera=snapshot.transforms.get(args.cameraNodeId)
    if(!camera)throw new TypeError('Camera could not be evaluated')
    const look=camera.useEuler?new Vector3(0,0,-1).applyQuaternion(new Quaternion().setFromEuler(new Euler(camera.rotation.x*Math.PI/180,camera.rotation.y*Math.PI/180,camera.rotation.z*Math.PI/180))).add(new Vector3(...xyz(camera.position))):camera.lookAt
    if(!look)throw new TypeError('Camera lookAt is unavailable')
    shot.camera.keys.push({frame,position:xyz(camera.position),lookAt:xyz(look),fovYDegrees:camera.fov??50})
  }
  evaluateFrame(scene,args.frameStart,snapshot)
  for(const character of Object.values(project.characters)) {
    const covering=timeline.animation.motionClips.filter(c=>c.target.nodeId===character.nodeId&&c.frameStart<=args.frameEnd&&c.frameEnd>=args.frameStart)
    if(covering.length!==1||covering[0]!.frameStart>args.frameStart||covering[0]!.frameEnd<args.frameEnd) {
      if(args.editableCharacterIds.includes(character.id)) { const own=timeline.animation.motionClips.filter(c=>c.target.nodeId===character.nodeId); throw new TypeError(`Nhân vật ${character.name} cần đúng một MotionClip phủ hết frame ${args.frameStart}–${args.frameEnd}; clip hiện có của nhân vật: ${own.length?own.map(c=>`${c.frameStart}–${c.frameEnd}`).join(', '):'chưa có clip nào trên timeline'}`) }
      continue
    }
    const clip=covering[0]!,motion=project.motions[clip.motion.assetId],binding=project.bindings[clip.id]
    if(!motion||!binding)throw new TypeError('Shot Motion or Binding is missing')
    const source=motion.edit?await resolveProjectBlob(project.projectId,motion.sourceClip):(await resolveUnifiedAssetFile(project,motion.assetId,'source')).bytes
    const manifests=project.extensions.app1Manifests
    const storedManifest=isRecord(manifests)?manifests[motion.assetId]:undefined
    const metadataRoot=project.extensions.retargetMotionMetadata
    const metadata=isRecord(metadataRoot)?metadataRoot[motion.id]:undefined
    const manifest=isRecord(storedManifest)?storedManifest:isRecord(metadata)&&motion.edit===null&&motion.evaluator!=='animation-1.31.8' ? {
      version:'1.0.0',glbSha256:sha256(source),actions:[{uuid:motion.id,glbAnimationIndex:Number.isSafeInteger(metadata.clipIndex)?metadata.clipIndex:0,name:typeof metadata.name==='string'&&metadata.name.trim()?metadata.name:project.assets[motion.assetId]?.displayName??motion.id,fps:30,durationSeconds:motion.durationSeconds}]
    } : undefined
    if(!manifest)throw new TypeError(`Shot requires an imported App 1 manifest for ${character.name}`)
    let packagedSource=source, packagedManifest=structuredClone(manifest) as Record<string, any>
    const node=project.scene.content.nodes.find(n=>n.id===character.nodeId)
    const libraryCharacterId=typeof node?.metadata?.libraryCharacterId==='string'?node.metadata.libraryCharacterId:null
    if(libraryCharacterId){
      const libraryCharacter=resolveCharacter(libraryCharacterId), nativeRig=libraryCharacter.baseModel?.format==='bobj'&&['verity','minecraft20'].includes(libraryCharacter.baseModel.rig)
      if(nativeRig && motion.edit===null){
        const conversion=project.extensions?.libraryMotionConversions?.[motion.assetId]
        if(conversion){
          const ownModel=await libraryCharacterModel(libraryCharacterId)
          packagedSource=composeLibraryActionGlb(ownModel.bytes,source,0)
          packagedManifest={...packagedManifest,rig:'minecraft20',glbSha256:sha256(packagedSource),glb:{bytes:packagedSource.length,mode:'library-character-native'},actions:(Array.isArray(packagedManifest.actions)?packagedManifest.actions:[]).map((entry:any)=>entry.uuid===motion.id?{...entry,glbAnimationIndex:0}:entry)}
        }else{
        const libraryActionUuid=isRecord(metadata)&&typeof metadata.libraryActionUuid==='string'?metadata.libraryActionUuid:motion.id
        const action=getAction({actionUuid:libraryActionUuid}), owned=action.ownerCharId===libraryCharacterId
        if(owned || libraryCharacter.baseModel!.rig==='minecraft20' && action.rig==='minecraft20'){
          const sidecar=path.join(path.dirname(action.glbPath),libraryCharacter.baseModel!.rig==='minecraft20'?'anim.bobj':'anim.original.bbs.bobj')
          const mc20=libraryCharacter.baseModel!.rig==='minecraft20'
          const nativeAction=mc20?source:action.status==='edited'?await readFile(action.glbPath):await libraryNativeAction(libraryCharacterId,sidecar)
          const ownModel=await libraryCharacterModel(libraryCharacterId)
          packagedSource=composeLibraryActionGlb(ownModel.bytes,nativeAction,mc20 && isRecord(metadata) && Number.isSafeInteger(metadata.clipIndex)?Number(metadata.clipIndex):0)
          packagedManifest={...packagedManifest,rig:libraryCharacter.baseModel!.rig,glbSha256:sha256(packagedSource),glb:{bytes:packagedSource.length,mode:'library-character-native'},actions:(Array.isArray(packagedManifest.actions)?packagedManifest.actions:[]).map((entry:any)=>entry.uuid===motion.id?{...entry,glbAnimationIndex:0}:entry)}
        }
        }
      }
    }
    const prefix=`characters/${character.id}`,glb=prefix+'.glb',manifestPath=prefix+'.manifest.json'
    files[glb]=packagedSource;files[manifestPath]=jsonBytes(packagedManifest)
    const t=snapshot.transforms.get(character.nodeId);if(!t)throw new TypeError('Character placement is unavailable')
    const height = app3HeightHint(node?.metadata)
    if(Math.abs(t.rotation.x)>1e-6||Math.abs(t.rotation.z)>1e-6||xyz(t.scale).some(v=>Math.abs(v-(height?.heightScale??1))>1e-6))throw new TypeError('Shot placement supports translation/yaw at unit scale only')
    const offset=(args.frameStart-clip.frameStart)/30*clip.playback.speed
    if(clip.playback.loop&&offset!==0)throw new TypeError('MVP loop shots must begin at the source clip boundary')
    const start=binding.sourceStartSeconds+(binding.reverse?0:offset),end=binding.sourceStartSeconds+binding.sourceLengthSeconds-(binding.reverse?offset:0)
    let shotHeight=height
    if(height) {
      // Native-library shots can recompose a different canonical model from the source project GLB.
      // Root edit deltas must use the exact packaged model's units, rather than the scene's source scale.
      try { shotHeight={...height,heightScale:height.heightBlocks/libraryCharacterBoundingBoxHeight(Buffer.from(packagedSource))} } catch { /* Animation-only GLB retains the source model's canonical units. */ }
    }
    shot.characters.push({...shotHeight,characterId:character.id,glb,manifest:manifestPath,glbSha256:sha256(packagedSource),actionUuid:motion.id,clip:{sourceStartSeconds:start,sourceEndSeconds:end,speed:clip.playback.speed,loop:clip.playback.loop,reverse:binding.reverse},placement:{position:xyz(t.position),yawDegrees:t.rotation.y},rootPolicy:binding.rootPolicy==='in-place'?'in-place':'skeletal',editable:args.editableCharacterIds.includes(character.id)})
    clips[character.id]={clipId:clip.id,motionId:motion.id}
  }
  for(const node of project.scene.content.nodes.filter(n=>n.type==='prop')) {
    const assetId=node.metadata?.assetId
    if(typeof assetId!=='string')throw new TypeError('Prop reference has no imported asset ID')
    const asset=project.assets[assetId as keyof typeof project.assets]
    if(asset?.source.mediaType!=='model/gltf-binary')throw new TypeError('Shot references must be GLB files')
    const source=await resolveUnifiedAssetFile(project,assetId,'source'),t=snapshot.transforms.get(node.id)
    if(!t)throw new TypeError('Prop transform unavailable')
    const file=`references/${randomUUID()}.glb`;files[file]=source.bytes
    shot.references.push({file,sha256:sha256(source.bytes),transform:{position:xyz(t.position),rotationDegrees:xyz(t.rotation),scale:xyz(t.scale)}})
  }
  files['shot.json']=jsonBytes(shot)
  const issues=validateShot(files);if(issues.length)throw new TypeError(JSON.stringify(issues))
  return {shot,files,clips,bytes:Buffer.from(zipPackage(files))}
}
export async function saveShotExport(project: UnifiedProject, built: Awaited<ReturnType<typeof createShotPackage>>) {
  const dir=shotRoot(project.projectId);await mkdir(dir,{recursive:true})
  const saved: SavedShot={sourceRevision:project.revision,zipSha256:sha256(built.bytes),shot:built.shot,clips:built.clips}
  await writeFile(path.join(dir,built.shot.shotId+'.zip'),built.bytes,{flag:'wx'})
  await writeFile(path.join(dir,built.shot.shotId+'.json'),JSON.stringify(saved),{flag:'wx'})
}
export async function loadShotExport(projectId: string,shotId: string) {
  if(!/^[0-9a-f-]{36}$/i.test(shotId))throw new TypeError('Invalid shot ID')
  const dir=shotRoot(projectId),saved=JSON.parse(await readFile(path.join(dir,shotId+'.json'),'utf8')) as SavedShot,bytes=await readFile(path.join(dir,shotId+'.zip'))
  if(sha256(bytes)!==saved.zipSha256)throw new TypeError('Stored shot hash mismatch')
  const files=unzipPackage(bytes),shot=readPackageJson<Shot>(files,'shot.json')
  if(shot.shotId!==shotId||shot.sceneId!==projectId||validateShot(files).length)throw new TypeError('Stored shot is invalid')
  return {saved,files,shot}
}
