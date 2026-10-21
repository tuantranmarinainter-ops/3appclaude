// Shot imports are validated and baked on a detached candidate before replacing the editor.
function clearStudioShot(){studioShot=null;const panel=$('studioShotPanel');if(panel)panel.hidden=true;}
function bakeStudioShot(candidate,character,manifest,shot){
 const entry=manifest.actions.find(action=>action.uuid===character.actionUuid),index=entry?.glbAnimationIndex;
 if(!Number.isInteger(index)||index<0||!candidate.clips[index])throw Error('manifest.actions[].glbAnimationIndex không trỏ tới Action có thật.');
 const clip=candidate.clips[index],range=character.clip;
 if(range.sourceEndSeconds>clip.duration+1e-6)throw Error('Đoạn clip vượt thời lượng Action trong GLB.');
 const duration=(shot.frameRange[1]-shot.frameRange[0])/30;
 if(duration>300)throw Error('Shot vượt giới hạn chỉnh sửa 300 giây của Animation Studio.');
 const base=C.newProject(candidate);base.name=entry.name||clip.name;base.duration=duration;base.fps=30;base.loop=[0,duration];base.inPlace=character.rootPolicy==='in-place';
 const mixer=new T.AnimationMixer(candidate.root),action=mixer.clipAction(clip);action.setLoop(T.LoopOnce,1);action.clampWhenFinished=true;
 try{
  for(let frame=0;frame<=shot.frameRange[1]-shot.frameRange[0];frame++){
   const local=frame/30;mixer.stopAllAction();C.resetRig(candidate);action.reset().play();mixer.setTime(shotSourceTime(range,local));candidate.root.updateMatrixWorld(true);
   C.addKey(base,'root',local,C.snap(candidate.root),'linear');
   for(const rec of candidate.records)C.addKey(base,rec.id,local,C.snap(rec.o),'linear');
  }
 }finally{mixer.stopAllAction();mixer.uncacheRoot(candidate.root);C.resetRig(candidate);}
 return base;
}
async function openStudioShot(file){
 const panel=$('studioShotErrors');panel.hidden=true;panel.textContent='';
 try{
  if(!file||file.size>120*1024*1024)throw Error('Gói shot phải nhỏ hơn 120 MB.');
  const archive=new Uint8Array(await file.arrayBuffer());let total=0;
  const files=unzipSync(archive,{filter:entry=>{
   if(!safePackagePath(entry.name))throw Error('Đường dẫn ZIP không an toàn: '+entry.name);
   total+=entry.originalSize;if(total>240*1024*1024)throw Error('Nội dung giải nén vượt 240 MB.');return !entry.name.endsWith('/');
  }});
  const checked=await inspectShot(files);
  if(checked.issues.length){panel.textContent=checked.issues.map(item=>`${item.code} · ${item.path}: ${item.message}`).join('\n');panel.hidden=false;return false;}
  const shot=checked.shot,character=shot.characters.find(item=>item.editable),manifest=checked.manifests.get(character.characterId);
  if(sceneMode)throw Error('Thoát chế độ Dựng cảnh trước khi mở gói shot.');
  if(mode==='compare')throw Error('Chuyển sang Animation trước khi mở gói shot.');
  const bytes=files[character.glb.split('/').filter(x=>x&&x!=='.').join('/')];let baked;
  const installed=await loadModel(bytes.slice().buffer,character.glb,false,[],[],candidate=>{baked=bakeStudioShot(candidate,character,manifest,shot);});
  if(!installed)return false;
  project=baked;history=[];historyIndex=-1;time=0;selected='root';draft=false;dirty=false;
  studioShot={shot,character,manifest,files,baseShotSha256:await sha256(files['shot.json'])};
  history.push(snapshot());historyIndex=0;syncProject();seek(0);syncButtons();
  const details=$('studioShotPanel');details.hidden=false;details.open=true;
  $('studioShotSummary').textContent=`Shot ${shot.shotId} · ${character.characterId}`;
  $('studioShotInfo').textContent=`Cảnh: ${shot.sceneId}\nNhân vật: ${character.characterId}\nAction: ${project.name}\nFrame: ${shot.frameRange.join(' – ')} · 30 FPS\nVị trí (m): ${character.placement.position.join(', ')} · Yaw: ${character.placement.yawDegrees}°\nCamera (chỉ xem):\n${JSON.stringify(shot.camera,null,2)}`;
  showMinimalSidebar('properties');info('Đã mở gói shot · '+shot.shotId);return true;
 }catch(error){panel.textContent='Không mở được gói shot: '+error.message;panel.hidden=false;return false;}
}
function setupStudioShot(){
 const label=document.createElement('label');label.className='button';label.textContent='Mở gói shot';
 const input=document.createElement('input');input.type='file';input.accept='.zip';input.id='studioShotInput';label.append(input);$('fileMenu').querySelector('div').append(label);
 const errors=document.createElement('pre');errors.id='studioShotErrors';errors.hidden=true;errors.setAttribute('role','alert');errors.style.cssText='white-space:pre-wrap;max-height:180px;overflow:auto;padding:8px;color:var(--text);background:var(--panel)';document.querySelector('.stage').prepend(errors);
 const panel=document.createElement('details');panel.id='studioShotPanel';panel.hidden=true;
 const title=document.createElement('summary');title.id='studioShotSummary';title.textContent='Shot';const body=document.createElement('pre');body.id='studioShotInfo';body.style.cssText='white-space:pre-wrap;max-height:180px;overflow:auto;font:inherit';panel.append(title,body);document.querySelector('.properties').prepend(panel);
 input.addEventListener('change',async()=>{const file=input.files[0];input.value='';if(!file)return;input.disabled=true;try{await openStudioShot(file);}finally{input.disabled=false;$('fileMenu').open=false;}});
}
