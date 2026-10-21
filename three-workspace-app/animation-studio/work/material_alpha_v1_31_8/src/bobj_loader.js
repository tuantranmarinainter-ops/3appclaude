import * as T from 'three';

const finite=(v,line)=>{const n=Number(v);if(v===undefined||!Number.isFinite(n)||Math.abs(n)>3.402823466e38)throw Error('BOBJ: số không hợp lệ tại dòng '+line);return n;};
const nameKey=n=>n.replaceAll(' ','_');
export function parse(bytes){
 const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes),root=new T.Group();root.name='BOBJ';
 const vertices=[],uvs=[],normals=[],objects=[],arms=[],actions=[],warnings=[];
 let arm=null,object=null,action=null,channel=null,lastVertex=null;
 const lines=text.split(/\r?\n/);
 for(let i=0;i<lines.length;i++){
  const line=lines[i].trim();if(!line||line.startsWith('#'))continue;
  const p=line.split(/\s+/),tag=p.shift(),n=i+1,nums=a=>a.map(v=>finite(v,n));
  if(tag==='arm_name'){arm={name:p.join(' '),bones:[]};arms.push(arm);}
  else if(tag==='arm_action'){if(arm)arm.action=p.join(' ');}
  else if(tag==='arm_bone'){
   if(!arm||![20,21].includes(p.length))throw Error('BOBJ: arm_bone không hợp lệ tại dòng '+n);
   const hasParent=p.length===21,offset=hasParent?2:1,values=nums(p.slice(offset));
   if(values.slice(15,18).some(v=>Math.abs(v)>1e-6)||Math.abs(values[18]-1)>1e-6)throw Error('BOBJ: rest matrix không affine tại dòng '+n);
   arm.bones.push({name:p[0],parent:hasParent?p[1]:null,tail:values.slice(0,3),matrix:new T.Matrix4().set(...values.slice(3))});
  }else if(tag==='o'){object={name:p.join(' '),arm:null,faces:[]};objects.push(object);lastVertex=null;}
  else if(tag==='o_arm'){if(!object)throw Error('BOBJ: o_arm thiếu object tại dòng '+n);object.arm=p.join(' ');}
  else if(tag==='v'){if(p.length!==3)throw Error('BOBJ: vertex không hợp lệ tại dòng '+n);lastVertex={p:nums(p),weights:[]};vertices.push(lastVertex);}
  else if(tag==='vw'){if(!lastVertex||p.length!==2)throw Error('BOBJ: weight không hợp lệ tại dòng '+n);const w=finite(p[1],n);if(w<0)throw Error('BOBJ: weight âm tại dòng '+n);lastVertex.weights.push([p[0],w]);}
  else if(tag==='vt'){if(p.length<2)throw Error('BOBJ: UV không hợp lệ tại dòng '+n);uvs.push(nums(p.slice(0,2)));}
  else if(tag==='vn'){if(p.length!==3)throw Error('BOBJ: normal không hợp lệ tại dòng '+n);normals.push(nums(p));}
  else if(tag==='f'){
   if(!object||p.length<3)throw Error('BOBJ: face không hợp lệ tại dòng '+n);
   const index=(token,count,required)=>{if(!token){if(required)throw Error('BOBJ: thiếu vertex index tại dòng '+n);return null;}const x=finite(token,n);if(!Number.isInteger(x)||x===0)throw Error('BOBJ: index không hợp lệ tại dòng '+n);const j=x<0?count+x:x-1;if(j<0||j>=count)throw Error('BOBJ: index ngoài dữ liệu tại dòng '+n);return j;};
   const face=p.map(x=>{const v=x.split('/');return [index(v[0],vertices.length,true),index(v[1],uvs.length,false),index(v[2],normals.length,false)];});
   for(let j=1;j<face.length-1;j++)object.faces.push([face[0],face[j],face[j+1]]);
  }else if(tag==='an'){action={name:p.join(' '),channels:[],duration:0};actions.push(action);channel=null;}
  else if(tag==='ao'){if(!action)throw Error('BOBJ: ao thiếu action tại dòng '+n);action.bone=p.join(' ');channel=null;}
  else if(tag==='ag'){
   if(!action?.bone||p.length!==2||!['location','rotation','scale'].includes(p[0])||!['0','1','2'].includes(p[1]))throw Error('BOBJ: channel không hợp lệ tại dòng '+n);
   channel={bone:action.bone,path:p[0],axis:Number(p[1]),keys:[]};action.channels.push(channel);
  }else if(tag==='kf'){
   if(!channel||p.length!==7)throw Error('BOBJ: keyframe không hợp lệ tại dòng '+n);
   const t=finite(p[0],n)/20;if(t<0)throw Error('BOBJ: thời gian âm tại dòng '+n);
   if(!['LINEAR','CONSTANT','BEZIER'].includes(p[2]))throw Error('BOBJ: chưa hỗ trợ nội suy '+p[2]+' tại dòng '+n);
   channel.keys.push({t,v:finite(p[1],n),interp:p[2],left:[finite(p[3],n)/20,finite(p[4],n)],right:[finite(p[5],n)/20,finite(p[6],n)]});action.duration=Math.max(action.duration,t);
  }else if(warnings.length<20&&!warnings.includes('Bỏ qua record '+tag))warnings.push('Bỏ qua record '+tag);
 }
 if(!arms.some(a=>a.bones.length))throw Error('BOBJ không có dữ liệu xương để đối chiếu.');
 const armMap=new Map();
 for(const a of arms){
  if(armMap.has(nameKey(a.name)))throw Error('BOBJ: armature trùng tên '+a.name);
  const group=new T.Group();group.name=a.name;root.add(group);a.group=group;a.map=new Map();
  for(const b of a.bones){if(a.map.has(b.name))throw Error('BOBJ: xương trùng tên '+b.name);b.o=new T.Bone();b.o.name=b.name;b.o.userData.bobjTail=b.tail;a.map.set(b.name,b);}
  const visit=(b,seen=new Set())=>{if(b.done)return;if(seen.size>512)throw Error('BOBJ: hierarchy quá sâu.');if(Math.abs(b.matrix.determinant())<1e-12)throw Error('BOBJ: rest matrix không khả nghịch cho '+b.name);if(seen.has(b.name))throw Error('BOBJ: chu trình cha/con '+b.name);seen.add(b.name);let local=b.matrix.clone();if(b.parent){const parent=a.map.get(b.parent);if(!parent)throw Error('BOBJ: thiếu parent '+b.parent);visit(parent,seen);if(Math.abs(parent.matrix.determinant())<1e-12)throw Error('BOBJ: ma trận parent không khả nghịch.');local=parent.matrix.clone().invert().multiply(local);parent.o.add(b.o);}else group.add(b.o);local.decompose(b.o.position,b.o.quaternion,b.o.scale);b.o.userData.bobjRest=local.toArray();b.done=true;seen.delete(b.name);};
  for(const b of a.bones)visit(b);armMap.set(nameKey(a.name),a);
 }
 root.updateMatrixWorld(true);
 let reducedWeights=false,unweighted=false;
 for(const obj of objects){
  if(!obj.faces.length)continue;
  const a=obj.arm?armMap.get(nameKey(obj.arm)):null;if(obj.arm&&!a)throw Error('BOBJ: mesh tham chiếu armature không tồn tại '+obj.arm);
  const positions=[],uv=[],normal=[],skinIndex=[],skinWeight=[],sourceVertices=[],hasNormals=obj.faces.every(f=>f.every(c=>c[2]!==null)),bones=a?.bones.map(b=>b.o),boneIds=a?new Map(a.bones.map((b,i)=>[b.name,i])):null;
  for(const face of obj.faces)for(const [vi,ti,ni]of face){
   const v=vertices[vi];positions.push(...v.p);uv.push(...(ti===null?[0,0]:uvs[ti]));if(hasNormals)normal.push(...normals[ni]);sourceVertices.push(vi);
   if(a){const valid=v.weights.filter(([name,w])=>w>0&&boneIds.has(name)).sort((x,y)=>y[1]-x[1]);if(valid.length>4)reducedWeights=true;if(v.weights.some(([name])=>!boneIds.has(name)))throw Error('BOBJ: weight tham chiếu xương không tồn tại trong '+obj.name);for(const [name]of valid)a.map.get(name).o.userData.bobjWeighted=true;const top=valid.slice(0,4),sum=top.reduce((n,x)=>n+x[1],0);if(!sum)unweighted=true;for(let j=0;j<4;j++){skinIndex.push(top[j]?boneIds.get(top[j][0]):0);skinWeight.push(sum?(top[j]?.[1]||0)/sum:j===0?1:0);}}
  }
  const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute(positions,3));geometry.setAttribute('uv',new T.Float32BufferAttribute(uv,2));if(hasNormals)geometry.setAttribute('normal',new T.Float32BufferAttribute(normal,3));else geometry.computeVertexNormals();
  const material=new T.MeshStandardMaterial({color:0xb8c3cf,roughness:.8,metalness:0,side:T.DoubleSide});let mesh;
  if(a){if(bones.length>65535)throw Error('BOBJ: quá nhiều xương cho skin.');geometry.setAttribute('skinIndex',new T.Uint16BufferAttribute(skinIndex,4));geometry.setAttribute('skinWeight',new T.Float32BufferAttribute(skinWeight,4));mesh=new T.SkinnedMesh(geometry,material);root.add(mesh);mesh.bind(new T.Skeleton(bones));}else{mesh=new T.Mesh(geometry,material);root.add(mesh);}
  mesh.name=obj.name;mesh.userData.bobjSourceVertices=sourceVertices;mesh.userData.bobjWeights=sourceVertices.map(i=>vertices[i].weights);mesh.frustumCulled=false;
 }
 let duplicateTicks=0;for(const action of actions)for(const c of action.channels){c.keys.sort((a,b)=>a.t-b.t);const dedup=[];for(const k of c.keys){if(dedup.at(-1)?.t===k.t){duplicateTicks++;dedup[dedup.length-1]=k;}else dedup.push(k);}c.keys=dedup;}
 if(duplicateTicks)warnings.push('Có '+duplicateTicks+' key trùng tick; giữ key cuối tại mỗi tick.');
 if(actions.some(a=>!a.channels.some(c=>c.keys.length)))warnings.push('Một số action không có kênh/key đọc được; addon không xuất rotation_quaternion.');
 if(reducedWeights)warnings.push('Preview GPU dùng 4 weights lớn nhất/vertex; weights gốc vẫn lưu trong mesh metadata.');
 if(unweighted)warnings.push('Một số đỉnh không có weights: preview gắn vào xương đầu; cần đối chiếu file gốc.');
 warnings.push('BOBJ không ghi texture và Euler order; mesh dùng màu trung tính, Euler mặc định ZYX theo BBS; có thể chọn thứ tự khác để đối chiếu Blender.');
 root.animations=actions.map(a=>new T.AnimationClip(a.name,a.duration,[]));root.bobjActions=actions;root.bobjWarnings=warnings;return root;
}

