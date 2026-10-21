// In-memory counterpart of agent/shot_package.py. No filesystem or Three dependency.
export const safePath=value=>typeof value==='string'&&!!value.trim()&&!value.startsWith('/')&&!/^[A-Za-z]:/.test(value)&&!/[\\\0]/.test(value)&&!value.split('/').includes('..');
export async function sha256(bytes){return [...new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');}
export function readJSON(files,name){const bytes=files[name];if(!(bytes instanceof Uint8Array))throw Error('Missing file: '+name);return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
export async function validateShot(files){
 const issues=[],issue=(code,path,message)=>issues.push({code,path,message});
 const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
 const field=(o,k,type,p)=>{const path=p+'.'+k;if(!Object.hasOwn(o,k)){issue('MISSING_FIELD',path,'Required field is missing.');return;}
  const v=o[k],ok=type==='object'?object(v):type==='array'?Array.isArray(v):type==='int'?Number.isInteger(v):type==='number'?typeof v==='number'&&Number.isFinite(v):typeof v===type;
  if(!ok){issue('INVALID_TYPE',path,'Expected '+type+'.');return;}if(type==='string'&&!v.trim()){issue('INVALID_VALUE',path,'Expected a non-empty string.');return;}return v;};
 const version=(o,p)=>{const v=field(o,'version','string',p);if(v!==undefined&&!/^1\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(v))issue('UNSUPPORTED_VERSION',p+'.version','Expected version 1.x.y.');};
 const uuid=(o,k,p)=>{const v=field(o,k,'string',p);if(v!==undefined&&!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v)){issue('INVALID_UUID',p+'.'+k,'Expected lowercase hyphenated UUID.');return;}return v;};
 const digest=(o,k,p)=>{const v=field(o,k,'string',p);if(v!==undefined&&!/^[0-9a-f]{64}$/i.test(v)){issue('INVALID_SHA256',p+'.'+k,'Expected SHA-256 hex.');return;}return v?.toLowerCase();};
 const file=(o,k,p)=>{const v=field(o,k,'string',p);if(v===undefined)return;if(!safePath(v)){issue('UNSAFE_PATH',p+'.'+k,'Use a relative POSIX path without ..');return;}if(!(files[v] instanceof Uint8Array)){issue('FILE_NOT_FOUND',p+'.'+k,'Package file does not exist: '+v);return;}return v;};
 const hash=async(n,h,p)=>{if(n!==undefined&&h!==undefined&&await sha256(files[n])!==h)issue('SHA256_MISMATCH',p,'SHA-256 does not match file bytes.');};
 const json=(n,p)=>{if(n===undefined)return;try{const v=readJSON(files,n);if(!object(v)){issue('INVALID_TYPE',p,'Expected JSON object.');return;}return v;}catch(e){issue('INVALID_JSON',p,e.message);}};
 const vector=(o,k,p)=>{const v=field(o,k,'array',p);if(v!==undefined&&(v.length!==3||v.some(x=>typeof x!=='number'||!Number.isFinite(x))))issue('INVALID_VALUE',p+'.'+k,'Expected three finite numbers.');};
 const entries=(o,k,p,nonempty=false)=>{const v=field(o,k,'array',p);if(!v)return[];if(nonempty&&!v.length)issue('INVALID_VALUE',p+'.'+k,'Expected at least one entry.');return v.flatMap((x,i)=>{const path=p+'.'+k+'['+i+']';if(!object(x)){issue('INVALID_TYPE',path,'Expected object.');return[];}return[[x,path]];});};
 const placement=(o,p)=>{vector(o,'position',p);field(o,'yawDegrees','number',p);};
 const asset=async(o,p)=>{const glb=file(o,'glb',p),h=digest(o,'glbSha256',p),id=uuid(o,'actionUuid',p);await hash(glb,h,p+'.glbSha256');const m=json(file(o,'manifest',p),p+'.manifest');if(!m)return;version(m,p+'.manifest');await hash(glb,digest(m,'glbSha256',p+'.manifest'),p+'.manifest.glbSha256');const ids=new Set();for(const[a,q]of entries(m,'actions',p+'.manifest',true)){const id=uuid(a,'uuid',q);if(id!==undefined){if(ids.has(id))issue('DUPLICATE_ACTION_UUID',q+'.uuid','Duplicate Action UUID.');ids.add(id);}}if(id!==undefined&&!ids.has(id))issue('ACTION_NOT_IN_MANIFEST',p+'.actionUuid','Action UUID absent from manifest.');};
 for(const name of Object.keys(files))if(!safePath(name))issue('UNSAFE_PATH',name,'Unsafe ZIP entry.');
 const shot=json(file({file:'shot.json'},'file','shot.json'),'shot.json');if(!shot)return issues;
 const p='shot.json';version(shot,p);field(shot,'shotId','string',p);field(shot,'sceneId','string',p);const fps=field(shot,'fps','int',p);if(fps!==undefined&&fps!==30)issue('INVALID_FPS',p+'.fps','Shot FPS must be 30.');
 let range=field(shot,'frameRange','array',p);if(range&&(range.length!==2||range.some(x=>!Number.isInteger(x))||range[0]<0||range[1]<range[0])){issue('INVALID_FRAME_RANGE',p+'.frameRange','Expected integer 0 <= start <= end.');range=undefined;}
 const camera=field(shot,'camera','object',p);let previous;
 if(camera)for(const[k,q]of entries(camera,'keys',p+'.camera',true)){const f=field(k,'frame','int',q);if(f!==undefined){if(f<0||(range&&(f<range[0]||f>range[1])))issue('FRAME_OUT_OF_RANGE',q+'.frame','Frame outside shot.');if(previous!==undefined&&f<=previous)issue('KEYS_NOT_INCREASING',q+'.frame','Frames must increase.');previous=f;}vector(k,'position',q);vector(k,'lookAt',q);const fov=field(k,'fovYDegrees','number',q);if(fov!==undefined&&!(fov>0&&fov<180))issue('INVALID_VALUE',q+'.fovYDegrees','FOV must be between 0 and 180.');}
 const ids=new Set();let editable=false;
 for(const[c,q]of entries(shot,'characters',p)){const id=field(c,'characterId','string',q);if(id!==undefined){if(ids.has(id))issue('DUPLICATE_CHARACTER_ID',q+'.characterId','Duplicate character ID.');ids.add(id);}editable=field(c,'editable','boolean',q)===true||editable;await asset(c,q);
  const clip=field(c,'clip','object',q);if(clip){const a=field(clip,'sourceStartSeconds','number',q+'.clip'),b=field(clip,'sourceEndSeconds','number',q+'.clip'),speed=field(clip,'speed','number',q+'.clip');field(clip,'loop','boolean',q+'.clip');field(clip,'reverse','boolean',q+'.clip');if(a<0||b<0||b<a||speed<=0)issue('INVALID_CLIP',q+'.clip','Invalid source range or speed.');}
  const place=field(c,'placement','object',q);if(place)placement(place,q+'.placement');const root=field(c,'rootPolicy','string',q);if(root!==undefined&&!['skeletal','in-place'].includes(root))issue('INVALID_ROOT_POLICY',q+'.rootPolicy','Expected skeletal or in-place.');
 }
 if(!editable)issue('NO_EDITABLE_CHARACTER',p+'.characters','At least one editable character is required.');
 for(const[r,q]of entries(shot,'references',p)){await hash(file(r,'file',q),digest(r,'sha256',q),q+'.sha256');const t=field(r,'transform','object',q);if(t)for(const k of ['position','rotationDegrees','scale'])vector(t,k,q+'.transform');}
 return issues;
}
export function clipTime(clip,seconds){const length=clip.sourceEndSeconds-clip.sourceStartSeconds;const progress=length===0?0:clip.loop?(seconds*clip.speed)%length:Math.min(length,seconds*clip.speed);return clip.reverse?clip.sourceEndSeconds-progress:clip.sourceStartSeconds+progress;}
