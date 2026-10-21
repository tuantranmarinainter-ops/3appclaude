// Same-origin mailbox transport. A tab explicitly opts in; no automatic writes on load.
export const LOCAL_READ_TOOLS=Object.freeze(['read_keyframes','analyze_motion','get_scene_context','get_animation_context']);
export function validateLocalRead(tool,args){
 if(!LOCAL_READ_TOOLS.includes(tool))throw Error('UNSUPPORTED_CAPABILITY');
 if(!args||typeof args!=='object'||Array.isArray(args))throw Error('VALIDATION_FAILED');
 const allowed=tool==='read_keyframes'?['boneIds','start','end']:tool==='analyze_motion'?['boneIds','start','end','samples']:[];
 if(Object.keys(args).some(k=>!allowed.includes(k)))throw Error('VALIDATION_FAILED');
 if(args.boneIds!==undefined&&(!Array.isArray(args.boneIds)||!args.boneIds.length||args.boneIds.length>256||args.boneIds.some(x=>typeof x!=='string'||!x.length||x.length>200)))throw Error('VALIDATION_FAILED');
 for(const key of ['start','end'])if(args[key]!==undefined&&(!Number.isFinite(args[key])||args[key]<0))throw Error('VALIDATION_FAILED');
 if(args.start!==undefined&&args.end!==undefined&&args.end<args.start)throw Error('VALIDATION_FAILED');
 if(args.samples!==undefined&&(!Number.isInteger(args.samples)||args.samples<4||args.samples>600))throw Error('VALIDATION_FAILED');
}
export const LOCAL_EDIT_TOOLS=Object.freeze(['retime_segment','set_hold','smooth_motion','edit_keyframes','edit_curves','create_blocking','set_pose','insert_breakdown','set_marker','set_idea','preview_patch','apply_patch','cancel_patch','undo_animation']);
export function validateLocalEdit(tool,args){
 if(!LOCAL_EDIT_TOOLS.includes(tool))throw Error('UNSUPPORTED_CAPABILITY');
 if(!args||typeof args!=='object'||Array.isArray(args))throw Error('VALIDATION_FAILED');
 const fields={retime_segment:['markerId','time'],set_hold:['markerId','duration'],smooth_motion:['boneIds','start','end','method','strength','window','channels'],edit_keyframes:['refs','action','targetTime'],edit_curves:['boneId','path','axis','times','type','side','slope'],create_blocking:['markers','idea'],set_pose:['time','transforms','interpolation'],insert_breakdown:['time','boneIds','label','fraction','offsets'],set_marker:['markerId','label','locked','kind'],set_idea:['idea'],preview_patch:['patchId','original'],apply_patch:['patchId'],cancel_patch:['patchId'],undo_animation:[]}[tool];
 const fail=()=>{throw Error('VALIDATION_FAILED');},obj=x=>x&&typeof x==='object'&&!Array.isArray(x),text=(x,n)=>typeof x==='string'&&x.length<=n,number=(x,min,max)=>Number.isFinite(x)&&x>=min&&x<=max,vec=(x,n)=>Array.isArray(x)&&x.length===n&&x.every(Number.isFinite),bone=x=>text(x,200)&&x.length>0;
 if(Object.keys(args).some(k=>!fields.includes(k)))fail();
 if(tool==='create_blocking'){
  if(!Array.isArray(args.markers)||args.markers.length<2||args.markers.length>128)fail();
  for(const m of args.markers){if(!obj(m)||Object.keys(m).some(k=>!['id','time','label','kind','locked'].includes(k))||!number(m.time,0,300)||!text(m.label,160))fail();if(m.id!==undefined&&(!text(m.id,80)||!/^[\w-]{1,80}$/.test(m.id)))fail();if(m.kind!==undefined&&!['pose','contact','breakdown','hold'].includes(m.kind))fail();if(m.locked!==undefined&&typeof m.locked!=='boolean')fail();}
 }
 if(tool==='set_idea'&&!text(args.idea,4000)||args.idea!==undefined&&!text(args.idea,4000))fail();
 if(['set_pose','insert_breakdown'].includes(tool)&&!number(args.time,0,300))fail();
 if(tool==='set_pose'){
  if(!obj(args.transforms)||!Object.keys(args.transforms).length||Object.keys(args.transforms).length>256)fail();
  for(const[id,t]of Object.entries(args.transforms))if(!bone(id)||!obj(t)||Object.keys(t).some(k=>!['p','q','s'].includes(k))||!vec(t.p,3)||!vec(t.q,4)||!vec(t.s,3)||Math.hypot(...t.q)<1e-8)fail();
  if(args.interpolation!==undefined&&!['step','linear','auto','cubic','smooth'].includes(args.interpolation))fail();
 }
 if(tool==='insert_breakdown'){
  if(!Array.isArray(args.boneIds)||!args.boneIds.length||args.boneIds.length>256||args.boneIds.some(x=>!bone(x)))fail();
  if(args.fraction!==undefined&&!number(args.fraction,0,1))fail();
  if(args.offsets!==undefined&&(!obj(args.offsets)||Object.entries(args.offsets).some(([id,v])=>!args.boneIds.includes(id)||!vec(v,3))))fail();
 }
 if(args.label!==undefined&&!text(args.label,160))fail();
 if(tool==='set_marker'&&(!text(args.markerId,80)||!args.markerId.length||Object.keys(args).length<2))fail();
 if(args.locked!==undefined&&typeof args.locked!=='boolean'||args.kind!==undefined&&!['pose','contact','breakdown','hold'].includes(args.kind))fail();
 if(['preview_patch','apply_patch','cancel_patch'].includes(tool)&&(!text(args.patchId,100)||!args.patchId.length))fail();

 if(['retime_segment','set_hold'].includes(tool)&&(!text(args.markerId,80)||!args.markerId.length))fail();
 if(tool==='retime_segment'&&!number(args.time,0,300))fail();
 if(tool==='set_hold'&&!number(args.duration,Number.MIN_VALUE,30))fail();
 if(tool==='smooth_motion'){
  if(!Array.isArray(args.boneIds)||!args.boneIds.length||args.boneIds.length>256||args.boneIds.some(x=>!bone(x))||!number(args.start,0,300)||!number(args.end,args.start,300)||args.end===args.start)fail();
  if(args.method!==undefined&&!['filter','auto','cubic'].includes(args.method)||args.strength!==undefined&&!number(args.strength,0,1)||args.window!==undefined&&(!Number.isInteger(args.window)||!number(args.window,1,12)))fail();
  if(args.channels!==undefined&&(!Array.isArray(args.channels)||!args.channels.length||args.channels.length>3||new Set(args.channels).size!==args.channels.length||args.channels.some(x=>!['p','q','s'].includes(x))))fail();
 }
 if(tool==='edit_keyframes'){
  if(!Array.isArray(args.refs)||!args.refs.length||args.refs.length>1000||!['move','copy','delete'].includes(args.action))fail();
  for(const ref of args.refs)if(!obj(ref)||Object.keys(ref).some(k=>!['id','time','kind'].includes(k))||!bone(ref.id)||ref.kind!=='keys'||!number(ref.time,0,300))fail();
  if(args.action!=='delete'&&!number(args.targetTime,0,300)||args.targetTime!==undefined&&!number(args.targetTime,0,300))fail();
 }
 if(tool==='edit_curves'){
  if(!bone(args.boneId)||!['p','r','s'].includes(args.path)||![0,1,2].includes(args.axis)||!Array.isArray(args.times)||!args.times.length||args.times.length>1000||args.times.some(x=>!number(x,0,300)))fail();
  if(args.side!==undefined&&!['in','out','both'].includes(args.side)||args.type!==undefined&&!['linear','step','auto','smooth','spline','break','unify'].includes(args.type)||args.slope!==undefined&&!Number.isFinite(args.slope)||args.slope===undefined&&args.type===undefined)fail();
 }
 if(args.original!==undefined&&typeof args.original!=='boolean')fail();
}
export class StudioBridge{
 constructor(api,status){this.api=api;this.status=status;this.sessionId=null;this.controller=null;this.timer=null;this.cache=new Map();this.running=false;this.localCache=new Map();}
 // Local transport is opt-in through the authenticated host bridge; never calls Sites endpoints.
 localRead(command,identity){validateLocalRead(command.tool,command.args);return this.localCall(command,identity);}
 localCall(command,identity,options={}){
  const editing=LOCAL_EDIT_TOOLS.includes(command.tool);
  if(editing)validateLocalEdit(command.tool,command.args);else validateLocalRead(command.tool,command.args);
  if(typeof command.commandId!=='string'||typeof identity!=='string')throw Error('VALIDATION_FAILED');
  const fingerprint=JSON.stringify([identity,command.tool,command.args,command.expectedAnimationRevision,command.projectRevision]);
  const previous=this.localCache.get(command.commandId);
  if(previous){if(previous.fingerprint!==fingerprint)throw Error('REQUEST_ID_CONFLICT');return previous.promise;}
  if(!this.api.context()?.ready)throw Error('APP3_NOT_READY');
  for(const[id,item]of this.localCache)if(item.completed&&Date.now()-item.completed>600000)this.localCache.delete(id);
  if(this.localCache.size>=256)throw Error('RECEIVER_CACHE_FULL');
  const promise=Promise.resolve().then(async()=>{
   try{
    if(options.verify)await options.verify();
    const context=this.api.context();
    if(!context?.ready)throw Error('APP3_NOT_READY');
    if(editing){
     if((options.isActive?options.isActive():options.active)!==true)throw Error('APP3_INACTIVE');
     if(typeof command.expectedAnimationRevision!=='string'||command.expectedAnimationRevision!==context.revision)throw Error('REVISION_CONFLICT');
     if((options.isShot?options.isShot():options.shot)&&command.args.time!==undefined&&command.args.time>context.duration)throw Error('SHOT_RANGE_CONFLICT');
     // Native Director times are local seconds; transform channels stay in model-local units.
     // Shot placement owns displacement. Reject root transform edits rather than converting world space.
     const a=command.args,shot=options.isShot?options.isShot():options.shot;
     if(shot){
      if(command.tool==='set_hold')throw Error('SHOT_DURATION_CHANGE_UNSUPPORTED');
      if(command.tool==='retime_segment'){
       const last=context.markers?.at(-1);
       if(!last||Math.abs(last.time-context.duration)>1e-7||last.id===a.markerId&&Math.abs(a.time-context.duration)>1e-7)throw Error('SHOT_DURATION_CHANGE_UNSUPPORTED');
      }
      if(command.tool==='smooth_motion'&&(a.end>context.duration||a.start>context.duration)||command.tool==='edit_curves'&&a.times.some(t=>t>context.duration))throw Error('SHOT_RANGE_CONFLICT');
      if(command.tool==='edit_keyframes'){
       const shift=a.action==='delete'?0:a.targetTime-Math.min(...a.refs.map(r=>r.time));
       if(a.refs.some(r=>r.time>context.duration||r.time+shift<0||r.time+shift>context.duration))throw Error('SHOT_RANGE_CONFLICT');
      }
      if(command.tool==='edit_keyframes'&&a.refs.some(r=>r.id==='root')||command.tool==='edit_curves'&&a.boneId==='root'||command.tool==='smooth_motion'&&a.boneIds.includes('root'))throw Error('SHOT_ROOT_EDIT_UNSUPPORTED');
     }
     if(command.tool==='smooth_motion'&&['auto','cubic'].includes(a.method)&&context.markers?.some(m=>(m.locked||m.kind==='contact')&&m.time>=a.start&&m.time<=a.end))throw Error('PROTECTED_POSE_SMOOTH_UNSUPPORTED');
     const control=['preview_patch','apply_patch','cancel_patch','undo_animation'].includes(command.tool);
     if(!control&&context.preview)throw Error('PATCH_PENDING');
     if(['preview_patch','apply_patch','cancel_patch'].includes(command.tool)&&context.preview?.id!==command.args.patchId)throw Error('PATCH_CONFLICT');
     if(['preview_patch','apply_patch'].includes(command.tool)&&context.preview?.baseRevision!==command.expectedAnimationRevision)throw Error('REVISION_CONFLICT');
     if(command.tool==='undo_animation'&&context.undoStepsAvailable===0)throw Error('NOTHING_TO_UNDO');
     if((options.isShot?options.isShot():options.shot)&&((command.tool==='set_pose'&&Object.hasOwn(command.args.transforms,'root'))||(command.tool==='insert_breakdown'&&command.args.boneIds.includes('root'))))throw Error('SHOT_ROOT_EDIT_UNSUPPORTED');
    }
    const value=await this.api.call(command.tool,editing?{...command.args,expectedRevision:command.expectedAnimationRevision}:command.args);const after=this.api.context();return{ok:true,value,animationRevision:after.revision,context:after};}
   catch(error){return{ok:false,error:String(error.message||error)};}
  });
  const entry={fingerprint,promise,completed:0};this.localCache.set(command.commandId,entry);promise.finally(()=>{entry.completed=Date.now();});return promise;
 }
 resetLocal(){this.localCache.clear();}
 async request(path,body){const r=await fetch('/api/studio/'+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(this.controller?{'X-Studio-Controller':this.controller}:{})},...(body?{body:JSON.stringify(body)}:{})});const value=await r.json();if(!r.ok)throw Error(value.error||'MCP không kết nối được.');return value;}
 async connect(){if(this.sessionId)return this.disconnect();if(!globalThis.location||!/^https?:$/.test(location.protocol))throw Error('MCP trực tiếp cần mở bản Sites. File HTML vẫn dùng Director cục bộ.');this.controller=crypto.randomUUID();const r=await this.request('sessions',{controller:this.controller,context:this.api.context()});this.sessionId=r.sessionId;this.status('MCP đã bật · phiên '+this.sessionId+' · giữ tab này mở.');this.poll();return r;}
 async disconnect(){clearTimeout(this.timer);const session=this.sessionId;this.sessionId=null;if(session)try{await this.request('sessions/'+session+'/close',{});}catch{}this.cache.clear();this.status('MCP đã ngắt.');}
 async poll(){if(!this.sessionId||this.running)return;this.running=true;const session=this.sessionId;try{const r=await this.request('sessions/'+session+'/poll',{context:this.api.context()});for(const cmd of r.commands||[]){if(this.sessionId!==session)break;let result=this.cache.get(cmd.id);if(!result){try{result={ok:true,value:await this.api.call(cmd.tool,cmd.args)};}catch(e){result={ok:false,error:e.message};}this.cache.set(cmd.id,result);if(this.cache.size>100)this.cache.delete(this.cache.keys().next().value);}await this.request('sessions/'+session+'/result',{id:cmd.id,result,context:this.api.context()});}this.status('MCP đang kết nối · '+session+' · '+new Date().toLocaleTimeString());}catch(e){this.status('MCP: '+e.message+' · sẽ thử lại.');}finally{this.running=false;if(this.sessionId===session)this.timer=setTimeout(()=>this.poll(),1500);}}
}
