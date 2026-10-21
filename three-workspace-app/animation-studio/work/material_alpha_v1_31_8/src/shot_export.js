import * as T from 'three';
import {GLTFExporter} from 'three/addons/exporters/GLTFExporter.js';
import * as C from './core.js';
import {sha256} from './shot_package.js';
const encode=x=>new TextEncoder().encode(JSON.stringify(x,null,2)+'\n');
// Keep actor placement outside skeletal animation. Change placement policy here only.
export function placementPolicy(rig,project,session){
 const source=session.sourceProject,base=session.character.placement,keys=new Map(session.placementKeys.map(k=>[k.frame,structuredClone(k)]));
 const yaw0=T.MathUtils.degToRad(base.yawDegrees),rotation=new T.Quaternion().setFromAxisAngle(new T.Vector3(0,1,0),yaw0);
 let changed=false;
 for(let frame=session.shot.frameRange[0];frame<=session.shot.frameRange[1];frame++){
  const t=(frame-session.shot.frameRange[0])/30,a=C.sampleKeys(project.keys.root,t,rig.rootRest),b=C.sampleKeys(source.keys.root,t,rig.rootRest);
  const delta=new T.Vector3().fromArray(a.p).sub(new T.Vector3().fromArray(b.p)),q=new T.Quaternion().fromArray(a.q).multiply(new T.Quaternion().fromArray(b.q).invert()).normalize(),e=new T.Euler().setFromQuaternion(q,'YXZ');
  if(Math.abs(e.x)>1e-5||Math.abs(e.z)>1e-5||a.s.some((v,i)=>Math.abs(v-b.s[i])>1e-5))throw Error('Shot placement chỉ hỗ trợ position và yaw; pitch/roll/scale root chưa hỗ trợ.');
  if(delta.lengthSq()>1e-12||Math.abs(e.y)>1e-6){changed=true;keys.set(frame,{frame,position:delta.applyQuaternion(rotation).add(new T.Vector3().fromArray(base.position)).toArray(),yawDegrees:base.yawDegrees+T.MathUtils.radToDeg(e.y)});}
 }
 // Dense keys retain holds and the return to the original root position.
 if(changed)for(let frame=session.shot.frameRange[0];frame<=session.shot.frameRange[1];frame++)if(!keys.has(frame))keys.set(frame,{frame,...structuredClone(base)});
 const baked=structuredClone(project);baked.keys.root=structuredClone(source.keys.root||[]);
 if(project.lab)throw Error('Xuất shot từ Animation Lab chưa hỗ trợ tách root. Chuyển về Animation trước khi xuất.');
 return{project:baked,placementKeys:[...keys.values()].sort((a,b)=>a.frame-b.frame)};
}
export function readGLB(buffer){const b=buffer instanceof Uint8Array?buffer:new Uint8Array(buffer),v=new DataView(b.buffer,b.byteOffset,b.byteLength);if(v.getUint32(0,true)!==0x46546c67||v.getUint32(4,true)!==2)throw Error('Invalid GLB.');const size=v.getUint32(12,true);return{json:JSON.parse(new TextDecoder().decode(b.subarray(20,20+size))),rest:b.slice(20+size)};}
export function writeGLB(json,rest){const text=new TextEncoder().encode(JSON.stringify(json)),size=Math.ceil(text.length/4)*4,out=new Uint8Array(20+size+rest.length),v=new DataView(out.buffer);v.setUint32(0,0x46546c67,true);v.setUint32(4,2,true);v.setUint32(8,out.length,true);v.setUint32(12,size,true);v.setUint32(16,0x4e4f534a,true);out.fill(32,20,20+size);out.set(text,20);out.set(rest,20+size);return out;}
export async function bakeEditedGLB(rig,project,name){
 if(rig.profile!=='Mixamo'||rig.records.length!==65)throw Error('Gói kết quả cần rig Mixamo65.');
 const saved=C.capture(rig),copies=new Map(),clone=o=>{const n=o.isBone?new T.Bone():new T.Group();n.name=o.isBone?C.short(o.name):o.name||'AuxScene';n.position.copy(o.position);n.quaternion.copy(o.quaternion);n.scale.copy(o.scale);copies.set(o,n);for(const c of o.children)if(!c.isMesh&&!c.isLine&&!c.isSprite) n.add(clone(c));return n;};
 C.resetRig(rig);const root=clone(rig.root),objects=[rig.root,...rig.records.map(r=>r.o)],arrays=objects.map(()=>({p:[],q:[],s:[]})),times=Array.from({length:Math.round(project.duration*30)+1},(_,i)=>i/30);
 try{
  for(const t of times){C.evaluate(rig,project,t);for(let i=0;i<objects.length;i++){const pose=C.snap(objects[i]);for(const k of ['p','q','s']){if(pose[k].some(v=>!Number.isFinite(v)))throw Error('Transform không hữu hạn.');arrays[i][k].push(...pose[k]);}}}
  const tracks=[];for(let i=0;i<objects.length;i++){const n=copies.get(objects[i]),a=arrays[i];tracks.push(new T.VectorKeyframeTrack(n.uuid+'.position',times,a.p),new T.QuaternionKeyframeTrack(n.uuid+'.quaternion',times,a.q),new T.VectorKeyframeTrack(n.uuid+'.scale',times,a.s));}
  const clip=new T.AnimationClip(name,project.duration,tracks),buffer=await new GLTFExporter().parseAsync(root,{binary:true,onlyVisible:false,animations:[clip],trs:true}),{json,rest}=readGLB(buffer);
  const joints=rig.records.map(r=>json.nodes.findIndex(n=>n.name===C.short(r.name)));if(joints.some(i=>i<0)||new Set(joints).size!==65)throw Error('Không xuất được duy nhất 65 joint.');
  json.skins=[{name:'Mixamo65',joints,skeleton:joints[0]}];json.extras={app:'Animation Studio',contractVersion:'1.0.0',bakeFps:30,units:'meters'};
  return writeGLB(json,rest);
 }finally{for(const[id,pose]of Object.entries(saved))C.apply(id==='root'?rig.root:rig.records.find(r=>r.id===id).o,pose);rig.root.updateMatrixWorld(true);root.clear();}
}
export async function resultFiles(session,glb,placementKeys){
 const id=crypto.randomUUID(),h=await sha256(glb),stem=session.character.characterId.replace(/[^a-zA-Z0-9_-]/g,'_')||'character',path='edits/'+stem;
 const manifest={...structuredClone(session.manifest),version:'1.0.0',glbSha256:h,glb:{bytes:glb.byteLength,mode:'animation-only'},actions:[{uuid:id,name:session.entry.name,durationSeconds:(session.shot.frameRange[1]-session.shot.frameRange[0])/30,fps:30,glbAnimationIndex:0,originalActionUuid:session.character.actionUuid}]};
 const result={version:'1.0.0',shotId:session.shot.shotId,baseShotSha256:session.baseShotSha256,edits:[{characterId:session.character.characterId,originalActionUuid:session.character.actionUuid,newActionUuid:id,glb:path+'.glb',manifest:path+'.manifest.json',glbSha256:h,placementKeys}]};
 return{'result.json':encode(result),[path+'.glb']:glb,[path+'.manifest.json']:encode(manifest)};
}
