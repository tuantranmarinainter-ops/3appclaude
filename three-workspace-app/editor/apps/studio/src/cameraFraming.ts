import { Box3,Euler,Matrix4,Quaternion,Vector3 } from 'three'
import { createFrameSnapshot,evaluateFrame } from '@topview/3d-builder/evaluate'
import type { UnifiedProject } from '@bbs/animation-workspace-shared'
import { evaluateProjectSkeletons,projectEvaluationScene } from './unifiedSkeletonEvaluation'
import { characterNode,fields,profilePoints,requireStaticPlacement } from './sceneLayoutPlacement'
const vector=(v:{x:number;y:number;z:number})=>new Vector3(v.x,v.y,v.z)
const object=(v:Vector3)=>({x:v.x,y:v.y,z:v.z})
const corners=(box:Box3)=>[...Array(8)].map((_,i)=>new Vector3(i&1?box.max.x:box.min.x,i&2?box.max.y:box.min.y,i&4?box.max.z:box.min.z))

/** Fit the entire selected skeleton bounds. Shot sizes control headroom, never accidentally crop another subject. */
export async function previewCameraFraming(project:UnifiedProject,args:Record<string,unknown>){
 fields(args,['cameraId','characterIds','shot','angle','frame','viewportAspect','fovYDegrees','follow'])
 const node=project.scene.content.nodes.find(n=>n.id===args.cameraId&&n.type==='camera')
 if(!node?.camera)throw new TypeError('cameraId must identify an existing camera')
 requireStaticPlacement(project,node.id)
 if(!Array.isArray(args.characterIds)||args.characterIds.length<1||args.characterIds.length>2||new Set(args.characterIds).size!==args.characterIds.length)throw new TypeError('Select one or two unique characterIds')
 const subjects=args.characterIds.map(id=>characterNode(project,id))
 if(subjects.some(n=>n.parentId))throw new TypeError('Framing does not support parented subjects')
 const margin=({wide:1.6,medium:1.25,close:1.05} as Record<string,number>)[args.shot as string]
 const elevation=({eye:0,high:30,low:-20} as Record<string,number>)[args.angle as string]
 if(margin===undefined||elevation===undefined)throw new TypeError('shot: wide/medium/close; angle: eye/high/low')
 const timeline=project.scene.content.timeline,frame=args.frame===undefined?timeline.frameStart:args.frame
 if(typeof frame!=='number'||!Number.isFinite(frame)||frame<timeline.frameStart||frame>timeline.frameEnd)throw new TypeError('frame must be within timeline')
 const ratio=(node.camera.aspectRatio??project.scene.content.aspectRatio??'16:9').split(':').map(Number)
 const parsedAspect=ratio[0]!/ratio[1]!
 const aspect=args.viewportAspect??(Number.isFinite(parsedAspect)&&parsedAspect>0?parsedAspect:21/9),fov=args.fovYDegrees??50
 if(typeof aspect!=='number'||!Number.isFinite(aspect)||aspect<0.25||aspect>4||typeof fov!=='number'||!Number.isFinite(fov)||fov<20||fov>100||args.follow!==undefined&&typeof args.follow!=='boolean')throw new TypeError('Invalid framing aspect/FOV/follow')
 const snapshot=createFrameSnapshot();evaluateFrame(projectEvaluationScene(project),frame,snapshot)
 const evaluated=await evaluateProjectSkeletons(project,snapshot),samples=new Map(evaluated.skeletonSamples.map(s=>[s.nodeId,s]))
 const subjectBounds=subjects.map(subject=>{
  const sample=samples.get(subject.id),character=Object.values(project.characters).find(c=>c.nodeId===subject.id)
  let points=sample?.bones.map(b=>new Vector3().setFromMatrixPosition(new Matrix4().fromArray(b.worldMatrix)))??[]
  let source='evaluated-skeleton'
  if(!points.length){
   const t=snapshot.transforms.get(subject.id)!,matrix=new Matrix4().compose(vector(t.position),new Quaternion().setFromEuler(new Euler(t.rotation.x*Math.PI/180,t.rotation.y*Math.PI/180,t.rotation.z*Math.PI/180)),vector(t.scale))
   const rest=profilePoints(character?project.skeletons[character.skeletonId]:undefined)
   points=rest.map(p=>p.point.applyMatrix4(matrix));source='rest-skeleton'
   if(!points.length){points=corners(new Box3(new Vector3(-0.3,0,-0.2),new Vector3(0.3,1.9,0.2))).map(p=>p.applyMatrix4(matrix));source='assumed-placeholder-1.9m'}
  }
  if(points.some(p=>!p.toArray().every(Number.isFinite)))throw new TypeError('Subject skeleton has nonfinite bounds')
  const box=new Box3().setFromPoints(points).expandByScalar(0.12)
  return {nodeId:subject.id,source,box}
 })
 const box=new Box3();for(const subject of subjectBounds)box.union(subject.box)
 const target=box.getCenter(new Vector3()),rad=elevation*Math.PI/180,direction=new Vector3(0,Math.sin(rad),Math.cos(rad)),right=new Vector3(1,0,0),up=new Vector3().crossVectors(direction,right).normalize()
 const tanV=Math.tan(fov*Math.PI/360),tanH=tanV*aspect,points=subjectBounds.flatMap(s=>corners(s.box))
 let distance=0.1
 for(const p of points){const d=p.clone().sub(target);distance=Math.max(distance,d.dot(direction)+Math.max(Math.abs(d.dot(right))*margin/tanH,Math.abs(d.dot(up))*margin/tanV)+0.1)}
 const position=target.clone().addScaledVector(direction,distance),document=structuredClone(project.scene),camera=document.content.nodes.find(n=>n.id===node.id)!
 const rotation=new Euler().setFromRotationMatrix(new Matrix4().lookAt(position,target,new Vector3(0,1,0)))
 camera.transform.position=object(position);camera.transform.rotation={x:rotation.x*180/Math.PI,y:rotation.y*180/Math.PI,z:rotation.z*180/Math.PI}
 camera.camera!.lookAt=object(target);camera.camera!.fov=fov;camera.camera!.aspectRatio=`${Math.round(aspect*10000)}:10000`;camera.camera!.near=0.01;camera.camera!.far=Math.max(1000,distance+box.getSize(new Vector3()).length()+10)
 delete camera.camera!.subject;delete camera.camera!.lookAtTarget
 if(args.follow){
  const primary=subjects[0]!,sample=samples.get(primary.id),origin=sample?new Vector3().setFromMatrixPosition(new Matrix4().fromArray(sample.actorWorldMatrix)):vector(snapshot.transforms.get(primary.id)!.position)
  camera.camera!.subject={nodeId:primary.id,distance,offset:object(position.clone().sub(origin)),lookAtOffset:object(target.clone().sub(origin)),follow:true,followRotation:false,overridesMotion:true}
 }
 const projection=points.map(p=>{const delta=p.clone().sub(target),depth=distance-delta.dot(direction);return {x:delta.dot(right)/(depth*tanH),y:delta.dot(up)/(depth*tanV),depth}})
 if(projection.some(p=>Math.abs(p.x)>1||Math.abs(p.y)>1||p.depth<=0))throw new TypeError('Framing could not contain subject bounds')
 return {sourceRevision:project.revision,frame,cameraId:node.id,shot:args.shot,angle:args.angle,viewportAspect:aspect,distanceMeters:distance,
  position:object(position),lookAt:object(target),fovYDegrees:fov,subjectBounds:subjectBounds.map(s=>({nodeId:s.nodeId,source:s.source,min:object(s.box.min),max:object(s.box.max)})),maxProjectedAbs:Math.max(...projection.flatMap(p=>[Math.abs(p.x),Math.abs(p.y)])),
  operations:[{type:'document.replace',document,fcurves:project.extensions.topview?.fcurves??null}]}
}
