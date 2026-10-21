import { Box3,Euler,Matrix4,Quaternion,Vector3 } from 'three'
import { createFrameSnapshot,evaluateFrame,FCurveSet } from '@topview/3d-builder/evaluate'
import type { UnifiedProject } from '@bbs/animation-workspace-shared'
import { evaluateProjectSkeletons,projectEvaluationScene } from './unifiedSkeletonEvaluation'
import { characterNode,fields,profilePoints,requireStaticPlacement } from './sceneLayoutPlacement'
const vector=(v:{x:number;y:number;z:number})=>new Vector3(v.x,v.y,v.z)
const object=(v:Vector3)=>({x:v.x,y:v.y,z:v.z})
const corners=(box:Box3)=>[...Array(8)].map((_,i)=>new Vector3(i&1?box.max.x:box.min.x,i&2?box.max.y:box.min.y,i&4?box.max.z:box.min.z))

/** Fit anatomical shot bounds while preserving horizontal coverage of every selected subject. */
export async function previewCameraFraming(project:UnifiedProject,args:Record<string,unknown>){
 fields(args,['cameraId','characterIds','shot','angle','frame','viewportAspect','fovYDegrees','follow'])
 const node=project.scene.content.nodes.find(n=>n.id===args.cameraId&&n.type==='camera')
 if(!node?.camera)throw new TypeError('cameraId must identify an existing camera')
 requireStaticPlacement(project,node.id)
 // Camera tracks override document camera fields during evaluation. Reject explicitly,
 // including constant keys, until framing can update all camera channels atomically.
 const rawKeys=project.extensions.topview?.fcurves
 if(rawKeys){
  const userKeys=FCurveSet.parseUserKeys(rawKeys)
  const curves=FCurveSet.parse(rawKeys).encode().fcurves as Array<{t:[string,string]}>
  if(Object.values(userKeys[node.id]??{}).some(keys=>Array.isArray(keys)&&keys.length)||curves.some(curve=>curve.t[1]===node.id))throw new TypeError('Camera framing does not overwrite existing camera key channels; remove camera keys first')
 }
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
  let named=sample?.bones.map(b=>({name:b.name,point:new Vector3().setFromMatrixPosition(new Matrix4().fromArray(b.worldMatrix))}))??[]
  let points=named.map(p=>p.point)
  let source='evaluated-skeleton'
  if(!points.length){
   const t=snapshot.transforms.get(subject.id)!,matrix=new Matrix4().compose(vector(t.position),new Quaternion().setFromEuler(new Euler(t.rotation.x*Math.PI/180,t.rotation.y*Math.PI/180,t.rotation.z*Math.PI/180)),vector(t.scale))
   const rest=profilePoints(character?project.skeletons[character.skeletonId]:undefined)
   named=rest.map(p=>({...p,point:p.point.applyMatrix4(matrix)}));points=named.map(p=>p.point);source='rest-skeleton'
   if(!points.length){points=corners(new Box3(new Vector3(-0.3,0,-0.2),new Vector3(0.3,1.9,0.2))).map(p=>p.applyMatrix4(matrix));source='assumed-placeholder-1.9m'}
  }
  if(points.some(p=>!p.toArray().every(Number.isFinite)))throw new TypeError('Subject skeleton has nonfinite bounds')
  const fullBox=new Box3().setFromPoints(points).expandByScalar(0.12)
  const landmark=args.shot==='medium'?named.find(p=>/(?:hips|pelvis)$/i.test(p.name)):named.find(p=>/spine2$/i.test(p.name))??named.find(p=>/neck$/i.test(p.name))
  const box=fullBox.clone()
  if(args.shot!=='wide')box.min.y=landmark?landmark.point.y-0.08:fullBox.min.y+fullBox.getSize(new Vector3()).y*(args.shot==='medium'?0.48:0.72)
  const placement=snapshot.transforms.get(subject.id)!
  const restMatrix=new Matrix4().compose(vector(placement.position),new Quaternion().setFromEuler(new Euler(placement.rotation.x*Math.PI/180,placement.rotation.y*Math.PI/180,placement.rotation.z*Math.PI/180)),vector(placement.scale))
  const restFeet=profilePoints(character?project.skeletons[character.skeletonId]:undefined).filter(p=>/foot|toe/i.test(p.name)).map(p=>p.point.applyMatrix4(restMatrix).y)
  const restFloor=restFeet.length?Math.min(...restFeet):placement.position.y
  return {nodeId:subject.id,source,box,fullBox,floor:restFloor,landmark:args.shot==='wide'?'full-skeleton':landmark?.name??'height-fallback'}
 })
 const box=new Box3();for(const subject of subjectBounds)box.union(subject.box)
 const target=box.getCenter(new Vector3()),rad=elevation*Math.PI/180,direction=new Vector3(0,Math.sin(rad),Math.cos(rad)),right=new Vector3(1,0,0),up=new Vector3().crossVectors(direction,right).normalize()
 const tanV=Math.tan(fov*Math.PI/360),tanH=tanV*aspect,points=subjectBounds.flatMap(s=>corners(s.box))
 const floorY=Math.max(...subjectBounds.map(s=>s.floor)),minimumCameraY=floorY+0.3
 const horizontalPoints=subjectBounds.flatMap(s=>corners(s.fullBox))
 let distance=0.1
 const fit=()=>{
  let result=0.1
  for(const p of points){
   const d=p.clone().sub(target)
   result=Math.max(result,d.dot(direction)+Math.max(Math.abs(d.dot(right))*margin/tanH,Math.abs(d.dot(up))*margin/tanV)+0.1)
  }
  // Cropped legs may be closer to a low camera than the torso. Include their
  // depth in the horizontal fit without requiring them to fit vertically.
  for(const p of horizontalPoints){
   const d=p.clone().sub(target)
   result=Math.max(result,d.dot(direction)+Math.abs(d.dot(right))*margin/tanH+0.1)
  }
  return result
 }
 distance=fit()
 // Raising a low camera changes its pitch. Refit with that pitch until the
 // floor-constrained solution converges, rather than clamping a stale fit.
 for(let i=0;i<100;i++){
  if(target.y+direction.y*distance>=minimumCameraY+1e-7)break
  const horizontal=direction.z*distance
  direction.set(0,minimumCameraY+1e-6-target.y,horizontal).normalize()
  up.crossVectors(direction,right).normalize()
  distance=fit()
 }
 const position=target.clone().addScaledVector(direction,distance)
 if(position.y<minimumCameraY-1e-7)throw new TypeError('Framing could not satisfy camera floor clearance')
 const document=structuredClone(project.scene),camera=document.content.nodes.find(n=>n.id===node.id)!
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
  position:object(position),lookAt:object(target),fovYDegrees:fov,floorY,minimumCameraY,intentionalCrop:subjectBounds.map(s=>({nodeId:s.nodeId,belowY:args.shot==='wide'?null:s.box.min.y,landmark:s.landmark,description:args.shot==='wide'?'Full skeleton':'Body below shot landmark intentionally excluded from vertical fit'})),subjectBounds:subjectBounds.map(s=>({nodeId:s.nodeId,source:s.source,min:object(s.box.min),max:object(s.box.max)})),maxProjectedAbs:Math.max(...projection.flatMap(p=>[Math.abs(p.x),Math.abs(p.y)])),
  operations:[{type:'document.replace',document,fcurves:project.extensions.topview?.fcurves??null}]}
}
