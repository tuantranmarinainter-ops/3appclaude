// Concatenated with app.js by build.mjs; authoring state remains in the existing editor.
import * as ShotExport from './shot_export.js';
import * as ShotPackage from './shot_package.js';
import {unzipSync,zipSync} from 'three/addons/libs/fflate.module.js';
function setupShotWorkspace(){
 let session=null,busy=false;
 const menu=$('fileMenu').querySelector('div'),open=document.createElement('button'),input=document.createElement('input');
 open.textContent='Mở gói shot';input.type='file';input.accept='.zip';menu.append(open,input);
 const panel=document.createElement('details');panel.id='shotPanel';panel.hidden=true;panel.open=true;
 const heading=document.createElement('summary');heading.textContent='Shot';const metadata=document.createElement('pre');metadata.style.maxHeight='140px';metadata.style.overflow='auto';
 panel.append(heading,metadata);$('minimalSidebar').append(panel);
 const failure=document.createElement('dialog');failure.style.whiteSpace='pre-wrap';const errors=document.createElement('pre'),close=document.createElement('button');close.textContent='Đóng';close.onclick=()=>failure.close();failure.append(errors,close);document.body.append(failure);
 const exportButton=document.createElement('button');exportButton.textContent='Xuất gói kết quả';exportButton.hidden=true;menu.append(exportButton);
 const clear=()=>{session=null;panel.hidden=true;exportButton.hidden=true;};
 async function exportFiles(){if(!session||session.rigFingerprint!==rig.fingerprint)throw Error('Không có shot đang chỉnh.');if(busy||sceneMode||sourcePreview||directorPending||draft)throw Error('Ghi key và đóng preview/cảnh trước khi xuất.');const duration=(session.shot.frameRange[1]-session.shot.frameRange[0])/30;if(Math.abs(project.duration-duration)>1e-6)throw Error('Không được đổi thời lượng shot.');busy=true;playing=false;try{const policy=ShotExport.placementPolicy(rig,project,session),glb=await ShotExport.bakeEditedGLB(rig,policy.project,session.entry.name);return await ShotExport.resultFiles(session,glb,policy.placementKeys);}finally{busy=false;refresh();}}
 exportButton.onclick=guard(async()=>{const files=await exportFiles();download(zipSync(files),session.shot.shotId.replace(/[^a-zA-Z0-9_-]/g,'_')+'.result.zip','application/zip');});
 async function openFiles(files){
  if(busy)throw Error('Đang xử lý gói shot.');busy=true;
  try{
   const issues=await ShotPackage.validateShot(files);if(issues.length){errors.textContent=issues.map(i=>i.code+' · '+i.path+'\n'+i.message).join('\n\n');failure.showModal();throw Error('Gói shot không hợp lệ ('+issues.length+' lỗi).');}
   const shot=ShotPackage.readJSON(files,'shot.json'),character=shot.characters.find(c=>c.editable),manifest=ShotPackage.readJSON(files,character.manifest),entry=manifest.actions.find(a=>a.uuid===character.actionUuid),index=entry.glbAnimationIndex;
   if(!Number.isInteger(index)||index<0)throw Error('Manifest thiếu glbAnimationIndex hợp lệ cho actionUuid.');
   const bytes=files[character.glb],buffer=bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);
   // Parse and sample before replacing the current editor, so broken GLB/Action cannot replace it.
   const candidate=await parseAsset(buffer,character.glb),clip=candidate.clips[index];
   if(!clip){disposeObject(candidate.root);throw Error('glbAnimationIndex không tồn tại trong GLB.');}
   if(character.clip.sourceEndSeconds>clip.duration+1e-5){disposeObject(candidate.root);throw Error('Clip vượt quá thời lượng Action trong GLB.');}
   const frames=shot.frameRange[1]-shot.frameRange[0],duration=frames/30;
   if(duration<.1||duration>300){disposeObject(candidate.root);throw Error('Editor hiện hỗ trợ shot dài >=0.1 và <=300 giây.');}
   const baked=C.newProject(candidate);baked.name=entry.name||clip.name;baked.fps=30;baked.duration=duration;baked.loop=[0,duration];
   const mixer=new T.AnimationMixer(candidate.root),action=mixer.clipAction(clip);action.setLoop(T.LoopOnce,1);action.clampWhenFinished=true;action.play();
   try{for(let frame=0;frame<=frames;frame++){const t=frame/30;C.resetRig(candidate);action.reset().play();mixer.setTime(ShotPackage.clipTime(character.clip,t));candidate.root.updateMatrixWorld(true);for(const[id,value]of Object.entries(C.capture(candidate)))C.addKey(baked,id,t,value,'linear');}}finally{mixer.stopAllAction();mixer.uncacheRoot(candidate.root);disposeObject(candidate.root);}
   if((dirty||draft)&&!confirm('Thay bài đang chỉnh bằng gói shot?'))return false;
   if(sceneMode)sceneExit();
   await loadModel(buffer,character.glb,true);
   project=C.validateProject(baked,rig);time=0;history=[snapshot()];historyIndex=0;dirty=false;syncProject();seek(0);
   session={files,shot,character,manifest,entry,baseShotSha256:await ShotPackage.sha256(files['shot.json']),sourceProject:C.clone(project),rigFingerprint:rig.fingerprint,placementKeys:[{frame:shot.frameRange[0],...C.clone(character.placement)}]};
   metadata.textContent='Shot: '+shot.shotId+'\nNhân vật: '+character.characterId+'\nFrame: '+shot.frameRange.join(' → ')+' @30 FPS\nVị trí (m): '+character.placement.position.join(', ')+'; yaw '+character.placement.yawDegrees+'°\nRoot: '+character.rootPolicy+'\nCamera (chỉ xem):\n'+JSON.stringify(shot.camera,null,2);panel.hidden=false;exportButton.hidden=false;
   info('Đã mở shot '+shot.shotId+' · '+character.characterId);return true;
  }finally{busy=false;}
 }
 open.onclick=()=>input.click();input.onchange=guard(async()=>{try{if(input.files[0])await openFiles(unzipSync(new Uint8Array(await input.files[0].arrayBuffer())));}finally{input.value='';}});
 window.__studio.shot={openFiles,exportFiles,clear,get session(){return session;},get busy(){return busy;}};
}
setupShotWorkspace();
