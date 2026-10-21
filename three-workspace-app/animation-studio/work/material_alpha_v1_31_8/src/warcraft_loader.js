import * as T from 'three';
import {Model,GenericObject,AnimatedObject,createSkeletalNodes,BlpImage,DdsImage} from '@vendor/mdx-runtime';
import * as Tex from './texture_assets.js';
import {parseHD} from './warcraft_reforged.js';

const BASIS=new T.Matrix4().makeRotationX(-Math.PI/2),INVERSE=BASIS.clone().invert();
const key=s=>String(s).replaceAll('\\','/').replace(/^\.\//,'').toLowerCase();
const finite=a=>Array.from(a).every(Number.isFinite);
export function decodeBLP(bytes){
 if(bytes.byteLength<160)throw Error('BLP: header thiếu.');const image=new BlpImage();image.load(bytes);
 if(image.width<1||image.height<1||image.width*image.height>16777216)throw Error('BLP: kích thước không hợp lệ hoặc vượt 16 triệu pixel.');
 const offset=image.mipmapOffsets[0],length=image.mipmapSizes[0];if(!offset||!length||offset+length>bytes.byteLength)throw Error('BLP: mipmap bị thiếu hoặc hỏng.');
 return image.getMipmap(0);
}
export async function readTexture(file){
 if(!/\.(blp|dds)$/i.test(file.name))return Tex.readImage(file);
 if(file.size>32*1024*1024)throw Error('Texture vượt 32 MB.');const bytes=await file.arrayBuffer(),pixels=/\.dds$/i.test(file.name)?decodeDDS(bytes):decodeBLP(bytes),canvas=document.createElement('canvas');canvas.width=pixels.width;canvas.height=pixels.height;canvas.getContext('2d').putImageData(pixels,0,0);
 return{name:file.webkitRelativePath||file.name,data:canvas.toDataURL('image/png')};
}
export function decodeDDS(bytes){
 const data=bytes instanceof ArrayBuffer?new Uint8Array(bytes):new Uint8Array(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 if(data.byteLength<128)throw Error('DDS: header thiếu.');const view=new DataView(data.buffer,data.byteOffset,data.byteLength),height=view.getUint32(12,true),width=view.getUint32(16,true);
 if(!width||!height||width*height>16777216)throw Error('DDS: kích thước không hợp lệ hoặc vượt 16 triệu pixel.');
 if((width&(width-1))||(height&(height-1)))throw Error('DDS: bản này cần chiều ảnh là lũy thừa của 2.');
 if(view.getUint32(84,true)===0x30315844&&data.byteLength<148)throw Error('DDS: header DX10 bị thiếu.');
 const image=new DdsImage();image.load(new Uint8Array(data));
 const header=view.getUint32(8,true),levels=header&0x20000?view.getUint32(28,true):1;
 if(levels<1||levels>Math.floor(Math.log2(Math.max(width,height)))+1)throw Error('DDS: số mipmap không hợp lệ.');
 const offset=view.getUint32(84,true)===0x30315844?148:128;
 if(image.mipmapDatas[0]?.byteLength<Math.ceil(width/4)*Math.ceil(height/4)*(image.format===0x31545844?8:16)||data.byteLength<offset)throw Error('DDS: dữ liệu ảnh bị thiếu.');
 const mip=image.getMipmap(0);return new ImageData(new Uint8ClampedArray(mip.data),mip.width,mip.height);
}
function createRuntime(model,source){
 const entries=new Map(),nodes=createSkeletalNodes(source.length).nodes;
 const identity={worldMatrix:new Float32Array(new T.Matrix4().elements),worldRotation:new Float32Array([0,0,0,1]),inverseWorldRotation:new Float32Array([0,0,0,1]),worldScale:new Float32Array([1,1,1]),inverseWorldScale:new Float32Array([1,1,1]),worldLocation:new Float32Array(3),inverseWorldLocation:new Float32Array(3)};
 const instance={...identity,scene:null};
 source.forEach((object,i)=>{
  if(entries.has(object.objectId)||object.objectId<0)throw Error('Warcraft: ObjectId trùng hoặc không hợp lệ.');
  if(object.flags&1)throw Error('Warcraft: chưa hỗ trợ DontInheritTranslation ở '+object.name+'.');
  const generic=new GenericObject(model,object,i),node=nodes[i];node.pivot.set(generic.pivot);node.dontInheritRotation=generic.dontInheritRotation;node.dontInheritScaling=generic.dontInheritScaling;
  entries.set(object.objectId,{object,generic,node,index:i});
 });
 const sorted=[],visiting=new Set(),done=new Set();
 function visit(entry){if(done.has(entry))return;if(visiting.has(entry))throw Error('Warcraft: hierarchy có chu trình.');if(visiting.size>512)throw Error('Warcraft: hierarchy quá sâu.');visiting.add(entry);const parent=entry.object.parentId;
  if(parent>=0){const p=entries.get(parent);if(!p)throw Error('Warcraft: thiếu parent '+parent);visit(p);entry.node.parent=p.node;entry.parent=p;}else entry.node.parent=identity;
  visiting.delete(entry);done.add(entry);sorted.push(entry);
 }
 entries.forEach(visit);
 return{entries,sorted,sample(sequence,seconds){const frame=model.sequences[sequence].interval[0]+seconds*1000,counter=seconds*1000;
  for(const e of sorted){const n=e.node,g=e.generic;g.getTranslation(n.localLocation,sequence,frame,counter);g.getRotation(n.localRotation,sequence,frame,counter);g.getScale(n.localScale,sequence,frame,counter);n.recalculateTransformation(instance);
   if(!finite(n.localMatrix))throw Error('Warcraft: transform không hữu hạn ở '+g.name);
  }
 }};
}
export async function parse(bytes,name,resources=[]){
 let model;try{
  const data=bytes instanceof ArrayBuffer?new Uint8Array(bytes):bytes;let version=800;
  if(!/\.mdl$/i.test(name)){const view=new DataView(data.buffer,data.byteOffset,data.byteLength);for(let p=4;p+8<=data.byteLength;){const size=view.getUint32(p+4,true);if(p+8+size>data.byteLength)throw Error('MDX: chunk bị thiếu.');if(String.fromCharCode(...data.subarray(p,p+4))==='VERS'){version=view.getUint32(p+8,true);break;}p+=8+size;}}
  if(version===1800)model=parseHD(data);else{model=new Model();model.load(/\.mdl$/i.test(name)?new TextDecoder().decode(data):data);}
 }catch(e){throw Error('Không đọc được Warcraft MDX/MDL: '+e.message);}
 if(![800,1800].includes(model.version))throw Error('Reforged MDX '+model.version+' chưa hỗ trợ; bản này nhận Classic 800 và MDX 1800.');
 const source=model.genericObjects||[...model.bones,...model.helpers,...model.attachments,...model.lights,...model.particleEmitters,...model.particleEmitters2,...model.ribbonEmitters,...model.eventObjects,...model.collisionShapes];
 if(!source.length||source.length>2048)throw Error('Warcraft: số node phải từ 1 đến 2048.');if(model.sequences.length>512)throw Error('Warcraft: quá nhiều animation.');
 if(model.globalSequences.some(x=>!Number.isFinite(x)||x<=0))throw Error('Warcraft: GlobalSequence không hợp lệ.');
 const warnings=[],warn=s=>{if(!warnings.includes(s))warnings.push(s);};
 if(model.version===1800)warn('MDX 1800: nhập mesh, skin và chuyển động xương; chưa tái tạo đầy đủ PBR, camera, ánh sáng hoặc hiệu ứng trong game.');
 if(model.lights.length)warn('Giữ node Light và animation xương; không dựng ánh sáng Warcraft.');
 const effects=model.particleEmitters.length+model.particleEmitters2.length+model.ribbonEmitters.length;if(effects)warn('Model có '+effects+' bộ phát hiệu ứng; bản này lấy chuyển động xương, chưa dựng hạt/vệt phép.');
 if(source.some(o=>o.flags&0xf8))warn('Billboard/CameraAnchored giữ hướng cố định khi chuyển; không bám camera.');
 if(model.materials.some(m=>m.layers.length>1))warn('Material nhiều lớp: xem trước lớp đầu; chưa ghép đầy đủ team glow/lớp phủ.');
 if(model.materials.some(m=>m.layers.some(l=>l.textureAnimationId>=0))||model.geosetAnimations.length)warn('Animation texture/UV hoặc ẩn hiện geoset chưa đưa vào clip chỉnh sửa hoặc xuất.');
 const alphaRuntime=(model.materials||[]).map(m=>m.layers.map(layer=>{const track=layer.alphaAnimation||layer.animations?.find(a=>a.name==='KMTA');return track?.frames?.length?new AnimatedObject(model,{name:'MaterialAlpha',animations:[track]}):null;}));
 const runtime=createRuntime(model,source),root=new T.Group(),anchor=new T.Bone(),names=new Set(['WC3_Root']);root.name='WarcraftModel';anchor.name='WC3_Root';root.add(anchor);
 const unique=(name,id)=>{let s=String(name||'Node_'+id).replace(/[\x00-\x1f]/g,'')||'Node_'+id;while(names.has(s))s+='_'+id;names.add(s);return s;};
 for(const e of runtime.sorted){
  const bone=new T.Bone();bone.name=unique(e.object.name,e.object.objectId);bone.userData.warcraftId=e.object.objectId;e.bone=bone;
  // BPOS supplies a global bind frame. Keep its origin/orientation, with unit
  // axes; W(t)=D(t)*R and inverse(R) cancel in skinning, preserving MDX deformation.
  const raw=model.bindPoses?.[e.object.objectId];let rest=new T.Matrix4().makeTranslation(...e.node.pivot);
  if(raw){if(raw.length!==12||!finite(raw))throw Error('Warcraft: BPOS không hợp lệ.');rest.fromArray([raw[0],raw[1],raw[2],0,raw[3],raw[4],raw[5],0,raw[6],raw[7],raw[8],0,raw[9],raw[10],raw[11],1]);
   if(Math.abs(rest.determinant())<1e-10)throw Error('Warcraft: BPOS không khả nghịch.');
   const p=new T.Vector3(),q=new T.Quaternion(),s=new T.Vector3();rest.decompose(p,q,s);rest.compose(p,q.normalize(),new T.Vector3(1,1,1));bone.userData.warcraftBindPose=Array.from(raw);
  }
  e.restWorld=rest;const local=(e.parent?.restWorld||new T.Matrix4()).clone().invert().multiply(rest).premultiply(BASIS).multiply(INVERSE);local.decompose(bone.position,bone.quaternion,bone.scale);
  (e.parent?.bone||anchor).add(bone);
 }
 root.updateMatrixWorld(true);const bones=[anchor,...runtime.sorted.map(e=>e.bone)],boneIndices=new Map(runtime.sorted.map((e,i)=>[e.object.objectId,i+1]));
 let vertices=0;const geoAlpha=[];
 for(let gi=0;gi<model.geosets.length;gi++){
  const geo=model.geosets[gi];vertices+=geo.vertices.length/3;if(vertices>1000000)throw Error('Warcraft: model vượt 1 triệu đỉnh.');
  if(!finite(geo.vertices)||geo.vertices.length%3||geo.faces.some(i=>i>=geo.vertices.length/3))throw Error('Warcraft: geometry hỏng.');
  const groups=[];let cursor=0;for(const size of geo.matrixGroups){const ids=Array.from(geo.matrixIndices.slice(cursor,cursor+size));if(size>4)throw Error('Warcraft: mesh có hơn 4 ảnh hưởng/xương trên một đỉnh; chưa hỗ trợ chuyển chính xác.');if(ids.some(id=>!boneIndices.has(id)))throw Error('Warcraft: mesh tham chiếu node bị thiếu.');groups.push(ids);cursor+=size;}
  const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute(geo.vertices,3));if(geo.normals.length===geo.vertices.length)geometry.setAttribute('normal',new T.Float32BufferAttribute(geo.normals,3));geometry.setIndex(new T.Uint16BufferAttribute(geo.faces,1));geometry.applyMatrix4(BASIS);if(!geometry.getAttribute('normal'))geometry.computeVertexNormals();
  const materialDef=model.materials[geo.materialId],layer=materialDef?.layers[0],uv=geo.uvSets[layer?.coordId||0]||geo.uvSets[0];if(uv)geometry.setAttribute('uv',new T.Float32BufferAttribute(uv,2));
  const skinIndices=[],weights=[],skin=geo.skin;
  if(skin?.length&&skin.length!==geo.vertices.length/3*8)throw Error('Warcraft: số skin weights không khớp mesh.');
  for(let v=0;v<geo.vertices.length/3;v++){
   if(skin?.length){const row=skin.subarray(v*8,v*8+8),total=row[4]+row[5]+row[6]+row[7];if(!total)throw Error('Warcraft: đỉnh HD không có trọng số xương.');
    for(let j=0;j<4;j++){const id=geo.matrixIndices[row[j]],w=row[j+4];if(w>255||w&&(!Number.isInteger(id)||!boneIndices.has(id)))throw Error('Warcraft: skin HD tham chiếu xương/weight không hợp lệ.');skinIndices.push(w?boneIndices.get(id):0);weights.push(w/total);}
   }else{const ids=groups[geo.vertexGroups[v]]||[];for(let j=0;j<4;j++){skinIndices.push(ids[j]===undefined?0:boneIndices.get(ids[j]));weights.push(ids.length?(j<ids.length?1/ids.length:0):(j===0?1:0));}}
  }
  geometry.setAttribute('skinIndex',new T.Uint16BufferAttribute(skinIndices,4));geometry.setAttribute('skinWeight',new T.Float32BufferAttribute(weights,4));
  const options={color:0xd5dbe1,side:layer?.flags&0x10?T.DoubleSide:T.FrontSide,opacity:layer?.alpha??1,transparent:(layer?.filterMode??0)>1||(layer?.alpha??1)<1,alphaTest:layer?.filterMode===1?.75:0,depthWrite:!(layer?.flags&0x80),depthTest:!(layer?.flags&0x40)};
  if([3,4].includes(layer?.filterMode))options.blending=T.AdditiveBlending;if([5,6].includes(layer?.filterMode))options.blending=T.MultiplyBlending;
  const alpha=layer?.alpha??1,alphaAnimator=alphaRuntime[geo.materialId]?.[0],materialOptions={...options,transparent:options.transparent||!!alphaAnimator};
  const material=layer?.flags&1?new T.MeshBasicMaterial(materialOptions):new T.MeshStandardMaterial({...materialOptions,roughness:.9,metalness:0});material.name='WarcraftMaterial_'+geo.materialId;
  material.userData.warcraftTextureSources={};material.userData.warcraftMaterial={materialId:geo.materialId,shaderType:layer?.shaderType||0,alpha,animatedAlpha:!!alphaAnimator,layers:(materialDef?.layers||[]).map(x=>({alpha:x.alpha??1,animatedAlpha:!!(x.alphaAnimation?.frames?.length||x.animations?.some(a=>a.name==='KMTA')),textureId:x.textureId}))};for(const[li,def]of (materialDef?.layers||[]).entries()){const texture=model.textures[def.textureId];if(!texture)continue;const role=Tex.roleForName(texture.path||''),explicit=role!=='diffuse',key=explicit?role:'diffuse';material.userData.warcraftTextureSources[key]=texture.path||('Replaceable texture '+texture.replaceableId);if(li===0)material.userData.studioSourceTexture=texture.path;const found=Tex.findResource(texture.path,resources);if(found){if(li===0&&!explicit){material.map=await Tex.decode(found,false,'diffuse');material.map.wrapS=texture.wrapMode&1?T.RepeatWrapping:T.ClampToEdgeWrapping;material.map.wrapT=texture.wrapMode&2?T.RepeatWrapping:T.ClampToEdgeWrapping;material.color.set(0xffffff);}else if(explicit){const prepared=await Tex.decodeRole(found,false,role,role==='normal'?'warcraft':'standard');if(role==='normal')material.normalMap=prepared;else if(role==='ao')material.aoMap=prepared;else if(role==='roughness')material.roughnessMap=prepared;else if(role==='metalness')material.metalnessMap=prepared;else if(role==='emissive'){material.emissiveMap=prepared;material.emissive.set(0xffffff);}else if(role==='team')material.userData.studioTeamColorMap=prepared;else if(role==='orm'){material.aoMap=prepared.ao;material.roughnessMap=prepared.roughness;material.metalnessMap=prepared.metalness;}}}else if(texture.replaceableId){if(texture.replaceableId===1)material.userData.warcraftTextureSources.team='Replaceable texture id 1';if((def.alpha??1)>0||def.alphaAnimation?.frames?.length)material.color.set(texture.replaceableId===1?0xcc3333:0xbbcccc);if((def.alpha??1)>0||def.alphaAnimation?.frames?.length)warn('Replaceable texture/team color dùng màu thay thế; có thể gán ảnh trong bảng Texture.');}else if(texture.path&&((def.alpha??1)>0||def.alphaAnimation?.frames?.length))warn('Thiếu texture '+key+': '+texture.path);}if(material.aoMap&&!geometry.getAttribute('uv2'))geometry.setAttribute('uv2',geometry.getAttribute('uv').clone());
  const mesh=new T.SkinnedMesh(geometry,material);mesh.name='Geoset_'+gi;mesh.frustumCulled=false;root.add(mesh);mesh.bind(new T.Skeleton(bones));geoAlpha.push({mesh,layer,alphaAnimator});
 }
 const clips=[];let sampleBudget=0;
 for(let sequence=0;sequence<model.sequences.length;sequence++){
  const def=model.sequences[sequence],[start,end]=def.interval,length=(end-start)/1000;if(length<0||length>300)throw Error('Warcraft: clip phải dài tối đa 300 giây: '+def.name);
  const times=new Set([0,length]);for(let f=1;f<Math.ceil(length*60);f++)times.add(f/60);
  // Keep original track boundaries as well as the 60 Hz sampling grid.
  for(const o of source)for(const a of o.animations.filter(a=>['KGTR','KGRT','KGSC'].includes(a.name))){
   if(a.globalSequenceId>=model.globalSequences.length)throw Error('Warcraft: GlobalSeqId không tồn tại.');
   if(a.globalSequenceId<0){for(const k of a.frames)if(k>=start&&k<=end){const t=(k-start)/1000;times.add(t);if(a.interpolationType===0&&t>0)times.add(Math.max(0,t-.00001));}}
   else{const period=model.globalSequences[a.globalSequenceId]/1000;if(length/period>20000)throw Error('Warcraft: GlobalSequence quá ngắn.');for(let base=0;base<=length;base+=period)for(const k of [0,...a.frames]){const t=base+k/1000;if(t<=length){times.add(t);if(t>0)times.add(Math.max(0,t-.00001));}}}
  }
  for(const{layer,alphaAnimator}of geoAlpha){if(!alphaAnimator)continue;const a=layer.alphaAnimation||layer.animations.find(x=>x.name==='KMTA');if(a.globalSequenceId<0){for(const k of a.frames)if(k>=start&&k<=end){const t=(k-start)/1000;times.add(t);if(a.interpolationType===0&&t>0)times.add(Math.max(0,t-.00001));}}else{const period=model.globalSequences[a.globalSequenceId]/1000;if(length/period>20000)throw Error('Warcraft: GlobalSequence alpha quá ngắn.');for(let base=0;base<=length;base+=period)for(const k of [0,...a.frames]){const t=base+k/1000;if(t<=length){times.add(t);if(t>0&&a.interpolationType===0)times.add(Math.max(0,t-.00001));}}}}
  const sampleTimes=[...times].sort((a,b)=>a-b);sampleBudget+=sampleTimes.length*source.length;if(sampleBudget>2000000)throw Error('Warcraft: quá nhiều mẫu animation; cần tách model/clip trước khi nhập.');
  const tracks=[],values=runtime.sorted.map(()=>({p:[],q:[],s:[]}));
  for(const seconds of sampleTimes){runtime.sample(sequence,seconds);runtime.sorted.forEach((e,i)=>{
   e.poseWorld=new T.Matrix4().fromArray(e.node.worldMatrix).multiply(e.restWorld);
   const local=(e.parent?.poseWorld||new T.Matrix4()).clone().invert().multiply(e.poseWorld).premultiply(BASIS).multiply(INVERSE);
   const p=new T.Vector3(),q=new T.Quaternion(),s=new T.Vector3();local.decompose(p,q,s);if(!finite([...p.toArray(),...q.toArray(),...s.toArray()]))throw Error('Warcraft: transform lỗi: '+e.object.name);
   values[i].p.push(...p.toArray());values[i].q.push(...q.normalize().toArray());values[i].s.push(...s.toArray());
  });}
  runtime.sorted.forEach((e,i)=>{for(const[field,property,type]of [['p','position',T.VectorKeyframeTrack],['q','quaternion',T.QuaternionKeyframeTrack],['s','scale',T.VectorKeyframeTrack]])tracks.push(new type(e.bone.uuid+'.'+property,sampleTimes,values[i][field]));});
  for(const{mesh,layer,alphaAnimator}of geoAlpha){if(!alphaAnimator)continue;const alphaValues=[];for(const seconds of sampleTimes){const frame=start+seconds*1000,counter=seconds*1000;alphaValues.push(alphaAnimator.getScalarValue(new Float32Array(1),'KMTA',sequence,frame,counter,layer.alpha??1)[0]);}tracks.push(new T.NumberKeyframeTrack(mesh.uuid+'.material.opacity',sampleTimes,alphaValues));}
  const clip=new T.AnimationClip(def.name||'Animation '+(sequence+1),length,tracks);clip.userData={warcraft:true,nonLooping:!!def.nonLooping,interval:[start,end],sampleFps:60};clips.push(clip);
  if(typeof window!=='undefined')await new Promise(resolve=>setTimeout(resolve,0));
 }
 root.animations=clips;root.userData.warcraft={version:model.version,name:model.name,warnings,sampleFps:60};return root;
}
