import * as T from 'three';
export const defaults=()=>({enabled:false,axes:[true,true,true],min:[-180,-90,-180],max:[180,90,180]});
export function validate(map,rig){
 if(map===undefined)return {};if(!map||typeof map!=='object'||Array.isArray(map))throw Error('Giới hạn khớp không hợp lệ.');
 const ids=new Set(rig.records.map(r=>r.id)),result={};
 for(const [id,x]of Object.entries(map)){
  if(!ids.has(id)||!x||typeof x.enabled!=='boolean'||!Array.isArray(x.axes)||x.axes.length!==3||!x.axes.every(v=>typeof v==='boolean')||!['min','max'].every(k=>Array.isArray(x[k])&&x[k].length===3&&x[k].every(v=>Number.isFinite(v)&&v>=-180&&v<=180))||x.min.some((v,i)=>v>x.max[i])||x.min[1]<-90||x.max[1]>90)throw Error('Giới hạn khớp sai: '+id);
  if(x.frame!==undefined&&(!Array.isArray(x.frame)||x.frame.length!==4||!x.frame.every(Number.isFinite)||Math.abs(Math.hypot(...x.frame)-1)>1e-5))throw Error('Trục giới hạn không hợp lệ: '+id);
  result[id]={enabled:x.enabled,axes:[...x.axes],min:[...x.min],max:[...x.max],...(x.frame?{frame:[...x.frame]}:{})};
 }return result;
}
export function angles(rec,config){const q=new T.Quaternion().fromArray(rec.rest.q).normalize().invert().multiply(rec.o.quaternion).normalize();if(config?.frame){const f=new T.Quaternion().fromArray(config.frame);q.premultiply(f.clone().invert()).multiply(f);}const e=new T.Euler().setFromQuaternion(q,'XYZ');return [e.x,e.y,e.z].map(T.MathUtils.radToDeg);}
export function constrain(rig,map,ids){
 const changed=[];for(const rec of rig.records){const x=map?.[rec.id];if(!x?.enabled||!ids.has(rec.id))continue;
  const values=angles(rec,x),next=values.map((v,i)=>x.axes[i]?T.MathUtils.clamp(v,x.min[i],x.max[i]):v);
  if(next.some((v,i)=>Math.abs(v-values[i])>1e-7)){const delta=new T.Quaternion().setFromEuler(new T.Euler(...next.map(T.MathUtils.degToRad),'XYZ'));if(x.frame){const f=new T.Quaternion().fromArray(x.frame);delta.premultiply(f).multiply(f.clone().invert());}rec.o.quaternion.fromArray(rec.rest.q).normalize().multiply(delta).normalize();rec.o.updateWorldMatrix(false,true);changed.push(rec.id);}
 }return changed;
}
export function syncControl(rig,c){
 const o=rig.controls['ik_'+c.id].object,pole=rig.controls['pole_'+c.id].object,isLeg=/Leg/i.test(c.id),amount=isLeg?1:c.options.wristPivot;
 const end=c.c.o.getWorldPosition(new T.Vector3()),endQ=c.c.o.getWorldQuaternion(new T.Quaternion()),roll=isLeg?new T.Quaternion().setFromEuler(new T.Euler(T.MathUtils.degToRad(c.options.footRoll),0,T.MathUtils.degToRad(c.options.footRock))):new T.Quaternion();
 const q=endQ.clone().multiply(roll.invert()),offset=c.pivotOffset.clone().multiplyScalar(amount).multiply(o.getWorldScale(new T.Vector3())),p=end.clone().sub(offset.clone().applyQuaternion(q)).add(offset.applyQuaternion(endQ));
 o.position.copy(o.parent.worldToLocal(p));o.quaternion.copy(o.parent.getWorldQuaternion(new T.Quaternion()).invert().multiply(q)).normalize();o.updateWorldMatrix(false,true);
 const a=c.a.o.getWorldPosition(new T.Vector3()),b=c.b.o.getWorldPosition(new T.Vector3()),d=end.clone().sub(a).normalize(),bend=b.clone().sub(a).addScaledVector(d,-b.clone().sub(a).dot(d));
 if(bend.lengthSq()>1e-10){bend.normalize();c.bendMemory=bend.clone();const distance=Math.max(a.distanceTo(b),b.distanceTo(end),.001);pole.position.copy(pole.parent.worldToLocal(b.addScaledVector(bend,distance)));pole.updateWorldMatrix(false,true);}
}
export function affectsChain(rig,c,ids){
 const direct=['root','ik_'+c.id,'pole_'+c.id,c.a.id,c.b.id,c.c.id];let rec=c.a;const visited=new Set();while(rec&&!visited.has(rec.id)){visited.add(rec.id);direct.push(rec.id);rec=rig.records.find(r=>r.id===rec.parent);}return direct.some(id=>ids.has(id));
}
export function editPose(rig,map,ids){
 const affected=new Set(ids);for(const c of rig.chains)if(c.mode==='ik'&&affectsChain(rig,c,affected))for(const r of [c.a,c.b,c.c])affected.add(r.id);
 const changed=constrain(rig,map,affected);
 for(const c of rig.chains)if(c.mode==='ik'&&affectsChain(rig,c,new Set(changed)))syncControl(rig,c);
 return changed;
}

