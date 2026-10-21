const EPS=1e-7;const fail=m=>{throw Error(m);};
export function validate(d,p){
 if(d===undefined)return;
 if(!d||d.version!==1||typeof d.idea!=='string'||d.idea.length>4000||!Array.isArray(d.markers)||d.markers.length>256)fail('Dữ liệu Director không hợp lệ.');
 const ids=new Set();let prev=-1;
 for(const m of d.markers){if(!m||typeof m.id!=='string'||!/^[\w-]{1,80}$/.test(m.id)||ids.has(m.id)||typeof m.label!=='string'||m.label.length>160||!['pose','breakdown','contact','hold'].includes(m.kind)||typeof m.locked!=='boolean'||!Number.isFinite(m.time)||m.time<0||m.time>p.duration+EPS||m.time<=prev+EPS)fail('Mốc Director không hợp lệ.');ids.add(m.id);prev=m.time;}
}
