// Sites supplies authenticated identity. R2 is a bounded, durable command mailbox;
// only an explicitly connected tab executes commands, with revision checks in Studio.
const PROTOCOL='2026-07-28',TTL=120000,MAX_BODY=24*1024*1024;
const object=(properties,required=[])=>({type:'object',properties,required,additionalProperties:false});
const str={type:'string'},number={type:'number'},boolean={type:'boolean'},strings={type:'array',items:str,minItems:1,maxItems:2048};
const base={sessionId:str,expectedRevision:str,idempotencyKey:str};
const operations={
 create_blocking:{description:'Sample the current evaluated clip at major poses into a new Step blocking. Include first time 0 and last time duration. Preview only; apply_patch commits. Original remains in Undo.',properties:{idea:{...str,maxLength:4000},markers:{type:'array',minItems:2,maxItems:128,items:object({id:str,label:str,time:number,kind:{enum:['pose','contact','breakdown','hold']},locked:boolean},['time','label'])}},required:['markers']},
 set_pose:{description:'Set local p[3], q[4] quaternion, s[3] transforms at a time in seconds, in model units. Preview only. Read bone IDs and units first; locked poses are protected.',properties:{time:number,transforms:{type:'object',additionalProperties:object({p:{type:'array',items:number,minItems:3,maxItems:3},q:{type:'array',items:number,minItems:4,maxItems:4},s:{type:'array',items:number,minItems:3,maxItems:3}},['p','q','s'])},interpolation:{enum:['step','linear','auto','cubic','smooth']}},required:['time','transforms']},
 insert_breakdown:{description:'Preview an intermediate pose between neighboring Director markers. fraction is 0..1 pose progress, independent of time. Offsets are local model units per bone.',properties:{time:number,boneIds:strings,label:str,fraction:{type:'number',minimum:0,maximum:1},offsets:{type:'object',additionalProperties:{type:'array',items:number,minItems:3,maxItems:3}}},required:['time','boneIds']},
 retime_segment:{description:'Move a Director marker (seconds), retiming all keys on adjacent segments and scaling explicit curve slopes. Locked marker times stay fixed. Preview only.',properties:{markerId:str,time:number},required:['markerId','time']},
 set_hold:{description:'Insert a hold after a marker, shifting later keys and extending the clip. Duration is seconds. Later locked markers reject the operation. Preview only.',properties:{markerId:str,duration:number},required:['markerId','duration']},
 set_marker:{description:'Rename, change kind or lock a Director marker. Preview only. contact markers are protected from smoothing.',properties:{markerId:str,label:str,locked:boolean,kind:{enum:['pose','contact','breakdown','hold']}},required:['markerId']},
 set_idea:{description:'Store the user movement brief as Director notes. This does not synthesize a motion. Preview only.',properties:{idea:{...str,maxLength:4000}},required:['idea']},
 smooth_motion:{description:'Preview bounded local smoothing, keeping Step boundaries, endpoints and locked/contact poses. Does not solve foot contact or collisions.',properties:{method:{enum:['filter','auto','cubic']},boneIds:strings,start:number,end:number,strength:{type:'number',minimum:0,maximum:1},window:{type:'integer',minimum:1,maximum:12},channels:{type:'array',items:{enum:['p','q','s']},minItems:1}},required:['boneIds','start','end']},
 edit_keyframes:{description:'Preview moving/copying/deleting selected transform keys. Locked poses and collisions reject the change. targetTime is the new earliest selected time, seconds.',properties:{refs:{type:'array',minItems:1,maxItems:1000,items:object({id:str,time:number,kind:{const:'keys'}},['id','time','kind'])},action:{enum:['move','copy','delete']},targetTime:number},required:['refs','action']},
 edit_curves:{description:'Preview channel tangents. p=position, r=Euler XYZ degrees, s=scale; axis 0/1/2. Rotation requires explicit Euler curves; preserve Spin winding. slope units are value/second.',properties:{boneId:str,path:{enum:['p','r','s']},axis:{type:'integer',minimum:0,maximum:2},times:{type:'array',items:number,minItems:1,maxItems:1000},type:{enum:['linear','step','auto','smooth','spline','break','unify']},side:{enum:['in','out','both']},slope:number},required:['boneId','path','axis','times']},
 read_keyframes:{description:'Read up to 2000 local transform keys/curve metadata. Narrow time range and bone IDs for dense imports. Returns an asynchronous command ticket.',readOnly:true,properties:{boneIds:strings,start:number,end:number}},
 analyze_motion:{description:'Numerical local track analysis: velocity changes and loop endpoint gaps. Not a visual quality, foot sliding or collision assessment.',readOnly:true,properties:{boneIds:strings,start:number,end:number,samples:{type:'integer',minimum:4,maximum:600}}},
 preview_patch:{description:'Show original or processed candidate in the open Studio tab. Does not commit. Only one pending candidate per tab.',properties:{patchId:str,original:boolean},required:['patchId']},
 apply_patch:{description:'Commit exactly the reviewed patch against its base revision as one Undo step. Call get_command_result to confirm success.',properties:{patchId:str},required:['patchId']},
 cancel_patch:{description:'Cancel the pending candidate and restore the original pose.'},
 undo_animation:{description:'Undo one Studio history step, requiring the current revision.'},
 export_animation:{description:'Export applied animation as BOBJ (20 ticks/s) or skeleton-animation FBX. Returns a private download URL after the command completes.',properties:{format:{enum:['bobj','fbx']}},required:['format']},
 get_scene_context:{description:'Read the multi-actor scene, shared timeline, markers, contacts and reusable library from the connected Studio tab.',readOnly:true},
 preview_scene_patch:{description:'Preview one deterministic Scene Studio operation.',properties:{operation:{enum:['add_actor','set_actor','add_clip','move_clip','delete_clip','add_marker','set_marker','retime_marker','add_contact','add_library_item','apply_template']},parameters:{type:'object',additionalProperties:true}},required:['operation','parameters']},
 apply_scene_patch:{description:'Apply a reviewed scene patch as one scene history step.',properties:{patchId:str},required:['patchId']},
 cancel_scene_patch:{description:'Cancel the pending scene patch.'},
 undo_scene:{description:'Undo or redo one Scene Studio history step.',properties:{redo:boolean}},
 export_scene:{description:'Return a private ZIP download with synchronized BOBJ, textures, report and layout manifest.',properties:{includeFbx:boolean}}
};
export const tools=[
 {name:'list_studio_sessions',description:'List your connected Animation Studio tabs. The user must open Director and click Connect MCP first.',inputSchema:object({}),annotations:{readOnlyHint:true,openWorldHint:false}},
 {name:'get_animation_context',description:'Read the latest connected tab context, revision, rig bone IDs, units, selected node, pose markers and pending patch. Heartbeats refresh while the tab is open.',inputSchema:object({sessionId:str},['sessionId']),annotations:{readOnlyHint:true,openWorldHint:false}},
 {name:'get_command_result',description:'Fetch the result of a queued command. pending means wait briefly and retry. Never claim a command succeeded until status is done and result.ok is true.',inputSchema:object({sessionId:str,commandId:str},['sessionId','commandId']),annotations:{readOnlyHint:true,openWorldHint:false}},
 ...Object.entries(operations).map(([name,op])=>({name,description:op.description+' Queued: use get_command_result with returned commandId.',inputSchema:object({...base,...op.properties},['sessionId',...(!op.readOnly&&!['preview_patch','cancel_patch'].includes(name)?['expectedRevision']:[]),...(op.required||[])]),annotations:{readOnlyHint:!!op.readOnly,destructiveHint:false,openWorldHint:false}}))
];
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const error=(message,status=400)=>{const e=Error(message);e.status=status;throw e;};
const key=value=>typeof value==='string'&&/^[\w-]{1,100}$/.test(value)?value:error('Invalid ID');
const hash=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),x=>x.toString(16).padStart(2,'0')).join('');
const get=async(env,path)=>{const o=await env.BUCKET.get(path);return o?o.json():null;};
const put=(env,path,value)=>env.BUCKET.put(path,JSON.stringify(value),{httpMetadata:{contentType:'application/json'}});
async function body(request,limit=MAX_BODY){if(Number(request.headers.get('content-length'))>limit)error('Payload too large',413);const text=await request.text();if(text.length>limit)error('Payload too large',413);let value;try{value=JSON.parse(text);}catch{error('Invalid JSON');}if(!value||typeof value!=='object'||Array.isArray(value))error('Expected object');return value;}
async function root(request,env){const email=request.headers.get('oai-authenticated-user-email'),userId=request.headers.get('oai-authenticated-user-id');const id=email?'email:'+email.trim().toLowerCase():userId?'id:'+userId:null;if(!id)error('Authenticated Site user required',401);if(!env.BUCKET)error('Storage binding BUCKET missing',503);return 'director/'+await hash(id)+'/';}
async function session(env,prefix,id){const p=prefix+'sessions/'+key(id),s=await get(env,p+'/meta');if(!s)error('Session not found',404);return {p,s};}
async function controller(request,s){const token=request.headers.get('X-Studio-Controller');if(!token||await hash(token)!==s.controller)error('Wrong Studio tab',403);}
function context(value){if(!value||value.ready!==true||typeof value.revision!=='string'||!Array.isArray(value.bones)||value.bones.length>2048||JSON.stringify(value).length>350000)error('Invalid context');return value;}
async function result(env,p,id,origin){const value=await get(env,p+'/results/'+key(id));if(value){if(value.ok&&value.value?.data&&value.value?.filename){const x=value.value;return{status:'done',result:{ok:true,value:{filename:x.filename,format:x.format,url:origin+'/api/studio/download/'+p.split('/').at(-1)+'/'+id}}};}return{status:'done',result:value};}const cmd=await get(env,p+'/requests/'+id);if(!cmd)error('Command not found',404);return Date.now()-cmd.created>60000?{status:'expired',error:'Tab did not execute command in time; reconnect and read context.'}:{status:'pending'};}
async function callTool(name,args,request,env){const prefix=await root(request,env),origin=new URL(request.url).origin;
 if(name==='list_studio_sessions'){const list=await env.BUCKET.list({prefix:prefix+'active/',limit:1000});const metas=list.objects;const found=await Promise.all(metas.map(o=>get(env,o.key)));return {sessions:found.filter(s=>s&&Date.now()-s.updated<TTL).map(s=>({sessionId:s.id,name:s.context.name,revision:s.context.revision,updated:s.updated}))};}
 const {p,s}=await session(env,prefix,args.sessionId);
 if(name==='get_command_result')return result(env,p,args.commandId,origin);
 if(Date.now()-s.updated>TTL)error('Studio tab offline; reopen and reconnect',409);
 if(name==='get_animation_context')return{...s.context,sessionId:s.id,updated:s.updated};
 const spec=tools.find(t=>t.name===name);if(!operations[name])error('Unknown tool');for(const field of spec.inputSchema.required)if(args[field]===undefined)error('Missing '+field);
 const parameters={...args};delete parameters.sessionId;delete parameters.idempotencyKey;
 const id=args.idempotencyKey?'cmd-'+(await hash(key(args.idempotencyKey))).slice(0,32):'cmd-'+crypto.randomUUID();const cmdPath=p+'/commands/'+id,previous=await get(env,p+'/requests/'+id);
 if(previous){if(previous.tool!==name||JSON.stringify(previous.args)!==JSON.stringify(parameters))error('Idempotency key already used for another command',409);return{commandId:id,status:'queued',reused:true};}
 if(typeof args.expectedRevision==='string'&&args.expectedRevision!==(['preview_scene_patch','apply_scene_patch','cancel_scene_patch','undo_scene','export_scene'].includes(name)?s.context.scene?.revision:s.context.revision))error('Stale revision. Read the matching animation or scene context again.',409);
 if(JSON.stringify(parameters).length>250000)error('Arguments too large',413);
 const command={id,tool:name,args:parameters,created:Date.now()};await put(env,p+'/requests/'+id,command);await put(env,cmdPath,command);return{commandId:id,status:'queued',instruction:'Read get_command_result. No animation change is confirmed until result.ok=true.'};
}
async function mcp(request,env){const rpc=await body(request,300000),id=rpc.id??null;let value;
 try{switch(rpc.method){
 case 'server/discover':value={supportedVersions:[PROTOCOL],capabilities:{tools:{}}};break;
 case 'initialize':value={protocolVersion:rpc.params?.protocolVersion||PROTOCOL,capabilities:{tools:{}},serverInfo:{name:'animation-studio-scene-director',version:'1.31.5'},instructions:'List Studio sessions and read animation or scene context. Commands are queued: poll get_command_result. Animation and scene edits create preview patches; apply the reviewed patch with its matching revision. Keep the connected tab open.'};break;
 case 'notifications/initialized':return new Response(null,{status:202});
 case 'ping':value={};break;
 case 'tools/list':value={tools};break;
 case 'tools/call':{try{const output=await callTool(rpc.params?.name,rpc.params?.arguments||{},request,env);value={content:[{type:'text',text:JSON.stringify(output)}],isError:false};}catch(e){value={content:[{type:'text',text:e.message}],isError:true};}break;}
 default:return json({jsonrpc:'2.0',id,error:{code:-32601,message:'Method not found'}});
 }return json({jsonrpc:'2.0',id,result:value});}catch(e){return json({jsonrpc:'2.0',id,error:{code:-32602,message:e.message}});}
}
export function createWorker(html){return{async fetch(request,env){try{const u=new URL(request.url),path=u.pathname;
 if(path==='/mcp'&&request.method==='POST')return mcp(request,env);
 if(path==='/mcp')return new Response(null,{status:405,headers:{Allow:'POST'}});
 if(path==='/'&&request.method==='GET')return new Response(html,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'}});
 if(path==='/health')return json({version:'1.31.5',mcp:true,storage:!!env.BUCKET});
 if(!path.startsWith('/api/studio/'))return json({error:'Not found'},404);
 // Same-origin browser writes; MCP authentication is handled by Sites separately.
 if(request.method==='POST'&&request.headers.get('Origin')&&request.headers.get('Origin')!==u.origin)error('Wrong origin',403);
 const prefix=await root(request,env);
 if(path==='/api/studio/sessions'&&request.method==='POST'){const b=await body(request,400000);if(typeof b.controller!=='string'||b.controller.length<32)error('Invalid controller');const id=crypto.randomUUID(),s={id,controller:await hash(b.controller),created:Date.now(),updated:Date.now(),context:context(b.context)};await put(env,prefix+'sessions/'+id+'/meta',s);await put(env,prefix+'active/'+id,s);return json({sessionId:id});}
 const download=path.match(/^\/api\/studio\/download\/([\w-]+)\/([\w-]+)$/);if(download&&request.method==='GET'){const {p}=await session(env,prefix,download[1]),r=await get(env,p+'/results/'+key(download[2]));if(!r?.ok||!r.value?.data)error('Export not found',404);const x=r.value;if(!['bobj','fbx','zip'].includes(x.format))error('Invalid export');const data=x.encoding==='base64'?Uint8Array.from(atob(x.data),c=>c.charCodeAt(0)):x.data;return new Response(data,{headers:{'Content-Type':x.format==='zip'?'application/zip':'application/octet-stream','Content-Disposition':'attachment; filename="'+String(x.filename).replace(/[^\w.\-]/g,'_')+'"','Cache-Control':'no-store'}});}
 const m=path.match(/^\/api\/studio\/sessions\/([\w-]+)\/(poll|result|close)$/);if(!m||request.method!=='POST')return json({error:'Not found'},404);
 const {p,s}=await session(env,prefix,m[1]);await controller(request,s);const b=await body(request);
 if(m[2]==='close'){s.updated=0;await put(env,p+'/meta',s);await env.BUCKET.delete(prefix+'active/'+s.id);return json({closed:true});}
 if(m[2]==='result'){const id=key(b.id),cmd=await get(env,p+'/requests/'+id);if(!cmd)error('Command not found',404);if(typeof b.result?.ok!=='boolean')error('Invalid command result');if(!await get(env,p+'/results/'+id))await put(env,p+'/results/'+id,b.result);await env.BUCKET.delete(p+'/commands/'+id);if(b.context){s.context=context(b.context);s.updated=Date.now();await put(env,p+'/meta',s);await put(env,prefix+'active/'+s.id,s);}return json({saved:true});}
 s.context=context(b.context);s.updated=Date.now();await put(env,p+'/meta',s);await put(env,prefix+'active/'+s.id,s);const list=await env.BUCKET.list({prefix:p+'/commands/',limit:1000});const commands=[];
 for(const item of list.objects){const cmd=await get(env,item.key);if(cmd&&Date.now()-cmd.created<60000&&!await get(env,p+'/results/'+cmd.id))commands.push(cmd);else await env.BUCKET.delete(item.key);}
 commands.sort((a,b)=>a.created-b.created||a.id.localeCompare(b.id));return json({commands:commands.slice(0,5)});
 }catch(e){return json({error:e.message},e.status||400);}}};}