export function chainLimited(rig,c,map){return Object.keys(map||{}).some(id=>map[id].enabled&&affectsChain(rig,c,new Set([id])));}
export function pinConflict(rig,project,time,ids){
 if(!project.lab)return null;const selected=new Set(ids);
 for(const pin of project.lab.pins){if(time<pin.start-1e-7||time>pin.end+1e-7)continue;
  const c=rig.chains.find(c=>'ik_'+c.id===pin.id);if(!c||!affectsChain(rig,c,selected)||!chainLimited(rig,c,project.jointLimits))continue;
  const o=rig.controls[pin.id].object,p=new T.Vector3().fromArray(pin.p);if(project.lab.floorContact&&/leg/i.test(c.id))p.y=Math.max(p.y,project.lab.groundY);
  if(pin.position&&o.getWorldPosition(new T.Vector3()).distanceTo(p)>1e-6||pin.rotation&&o.getWorldQuaternion(new T.Quaternion()).angleTo(new T.Quaternion().fromArray(pin.q).normalize())>1e-6)return c.id;
 }return null;
}

// Image values are authoring ranges, not medical measurements. Axes are calibrated in Rest, never from the edited pose.
const nameOf=r=>r.name.replace(/^mixamorig[:_]?/i,'').toLowerCase();
export function presetRows(rig,records=rig.records){
 const find=n=>records.find(r=>nameOf(r)===n),left=find('leftarm'),right=find('rightarm'),hips=find('hips'),neck=find('neck');
 if(!left||!right||!hips||!neck)return records.map(rec=>({rec,status:'Chưa map: cần rig Mixamo và Rest T-pose',directions:[]}));
 const pos=r=>new T.Vector3().fromArray(r.worldP),up=pos(neck).sub(pos(hips)).normalize(),side=pos(left).sub(pos(right)).normalize(),forward=side.clone().cross(up).normalize();
 if(up.lengthSq()<.9||forward.lengthSq()<.9)return records.map(rec=>({rec,status:'Không xác định được trục rig từ Rest',directions:[]}));
 side.crossVectors(up,forward).normalize();
 const armEnd=records.find(r=>nameOf(r)==='leftforearm');if(!armEnd||Math.abs(pos(armEnd).sub(pos(left)).normalize().dot(up))>.3)return records.map(rec=>({rec,status:'Rest không phải T-pose; cần hiệu chỉnh trước',directions:[]}));
 const torso=records.filter(r=>/^spine\d*$/.test(nameOf(r))),count=Math.max(1,torso.length);
 return records.map(rec=>{
 const n=nameOf(rec),isLeft=n.startsWith('left'),arm=/^(left|right)(arm|forearm|hand)$/.test(n),leg=/^(left|right)(upleg|leg|foot)$/.test(n);let ranges=null,dirs=['Gập / duỗi','Xoay','Nghiêng'],note='',axisX=side.clone(),axisY=up.clone();
 if(n==='neck')ranges=[[-45,45],[-70,70],[-45,45]];
 else if(/^spine\d*$/.test(n)){ranges=[[-90/count,90/count],[-30/count,30/count],[-30/count,30/count]];note='Tổng thân chia đều '+count+' đoạn; không cộng nguyên góc cho từng đốt.';}
 else if(/^(left|right)arm$/.test(n)){ranges=[isLeft?[-80,180]:[-180,80],[-80,70],[-120,0]];note='Dang 90° ở T-pose: khoảng tương đối Rest −120..0° tương ứng khép 30° đến dang 90°.';}
 else if(/^(left|right)forearm$/.test(n)){ranges=[isLeft?[0,145]:[-145,0],[-80,80],null];note='Ảnh ghi 30° tại hình gập, giữ Rest duỗi 0° trong miền; không ép gập tối thiểu 30°.';}
 else if(/^(left|right)hand$/.test(n)){ranges=[null,null,[-20,30]];note='Ảnh thiếu số gập/duỗi cổ tay; chưa giới hạn hướng đó.';}
 else if(/^(left|right)upleg$/.test(n))ranges=[[-120,30],[-40,50],isLeft?[-40,30]:[-30,40]];
 else if(/^(left|right)leg$/.test(n)){ranges=[[-135,0],null,null];note='Gối: gập 135°, duỗi 0°.';}
 else if(/^(left|right)foot$/.test(n)){ranges=[[-20,50],null,[-20,30]];note='Cổ chân: dorsiflex 20°, plantar 50°, eversion 20°, inversion 30°.';}
 if(!ranges)return {rec,status:'Không có góc riêng trong ảnh',directions:[]};
 if(arm){const child=records.find(r=>r.parent===rec.id&&(/hand|forearm|middle1/i.test(r.name)));axisY=child?pos(child).sub(pos(rec)).normalize():side.clone().multiplyScalar(isLeft?1:-1);axisX=up.clone().negate();axisX.addScaledVector(axisY,-axisX.dot(axisY)).normalize();}
 else if(leg){axisY=up.clone().negate();axisX=side.clone();}
 const axisZ=axisX.clone().cross(axisY).normalize();axisY=axisZ.clone().cross(axisX).normalize();
 if(axisZ.lengthSq()<.9)return {rec,status:'Không xác định được trục Rest',directions:[]};
 const worldFrame=new T.Quaternion().setFromRotationMatrix(new T.Matrix4().makeBasis(axisX,axisY,axisZ)),frame=new T.Quaternion().fromArray(rec.worldQ).invert().multiply(worldFrame).normalize().toArray();
 const x=defaults();x.enabled=true;x.axes=ranges.map(Boolean);x.frame=frame;
 for(let i=0;i<3;i++)if(ranges[i]){x.min[i]=ranges[i][0];x.max[i]=ranges[i][1];}
 return {rec,config:x,directions:dirs,note,status:'Đã map Rest'};
 });
}
export function imagePreset(rig,records=rig.records){const rows=presetRows(rig,records),map={};for(const row of rows)if(row.config)map[row.rec.id]=row.config;if(!Object.keys(map).length)throw Error('Chưa có khớp map được. Preset này cần Mixamo Rest T-pose.');return validate(map,rig);}
