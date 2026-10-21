function directorRevision(){
 const text=JSON.stringify(project);let a=2166136261,b=5381;for(let i=0;i<text.length;i++){a=Math.imul(a^text.charCodeAt(i),16777619);b=Math.imul(b,33)^text.charCodeAt(i);}return [rig.root.uuid,activeEditorSlot,studioMode,rig.activeRoot||'all',$('sourceUnits').value,text.length,(a>>>0).toString(16),(b>>>0).toString(16)].join(':');
}
function directorContext(){if(!rig||!project)return {ready:false};const d=Director.metadata(project);return{ready:true,revision:directorRevision(),name:project.name,rig:rig.fingerprint,rootUuid:rig.root.uuid,activeRoot:rig.activeRoot||'all',slot:activeEditorSlot,bank:studioMode,layer:project.lab?.activeLayer||null,fps:project.fps,duration:project.duration,selected,time,idea:d.idea,markers:d.markers,units:$('sourceUnits').value,space:'local transforms; editor '+rig.editorUp+'-up',bones:['root',...rig.records.map(r=>r.id),...Object.keys(rig.controls)].map(id=>({id,name:id==='root'?'Root':record(rig,id)?.name||id,parent:record(rig,id)?.parent||null})),keyCount:Object.values(project.keys).reduce((n,ks)=>n+ks.length,0),preview:directorPending?{id:directorPending.id,summary:directorPending.summary}:null,scene:typeof sceneHeartbeat==='function'?sceneHeartbeat():null};}
function syncDirector(){if(directorPanel&&rig&&project)directorPanel.update(directorContext());}
function directorRestore(s){for(const[id,o]of s.options||[])C.kinematics.configure(rig,rig.chains.find(c=>c.id===id),o,false);for(const[id,m]of s.modes)rig.chains.find(c=>c.id===id).mode=m;for(const[id,p]of Object.entries(s.pose))C.apply(id==='root'?rig.root:record(rig,id).o,p);for(const[id,p]of Object.entries(s.controls))C.apply(rig.controls[id].object,p);rig.root.updateMatrixWorld(true);}
function directorGuard(allowDraft=false){assertEditingAllowed();if(mode==='compare')throw Error('Trở về Animation trước khi dùng Director.');if(sourcePreview)throw Error('Chọn Dùng để chỉnh sửa trước khi tạo Blocking.');if(draft&&!allowDraft)throw Error('Ghi hoặc hủy pose chưa ghi trước khi dùng Director.');if(rigDrag||numericDrag||timelineKeyDrag||motionHandDrag||editViews.some(v=>v.gizmo.dragging||v.moveGizmo.dragging))throw Error('Kết thúc thao tác kéo trước khi dùng Director.');}
function directorCheckRevision(revision){if(typeof revision!=='string'||revision!==directorRevision())throw Error('Dữ liệu đã thay đổi. Đọc get_animation_context rồi tạo bản chỉnh mới.');}
function directorStage(tool,args,revision,allowDraft=false){
 directorGuard(allowDraft);directorCheckRevision(revision);if(directorPending)directorCancel();cancelEasingPreview();const saved=snapshot();let candidate;
 try{if(tool==='create_blocking')candidate=Director.blocking(rig,project,args,t=>{C.evaluate(rig,project,t);return C.capture(rig);});else candidate=Director.patch(rig,project,tool,args);}finally{directorRestore(saved);}
 const id='patch-'+(++directorPatchCounter),before=directorRevision(),changed=Object.keys(candidate.keys).filter(id=>JSON.stringify(candidate.keys[id])!==JSON.stringify(project.keys[id])).length;
 directorPending={id,before,candidate,saved,slot:activeEditorSlot,showing:candidate,summary:changed+' track thay đổi · '+candidate.duration.toFixed(3)+' s · '+Object.values(candidate.keys).reduce((n,ks)=>n+ks.length,0)+' key'};
 playing=false;C.evaluate(rig,candidate,Math.min(time,candidate.duration));dirtyViews();syncDirector();return {patchId:id,baseRevision:before,summary:directorPending.summary,markers:Director.metadata(candidate).markers};
}
function directorCancel(){if(!directorPending)return;const p=directorPending;directorPending=null;playing=false;if(p.slot===activeEditorSlot&&p.before===directorRevision()){time=p.saved.time;draft=p.saved.draft;directorRestore(p.saved);syncTime();}dirtyViews();syncDirector();}
function directorApply(id,revision){directorGuard(true);directorCheckRevision(revision);const p=directorPending;if(!p||p.id!==id||p.before!==revision||p.slot!==activeEditorSlot)throw Error('Bản chỉnh hết hiệu lực; tạo lại preview.');project=C.validateProject(p.candidate,rig);directorPending=null;studioMode=project.lab?'lab':'classic';$('studioMode').value=studioMode;playing=false;draft=false;time=Math.min(time,project.duration);selectionKeys=[];C.evaluate(rig,project,time);commit();syncProject();setMode('create');refresh();syncDirector();return {applied:true,revision:directorRevision(),undoSteps:1};}
async function directorCall(tool,args={}){
 if(['get_scene_context','preview_scene_patch','apply_scene_patch','cancel_scene_patch','undo_scene','export_scene'].includes(tool))return sceneCall(tool,args);
 if(tool==='get_animation_context')return directorContext();
 if(tool==='read_keyframes'){const chosen=Director.ids(rig,args.boneIds||[selected]),start=args.start??0,end=args.end??project.duration;if(!Number.isFinite(start)||!Number.isFinite(end)||end<start)throw Error('Khoảng đọc key không hợp lệ.');const result={};let count=0;for(const id of chosen){result[id]=(project.keys[id]||[]).filter(k=>k.time>=start-1e-7&&k.time<=end+1e-7).map(k=>C.clone(k));count+=result[id].length;}if(count>2000)throw Error('Giới hạn 2000 key mỗi lần; chọn đoạn hoặc ít xương hơn.');return{revision:directorRevision(),tracks:result};}
 if(tool==='analyze_motion'){directorGuard();if(project.lab)throw Error('Tạo Blocking trước khi phân tích track Director.');return Director.analyze(rig,project,args);}
 if(tool==='preview_patch'){const p=directorPending;if(!p||p.id!==args.patchId||p.before!==directorRevision())throw Error('Bản chỉnh hết hiệu lực.');directorGuard(true);p.showing=args.original?project:p.candidate;time=Math.min(time,p.showing.duration);C.evaluate(rig,p.showing,time);syncTime();dirtyViews();return{patchId:p.id,summary:p.summary,showing:args.original?'original':'processed',time};}
 if(tool==='apply_patch')return directorApply(args.patchId,args.expectedRevision);
 if(tool==='cancel_patch'){directorCancel();return{cancelled:true};}
 if(tool==='undo_animation'){directorGuard();directorCheckRevision(args.expectedRevision);directorCancel();restoreHistory(historyIndex-1);syncDirector();return directorContext();}
 if(tool==='export_animation'){directorGuard();directorCheckRevision(args.expectedRevision);if(directorPending)throw Error('Áp dụng hoặc hủy preview trước khi xuất.');if(!['bobj','fbx'].includes(args.format))throw Error('Chọn BOBJ hoặc FBX.');const result=await buildDirectAnimation(args.format);return{filename:safeName()+'.'+args.format,format:args.format,encoding:args.format==='bobj'?'text':'base64',data:args.format==='bobj'?result.data:base64(result.data)};}
 const {expectedRevision,...parameters}=args;return directorStage(tool,parameters,expectedRevision);
}
async function directorAction(action,a){
 const revision=directorRevision(),chosen=()=>a.scope==='selected'?[selected]:['root',...rig.records.map(r=>r.id)];
 if(action==='close'){directorPanel.hide();return;}
 if(action==='connect'){await studioBridge.connect();return;}
 if(action==='seek'){directorCancel();const m=project.director?.markers.find(m=>m.id===a.markerId);if(m){playing=false;seek(m.time);}return;}
 if(action==='graph'){setAnimationEditor('graph');directorPanel.hide();return;}
 if(action==='cancel'){directorCancel();return;}
 if(action==='original'||action==='processed'){await directorCall('preview_patch',{patchId:directorPending?.id,original:action==='original'});return;}
 if(action==='play'){if(!directorPending)throw Error('Tạo bản xem thử trước.');$('playBtn').click();return;}
 if(action==='scrub'){if(directorPending){playing=false;seek(a.scrubTime);}return;}
 if(action==='apply'){directorApply(directorPending?.id,revision);directorPanel.message('Đã áp dụng · một bước Undo.');return;}
 let result;
 if(action==='create'){const labels=['Sẵn sàng','Lấy đà','Chuẩn bị ra đòn','Ra đòn / tiếp xúc','Hãm chuyển động','Hồi phục'],duration=project.duration;result=directorStage('create_blocking',{idea:a.idea,markers:[0,.2,.35,.45,.65,1].map((f,i)=>({id:'pose'+i,time:i===5?duration:Math.round(duration*f*project.fps)/project.fps,label:labels[i],kind:i===3?'contact':'pose'}))},revision);}
 else if(action==='retime')result=directorStage('retime_segment',{markerId:a.markerId,time:a.time},revision);
 else if(action==='hold')result=directorStage('set_hold',{markerId:a.markerId,duration:a.holdFrames/project.fps},revision);
 else if(action==='breakdown')result=directorStage('insert_breakdown',{time:a.breakTime,fraction:a.fraction,boneIds:chosen()},revision);
 else if(action==='spline')result=directorStage('smooth_motion',{boneIds:chosen(),start:0,end:project.duration,method:'auto',channels:['p','q','s']},revision);
 else if(action==='smooth')result=directorStage('smooth_motion',{boneIds:chosen(),start:0,end:project.duration},revision);
 else if(action==='capture'){const m=project.director?.markers.find(m=>m.id===a.markerId);if(!m)throw Error('Tạo Blocking và chọn mốc trước.');if(Math.abs(time-m.time)>1e-7)throw Error('Đến đúng mốc trước khi ghi pose.');if(directorPending)throw Error('Áp dụng hoặc hủy preview trước khi ghi pose.');directorStage('set_pose',{time,transforms:C.capture(rig),interpolation:'step'},revision,true);directorApply(directorPending.id,revision);directorPanel.message('Đã ghi pose vào mốc.');return;}
 else if(action==='marker'||action==='idea'){const tool=action==='idea'?'set_idea':'set_marker';result=directorStage(tool,action==='idea'?{idea:a.idea}:{markerId:a.markerId,label:a.label,kind:a.kind,locked:a.locked},revision);directorApply(result.patchId,revision);directorPanel.message('Đã lưu.');return;}
 directorPanel.message(result?.summary||'');
}
function setupDirector(){directorPanel=new DirectorPanel(directorAction);studioBridge=new StudioBridge({context:directorContext,call:directorCall},text=>{directorPanel.connection(text);directorPanel.el('directorConnect').textContent=studioBridge?.sessionId?'Ngắt MCP':'Kết nối MCP';});const btn=document.createElement('button');btn.id='directorBtn';btn.type='button';btn.textContent='Director · Blocking / Nhịp';btn.onclick=guard(()=>{directorPanel.show();syncDirector();});$('smoothingBtn').before(btn);window.__studio.director={context:directorContext,call:directorCall,panel:()=>directorPanel,bridge:()=>studioBridge,cancel:directorCancel};}
