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
export class StudioBridge{
 constructor(api,status){this.api=api;this.status=status;this.sessionId=null;this.controller=null;this.timer=null;this.cache=new Map();this.running=false;this.localCache=new Map();}
 // Local transport is opt-in through the authenticated host bridge; never calls Sites endpoints.
 localRead(command,identity){
  validateLocalRead(command.tool,command.args);
  if(typeof command.commandId!=='string'||typeof identity!=='string')throw Error('VALIDATION_FAILED');
  const fingerprint=JSON.stringify([identity,command.tool,command.args]);
  const previous=this.localCache.get(command.commandId);
  if(previous){if(previous.fingerprint!==fingerprint)throw Error('REQUEST_ID_CONFLICT');return previous.promise;}
  if(!this.api.context()?.ready)throw Error('APP3_NOT_READY');
  for(const[id,item]of this.localCache)if(item.completed&&Date.now()-item.completed>600000)this.localCache.delete(id);
  if(this.localCache.size>=256)throw Error('RECEIVER_CACHE_FULL');
  const promise=Promise.resolve().then(async()=>{
   try{const value=await this.api.call(command.tool,command.args);const context=this.api.context();return{ok:true,value,animationRevision:context.revision,context};}
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
