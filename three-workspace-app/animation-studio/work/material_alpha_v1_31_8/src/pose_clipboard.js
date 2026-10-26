// A clipboard is session-owned: it never stores live objects or editor-local bone IDs alone.
const clone=x=>structuredClone(x);
const name=x=>x.replace(/^mixamorig[:_]?/i,'').toLowerCase();
function paths(records){
 const byId=new Map(records.map(r=>[r.id,r])),result=new Map();
 function path(r,seen=new Set()){
  if(seen.has(r.id))throw Error('Cây xương có vòng lặp.');seen.add(r.id);
  const parent=r.parent&&byId.get(r.parent);if(r.parent&&!parent)throw Error('Thiếu xương cha.');
  return [...(parent?path(parent,seen):[]),name(r.name)];
 }
 for(const r of records){const key=JSON.stringify(path(r));if(result.has(key))throw Error('Tên và cây xương không phân biệt được.');result.set(key,r);}
 return result;
}
export function capturePose(rig,data){
 if(!Object.keys(data).length)throw Error('Chọn xương trước khi sao chép pose.');
 paths(rig.records);
 return {fingerprint:rig.fingerprint,data:clone(data),records:rig.records.map(({id,name,parent,rest})=>({id,name,parent,rest:clone(rest)}))};
}
export function mapPose(clipboard,rig,{keepHeight=false}={}){
 if(!clipboard?.records)throw Error('Chưa có pose trong bộ nhớ tạm.');
 const source=paths(clipboard.records),target=paths(rig.records),mapping=new Map();
 for(const[key,r]of source){const to=target.get(key);if(!to)throw Error('Pose không tương thích: thiếu xương '+r.name+'.');
  const dot=r.rest.q.reduce((s,v,i)=>s+v*to.rest.q[i],0);if(Math.abs(Math.abs(dot)-1)>1e-5)throw Error('Pose không tương thích: trục xương '+r.name+' khác nhau.');mapping.set(r.id,to);
 }
 const data={};for(const[id,p]of Object.entries(clipboard.data)){
  if([...p.p,...p.q,...(p.s||[1,1,1])].some(v=>!Number.isFinite(v)))throw Error('Pose chứa số không hợp lệ.');
  if(id==='root'){data.root=clone(p);if(!keepHeight)data.root.p=rig.root.position.toArray();continue;}
  const from=clipboard.records.find(r=>r.id===id),to=mapping.get(id);if(!from||!to)throw Error('Xương trong pose không tương thích.');
  const next=clone(p);next.p=from.parent?p.p.map((v,i)=>to.rest.p[i]+v-from.rest.p[i]):keepHeight?clone(p.p):to.o.position.toArray();next.s=(p.s||from.rest.s).map((v,i)=>v/from.rest.s[i]*to.rest.s[i]);data[to.id]=next;
 }
 return data;
}