function scalar(keys,t,fallback){
 if(!keys.length)return fallback;if(t<=keys[0].t)return keys[0].v;if(t>=keys.at(-1).t)return keys.at(-1).v;
 let lo=0,hi=keys.length-1;while(lo+1<hi){const m=(lo+hi)>>1;if(keys[m].t<=t)lo=m;else hi=m;}const a=keys[lo],b=keys[hi];if(a.interp==='CONSTANT')return a.v;
 const u=(t-a.t)/(b.t-a.t);if(a.interp!=='BEZIER')return T.MathUtils.lerp(a.v,b.v,u);
 const cubic=(x,p0,p1,p2,p3)=>{const y=1-x;return y*y*y*p0+3*y*y*x*p1+3*y*x*x*p2+x*x*x*p3;};let l=0,h=1;
 for(let i=0;i<24;i++){const m=(l+h)/2;if(cubic(m,a.t,T.MathUtils.clamp(a.right[0],a.t,b.t),T.MathUtils.clamp(b.left[0],a.t,b.t),b.t)<t)l=m;else h=m;}
 return cubic((l+h)/2,a.v,a.right[1],b.left[1],b.v);
}
export function sample(rig,index,time,order='ZYX'){
 const action=rig.root.bobjActions?.[index];if(!action)return;
 const allowed=rig.activeRoot?new Set(rig.records.filter(r=>{let x=r;while(x){if(x.id===rig.activeRoot)return true;x=rig.records.find(y=>y.id===x.parent);}return false;}).map(r=>r.id)):null;
 const groups=new Map();for(const c of action.channels){let g=groups.get(c.bone);if(!g){g={location:[0,0,0],rotation:[0,0,0],scale:[1,1,1]};groups.set(c.bone,g);}g[c.path][c.axis]=scalar(c.keys,time,c.path==='scale'?1:0);}
 for(const r of rig.records){const g=groups.get(r.name);if(allowed&&!allowed.has(r.id))continue;if(!g||!r.o.userData.bobjRest)continue;const pose=new T.Matrix4().compose(new T.Vector3().fromArray(g.location),new T.Quaternion().setFromEuler(new T.Euler(...g.rotation,order)),new T.Vector3().fromArray(g.scale));new T.Matrix4().fromArray(r.o.userData.bobjRest).multiply(pose).decompose(r.o.position,r.o.quaternion,r.o.scale);}
 rig.root.updateMatrixWorld(true);
}
