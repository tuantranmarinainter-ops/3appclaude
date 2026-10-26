// Transform active key tracks only; clip timing and pose values stay unchanged.
export function transformKeyTimes(project,refs,start,end,ripple=false){
 const epsilon=1e-7,kinds=['keys','ikModes','ikOptions'],same=(a,b)=>Math.abs(a-b)<epsilon;
 if(!refs.length)throw Error('Chọn ít nhất một key trên timeline.');
 const selection=[...new Map(refs.map(r=>{const ref={...r,kind:r.kind||'keys'};return[ref.kind+'|'+ref.id+'|'+ref.time,ref];})).values()];
 for(const r of selection)if(!kinds.includes(r.kind)||!project[r.kind]?.[r.id]?.some(k=>same(k.time,r.time)))throw Error('Key đã thay đổi; chọn lại trên timeline.');
 const first=Math.min(...selection.map(r=>r.time)),last=Math.max(...selection.map(r=>r.time));
 if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||end<start||end>project.duration+epsilon||last>first&&end-start<epsilon||same(first,last)&&!same(start,end))throw Error('Vùng key đích không hợp lệ hoặc ngoài clip.');
 const remap=t=>same(first,last)?start:start+(t-first)*(end-start)/(last-first),shift=end-last,next=structuredClone(project);
 for(const kind of kinds)for(const[id,keys]of Object.entries(next[kind]||{})){
  for(const key of keys){if(selection.some(r=>r.kind===kind&&r.id===id&&same(r.time,key.time)))key.time=remap(key.time);else if(ripple&&key.time>last+epsilon)key.time+=shift;}
  keys.sort((a,b)=>a.time-b.time);
  for(let i=0;i<keys.length;i++)if(!Number.isFinite(keys[i].time)||keys[i].time<0||keys[i].time>project.duration+epsilon||i&&same(keys[i-1].time,keys[i].time))throw Error('Frame đích đã có key hoặc ngoài clip; hãy chọn vị trí khác.');
 }
 return{project:next,selection:selection.map(r=>({...r,time:remap(r.time)}))};
}
