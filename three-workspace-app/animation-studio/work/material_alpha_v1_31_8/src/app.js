import * as Director from './animation_director.js';
import {DirectorPanel} from './director_panel.js';
import {StudioBridge} from './studio_bridge.js';
let directorPanel=null,directorPending=null,studioBridge=null,directorPatchCounter=0;
import * as Warcraft from './warcraft_loader.js';
import * as League from './league_loader.js';
import * as SceneStudio from './scene_studio.js';
import * as SceneEval from './scene_evaluator.js';
import * as ScenePackage from './scene_package.js';
import * as Ground from './ground_environment.js';
import {ScenePanel} from './scene_panel.js';
import {bobj as exportBOBJ} from './bobj_export.js';
let minimalBooting=true;
let workspaceSelectOnly=false, timelineHeightBeforeGraph=null;
import {ClipPreview} from './source_preview.js';
let sourcePreview=null,sourcePreviewLocks=null,quickClipRig=null;
import * as Tex from './texture_assets.js';
import * as AnimationExport from './animation_export.js';
import * as CompareSpace from './compare_space.js';
import * as T from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {TransformControls} from 'three/addons/controls/TransformControls.js';
import {FBXLoader} from './fbx_loader_native.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {GLTFExporter} from 'three/addons/exporters/GLTFExporter.js';
import {clone as cloneSkeleton} from 'three/addons/utils/SkeletonUtils.js';
import * as C from './core.js';
import * as BOBJ from './bobj_loader.js';
import * as W from './control_rig.js';
import * as O from './onion_skin.js';
import * as V from './viewport_display.js';
import * as S from './skin_shape.js';
import {MotionPanel} from './motion_panel.js';
import {EasingPanel} from './easing_panel.js';
import {SmoothingPanel} from './smoothing_panel.js';
import {GraphEditor} from './graph_editor.js';
import {ViewportToolbar} from './viewport_toolbar.js';
let viewportToolbar=null;
let graphEditor=null;
let smoothingPanel=null,easingPanel=null,easingPreview=null;
let motionPanel=null,motionMapCache=null,motionHandDrag=null;
let numericDrag=null,activeCameraView=null;
let dualEnabled=false,editorSlots={A:null,B:null},activeEditorSlot='A',dualTimelineMode='shared',singleViewportLayout='single',inactiveEditorRender=false;
let onionRevision=0,onionLastUnit='frames';
const $=id=>document.getElementById(id), rad=T.MathUtils.degToRad,deg=T.MathUtils.radToDeg;
let studioMode='classic',studioBanks={classic:null,lab:null},labClipId='clip1';
let rig,project,time=0,playing=false,mode='create',selected='root',rigDrag=null,rigHover=null,selectionKeys=[],history=[],historyIndex=-1,dirty=false,draft=false,clipboard=null,targetRig=null,mapping={},targetToken=0,importToken=0;
let sceneProject=SceneStudio.create(),scenePending=null,scenePreview=null,sceneDialog=null,sceneMode=false,sceneHistory=[];
const errors=[],info=(m,error=false)=>{$('status').textContent=m;$('status').classList.toggle('dirty',error);if(error)errors.push(m);};
const guard=fn=>(...args)=>{try{const result=fn(...args);if(result?.catch)result.catch(e=>info(e.message,true));}catch(e){info(e.message,true);}};
const listen=(id,event,fn)=>$(id).addEventListener(event,guard((...args)=>{if(mode==='compare'&&blockedCompareTarget(args[0]?.target))return;if(sourcePreview&&sourcePreviewBlocked(args[0]?.target,id))return;return fn(...args);}));
const sampleBytes=()=>Uint8Array.from(atob($('sampleAsset').textContent.trim()),c=>c.charCodeAt(0)).buffer;
const base64=buf=>{let s='';const b=new Uint8Array(buf);for(let i=0;i<b.length;i+=32768)s+=String.fromCharCode(...b.subarray(i,i+32768));return btoa(s);};
const download=(data,name,type)=>{const blob=data instanceof Blob?data:new Blob([data],{type});const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);};
const safeName=()=>((project.name.replace(/[^\p{L}\p{N}_-]/gu,'_').slice(0,80)||'animation')+(dualEnabled?'-'+activeEditorSlot:''));
const createOption=(value,text)=>{const e=document.createElement('option');e.value=value;e.textContent=text;return e;};
const fillOptions=(el,options,value)=>{el.replaceChildren(...options.map(x=>createOption(x[0],x[1])));if(value!==undefined)el.value=value;};
function disposeObject(root){const geometries=new Set(),materials=new Set(),textures=new Set();root.traverse(o=>{if(o.geometry)geometries.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:o.material?[o.material]:[]){materials.add(m);for(const v of Object.values(m))if(v?.isTexture)textures.add(v);}});geometries.forEach(x=>x.dispose());materials.forEach(x=>x.dispose());textures.forEach(x=>{if(x.image?.src?.startsWith('blob:'))URL.revokeObjectURL(x.image.src);x.dispose();});}
async function parseAsset(bytes,name,allowBOBJ=false,resources=[],companions=[]){if(bytes.byteLength>120*1024*1024)throw Error('File quá lớn (giới hạn 120 MB).');let root,sourceUp='y';const loading=Tex.loading(resources,()=>{editView.dirty=true;compareA.dirty=true;compareB.dirty=true;});if(/\.skn$/i.test(name)){if(!Array.isArray(companions)||companions.length>513)throw Error('LoL: quá nhiều file đi kèm.');const skl=companions.filter(x=>/\.skl$/i.test(x.name)),anms=companions.filter(x=>/\.anm$/i.test(x.name));if(skl.length!==1)throw Error('LoL: cần đúng một SKL cùng SKN.');const files=[...skl,...anms];if(files.some(x=>typeof x.name!=='string'||typeof x.data!=='string'||x.data.length>170000000||!/^[-A-Za-z0-9+/=]*$/.test(x.data)))throw Error('LoL: file đi kèm không hợp lệ.');const decode=x=>Uint8Array.from(atob(x.data),c=>c.charCodeAt(0)).buffer;root=await League.parse(bytes,decode(skl[0]),anms.map(x=>({name:x.name,bytes:decode(x)})),resources,name);sourceUp='y';}else if(/\.(mdx|mdl)$/i.test(name)){root=await Warcraft.parse(bytes,name,resources);sourceUp='y';}else if(/\.bobj$/i.test(name)){root=BOBJ.parse(bytes);}else if(/\.fbx$/i.test(name)){root=new FBXLoader(loading.manager).parse(bytes,'');sourceUp=root.userData.compareOriginalUpAxis===2?'z':'y';}else if(/\.glb$/i.test(name)){const gltf=await new GLTFLoader(loading.manager).parseAsync(bytes,'');root=gltf.scene;root.animations=gltf.animations;root.traverse(o=>{if(o.userData.axisSystem==='blender'&&o.name==='AnimationStudioUnits'){sourceUp='z';o.quaternion.premultiply(C.kinematics.blenderBasis.clone().invert());o.userData.axisSystem='minecraft';}});}else throw Error('Chỉ nhận FBX / GLB / BOBJ / MDX / MDL / SKN+SKL.');await loading.wait();
 // Rebind clip bằng UUID trước khi trả lại tên gốc: loader bỏ dấu chấm trong tên Metarig.
 for(const clip of root.animations||[])for(const track of clip.tracks){const binding=T.PropertyBinding.parseTrackName(track.name),node=T.PropertyBinding.findNode(root,binding.nodeName);if(node&&!binding.objectName)track.name=node.uuid+'.'+binding.propertyName+(binding.propertyIndex!==undefined?'['+binding.propertyIndex+']':'');}
 root.traverse(o=>{const original=o.userData.originalName||o.userData.name;if(typeof original==='string'&&original)o.name=original;});
 const rawCount=[];root.traverse(o=>{if(o.isBone)rawCount.push(o);});
 root.updateMatrixWorld(true);let merged=0;
 // FBXLoader có thể tạo bone identity trùng cho cluster dùng chung giữa nhiều skin.
 const aliases=new Map();for(const b of rawCount){if(!b.parent?.isBone||b.name!==b.parent.name||b.children.length)continue;const local=new T.Matrix4().compose(b.position,b.quaternion,b.scale),identity=new T.Matrix4();if(local.elements.every((v,i)=>Math.abs(v-identity.elements[i])<1e-7))aliases.set(b,b.parent);}
 if(aliases.size){root.traverse(o=>{if(o.isSkinnedMesh)o.skeleton.bones=o.skeleton.bones.map(b=>aliases.get(b)||b);});for(const b of aliases.keys()){b.removeFromParent();merged++;}}
 const result=C.makeRig(root,name,{name,data:base64(bytes),resources,companions});result.warnings.push(...loading.warnings,...(root.userData.warcraft?.warnings||[]),...(root.userData.league?.warnings||[]));if(root.userData.warcraft){result.profile=root.userData.warcraft.version===1800?'Warcraft MDX 1800':'Warcraft Classic';result.warnings.push('Warcraft: dữ liệu đã chuyển Z-up → Y-up; clip nguồn lấy mẫu 60 FPS. Đơn vị chưa chuẩn hóa, hãy chọn đơn vị trước khi xuất.');}if(root.userData.league){result.profile='League of Legends';result.warnings.push('LoL: clip ANM được lấy mẫu tối đa 60 FPS; kiểm tra đơn vị (mặc định cm) và trục trước khi xuất. Material chưa đọc BIN.');}result.sourceUp=sourceUp;result.isBOBJ=!!root.bobjActions;result.bobjEulerOrder='ZYX';if(result.isBOBJ)for(const rec of result.records)rec.weighted=!!rec.o.userData.bobjWeighted;if(root.bobjWarnings)result.warnings.push(...root.bobjWarnings);result.loaderNodeCount=rawCount.length;result.mergedLoaderDuplicates=merged;if(merged)result.warnings.push('Đã hợp nhất '+merged+' node identity trùng do skin dùng chung; giữ nguyên weights và file gốc.');return result;}
function record(r,id){return r.records.find(x=>x.id===id);}
function currentObject(){return selected==='root'?rig.root:rig.controls[selected]?.object||record(rig,selected)?.o;}
function activeIds(scope=$('poseScope').value){if(selected==='root'||scope==='all')return ['root',...C.activeRecords(rig).map(r=>r.id)];if(rig.controls[selected])return [selected];return scope==='branch'?C.descendants(rig,selected).map(r=>r.id):[selected];}
function snapshot(){if(sourcePreview?.saved)return C.clone(sourcePreview.saved);return{project:C.clone(project),pose:C.capture(rig),controls:Object.fromEntries(Object.entries(rig.controls).map(([id,c])=>[id,C.snap(c.object)])),modes:rig.chains.map(c=>[c.id,c.mode]),options:rig.chains.map(c=>[c.id,C.clone(c.options)]),activeRoot:rig.activeRoot,time,selected,draft,selectionKeys:C.clone(selectionKeys)};}
function commit(){assertEditingAllowed();if(directorPending){directorPending=null;syncDirector();}if(project?.lab)C.motionLab.sync(project);onionRevision++;editView.dirty=true;dirty=true;$('saveBtn').textContent='Lưu dự án •';history=history.slice(0,historyIndex+1);history.push(snapshot());if(history.length>80)history.shift();historyIndex=history.length-1;syncButtons();drawTimeline();}
function syncButtons(){$('undoBtn').disabled=historyIndex<=0;$('redoBtn').disabled=historyIndex>=history.length-1;syncQuickAnimation();}
function restoreHistory(i){assertEditingAllowed();directorCancel();if(i<0||i>=history.length)return;cancelEasingPreview();onionRevision++;historyIndex=i;const h=history[i];project=C.clone(h.project);studioMode=project.lab?'lab':'classic';$('studioMode').value=studioMode;S.apply(rig,project.skinAdjustments);rig.activeRoot=h.activeRoot||null;time=h.time;selected=h.selected;draft=h.draft;selectionKeys=C.clone(h.selectionKeys||[]);C.evaluate(rig,project,time);for(const [id,p]of Object.entries(h.pose))C.apply(id==='root'?rig.root:rig.controls[id]?.object||record(rig,id).o,p);for(const[id,o]of h.options||[])C.kinematics.configure(rig,rig.chains.find(c=>c.id===id),o,false);for(const [id,p]of Object.entries(h.controls))C.apply(rig.controls[id].object,p);for(const [id,m]of h.modes)rig.chains.find(c=>c.id===id).mode=m;rig.root.updateMatrixWorld(true);dirty=true;renderBones();fillOptions($('rigSelect'),[['','Tất cả armature'],...rig.armatures.map(a=>[a.id,a.name])],rig.activeRoot||'');fillOptions($('ikChain'),rig.chains.filter(c=>!rig.activeRoot||c.root===rig.activeRoot).map(c=>[c.id,c.label]));syncProject();select(selected);syncButtons();refresh();}
function markPose(keyIds=null,limitIds=keyIds||[selected]){assertEditingAllowed();if(project?.lab)C.motionLab.constrain(rig,project,time,labApi);constrainPose(limitIds);playing=false;draft=true;$('draftBadge').textContent='Pose chưa ghi key';$('draftBadge').classList.add('dirty');if($('autoKey').checked){if(C.jointLimits.pinConflict(rig,project,time,keyIds||[selected])){commit();refresh();throw Error('Ghim IK xung đột giới hạn xoay. Pose sửa được giữ và có Undo; tắt ghim trước khi Ghi key.');}writeKeys(keyIds||activeIds(selected.startsWith('ik_')||selected.startsWith('pole_')?'node':$('poseScope').value),keyIds?motionAffectedChains(keyIds):null);draft=false;}commit();refresh();}
function writeKeys(ids,onlyChains=null){assertEditingAllowed();if(draft&&C.jointLimits.pinConflict(rig,project,time,ids))throw Error('Ghim IK xung đột giới hạn xoay. Tắt ghim trước khi Ghi key; pose sửa vẫn được giữ.');const chains=onlyChains||rig.chains.filter(c=>!rig.activeRoot||c.root===rig.activeRoot);ids=[...new Set([...ids,...chains.filter(c=>c.mode==='ik').flatMap(c=>['ik_'+c.id,'pole_'+c.id])])];for(const c of chains)if(c.mode==='ik'&&C.jointLimits.chainLimited(rig,c,project.jointLimits))ids.push(c.a.id,c.b.id,c.c.id);ids=[...new Set(ids)];const labValues=project.lab?C.motionLab.encode(rig,project,time,ids,labApi):null;for(const id of ids){const o=id==='root'?rig.root:rig.controls[id]?.object||record(rig,id)?.o;if(o)C.addKey(project,id,time,labValues?.[id]||C.snap(o),$('interpolation').value,Number($('easingStrength').value)/100);}
 for(const c of chains){
 const keys=project.ikModes[c.id]||(project.ikModes[c.id]=[]);project.ikOptions||={};const opts=project.ikOptions[c.id]||(project.ikOptions[c.id]=[]),oi=opts.findIndex(k=>Math.abs(k.time-time)<1e-7),ov={time,options:C.clone(c.options),...C.easing.metadata($('interpolation').value,Number($('easingStrength').value)/100)};if(oi>=0)opts[oi]=ov;else opts.push(ov);opts.sort((a,b)=>a.time-b.time);
 const entry={time,mode:c.mode},index=keys.findIndex(k=>Math.abs(k.time-time)<1e-7);if(index>=0)keys[index]=entry;else keys.push(entry);keys.sort((a,b)=>a.time-b.time);}
 draft=false;$('draftBadge').textContent='Pose đã ghi';$('draftBadge').classList.remove('dirty');
}
function makeView(container,edit=false){
 const scene=new T.Scene();scene.background=new T.Color($('background').value);
 const camera=new T.PerspectiveCamera(38,1,.01,200),ortho=new T.OrthographicCamera(-2,2,2,-2,.01,200);camera.up.set(0,0,1);ortho.up.copy(camera.up);camera.position.set(3,-4.8,2.1);ortho.position.copy(camera.position);
 const renderer=new T.WebGLRenderer({antialias:true,alpha:false});renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.outputColorSpace=T.SRGBColorSpace;container.appendChild(renderer.domElement);
 const orbit=new OrbitControls(camera,renderer.domElement);orbit.target.set(0,0,1);orbit.enableDamping=false;
 scene.add(new T.AmbientLight(0xffffff,1.6));for(const position of [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]]){const light=new T.DirectionalLight(0xffffff,.8);light.position.fromArray(position);scene.add(light);}
 const grid=new T.GridHelper(8,16,0x4a515b,0x343c46);grid.material.transparent=true;grid.material.opacity=.45;scene.add(grid);
 const wrapper=new T.Group();scene.add(wrapper);const visual=new T.Group();scene.add(visual);
 const lineMat=new T.LineBasicMaterial({vertexColors:true,depthTest:false,transparent:true,opacity:.9}),line=new T.LineSegments(new T.BufferGeometry(),lineMat);line.renderOrder=10;visual.add(line);
 renderer.localClippingEnabled=true;
 const gridXY=grid.clone();gridXY.rotation.x=Math.PI/2;scene.add(gridXY);const gridYZ=grid.clone();gridYZ.rotation.z=Math.PI/2;scene.add(gridYZ);const worldAxes=new T.AxesHelper(1);scene.add(worldAxes);
 const v={grid,gridXY,gridYZ,worldAxes,ground:Ground.create(scene),container,scene,camera,perspective:camera,ortho,renderer,orbit,wrapper,visual,line,rig:null,nodes:[],segments:[],axes:[],labels:[],dirty:true,orthographic:false,edit};
 if(edit){
  for(const [key,tool] of [['gizmo','rotate'],['moveGizmo','translate']]){
   const g=v[key]=new TransformControls(camera,renderer.domElement);g.setMode(tool);g.setSpace('local');scene.add(g.getHelper());
   g.addEventListener('change',()=>{v.dirty=true;editView.dirty=true;});
   g.addEventListener('dragging-changed',e=>{orbit.enabled=!e.value;playing=false;});
   g.addEventListener('mouseDown',()=>{v.before=snapshot();v.gizmoCancelled=false;});
   g.addEventListener('objectChange',()=>{const c=rig.chains.find(c=>selected.endsWith(c.id));if(c&&rig.controls[selected]&&c.mode==='ik'){if(g.mode==='rotate'&&selected==='ik_'+c.id)C.kinematics.preserveWristPivot(c,currentObject(),v.before?.controls[selected]);if(!(g.mode==='rotate'&&selected==='ik_'+c.id&&c.options.wristPivot))constrainControl(c,selected);}for(const chain of rig.chains)if(chain.mode==='ik')solvePoseIK(chain);constrainPose([selected]);syncTransform();refresh();});
   g.addEventListener('mouseUp',()=>{if(v.gizmoCancelled){v.gizmoCancelled=false;return;}markPose();});
  }
 }
 orbit.addEventListener('change',()=>{v.dirty=true;if(!edit&&$('syncCameras').checked&&!v.syncing){const other=v===compareA?compareB:compareA;if(other){other.syncing=true;V.projection(other,v.orthographic);syncProjectionButton(other);other.camera.zoom=v.camera.zoom;other.camera.updateProjectionMatrix();const basis=new T.Quaternion().setFromUnitVectors(v.camera.up,other.camera.up);other.camera.position.copy(v.camera.position).applyQuaternion(basis);other.orbit.target.copy(v.orbit.target).applyQuaternion(basis);other.orbit.update();other.dirty=true;other.syncing=false;}}});
 renderer.domElement.addEventListener('pointerdown',e=>{activeCameraView=v;if(v.edit)activeEditView=v;v.down=[e.clientX,e.clientY];});
 renderer.domElement.addEventListener('pointerup',e=>{if(e.button!==0||!v.down||Math.hypot(e.clientX-v.down[0],e.clientY-v.down[1])>5||v.gizmo?.axis||v.moveGizmo?.axis)return;const rect=renderer.domElement.getBoundingClientRect(),ray=new T.Raycaster();ray.setFromCamera(new T.Vector2((e.clientX-rect.left)/rect.width*2-1,-(e.clientY-rect.top)/rect.height*2+1),v.camera);const candidates=v.nodes.filter(x=>x.visible);for(const node of candidates){node.quaternion.copy(v.camera.quaternion);node.updateWorldMatrix(true,false);}const picks=ray.intersectObjects(candidates);if(v.edit&&pickOnionPose(ray,picks[0]?.distance))return;let picked=picks[0]?.object;if(!picked){picked=candidates.map(node=>{const p=node.position.clone().project(v.camera);return{node,distance:Math.hypot((p.x+1)*rect.width/2+rect.left-e.clientX,(1-p.y)*rect.height/2+rect.top-e.clientY),z:p.z};}).filter(x=>x.distance<=6&&x.z>=-1&&x.z<=1).sort((a,b)=>a.distance-b.distance)[0]?.node;}if(picked){const id=picked.userData.boneId;if(edit)selectUser(id);else selectCompare(v===compareA?'A':'B',id);}});
 renderer.domElement.addEventListener('webglcontextlost',e=>{e.preventDefault();v.contextLost=true;info('WebGL context bị mất; đang chờ khôi phục.',true);});renderer.domElement.addEventListener('webglcontextrestored',()=>{v.contextLost=false;v.resizePending=true;v.dirty=true;});
 new ResizeObserver(()=>{v.resizePending=true;v.dirty=true;drawTimeline();drawCurve();}).observe(container);

 return v;
}
setupGroundDOM();
let editView=makeView($('editViewport'),true);const compareA=makeView($('compareViewportA')),compareB=makeView($('compareViewportB'));
compareA.projectionButton=$('compareProjectionA');compareB.projectionButton=$('compareProjectionB');
let onion=new O.OnionSkin(editView);
let editViews=[editView];let activeEditView=editView;
function dirtyViews(){if(rig)rig.visualRevision=(rig.visualRevision||0)+1;for(const v of editViews)v.dirty=true;}

const cameraActions=['orbit','pan','zoom'];
function cameraBindings(){return cameraActions.map((id,i)=>({id,button:$(id+'Button').value,modifier:$(id+'Modifier').value,action:[T.MOUSE.ROTATE,T.MOUSE.PAN,T.MOUSE.DOLLY][i]}));}
function applyMouseSettings(){
 let bindings=cameraBindings();const used=new Set();let duplicate=false;
 for(const b of bindings){if(b.button==='none')continue;const key=b.button+':'+b.modifier;if(used.has(key))duplicate=true;used.add(key);}
 if(duplicate){for(const id of cameraActions)for(const suffix of ['Button','Modifier'])$(id+suffix).value=$(id+suffix).dataset.valid||$(id+suffix).querySelector('option[selected],option').value;bindings=cameraBindings();}
 for(const id of cameraActions)for(const suffix of ['Button','Modifier'])$(id+suffix).dataset.valid=$(id+suffix).value;
 $('mouseHint').textContent=duplicate?'Tổ hợp bị trùng; đã giữ cấu hình hợp lệ trước đó.':bindings.map(b=>b.id[0].toUpperCase()+b.id.slice(1)+': '+$(b.id+'Button').selectedOptions[0].textContent+(b.modifier==='none'?'':' + '+$(b.id+'Modifier').selectedOptions[0].textContent)).join(' · ');
 for(const v of [...editViews,compareA,compareB]){v.orbit.mouseButtons={LEFT:undefined,MIDDLE:undefined,RIGHT:undefined};for(const b of bindings)if(b.button!=='none'&&b.modifier==='none')v.orbit.mouseButtons[['LEFT','MIDDLE','RIGHT'][+b.button]]=b.action;}
}
function installCameraInput(v){
 v.renderer.domElement.addEventListener('pointerdown',e=>{
  if(e.pointerType==='touch')return;
  const modifier=e.altKey?'alt':e.ctrlKey||e.metaKey?'ctrl':e.shiftKey?'shift':'none';
  const binding=cameraBindings().find(b=>b.button===String(e.button)&&b.modifier===modifier);
  let action=binding?.action;
  // OrbitControls swaps rotate/pan with Ctrl or Shift; cancel that built-in swap for explicit bindings.
  if((e.ctrlKey||e.metaKey||e.shiftKey)&&action!==T.MOUSE.DOLLY&&action!==undefined)action=action===T.MOUSE.ROTATE?T.MOUSE.PAN:T.MOUSE.ROTATE;
  v.orbit.mouseButtons[['LEFT','MIDDLE','RIGHT'][e.button]]=action;
 },true);
 v.renderer.domElement.addEventListener('wheel',e=>{if(!$('zoomWheel').checked){e.preventDefault();e.stopImmediatePropagation();}},{capture:true,passive:false});
}
for(const v of [...editViews,compareA,compareB])installCameraInput(v);
function sizeGizmo(v=editView){
 const o=v.gizmo.object;if(!o)return;
 const pixels=70*+$('gizmoSize').value,h=Math.max(1,v.container.clientHeight),p=o.getWorldPosition(new T.Vector3()),distance=p.distanceTo(v.camera.position),depth=Math.abs(p.clone().applyMatrix4(v.camera.matrixWorldInverse).z);
 v.gizmoRadius=pixels;v.gizmoAvoidRadius=pixels*(v.moveGizmo.object?1.6:1.15);
 // TransformControls already scales by projection/zoom; compensate its actual handle geometry once.
 const height=v.camera.isOrthographicCamera?(v.camera.top-v.camera.bottom)/v.camera.zoom:2*depth*Math.tan(rad(v.camera.fov/2))/v.camera.zoom;
 const factor=v.camera.isOrthographicCamera?height:distance*Math.min(1.9*Math.tan(rad(v.camera.fov/2))/v.camera.zoom,7);
 const size=pixels*4*height/(.75*h*Math.max(factor,1e-8));v.gizmo.setSize(size);v.moveGizmo?.setSize(size*1.85);
}

function configureGizmo(v){if(sourcePreview){v.gizmo.detach();v.moveGizmo.detach();return;}
 const object=currentObject();if(!object)return;
 const locked=boneIKChain(),pole=selected.startsWith('pole_'),tool=pole?'translate':$('transformMode').value;
 if(locked||workspaceSelectOnly){v.gizmo.detach();v.moveGizmo.detach();return;}
 if(v.gizmo.object!==object)v.gizmo.attach(object);const primary=tool==='both'?'rotate':tool;if(v.gizmo.mode!==primary)v.gizmo.setMode(primary);if(v.gizmo.space!==$('space').value)v.gizmo.setSpace($('space').value);
 if(tool==='both'&&!pole){if(v.moveGizmo.object!==object)v.moveGizmo.attach(object);}else if(v.moveGizmo.object)v.moveGizmo.detach();if(v.moveGizmo.space!==$('space').value)v.moveGizmo.setSpace($('space').value);
 for(const g of [v.gizmo,v.moveGizmo])g.enabled=true;sizeGizmo(v);
}
function constrainControl(chain,id){
 const object=rig.controls[id]?.object;if(!object)return;
 const A=chain.a.o.getWorldPosition(new T.Vector3()),B=chain.b.o.getWorldPosition(new T.Vector3()),E=chain.c.o.getWorldPosition(new T.Vector3()),point=object.getWorldPosition(new T.Vector3());
 const center=id.startsWith('pole_')?B:A,max=id.startsWith('pole_')?Math.max(.15,4*+$('poleDistance').value):(A.distanceTo(B)+B.distanceTo(E))*(1+(chain.options.maxStretch-1)*chain.options.stretch);
 const delta=point.sub(center);if(delta.length()>max){delta.setLength(max);object.position.copy(object.parent.worldToLocal(center.add(delta)));object.updateWorldMatrix(true,true);}
}
function syncProjectionButton(v){const label=v.orthographic?'Ortho · Trực giao':'Pers · Phối cảnh';const button=v===editView?$('projectionBtn'):v.projectionButton;if(button){button.textContent=label;button.setAttribute('aria-pressed',String(v.orthographic));}}
function prepareRigView(v){if(v.widgets){W.update(v,rig,rigWidgetSettings());v.scene.updateMatrixWorld(true);}}
function bindSharedView(v){
 W.clear(v);for(const label of v.labels||[])label.remove();v.rig=rig;v.wrapper=editView.wrapper;v.visual=editView.visual;v.line=editView.line;v.nodes=editView.nodes;v.segments=editView.segments;v.axes=editView.axes;
 v.labels=rig.records.map(rec=>{const label=document.createElement('span');label.className='bone-label';label.textContent=C.short(rec.name);v.container.append(label);return label;});
 W.build(v,rig);configureGizmo(v);v.dirty=true;
}
function createSharedView(index){
 const container=document.createElement('div');container.id='editViewport'+index;container.className='viewport';$('viewportGrid').append(container);
 const v=makeView(container,true),old=v.scene;Ground.dispose(v.ground);old.remove(v.gizmo.getHelper(),v.moveGizmo.getHelper());old.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});old.clear();
 v.scene=editView.scene;v.ground=editView.ground;v.scene.add(v.gizmo.getHelper(),v.moveGizmo.getHelper());v.shared=true;editViews.push(v);
 const header=document.createElement('div');header.className='aux-toolbar';const preset=document.createElement('select');preset.setAttribute('aria-label','Góc camera khung '+(index+1));
 for(const [id,name] of [['front','Front'],['reset','Pers'],['back','Back'],['left','Left'],['side','Right'],['top','Top'],['bottom','Bottom']])preset.append(createOption(id,name));
 const projection=document.createElement('button');projection.type='button';projection.setAttribute('aria-label','Kiểu chiếu khung '+(index+1));v.projectionButton=projection;
 header.append(preset,projection);container.append(header);preset.onchange=()=>{setupViewPreset(v,preset.value);if(preset.value==='reset')V.projection(v,false);syncProjectionButton(v);};projection.onclick=()=>{V.projection(v,!v.orthographic);syncProjectionButton(v);};
 bindSharedView(v);installCameraInput(v);installRigPointer(v);installGizmoPriority(v);installTextureDrop(v,'editor');
 container.addEventListener('pointerdown',()=>{activeEditView=v;for(const other of editViews)other.container.classList.toggle('active-view',other===v);});
 container.addEventListener('rig-select',e=>{const d=v.widgets.find(x=>x.id===e.detail);if(d){const changed=activateRigWidget(d);if(changed)commit();refresh();}});
 v.presetSelect=preset;return v;
}
let viewportLayoutApplied='single';
function applyViewportLayout(){
 if(dualEnabled){for(const slot of Object.values(editorSlots)){if(!slot)continue;for(const v of slot.views.slice(1)){v.container.hidden=true;v.container.style.display='none';}slot.view.container.hidden=false;} $('viewportGrid').dataset.layout='dual-character';return;}
 if(!rig)return;const layout=$('viewportLayout').value,count=layout==='quad'?4:layout==='triple'?3:layout==='dual'?2:1;
 while(editViews.length<count)createSharedView(editViews.length);
 for(const [i,v]of editViews.entries()){v.container.hidden=i>=count;v.container.style.display=i>=count?'none':'';}
 if(activeEditView.container.hidden)activeEditView=editView;
 $('viewportGrid').dataset.layout=layout;
 if(layout!==viewportLayoutApplied&&count>1){
  const views=layout==='quad'?[['front',true],['reset',false],['back',true],['left',true]]:layout==='triple'?[['front',true],['reset',false],['left',true]]:[['front',true],['reset',false]];
  views.forEach(([preset,ortho],i)=>{const v=editViews[i];setupViewPreset(v,preset);V.projection(v,ortho);if(v.presetSelect)v.presetSelect.value=preset;else $('cameraPreset').value=preset;syncProjectionButton(v);});
 }
 viewportLayoutApplied=layout;viewportToolbar?.sync();dirtyViews();
}
function installGizmoPriority(v){
 const canvas=v.renderer.domElement;
 canvas.addEventListener('pointerdown',e=>{
  if(e.button!==0)return;
  const rect=canvas.getBoundingClientRect(),event={x:(e.clientX-rect.left)/rect.width*2-1,y:-(e.clientY-rect.top)/rect.height*2+1,button:e.button};
  for(const g of [v.gizmo,v.moveGizmo]){g.enabled=true;g.pointerHover(event);}
  if(v.gizmo.axis&&v.moveGizmo.axis){const p=currentObject().getWorldPosition(new T.Vector3()).project(v.camera),radius=Math.hypot(e.clientX-rect.left-(p.x+1)*rect.width/2,e.clientY-rect.top-(1-p.y)*rect.height/2);if(['X','Y','Z'].includes(v.moveGizmo.axis)&&radius>v.gizmoRadius*.9)v.gizmo.enabled=false;else if(radius>v.gizmoRadius*.5)v.moveGizmo.enabled=false;else v.gizmo.enabled=false;}
 },true);
 canvas.addEventListener('pointerup',()=>{for(const g of [v.gizmo,v.moveGizmo])g.enabled=true;});
 canvas.addEventListener('pointercancel',()=>{for(const g of [v.gizmo,v.moveGizmo])g.enabled=true;});
}
installGizmoPriority(editView);

function clearView(v){for(const x of [...v.nodes,...v.segments,...v.axes]){v.visual.remove(x);disposeObject(x);}v.nodes=[];v.segments=[];v.axes=[];for(const el of v.labels)el.remove();v.labels=[];v.line.geometry.dispose();}
function placeAnimationRig(v,r){
 const placement=CompareSpace.alignClip(r,v.wrapper,'z',true);if(placement.warning)r.warnings.push(placement.warning);if(placement.source.startsWith('đáy mesh'))r.warnings.push('Không nhận diện được xương bàn chân; dùng đáy mesh để đặt mặt đất.');
}
function mount(v,r){V.clearMeshDisplay(v);v.gizmo?.detach();v.moveGizmo?.detach();if(v.edit){onion.clear();W.clear(v);}clearView(v);if(v.rig){v.wrapper.remove(v.rig.root);disposeObject(v.rig.root);for(const c of Object.values(v.rig.controls)){c.object.removeFromParent();disposeObject(c.object);}for(const chain of v.rig.chains)for(const frame of Object.values(chain.frames||{}))frame.removeFromParent();}
 v.rig=r;r.editorUp='z';v.wrapper.quaternion.copy(C.kinematics.blenderBasis);v.wrapper.scale.setScalar(2/r.height);v.wrapper.position.set(0,0,0);v.wrapper.add(r.root);
 v.wrapper.updateMatrixWorld(true);if(v.edit)placeAnimationRig(v,r);else{const box=new T.Box3().setFromObject(r.root);for(const rec of r.records)box.expandByPoint(rec.o.getWorldPosition(new T.Vector3()));const center=box.getCenter(new T.Vector3());v.wrapper.position.set(-center.x,-center.y,-box.min.z);}v.wrapper.updateMatrixWorld(true);
 const positions=[],colors=[];for(const rec of r.records){const node=new T.Mesh(new T.SphereGeometry(1,8,6),new T.MeshBasicMaterial({color:$('boneColor').value,side:T.DoubleSide,depthTest:false}));node.renderOrder=12;node.userData.boneId=rec.id;v.nodes.push(node);v.visual.add(node);
 const seg=new T.Mesh(new T.OctahedronGeometry(1,0),new T.MeshBasicMaterial({color:$('boneColor').value,depthTest:false,transparent:true,opacity:.8}));seg.renderOrder=9;v.segments.push(seg);v.visual.add(seg);
 const axes=new T.AxesHelper(1);axes.material.depthTest=false;axes.renderOrder=13;v.axes.push(axes);v.visual.add(axes);
 const label=document.createElement('span');label.className='bone-label';label.textContent=C.short(rec.name);v.container.appendChild(label);v.labels.push(label);
 if(rec.parent){positions.push(0,0,0,0,0,0);colors.push(1,1,1,1,1,1);}}
 v.line.geometry=new T.BufferGeometry();v.line.geometry.setAttribute('position',new T.Float32BufferAttribute(positions,3));v.line.geometry.setAttribute('color',new T.Float32BufferAttribute(colors,3));
 v.camera.position.set(2,-3.3,1.65);v.orbit.target.set(0,0,1);v.orbit.update();v.dirty=true;
}
function setupIK(r){r.chains=C.chainSpecs(r);for(const c of r.chains){const A=c.a.o.getWorldPosition(new T.Vector3()),B=c.b.o.getWorldPosition(new T.Vector3()),E=c.c.o.getWorldPosition(new T.Vector3());const dir=E.clone().sub(A).normalize();let pole=B.clone().sub(A).addScaledVector(dir,-B.clone().sub(A).dot(dir));if(pole.lengthSq()<1e-9)pole.set(0,0,1);pole.normalize().multiplyScalar(r.height*.3).add(B);
 for(const [id,p,color]of [['ik_'+c.id,E,0x80b9ff],['pole_'+c.id,pole,0xffcc80]]){const o=new T.Mesh(new T.SphereGeometry(r.height*.015,12,8),new T.MeshBasicMaterial({color,wireframe:true,depthTest:false}));o.name=id;editView.wrapper.add(o);o.position.copy(editView.wrapper.worldToLocal(p.clone()));o.quaternion.copy(editView.wrapper.getWorldQuaternion(new T.Quaternion()).invert().multiply(c.c.o.getWorldQuaternion(new T.Quaternion())));r.controls[id]={object:o,rest:C.snap(o)};}C.kinematics.init(r,c,editView.wrapper);}
}
function rigWidgetSettings(){
 const hex=id=>parseInt($(id).value.slice(1),16);
 return {inFront:$('rigInFront').checked,depthPart:$('rigDepthPart').value,mode:mode==='rig',style:$('rigStyle').value,labels:$('rigLabels').checked,labelSize:+$('rigLabelSize').value,lineWidth:+$('rigLineWidth').value,visible:mode==='rig'&&$('rigVisible').checked,body:$('rigBody').checked,arms:$('rigArms').checked,legs:$('rigLegs').checked,fingers:$('rigFingers').checked,armsLeft:$('rigArmLeft').checked,armsRight:$('rigArmRight').checked,legsLeft:$('rigLegLeft').checked,legsRight:$('rigLegRight').checked,size:$('rigSize').value,left:hex('rigLeft'),right:hex('rigRight'),bodyColor:hex('rigBodyColor'),selected,selectedJoint:poleJointId(),selectedPole:poleControlId(),hover:rigHover?.id};
}
const rigOptionFields={ikParent:'ikParent',poleParent:'poleParent',ikStretch:'stretch',ikMaxStretch:'maxStretch',wristPivot:'wristPivot',footRoll:'footRoll',footRock:'footRock'};
function poleJointId(){return rig?.chains.find(c=>selected==='pole_'+c.id||selected===c.b.id)?.b.id;}
function poleControlId(){const c=rig?.chains.find(c=>selected==='pole_'+c.id||selected===c.b.id);return c?'pole_'+c.id:null;}
function boneIKChain(){return rig?.chains.find(c=>c.mode==='ik'&&[c.a.id,c.b.id,c.c.id].includes(selected));}
function selectedChain(){return rig?.chains.find(c=>selected==='ik_'+c.id||selected==='pole_'+c.id||[c.a.id,c.b.id,c.c.id].includes(selected))||rig?.chains.find(c=>c.id===$('ikChain').value);}
function syncRigInspector(){if(!rig)return;const actual=rig.chains.find(c=>selected==='ik_'+c.id||selected==='pole_'+c.id||[c.a.id,c.b.id,c.c.id].includes(selected)),c=actual,locked=boneIKChain();
 const pole=selected.startsWith('pole_'),ik=selected.startsWith('ik_'),rec=record(rig,selected);
 $('selectionContext').textContent=locked?'Khớp đang do IK điều khiển. Bật Tự chuyển hoặc chọn Chuyển sang FK để chỉnh khớp này.':pole?'Pole · chỉ di chuyển để định hướng khuỷu/gối. Không xoay hoặc scale.':ik?'Đích IK · di chuyển và xoay bàn tay/chân. Scale không áp dụng cho control.':selected==='root'?'Root · di chuyển, xoay hoặc scale toàn nhân vật.':'FK · chỉnh trực tiếp khớp được chọn; giữ nguyên Rest Pose.';
 $('rotationSection').hidden=pole;$('scaleSection').hidden=!!rig.controls[selected];$('ikPanel').hidden=!actual;$('limbOptions').hidden=!actual;
 $('limbOptions').hidden=!actual;for(const[id,k]of Object.entries(rigOptionFields))if(actual&&document.activeElement!==$(id))$(id).value=actual.options[k];$('wristOptions').hidden=!actual||!/Arm/i.test(actual.id);$('footOptions').hidden=!actual||!/Leg/i.test(actual.id);

$('ikEditNotice').hidden=!locked;for(const id of ['rx','ry','rz','px','py','pz','transformMode'])$(id).disabled=!!locked||(selected.startsWith('pole_')&&['rx','ry','rz','transformMode'].includes(id));for(const id of ['sx','sy','sz','resetScale','scaleUniform'])$(id).disabled=$('scaleTarget').value==='skin'?!record(rig,selected)?.weighted:!!locked||!!rig.controls[selected];$('selectedMeta').textContent=(locked?'Khớp do IK điều khiển · '+locked.label:selected==='root'?'Root':selected.startsWith('pole_')?'Pole':selected.startsWith('ik_')?'Đích IK':'FK')+' · '+(rig.armatures.find(a=>a.id===rig.activeRoot)?.name||rig.profile)+' · '+C.activeRecords(rig).length+' xương';for(const v of editViews){if(locked){v.gizmo.detach();v.moveGizmo.detach();}else configureGizmo(v);}for(const [id,value]of [['rigFK','fk'],['rigIK','ik']]){$(id).disabled=!c;$(id).classList.toggle('active',!!c&&c.mode===value);}$('rigSnap').disabled=!c;if(c){$('ikChain').value=c.id;$('ikMode').value=c.mode;}}
function snapIK(c){C.jointLimits.syncControl(rig,c);snapPole(c);}
function snapPole(c){
 const pole=rig.controls['pole_'+c.id].object;
 const A=c.a.o.getWorldPosition(new T.Vector3()),B=c.b.o.getWorldPosition(new T.Vector3()),E=c.c.o.getWorldPosition(new T.Vector3()),dir=E.clone().sub(A).normalize();
 const side=C.kinematics.poleDirection(c,A,B,E);c.bendMemory=side.clone();
 if(!c.bendAxisLocal)c.bendAxisLocal=side.clone().applyQuaternion(c.a.o.getWorldQuaternion(new T.Quaternion()).invert());
 pole.position.copy(pole.parent.worldToLocal(side.multiplyScalar(2*+$('poleDistance').value).add(B)));pole.updateWorldMatrix(true,true);

}
function selectUser(id,save=true){if(sourcePreview)return false;if(mode==='compare')return false;
 if(!rig||!(id==='root'||record(rig,id)||rig.controls[id]))return false;
 const c=rig.chains.find(c=>id==='ik_'+c.id||id==='pole_'+c.id||[c.a.id,c.b.id,c.c.id].includes(id));
 const before=c?JSON.stringify([c.mode,C.snap(rig.controls['ik_'+c.id].object),C.snap(rig.controls['pole_'+c.id].object)]):'';
 if(c&&id==='pole_'+c.id){snapIK(c);c.mode='ik';}
 else if(c&&id===c.b.id)snapPole(c);
 if(c&&$('autoRigMode').checked){
  const next=rig.controls[id]?'ik':'fk';
  if(id==='ik_'+c.id)snapIK(c);
  c.mode=next;
 }
 $('transformMode').value=id.startsWith('pole_')?'translate':'rotate';$('combinedGizmo').checked=false;
 select(id);
 const changed=!!c&&before!==JSON.stringify([c.mode,C.snap(rig.controls['ik_'+c.id].object),C.snap(rig.controls['pole_'+c.id].object)]);
 if(changed){playing=false;draft=true;if(save)commit();refresh();}return changed;
}
function setChainMode(c,next){if(c.mode===next)return;if(next==='ik')snapIK(c);c.mode=next;const id=next==='ik'?'ik_'+c.id:[c.a.id,c.b.id,c.c.id].includes(selected)?selected:c.b.id;select(id);markPose();}
function activateRigWidget(d){return selectUser(d.id,false);}
function cancelRigDrag(){const drag=rigDrag;if(!drag)return;rigDrag=null;for(const v of editViews)v.orbit.enabled=true;for(const [id,p]of Object.entries(drag.before.pose))C.apply(id==='root'?rig.root:record(rig,id)?.o,p);for(const[id,o]of drag.before.options||[])C.kinematics.configure(rig,rig.chains.find(c=>c.id===id),o,false);for(const [id,p]of Object.entries(drag.before.controls))C.apply(rig.controls[id].object,p);for(const [id,m]of drag.before.modes)rig.chains.find(c=>c.id===id).mode=m;draft=drag.before.draft;select(drag.before.selected);refresh();}
function installRigPointer(view){
 const canvas=view.renderer.domElement;
 canvas.addEventListener('pointerdown',e=>{if(sourcePreview||mode!=='rig'||e.button!==0)return;prepareRigView(view);const d=W.pick(view,e);if(!d)return;const rect=canvas.getBoundingClientRect(),p=d.shape.position.clone().project(view.camera),near=Math.hypot(e.clientX-rect.left-(p.x+1)*rect.width/2,e.clientY-rect.top-(1-p.y)*rect.height/2)<14;if((view.gizmo.axis||view.moveGizmo.axis)&&d.kind!=='root'&&!(['pole','box'].includes(d.kind)&&near))return;activeEditView=view;
  const before=snapshot(),changed=activateRigWidget(d),target=d.kind==='root'?(d.id==='root'?rig.root:record(rig,d.id)?.o):rig.controls[d.id]?.object;
  rigDrag={d,before,changed,target,moved:false,startX:e.clientX,startY:e.clientY};
  if(target){const origin=target.getWorldPosition(new T.Vector3()),plane=W.dragPlane(view,origin,d.id==='root'),start=W.pointerOnPlane(view,e,plane);Object.assign(rigDrag,{origin,plane,start});}
  for(const g of [view.gizmo,view.moveGizmo])g.axis=null;view.orbit.enabled=false;canvas.setPointerCapture(e.pointerId);e.preventDefault();e.stopImmediatePropagation();
 },true);
 canvas.addEventListener('pointermove',e=>{if(sourcePreview||mode!=='rig')return;if(!rigDrag){prepareRigView(view);const d=W.pick(view,e);if(d!==rigHover){rigHover=d;canvas.style.cursor=d?'pointer':'';view.dirty=true;}return;}
  const drag=rigDrag;if(!drag.target||!drag.start)return;if(Math.hypot(e.clientX-drag.startX,e.clientY-drag.startY)<2)return;
  const point=W.pointerOnPlane(view,e,drag.plane);if(!point)return;
  const world=drag.origin.clone().add(point.sub(drag.start).multiplyScalar(+$('controlDragSensitivity').value));drag.target.position.copy(drag.target.parent.worldToLocal(world));
  rig.root.updateMatrixWorld(true);if(drag.d.chain&&drag.d.chain.mode==='ik'){constrainControl(drag.d.chain,drag.d.id);solvePoseIK(drag.d.chain);}drag.moved=true;view.dirty=true;syncTransform();e.preventDefault();e.stopImmediatePropagation();
 },true);
 canvas.addEventListener('pointerup',e=>{if(!rigDrag)return;const drag=rigDrag;rigDrag=null;view.orbit.enabled=true;if(canvas.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId);if(drag.moved)markPose();else{if(drag.changed)commit();refresh();}e.preventDefault();e.stopImmediatePropagation();},true);
 canvas.addEventListener('pointercancel',()=>cancelRigDrag(),true);
}
installRigPointer(editView);
function constrainPose(ids){
 const changed=C.jointLimits.editPose(rig,project.jointLimits,ids);if(changed.length)$('jointLimitNotice').textContent='Đã chặn giới hạn: '+changed.map(id=>C.short(record(rig,id).name)).join(', ');return changed;
}
function solvePoseIK(c){C.solveIK(rig,c);return C.jointLimits.affectsChain(rig,c,new Set([selected]))?constrainPose(['ik_'+c.id]):[];}
function syncJointLimits(){
 if(!rig||!project)return;const table=$('jointLimitRows'),records=C.activeRecords(rig),rows=C.jointLimits.presetRows(rig,records),tag=rig.fingerprint+':'+rig.activeRoot+':'+JSON.stringify(project.jointLimits||{});
 if(table.dataset.rig!==tag){table.replaceChildren();for(const row of rows){const tr=document.createElement('tr'),name=document.createElement('th');name.textContent=C.short(row.rec.name);name.scope='row';tr.append(name);const cfg=project.jointLimits?.[row.rec.id];
 for(let i=0;i<3;i++){const td=document.createElement('td');if(cfg?.enabled&&cfg.axes[i]){const caption=document.createElement('small');caption.textContent=row.directions[i]||'XYZ'[i];td.append(caption);for(const bound of ['min','max']){const input=document.createElement('input');input.type='number';input.step='1';input.min=i===1?'-90':'-180';input.max=i===1?'90':'180';input.value=cfg[bound][i];input.setAttribute('aria-label',C.short(row.rec.name)+' '+caption.textContent+' '+bound);input.dataset.bone=row.rec.id;input.dataset.axis=i;input.dataset.bound=bound;input.addEventListener('focus',()=>input.select());input.addEventListener('change',()=>updateJointLimitCell(input));td.append(input);}}else td.textContent=row.config?'Chưa áp dụng / chưa có số':'—';tr.append(td);}
 const status=document.createElement('td');status.textContent=row.note||row.status;tr.append(status);table.append(tr);}table.dataset.rig=tag;}
}
function applyJointLimitPreset(){const map=C.jointLimits.imagePreset(rig,C.activeRecords(rig));project.jointLimits={...project.jointLimits,...map};commit();syncJointLimits();$('jointLimitNotice').textContent='Đã áp dụng '+Object.keys(map).length+' khớp theo ảnh. Không đổi pose/key. Khớp chưa map hoặc ảnh thiếu góc được ghi rõ trong bảng.';}
function updateJointLimitCell(input){const id=input.dataset.bone,axis=Number(input.dataset.axis),bound=input.dataset.bound,x=C.clone(project.jointLimits[id]);try{const value=input.value.trim()===''?NaN:Number(input.value);x[bound][axis]=value;C.jointLimits.validate({[id]:x},rig);project.jointLimits={...project.jointLimits,[id]:x};commit();$('jointLimitNotice').textContent='Đã lưu '+C.short(record(rig,id).name)+'. Chặn lần chỉnh pose tiếp theo; không đổi pose/key.';}catch(e){input.value=project.jointLimits[id][bound][axis];$('jointLimitNotice').textContent=e.message;input.setAttribute('aria-invalid','true');return;}input.removeAttribute('aria-invalid');syncJointLimits();}
function boneSide(r,rec){
 const visited=new Set();while(rec&&!visited.has(rec.id)){visited.add(rec.id);const n=rec.name.replace(/^mixamorig[:_]?/i,'');if(/left|(?:[._-]l)$/i.test(n))return 'left';if(/right|(?:[._-]r)$/i.test(n))return 'right';rec=record(r,rec.parent);}return 'body';
}
function showView(v){
 const w=v.container.clientWidth,h=v.container.clientHeight;if(!w||!h||v.contextLost)return;
 const pixelRatio=Math.min(devicePixelRatio,Number($('renderQuality').value)||1);if(v.renderer.getPixelRatio()!==pixelRatio){v.renderer.setPixelRatio(pixelRatio);v.resizePending=true;}if(v.resizePending||v.width!==w||v.height!==h){v.renderer.setSize(w,h,false);v.perspective.aspect=w/h;v.perspective.updateProjectionMatrix();v.ortho.left=-2*w/h;v.ortho.right=2*w/h;v.ortho.updateProjectionMatrix();v.width=w;v.height=h;v.resizePending=false;}

 if(v.edit){for(const other of editViews){if(other.controlLayer)other.controlLayer.visible=other===v;for(const g of [other.gizmo,other.moveGizmo])g.getHelper().visible=other===v&&!!g.object;}}
 window.studioDebug?.syncView(v);const r=v.rig;if(!r)return;const isEdit=v.edit,selectedId=isEdit?(poleJointId()||selected):$(v===compareA?'compareBoneA':'compareBoneB').value;
 const bonesVisible=isEdit?(mode==='rig'?$('rigShowBones').checked:$('showBones').checked):true,meshVisible=isEdit?$('showMesh').checked:$('compareMesh').checked,names=isEdit?$('showNames').checked:$('compareNames').checked,style=$('boneStyle').value,allAxes=isEdit?$('showAxes').checked: false;
 const displayView=v.shared?editView:v;for(const [object,id]of [[displayView.grid,'viewGridXZ'],[displayView.gridXY,'viewGridXY'],[displayView.gridYZ,'viewGridYZ'],[displayView.worldAxes,'viewWorldAxes']])object.visible=isEdit?$(id).checked:object===displayView.worldAxes||object===(v.displayUp==='z'?displayView.gridXY:displayView.grid);
 Ground.update(displayView,readSettings(),isEdit?'z':v.displayUp||'y');
 V.meshDisplay(displayView,readSettings(),meshVisible,v.camera);
 for(const mesh of r.mesh)mesh.frustumCulled=!$('renderKeepMesh').checked;
 const distance=v.camera.position.distanceTo(v.orbit.target),radius=Math.max(.5,r.height*v.wrapper.scale.y);const near=Math.max(.0001,Math.min(.01,distance/1000)),far=Math.max(200,distance+radius*4,$('groundMode').value==='grid'?0:Number($('groundSize').value)*1.6);if(v.camera.near!==near||v.camera.far!==far){v.camera.near=near;v.camera.far=far;v.camera.updateProjectionMatrix();}
 const pos=v.line.geometry.getAttribute('position'),colors=v.line.geometry.getAttribute('color'),base=new T.Color($('boneColor').value),green=new T.Color(0x64f88c);let offset=0;
 for(let i=0;i<r.records.length;i++){const rec=r.records[i],wp=rec.o.getWorldPosition(new T.Vector3()),wq=rec.o.getWorldQuaternion(new T.Quaternion()),chosen=rec.id===selectedId,visible=!r.activeRoot||C.descendants(r,r.activeRoot).some(x=>x.id===rec.id);const color=chosen?green:($('boneGroupColors').checked?new T.Color($(boneSide(r,rec)==='left'?'boneLeft':boneSide(r,rec)==='right'?'boneRight':'boneBody').value):base),node=v.nodes[i],seg=v.segments[i],axes=v.axes[i],label=v.labels[i];const hand=V.isHand(r,rec),handMode=$('handDisplay').value,shape=hand?$('handNodeShape').value:'dot';if(node.userData.markerShape!==shape){node.geometry.dispose();node.geometry=V.markerGeometry(shape);node.userData.markerShape=shape;}node.position.copy(wp);node.quaternion.copy(v.camera.quaternion);node.scale.setScalar(+(hand?$('handNodeSize'):$('nodeSize')).value*(chosen?1.35:1));node.material.color.copy(color);node.visible=bonesVisible&&visible&&(!hand||handMode!=='hidden');const parent=record(r,rec.parent);
 if(parent){const pp=parent.o.getWorldPosition(new T.Vector3());if(hand&&handMode!=='bones')pp.copy(wp);for(const p of [pp,wp]){pos.setXYZ(offset,p.x,p.y,p.z);colors.setXYZ(offset,color.r,color.g,color.b);offset++;}
 const length=pp.distanceTo(wp);seg.position.copy(pp).lerp(wp,.5);seg.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),wp.clone().sub(pp).normalize());seg.scale.set(style==='stick'?.009:.025,length*.5,style==='stick'?.009:.025);seg.material.color.copy(color);seg.visible=bonesVisible&&visible&&(!hand||handMode==='bones')&&(style==='stick'||style==='octahedral');}else seg.visible=false;
 axes.position.copy(wp);axes.quaternion.copy(wq);axes.scale.setScalar(+(isEdit?$('axisSize'):$('compareAxisSize')).value);axes.visible=visible&&(!hand||handMode!=='hidden')&&(isEdit?(allAxes||style==='axes'||$('rigAxes').value==='all'||chosen&&$('rigAxes').value==='selected'):$('compareAxes').checked&&($('compareJointScope').value==='all'||chosen));
 const hideFinger=$('hideFingerNames').checked&&/thumb|index|middle|ring|pinky|finger|f_/i.test(rec.name)&&!chosen;const screen=wp.clone().project(v.camera);const show=(names||!isEdit&&$('compareEuler').checked&&($('compareJointScope').value==='all'||chosen))&&!hideFinger&&visible&&(!hand||handMode!=='hidden')&&screen.z>-1&&screen.z<1;label.hidden=!show;if(show){if(!isEdit){const q=$('compareEulerSpace').value==='world'?rec.o.getWorldQuaternion(new T.Quaternion()):rec.o.quaternion,e=new T.Euler().setFromQuaternion(q,$('eulerOrder').value);label.textContent=names?C.short(rec.name):'';if($('compareEuler').checked&&($('compareJointScope').value==='all'||chosen))label.textContent+=(names?' · ':'')+[e.x,e.y,e.z].map((x,i)=>'XYZ'[i]+': '+deg(x).toFixed(1)+'°').join(' | ');label.classList.toggle('euler-label',$('compareEuler').checked);}else label.textContent=C.short(rec.name);label.style.left=(screen.x*.5+.5)*v.container.clientWidth+'px';label.style.top=(-screen.y*.5+.5)*v.container.clientHeight+'px';label.classList.toggle('selected',chosen);}}
 pos.needsUpdate=true;colors.needsUpdate=true;v.line.visible=bonesVisible&&(style==='line'||style==='axes');for(const [id,c]of Object.entries(r.controls))c.object.visible=mode!=='rig'&&r.chains.find(ch=>id.endsWith(ch.id))?.mode==='ik';
 if(isEdit){if(!inactiveEditorRender)syncRigInspector();sizeGizmo(v);W.update(v,r,rigWidgetSettings());if(!v.controlAxis){v.controlAxis=new T.AxesHelper(1);v.controlAxis.material.depthTest=false;v.controlAxis.renderOrder=22;v.scene.add(v.controlAxis);}v.controlAxis.visible=!!rig.controls[selected]&&$('rigAxes').value!=='none';if(v.controlAxis.visible){const o=currentObject();v.controlAxis.position.copy(o.getWorldPosition(new T.Vector3()));v.controlAxis.quaternion.copy(o.getWorldQuaternion(new T.Quaternion()));v.controlAxis.scale.setScalar(+$('axisSize').value);}}drawCompass(v);v.scene.background.set($('background').value);if(v.edit)for(const other of editViews){if(other.controlLayer)other.controlLayer.visible=other===v;if(other.controlAxis)other.controlAxis.visible=other===v&&!!rig.controls[selected]&&$('rigAxes').value!=='none';for(const g of [other.gizmo,other.moveGizmo])g.getHelper().visible=other===v&&!!g.object;}if(sceneMode&&!sceneEditing){v.controlLayer&&(v.controlLayer.visible=false);v.controlAxis&&(v.controlAxis.visible=false);for(const label of v.labels||[])label.style.display='none';v.gizmo?.detach();v.moveGizmo?.detach();}const debugRestore=window.studioDebug?.prepareRender(v);try{v.renderer.render(v.scene,v.camera);}finally{window.studioDebug?.finishRender(debugRestore);}v.dirty=false;
}
function drawCompass(v){let compass=v.container.querySelector('.world-axis');if(!compass){compass=document.createElement('div');compass.className='world-axis';v.container.append(compass);}let canvas=compass.querySelector('canvas');if(!canvas){compass.replaceChildren();canvas=document.createElement('canvas');canvas.width=100;canvas.height=100;compass.append(canvas);}const ctx=canvas.getContext('2d');ctx.clearRect(0,0,100,100);const inverse=v.camera.quaternion.clone().invert();for(const [label,axis,color]of [['X',new T.Vector3(1,0,0),'#ee9292'],['Y',new T.Vector3(0,1,0),'#8ae0aa'],['Z',new T.Vector3(0,0,1),'#8eafff']]){axis.applyQuaternion(inverse);const x=50+axis.x*28,y=45-axis.y*28;ctx.strokeStyle=color;ctx.beginPath();ctx.moveTo(50,45);ctx.lineTo(x,y);ctx.stroke();ctx.fillStyle=color;ctx.font='bold 11px Segoe UI';ctx.fillText(label,x+3,y+3);}ctx.fillStyle='#a3b6cc';ctx.font='9px Segoe UI';ctx.fillText(v.edit?'Blender · Z-up':(v.displayUp==='z'?'World · Z-up':'World · Y-up'),20,91);}

function refresh(){syncDirector();syncSceneStudio?.();syncJointLimits();syncModernUI();dirtyViews();editView.dirty=true;compareA.dirty=true;compareB.dirty=true;syncTransform();drawTimeline();drawCurve();syncTime();translateUI();}
function select(id){if(sourcePreview)return;if(!rig)return;selected=id;if(project?.lab)syncLabPanel();const rec=record(rig,id),control=rig.controls[id];$('selectedName').textContent=C.short(rec?.name||control?.object.name||'Root · Toàn nhân vật');$('selectedName').title=rec?.name||control?.object.name||'Root';$('selectedMeta').textContent=(selected==='root'?'Root':selected.startsWith('pole_')?'Pole':selected.startsWith('ik_')?'IK':'FK')+' · '+(rig.armatures.find(a=>a.id===rig.activeRoot)?.name||rig.profile)+' · '+C.activeRecords(rig).length+' bones';$('selectedTag').textContent=C.short($('selectedName').textContent);document.querySelectorAll('#boneList button,#controlList button').forEach(el=>{el.classList.toggle('selected',el.dataset.id===id);el.setAttribute('aria-selected',String(el.dataset.id===id));});const o=currentObject();if(o){$('transformMode').value=id.startsWith('pole_')?'translate':$('combinedGizmo').checked?'both':$('transformMode').value;for(const v of editViews)configureGizmo(v);}if(rec){let branch=$('boneList').querySelector('[data-bone="'+id+'"]')?.closest('.bone-children');while(branch){branch.parentElement.open=true;branch=branch.parentElement.parentElement.closest('.bone-children');}}syncTransform();syncRigInspector();refresh();}
const treeOpen=new Map();
function renderBones(){
 const query=$('boneSearch').value.toLowerCase(), records=C.activeRecords(rig), list=$('boneList');
 list.replaceChildren();
 const add=(rec,container,depth)=>{
  const children=records.filter(r=>r.parent===rec.id);
  const branch=document.createElement('details');branch.className='bone-branch';branch.open=query?true:treeOpen.get(rec.id)??depth<2;
  const row=document.createElement(children.length?'summary':'div');if(!children.length)row.className='bone-leaf';
  if(children.length){const fold=document.createElement('span');fold.className='bone-fold';fold.textContent='›';fold.setAttribute('aria-hidden','true');row.append(fold);branch.addEventListener('toggle',()=>treeOpen.set(rec.id,branch.open));}
  const button=document.createElement('button');button.className='bone-row';button.dataset.id=rec.id;button.dataset.bone=rec.id;button.textContent=C.short(rec.name);button.title=rec.name;button.setAttribute('role','treeitem');button.setAttribute('aria-level',depth+1);button.setAttribute('aria-selected',String(rec.id===selected));button.classList.toggle('selected',rec.id===selected);button.onclick=e=>{e.preventDefault();selectUser(rec.id);};
  row.append(button);if(children.length){branch.append(row);const subtree=document.createElement('div');subtree.className='bone-children';subtree.role='group';children.forEach(r=>add(r,subtree,depth+1));branch.append(subtree);container.append(branch);}else container.append(row);
 };
 if(query){for(const rec of records.filter(r=>r.name.toLowerCase().includes(query))){const button=document.createElement('button');button.className='bone-row';button.dataset.id=rec.id;button.dataset.bone=rec.id;button.textContent=C.short(rec.name);button.onclick=()=>selectUser(rec.id);list.append(button);}}
 else records.filter(r=>!records.some(p=>p.id===r.parent)).forEach(r=>add(r,list,0));
 $('controlList').replaceChildren();
 for(const [name,group,side,id]of [['Thân','body',null,'rigBody'],['Tay trái','arms','left','rigArmLeft'],['Tay phải','arms','right','rigArmRight'],['Chân trái','legs','left','rigLegLeft'],['Chân phải','legs','right','rigLegRight'],['Ngón','fingers',null,'rigFingers']]){
  const defs=(editView.widgets||[]).filter(d=>d.group===group&&(!side||d.side===side)&&(!rig.activeRoot||d.id==='root'||d.chain?.root===rig.activeRoot||records.some(r=>r.id===d.id)));if(!defs.length)continue;
  const folder=document.createElement('details'),summary=document.createElement('summary'),eye=document.createElement('input');eye.type='checkbox';eye.dataset.visibility=id;eye.checked=$(id).checked;eye.title='Hiển thị '+name;eye.addEventListener('click',e=>e.stopPropagation());eye.onchange=()=>{$(id).checked=eye.checked;$(id).dispatchEvent(new Event('change'));};summary.append(document.createTextNode(name+' '),eye);folder.append(summary);
  for(const d of defs){const button=document.createElement('button');button.className='bone-row';button.dataset.id=d.id;button.textContent=d.label.replace(/^mixamorig[:_]?/i,'');button.title=d.kind==='ring'?'FK · Xoay và di chuyển khớp':d.kind==='pole'?'Pole · Di chuyển hướng gập':'IK / Root · Di chuyển và xoay';button.onclick=()=>{const changed=activateRigWidget(d);if(changed)commit();refresh();};folder.append(button);} $('controlList').append(folder);
 }

}
function syncTransform(force=false){if(!rig)return;const o=currentObject();if(!o)return;const world=$('space').value==='world',q=world?o.getWorldQuaternion(new T.Quaternion()):o.quaternion,p=world?o.getWorldPosition(new T.Vector3()):o.position,e=new T.Euler().setFromQuaternion(q,'XYZ');for(const [id,v]of Object.entries({rx:deg(e.x),ry:deg(e.y),rz:deg(e.z),px:p.x,py:p.y,pz:p.z,sx:scaleValues()[0],sy:scaleValues()[1],sz:scaleValues()[2]})){if(force||document.activeElement!==$(id))$(id).value=(Math.abs(v)<1e-8?0:v).toFixed(3);}const chain=rig.chains.find(c=>c.id===$('ikChain').value);if(chain)$('ikMode').value=chain.mode;$('scaleHelp').textContent=$('scaleTarget').value==='skin'?'Hình dáng mesh theo trục Local và weights của xương chọn; giữ nguyên khớp.':'1 = 100% so với Rest. Scale xương theo Local, ảnh hưởng mesh và xương con.';syncMotionPanel();}
function syncMotionPanel(){motionPanel?.sync();}
function timelineRate(){return $('timelineUnit').value==='ticks'?20:(sceneMode&&!sceneEditing?sceneProject.fps:project.fps);}
function syncTime(){if(sceneMode&&!sceneEditing){$('frameInput').value=Math.floor(sceneTime*timelineRate()+1e-7);$('timeReadout').textContent=sceneTime.toFixed(3)+' s';$('playBtn').textContent=scenePlaying?'Ⅱ Tạm dừng':'▶ Phát';return;}if(directorPending&&directorPanel){directorPanel.el('directorScrub').max=directorPending.showing.duration;directorPanel.el('directorScrub').value=time;}$('draftBadge').textContent=draft?'Pose chưa ghi key':'Pose đã ghi';$('draftBadge').classList.toggle('dirty',draft);$('frameInput').value=Math.floor(time*timelineRate()+1e-7);$('timelineUnitLabel').textContent=$('timelineUnit').value==='ticks'?'Tick':'Frame';$('frameInput').setAttribute('aria-label',$('timelineUnitLabel').textContent);$('prevFrame').textContent=$('timelineUnit').value==='ticks'?'−1t':'−1f';$('nextFrame').textContent=$('timelineUnit').value==='ticks'?'+1t':'+1f';$('timeReadout').textContent=time.toFixed(3)+' s';$('playBtn').textContent=$('uiLanguage').value==='en'?(playing?'Ⅱ Pause':'▶ Play'):(playing?'Ⅱ Tạm dừng':'▶ Phát');}
function syncProject(){$('inPlace').checked=!!project.inPlace;$('inPlaceExport').checked=!!project.inPlaceExport;syncLabPanel();$('clipName').value=project.name;$('duration').value=project.duration;$('fps').value=project.fps;$('loopA').value=+(project.loop[0]*timelineRate()).toFixed(3);$('loopB').value=+(project.loop[1]*timelineRate()).toFixed(3);renderPoses();drawTimeline();drawCurve();}
function seek(t,live=false){if(sceneMode&&!sceneEditing)return sceneSeek(t);if(sourcePreview){seekSourceClip(t);return;}if(!Number.isFinite(t))throw Error('Thời gian không hợp lệ.');time=T.MathUtils.clamp(t,0,(directorPending?.showing||project).duration);draft=false;C.evaluate(rig,directorPending?.showing||easingPreview?.project||project,time);$('draftBadge').textContent=$('uiLanguage').value==='en'?'Pose keyed':'Pose đã ghi';$('draftBadge').classList.remove('dirty');if(live){syncTransform();syncTime();drawTimeline();dirtyViews();}else refresh();}
function renderPoses(){$('poseList').replaceChildren();project.poses.forEach((pose,index)=>{const row=document.createElement('div');row.className='pose-item';const btn=document.createElement('button');btn.textContent=pose.name;btn.onclick=guard(()=>{if(pose.fingerprint!==rig.fingerprint)throw Error('Pose thuộc rig khác.');for(const[id,p]of Object.entries(pose.data)){const o=id==='root'?rig.root:record(rig,id)?.o;if(o)C.apply(o,p);}rig.root.updateMatrixWorld(true);markPose(null,Object.keys(pose.data));});const del=document.createElement('button');del.textContent='×';del.title='Xóa pose';del.onclick=()=>{project.poses.splice(index,1);commit();renderPoses();};const dup=document.createElement('button');dup.textContent='＋';dup.title='Nhân bản';dup.onclick=()=>{project.poses.push({...C.clone(pose),name:pose.name+' copy'});commit();renderPoses();};row.append(btn,dup,del);$('poseList').append(row);});}
async function install(r){window.__studio?.shot?.clear();directorCancel();endSourcePreview(false);assertEditingAllowed();cancelEasingPreview();easingPanel?.hide();smoothingPanel?.hide();studioMode='classic';studioBanks={classic:null,lab:null};$('studioMode').value='classic';stopTimelineScrub();endTimelineKeyDrag(true);playing=false;rig=r;mount(editView,r);setupIK(r);W.build(editView,r);for(const v of editViews.slice(1))bindSharedView(v);project=C.newProject(r);$('sourceUnits').value=/\.(fbx|mdx|mdl|skn)$/i.test(r.name)?'cm':'m';time=0;selected='root';selectionKeys=[];history=[];historyIndex=-1;draft=false;dirty=false;history.push(snapshot());historyIndex=0;renderBones();fillOptions($('rigSelect'),[['','Tất cả armature'],...r.armatures.map(a=>[a.id,a.name])]);fillOptions($('ikChain'),r.chains.map(c=>[c.id,c.label]));syncProject();select('root');applyViewportLayout();syncButtons();$('saveBtn').textContent='Lưu dự án';$('rigSummary').textContent=r.profile+' · '+r.records.length+' xương · '+r.mesh.length+' mesh · '+r.clips.length+' clip gốc\n'+r.warnings.join('\n');mapping={};info('Sẵn sàng · '+r.name+' · FK/IK, pose, keyframe. Clip gốc được giữ riêng để đối chiếu.');}
async function loadModel(bytes,name,skipConfirm=false,resources=[],companions=[]){const token=++importToken;const candidate=await parseAsset(bytes,name,false,resources,companions);if(token!==importToken){disposeObject(candidate.root);return;}if(!skipConfirm&&(dirty||Object.values(studioBanks).some(b=>b?.dirty))&&!confirm('Có thay đổi chưa lưu trong một hoặc cả hai chế độ. Thay model?')){disposeObject(candidate.root);return;}await install(candidate);}
function scaleValues(){if($('scaleTarget').value==='skin')return project?.skinAdjustments?.[selected]||[1,1,1];const rest=selected==='root'?rig?.rootRest.s:record(rig,selected)?.rest.s;return currentObject()?.scale.toArray().map((v,i)=>rest?.[i]?v/rest[i]:v)||[1,1,1];}
function numericPose(kind,finish=true,changedId){assertEditingAllowed();
 const skin=kind==='s'&&$('scaleTarget').value==='skin';if(!skin&&boneIKChain()){syncTransform();return;}
 const o=currentObject();if(!o)return;const beforeTransform=C.snap(o);if(kind==='s'&&(rig.controls[selected]||skin&&!record(rig,selected)?.weighted))return;
 const ids=kind==='q'?['rx','ry','rz']:kind==='s'?['sx','sy','sz']:['px','py','pz'];let vals=ids.map(id=>$(id).value.trim()===''?NaN:Number($(id).value));
 if(vals.some(v=>!Number.isFinite(v)))throw Error('Giá trị phải là số hữu hạn.');
 if(kind==='s'){
  if($('scaleUniform').checked&&changedId)vals=vals.map(()=>Number($(changedId).value));
  if(vals.some(v=>v<.05||v>5))throw Error('Tỉ lệ phải từ 0.05 đến 5.');
  if(skin){project.skinAdjustments||={};if(vals.every(v=>v===1))delete project.skinAdjustments[selected];else project.skinAdjustments[selected]=vals;S.apply(rig,project.skinAdjustments);}
  else{const rest=selected==='root'?rig.rootRest.s:record(rig,selected).rest.s;o.scale.fromArray(vals.map((v,i)=>v*rest[i]));}
  ids.forEach((id,i)=>{$(id).value=vals[i].toFixed(3);});
 }else if(kind==='q'){
  if(selected.startsWith('pole_'))return;
  const q=new T.Quaternion().setFromEuler(new T.Euler(...vals.map(rad),'XYZ'));if($('space').value==='world')C.setWorldQ(o,q);else o.quaternion.copy(q);
 }else{const point=new T.Vector3(...vals);if($('space').value==='world'&&o.parent)o.position.copy(o.parent.worldToLocal(point));else o.position.copy(point);}
 rig.root.updateMatrixWorld(true);if(rig.controls[selected]){const c=rig.chains.find(c=>selected.endsWith(c.id));if(c){if(kind==='q'&&selected==='ik_'+c.id)C.kinematics.preserveWristPivot(c,o,beforeTransform);if(!(kind==='q'&&selected==='ik_'+c.id&&c.options.wristPivot))constrainControl(c,selected);}}if(!skin)for(const c of rig.chains)if(c.mode==='ik')solvePoseIK(c);if(!skin)constrainPose([selected]);
 if(finish){if(skin){onion.clear();commit();refresh();}else markPose();}else{playing=false;dirtyViews();}syncTransform(true);
}

function resetPose(scope){assertEditingAllowed();for(const id of activeIds(scope)){const r=record(rig,id),ctrl=rig.controls[id];C.apply(id==='root'?rig.root:r?.o||ctrl?.object,id==='root'?rig.rootRest:r?.rest||ctrl.rest);}for(const c of rig.chains)c.mode='fk';rig.root.updateMatrixWorld(true);markPose(null,activeIds(scope));}
function labGroupRefs(group,t){
 const all=C.bodyKeyRefs(rig,project,t),chain=rig.chains.find(c=>c.id===group),limbs=new Set(rig.chains.flatMap(c=>C.descendants(rig,c.a.id).map(r=>r.id))),ids=chain?new Set(C.descendants(rig,chain.a.id).map(r=>r.id)):new Set(['root',...C.activeRecords(rig).filter(r=>!limbs.has(r.id)).map(r=>r.id)]);
 if(chain){ids.add('ik_'+chain.id);ids.add('pole_'+chain.id);}
 return all.filter(r=>r.kind==='keys'?ids.has(r.id):!!chain&&r.id===chain.id);
}
function timelineRows(){const ids=new Set($('animationEditor').value!=='dope'&&$('timelineStyle').value==='focus'?[selected]:[selected,...Object.keys(project.keys)]);const rows=[...ids].filter(id=>id==='root'||record(rig,id)||rig.controls[id]).map(id=>({id,name:C.short(record(rig,id)?.name||rig.controls[id]?.object.name||'Root'),keys:project.keys[id]||[]}));if(project.lab){const groups=[['body','Thân / Root'],...rig.chains.filter(c=>!rig.activeRoot||c.root===rig.activeRoot).map(c=>[c.id,c.label])];for(const[group,label]of groups.reverse()){const times=[...new Set(labGroupRefs(group).map(r=>r.time))].sort((a,b)=>a-b);rows.unshift({id:'labGroup_'+group,name:label,keys:times.map(time=>({time}))});}}if($('keySelectionScope').value==='body'){const times=[...new Set(C.bodyKeyRefs(rig,project).map(r=>r.time))].sort((a,b)=>a-b);rows.unshift({id:'allBody',name:'All Body',keys:times.map(time=>({time}))});}return rows;}
function canvasSize(canvas,h,measuredWidth){const width=measuredWidth||Math.max(250,canvas.parentElement.clientWidth||800),ratio=Math.min(devicePixelRatio,1.5);if(canvas.width!==Math.floor(width*ratio))canvas.width=Math.floor(width*ratio);if(canvas.height!==Math.floor(h*ratio))canvas.height=Math.floor(h*ratio);canvas.style.height=h+'px';canvas.style.width=width+'px';const ctx=canvas.getContext('2d');ctx.setTransform(ratio,0,0,ratio,0,0);return{ctx,width};}
const timelinePresets={
 classic:{row:28,key:6,font:10,band:true,description:'Classic · Dải từ key đầu đến key cuối, key hình thoi và hàng xen kẽ. Dải chỉ biểu thị phạm vi có key.'},
 dope:{row:30,key:7,font:11,description:'Dope Sheet · Key hình thoi nổi trên lưới, dễ so sánh thời điểm của nhiều khớp.'},
 focus:{row:48,key:9,font:12,band:true,description:'Focus · Chỉ hiện khớp đang chọn với hàng lớn. Các key của khớp khác vẫn được giữ.'},
 compact:{row:20,key:4,font:9,description:'Compact · Hàng thấp và key tròn nhỏ để xem nhiều khớp trong diện tích hẹp.'},
 touch:{row:44,key:10,font:12,description:'Touch · Hàng rộng và key lớn, dễ bấm trên màn hình cảm ứng.'}
};
let timelineHits=[];
function drawTimeline(){
 if(!project)return;
 const style=$('animationEditor').value==='dope'?'dope':$('timelineStyle').value,preset=timelinePresets[style],rows=$('animationEditor').value==='graph'?[]:timelineRows(),ticks=$('showMinecraftTicks').checked;
 const height=Math.max(70,rows.length*preset.row),ruler=canvasSize($('timelineRuler'),ticks?44:22),{ctx,width}=canvasSize($('timeline'),height,ruler.width),rc=ruler.ctx,left=130,span=width-left-12;
 const colors=getComputedStyle(document.body),color=n=>colors.getPropertyValue(n).trim(),bg=color('--bg'),panel=color('--panel'),line=color('--line'),text=color('--text'),muted=color('--muted'),accent=color('--accent');
 timelineHits=[];ctx.fillStyle=bg;ctx.fillRect(0,0,width,height);rc.fillStyle=panel;rc.fillRect(0,0,width,ticks?44:22);
 ctx.font=preset.font+'px Segoe UI';rc.font='10px Segoe UI';
 rows.forEach((r,i)=>{ctx.fillStyle=i%2?panel:bg;ctx.fillRect(0,i*preset.row,width,preset.row);ctx.strokeStyle=line;ctx.beginPath();ctx.moveTo(0,(i+1)*preset.row-.5);ctx.lineTo(width,(i+1)*preset.row-.5);ctx.stroke();});
 const rulerRow=(rate,y,label,suffix)=>{
  rc.fillStyle=text;rc.textAlign='left';rc.fillText(label,7,y+15);
  const total=project.duration*rate,desired=total/Math.max(1,Math.floor(span/65)),power=10**Math.floor(Math.log10(Math.max(1,desired))),step=[1,2,5,10].map(n=>n*power).find(n=>n>=desired),minor=step>=5?step/5:step;
  for(let unit=0;unit<=total+1e-8;unit+=minor){const x=left+span*unit/total,major=Math.abs(unit/step-Math.round(unit/step))<1e-7;
   rc.strokeStyle=line;rc.beginPath();rc.moveTo(x,y+(major?17:19));rc.lineTo(x,y+22);rc.stroke();
   if(major){rc.fillStyle=muted;rc.textAlign=x>width-42?'right':x===left?'left':'center';rc.fillText(Math.round(unit)+suffix,x,y+13);if(rate===project.fps){ctx.strokeStyle=line;ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,height);ctx.stroke();}}
  }
 };
 if(ticks)rulerRow(20,0,'Minecraft Tick','t');rulerRow(project.fps,ticks?22:0,'Frame · '+project.fps+' FPS','f');
 rc.textAlign='left';ctx.textAlign='left';
 rows.forEach((r,i)=>{
  const y=(i+.5)*preset.row;ctx.fillStyle=r.id===selected?accent:muted;ctx.fillText(r.name.slice(0,preset.font>10?16:19),7,y+4);
  ctx.save();ctx.beginPath();ctx.rect(left-11,0,span+23,height);ctx.clip();
  if(preset.band&&r.keys.length>1){const a=left+span*r.keys[0].time/project.duration,b=left+span*r.keys.at(-1).time/project.duration;ctx.fillStyle=accent;ctx.globalAlpha=.2;ctx.fillRect(a,y-7,b-a,14);ctx.globalAlpha=1;}
  for(const key of r.keys){const groupSelected=r.id.startsWith('labGroup_')&&labGroupRefs(r.id.slice(9),key.time).some(ref=>selectionKeys.some(s=>(s.kind||'keys')===ref.kind&&s.id===ref.id&&Math.abs(s.time-ref.time)<1e-7));const preview=timelineKeyDrag?.active&&selectionKeys.some(s=>(r.id==='allBody'||groupSelected||(s.kind||'keys')==='keys'&&s.id===r.id)&&Math.abs(s.time-key.time)<1e-7)?timelineKeyDrag.delta:0;const x=left+span*(key.time+preview)/project.duration,k=preset.key,chosen=selectionKeys.some(s=>(r.id==='allBody'||(s.kind||'keys')==='keys'&&s.id===r.id)&&Math.abs(s.time-key.time)<1e-7);
   ctx.fillStyle=chosen?'#eebc51':r.id===selected?accent:'#82a9e8';ctx.beginPath();
   if(style==='compact')ctx.arc(x,y,k,0,Math.PI*2);else{ctx.moveTo(x,y-k);ctx.lineTo(x+k,y);ctx.lineTo(x,y+k);ctx.lineTo(x-k,y);ctx.closePath();}ctx.fill();timelineHits.push({id:r.id,time:key.time,x,y,radius:k+4});
  }ctx.restore();
 });
 const x=left+span*time/project.duration;for(const[c,h]of [[ctx,height],[rc,ticks?44:22]]){c.strokeStyle='#e78672';c.beginPath();c.moveTo(x,0);c.lineTo(x,h);c.stroke();}
 rc.fillStyle='#e78672';rc.beginPath();rc.moveTo(x-4,0);rc.lineTo(x+4,0);rc.lineTo(x,6);rc.closePath();rc.fill();
 $('timeline').dataset.rowHeight=preset.row;$('timeline').dataset.preset=style;
 $('timelineRuler').setAttribute('aria-valuemax',project.duration);$('timelineRuler').setAttribute('aria-valuenow',time);$('timelineRuler').setAttribute('aria-valuetext',Math.round(time*project.fps)+' frame, '+(time*20).toFixed(2)+' tick');
}
function seekTimeline(x,width,rate,live=false){if(sceneMode&&!sceneEditing){sceneSeek(Math.round(T.MathUtils.clamp((x-130)/(width-142),0,1)*sceneProject.duration*rate)/rate);return;}playing=false;const next=T.MathUtils.clamp(Math.round(T.MathUtils.clamp((x-130)/(width-142),0,1)*project.duration*rate)/rate,0,project.duration);if(next!==time||draft)seek(next,live);else syncTime();}
let timelineDrag=null,timelinePending=null,timelineSuppressClick=false;
function flushTimelineScrub(){
 const pending=timelinePending;timelinePending=null;if(!pending||!timelineDrag)return;
 const rect=timelineDrag.element.getBoundingClientRect();seekTimeline(pending.x-rect.left,rect.width,timelineDrag.rate,true);
}
function stopTimelineScrub(){
 const drag=timelineDrag;timelineDrag=null;timelinePending=null;if(!drag)return;
 timelineSuppressClick=drag.active;drag.element.classList.remove('is-scrubbing');if(drag.element.hasPointerCapture(drag.pointer))drag.element.releasePointerCapture(drag.pointer);
}
for(const id of ['timelineRuler','timeline']){
 listen(id,'pointerdown',e=>{
  if(e.button!==0||!e.isPrimary||timelineDrag||!project)return;
  const el=$(id),rect=el.getBoundingClientRect(),x=e.clientX-rect.left,y=e.clientY-rect.top;
  timelineSuppressClick=false;if(x<130||id==='timeline'&&timelineHits.some(h=>Math.hypot(x-h.x,y-h.y)<h.radius))return;
  const active=e.pointerType!=='touch';timelineDrag={element:el,pointer:e.pointerId,rate:id==='timelineRuler'&&$('showMinecraftTicks').checked&&y<22?20:timelineRate(),x:e.clientX,y:e.clientY,active};
  el.setPointerCapture(e.pointerId);if(active){playing=false;syncTime();timelinePending={x:e.clientX};el.classList.add('is-scrubbing');el.focus({preventScroll:true});e.preventDefault();}
 });
 listen(id,'pointermove',e=>{
  const drag=timelineDrag;if(!drag||drag.pointer!==e.pointerId)return;
  if(!drag.active){const dx=Math.abs(e.clientX-drag.x),dy=Math.abs(e.clientY-drag.y);if(dx<5||dx<=dy)return;drag.active=true;playing=false;syncTime();drag.element.classList.add('is-scrubbing');}
  timelinePending={x:e.clientX};e.preventDefault();
 });
 listen(id,'pointerup',e=>{if(timelineDrag?.pointer!==e.pointerId)return;if(timelineDrag.active){timelinePending={x:e.clientX};flushTimelineScrub();}stopTimelineScrub();});
 for(const event of ['pointercancel','lostpointercapture'])listen(id,event,e=>{if(timelineDrag?.pointer===e.pointerId)stopTimelineScrub();});
 listen(id,'keydown',e=>{if(e.key==='Escape'&&timelineDrag){e.preventDefault();stopTimelineScrub();}});
}
window.addEventListener('blur',stopTimelineScrub);
document.addEventListener('visibilitychange',()=>{if(document.hidden)stopTimelineScrub();});
function drawCurve(){graphEditor?.draw();}


function mirror(){assertEditingAllowed();const data=new Map(rig.records.map(r=>[r.id,{q:r.o.getWorldQuaternion(new T.Quaternion()),p:C.snap(r.o)}]));const swap=n=>/Left|Right/.test(n)?n.replace(/Left|Right/g,x=>x==='Left'?'Right':'Left'):/\.[LR]$/.test(n)?n.slice(0,-1)+(n.endsWith('L')?'R':'L'):n;
 for(const dst of rig.records){const source=rig.records.find(r=>r.name===swap(dst.name));if(!source)continue;const delta=data.get(source.id).q.clone().multiply(new T.Quaternion().fromArray(source.worldQ).invert());delta.set(delta.x,-delta.y,-delta.z,delta.w);const desired=delta.multiply(new T.Quaternion().fromArray(dst.worldQ));C.setWorldQ(dst.o,desired);const p=data.get(source.id).p.p,rest=source.rest.p;dst.o.position.fromArray(dst.rest.p).add(new T.Vector3(-(p[0]-rest[0]),p[1]-rest[1],p[2]-rest[2]));}
 rig.root.updateMatrixWorld(true);markPose(null,C.activeRecords(rig).map(r=>r.id));info('Đã mirror theo cặp trái/phải và hướng rest; kiểm tra pose trước khi ghi key.');}
function keyOperation(action,targetTime=Number($('keyFrame').value)/timelineRate()){assertEditingAllowed();
 const result=C.editKeyframes(project,selectionKeys,action,targetTime,$('interpolation').value,Number($('easingStrength').value)/100);
 project=result.project;selectionKeys=result.selection;playing=false;draft=false;C.evaluate(rig,project,time);commit();refresh();
}
function selectTimelineHit(hit,additive=false){
 cancelEasingPreview();
 const grouped=hit.id.startsWith('labGroup_'),refs=grouped?labGroupRefs(hit.id.slice(9),hit.time):hit.id==='allBody'||$('keySelectionScope').value==='body'?C.bodyKeyRefs(rig,project,hit.time):[{kind:'keys',id:hit.id,time:hit.time}];
 if(!additive)selectionKeys=[];
 const chosen=refs.every(r=>selectionKeys.some(s=>(s.kind||'keys')===r.kind&&s.id===r.id&&Math.abs(s.time-r.time)<1e-7));
 if(chosen)selectionKeys=selectionKeys.filter(s=>!refs.some(r=>(s.kind||'keys')===r.kind&&s.id===r.id&&Math.abs(s.time-r.time)<1e-7));else for(const r of refs)if(!selectionKeys.some(s=>(s.kind||'keys')===r.kind&&s.id===r.id&&Math.abs(s.time-r.time)<1e-7))selectionKeys.push(r);
 if(hit.id!=='allBody'&&!grouped)select(hit.id);$('keyFrame').value=+(hit.time*timelineRate()).toFixed(3);
 const key=project.keys[hit.id]?.find(k=>Math.abs(k.time-hit.time)<1e-7);if(key){$('interpolation').value=key.interp;$('easingStrength').value=Math.round((key.easingStrength??1)*100);}drawTimeline();easingPanel?.sync();
}
let timelineKeyDrag=null;
function endTimelineKeyDrag(cancel=false){
 const drag=timelineKeyDrag;if(!drag)return;timelineKeyDrag=null;
 if(cancel&&drag.active)selectionKeys=drag.selection;
 if($('timeline').hasPointerCapture(drag.pointer))$('timeline').releasePointerCapture(drag.pointer);
 $('timeline').classList.remove('is-key-dragging');if(drag.active){timelineSuppressClick=true;$('keyFrame').value=drag.frame;drawTimeline();}
}
listen('timeline','pointerdown',e=>{
 if(e.button!==0||!e.isPrimary||timelineKeyDrag||!project)return;
 const rect=$('timeline').getBoundingClientRect(),x=e.clientX-rect.left,y=e.clientY-rect.top,hit=timelineHits.find(h=>Math.hypot(x-h.x,y-h.y)<h.radius);if(!hit)return;
 timelineKeyDrag={pointer:e.pointerId,start:e.clientX,hit,selection:C.clone(selectionKeys),frame:$('keyFrame').value,active:false,delta:0,paint:false,additive:e.ctrlKey||e.shiftKey};$('timeline').setPointerCapture(e.pointerId);e.preventDefault();
});
listen('timeline','pointermove',e=>{
 const d=timelineKeyDrag;if(!d||d.pointer!==e.pointerId)return;
 if(!d.active){if(Math.abs(e.clientX-d.start)<4)return;const contains=selectionKeys.some(s=>(d.hit.id==='allBody'||d.hit.id.startsWith('labGroup_')&&labGroupRefs(d.hit.id.slice(9),d.hit.time).some(r=>r.id===s.id&&r.kind===(s.kind||'keys'))||s.id===d.hit.id)&&Math.abs(s.time-d.hit.time)<1e-7);if(!contains)selectTimelineHit(d.hit,d.additive);d.active=true;playing=false;$('timeline').classList.add('is-key-dragging');}
 d.delta=Math.round((e.clientX-d.start)/Math.max(1,$('timeline').clientWidth-142)*project.duration*timelineRate())/timelineRate();d.paint=true;$('keyFrame').value=+((Math.min(...selectionKeys.map(k=>k.time))+d.delta)*timelineRate()).toFixed(3);e.preventDefault();
});
listen('timeline','pointerup',e=>{
 const d=timelineKeyDrag;if(!d||d.pointer!==e.pointerId)return;if(!d.active){endTimelineKeyDrag();return;}
 const target=Math.min(...selectionKeys.map(k=>k.time))+d.delta;endTimelineKeyDrag();
 try{if(Math.abs(d.delta)>1e-7)keyOperation('move',target);}catch(error){selectionKeys=d.selection;drawTimeline();throw error;}
});
for(const event of ['pointercancel','lostpointercapture'])listen('timeline',event,()=>endTimelineKeyDrag(true));
window.addEventListener('blur',()=>endTimelineKeyDrag(true));

function applyLabLayout(){const active=studioMode==='lab'&&mode!=='compare';$('labLayoutControl').hidden=!active;$('motionLayerToggle').hidden=!active;$('motionLayerToggle').setAttribute('aria-pressed',String($('motionLayerFloating').checked));syncMotionPanel();$('createWorkspace').classList.toggle('lab-blender',true);editView.dirty=true;}
function setMode(m){if(m==='compare'&&sceneMode)sceneExit();endSourcePreview(false);if(m==='create')m='rig';$('texturePanel').hidden=true;textureToken++;if(m==='compare'){if(editorSlots.B)editorSlots.B.playing=false;cancelEasingPreview();easingPanel?.hide();smoothingPanel?.hide();if(rigDrag)cancelRigDrag();endTimelineKeyDrag(true);importToken++;targetToken++;}stopTimelineScrub();cancelAreaResize();persistLayout();maximizeArea(null);mode=m;playing=false;lockCompareEditing();$('createWorkspace').hidden=m==='compare';$('compareWorkspace').hidden=m!=='compare';$('createWorkspace').classList.toggle('control-mode',m==='rig');$('rigTools').hidden=m!=='rig';$('controlTree').hidden=m!=='rig';$('rigInspector').hidden=m!=='rig';$('viewportModeTag').textContent=m==='rig'?'CONTROL RIG':studioMode==='lab'?'ANIMATION LAB':'POSE EDITOR';$('labPanel').hidden=studioMode!=='lab'||m==='compare';$('labClipLane').hidden=studioMode!=='lab'||m==='compare';$('modeCreate').classList.toggle('active',m==='create');$('modeRig').classList.toggle('active',m==='rig');$('modeCompare').classList.toggle('active',m==='compare');applyWorkspaceLayout();if(m!=='compare')select(selected);applyLabLayout();refresh();if(m==='compare'){resizeCompare(compareHeight);renderComparison();}syncMinimalUI();}
function setupViewPreset(v,preset){if(preset==='front')v.camera.position.set(0,1,5);else if(preset==='back')v.camera.position.set(0,1,-5);else if(preset==='side')v.camera.position.set(5,1,0);else if(preset==='left')v.camera.position.set(-5,1,0);else if(preset==='top')v.camera.position.set(0,6,.001);else if(preset==='bottom')v.camera.position.set(0,-4,.001);else v.camera.position.set(2,1.65,3.3);if(v.edit||v.displayUp==='z')C.kinematics.blenderPoint(v.camera.position);v.camera.zoom=1;v.camera.updateProjectionMatrix();v.orbit.target.set(0,v.edit||v.displayUp==='z'?0:1,v.edit||v.displayUp==='z'?1:0);v.orbit.update();v.dirty=true;}
function exportSkeleton(root,skin){let result;if(skin){result=cloneSkeleton(root);const meshes=[];root.traverse(o=>{if(o.isMesh)meshes.push(o);});let index=0;result.traverse(o=>{if(o.isMesh)o.material=V.sourceMaterial(meshes[index++]);});}else{const copy=o=>{const n=o.isBone?new T.Bone():new T.Group();n.name=o.name;n.position.copy(o.position);n.quaternion.copy(o.quaternion);n.scale.copy(o.scale);n.userData=C.clone(o.userData);for(const c of o.children)n.add(copy(c));return n;};result=copy(root);}let unnamed=0;result.traverse(o=>{if(!o.name?.trim())o.name=o===result?'AuxScene':`${o.isBone?'Bone':'Node'}_${unnamed++}`;});return result;}
function finalizeGLB(buffer,r,skin){
 const view=new DataView(buffer),len=view.getUint32(12,true),json=JSON.parse(new TextDecoder().decode(new Uint8Array(buffer,20,len)));
 const joints=r.records.map(rec=>json.nodes.findIndex(n=>n.name===rec.name));if(joints.some(x=>x<0)||new Set(joints).size!==r.records.length)throw Error('Không xác định duy nhất tất cả joints. Kiểm tra tên trùng.');
 if(!skin)json.skins=[{name:r.profile+' skeleton',joints,skeleton:joints[0]}];
 json.extras={app:'Animation Studio 1.20.0',profile:r.profile,rigFingerprint:r.fingerprint,bakeFps:project.fps,sourceUnits:/\.fbx$/i.test(r.name)?'cm (assumed)':'m (glTF)'};
 const text=new TextEncoder().encode(JSON.stringify(json)),size=Math.ceil(text.length/4)*4,rest=new Uint8Array(buffer,20+len),out=new Uint8Array(20+size+rest.length),dv=new DataView(out.buffer);dv.setUint32(0,0x46546c67,true);dv.setUint32(4,2,true);dv.setUint32(8,out.length,true);dv.setUint32(12,size,true);dv.setUint32(16,0x4e4f534a,true);out.fill(32,20,20+size);out.set(text,20);out.set(rest,20+size);return out.buffer;
}
async function chosenTarget(){const choice=$('exportProfile').value;if(choice==='same')return null;if(choice==='Mixamo'){if(rig.profile==='Mixamo'&&C.activeRecords(rig).length===65)return null;if(!targetRig||targetRig.profile!=='Mixamo'){targetRig=await parseAsset(sampleBytes(),'Mixamo T-Pose.fbx');mapping=C.suggestMapping(rig,targetRig);}}else{if(!targetRig||targetRig.profile!=='Metarig')throw Error('Cần nhập file Metarig đích đúng mẫu (FBX / GLB).');}
 if(choice==='Mixamo'&&targetRig.records.length!==65)throw Error('Rig Mixamo đích phải có đúng 65 xương.');return targetRig;}
async function buildGLB(){assertEditingAllowed();if(directorPending)throw Error('Áp dụng hoặc hủy bản chỉnh Director trước khi xuất.');
 if(!Object.values(project.keys).some(k=>k.length)&&!project.lab?.layers.some(l=>Object.values(l.keys||{}).some(k=>k.length))&&!Object.values(project.lab?.base?.keys||{}).some(k=>k.length))throw Error('Chưa có keyframe. Ghi ít nhất một key trước khi xuất.');
 const saved=snapshot(),dest=await chosenTarget(),skin=$('includeSkin').checked;if(dest&&skin)throw Error('Chuyển profile chỉ xuất skeleton + animation. Tắt Kèm mesh / skin.');
 if(rig.roots.length>1&&!rig.activeRoot)throw Error('File có nhiều armature. Chọn một armature trước khi xuất.');if(dest&&Object.keys(mapping).length===0)mapping=C.suggestMapping(rig,dest);
 if(dest){const requiredNames=new Set(['hips','head','neck','spine','spine1','spine2','leftarm','rightarm','leftforearm','rightforearm','lefthand','righthand','leftupleg','rightupleg','leftleg','rightleg','leftfoot','rightfoot','upperarml','upperarmr','forearml','forearmr','handl','handr','thighl','thighr','shinl','shinr','footl','footr','spine005','spine006']);const required=dest.records.filter(r=>requiredNames.has(C.canon(r.name)));const missing=required.filter(r=>!mapping[r.id]);if(missing.length)throw Error('Mapping thiếu khớp chính: '+missing.map(r=>r.name).join(', '));}
 const source=dest||rig;C.resetRig(source);const outRoot=exportSkeleton(source.root,skin);
 if(source.activeRoot){const clonedBones=[];outRoot.traverse(o=>{if(o.isBone)clonedBones.push(o);});const allowedSource=new Set(C.descendants(source,source.activeRoot).map(r=>r.id)),allowedClones=new Set(clonedBones.filter((b,i)=>allowedSource.has(source.records[i].id)));outRoot.traverse(o=>{if(o.isSkinnedMesh&&!o.skeleton.bones.some(b=>allowedClones.has(b)))o.userData.dropOtherRig=true;});const drop=[];outRoot.traverse(o=>{if((o.isBone&&!allowedClones.has(o))||o.userData.dropOtherRig)drop.push(o);});for(const o of drop)o.removeFromParent();}
 const outRig=C.makeRig(outRoot,source.name),container=new T.Group();container.name='AnimationStudioUnits';
 // shortcut: FBX đầu vào mặc định cm; xác nhận đơn vị khi dùng FBX không theo chuẩn này.
 container.scale.setScalar(dest?(/\.fbx$/i.test(source.name)?.01:1):$('sourceUnits').value==='cm'?.01:1);container.add(outRoot);if($('exportAxis').value==='blender')container.quaternion.copy(C.kinematics.blenderBasis);container.userData.axisSystem=$('exportAxis').value;container.updateMatrixWorld(true);
 const start=$('exportRange').value==='loop'?project.loop[0]:0,end=$('exportRange').value==='loop'?project.loop[1]:project.duration;if(end<=start)throw Error('Đoạn xuất không hợp lệ.');
 const samples=Math.ceil((end-start)*project.fps),times=Array.from({length:samples+1},(_,i)=>Math.min(end,start+i/project.fps));const unique=[...new Set(times)];const arrays=new Map([...outRig.records.map(r=>[r.id,{p:[],q:[],s:[]}]),['root',{p:[],q:[],s:[]}]]);
 try{for(const t of unique){C.evaluate(rig,project,t,{inPlace:!!project.inPlaceExport});if(dest){C.retarget(rig,outRig,mapping);}else{for(const r of outRig.records){const sourceRecord=source.activeRoot?C.descendants(source,source.activeRoot)[Number(r.id.slice(1))]:record(rig,r.id);C.apply(r.o,C.snap(sourceRecord.o));}C.apply(outRoot,C.snap(rig.root));}for(const [id,a]of arrays){const o=id==='root'?outRoot:record(outRig,id).o;const p=C.snap(o);if([...p.p,...p.q,...p.s].some(v=>!Number.isFinite(v)||Math.abs(v)>3.402823466e38))throw Error('Transform vượt giới hạn Float32 khi xuất: '+o.name);a.p.push(...p.p);a.q.push(...p.q);a.s.push(...p.s);}}
 C.resetRig(outRig);container.updateMatrixWorld(true);const relative=unique.map(t=>t-start),tracks=[];for(const[id,a]of arrays){const o=id==='root'?outRoot:record(outRig,id).o;tracks.push(new T.VectorKeyframeTrack(o.uuid+'.position',relative,a.p),new T.QuaternionKeyframeTrack(o.uuid+'.quaternion',relative,a.q),new T.VectorKeyframeTrack(o.uuid+'.scale',relative,a.s));}
 const clip=new T.AnimationClip(project.name,end-start,tracks),buffer=await new GLTFExporter().parseAsync(container,{binary:true,onlyVisible:false,animations:[clip],trs:true});const data=finalizeGLB(buffer,outRig,skin);return{data,profile:outRig.profile,bones:outRig.records.length,frames:unique.length,start,end};}
 finally{project=saved.project;time=saved.time;C.evaluate(rig,project,time);for(const[id,p]of Object.entries(saved.pose))C.apply(id==='root'?rig.root:rig.controls[id]?.object||record(rig,id).o,p);for(const[id,o]of saved.options||[])C.kinematics.configure(rig,rig.chains.find(c=>c.id===id),o,false);for(const[id,p]of Object.entries(saved.controls))C.apply(rig.controls[id].object,p);for(const[id,m]of saved.modes)rig.chains.find(c=>c.id===id).mode=m;draft=saved.draft;outRoot.removeFromParent();container.clear();refresh();}
}
function bridgeScript(name,format){
 const lines=['# Chạy trong phiên Blender mới: blender --background --factory-startup --python script.py','import bpy, math','from pathlib import Path','p = Path(__file__).resolve().parent','source = p / '+JSON.stringify(name+'.glb'),'target = p / '+JSON.stringify(name+(format==='fbx'?'.fbx':'.blend')),'if not source.exists():','    raise FileNotFoundError(source)','if target.exists():','    raise FileExistsError("Output exists; rename it explicitly: " + str(target))','bpy.ops.wm.read_factory_settings(use_empty=True)','bpy.context.scene.render.fps = '+project.fps,'bpy.ops.import_scene.gltf(filepath=str(source))','if not bpy.data.actions:','    raise RuntimeError("Imported file has no animation")','bpy.context.scene.frame_start = math.floor(min(a.frame_range[0] for a in bpy.data.actions))','bpy.context.scene.frame_end = math.ceil(max(a.frame_range[1] for a in bpy.data.actions))'];
 if($('exportAxis').value==='blender')lines.push('from mathutils import Matrix','basis = Matrix.Rotation(-math.pi / 2, 4, "X")','for o in list(bpy.context.scene.objects):','    if o.parent is None:','        o.matrix_world = basis @ o.matrix_world');
 if(format==='fbx')lines.push('shapes = {b.custom_shape for o in bpy.context.scene.objects if o.type == "ARMATURE" for b in o.pose.bones if b.custom_shape}','bpy.ops.object.select_all(action="DESELECT")','for o in bpy.context.scene.objects:','    o.select_set(o not in shapes)','bpy.ops.export_scene.fbx(filepath=str(target), use_selection=True, add_leaf_bones=False, bake_anim=True, bake_anim_use_all_actions=False, bake_anim_use_nla_strips=False, axis_up='+JSON.stringify($('exportAxis').value==='minecraft'?'Y':'Z')+', axis_forward='+JSON.stringify($('exportAxis').value==='minecraft'?'-Z':'-Y')+')');
 else lines.push('bpy.ops.wm.save_as_mainfile(filepath=str(target))');
 lines.push('print("Exported", target)');return lines.join('\n')+'\n';
}
let directExportPending=false;
async function buildDirectAnimation(format){
 if(directExportPending)throw Error('Đang xuất animation.');assertEditingAllowed();directExportPending=true;
 const exportAxis=$('exportAxis').value,includeSkin=$('includeSkin').checked,wasPlaying=playing,locked=[$('createWorkspace'),document.querySelector('header')].map(element=>[element,!!element.inert]);playing=false;for(const[element]of locked)element.inert=true;
 try{if(format==='bobj')$('exportAxis').value='minecraft';if(format!=='bobj')$('includeSkin').checked=false;const glb=await buildGLB();if(format==='bobj')return{...glb,frames:Math.ceil((glb.end-glb.start)*20)+1,data:await exportBOBJ(glb.data,project.fps,{includeMesh:includeSkin,up:$('exportAxis').value==='blender'?'z':'y',flipUV:/\.(glb|mdx|mdl)$/i.test(rig.name)})};const animation=await AnimationExport.bake(glb.data,project.fps);return{...glb,data:format==='bvh'?AnimationExport.bvh(animation):AnimationExport.fbx(animation,$('exportAxis').value==='blender'?'z':'y'),animation};}
 finally{$('exportAxis').value=exportAxis;$('includeSkin').checked=includeSkin;for(const[element,value]of locked)element.inert=value;playing=wasPlaying;lastStamp=performance.now();directExportPending=false;syncTime();}
}
function syncExportFormat(){const direct=['fbx-direct','bvh'].includes($('exportFormat').value),skin=$('includeSkin');if(direct){if(skin.dataset.beforeDirect===undefined)skin.dataset.beforeDirect=String(skin.checked);skin.checked=false;}else if(skin.dataset.beforeDirect!==undefined){skin.checked=skin.dataset.beforeDirect==='true';delete skin.dataset.beforeDirect;}skin.disabled=direct;const axis=$('exportAxis'),isBOBJ=$('exportFormat').value==='bobj';axis.disabled=isBOBJ;if(isBOBJ)axis.value='minecraft';if(isBOBJ)$('exportNote').textContent='BOBJ/BBS luôn xuất Y-up · tick nguyên, 20 mẫu/giây · Euler tương đương Blender XYZ · texture gán riêng. Thời lượng làm tròn lên tối đa 1 tick.';if(direct)$('exportNote').textContent='Chỉ xương + animation — không mesh/texture. BVH không hỗ trợ Scale động.';}
async function doExport(){const format=$('exportFormat').value,name=safeName();if(format==='bobj'){const result=await buildDirectAnimation('bobj');download(result.data,name+'.bobj','text/plain');$('exportNote').textContent=result.bones+' xương · '+result.frames+' mẫu · BOBJ, Y-up, 20 tick/giây, Euler ZYX'+($('includeSkin').checked?' · kèm mesh/skin':' · chỉ xương + animation')+' · texture gán riêng';info('Đã xuất BOBJ.');return;}if(format==='fbx-direct'||format==='bvh'){const extension=format==='bvh'?'bvh':'fbx',result=await buildDirectAnimation(extension);download(result.data,name+'.'+extension,extension==='fbx'?'application/octet-stream':'text/plain');$('exportNote').textContent=result.bones+' xương · '+result.frames+' mẫu · '+project.fps+' FPS · chỉ xương + animation, không mesh/texture'+(extension==='bvh'?($('exportAxis').value==='blender'?' · Blender nhập BVH: Forward Y, Up Z':' · Blender nhập BVH: Forward -Z, Up Y'):'');info('Đã xuất '+extension.toUpperCase()+' trực tiếp.');return;}const data=await buildGLB();download(data.data,name+'.glb','model/gltf-binary');if(format!=='glb')download(bridgeScript(name,format),name+'_to_'+format+'_Blender.py','text/x-python');$('exportNote').textContent=data.bones+' joints · '+data.frames+' mẫu · '+project.fps+' FPS · '+data.profile+(format==='glb'?' · GLB đã tạo':' · đặt GLB và script cùng thư mục; chạy trong Blender để tạo '+format);info('Đã tạo GLB'+(format==='glb'?'':' và script Blender')+'.');}
function openMapping(){chosenTarget().then(dest=>{if(!dest){info('Giữ cùng rig không cần mapping.');return;}if(!Object.keys(mapping).length)mapping=C.suggestMapping(rig,dest);$('mappingList').replaceChildren();for(const d of dest.records){const row=document.createElement('div');row.className='mapping-row';const label=document.createElement('span');label.textContent=d.name;const select=document.createElement('select');select.append(createOption('','Giữ rest · chưa ghép'),...rig.records.map(r=>createOption(r.id,r.name)));select.value=mapping[d.id]||'';select.onchange=()=>{if(select.value)mapping[d.id]=select.value;else delete mapping[d.id];};row.append(label,select);$('mappingList').append(row);}$('mappingDialog').showModal();}).catch(e=>info(e.message,true));}
async function saveProject(){assertEditingAllowed();cancelEasingPreview();const data=C.clone(project);data.textureOverrides=Tex.serialize(rig,V.sourceMaterial);data.coordinateSystem='blender-z-up';data.parallelModes=parallelSave();data.rig.asset=$('embedAsset').checked?rig.asset:null;data.rig.activeRoot=rig.activeRoot;if(rig.isBOBJ)data.rig.bobjEulerOrder=rig.bobjEulerOrder;data.draft=snapshot().pose;data.draftControls=snapshot().controls;data.draftModes=snapshot().modes;data.draftRigOptions=snapshot().options;data.time=time;data.draftDirty=draft;data.settings=readSettings();data.workspaceMode=mode;data.selected=selected;data.workspaceLayout=workspaceSnapshot();download(JSON.stringify(data,null,2),safeName()+'.animation.json','application/json');dirty=false;for(const bank of Object.values(studioBanks))if(bank)bank.dirty=false;$('saveBtn').textContent='Lưu dự án';info('Đã lưu JSON'+(data.rig.asset?' gồm model / skin.':'; khi mở lại cần cùng model.'));}
async function loadProject(data){endSourcePreview(false);assertEditingAllowed();
 data={...data,settings:{...Ground.defaults,...data.settings}};
 cancelEasingPreview();easingPanel?.hide();smoothingPanel?.hide();
 if(!data||typeof data!=='object')throw Error('JSON không hợp lệ.');if(data.coordinateSystem!==undefined&&data.coordinateSystem!=='blender-z-up')throw Error('Hệ trục dự án không được hỗ trợ.');const savedMode=dualEnabled?'rig':data.workspaceMode??mode;if(!['create','rig','compare'].includes(savedMode))throw Error('Chế độ workspace không hợp lệ.');const savedSelected=data.selected||'root';let candidate=rig;
 if(data.rig?.asset){const a=data.rig.asset;if(typeof a.name!=='string'||typeof a.data!=='string'||a.data.length>170000000)throw Error('Asset JSON không hợp lệ.');candidate=await parseAsset(Uint8Array.from(atob(a.data),c=>c.charCodeAt(0)).buffer,a.name,false,a.resources||[],a.companions||[]);}
 if(candidate.isBOBJ&&data.rig?.bobjEulerOrder&&!['XYZ','YXZ','ZXY','ZYX','YZX','XZY'].includes(data.rig.bobjEulerOrder)){if(candidate!==rig)disposeObject(candidate.root);throw Error('Euler BOBJ không hợp lệ.');}
 const chainList=C.chainSpecs(candidate),validationRig={...candidate,controls:{},chains:chainList};for(const c of chainList)for(const id of ['ik_'+c.id,'pole_'+c.id])validationRig.controls[id]={object:new T.Object3D(),rest:{p:[0,0,0],q:[0,0,0,1],s:[1,1,1]}};
 let validated;try{validated=C.validateProject(data,validationRig);delete validated.parallelModes;if(data.parallelModes){if(data.parallelModes.version!==1||!['classic','lab'].includes(data.parallelModes.active))throw Error('Bộ chế độ song song không hợp lệ.');for(const name of ['classic','lab'])if(data.parallelModes[name]){const state=data.parallelModes[name],p=state.project||state;C.validateProject(p,validationRig);if(state.project){if(!Number.isFinite(state.time)||state.time<0||state.time>p.duration||!['root',...candidate.records.map(r=>r.id),...Object.keys(validationRig.controls)].includes(state.selected))throw Error('Trạng thái chế độ không hợp lệ.');if(state.pose)C.validateProject({...C.clone(p),poses:[{name:'pose',data:state.pose}]},validationRig);if(state.controls)C.validateProject({...C.clone(p),poses:[{name:'controls',data:state.controls}]},validationRig);if(state.modes&&(!Array.isArray(state.modes)||state.modes.some(([id,m])=>!chainList.some(c=>c.id===id)||!['fk','ik'].includes(m))))throw Error('Mode chế độ không hợp lệ.');if(state.options){if(!Array.isArray(state.options)||state.options.some(([id])=>!chainList.some(c=>c.id===id)))throw Error('Rig option chế độ không hợp lệ.');for(const[,o]of state.options)C.kinematics.validate(o);}}}}
 if(data.draft)C.validateProject({...C.clone(validated),poses:[{name:'draft',data:data.draft}]},validationRig);
 if(data.draftControls){if(Object.keys(data.draftControls).some(id=>!validationRig.controls[id]))throw Error('Draft control không hợp lệ.');C.validateProject({...C.clone(validated),poses:[{name:'controls',data:data.draftControls}]},validationRig);}
 if(data.draftRigOptions){if(!Array.isArray(data.draftRigOptions)||data.draftRigOptions.some(([id])=>!chainList.some(c=>c.id===id)))throw Error('Draft rig option chain không hợp lệ.');for(const[id,o]of data.draftRigOptions)C.kinematics.validate(o);}
  if(data.rig.activeRoot&&!candidate.armatures.some(a=>a.id===data.rig.activeRoot))throw Error('Armature đã lưu không tồn tại.');
 if(data.draftModes&&(!Array.isArray(data.draftModes)||data.draftModes.some(([id,m])=>!chainList.some(c=>c.id===id)||!['fk','ik'].includes(m))))throw Error('Draft IK không hợp lệ.');
 }catch(e){if(candidate!==rig)disposeObject(candidate.root);throw e;}
 if((dirty||Object.values(studioBanks).some(b=>b?.dirty))&&!confirm('Có thay đổi chưa lưu trong một hoặc cả hai chế độ. Thay dự án bằng JSON?')){if(candidate!==rig)disposeObject(candidate.root);return;}
 Tex.validateOverrides(candidate,data.textureOverrides||[]);if(candidate!==rig)await Tex.restore(candidate,data.textureOverrides||[]);
 if(candidate!==rig)await install(candidate);else{clearTextureDisplays(candidate);await Tex.restore(candidate,data.textureOverrides||[]);}if(rig.isBOBJ)rig.bobjEulerOrder=data.rig.bobjEulerOrder||'ZYX';
 onionRevision++;project=validated;S.apply(rig,project.skinAdjustments);rig.activeRoot=data.rig.activeRoot||null;time=T.MathUtils.clamp(Number.isFinite(data.time)?data.time:0,0,project.duration);C.evaluate(rig,project,time);
 // Draft chỉ được áp nếu cùng cấu trúc transform đã được validation.
 if(data.draft){const test={...C.clone(project),poses:[{name:'draft',data:data.draft}]};C.validateProject(test,rig);for(const[id,p]of Object.entries(data.draft))C.apply(id==='root'?rig.root:rig.controls[id]?.object||record(rig,id).o,p);}
 if(data.draftRigOptions)for(const[id,o]of data.draftRigOptions)C.kinematics.configure(rig,rig.chains.find(c=>c.id===id),o,false);
  if(data.draftControls)for(const[id,p]of Object.entries(data.draftControls))C.apply(rig.controls[id].object,p);
 if(data.draftModes)for(const[id,m]of data.draftModes)rig.chains.find(c=>c.id===id).mode=m;
 fillOptions($('rigSelect'),[['','Tất cả armature'],...rig.armatures.map(a=>[a.id,a.name])],rig.activeRoot||'');fillOptions($('ikChain'),rig.chains.filter(c=>!rig.activeRoot||c.root===rig.activeRoot).map(c=>[c.id,c.label]));draft=!!data.draftDirty;history=[snapshot()];historyIndex=0;dirty=false;applySettings({...V.defaults,...O.defaults,labLayout:'current',motionLayerFloating:false,motionLayerX:-1,motionLayerY:-1,...V.blenderSettings(data.settings||{}),dualEnabledSettings:$('dualEnabledSettings').checked,dualTimelineModeSettings:$('dualTimelineModeSettings').value});loadWorkspaceLayout(data.workspaceLayout);renderBones();studioMode=data.parallelModes?.active||'classic';studioBanks={classic:null,lab:null};for(const name of ['classic','lab'])if(name!==studioMode&&data.parallelModes?.[name])studioBanks[name]=data.parallelModes[name].project?{history:[C.clone(data.parallelModes[name])],historyIndex:0,dirty:false,time:data.parallelModes[name].time}:{freshProject:C.clone(data.parallelModes[name]),time:Math.min(Number(data.parallelModes?.times?.[name])||0,data.parallelModes[name].duration)};$('studioMode').value=studioMode;syncProject();setMode(savedMode);loadWorkspaceLayout(data.workspaceLayout);select(['root',...rig.records.map(r=>r.id),...Object.keys(rig.controls)].includes(savedSelected)?savedSelected:'root');syncButtons();$('saveBtn').textContent='Lưu dự án';info('Đã mở dự án '+project.name+'.');
}
let textureSide='editor',textureSelected='0:0',texturePending=null,textureToken=0;
function textureRig(side=textureSide){return side==='editor'?rig:comparison[side]?.rig;}
function clearTextureDisplays(r){for(const v of [editView,compareA,compareB])if(v.rig===r)V.clearMeshDisplay(v);}
function textureChanged(r){r.visualRevision=(r.visualRevision||0)+1;onionRevision++;dirtyViews();compareA.dirty=true;compareB.dirty=true;if(r===rig){dirty=true;$('saveBtn').textContent='Lưu dự án •';}if(!$('texturePanel').hidden)renderTextures();}
function renderTextures(){
 const r=textureRig();$('textureRows').replaceChildren();$('textureQuick').replaceChildren();$('textureTitle').textContent='Texture / Material · '+(textureSide==='editor'?'Nhân vật':textureSide);
 const applyAll=$('textureAll');applyAll.disabled=!texturePending;applyAll.textContent=texturePending?'Áp dụng toàn bộ ('+Tex.rows(r||{mesh:[]},V.sourceMaterial).length+' material)':'Áp dụng toàn bộ';
 if(!r){$('textureNotice').textContent='Hãy nhập mô hình trước.';return;}
 const rows=Tex.rows(r,V.sourceMaterial);if(!rows.some(row=>row.key===textureSelected))textureSelected=rows[0]?.key||'';
 for(const row of rows){const node=document.createElement('div');node.className='texture-row';node.dataset.textureKey=row.key;const select=document.createElement('input');select.type='radio';select.name='textureMaterial';select.value=row.key;select.checked=row.key===textureSelected;select.setAttribute('aria-label','Chọn '+row.label);select.onchange=()=>{textureSelected=row.key;};
 const img=document.createElement('img'),previewMap=row.material.map||row.material.normalMap||row.material.aoMap||row.material.roughnessMap||row.material.metalnessMap||row.material.emissiveMap||row.material.userData?.studioTeamColorMap,image=previewMap?.image,resource=previewMap?.userData?.studioImage;img.alt='Texture '+row.label;const imageURL=image?.currentSrc||image?.src;if(imageURL&&/^(data:image\/|blob:)/.test(imageURL))img.src=imageURL;
 const size=image?.width&&image?.height?' · '+image.width+'×'+image.height:'',sourceLabel=resource?'Đã gán · '+resource.name+size:Tex.hasTexture(row.material)?(previewMap?.name?'Texture nguồn · '+previewMap.name:'Texture nhúng'):'Chưa có texture';
 const text=document.createElement('div'),caption=document.createElement('div'),button=document.createElement('button'),remove=document.createElement('button');caption.textContent=row.label+' · '+sourceLabel+(row.mesh.geometry.getAttribute('uv')?'':' · THIẾU UV');button.textContent='Chọn ảnh';button.type='button';button.onclick=()=>{textureSelected=row.key;texturePending=null;$('textureInput').click();};remove.textContent='Gỡ ảnh';remove.type='button';remove.disabled=!Tex.hasTexture(row.material);remove.setAttribute('aria-label','Gỡ ảnh khỏi '+row.label);remove.onclick=()=>removeTexture([row.key]);text.append(caption,button);
 if(texturePending){const pending=document.createElement('button');pending.type='button';pending.textContent='Gán ảnh đang chờ';pending.setAttribute('aria-label','Gán '+texturePending.name+' vào '+row.label);pending.onclick=guard(()=>applyTexture(texturePending,[row.key]));text.append(pending);}
 text.append(remove);node.append(select,img,text);
 node.addEventListener('dragover',e=>{e.preventDefault();node.classList.add('drop-ready');});node.addEventListener('dragleave',()=>node.classList.remove('drop-ready'));node.addEventListener('drop',guard(async e=>{e.preventDefault();e.stopPropagation();node.classList.remove('drop-ready');if(e.dataTransfer.files.length!==1)throw Error('Thả một ảnh vào mỗi ô texture.');textureSelected=row.key;await applyTexture(await readTextureFile(e.dataTransfer.files[0]),[row.key]);}));$('textureRows').append(node);
 }
 for(const resource of r.texturePalette||[]){const button=document.createElement('button');button.type='button';button.title=resource.name;button.setAttribute('aria-label','Gán '+resource.name+' vào material đang chọn');const img=document.createElement('img');img.src=resource.data;img.alt=resource.name;button.append(img);button.onclick=guard(()=>applyTexture(resource,[textureSelected]));$('textureQuick').append(button);}
}
function openTextures(side,selectedKey){textureSide=side;texturePending=null;if(selectedKey)textureSelected=selectedKey;$('texturePanel').hidden=false;$('textureNotice').textContent='Chọn hoặc kéo thả texture: '+Tex.IMAGE_FORMATS+'.';renderTextures();}
async function applyTexture(resource,keys){
 const side=textureSide,r=textureRig(side);if(side==='editor')assertEditingAllowed(true);if(!r)throw Error('Chưa có model.');const token=++textureToken,chosen=Tex.rows(r,V.sourceMaterial).filter(row=>keys==='all'||keys.includes(row.key));if(!chosen.length)throw Error('Chọn material trước.');for(const row of chosen)if(!row.mesh.geometry.getAttribute('uv'))throw Error('Mesh thiếu UV: '+row.mesh.name);
 const role=Tex.roleForName(resource.name),flips=new Set(chosen.map(row=>row.material.map?.flipY??(!/\.(glb|mdx|mdl)$/i.test(r.name)))),textures={};try{for(const flip of flips)textures[String(flip)]=await Tex.decodeRole(resource,flip,role,role==='normal'&&/\.(mdx|mdl)$/i.test(r.name)?'warcraft':'standard');if(token!==textureToken||textureRig(side)!==r)throw Error('Model hoặc lựa chọn đã thay đổi; hãy chọn ảnh lại.');clearTextureDisplays(r);Tex.assign(r,keys,resource,textures,role);}catch(e){for(const t of Object.values(textures))if(t?.isTexture)t.dispose();else Object.values(t||{}).forEach(x=>x.dispose());throw e;}
 r.texturePalette||=[];if(!r.texturePalette.some(x=>x.data===resource.data))r.texturePalette.push(resource);texturePending=resource;textureChanged(r);$('textureNotice').textContent='Đã gán '+resource.name+' ('+role+') cho '+chosen.length+' material.';
}
function removeTexture(keys){const side=textureSide,r=textureRig(side);if(side==='editor')assertEditingAllowed(true);if(!r)throw Error('Chưa có model.');textureToken++;texturePending=null;clearTextureDisplays(r);const count=Tex.unassign(r,keys);textureChanged(r);$('textureNotice').textContent='Đã gỡ ảnh khỏi '+count+' material. Ảnh vẫn còn trong danh sách chọn nhanh.';}
async function readTextureFile(file){if(!Tex.isImageFile(file))throw Error('Chọn texture '+Tex.IMAGE_FORMATS+'. File model cần nhập qua Nhập model.');try{const resource=await League.readTexture(file);Tex.validateResources([resource]);return resource;}catch(e){throw Error(file.name+': '+e.message);}}
function validateModelFiles(files){if(Array.from(files).some(file=>!Tex.MODEL_ACCEPT.split(',').some(ext=>file.name.toLowerCase().endsWith(ext))&&!Tex.isImageFile(file)))throw Error('Nhập model nhận '+Tex.MODEL_ACCEPT+' và ảnh texture '+Tex.IMAGE_FORMATS+'.');}
async function importFiles(files,side,modelOnly=false){
 if(modelOnly)validateModelFiles(files);
 const list=Array.from(files||[]);if(!list.length)return;const models=list.filter(f=>/\.(fbx|glb|bobj|mdx|mdl|skn)$/i.test(f.name));if(models.length>1)throw Error('Chỉ chọn một model cùng các ảnh texture.');const skls=list.filter(f=>/\.skl$/i.test(f.name)),anms=list.filter(f=>/\.anm$/i.test(f.name));if((skls.length||anms.length)&&(!models.length||!/\.skn$/i.test(models[0].name)))throw Error('LoL: chọn SKN cùng SKL và các ANM trong một lần nhập.');if(models.length&&/\.skn$/i.test(models[0].name)&&skls.length!==1)throw Error('LoL: chọn đúng một SKL cùng SKN.');if(anms.length>512)throw Error('LoL: tối đa 512 clip ANM.');const companions=await Promise.all([...skls,...anms].map(async f=>{if(f.size>120*1024*1024)throw Error('LoL: file đi kèm vượt 120 MB.');return{name:f.webkitRelativePath||f.name,data:base64(await f.arrayBuffer())};}));const images=list.filter(Tex.isImageFile),resources=await Promise.all(images.map(readTextureFile));Tex.validateResources(resources);
 if(models.length){const f=models[0];if(side==='editor')await loadModel(await f.arrayBuffer(),f.name,false,resources,companions);else await loadCompare(side,await f.arrayBuffer(),f.name,resources,[],companions);const r=textureRig(side);if(!r||r.name!==f.name)return;r.texturePalette=resources;if(resources.length&&!r.root.userData.warcraft&&!r.root.userData.league)await autoTextures(side,resources);return;}
 if(resources.length){openTextures(side);const r=textureRig();if(!r)throw Error('Nhập model trước khi gán texture.');r.texturePalette=[...(r.texturePalette||[]),...resources.filter(x=>!(r.texturePalette||[]).some(y=>y.data===x.data))];texturePending=resources.length===1?resources[0]:null;renderTextures();$('textureNotice').textContent=texturePending?'Đã nạp '+texturePending.name+'. Chọn material rồi bấm “Gán ảnh đang chờ”; nút Áp dụng toàn bộ sẽ hiện số material bị ảnh hưởng.':'Đã nạp '+resources.length+' ảnh. Chọn ảnh trong danh sách, sau đó chọn material đích để gán.';return;}
 throw Error('Chọn FBX/GLB/BOBJ/MDX/MDL hoặc SKN+SKL+ANM cùng texture.');
}
async function autoTextures(side,resources){
 const target=textureRig(side);if(!target)throw Error('Nhập model trước khi chọn thư mục texture.');
 const result=Tex.automaticAssignments(target,resources,V.sourceMaterial);openTextures(side);
 for(const assignment of result.assignments){if(textureRig(side)!==target)throw Error('Model đã thay đổi trong khi gán texture.');await applyTexture(assignment.resource,[assignment.key]);}
 target.texturePalette=resources;renderTextures();$('textureNotice').textContent='Tự ghép '+result.assignments.length+' material. '+result.warnings.join(' · ')+' Chọn ảnh thủ công cho những material còn thiếu.';
}
function installTextureDrop(v,side){
 v.container.addEventListener('dragover',e=>{if(e.dataTransfer.types.includes('Files')){e.preventDefault();v.container.classList.add('drop-ready');}});
 v.container.addEventListener('dragleave',()=>v.container.classList.remove('drop-ready'));
 v.container.addEventListener('drop',guard(async e=>{e.preventDefault();e.stopPropagation();v.container.classList.remove('drop-ready');const files=Array.from(e.dataTransfer.files);if(files.length!==1||!Tex.isImageFile(files[0])){await importFiles(files,side);return;}const r=textureRig(side);if(!r)throw Error('Nhập model trước.');const resource=await readTextureFile(files[0]),rect=v.renderer.domElement.getBoundingClientRect(),ray=new T.Raycaster();r.root.updateMatrixWorld(true);ray.setFromCamera(new T.Vector2((e.clientX-rect.left)/rect.width*2-1,-(e.clientY-rect.top)/rect.height*2+1),v.camera);const hits=ray.intersectObjects(r.mesh,false).filter(hit=>hit.object.visible),hit=hits[0];openTextures(side);if(!hit){r.texturePalette=[...(r.texturePalette||[]),resource];texturePending=resource;renderTextures();$('textureNotice').textContent='Chưa thả trúng mesh; chọn material để gán ảnh.';return;}const mi=r.mesh.indexOf(hit.object),materials=Tex.rows(r,V.sourceMaterial).filter(row=>row.mi===mi);if(materials.length>1){textureSelected=mi+':'+(hit.face?.materialIndex||0);texturePending=resource;renderTextures();$('textureNotice').textContent='Mesh có nhiều material; chọn material trong bảng để xác nhận nơi gán.';}else await applyTexture(resource,[materials[0].key]);}));
}
async function saveTextureModel(){const r=textureRig();if(!r?.asset)throw Error('Model không có asset để lưu.');const data={type:'animation-studio-model-look',version:1,asset:r.asset,textures:Tex.serialize(r,V.sourceMaterial)};download(JSON.stringify(data),r.name+'.textures.json','application/json');$('textureNotice').textContent='Đã lưu model + texture; các key animation gốc vẫn nằm trong model.';}
async function openTextureModel(file){if(!file)return;if(file.size>300*1024*1024)throw Error('JSON quá lớn.');const data=JSON.parse(await file.text());if(data?.type!=='animation-studio-model-look'||data.version!==1||typeof data.asset?.name!=='string'||typeof data.asset?.data!=='string'||data.asset.data.length>170000000||!/^[A-Za-z0-9+/=]*$/.test(data.asset.data))throw Error('Không phải JSON model + texture hợp lệ.');const bytes=Uint8Array.from(atob(data.asset.data),c=>c.charCodeAt(0)).buffer;if(textureSide==='editor'){const candidate=await parseAsset(bytes,data.asset.name,false,data.asset.resources||[],data.asset.companions||[]);await Tex.restore(candidate,data.textures||[]);if((dirty||Object.values(studioBanks).some(b=>b?.dirty))&&!confirm('Có thay đổi chưa lưu. Thay model?')){disposeObject(candidate.root);return;}await install(candidate);}else await loadCompare(textureSide,bytes,data.asset.name,data.asset.resources||[],data.textures||[],data.asset.companions||[]);renderTextures();}
const minimalColorFields=[['uiMain','Màu chính · nền','--bg'],['uiPanel','Panel','--panel'],['uiInput','Nút / ô nhập','--button'],['uiBorder','Viền','--line'],['uiText','Chữ chính','--text'],['uiMuted','Chữ phụ','--muted'],['uiAccent','Điểm nhấn','--accent'],['uiHover','Hover','--ui-hover'],['uiSelection','Trạng thái chọn','--ui-selection']];
const minimalSettingIds=['uiThemePreset','uiSidebarOpen','uiSidebarTab','compareSplit',...minimalColorFields.map(x=>x[0])];
const minimalThemeNames=['Graphite','Slate','Ocean','Forest','Sand','Rose','Violet','Steel','Coffee','Mono'];
function minimalPalette(light,index){
 const hues=[215,225,205,155,38,345,270,195,25,0],h=hues[index],sat=index===9?0:12,hex=(s,l)=>'#'+new T.Color().setHSL(h/360,s/100,l/100,T.SRGBColorSpace).getHexString(T.SRGBColorSpace);
 return{uiMain:hex(sat,light?94:12),uiPanel:hex(sat,light?99:17),uiInput:hex(sat,light?91:22),uiBorder:hex(sat,light?72:32),uiText:hex(sat,light?12:94),uiMuted:hex(sat,light?32:72),uiAccent:hex(index===9?0:55,light?34:72),uiHover:hex(sat+5,light?86:29),uiSelection:hex(sat+12,light?81:33)};
}

setupMinimalDOM();setupDualEditor();
const settingIds=[...Object.keys(V.defaults),...Object.keys(O.defaults),...minimalSettingIds,'exportAxis','renderMode','renderQuality','renderKeepMesh','focusDistance','timelineUnit','timelineStyle','labLayout','motionLayerFloating','motionLayerX','motionLayerY','showMinecraftTicks','dualEnabledSettings','dualTimelineModeSettings','orbitButton','orbitModifier','panButton','panModifier','zoomButton','zoomModifier','zoomWheel','rigStyle','rigAxes','rigLabels','rigLabelSize','rigLineWidth','gizmoSize','rigArmLeft','rigArmRight','rigLegLeft','rigLegRight','rigBody','rigArms','rigLegs','rigFingers','rigVisible','rigShowBones','rigSize','rigLeft','rigRight','rigBodyColor','theme','themeColor','background','boneGroupColors','boneLeft','boneRight','boneBody','boneColor','boneStyle','nodeSize','axisSize','showMesh','showBones','showNames','hideFingerNames','showAxes','autoRigMode','scaleTarget','scaleUniform','syncCameras','compareMesh','compareNames','compareAxes','compareEuler','compareEulerSpace','eulerOrder','compareJointScope','compareAxisSize','embedAsset','sourceUnits','uiLanguage'];
settingIds.push(...Ground.keys);syncGroundUI();
function setupGroundDOM(){
 const panel=document.createElement('details');panel.id='groundSettings';panel.open=true;
 panel.innerHTML=`<summary>Nền & mặt đất</summary><label class="field">Kiểu mặt đất<select id="groundMode"><option value="grid">Lưới · Studio</option><option value="grass">Đất cỏ · Kiểu Minecraft</option><option value="plane">Plane màu · Kiểu TABS</option></select></label><div class="ground-color-row"><label>Màu plane<input id="groundColor" type="color" value="#8bb7a5"></label><label>Mã HEX<input id="groundColorHex" type="text" value="#8bb7a5" maxlength="7" spellcheck="false" aria-describedby="groundNotice"></label></div><div class="ground-swatches" aria-label="Màu plane gợi ý">${[['#8bb7a5','Xanh ngọc'],['#68a84c','Xanh cỏ'],['#d7bf8e','Cát'],['#b8bfc9','Xám'],['#b9d9ec','Xanh nhạt'],['#d6a9a5','Hồng đất']].map(([color,name])=>`<button type="button" data-ground-color="${color}" aria-label="${name}" title="${name}" style="background:${color}"></button>`).join('')}</div><label class="field">Độ rộng mặt đất · <output id="groundSizeLabel">80 m</output><input id="groundSize" type="range" min="8" max="512" step="1" value="80"></label><label>Kích thước (m)<input id="groundSizeNumber" type="number" min="8" max="512" step="1" value="80"></label><label><input id="groundGrid" type="checkbox">Lưới phủ trên mặt đất</label><small id="groundNotice" role="status">Mặt đất ở mốc 0, chỉ để xem và dựng cảnh; không xuất kèm BOBJ/FBX.</small>`;
 $('appPresetSettings').after(panel);$('groundGrid').checked=false;
 const change=()=>applySettings(readSettings());for(const id of Ground.keys)$(id).addEventListener('change',change);
 for(const id of ['groundColor','groundSize'])$(id).addEventListener('input',change);
 $('groundColorHex').addEventListener('change',()=>{const value=$('groundColorHex').value.trim();if(!/^#[0-9a-f]{6}$/i.test(value)){$('groundColorHex').setAttribute('aria-invalid','true');$('groundNotice').textContent='Mã màu cần dạng #RRGGBB, ví dụ #68a84c.';return;}$('groundColor').value=value.toLowerCase();change();});
 $('groundSizeNumber').addEventListener('change',()=>{const n=Number($('groundSizeNumber').value);if($('groundSizeNumber').value.trim()===''||!Number.isFinite(n)){$('groundSizeNumber').setAttribute('aria-invalid','true');return;}$('groundSize').value=String(Math.round(Math.max(8,Math.min(512,n))));change();});
 for(const b of panel.querySelectorAll('[data-ground-color]'))b.onclick=()=>{$('groundColor').value=b.dataset.groundColor;change();};
}
function syncGroundUI(){const flat=$('groundMode').value!=='grid',plane=$('groundMode').value==='plane';for(const id of ['groundColor','groundColorHex'])$(id).disabled=!plane;for(const b of $('groundSettings').querySelectorAll('[data-ground-color]'))b.disabled=!plane;for(const id of ['groundSize','groundSizeNumber','groundGrid'])$(id).disabled=!flat;$('groundColorHex').value=$('groundColor').value;$('groundColorHex').removeAttribute('aria-invalid');$('groundSizeNumber').value=$('groundSize').value;$('groundSizeNumber').removeAttribute('aria-invalid');$('groundSizeLabel').textContent=$('groundSize').value+' m';$('groundNotice').textContent=flat?'Mặt đất ở mốc 0, chỉ để xem và dựng cảnh; không xuất kèm BOBJ/FBX.':'Giữ lưới Studio hiện tại. Chọn Đất cỏ hoặc Plane để có mặt đất rộng.';}
function applyGroundViews(){const settings=readSettings(),views=[editView,...editViews,...Object.values(editorSlots).flatMap(s=>s?.views||[]),compareA,compareB];for(const v of new Set(views.filter(v=>!v.shared))){for(const [object,id]of [[v.grid,'viewGridXZ'],[v.gridXY,'viewGridXY'],[v.gridYZ,'viewGridYZ']])object.visible=v.edit?$(id).checked:object===(v.displayUp==='z'?v.gridXY:v.grid);Ground.update(v,settings,v.edit?'z':v.displayUp||'y');v.dirty=true;}viewportToolbar?.sync();}
function readSettings(){return {...Object.fromEntries(settingIds.map(id=>[id,$(id).type==='checkbox'?$(id).checked:$(id).value])),coordinateSystem:'blender-z-up'};}
function applySettings(settings){
 settings={...settings,...O.validate(settings)};
 const ground=Ground.normalize({...readSettings(),...settings});for(const [id,value]of Object.entries(ground)){if(typeof value==='boolean')$(id).checked=value;else $(id).value=value;}syncGroundUI();
 for(const[id,value]of Object.entries(settings)){
  if(!settingIds.includes(id)||Ground.keys.includes(id))continue;const el=$(id);
  if(el.type==='checkbox'){if(typeof value==='boolean')el.checked=value;}
  else if(el.tagName==='SELECT'){el.value=String(value);if(!el.value)el.value=el.querySelector('option').value;}
  else if(el.type==='range'){el.value=Number.isFinite(+value)?Math.max(+el.min,Math.min(+el.max,+value)):el.defaultValue;}
  else if(el.type==='color'){el.value=typeof value==='string'&&/^#[0-9a-f]{6}$/i.test(value)?value:el.defaultValue;}
  else el.value=String(value);
 }
 syncExportFormat();applyViewportLayout();viewportToolbar?.sync();if(!$('onionEnabled').checked){onion.clear();onion.hide();}applyMouseSettings();sizeGizmo();syncModernUI();syncOnionUI();
 applyGroundViews();
 document.body.classList.toggle('light',$('theme').value==='light');document.body.style.background='';
 const style=document.documentElement.style;for(const key of ['--bg','--panel','--text','--muted','--line','--button','--accent'])style.removeProperty(key);
 if($('theme').value==='custom'){const color=new T.Color($('themeColor').value),light=color.r*.2126+color.g*.7152+color.b*.0722>.45,blend=(v)=>'#'+color.clone().lerp(new T.Color(light?0x000000:0xffffff),v).getHexString();style.setProperty('--bg',$('themeColor').value);style.setProperty('--panel',blend(.06));style.setProperty('--button',blend(.13));style.setProperty('--line',blend(.28));style.setProperty('--text',light?'#172638':'#eef5ff');style.setProperty('--muted',light?'#384e62':'#bdd0e3');style.setProperty('--accent',light?'#12614f':'#8aefd1');}applyMinimalTheme(settings);syncMinimalUI();try{localStorage.setItem('animation-studio-settings',JSON.stringify(readSettings()));}catch{}applyLabLayout();refresh();if(editorSlots.A){setDualTimeline($('dualTimelineModeSettings').value);if(dualEnabled!==$('dualEnabledSettings').checked)void setDualEnabled($('dualEnabledSettings').checked).catch(e=>info(e.message,true));}}
const rigStyleDescriptions={hybrid:'Rig Hybrid · Khung theo bộ phận, vòng FK và hộp IK; mặc định.',basic:'Cơ bản · Vòng, hộp và diamond đơn giản.',minimal:'Minimal · Control nhỏ, ít nhãn, tắt trục để quan sát pose rõ hơn.',classic:'Rigify Classic · Vòng FK và hộp IK theo kiểu hiển thị Rigify; không đổi solver.',ik:'IK Focus · Chỉ hiện Root, đích IK và Pole để đặt tay/chân.',axes:'Local Axes · Hiện trục XYZ local ở từng khớp để đối chiếu hướng xoay.',touch:'Touch · Control và vùng bấm lớn hơn, có nhãn để dễ chọn.'};
let layoutState={}, mobileLayout=false, workspaceLayouts={create:{},rig:{},compare:{}};
let applyWorkspaceLayout=()=>{},persistLayout=()=>{},cancelAreaResize=()=>{};
function validateWorkspaceLayout(data){
 const result={create:{},rig:{},compare:{}};
 if(!data||data.version!==1||!data.workspaces||typeof data.workspaces!=='object'||Array.isArray(data.workspaces))return result;
 for(const name of Object.keys(result)){
  const value=data.workspaces[name];if(!value||typeof value!=='object'||Array.isArray(value))continue;
  for(const kind of ['left','right','timeline'])if(typeof value[kind]==='number'&&Number.isFinite(value[kind]))result[name][kind]=Math.max(kind==='left'?160:kind==='right'?220:90,Math.min(kind==='timeline'?500:440,value[kind]));
  for(const key of ['leftClosed','rightClosed','timelineClosed'])if(typeof value[key]==='boolean')result[name][key]=value[key];
  if(['timeline','dope','graph','split'].includes(value.animationEditor))result[name].animationEditor=value.animationEditor;
  if(['tree','pose'].includes(value.leftEditor))result[name].leftEditor=value.leftEditor;
 }
 return result;
}
function workspaceSnapshot(){persistLayout();return{version:1,workspaces:C.clone(workspaceLayouts)};}
function loadWorkspaceLayout(data){cancelAreaResize();maximizeArea(null);workspaceLayouts=validateWorkspaceLayout(data);applyWorkspaceLayout();persistLayout();}
function maximizeArea(area){
 stopTimelineScrub();cancelAreaResize();
 const workspace=$(mode==='compare'?'compareWorkspace':'createWorkspace');
 const next=workspace.dataset.maximized===area?null:area;
 for(const id of ['createWorkspace','compareWorkspace'])delete $(id).dataset.maximized;
 if(next)workspace.dataset.maximized=next;
 document.querySelector('.drawer-backdrop')?.classList.remove('open');
 for(const button of document.querySelectorAll('[data-maximize]')){
  const active=button.dataset.maximize===next;button.textContent=active?'↙':'⛶';button.setAttribute('aria-pressed',String(active));button.title=active?'Khôi phục vùng · Escape':'Phóng lớn vùng';
 }
 editView.dirty=true;compareA.dirty=true;compareB.dirty=true;drawTimeline();drawCurve();
}
// Layout only: reserve 45% of the browser height for the shared 3D viewport.
function studioTimelineBounds(){
 const stage=document.querySelector('.stage');
 const fixed=[...stage.children].filter(el=>!['viewportGrid','viewportShell','animationArea'].includes(el.id)).reduce((sum,el)=>sum+el.getBoundingClientRect().height,0);
 const max=Math.max(0,Math.min(500,stage.clientHeight-fixed-Math.ceil(innerHeight*.45)));
 return {min:Math.min(120,max),max};
}
function clampStudioTimelineHeight(value){
 const {min,max}=studioTimelineBounds(),height=Math.max(min,Math.min(max,Number.isFinite(value)?value:240));
 document.documentElement.style.setProperty('--timeline-height',height+'px');
 const grip=document.querySelector('[data-resize=timeline]');if(grip){grip.setAttribute('aria-valuemin',min);grip.setAttribute('aria-valuemax',max);grip.setAttribute('aria-valuenow',Math.round(height));}
 return height;
}
function setAnimationEditor(value){
 stopTimelineScrub();const area=$('animationArea'),previous=area.dataset.editor,graphMode=v=>v==='graph'||v==='split';
 if(graphMode(value)&&!graphMode(previous))timelineHeightBeforeGraph=parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--timeline-height'))||260;
 if(!graphMode(value)&&graphMode(previous)&&timelineHeightBeforeGraph!==null){document.documentElement.style.setProperty('--timeline-height',timelineHeightBeforeGraph+'px');timelineHeightBeforeGraph=null;}
 $('animationEditor').value=value;area.dataset.editor=value;
 const tools=$('studioKeyTools'),options=$('minimalKeyOptions');if(tools&&options){if(value==='graph')options.append(tools);else options.before(tools);}
 $('editorHint').textContent=value==='graph'?'XYZ · Nội suy':value==='dope'?'Các khớp · Keyframe':'Tick / Frame · Keyframe';
 if(value==='graph'||value==='split'){$('graphPanel').open=true;const height=parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--timeline-height'))||220;clampStudioTimelineHeight(Math.max(height,320));}
 if(mode!=='compare')clampStudioTimelineHeight(parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--timeline-height')));
 document.querySelectorAll('[data-editor-tab]').forEach(b=>{b.classList.toggle('active',b.dataset.editorTab===value);b.setAttribute('aria-pressed',String(b.dataset.editorTab===value));});
 drawTimeline();drawCurve();
}
function syncModernUI(){
 syncInterpolationChoice();
 $('timelineStyleDescription').textContent=timelinePresets[$('timelineStyle').value].description;
 $('rigStyleSettings').value=$('rigStyle').value;document.querySelectorAll('[data-rig-preset]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.rigPreset===$('rigStyle').value)));$('rigStyleDescription').textContent=rigStyleDescriptions[$('rigStyle').value];
 $('showBones').closest('label').hidden=mode==='rig';
 for(const el of document.querySelectorAll('[data-range-value]'))el.value=$(el.dataset.rangeValue).value;
 for(const el of document.querySelectorAll('[data-visibility]'))el.checked=$(el.dataset.visibility==='showBones'&&mode==='rig'?'rigShowBones':el.dataset.visibility).checked;
}
function setupModernUI(){
 $('rigStyleSettings').replaceChildren(...[...$('rigStyle').options].map(option=>option.cloneNode(true)));
 listen('rigStyleSettings','change',()=>{$('rigStyle').value=$('rigStyleSettings').value;$('rigStyle').dispatchEvent(new Event('change'));});
 listen('openRigFromSettings','click',()=>{$('settings').close();setMode('rig');});
 const workspace=$('createWorkspace'), backdrop=document.createElement('div');backdrop.className='drawer-backdrop';document.body.append(backdrop);
 $('axisSizeHome').append($('axisSize').closest('label'));
 for(const [source,label]of [['showMesh','Nhân vật'],['rigVisible','Điều khiển'],['showBones','Xương gốc']]){
  const field=document.createElement('label'),check=document.createElement('input');check.type='checkbox';check.dataset.visibility=source;check.checked=$(source).checked;
  check.onchange=()=>{const id=source==='showBones'&&mode==='rig'?'rigShowBones':source;$(id).checked=check.checked;$(id).dispatchEvent(new Event('change'));};field.append(check,document.createTextNode(label));$('treeVisibility').append(field);
 }
 for(const id of ['rigSize','rigLineWidth','rigLabelSize','gizmoSize','axisSize','nodeSize']){
  const range=$(id),value=document.createElement('input');value.type='number';value.className='slider-value';value.min=range.min;value.max=range.max;value.step=range.step;value.value=range.value;value.dataset.rangeValue=id;value.setAttribute('aria-label',range.parentElement.firstChild.textContent.trim()+' · giá trị');range.after(value);
  value.addEventListener('change',guard(()=>{const n=Number(value.value);if(!value.value.trim()||!Number.isFinite(n)||n<+range.min||n>+range.max){value.value=range.value;throw Error('Giá trị ngoài khoảng '+range.min+' – '+range.max);}range.value=n;range.dispatchEvent(new Event('input'));range.dispatchEvent(new Event('change'));}));
  range.addEventListener('input',()=>{value.value=range.value;});
 }
 const sync=()=>{$('toggleTree').setAttribute('aria-expanded',String(!workspace.classList.contains('left-closed')));$('toggleProperties').setAttribute('aria-expanded',String(!workspace.classList.contains('right-closed')));$('toggleTimeline').setAttribute('aria-expanded',String(!workspace.classList.contains('timeline-closed')));backdrop.classList.toggle('open',mode!=='compare'&&mobileLayout&&!workspace.dataset.maximized&&(!workspace.classList.contains('left-closed')||!workspace.classList.contains('right-closed')));editView.dirty=true;};
 const dimension=(kind,value,remember=true)=>{
  const bounds=studioTimelineBounds(),min=kind==='left'?160:kind==='right'?220:bounds.min;
  const max=kind==='left'?Math.max(160,workspace.clientHeight-240):kind==='timeline'?bounds.max:Math.min(440,innerWidth/3);
  const n=Math.max(min,Math.min(max,value));document.documentElement.style.setProperty(kind==='timeline'?'--timeline-height':kind==='left'?'--rig-height':'--right-width',n+'px');
  if(remember)layoutState[kind]=n;
  const handle=document.querySelector('[data-resize="'+kind+'"]');handle.setAttribute('aria-valuemin',min);handle.setAttribute('aria-valuemax',Math.max(min,max));handle.setAttribute('aria-valuenow',Math.round(n));
 };
 persistLayout=()=>{
  if(sceneMode)return;
  if(mode!=='compare'){
   if(!mobileLayout){layoutState.leftClosed=workspace.classList.contains('left-closed');layoutState.rightClosed=workspace.classList.contains('right-closed');}
   layoutState.timelineClosed=workspace.classList.contains('timeline-closed');layoutState.animationEditor=$('animationEditor').value;layoutState.leftEditor=$('poseSection').hidden?'tree':'pose';
  }
  try{localStorage.setItem('animation-studio-workspaces-v2',JSON.stringify({version:1,workspaces:workspaceLayouts}));localStorage.setItem('animation-studio-layout-v2',JSON.stringify(layoutState));}catch{}
 };
 applyWorkspaceLayout=()=>{
  layoutState=workspaceLayouts[mode];mobileLayout=false;
  if(mode!=='compare'){
   for(const kind of ['left','right','timeline']){document.documentElement.style.removeProperty(kind==='timeline'?'--timeline-height':kind==='left'?'--rig-height':'--right-width');if(Number.isFinite(layoutState[kind]))dimension(kind,layoutState[kind],false);}
   workspace.classList.toggle('left-closed',mobileLayout||layoutState.leftClosed===true);workspace.classList.toggle('right-closed',mobileLayout||layoutState.rightClosed===true);workspace.classList.toggle('timeline-closed',layoutState.timelineClosed===true);
   dimension('timeline',layoutState.timeline||parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--timeline-height')),false);
   const pose=layoutState.leftEditor==='pose';$('treeSection').hidden=pose;$('poseSection').hidden=!pose;$('treeTab').classList.toggle('active',!pose);$('poseTab').classList.toggle('active',pose);
   setAnimationEditor(layoutState.animationEditor||'timeline');
  }
  sync();
 };
 try{
  const saved=localStorage.getItem('animation-studio-workspaces-v2');
  if(saved)workspaceLayouts=validateWorkspaceLayout(JSON.parse(saved));
  else workspaceLayouts=validateWorkspaceLayout({version:1,workspaces:{create:JSON.parse(localStorage.getItem('animation-studio-layout-v2')||'{}')}});
 }catch{}
 applyWorkspaceLayout();
 window.addEventListener('resize',()=>{cancelAreaResize();applyWorkspaceLayout();});
 for(const [id,kind]of [['toggleTree','left'],['toggleProperties','right'],['toggleTimeline','timeline']])listen(id,'click',()=>{maximizeArea(null);workspace.classList.toggle(kind+'-closed');if(mobileLayout&&kind!=='timeline'&&!workspace.classList.contains(kind+'-closed'))workspace.classList.add((kind==='left'?'right':'left')+'-closed');persistLayout();sync();});
 backdrop.onclick=()=>{workspace.classList.add('left-closed','right-closed');sync();};
 listen('resetLayout','click',()=>{maximizeArea(null);workspaceLayouts[mode]={};applyWorkspaceLayout();persistLayout();});
 let resizing=null;
 cancelAreaResize=()=>{if(!resizing)return;const drag=resizing;resizing=null;if(drag.handle.hasPointerCapture(drag.pointer))drag.handle.releasePointerCapture(drag.pointer);persistLayout();};
 for(const handle of document.querySelectorAll('[data-resize]')){
  const kind=handle.dataset.resize,target=kind==='timeline'?$('animationArea'):document.querySelector(kind==='left'?'.library':'#minimalSidebar');
  handle.addEventListener('pointerdown',e=>{if(e.button!==0||!e.isPrimary||resizing||workspace.dataset.maximized||mobileLayout&&kind!=='timeline')return;resizing={handle,pointer:e.pointerId,kind,x:e.clientX,y:e.clientY,size:kind==='timeline'||kind==='left'?target.clientHeight:target.clientWidth};handle.setPointerCapture(e.pointerId);handle.focus({preventScroll:true});e.preventDefault();});
  handle.addEventListener('pointermove',e=>{const drag=resizing;if(!drag||drag.handle!==handle||drag.pointer!==e.pointerId)return;dimension(kind,drag.size+(kind==='timeline'?drag.y-e.clientY:kind==='left'?e.clientY-drag.y:drag.x-e.clientX));editView.dirty=true;drawTimeline();drawCurve();});
  for(const event of ['pointerup','pointercancel','lostpointercapture'])handle.addEventListener(event,e=>{if(resizing?.pointer===e.pointerId)cancelAreaResize();});
  handle.addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))return;e.preventDefault();if(workspace.dataset.maximized||mobileLayout&&kind!=='timeline')return;dimension(kind,(kind==='timeline'||kind==='left'?target.clientHeight:target.clientWidth)+(['ArrowRight','ArrowUp'].includes(e.key)?10:-10));persistLayout();drawTimeline();drawCurve();editView.dirty=true;});
 }
 window.addEventListener('blur',cancelAreaResize);
 window.addEventListener('keydown',e=>{if(e.key!=='Escape'||document.querySelector('dialog[open]')||e.target.closest('input,textarea,select'))return;if(resizing){const drag=resizing;dimension(drag.kind,drag.size);cancelAreaResize();}else maximizeArea(null);sync();});
 for(const button of document.querySelectorAll('[data-maximize]'))button.addEventListener('click',()=>{maximizeArea(button.dataset.maximize);sync();});
 listen('animationEditor','change',()=>{setAnimationEditor($('animationEditor').value);persistLayout();});
 new ResizeObserver(()=>{drawTimeline();drawCurve();}).observe($('animationArea'));
 listen('treeTab','click',()=>{$('treeSection').hidden=false;$('poseSection').hidden=true;$('treeTab').classList.add('active');$('poseTab').classList.remove('active');persistLayout();});
 listen('poseTab','click',()=>{$('treeSection').hidden=true;$('poseSection').hidden=false;$('treeTab').classList.remove('active');$('poseTab').classList.add('active');persistLayout();});
 listen('cameraPreset','change',()=>setupViewPreset(editView,$('cameraPreset').value));
 listen('importQuick','click',()=>{$('fileMenu').open=false;$('modelInput').click();});listen('newQuick','click',()=>{$('fileMenu').open=false;$('newBtn').click();});
 listen('exportQuick','click',()=>{showMinimalSidebar('export');maximizeArea(null);if(mode==='compare')setMode('create');workspace.classList.remove('right-closed');if(mobileLayout)workspace.classList.add('left-closed');$('exportPanel').open=true;$('exportPanel').classList.add('export-focus');sync();$('exportPanel').scrollIntoView({block:'nearest'});$('exportFormat').focus({preventScroll:true});});
 $('editViewport').addEventListener('rig-select',e=>{const d=editView.widgets.find(d=>d.id===e.detail);if(d){const changed=activateRigWidget(d);if(changed)commit();refresh();}});
 listen('rigStyle','change',()=>{const preset=$('rigStyle').value;$('rigAxes').value=preset==='axes'?'all':preset==='minimal'||preset==='ik'?'none':'selected';$('rigLabels').checked=['hybrid','touch'].includes(preset);applySettings(readSettings());});
 listen('rigFingers','change',()=>{if(rig)renderBones();});
 for(const id of ['rx','ry','rz','px','py','pz','sx','sy','sz']){const input=$(id);input.addEventListener('focus',()=>input.dataset.before=input.value);input.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();input.value=input.dataset.before;input.blur();}else if(e.key==='Enter'){e.preventDefault();input.blur();}});}
 for(const details of document.querySelectorAll('details'))details.addEventListener('toggle',()=>{drawTimeline();drawCurve();editView.dirty=true;});
 sizeGizmo();syncModernUI();
}

const comparison={A:{rig:null,mixer:null,clip:'rest',time:0},B:{rig:null,mixer:null,clip:'rest',time:0},mapping:{}};
function assertEditingAllowed(allowPreview=false){if(sourcePreview&&!allowPreview)throw Error('Đang xem clip gốc. Chọn Bài đang chỉnh hoặc Dùng để chỉnh sửa.');if(mode==='compare')throw Error('Đối chiếu chỉ đọc. Chuyển sang Tạo animation hoặc Control Rig để chỉnh sửa.');}
function blockedCompareTarget(target){return !!target&&!target.closest?.('#compareWorkspace,#texturePanel,#modeCreate,#modeRig,#modeCompare,#helpBtn,#help');}
function lockCompareEditing(){
 const locked=mode==='compare';$('createWorkspace').inert=locked;if(locked)for(const v of editViews){v.gizmo?.detach();v.moveGizmo?.detach();}
 for(const id of ['studioMode','saveBtn','undoBtn','redoBtn','exportQuick','settingsBtn']){const el=$(id);if(locked){if(el.dataset.compareDisabled===undefined)el.dataset.compareDisabled=String(el.disabled);el.disabled=true;}else if(el.dataset.compareDisabled!==undefined){el.disabled=el.dataset.compareDisabled==='true';delete el.dataset.compareDisabled;}}
 for(const id of ['fileMenu','rigPresetMenu']){$(id).inert=locked;if(locked)$(id).open=false;}
 if(!locked)for(const side of ['A','B']){if(comparison[side])comparison[side].playing=false;}
}
function compareCameraChange(v){
 v.dirty=true;if(!$('syncCameras').checked||v.syncing)return;const other=v===compareA?compareB:compareA;if(!other.rig)return;
 other.syncing=true;V.projection(other,v.orthographic);const basis=new T.Quaternion().setFromUnitVectors(v.camera.up,other.camera.up);other.camera.position.copy(v.camera.position).applyQuaternion(basis);other.orbit.target.copy(v.orbit.target).applyQuaternion(basis);other.camera.zoom=v.camera.zoom;other.camera.updateProjectionMatrix();other.orbit.update();other.dirty=true;syncProjectionButton(other);other.syncing=false;
}
function configureCompareView(side){
 const state=comparison[side],r=state.rig,v=side==='A'?compareA:compareB;if(!r)return;
 state.mixer.stopAllAction();C.resetRig(r);
 const dataUp=r.isBOBJ?$('compareDataUp'+side).value:'y',up=$('compareUp'+side).value;
 state.placement=CompareSpace.place(r,v.wrapper,dataUp,up,C.kinematics.blenderBasis);state.placementKey=null;v.displayUp=up;r.editorUp=up;
 for(const camera of [v.perspective,v.ortho])camera.up.set(0,up==='y'?1:0,up==='z'?1:0);
 const old=v.orbit;old.dispose();v.orbit=new OrbitControls(v.camera,v.renderer.domElement);v.orbit.enableDamping=false;v.orbit.addEventListener('change',()=>compareCameraChange(v));applyMouseSettings();setupViewPreset(v,'reset');v.dirty=true;
}
let compareReportTimer=0;
function tickCompare(dt){
 if(document.hidden)return;let changed=false;compareReportTimer+=dt;
 for(const side of ['A','B']){const state=comparison[side];if(!state.rig||!state.playing)continue;const clip=state.rig.clips[Number(state.clip)];if(!clip||clip.duration<=0){state.playing=false;continue;}state.time+=dt*Math.max(.1,Math.min(4,Number($('compareSpeed'+side).value)||1));if(state.time>clip.duration){if($('compareLoop'+side).checked)state.time%=clip.duration;else{state.time=clip.duration;state.playing=false;}}$('compareTime'+side).value=state.time;try{compareSamplePose(side,false);changed=true;}catch(e){state.playing=false;info(e.message,true);}}
 if(changed&&compareReportTimer>=.1){compareReportTimer=0;renderComparison();}
}
for(const side of ['A','B']){
 listen('comparePlay'+side,'click',()=>{const state=comparison[side];if(!state.rig||state.clip==='rest')return;const clip=state.rig.clips[Number(state.clip)];if(state.time>=clip.duration)state.time=0;state.playing=!state.playing;$('compareTime'+side).value=state.time;compareSamplePose(side);});
 listen('compareSeek'+side,'input',()=>{comparison[side].playing=false;$('compareTime'+side).value=$('compareSeek'+side).value;compareSamplePose(side);});
 for(const id of ['compareUp','compareDataUp'])listen(id+side,'change',()=>{configureCompareView(side);compareSamplePose(side);});
 listen('compareAnimationOrder'+side,'change',()=>{comparison[side].placementKey=null;compareSamplePose(side);});
}
for(const side of ['A','B']){const row=$('compareSeek'+side).parentElement;row.insertAdjacentHTML('beforeend','<label>Tốc độ <input id="compareSpeed'+side+'" type="number" min="0.1" max="4" step="0.05" value="1" aria-label="Tốc độ animation '+side+'"></label><label><input id="compareInPlace'+side+'" type="checkbox">Đi tại chỗ</label>');let validSpeed=1;listen('compareSpeed'+side,'change',()=>{const value=Number($('compareSpeed'+side).value);if(!Number.isFinite(value)||value<.1||value>4){$('compareSpeed'+side).value=validSpeed;throw Error('Tốc độ xem từ 0.1× đến 4×.');}validSpeed=value;});listen('compareInPlace'+side,'change',()=>compareSamplePose(side));}
listen('syncCameras','change',()=>{$('compareCameraLockLabel').textContent=$('syncCameras').checked?'🔒 Đồng bộ camera':'🔓 Camera riêng';});
document.addEventListener('pointerdown',e=>{if(mode==='compare'&&blockedCompareTarget(e.target)){e.preventDefault();e.stopImmediatePropagation();}},true);
document.addEventListener('click',e=>{if(mode==='compare'&&blockedCompareTarget(e.target)){e.preventDefault();e.stopImmediatePropagation();}},true);
document.addEventListener('keydown',e=>{if(mode!=='compare'||e.target.closest?.('input,select,textarea,[contenteditable=true]'))return;if(e.key===' '&&e.target.closest?.('#compareWorkspace button,#compareWorkspace summary'))return;if(e.key.toLowerCase()==='q'){e.preventDefault();resetThreeQuarter(activeCameraView===compareB?compareB:compareA);}if(['g','r','i','n','k','q',' '].includes(e.key.toLowerCase())||(e.ctrlKey||e.metaKey)&&['z','a','s'].includes(e.key.toLowerCase())){e.preventDefault();e.stopImmediatePropagation();}},true);
let compareHeight=.55,compareResizeDrag=null;
try{const saved=Number(localStorage.getItem('animation-studio-compare-height'));if(saved>=.2&&saved<=.8)compareHeight=saved;}catch{}
function resizeCompare(ratio,persist=false){const w=$('compareWorkspace'),available=Math.max(1,w.clientHeight-(w.querySelector('.compare-tools')?.clientHeight||0));compareHeight=T.MathUtils.clamp(ratio,.2,.8);const min=Math.min(220,available*.7),max=Math.max(min,available-Math.min(90,available*.3)),h=T.MathUtils.clamp(available*compareHeight,min,max);w.style.setProperty('--compare-height',h+'px');$('compareResize').setAttribute('aria-valuenow',Math.round(h));$('compareResize').setAttribute('aria-valuemin',Math.round(min));$('compareResize').setAttribute('aria-valuemax',Math.round(max));compareA.dirty=true;compareB.dirty=true;if(persist)try{localStorage.setItem('animation-studio-compare-height',String(compareHeight));}catch{}}
const compareResize=$('compareResize');
compareResize.addEventListener('pointerdown',e=>{if(e.button!==0)return;compareResizeDrag={pointer:e.pointerId,y:e.clientY,start:compareHeight};compareResize.setPointerCapture(e.pointerId);e.preventDefault();});
compareResize.addEventListener('pointermove',e=>{if(!compareResizeDrag||e.pointerId!==compareResizeDrag.pointer)return;resizeCompare(compareResizeDrag.start+(e.clientY-compareResizeDrag.y)/Math.max(300,$('compareWorkspace').clientHeight));});
const endCompareResize=e=>{if(!compareResizeDrag)return;const id=compareResizeDrag.pointer;compareResizeDrag=null;if(compareResize.hasPointerCapture(id))compareResize.releasePointerCapture(id);resizeCompare(compareHeight,true);};
for(const event of ['pointerup','pointercancel','lostpointercapture'])compareResize.addEventListener(event,endCompareResize);
compareResize.addEventListener('keydown',e=>{if(['ArrowUp','ArrowDown','Home','End'].includes(e.key)){e.preventDefault();resizeCompare(e.key==='Home' ? .2 : e.key==='End' ? .8 : compareHeight+(e.key==='ArrowUp'?-.03:.03),true);}else if(e.key==='Escape'&&compareResizeDrag){const original=compareResizeDrag.start;endCompareResize();resizeCompare(original,true);}});
window.addEventListener('resize',()=>resizeCompare(compareHeight));
async function loadCompare(side,bytes,name,resources=[],overrides=[],companions=[]){const token=(comparison[side].importToken||0)+1;comparison[side].importToken=token;const candidate=await parseAsset(bytes,name,true,resources,companions);await Tex.restore(candidate,overrides);if(comparison[side].importToken!==token){disposeObject(candidate.root);return;}const v=side==='A'?compareA:compareB;mount(v,candidate);comparison[side]={rig:candidate,mixer:new T.AnimationMixer(candidate.root),clip:'rest',time:0,playing:false,importToken:token};$('compareDataUp'+side).value='y';$('compareDataUp'+side).disabled=!candidate.isBOBJ;$('compareUp'+side).value=candidate.isBOBJ?'y':candidate.profile==='Mixamo'?'z':candidate.sourceUp||'y';$('compareAnimationOrder'+side).value='ZYX';$('compareAnimationOrder'+side).disabled=!candidate.isBOBJ;$('compareTime'+side).value=0;$('compareTime'+side).step=candidate.isBOBJ?'.05':'.001';$('compareSeek'+side).value=0;$('compareSeek'+side).max=0;$('comparePlay'+side).textContent='▶ Phát';$('comparePlay'+side).disabled=true;configureCompareView(side);fillOptions($('compareRig'+side),[['','Tất cả armature'],...candidate.armatures.map(a=>[a.id,a.name])]);fillOptions($('compareClip'+side),[['rest','Rest nhập'],...candidate.clips.map((c,i)=>[String(i),c.name+' · '+(c.duration>0?c.duration.toFixed(2)+'s':'Pose tĩnh')])]);fillOptions($('compareBone'+side),candidate.records.map(r=>[r.id,r.name]));$('compareStats'+side).textContent=candidate.profile+' · '+candidate.records.length+' bones · '+candidate.records.filter(r=>r.weighted).length+' weighted · '+candidate.roots.length+' roots · '+candidate.mesh.length+' mesh · '+candidate.clips.length+' clip\n'+candidate.warnings.join('\n')+'\nMetadata Euler order / bone roll gốc: chưa xác định. BOBJ: dữ liệu Y-up, 20 tick/giây; Euler ZYX theo BBS. Đổi Trục dữ liệu nếu file xuất khác. FBX/GLB: loader chuẩn hóa Y-up, không suy đoán trục Blender gốc. Trục dữ liệu là chiều cao sau loader; Trục nhìn là chiều cao của khung 3D. Gốc frame đầu clip ở tâm lưới, ưu tiên xương Foot/Toe để căn đất; giữ độ cao và root motion tương đối khi phát. Căn hiển thị cao 2 đơn vị; số đo giữ nguyên.';v.container.querySelector('.viewport-tag').textContent=side+' · '+name;compareSamplePose(side,false);comparison.mapping={};if(comparison.A.rig&&comparison.B.rig)comparison.mapping=C.suggestMapping(comparison.A.rig,comparison.B.rig);renderComparison();refresh();}
function evaluateComparePose(side,index,time){
 const state=comparison[side],r=state.rig;state.mixer.stopAllAction();C.resetRig(r);
 const clip=index==='rest'?null:r.clips[Number(index)];if(!clip){r.root.updateMatrixWorld(true);for(const mesh of r.mesh)mesh.skeleton?.update();return;}
 if(r.isBOBJ)BOBJ.sample(r,Number(index),time,$('compareAnimationOrder'+side).value);
 else{const action=state.mixer.clipAction(clip);action.reset();action.setLoop(T.LoopOnce,1);action.clampWhenFinished=true;action.play();state.mixer.setTime(time);}
 r.root.updateMatrixWorld(true);
}
function compareSamplePose(side,paint=true){
 const state=comparison[side];if(!state.rig)return;const index=$('compareClip'+side).value||'rest',requested=Number($('compareTime'+side).value);
 if(!Number.isFinite(requested)||requested<0)throw Error('Thời gian so sánh không hợp lệ.');
 const clip=index==='rest'?null:state.rig.clips[Number(index)],v=side==='A'?compareA:compareB;state.clip=index;state.time=clip?Math.min(requested,clip.duration):0;if(!clip||clip.duration<=0)state.playing=false;
 const key=[index,$('compareAnimationOrder'+side).value,state.rig.activeRoot||'',v.displayUp].join('|');
 if(state.placementKey!==key){evaluateComparePose(side,index,0);state.placement=CompareSpace.alignClip(state.rig,v.wrapper,v.displayUp,index==='rest');state.placementKey=key;const note=$('comparePlacement'+side);if(note)note.textContent='Mốc frame đầu · '+state.placement.origin+' tại tâm lưới · '+state.placement.source+(state.placement.warning?' · '+state.placement.warning:'');}
 evaluateComparePose(side,index,state.time);
 v.wrapper.position.fromArray(state.placement.offset);v.wrapper.updateMatrixWorld(true);if($('compareInPlace'+side).checked&&state.placement.motionRoot&&state.placement.motionOrigin){const current=state.placement.motionRoot.getWorldPosition(new T.Vector3()).sub(v.wrapper.position),start=new T.Vector3().fromArray(state.placement.motionOrigin);current.sub(start);current[v.displayUp]=0;v.wrapper.position.sub(current);v.wrapper.updateMatrixWorld(true);}
 $('compareTime'+side).value=state.time.toFixed(3);$('compareTime'+side).max=clip?.duration||0;$('compareSeek'+side).max=clip?.duration||0;$('compareSeek'+side).value=state.time;$('comparePlay'+side).disabled=!clip||clip.duration<=0;$('comparePlay'+side).textContent=state.playing?'Ⅱ Dừng':'▶ Phát';v.dirty=true;if(paint){renderComparison();refresh();}
}
function changeCompareClip(side){const state=comparison[side],wasPlaying=state.playing;state.placementKey=null;$('compareTime'+side).value=0;state.playing=wasPlaying;compareSamplePose(side);}
function selectCompare(side,id){$('compareBone'+side).value=id;const mapped=side==='B'?comparison.mapping[id]:Object.entries(comparison.mapping).find(([,s])=>s===id)?.[0];if(mapped)$(side==='A'?'compareBoneB':'compareBoneA').value=mapped;renderComparison();refresh();}
function qDelta(r){const q=r.o.getWorldQuaternion(new T.Quaternion());for(const state of [comparison.A,comparison.B])if(state.rig?.records.includes(r)){const parent=state.rig.root.parent;if(parent)q.premultiply(parent.getWorldQuaternion(new T.Quaternion()).invert());break;}return q.multiply(new T.Quaternion().fromArray(r.worldQ).invert());}
function boneLength(rig,r){if(r.o.userData.bobjTail)return new T.Vector3().fromArray(r.o.userData.bobjTail).distanceTo(new T.Vector3().fromArray(r.worldP));const children=rig.records.filter(x=>x.parent===r.id);return children.length?Math.min(...children.map(x=>new T.Vector3().fromArray(x.worldP).distanceTo(new T.Vector3().fromArray(r.worldP)))):null;}
function detail(side){const rig=comparison[side].rig;if(!rig)return 'Chưa nhập file.';const r=record(rig,$('compareBone'+side).value);if(!r)return 'Chọn xương.';const order=$('eulerOrder').value,e=new T.Euler().setFromQuaternion(r.o.quaternion,order),rest=new T.Euler().setFromQuaternion(new T.Quaternion().fromArray(r.rest.q),order),world=r.o.getWorldQuaternion(new T.Quaternion()),delta=qDelta(r),d=new T.Euler().setFromQuaternion(delta,order),arr=x=>x.map(v=>v.toFixed(3)).join('  /  '),angles=x=>arr([x.x,x.y,x.z].map(deg));
 return ['Xương: '+r.name,'Parent: '+(record(rig,r.parent)?.name||'(root)'),'Độ dài tới con gần nhất: '+fmt(boneLength(rig,r))+' · đơn vị gốc','Skin weight: '+(r.weighted?'Có':'Không'),'','REST NHẬP · Local','Position XYZ: '+arr(r.rest.p),$('compareEuler').checked?'Rotation '+order+' (độ): '+angles(rest):'Euler đang ẩn','','POSE HIỆN TẠI · Local','Position XYZ: '+arr(r.o.position.toArray()),$('compareEuler').checked?'Rotation '+order+' (độ): '+angles(e):'Euler đang ẩn','','CHUYỂN ĐỘNG SO VỚI REST · World',$('compareEuler').checked?'Delta rotation '+order+' (độ): '+angles(d):'Euler đang ẩn','Góc delta quaternion: '+deg(delta.angleTo(new T.Quaternion())).toFixed(3)+'°','World quaternion XYZW: '+arr(world.toArray()),'','Bone roll / rotation_mode Blender gốc: chưa xác định từ file này.'].join('\n');}

function report(){const A=comparison.A.rig,B=comparison.B.rig;return{type:'animation-studio-rig-report',version:1,created:new Date().toISOString(),space:'World orientation; display normalized without modifying source',eulerOrder:$('eulerOrder').value,units:'native FBX / glTF; length not normalized',A:A?{file:A.name,fingerprint:A.fingerprint,bones:A.records.length,profile:A.profile,dataUp:$('compareDataUpA').value,viewUp:$('compareUpA').value,animationEuler:$('compareAnimationOrderA').value,time:comparison.A.time,clip:comparison.A.clip,warnings:A.warnings}:null,B:B?{file:B.name,fingerprint:B.fingerprint,bones:B.records.length,profile:B.profile,dataUp:$('compareDataUpB').value,viewUp:$('compareUpB').value,animationEuler:$('compareAnimationOrderB').value,time:comparison.B.time,clip:comparison.B.clip,warnings:B.warnings}:null,rows:!A||!B?[]:B.records.map(b=>{const a=record(A,comparison.mapping[b.id]);return{a:a?.name||'',b:b.name,parentA:a?record(A,a.parent)?.name||'':'',parentB:record(B,b.parent)?.name||'',lengthA:a?boneLength(A,a):null,lengthB:boneLength(B,b),restAngle:a?deg(new T.Quaternion().fromArray(a.worldQ).angleTo(new T.Quaternion().fromArray(b.worldQ))):null,poseDeltaAngle:a?deg(qDelta(a).angleTo(qDelta(b))):null};})};}
function renderComparison(){$('detailA').textContent=detail('A');$('detailB').textContent=detail('B');const data=report();$('compareTable').replaceChildren();for(const row of data.rows){const tr=document.createElement('tr');for(const value of [row.a||'Chưa ghép',row.b,row.parentA+' / '+row.parentB,fmt(row.lengthA)+' / '+fmt(row.lengthB),fmt(row.restAngle),fmt(row.poseDeltaAngle)]){const td=document.createElement('td');td.textContent=value;tr.append(td);}$('compareTable').append(tr);}compareA.dirty=true;compareB.dirty=true;}
function fmt(n){return n==null?'—':n.toFixed(3);}


const labApi={raw:C.evaluateRaw,snap:C.snap,apply:C.apply,sample:C.sampleKeys,solveIK:C.solveIK,setWorldQ:C.setWorldQ,configure:C.kinematics.configure};
function parallelSave(){
 if(!studioBanks.lab&&studioMode==='classic')return undefined;
 const bank=name=>{if(name===studioMode)return C.clone(easingPreview?.before||snapshot());const b=studioBanks[name];if(!b)return null;return b.freshProject?{project:C.clone(b.freshProject),time:b.time||0,selected:'root',draft:false}:C.clone(b.history?.[b.historyIndex]||null);};
 return{version:1,active:studioMode,classic:bank('classic'),lab:bank('lab'),times:{classic:studioMode==='classic'?(easingPreview?.before.time??time):studioBanks.classic?.time||0,lab:studioMode==='lab'?(easingPreview?.before.time??time):studioBanks.lab?.time||0}};
}
function switchStudioMode(next){directorCancel();endSourcePreview(false);assertEditingAllowed();
 cancelEasingPreview();easingPanel?.hide();smoothingPanel?.hide();
 if(!['classic','lab'].includes(next))throw Error('Bộ công cụ không hợp lệ.');
 if(studioMode===next)return;
 stopTimelineScrub();endTimelineKeyDrag(true);playing=false;
 const savedHistory=C.clone(history);savedHistory[historyIndex]=snapshot();studioBanks[studioMode]={history:savedHistory,historyIndex,dirty,time};
 let bank=studioBanks[next];
 if(!bank){
  if(next!=='lab')throw Error('Chế độ hiện tại chưa có dữ liệu.');
  const p=C.clone(project);p.lab=C.motionLab.create(p);p.keys={};p.ikModes={};p.ikOptions={};bank={freshProject:p,time:Math.min(time,p.duration)};studioBanks.lab=bank;
 }
 studioMode=next;
 if(bank.freshProject){
  project=C.clone(bank.freshProject);time=bank.time||0;selected='root';selectionKeys=[];draft=false;C.evaluate(rig,project,time);history=[snapshot()];historyIndex=0;dirty=false;delete bank.freshProject;
 }else{history=C.clone(bank.history);historyIndex=bank.historyIndex;restoreHistory(historyIndex);dirty=bank.dirty;}
 $('studioMode').value=studioMode;setMode(mode==='compare'?'create':mode);syncProject();select(selected);syncButtons();$('saveBtn').textContent=dirty?'Lưu dự án •':'Lưu dự án';info(studioMode==='lab'?'Animation Lab · chọn lớp sửa hoặc clip để bắt đầu.':'Đã trở lại bộ công cụ hiện tại.');
}
function labChain(){
 if(!project?.lab)return null;
 return rig.chains.find(c=>selected==='ik_'+c.id||selected==='pole_'+c.id||[c.a.id,c.b.id,c.c.id].includes(selected))||null;
}
function drawLabClips(){
 const lane=$('labClipLane');lane.replaceChildren();if(!project?.lab)return;
 const track=document.createElement('div');track.className='lab-clip-track';lane.append(track);
 for(const clip of project.lab.clips){
  const btn=document.createElement('button');btn.type='button';btn.className='lab-clip-block'+(labClipId===clip.id?' active':'');btn.textContent='▶ '+clip.id+' · '+clip.speed+'×';btn.style.left=(clip.start/project.duration*100)+'%';btn.style.width=(clip.length/project.duration*100)+'%';btn.dataset.id=clip.id;
  const edge=document.createElement('span');edge.className='edge';btn.append(edge);
  btn.addEventListener('click',()=>{labClipId=clip.id;syncLabPanel();});
  let drag=null;
  btn.addEventListener('pointerdown',e=>{if(e.button!==0)return;drag={x:e.clientX,start:clip.start,length:clip.length,edge:e.target===edge};btn.setPointerCapture(e.pointerId);e.preventDefault();});
  btn.addEventListener('pointermove',e=>{if(!drag)return;const span=track.getBoundingClientRect().width,delta=Math.round((e.clientX-drag.x)/span*project.duration*timelineRate())/timelineRate();const v=drag.edge?Math.max(1/project.fps,Math.min(project.duration-drag.start,drag.length+delta)):Math.max(0,Math.min(project.duration-drag.length,drag.start+delta));if(drag.edge)btn.style.width=(v/project.duration*100)+'%';else btn.style.left=(v/project.duration*100)+'%';});
  btn.addEventListener('pointerup',guard(e=>{if(!drag)return;const span=track.getBoundingClientRect().width,delta=Math.round((e.clientX-drag.x)/span*project.duration*timelineRate())/timelineRate(),old=drag;drag=null;const v=old.edge?Math.max(1/project.fps,Math.min(project.duration-old.start,old.length+delta)):Math.max(0,Math.min(project.duration-old.length,old.start+delta));if(old.edge)editLabClip({length:v});else editLabClip({start:v});}));
  btn.addEventListener('pointercancel',()=>{drag=null;drawLabClips();});track.append(btn);
 }
}
function syncLabPanel(){
 const show=studioMode==='lab'&&!!project?.lab;$('labPanel').hidden=!show||mode==='compare';$('labClipLane').hidden=!show||mode==='compare';if(!show)return;
 const picker=$('labBodyPicker');picker.replaceChildren();const parts=[['root','Toàn thân'],...rig.chains.filter(c=>!rig.activeRoot||c.root===rig.activeRoot).map(c=>['ik_'+c.id,c.label]),...rig.records.filter(r=>['head','spine','hips'].includes(C.canon(r.name))).slice(0,5).map(r=>[r.id,C.short(r.name)])];
 for(const [id,label]of parts){const btn=document.createElement('button');btn.type='button';btn.textContent=label;btn.classList.toggle('selected',selected===id);btn.onclick=()=>selectUser(id);picker.append(btn);}
 const lab=project.lab;const sourceIndex=$('labSourceClip').value;fillOptions($('labSourceClip'),rig.clips.map((c,i)=>[String(i),c.name+' · '+(c.duration>0?c.duration.toFixed(2)+'s':'Pose tĩnh')]),sourceIndex);if(!$('labSourceClip').value&&rig.clips.length)$('labSourceClip').value='0';$('labUseSourceClip').disabled=!rig.clips.length;$('labBodyMode').value=lab.bodyMode;$('labFloorContact').checked=lab.floorContact;$('labGroundY').value=lab.groundY;
 const chain=labChain(),pin=chain&&lab.pins.find(x=>x.id==='ik_'+chain.id&&time>=x.start&&time<=x.end);$('labPinPosition').checked=!!pin?.position;$('labPinRotation').checked=!!pin?.rotation;
 $('labPinNow').disabled=!chain;$('labUnpin').disabled=!pin;
 const layer=C.motionLab.active(project);fillOptions($('labLayerSelect'),lab.layers.map(l=>[l.id,l.name]),lab.activeLayer);$('labLayerMute').checked=layer.muted;$('labLayerWeight').value=layer.weight;
 if(!lab.clips.some(c=>c.id===labClipId))labClipId=lab.clips[0]?.id||'';fillOptions($('labClipSelect'),lab.clips.map(c=>[c.id,c.id+' · '+c.start.toFixed(2)+'s']),labClipId);
 const c=lab.clips.find(x=>x.id===labClipId);for(const[id,v]of [['labClipStart',c?.start],['labClipLength',c?.length],['labClipSpeed',c?.speed],['labClipFade',c?.fade]])$(id).value=v??'';$('labClipLoop').checked=!!c?.loop;$('labClipReverse').checked=!!c?.reverse;
 const marks=$('labMarkerList');marks.replaceChildren();for(const m of lab.markers){const row=document.createElement('div');row.className='row';const go=document.createElement('button');go.className='lab-marker';go.textContent='◆ '+m.name+' · '+Math.round(m.time*project.fps)+'f';go.onclick=()=>seek(m.time);const del=document.createElement('button');del.textContent='×';del.title='Xóa marker';del.onclick=()=>{lab.markers.splice(lab.markers.indexOf(m),1);commit();syncLabPanel();};row.append(go,del);marks.append(row);}
 drawLabClips();
}
function labMutation(fn){const backup=C.clone(project);try{fn();C.validateProject(project,rig);C.motionLab.sync(project);C.evaluate(rig,project,time);commit();syncLabPanel();refresh();}catch(e){project=backup;syncLabPanel();throw e;}}
function clipKeysShift(start,end,delta){
 if(Math.abs(delta)<1e-8)return;
 const lab=project.lab;C.motionLab.sync(project);
 for(const layer of lab.layers){
  const refs=[];
  for(const kind of ['keys','ikModes','ikOptions'])for(const[id,keys]of Object.entries(layer[kind]))for(const k of keys)if(k.time>=start-1e-7&&k.time<=end+1e-7)refs.push({kind,id,time:k.time});
  if(!refs.length)continue;
  const shadow={...project,keys:layer.keys,ikModes:layer.ikModes,ikOptions:layer.ikOptions};
  const moved=C.editKeyframes(shadow,refs,'move',Math.min(...refs.map(x=>x.time))+delta,'linear').project;
  layer.keys=moved.keys;layer.ikModes=moved.ikModes;layer.ikOptions=moved.ikOptions;
 }
 const current=C.motionLab.active(project);project.keys=C.clone(current.keys);project.ikModes=C.clone(current.ikModes);project.ikOptions=C.clone(current.ikOptions);
}
function editLabClip(change){
 const id=labClipId;labMutation(()=>{const c=project.lab.clips.find(x=>x.id===id);if(!c)throw Error('Chọn clip để chỉnh.');const old={...c};Object.assign(c,change);if(change.speed!==undefined&&!c.loop&&change.length===undefined){c.length=c.sourceLength/c.speed;const end=c.start+c.length;if(end<=300&&end>project.duration){project.duration=end;project.loop[1]=end;}}if(!Number.isFinite(c.start)||!Number.isFinite(c.length)||c.start<0||c.length<=0||c.start+c.length>project.duration+1e-7)throw Error('Clip vượt ngoài thời lượng dự án.');if(c.start!==old.start)clipKeysShift(old.start,old.start+old.length,c.start-old.start);});
}
function useImportedClip(){
 assertEditingAllowed();const index=Number($('labSourceClip').value),clip=rig.clips[index];if(!clip)throw Error('Rig này chưa có animation nguồn.');
 const freshImported=!!(rig.root.userData.warcraft||rig.root.userData.league)&&!labHasContent(project);const length=(rig.root.userData.warcraft||rig.root.userData.league)?clip.duration:Math.ceil(clip.duration*project.fps)/project.fps;if(length<.1||length>300||Math.ceil(length*project.fps)>9000)throw Error('Clip phải dài 0.1–300 giây và tối đa 9000 mẫu.');
 const previous=snapshot(),base=C.newProject(rig);base.name=clip.name||'Clip nhập';base.duration=length;base.loop=[0,length];
 const mixer=rig.isBOBJ?null:new T.AnimationMixer(rig.root),action=mixer?.clipAction(clip);if(action){action.setLoop(T.LoopOnce,1);action.clampWhenFinished=true;action.play();}
 try{
  for(let i=0;i<=Math.ceil(length*project.fps);i++){const t=Math.min(i/project.fps,clip.duration);mixer?.stopAllAction();C.resetRig(rig);if(rig.isBOBJ)BOBJ.sample(rig,index,t,rig.bobjEulerOrder);else{action.reset().play();mixer.setTime(t);}rig.root.updateMatrixWorld(true);C.addKey(base,'root',Math.min(i/project.fps,length),C.snap(rig.root),'linear');for(const rec of rig.records)C.addKey(base,rec.id,Math.min(i/project.fps,length),C.snap(rec.o),'linear');}
 }finally{mixer?.stopAllAction();C.evaluate(rig,previous.project,previous.time);for(const[id,x]of Object.entries(previous.pose))C.apply(id==='root'?rig.root:record(rig,id).o,x);for(const[id,x]of Object.entries(previous.controls))C.apply(rig.controls[id].object,x);for(const[id,m]of previous.modes)rig.chains.find(c=>c.id===id).mode=m;rig.root.updateMatrixWorld(true);}
 labMutation(()=>{const lab=project.lab;lab.base=base;lab.clips=[{id:'clip1',start:0,length,sourceStart:0,sourceLength:length,speed:1,loop:false,reverse:false,fade:0}];labClipId='clip1';project.duration=freshImported?length:Math.max(project.duration,length);if(freshImported)project.name=clip.name||'Animation nhập';project.loop=[0,project.duration];});
 syncProject();info('Đã lấy '+clip.name+' làm clip nguồn trong Animation Lab; lớp sửa vẫn được giữ.');
}
function pinSelected(){
 const c=labChain();if(!c)throw Error('Chọn tay hoặc chân trước khi ghim.');if(!$('labPinPosition').checked&&!$('labPinRotation').checked)throw Error('Chọn giữ vị trí hoặc góc xoay.');if(c.mode!=='ik')snapIK(c);const target=rig.controls['ik_'+c.id].object;target.updateWorldMatrix(true,false);
 labMutation(()=>{project.lab.pins=project.lab.pins.filter(x=>x.id!=='ik_'+c.id);project.lab.pins.push({id:'ik_'+c.id,start:time,end:project.duration,position:$('labPinPosition').checked,rotation:$('labPinRotation').checked,p:target.getWorldPosition(new T.Vector3()).applyQuaternion(C.kinematics.blenderBasis.clone().invert()).toArray(),q:C.kinematics.blenderBasis.clone().invert().multiply(target.getWorldQuaternion(new T.Quaternion())).toArray()});});
}
listen('labBodyMode','change',()=>{labMutation(()=>{project.lab.bodyMode=$('labBodyMode').value;$('poseScope').value=project.lab.bodyMode==='full'?'all':'branch';});});
listen('labFloorContact','change',()=>labMutation(()=>{project.lab.floorContact=$('labFloorContact').checked;}));
listen('labGroundY','change',()=>labMutation(()=>{project.lab.groundY=Number($('labGroundY').value);}));
listen('labPinNow','click',pinSelected);listen('labUnpin','click',()=>labMutation(()=>{const c=labChain();if(c)project.lab.pins=project.lab.pins.filter(x=>x.id!=='ik_'+c.id);}));
listen('labLayerSelect','change',()=>{C.motionLab.switchLayer(project,$('labLayerSelect').value);selectionKeys=[];C.evaluate(rig,project,time);commit();syncLabPanel();refresh();});
listen('labAddLayer','click',()=>{labMutation(()=>{C.motionLab.addLayer(project);selectionKeys=[];});});
listen('labLayerMute','change',()=>labMutation(()=>{C.motionLab.active(project).muted=$('labLayerMute').checked;}));
listen('labLayerWeight','change',()=>labMutation(()=>{C.motionLab.active(project).weight=Number($('labLayerWeight').value);}));
listen('labClipSelect','change',()=>{labClipId=$('labClipSelect').value;syncLabPanel();});
for(const[id,key]of [['labClipStart','start'],['labClipLength','length'],['labClipSpeed','speed'],['labClipFade','fade']])listen(id,'change',()=>editLabClip({[key]:Number($(id).value)}));
for(const[id,key]of [['labClipLoop','loop'],['labClipReverse','reverse']])listen(id,'change',()=>editLabClip({[key]:$(id).checked}));
listen('labUseSourceClip','click',()=>useImportedClip());
listen('labDuplicateClip','click',()=>labMutation(()=>{const c=project.lab.clips.find(x=>x.id===labClipId);if(!c)throw Error('Chọn clip.');const start=c.start+c.length,end=start+c.length;if(end>300)throw Error('Thời lượng clip vượt 300 giây.');const n={...c,id:'clip'+(Date.now()),start};project.lab.clips.push(n);if(end>project.duration){project.duration=end;project.loop[1]=end;}labClipId=n.id;syncProject();}));
listen('labSplitClip','click',()=>labMutation(()=>{const c=project.lab.clips.find(x=>x.id===labClipId);if(!c||time<=c.start+1/project.fps||time>=c.start+c.length-1/project.fps||c.loop)throw Error('Đặt playhead bên trong clip không lặp để cắt.');const old={...c},left=time-c.start,used=Math.min(c.sourceLength,left*c.speed);if(used<=0||used>=c.sourceLength)throw Error('Clip đã hết nguồn tại frame này.');c.length=left;c.sourceLength=used;if(old.reverse)c.sourceStart=old.sourceStart+old.sourceLength-used;const n={...old,id:'clip'+Date.now(),start:time,length:old.length-left,sourceStart:old.reverse?old.sourceStart:old.sourceStart+used,sourceLength:old.sourceLength-used,fade:0};project.lab.clips.push(n);labClipId=n.id;}));
listen('labDeleteClip','click',()=>labMutation(()=>{const i=project.lab.clips.findIndex(x=>x.id===labClipId);if(i<0)throw Error('Chọn clip.');project.lab.clips.splice(i,1);labClipId=project.lab.clips[0]?.id||'';}));
listen('labAddMarker','click',()=>labMutation(()=>{project.lab.markers.push({time,name:'Mốc '+Math.round(time*project.fps)+'f'});project.lab.markers.sort((a,b)=>a.time-b.time);}));


function motionMap(target=rig){
 if(motionMapCache?.rig===target&&motionMapCache.root===target.activeRoot)return motionMapCache;
 const records=C.activeRecords(target),points={},groups=Object.fromEntries(records.map(r=>[r.id,'body'])),meta=target.profile==='Metarig',iclone=target.profile==='iClone';
 const unique=(...names)=>{const found=records.filter(r=>names.some(n=>C.canon(r.name)===C.canon(n)));return found.length===1?found[0]:null;};
 const labels={hips:'Hông / pelvis',spine:'Cột sống',chest:'Ngực',neck:'Cổ',head:'Đầu',leftShoulder:'Vai trái',rightShoulder:'Vai phải',leftElbow:'Khuỷu tay trái',rightElbow:'Khuỷu tay phải',leftWrist:'Cổ tay trái',rightWrist:'Cổ tay phải',leftHip:'Hông trái',rightHip:'Hông phải',leftKnee:'Đầu gối trái',rightKnee:'Đầu gối phải',leftAnkle:'Cổ chân trái',rightAnkle:'Cổ chân phải',leftToe:'Mũi chân trái',rightToe:'Mũi chân phải'},ccNames={hips:['CC_Base_Hip'],spine:['CC_Base_Waist','CC_Base_Spine01'],chest:['CC_Base_Spine02'],neck:['CC_Base_NeckTwist01','CC_Base_Neck'],head:['CC_Base_Head']};
 for(const side of ['left','right']){const suffix=side==='left'?'L':'R';Object.assign(ccNames,{[side+'Shoulder']:[`CC_Base_${suffix}_Upperarm`],[side+'Elbow']:[`CC_Base_${suffix}_Forearm`],[side+'Wrist']:[`CC_Base_${suffix}_Hand`],[side+'Hip']:[`CC_Base_${suffix}_Thigh`],[side+'Knee']:[`CC_Base_${suffix}_Calf`],[side+'Ankle']:[`CC_Base_${suffix}_Foot`],[side+'Toe']:[`CC_Base_${suffix}_ToeBase`]});}
 const point=(key,r,extra={})=>{const label=labels[key]||key,expected=target.profile==='iClone'?ccNames[key]:null;points[key]={id:r?.id||null,label:r?C.short(r.name):label,...(!r?{reason:`${target.profile} rig: không tìm thấy tên duy nhất${expected?.length?' ('+expected.join(' / ')+')':''} hoặc chuỗi cha-con hợp lệ cho ${label}.`}:{}),...extra};};
 for(const [key,names]of [['hips',meta?['spine']:iclone?['CC_Base_Hip']:['Hips','Pelvis']],['spine',meta?['spine.001']:iclone?['CC_Base_Waist','CC_Base_Spine01']:['Spine','Spine_01']],['chest',meta?['spine.003']:iclone?['CC_Base_Spine02']:['Spine2','Chest']],['neck',meta?['spine.004','spine.005']:iclone?['CC_Base_NeckTwist01','CC_Base_Neck']:['Neck']],['head',meta?['spine.006']:iclone?['CC_Base_Head']:['Head']]])point(key,unique(...names));
 const head=points.head?.id&&records.find(r=>r.id===points.head.id);if(head)for(const r of C.descendants(target,head.id))groups[r.id]='head';if(points.neck?.id)groups[points.neck.id]='head';
 for(const side of ['left','right']){
  const cap=side[0].toUpperCase()+side.slice(1),suffix=side==='left'?'L':'R';
  for(const limb of ['Arm','Leg']){
   const matches=target.chains.filter(c=>(!target.activeRoot||c.root===target.activeRoot)&&c.id.endsWith(side+limb));if(matches.length!==1){if(limb==='Arm'){point(side+'Shoulder',null);point(side+'Elbow',null);point(side+'Wrist',null);}else{point(side+'Hip',null);point(side+'Knee',null);point(side+'Ankle',null);}continue;}const c=matches[0],group=side+limb;
   for(const r of C.descendants(target,c.a.id))groups[r.id]=group;
   if(limb==='Arm'){
    for(const r of C.descendants(target,c.c.id))groups[r.id]=side+'Hand';
    point(side+'Shoulder',c.a,{chain:c.id});point(side+'Elbow',c.b,{chain:c.id,ik:'pole_'+c.id});point(side+'Wrist',c.c,{chain:c.id,ik:'ik_'+c.id,effector:'ik_'+c.id});
    const shoulder=unique(...(iclone?[`CC_Base_${suffix}_Clavicle`]:[]),cap+'Shoulder','shoulder.'+suffix,'Clavicle_'+suffix);if(shoulder)groups[shoulder.id]=group;
   }else{point(side+'Hip',c.a,{chain:c.id});point(side+'Knee',c.b,{chain:c.id,ik:'pole_'+c.id});point(side+'Ankle',c.c,{chain:c.id,ik:'ik_'+c.id,effector:'ik_'+c.id});const toe=unique(...(iclone?[`CC_Base_${suffix}_ToeBase`]:[]),cap+'ToeBase','toe.'+suffix,'Toe_'+suffix);point(side+'Toe',toe,{chain:c.id});}
  }
  if(!points[side+'Wrist']||!points[side+'Wrist'].id)point(side+'Wrist',unique(...(iclone?[`CC_Base_${suffix}_Hand`]:[]),'Hand_'+suffix));
  for(const [finger,alias]of [['Thumb','thumb'],['Index','f_index'],['Middle','f_middle'],['Ring','f_ring'],['Pinky','f_pinky']])for(let i=1;i<=3;i++){const ccFinger=finger==='Middle'?'Mid':finger;const r=unique(...(iclone?[`CC_Base_${suffix}_${ccFinger}${i}`,`CC_Base_${suffix}_${ccFinger}0${i}`,`CC_Base_${suffix}_${finger}${i}`]:[]),cap+'Hand'+finger+i,alias+'.0'+i+'.'+suffix,finger+'_0'+i+'_'+suffix);point(side+finger+i,r,{reason:r?undefined:`${target.profile} rig: thiếu xương ${iclone?`CC_Base_${suffix}_${ccFinger}${i}`:cap+'Hand'+finger+i}.`});if(r)groups[r.id]=side+'Hand';}
 }
 const required=['hips','head','leftShoulder','leftElbow','leftWrist','rightShoulder','rightElbow','rightWrist','leftHip','leftKnee','leftAnkle','rightHip','rightKnee','rightAnkle'],missing=required.filter(key=>!points[key]?.id).map(key=>points[key]?.label||key);
 const rigDiagnostic=target.profile==='Khác'?`Bộ xương chưa nhận diện (${records.length} xương; ví dụ: ${records.slice(0,5).map(r=>r.name).join(', ')}). Các điểm chỉ bật khi tìm được xương phù hợp.`:missing.length?`${target.profile} · ${records.length} xương · chưa map: ${missing.join(', ')}.`:`${target.profile} · ${records.length} xương · đã nhận diện các khớp chính.`;
 return motionMapCache={rig:target,root:target.activeRoot,points,groups,rigDiagnostic};
}
function easingRefs(scope='selection'){
 const refs=selectionKeys.filter(r=>(r.kind||'keys')!=='ikModes');if(scope!=='body')return refs;
 return [...new Map(refs.flatMap(r=>C.bodyKeyRefs(rig,project,r.time).filter(x=>x.kind!=='ikModes')).map(r=>[r.kind+'|'+r.id+'|'+r.time,r])).values()];
}
function cancelEasingPreview(){
 if(!easingPreview)return;const saved=easingPreview.before;easingPreview=null;playing=false;time=saved.time;selected=saved.selected;draft=saved.draft;
 for(const[id,p]of Object.entries(saved.pose))C.apply(id==='root'?rig.root:record(rig,id).o,p);for(const[id,o]of saved.options)C.kinematics.configure(rig,rig.chains.find(c=>c.id===id),o,false);for(const[id,p]of Object.entries(saved.controls))C.apply(rig.controls[id].object,p);for(const[id,m]of saved.modes)rig.chains.find(c=>c.id===id).mode=m;
 rig.root.updateMatrixWorld(true);refresh();easingPanel?.sync();smoothingPanel?.sync();
}
function easingAction(action,args={}){assertEditingAllowed();
 smoothingPanel?.hide();
 if(action==='close'){cancelEasingPreview();easingPanel.hide();return;}
 if(action==='cancel'){cancelEasingPreview();easingPanel.sync();return;}
 if(action==='current'){cancelEasingPreview();selectionKeys=(args.scope==='body'?C.bodyKeyRefs(rig,project,time):(project.keys[selected]||[]).filter(k=>Math.abs(k.time-time)<1e-7).map(k=>({kind:'keys',id:selected,time:k.time})));drawTimeline();easingPanel.sync();return;}
 const refs=easingRefs(args.scope);if(!refs.length){info('Chọn key trên timeline hoặc chọn key ở frame hiện tại trước.',true);return;}
 const candidate=C.editKeyframes(project,refs,'interp',undefined,args.interp,args.strength).project;C.validateProject(candidate,rig);
 if(action==='apply'){
  cancelEasingPreview();project=candidate;$('interpolation').value=args.interp;$('easingStrength').value=Math.round(args.strength*100);playing=false;draft=false;C.evaluate(rig,project,time);commit();refresh();easingPanel.sync();info('Đã áp easing cho '+refs.length+' kênh key; các đoạn sau key được chọn.');return;
 }
 if(action==='preview'){
  const before=easingPreview?.before||snapshot();let end=-Infinity;
  for(const r of refs){const ks=candidate[r.kind||'keys'][r.id],i=ks.findIndex(k=>Math.abs(k.time-r.time)<1e-7);if(ks[i+1])end=Math.max(end,ks[i+1].time);}
  const start=Math.min(...refs.map(r=>r.time));if(!Number.isFinite(end)||end<=start){cancelEasingPreview();info('Key cuối không có đoạn chuyển tiếp phía sau để preview.');return;}easingPreview={before,project:candidate,range:[start,end]};playing=false;time=start;C.evaluate(rig,candidate,time);refresh();$('playBtn').click();easingPanel.sync();
 }
}
function smoothingAction(action,args={}){assertEditingAllowed();
 if(action==='error'){info(args.message,true);return;}
 if(action==='close'){cancelEasingPreview();smoothingPanel.hide();return;}
 if(action==='cancel'){cancelEasingPreview();smoothingPanel.sync();return;}
 const before=easingPreview?.before||snapshot(),candidate=C.clone(project),target=args.source==='base'?candidate.lab?.base:candidate;
 if(!target)throw Error('Clip nguồn chỉ có trong Animation Lab.');
 const ids=args.scope==='body'?[...(!rig.activeRoot||rig.roots.length===1?['root']:[]),...C.activeRecords(rig).map(r=>r.id),...Object.keys(rig.controls).filter(id=>!rig.activeRoot||rig.chains.find(c=>id.endsWith(c.id))?.root===rig.activeRoot)]:[selected];
 const start=args.start/project.fps,end=args.end/project.fps;if(end>project.duration+1e-7)throw Error('B vượt thời lượng animation.');
 const restFor=id=>project.lab&&args.source!=='base'?{p:[0,0,0],q:[0,0,0,1],s:[1,1,1]}:id==='root'?rig.rootRest:rig.controls[id]?.rest||record(rig,id)?.rest;
 const breaksFor=id=>{if(!rig.controls[id])return [];const prefix=id.startsWith('pole_')?'pole_':'ik_',chain=id.slice(prefix.length),field=prefix==='pole_'?'poleParent':'ikParent',ks=target.ikOptions?.[chain]||[];return ks.filter((k,i)=>i>0&&C.kinematics.validate(k.options)[field]!==C.kinematics.validate(ks[i-1].options)[field]).map(k=>k.time);};
 const result=C.smoothing.processTracks(target.keys,{...args,start,end,fps:project.fps,ids},C.sampleKeys,restFor,breaksFor);
 if(!result.count){cancelEasingPreview();info('Không có key phù hợp trong vùng A–B; chọn clip nguồn nếu layer chưa có key.',true);return;}
 target.keys=result.tracks;C.validateProject(candidate,rig);
 if(action==='apply'&&JSON.stringify(target.keys)===JSON.stringify(args.source==='base'?project.lab.base.keys:project.keys)){cancelEasingPreview();info('Thông số hiện tại không thay đổi dữ liệu.');return;}
 if(action==='apply'){cancelEasingPreview();project=candidate;playing=false;draft=false;C.evaluate(rig,project,time);commit();refresh();smoothingPanel.sync();info('Đã áp '+args.method+' cho '+result.count+' key · một bước Undo.');return;}
 easingPreview={before,project:action==='original'?C.clone(project):candidate,range:[start,end],tool:'smoothing',source:args.source};playing=false;time=start;C.evaluate(rig,easingPreview.project,time);refresh();$('playBtn').click();smoothingPanel.sync();
}
function graphState(){
 const shown=easingPreview?.tool==='graph'?easingPreview.project:project,keys=shown?.keys[selected]||[],rest=project?.lab?{p:[0,0,0],q:[0,0,0,1],s:[1,1,1]}:selected==='root'?rig?.rootRest:rig?.controls[selected]?.rest||record(rig,selected)?.rest;
 let blocked=draft?'Ghi key hoặc hủy pose chưa ghi trước khi chỉnh Graph.':boneIKChain()?'Khớp đang do IK điều khiển: chọn control IK hoặc chuyển sang FK.':null;
 const layer=project?.lab?.layers.find(l=>l.id===project.lab.activeLayer);if(layer&&(layer.muted||layer.weight<=0))blocked='Bật layer và tăng Weight trước khi chỉnh.';
 if(selected.startsWith('pole_')&&graphEditor?.path!=='p')blocked='Pole chỉ hỗ trợ Position.';
 return {project:shown,keys,id:selected,bank:studioMode+'|'+(project?.lab?.activeLayer||''),fps:project?.fps||30,duration:project?.duration||2,time,rest,blocked,conversion:easingPreview?.tool==='graph'&&easingPreview.conversion,conversionMessage:easingPreview?.message||'',sample:t=>C.sampleKeys(keys,t,rest)};
}
function graphAction(action,keys){assertEditingAllowed();
 if(action==='seek'){playing=false;seek(keys);return true;}
 if(action==='cancel'){cancelEasingPreview();return true;}
 if(['original','processed'].includes(action)){if(easingPreview?.tool!=='graph'||!easingPreview.conversion)return;const preview=easingPreview;preview.project=action==='original'?C.clone(project):preview.candidate;C.evaluate(rig,preview.project,time);refresh();return true;}
 if(action==='accept'){if(easingPreview?.tool!=='graph'||!easingPreview.conversion)return;keys=easingPreview.candidate.keys[selected];action='commit';}
 const state=graphState();if(state.blocked)throw Error(state.blocked);
 let candidate=C.clone(project),message='';
 if(action==='convert'){cancelEasingPreview();const result=C.graphCurves.convert(project.keys[selected]||[],project.fps,state.rest,C.sampleKeys);keys=result.keys;message='Xem thử Euler · sai lệch orientation đo: '+result.error.toFixed(3)+'°'+(result.gimbal?' · gần gimbal lock':'')+' · giữ thời gian/số key và Position/Scale';}
 candidate.keys[selected]=C.clone(keys);C.validateProject(candidate,rig);
 if(action==='commit'){cancelEasingPreview();project=candidate;playing=false;draft=false;C.evaluate(rig,project,time);commit();refresh();info('Đã chỉnh Graph · một bước Undo.');return true;}
 const before=easingPreview?.tool==='graph'?easingPreview.before:snapshot();if(easingPreview&&easingPreview.tool!=='graph')cancelEasingPreview();
 easingPreview={before,project:candidate,candidate,tool:'graph',conversion:action==='convert',message};playing=false;C.evaluate(rig,candidate,time);refresh();return true;
}
function motionHand(side,target=rig){
 const map=motionMap(target).points,get=key=>map[side+key]?.id&&target.records.find(r=>r.id===map[side+key].id),wrist=get('Wrist'),index=get('Index1'),pinky=get('Pinky1'),middle=get('Middle1'),next=get('Middle2');
 const fingers=['Pinky','Ring','Middle','Index','Thumb'],missing=fingers.flatMap(name=>[1,2,3].filter(i=>!get(name+i)).map(i=>target.profile==='iClone'?`CC_Base_${side==='left'?'L':'R'}_${name==='Middle'?'Mid':name}${i}`:`${side}${name}${i}`));
 if(!wrist||!index||!pinky||!middle||!next||missing.length)return{enabled:false,value:0,bones:[],reason:missing.length?'Thiếu xương ngón: '+missing.join(', ')+'.':`Không nhận diện đủ mốc bàn tay ${side==='left'?'trái':'phải'} (cổ tay, ngón trỏ/út/giữa).`};
 const pos=r=>new T.Vector3().fromArray(r.worldP),forward=pos(next).sub(pos(middle)).normalize(),normal=pos(index).sub(pos(pinky)).cross(forward).multiplyScalar(side==='right'?1:-1).normalize();
 if(normal.lengthSq()<.9)return{enabled:false,value:0,bones:[],reason:`Không xác định được trục lòng bàn tay ${side==='left'?'trái':'phải'} từ vị trí xương Rest.`};
 const bones=[],invalidAxes=[];
 for(const name of ['Pinky','Ring','Middle','Index','Thumb'])for(let i=1;i<=3;i++){
  const r=get(name+i),child=i<3?get(name+(i+1)):r&&target.records.find(c=>c.parent===r.id),parent=r&&target.records.find(c=>c.id===r.parent),dir=child?pos(child).sub(pos(r)).normalize():parent?pos(r).sub(pos(parent)).normalize():new T.Vector3();if(!r||dir.lengthSq()<.9){invalidAxes.push(map[side+name+i]?.label||`${name}${i}`);continue;}
  const toward=name==='Thumb'?pos(get('Index2')).sub(pos(r)).normalize():normal,axis=dir.clone().cross(toward).normalize().applyQuaternion(new T.Quaternion().fromArray(r.worldQ).invert());if(axis.lengthSq()<.9){invalidAxes.push(map[side+name+i]?.label||`${name}${i}`);continue;}
  const angle=rad(name==='Thumb'?[45,65,75][i-1]:[75,95,70][i-1]),delta=new T.Quaternion().fromArray(r.rest.q).invert().multiply(r.o.quaternion);if(delta.w<0)delta.set(-delta.x,-delta.y,-delta.z,-delta.w);
  const curl=2*Math.atan2(new T.Vector3(delta.x,delta.y,delta.z).dot(axis),delta.w)/angle;bones.push({r,axis,angle,curl});
 }
 return{enabled:bones.length===15,value:bones.length?T.MathUtils.clamp(bones.reduce((sum,b)=>sum+b.curl,0)/bones.length,0,1):0,bones,reason:bones.length===15?'':invalidAxes.length?'Không tính được trục xoay cho: '+invalidAxes.join(', ')+'.':'Không đủ 15 khớp ngón có thể xoay.'};
}
function motionHandAction(action,args){
 if(action==='handStart'){
  if(motionHandDrag||rig.roots.length>1&&!rig.activeRoot)return false;const hand=motionHand(args.side);if(!hand.enabled)return false;
  motionHandDrag={rig,side:args.side,hand,before:snapshot(),value:hand.value,moved:false};playing=false;return true;
 }
 const d=motionHandDrag;if(!d)return;
 if(action==='handMove'){
  const value=Number(args.value);if(!Number.isFinite(value)||value<0||value>1||rig!==d.rig)return;
  d.value=value;d.moved=Math.abs(value-d.hand.value)>1e-6;
  for(const b of d.hand.bones)b.r.o.quaternion.fromArray(d.before.pose[b.r.id].q).multiply(new T.Quaternion().setFromAxisAngle(b.axis,b.angle*(value-d.hand.value))).normalize();
  rig.root.updateMatrixWorld(true);constrainPose(d.hand.bones.map(b=>b.r.id));dirtyViews();syncTransform();return;
 }
 if(action==='handEnd'){
  motionHandDrag=null;
  if(args.cancel||!d.moved){for(const b of d.hand.bones)C.apply(b.r.o,d.before.pose[b.r.id]);rig.root.updateMatrixWorld(true);refresh();return;}
  const ids=d.hand.bones.map(b=>b.r.id);const wrist=motionMap().points[d.side+'Wrist'];if(wrist)select(wrist.id);markPose(ids);syncLabPanel();
 }
}
function motionPanelState(){
 const visible=!!rig&&!!project?.lab&&studioMode==='lab'&&mode!=='compare'&&$('motionLayerFloating').checked;
 if(!visible)return{visible:false};
 const chain=labChain(),layer=C.motionLab.active(project);
 const map=motionMap();return{visible,armatures:rig.armatures,activeRoot:rig.activeRoot,readOnly:!!sourcePreview||mode==='compare',lockedReason:sourcePreview?'Đang xem clip gốc. Bấm Dùng để chỉnh sửa hoặc trở lại Bài đang chỉnh.':rig.roots.length>1&&!rig.activeRoot?'Chọn một Armature để chỉnh pose.':layer.muted||layer.weight<=0?'Bật lớp sửa và tăng mức ảnh hưởng trước khi chỉnh pose.':'',rigDiagnostic:map.rigDiagnostic,hands:Object.fromEntries(['left','right'].map(side=>[side,motionHandDrag?.side===side?{enabled:true,value:motionHandDrag.value}:motionHand(side)])),rig:rig.fingerprint+':'+rig.activeRoot,x:$('motionLayerX').value,y:$('motionLayerY').value,points:map.points,selected,chain,effector:chain?'ik_'+chain.id:null,pins:project.lab.pins.filter(p=>time>=p.start&&time<=p.end),scope:project.lab.bodyMode,space:$('space').value,transform:$('transformMode').value,controls:mode==='rig'&&$('rigVisible').checked,bones:mode==='rig'?$('rigShowBones').checked:$('showBones').checked,floor:project.lab.floorContact,layers:project.lab.layers,layer:project.lab.activeLayer,weight:layer.weight,poses:project.poses,canPaste:clipboard?.fingerprint===rig.fingerprint,label:currentObject()?.name?C.short(currentObject().name):'Root · Toàn nhân vật',frame:time*project.fps,values:Object.fromEntries(['px','py','pz','rx','ry','rz'].map(id=>[id,{value:$(id).value,disabled:$(id).disabled}])),moveDisabled:!!boneIKChain(),rotateDisabled:!!boneIKChain()||selected.startsWith('pole_')};
}
function motionAffectedChains(ids){return rig.chains.filter(c=>(!rig.activeRoot||c.root===rig.activeRoot)&&[c.a.id,c.b.id,c.c.id,'ik_'+c.id,'pole_'+c.id].some(id=>ids.includes(id)));}
function motionScopeIds({tab=motionPanel.tab,mask=[...motionPanel.mask]}={},all=false){
 if(rig.roots.length>1&&!rig.activeRoot)throw Error('Chọn một Armature trước khi dùng sơ đồ cơ thể.');
 const records=C.activeRecords(rig),map=motionMap(),full=[...(!rig.activeRoot||rig.roots.length===1?['root']:[]),...records.map(r=>r.id)];
 if(all||tab!=='mixer'&&project.lab.bodyMode==='full')return full;
 if(tab==='mixer')return full.filter(id=>mask.includes(id==='root'?'body':map.groups[id]));
 const chain=labChain(),rec=record(rig,selected),finger=rec&&/thumb|index|middle|ring|pinky/i.test(rec.name);
 if(finger)return C.descendants(rig,selected).map(r=>r.id);
 if(chain)return [...new Set([chain.a.id,chain.b.id,chain.c.id,...(chain.id.toLowerCase().includes('leg')?C.descendants(rig,chain.c.id).map(r=>r.id):[])])];
 const group=map.groups[selected]||'body';return full.filter(id=>(id==='root'?'body':map.groups[id])===group);
}
function motionApplyPose(data,ids){
 const applyIds=ids.filter(id=>data[id]);if(!applyIds.length)throw Error('Không có pose tương thích cho vùng chọn.');
 for(const c of motionAffectedChains(applyIds))c.mode='fk';
 for(const id of applyIds){const o=id==='root'?rig.root:record(rig,id)?.o;if(o)C.apply(o,data[id]);}
 rig.root.updateMatrixWorld(true);markPose(applyIds);syncLabPanel();
}
function motionBaseline(){
 const saved=snapshot();let pose;
 try{C.motionLab.evaluate(rig,project,time,labApi,true);pose=C.capture(rig);}
 finally{for(const [id,p]of Object.entries(saved.pose))C.apply(id==='root'?rig.root:record(rig,id).o,p);for(const[id,o]of saved.options)C.kinematics.configure(rig,rig.chains.find(c=>c.id===id),o,false);for(const[id,p]of Object.entries(saved.controls))C.apply(rig.controls[id].object,p);for(const[id,m]of saved.modes)rig.chains.find(c=>c.id===id).mode=m;rig.root.updateMatrixWorld(true);}
 return pose;
}
function motionPins(action){
 const active=rig.chains.filter(c=>!rig.activeRoot||c.root===rig.activeRoot),current=labChain();
 if(action==='unpinAll'){const ids=new Set(active.map(c=>'ik_'+c.id));project.lab.pins=project.lab.pins.filter(p=>!ids.has(p.id));commit();return;}
 const chains=action==='pinFeet'?active.filter(c=>/Leg$/.test(c.id)):action==='pinHands'?active.filter(c=>/Arm$/.test(c.id)):action==='pinAll'?active:current?[current]:[];
 if(!chains.length)throw Error('Chọn tay/chân có IK trước khi ghim.');
 for(const c of chains){const id='ik_'+c.id,old=project.lab.pins.find(p=>p.id===id&&time>=p.start&&time<=p.end);let position=old?.position||false,rotation=old?.rotation||false;
  if(action==='pinPosition')position=!position;else if(action==='pinRotation')rotation=!rotation;else position=rotation=true;
  project.lab.pins=project.lab.pins.filter(p=>p.id!==id);if(!position&&!rotation)continue;
  if(c.mode!=='ik')snapIK(c);c.mode='ik';const o=rig.controls[id].object;o.updateWorldMatrix(true,false);
  project.lab.pins.push({id,start:old?.start??time,end:old?.end??project.duration,position,rotation,p:old?.position?old.p:o.getWorldPosition(new T.Vector3()).toArray(),q:old?.rotation?old.q:o.getWorldQuaternion(new T.Quaternion()).toArray()});
 }
 C.motionLab.constrain(rig,project,time,labApi);commit();
}
function motionMirror(ids,direction){
 const records=C.activeRecords(rig),data=new Map(records.map(r=>[r.id,{q:r.o.getWorldQuaternion(new T.Quaternion()),p:C.snap(r.o)}])),swap=n=>/Left|Right/.test(n)?n.replace(/Left|Right/g,x=>x==='Left'?'Right':'Left'):/\.[LR]$/.test(n)?n.slice(0,-1)+(n.endsWith('L')?'R':'L'):n;
 const dest=records.filter(r=>ids.includes(r.id)&&(direction==='mirrorBoth'||direction==='mirrorRL'&&/Left|\.L$/.test(r.name)||direction==='mirrorLR'&&/Right|\.R$/.test(r.name)));
 if(!dest.length)throw Error('Chọn vùng đích để mirror: bên trái cho R→L hoặc bên phải cho L→R.');
 for(const c of motionAffectedChains(dest.map(r=>r.id)))c.mode='fk';
 for(const dst of dest){const src=records.find(r=>r.name===swap(dst.name));if(!src)continue;const delta=data.get(src.id).q.clone().multiply(new T.Quaternion().fromArray(src.worldQ).invert());delta.set(delta.x,-delta.y,-delta.z,delta.w);C.setWorldQ(dst.o,delta.multiply(new T.Quaternion().fromArray(dst.worldQ)));const a=data.get(src.id).p.p,b=src.rest.p;dst.o.position.fromArray(dst.rest.p).add(new T.Vector3(-(a[0]-b[0]),a[1]-b[1],a[2]-b[2]));}
 rig.root.updateMatrixWorld(true);markPose(dest.map(r=>r.id));
}
function motionAction(action,args={}){assertEditingAllowed();
 if(!project?.lab)return;
 if(action==='armature'){$('rigSelect').value=args.value;$('rigSelect').dispatchEvent(new Event('change'));return;}
 if(action.startsWith('hand'))return motionHandAction(action,args);
 if(action==='close'){$('motionLayerFloating').checked=false;applySettings(readSettings());return;}
 if(action==='joint'){
  if(rig.roots.length>1&&!rig.activeRoot)throw Error('Chọn một Armature trước khi chọn khớp.');
  const p=motionMap().points[args.key];if(!p)return;const id=args.tab==='ik'?p.ik||p.id:p.id,c=p.chain&&rig.chains.find(x=>x.id===p.chain);
  playing=false;if(c){if(id.startsWith('ik_')||id.startsWith('pole_')){snapIK(c);c.mode='ik';}else{if(id===c.b.id)snapPole(c);c.mode='fk';}}
  $('transformMode').value=id.startsWith('pole_')||id.startsWith('ik_')&&args.tab==='ik'?'translate':'rotate';$('combinedGizmo').checked=false;select(id);if(c){draft=true;commit();}refresh();return;
 }
 if(action==='move'||action==='rotate'){$('transformMode').value=action==='move'?'translate':'rotate';$('transformMode').dispatchEvent(new Event('change'));return;}
 if(action==='space'){$('space').value=args.value;$('space').dispatchEvent(new Event('change'));return;}
 if(action==='value'){const input=$(args.field);if(!input||input.disabled)return;input.value=args.value;try{numericPose(args.field.startsWith('p')?'p':'q');}finally{syncTransform();}return;}
 if(action==='controls'){if(mode!=='rig'){setMode('rig');$('rigVisible').checked=true;}else $('rigVisible').checked=!$('rigVisible').checked;applySettings(readSettings());return;}
 if(action==='bones'){const el=$(mode==='rig'?'rigShowBones':'showBones');el.checked=!el.checked;applySettings(readSettings());return;}
 if(action==='full'||action==='part'){project.lab.bodyMode=action;$('poseScope').value=action==='full'?'all':'branch';commit();}
 else if(action==='ik'||action==='fk'){const c=labChain();if(c)setChainMode(c,action);}
 else if(action==='floor'){project.lab.floorContact=!!args.value;C.motionLab.constrain(rig,project,time,labApi);commit();}
 else if(action==='layer'){$('labLayerSelect').value=args.value;$('labLayerSelect').dispatchEvent(new Event('change'));return;}
 else if(action==='weight'){$('labLayerWeight').value=args.value;$('labLayerWeight').dispatchEvent(new Event('change'));return;}
 else if(action.startsWith('pin')||action==='unpinAll'){motionScopeIds({},true);motionPins(action);}
 else{
  const ids=motionScopeIds(args,action.endsWith('All'));if(!ids.length)throw Error('Chọn ít nhất một vùng trên Pose Mixer.');
  if(action==='key'){writeKeys(ids,motionAffectedChains(ids));commit();info('Đã ghi '+ids.length+' kênh pose tại frame '+Math.round(time*project.fps)+'.');}
  else if(action==='copy'||action==='copyAll'){const data=C.capture(rig);clipboard={fingerprint:rig.fingerprint,data:Object.fromEntries(ids.filter(id=>data[id]).map(id=>[id,data[id]]))};info('Đã copy '+Object.keys(clipboard.data).length+' xương theo phạm vi.');}
  else if(action==='paste'||action==='pasteAll'){if(clipboard?.fingerprint!==rig.fingerprint)throw Error('Chưa có pose tương thích.');motionApplyPose(clipboard.data,ids);info('Đã dán pose vào vùng chọn; ghim đang bật được ưu tiên.');}
  else if(action==='applyPose'){const pose=project.poses[args.pose];if(!pose||pose.fingerprint!==rig.fingerprint)throw Error('Pose thư viện không tương thích.');motionApplyPose(pose.data,ids);}
  else if(action==='reset')motionApplyPose(motionBaseline(),ids);
  else if(action.startsWith('mirror'))motionMirror(ids,action);
 }
 syncLabPanel();refresh();
}

listen('applyJointLimitPreset','click',applyJointLimitPreset);
listen('modelInput','change',async e=>{try{await importFiles(e.target.files,'editor',true);}finally{e.target.value='';}});
listen('sampleBtn','click',()=>loadModel(sampleBytes(),'Mixamo T-Pose.fbx'));
listen('projectInput','change',async e=>{const f=e.target.files[0];if(f){if(f.size>180*1024*1024)throw Error('JSON quá lớn.');await loadProject(JSON.parse(await f.text()));}e.target.value='';});
listen('targetInput','change',async e=>{const f=e.target.files[0];if(!f)return;if(!/\.(fbx|glb)$/i.test(f.name)){e.target.value='';throw Error('Rig đích chỉ nhận FBX / GLB; ảnh được chọn trong Texture / Vật liệu.');}const token=++targetToken,next=await parseAsset(await f.arrayBuffer(),f.name);if(token!==targetToken)return;if(next.profile==='Khác')throw Error('Rig đích chưa nhận diện Mixamo hoặc Metarig; cần mẫu đúng profile.');if(targetRig)disposeObject(targetRig.root);targetRig=next;mapping=C.suggestMapping(rig,next);$('targetSummary').textContent=next.profile+' · '+next.records.length+' bone · '+Object.keys(mapping).length+' cặp gợi ý';$('exportProfile').value=next.profile;e.target.value='';info('Đã đọc rig đích. Kiểm tra mapping trước khi xuất.');});
listen('boneSearch','input',renderBones);listen('rootBtn','click',()=>selectUser(rig.activeRoot||'root'));listen('rigSelect','change',()=>{rig.activeRoot=$('rigSelect').value||null;fillOptions($('ikChain'),rig.chains.filter(c=>!rig.activeRoot||c.root===rig.activeRoot).map(c=>[c.id,c.label]));renderBones();select(rig.activeRoot||'root');if(history[historyIndex])history[historyIndex]=snapshot();});
listen('studioMode','change',()=>switchStudioMode($('studioMode').value));
listen('labLayout','change',()=>applySettings(readSettings()));
listen('motionLayerToggle','click',()=>{$('motionLayerFloating').checked=!$('motionLayerFloating').checked;applySettings(readSettings());});
listen('modeCreate','click',()=>setMode('create'));listen('modeRig','click',()=>{if(mode==='compare')return;$('rigVisible').checked=!$('rigVisible').checked;applySettings(readSettings());});listen('modeCompare','click',()=>setMode('compare'));
listen('newBtn','click',()=>{if(dirty&&!confirm('Xóa clip đang chỉnh để tạo clip mới?'))return;onionRevision++;project=C.newProject(rig);if(studioMode==='lab'){project.lab=C.motionLab.create(project);project.keys={};project.ikModes={};project.ikOptions={};}seek(0);history=[snapshot()];historyIndex=0;dirty=false;syncProject();syncButtons();});
listen('clipName','change',()=>{project.name=$('clipName').value.trim()||'Animation';commit();});
listen('duration','change',()=>{const d=Number($('duration').value);if(!Number.isFinite(d)||d<.1||d>300)throw Error('Thời lượng 0.1–300 giây.');if([...Object.values(project.keys),...Object.values(project.ikModes),...Object.values(project.ikOptions||{}),...(project.lab?.layers||[]).flatMap(l=>[...Object.values(l.keys),...Object.values(l.ikModes),...Object.values(l.ikOptions)])].some(ks=>ks.some(k=>k.time>d))||project.lab?.clips.some(c=>c.start+c.length>d)||project.lab?.markers.some(m=>m.time>d)||project.lab?.pins.some(x=>x.end>d))throw Error('Có key sau thời lượng mới; dời hoặc xóa trước.');project.duration=d;project.loop[1]=Math.min(project.loop[1],d);if(project.loop[0]>=project.loop[1])project.loop=[0,d];time=Math.min(time,d);syncProject();commit();refresh();});
listen('fps','change',()=>{project.fps=Number($('fps').value);syncProject();commit();refresh();info('Đổi FPS giữ thời gian theo giây, không đổi tốc độ animation.');});
for(const id of ['loopA','loopB'])listen(id,'change',()=>{const a=+$('loopA').value/timelineRate(),b=+$('loopB').value/timelineRate();if(!Number.isFinite(a+b)||a<0||b>project.duration||b<=a)throw Error('A/B phải nằm trong clip và B > A.');project.loop=[a,b];commit();});
for(const [kind,ids]of [['q',['rx','ry','rz']],['p',['px','py','pz']],['s',['sx','sy','sz']]])for(const id of ids)listen(id,'change',()=>{try{numericPose(kind,true,id);}finally{syncTransform();}});
listen('scaleTarget','change',()=>{$('scaleHelp').textContent=$('scaleTarget').value==='skin'?'Hình dáng mesh theo trục Local và weights của xương chọn; không đổi khớp.':'1 = 100%; 1.2 = 120%. Scale xương theo Local, ảnh hưởng mesh và xương con.';refresh();});
listen('resetScale','click',()=>{const rest=[1,1,1];['sx','sy','sz'].forEach((id,i)=>$(id).value=rest[i]);numericPose('s');});
listen('transformMode','change',()=>{$('combinedGizmo').checked=$('transformMode').value==='both';for(const v of editViews)configureGizmo(v);refresh();});listen('space','change',()=>{for(const v of editViews)configureGizmo(v);refresh();});listen('combinedGizmo','change',()=>{$('transformMode').value=selected.startsWith('pole_')?'translate':$('combinedGizmo').checked?'both':'rotate';refresh();});
listen('resetNode','click',()=>resetPose('node'));listen('resetBranch','click',()=>resetPose('branch'));listen('resetAll','click',()=>resetPose('all'));listen('mirrorPose','click',mirror);
listen('ikChain','change',()=>syncTransform());
listen('ikMode','change',()=>{const c=rig.chains.find(c=>c.id===$('ikChain').value);if(c)setChainMode(c,$('ikMode').value);});
listen('ikTarget','click',()=>{const c=rig.chains.find(c=>c.id===$('ikChain').value);if(!c||c.mode!=='ik')throw Error('Bật IK của chuỗi này trước.');select('ik_'+c.id);});
listen('ikPole','click',()=>{const c=rig.chains.find(c=>c.id===$('ikChain').value);if(c)selectUser('pole_'+c.id);});
listen('capturePose','click',()=>{const name=$('poseName').value.trim()||'Pose';const data=C.capture(rig,$('poseScope').value,selected);project.poses.push({name,fingerprint:rig.fingerprint,data});commit();renderPoses();});
listen('copyPose','click',()=>{clipboard={fingerprint:rig.fingerprint,data:C.capture(rig,$('poseScope').value,selected)};info('Đã copy pose.');});
listen('pastePose','click',()=>{if(!clipboard||clipboard.fingerprint!==rig.fingerprint)throw Error('Chưa có pose tương thích trong clipboard.');for(const[id,p]of Object.entries(clipboard.data))C.apply(id==='root'?rig.root:rig.controls[id]?.object||record(rig,id).o,p);rig.root.updateMatrixWorld(true);markPose(null,Object.keys(clipboard.data));});
listen('keyBtn','click',()=>{writeKeys(activeIds());commit();refresh();info('Đã ghi key tại frame '+Math.round(time*project.fps)+'.');});
listen('undoBtn','click',()=>restoreHistory(historyIndex-1));listen('redoBtn','click',()=>restoreHistory(historyIndex+1));listen('saveBtn','click',saveProject);
function playbackRange(){
 if(sceneMode&&!sceneEditing)return[0,sceneProject.duration];
 if(directorPending?.showing)return directorPending.showing.loop;
 if(easingPreview?.range)return easingPreview.range;
 const clip=$('loop').checked&&studioMode==='lab'&&project.lab?.clips.find(c=>c.id===labClipId);
 return clip?.length>0?[clip.start,Math.min(project.duration,clip.start+clip.length)]:project.loop;
}
listen('playBtn','click',()=>{if(sceneMode&&!sceneEditing)return sceneAction('play');if(sourcePreview){if(!sourcePreview.duration)return;if(time>=sourcePreview.duration)seekSourceClip(0);playing=!playing;lastStamp=performance.now();syncTime();return;}if(draft){info('Pose chưa ghi sẽ được thay bằng key khi phát; bấm Ghi key nếu muốn giữ.');}const[a,b]=playbackRange();if(time<a||time>=b)seek(a);playing=!playing;playbackDiagnostics={frames:0,skipped:0,last:Math.floor(time*project.fps),maxGap:0};lastStamp=performance.now();syncTime();});
listen('restartBtn','click',()=>{playing=false;seek(0);});listen('prevFrame','click',()=>{playing=false;seek((Math.round(time*timelineRate())-1)/timelineRate());});listen('nextFrame','click',()=>{playing=false;seek((Math.round(time*timelineRate())+1)/timelineRate());});listen('frameInput','change',()=>{playing=false;seek(+$('frameInput').value/timelineRate());});
function setSpeed(value){if(!Number.isFinite(value)||value<.1||value>4)throw Error('Tốc độ xem từ 0.1× đến 4×.');$('speedInput').value=value;$('speedSlider').value=value;document.querySelectorAll('[data-speed]').forEach(b=>{const active=Math.abs(Number(b.dataset.speed)-value)<1e-8;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));});}
document.querySelectorAll('[data-speed]').forEach(b=>b.onclick=()=>setSpeed(+b.dataset.speed));listen('speedSlider','input',()=>setSpeed(+$('speedSlider').value));listen('speedInput','change',()=>setSpeed(+$('speedInput').value));
listen('timeline','click',e=>{if(timelineSuppressClick&&e.detail){timelineSuppressClick=false;return;}const rect=$('timeline').getBoundingClientRect(),x=e.clientX-rect.left,y=e.clientY-rect.top,preset=timelinePresets[$('animationEditor').value==='dope'?'dope':$('timelineStyle').value],hit=timelineHits.find(h=>Math.hypot(x-h.x,y-h.y)<h.radius);if(hit)selectTimelineHit(hit,e.ctrlKey||e.shiftKey);else if(x>=130)seekTimeline(x,rect.width,timelineRate());else{const row=timelineRows()[Math.floor(y/preset.row)];if(row&&row.id!=='allBody')select(row.id);}});
listen('keySelectionScope','change',()=>{selectionKeys=[];drawTimeline();});
listen('selectBodyKeys','click',()=>{$('keySelectionScope').value='body';selectionKeys=C.bodyKeyRefs(rig,project,time);$('keyFrame').value=+(time*timelineRate()).toFixed(3);drawTimeline();if(!selectionKeys.length)info('Frame hiện tại chưa có key toàn thân.');});
listen('timelineRuler','click',e=>{if(timelineSuppressClick&&e.detail){timelineSuppressClick=false;return;}const rect=$('timelineRuler').getBoundingClientRect(),x=e.clientX-rect.left;if(x>=130)seekTimeline(x,rect.width,$('showMinecraftTicks').checked&&e.clientY-rect.top<22?20:timelineRate());});
listen('timelineRuler','keydown',e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();playing=false;seek(e.key==='Home'?0:e.key==='End'?project.duration:T.MathUtils.clamp(time+(e.key==='ArrowLeft'?-1:1)/timelineRate(),0,project.duration));});
listen('moveKey','click',()=>keyOperation('move'));listen('copyKey','click',()=>keyOperation('copy'));listen('deleteKey','click',()=>keyOperation('delete'));listen('setInterp','click',()=>keyOperation('interp'));
document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>setupViewPreset(editView,b.dataset.view));
for(const [side,v]of [['A',compareA],['B',compareB]]){listen('compareCamera'+side,'change',()=>setupViewPreset(v,$('compareCamera'+side).value));listen('compareProjection'+side,'click',()=>{V.projection(v,!v.orthographic);syncProjectionButton(v);});}
listen('projectionBtn','click',()=>{V.projection(editView,!editView.orthographic);syncProjectionButton(editView);dirtyViews();});
listen('focusBtn','click',focusSelected);
listen('openRigDisplay','click',()=>{openSettings('viewport');$('viewportDisplaySettings').open=true;$('viewportDisplaySettings').scrollIntoView({block:'start'});});listen('settingsBtn','click',()=>{syncJointLimits();openSettings();});listen('helpBtn','click',()=>$('help').showModal());
function readOnionSettings(){return Object.fromEntries(Object.keys(O.defaults).map(id=>[id,$(id).type==='checkbox'?$(id).checked:$(id).value]));}
function syncOnionUI(){
 const s=readOnionSettings(),enabled=s.onionEnabled,english=$('uiLanguage').value==='en';onionLastUnit=s.onionUnit;
 $('onionToggle').classList.toggle('active',enabled);$('onionToggle').setAttribute('aria-pressed',String(enabled));$('onionInterval').hidden=s.onionSampling==='keys';
 const mesh=onion.hasMesh!==false&&s.onionParts!=='bones',bones=s.onionParts!=='mesh'||onion.hasMesh===false;
 for(const[part,usable]of [['Mesh',mesh],['Bone',bones]])for(const suffix of ['', 'Number']){const el=$('onion'+part+'Opacity'+suffix);el.disabled=!usable;if(suffix)el.value=s['onion'+part+'Opacity'];}
 let note='';if(enabled){if(!onion.times?.length)note=english?'Insert a key to preview onion poses.':'Ghi ít nhất một key để dùng Bóng pose.';else if(!(+s.onionBefore)&&!(+s.onionAfter))note=english?'Both ghost counts are zero.':'Số bóng trước và sau đều bằng 0.';else if((!mesh||+s.onionMeshOpacity===100)&&(!bones||+s.onionBoneOpacity===100))note=english?'All enabled ghost parts are transparent.':'Các thành phần bóng đang hiện đều trong suốt.';else if(playing&&!s.onionPlayback)note=english?'Ghosts hidden during playback.':'Bóng đang ẩn khi phát.';else note=(draft?(english?'Ghosts use keyed poses; current pose is unkeyed.':'Bóng dùng pose đã ghi; pose hiện tại chưa ghi key.'):onion.times?.length===1?(english?'One keyed pose: ghosts can overlap.':'Chỉ có một pose đã ghi: các bóng có thể trùng hình.'):'');if(onion.hasMesh===false)note+=(note?' ':'')+(english?'No mesh: using bone lines.':'Rig không có mesh: dùng xương line.');}
 if($('onionNotice').textContent!==note)$('onionNotice').textContent=note;
 $('onionLegend').hidden=!enabled||mode==='compare'||playing&&!s.onionPlayback;
 $('onionLegendBefore').style.color=s.onionBeforeColor;$('onionLegendAfter').style.color=s.onionAfterColor;
 $('onionLegendBefore').textContent=english?'Before':'Trước';$('onionLegendAfter').textContent=english?'After':'Sau';
}
listen('onionToggle','click',()=>{$('onionEnabled').checked=!$('onionEnabled').checked;applySettings(readSettings());});
listen('onionOptions','click',()=>{openSettings('timeline');$('onionSettings').open=true;$('onionSettings').scrollIntoView({block:'start'});$('onionEnabled').focus({preventScroll:true});});
listen('onionReset','click',()=>applySettings({...readSettings(),...O.defaults}));
listen('onionUnit','change',()=>{const old=onionLastUnit,next=$('onionUnit').value;$('onionStep').value=Math.max(1,Math.min(120,Math.round(+$('onionStep').value*(next==='ticks'?20:project.fps)/(old==='ticks'?20:project.fps))));applySettings(readSettings());});
for(const part of ['Mesh','Bone']){const id='onion'+part+'Opacity';listen(id,'input',()=>applySettings(readSettings()));listen(id+'Number','input',()=>{const n=Number($(id+'Number').value);if($(id+'Number').value!==''&&Number.isFinite(n)){$(id).value=Math.max(0,Math.min(100,Math.round(n)));applySettings(readSettings());}});}
for(const id of settingIds.filter(id=>!['onionUnit','dualEnabledSettings','dualTimelineModeSettings'].includes(id)))listen(id,'change',()=>applySettings(readSettings()));for(const id of ['rigBody','rigArms','rigLegs','rigFingers','rigVisible','rigShowBones','rigSize','rigLeft','rigRight','rigBodyColor','rigLabelSize','rigLineWidth','gizmoSize','axisSize'])listen(id,'input',()=>{sizeGizmo();syncModernUI();editView.dirty=true;});
for(const[id,k]of Object.entries(rigOptionFields))listen(id,'change',()=>{const c=rig.chains.find(c=>selected==='ik_'+c.id||selected==='pole_'+c.id||[c.a.id,c.b.id,c.c.id].includes(selected));if(!c)return;const options={...c.options,[k]:$(id).tagName==='SELECT'?$(id).value:Number($(id).value)};C.kinematics.configure(rig,c,options,true);if(c.mode==='ik'&&!['ikParent','poleParent','wristPivot'].includes(k))solvePoseIK(c);markPose();});
listen('editAsFK','click',()=>{const c=boneIKChain();if(c)setChainMode(c,'fk');});listen('editIKTarget','click',()=>{const c=boneIKChain();if(c)select('ik_'+c.id);});
listen('resetMouse','click',()=>{for(const [i,id]of cameraActions.entries()){$(id+'Button').value=String(i);$(id+'Modifier').value='none';}$('zoomWheel').checked=true;applySettings(readSettings());});
listen('rigFK','click',()=>{const c=selectedChain();if(c)setChainMode(c,'fk');});listen('rigIK','click',()=>{const c=selectedChain();if(c)setChainMode(c,'ik');});listen('rigSnap','click',()=>{const c=selectedChain();if(c){snapIK(c);markPose();}});
for(const[value,label]of [['bobj','BOBJ / BBS · xương + animation, tùy chọn mesh'],['fbx-direct','FBX trực tiếp · chỉ xương + animation'],['bvh','BVH trực tiếp · chỉ xương + animation']])$('exportFormat').append(createOption(value,label));
$('exportFormat').value='bobj';$('exportAxis').value='minecraft';syncExportFormat();listen('exportFormat','change',syncExportFormat);
listen('mappingBtn','click',openMapping);listen('closeMapping','click',()=>$('mappingDialog').close());listen('exportBtn','click',doExport);
for(const side of ['A','B']){listen('compareInput'+side,'change',async e=>{try{await importFiles(e.target.files,side,true);}finally{e.target.value='';}});listen('compareClip'+side,'change',()=>changeCompareClip(side));listen('compareTime'+side,'change',()=>{comparison[side].playing=false;compareSamplePose(side);});listen('compareBone'+side,'change',()=>selectCompare(side,$('compareBone'+side).value));listen('compareRig'+side,'change',()=>{const r=comparison[side].rig;r.activeRoot=$('compareRig'+side).value||null;comparison[side].placementKey=null;compareSamplePose(side,false);fillOptions($('compareBone'+side),C.activeRecords(r).map(b=>[b.id,b.name]));renderComparison();refresh();});}
for(const [side,id]of [['editor','textureEditor'],['A','textureA'],['B','textureB']])listen(id,'click',()=>openTextures(side));
listen('textureClose','click',()=>{$('texturePanel').hidden=true;texturePending=null;});
const textureFolderLabel=document.createElement('label');textureFolderLabel.className='button';textureFolderLabel.textContent='Thư mục texture';const textureFolderInput=document.createElement('input');textureFolderInput.type='file';textureFolderInput.accept=Tex.IMAGE_ACCEPT;textureFolderInput.setAttribute('webkitdirectory','');textureFolderInput.multiple=true;textureFolderInput.id='textureFolderInput';textureFolderLabel.append(textureFolderInput);$('textureInput').closest('.row').append(textureFolderLabel);
textureFolderInput.addEventListener('change',guard(async()=>{const side=textureSide;try{const files=Array.from(textureFolderInput.files||[]).filter(Tex.isImageFile);if(!files.length)throw Error('Thư mục không có texture '+Tex.IMAGE_FORMATS+'.');await autoTextures(side,await Promise.all(files.map(readTextureFile)));}finally{textureFolderInput.value='';}}));
listen('textureInput','change',async e=>{const f=e.target.files[0];try{if(f)await applyTexture(await readTextureFile(f),[textureSelected]);}finally{e.target.value='';}});
listen('textureAll','click',()=>{if(!texturePending)throw Error('Chọn một ảnh trước khi áp dụng toàn bộ.');return applyTexture(texturePending,'all');});
listen('textureSave','click',saveTextureModel);listen('textureProjectInput','change',async e=>{try{await openTextureModel(e.target.files[0]);}finally{e.target.value='';}});
for(const [id,side]of [['modelFolder','editor'],['compareFolderA','A'],['compareFolderB','B']])listen(id,'change',async e=>{try{await importFiles(e.target.files,side);}finally{e.target.value='';}});
installTextureDrop(editView,'editor');installTextureDrop(compareA,'A');installTextureDrop(compareB,'B');
listen('compareAxisSize','input',()=>{compareA.dirty=true;compareB.dirty=true;});
listen('compareCurrent','click',()=>loadCompare('A',Uint8Array.from(atob(rig.asset.data),c=>c.charCodeAt(0)).buffer,rig.asset.name,rig.asset.resources||[],[],rig.asset.companions||[]));listen('compareSample','click',()=>loadCompare('B',sampleBytes(),'Mixamo T-Pose.fbx'));
for(const id of ['compareMesh','compareNames','compareAxes','compareEuler','compareEulerSpace','eulerOrder'])listen(id,'change',()=>{renderComparison();refresh();});
listen('pairBtn','click',()=>{const a=$('compareBoneA').value,b=$('compareBoneB').value;if(!a||!b)throw Error('Nhập đủ hai rig và chọn cặp xương.');comparison.mapping[b]=a;renderComparison();refresh();});
listen('autoPairBtn','click',()=>{if(!comparison.A.rig||!comparison.B.rig)throw Error('Nhập đủ hai rig.');comparison.mapping=C.suggestMapping(comparison.A.rig,comparison.B.rig);renderComparison();info('Các cặp gợi ý cần kiểm tra trước khi sử dụng.');});
listen('compareReset','click',()=>{setupViewPreset(compareA,'reset');setupViewPreset(compareB,'reset');});
listen('reportJson','click',()=>download(JSON.stringify(report(),null,2),'rig_report.json','application/json'));
listen('reportCsv','click',()=>{const rows=report().rows,cols=['a','b','parentA','parentB','lengthA','lengthB','restAngle','poseDeltaAngle'];download('\ufeff'+[cols.map(C.csvCell).join(','),...rows.map(r=>cols.map(c=>C.csvCell(r[c])).join(','))].join('\r\n'),'rig_report.csv','text/csv');});
window.addEventListener('beforeunload',e=>{if(dirty||Object.entries(editorSlots).some(([side,slot])=>side!==activeEditorSlot&&slot?.dirty)){e.preventDefault();e.returnValue='';}});
window.addEventListener('keydown',guard(e=>{if(mode==='compare')return;if(sourcePreview){if(e.target.closest('input,textarea,select,[contenteditable=true]')||document.querySelector('dialog[open]'))return;if(e.code==='Space'&&!e.target.closest('button,summary')){e.preventDefault();$('playBtn').click();}else if(e.key.toLowerCase()==='q')resetThreeQuarter(activeEditView);else if(e.key.toLowerCase()==='e')focusSelected();else if(['g','r','i','k','n'].includes(e.key.toLowerCase())||(e.ctrlKey||e.metaKey)&&['z','a'].includes(e.key.toLowerCase()))e.preventDefault();return;}if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='a'&&e.target.id==='timeline'){e.preventDefault();selectionKeys=C.bodyKeyRefs(rig,project);drawTimeline();return;}if(motionHandDrag)return;if(easingPreview&&e.key!==' '&&e.key!=='Escape'&&!e.target.closest('#easingPanel,#smoothingPanel,#graphPanel'))cancelEasingPreview();if(e.key==='Escape'&&smoothingPanel&&!smoothingPanel.root.hidden){smoothingAction('close');return;}if(e.key==='Escape'&&easingPanel&&!easingPanel.root.hidden){easingAction('close');return;}if((e.code==='Space'||e.key==='Enter')&&e.target.closest('button,summary,[role=separator]'))return;if(e.target.closest('input,textarea,select,[contenteditable=true]')||document.querySelector('dialog[open]'))return;if(['n','e'].includes(e.key.toLowerCase())&&!e.ctrlKey&&!e.altKey&&!e.metaKey&&!e.shiftKey&&!e.repeat&&mode!=='compare'&&!rigDrag&&!numericDrag&&!motionHandDrag&&!timelineDrag&&!timelineKeyDrag&&!editViews.some(v=>v.gizmo.dragging||v.moveGizmo.dragging)){e.preventDefault();if(e.key.toLowerCase()==='e')focusSelected();else if(studioMode==='lab')$('motionLayerToggle').click();else info('Edit Motion Layer thuộc Animation Lab. Chọn bộ công cụ Animation Lab để dùng N.');return;}if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();restoreHistory(historyIndex+(e.shiftKey?1:-1));}else if(e.key.toLowerCase()==='q'&&!e.ctrlKey&&!e.altKey&&!e.metaKey&&!rigDrag&&!numericDrag&&!motionHandDrag&&!editViews.some(v=>v.gizmo.dragging||v.moveGizmo.dragging)){e.preventDefault();resetThreeQuarter(mode==='compare'?(activeCameraView===compareB&&compareB.container.clientWidth||!compareA.container.clientWidth?compareB:compareA):activeEditView);}else if(['g','r','i'].includes(e.key.toLowerCase())&&!e.ctrlKey&&!e.altKey&&!e.metaKey&&!e.shiftKey&&!e.repeat&&mode!=='compare'&&!rigDrag&&!numericDrag&&!motionHandDrag&&!timelineDrag&&!timelineKeyDrag&&!editViews.some(v=>v.gizmo.dragging||v.moveGizmo.dragging)){e.preventDefault();const key=e.key.toLowerCase();if(key==='i'){if(motionPanel&&!motionPanel.root.hidden)motionAction('key',{tab:motionPanel.tab,mask:[...motionPanel.mask]});else $('keyBtn').click();}else if(boneIKChain())info('Khớp đang do IK điều khiển; chọn đích IK hoặc chuyển sang FK.',true);else if(selected.startsWith('pole_')&&key==='r')info('Pole chỉ điều khiển hướng gập bằng Di chuyển.');else{$('transformMode').value=key==='g'?'translate':'rotate';$('transformMode').dispatchEvent(new Event('change'));}}else if(e.key==='Escape'&&timelineKeyDrag){e.preventDefault();endTimelineKeyDrag(true);} else if(e.code==='Space'){e.preventDefault();$('playBtn').click();}else if(e.key.toLowerCase()==='k')$('keyBtn').click();else if(e.key==='Escape'&&rigDrag){cancelRigDrag();}else if(e.key==='Escape'&&editViews.some(v=>v.gizmo.dragging||v.moveGizmo.dragging)){const view=editViews.find(v=>v.gizmo.dragging||v.moveGizmo.dragging);view.gizmoCancelled=true;const g=view.gizmo.dragging?view.gizmo:view.moveGizmo;g.reset();if(view.before){const h=view.before;for(const[id,p]of Object.entries(h.pose))C.apply(id==='root'?rig.root:rig.controls[id]?.object||record(rig,id).o,p);for(const[id,p]of Object.entries(h.controls))C.apply(rig.controls[id].object,p);for(const [id,m]of h.modes)rig.chains.find(c=>c.id===id).mode=m;draft=h.draft;}refresh();}}));
let hostActive=true;let lastStamp=performance.now(),playbackDiagnostics={frames:0,skipped:0,last:0,maxGap:0};
function frame(stamp){if(!hostActive)return;if(sceneMode&&!sceneEditing){sceneFrame(stamp);if(hostActive)requestAnimationFrame(frame);return;}if(timelineKeyDrag?.paint){timelineKeyDrag.paint=false;drawTimeline();}const dt=Math.max(0,(stamp-lastStamp)/1000);lastStamp=stamp;if(mode==='compare')tickCompare(dt);flushTimelineScrub();if(sourcePreview&&mode!=='compare'){if(playing){playing=sourcePreview.advance(dt*Number($('speedInput').value),$('loop').checked);time=sourcePreview.time;dirtyViews();syncTime();}}else if(playing&&mode!=='compare'){time+=dt*Number($('speedInput').value);const[a,b]=playbackRange();if(time<a)time=a;if(time>b){if($('loop').checked)time=a+(time-a)%(b-a);else{time=b;playing=false;}}C.evaluate(rig,directorPending?.showing||easingPreview?.project||project,time);const index=Math.floor(time*project.fps);playbackDiagnostics.frames++;playbackDiagnostics.maxGap=Math.max(playbackDiagnostics.maxGap,dt);if(index>=playbackDiagnostics.last)playbackDiagnostics.skipped+=Math.max(0,index-playbackDiagnostics.last-1);playbackDiagnostics.last=index;$('playbackDiagnostics').textContent=playbackDiagnostics.skipped?'Render bỏ '+playbackDiagnostics.skipped+' frame':'';$('playbackDiagnostics').dataset.maxGap=playbackDiagnostics.maxGap.toFixed(4);dirtyViews();syncTransform();syncTime();drawTimeline();drawCurve();}
 syncScenePreview?.();if(mode!=='compare'){if(editView.container.clientWidth&&editView.container.clientHeight){if(sourcePreview)onion.hide();else if(onion.update(rig,project,time,readOnionSettings(),onionRevision,playing,stamp)){editView.dirty=true;syncOnionUI();}if($('renderMode').value==='continuous'||editViews.some(v=>v.dirty)){syncOnionUI();for(const v of editViews.filter(v=>v!==editView&&v.container.clientWidth&&v.container.clientHeight))showView(v);showView(editView);}}else onion.hide();}else{onion.hide();if((compareA.dirty||$('renderMode').value==='continuous')&&compareA.container.clientWidth&&compareA.container.clientHeight)showView(compareA);if((compareB.dirty||$('renderMode').value==='continuous')&&compareB.container.clientWidth&&compareB.container.clientHeight)showView(compareB);}tickOtherEditor(dt);if(hostActive)requestAnimationFrame(frame);}
const localeMap=new Map([["Tạo animation","Create animation"],["Đối chiếu xương","Compare rigs"],["Hướng dẫn","Help"],["Lưu dự án","Save project"],["Lưu dự án •","Save project •"],["Mở JSON","Open JSON"],["DỰ ÁN & BỘ XƯƠNG","PROJECT & RIG"],["Tên animation","Animation name"],["Tên được dùng khi lưu và xuất.","Used for project and export files."],["Nhập FBX / GLB","Import FBX / GLB"],["Mixamo mẫu","Mixamo sample"],["File gốc được giữ nguyên. .blend cần chuyển qua Blender.","The original file is preserved. Convert .blend with Blender."],["Đơn vị rig nhập","Input rig units"],["Centimet (FBX mặc định)","Centimeters (FBX default)"],["Mét (GLB)","Meters (GLB)"],["FBX có thể dùng đơn vị khác. Xác nhận trước xuất; GLB được quy đổi sang mét đúng một lần.","FBX units may vary. Confirm before exporting; GLB is converted to meters once."],["Armature","Armature"],["Tất cả armature","All armatures"],["Clip mới","New clip"],["Tìm xương","Find bone"],["Root / Toàn nhân vật","Root / Entire character"],["Thư viện pose","Pose library"],["Tên pose","Pose name"],["Phạm vi","Scope"],["Toàn thân","Whole body"],["Bộ phận đang chọn","Selected branch"],["Khớp đang chọn","Selected joint"],["Lưu pose","Save pose"],["Trước","Front"],["Phải","Right"],["Trái","Left"],["Trên","Top"],["Sau","Back"],["Reset camera","Reset camera"],["Trực giao","Orthographic"],["Phối cảnh","Perspective"],["Nhân vật","Character"],["Xương","Bones"],["Tên","Names"],["Ẩn tên ngón","Hide finger names"],["XYZ mọi node","All local axes"],["▶ Phát","▶ Play"],["Ⅱ Tạm dừng","Ⅱ Pause"],["Lặp","Loop"],["Giây","Seconds"],["Nội suy","Interpolation"],["◆ Ghi key","◆ Insert key"],["Pose đã ghi","Pose keyed"],["Pose chưa ghi key","Unkeyed pose"],["Frame key","Key frame"],["Dời","Move"],["Sao chép","Duplicate"],["Xóa key chọn","Delete selected keys"],["Áp nội suy","Apply interpolation"],["Click ◆ chọn, Ctrl/Shift chọn nhiều; click nền để tua. Nội suy thuộc đoạn sau key.","Click ◆ to select, Ctrl/Shift for multiple keys; click the background to scrub. Interpolation applies after a key."],["Đường cong","Curve"],["Rotation · Euler XYZ (độ)","Rotation · Euler XYZ (degrees)"],["Position · Local (đơn vị gốc)","Position · Local (native units)"],["Rotation xử lý bằng quaternion; biểu đồ Euler dùng để đọc.","Rotations use quaternions; Euler curves are a readout."],["ĐIỀU KHIỂN POSE","POSE CONTROLS"],["Chọn một khớp","Select a joint"],["Root · Toàn nhân vật","Root · Entire character"],["Công cụ","Tool"],["Xoay (Rotation)","Rotate"],["Di chuyển (Position)","Translate"],["FK xoay từng khớp; di chuyển Root cho cả nhân vật.","FK rotates individual joints. Move Root to move the character."],["Không gian","Space"],["Local theo trục khớp. World theo trục của cảnh.","Local follows joint axes. World follows scene axes."],["Góc Euler XYZ của phép xoay hiện tại trong không gian chọn; không phải bone roll.","Euler XYZ rotation in the selected space; this is not bone roll."],["Vị trí theo đơn vị rig gốc, không dùng tỉ lệ camera.","Position uses native rig units, independently of camera scale."],["Rest khớp","Joint rest"],["Rest bộ phận","Branch rest"],["Rest toàn thân","Whole-body rest"],["IK tay / chân","Arm / leg IK"],["Chuỗi","Chain"],["Chế độ","Mode"],["Chuyển chế độ giữ pose; IK giải hai đoạn và bake lên xương.","Mode switches preserve pose. Two-bone IK is baked onto the skeleton."],["Chọn đích IK","Select IK target"],["Chọn Pole","Select pole"],["Pole định hướng gập khuỷu/gối. Mục tiêu ngoài tầm được giới hạn; không kéo dài xương.","The pole controls elbow/knee bending. Unreachable targets are clamped without stretching bones."],["Tay trái","Left arm"],["Tay phải","Right arm"],["Chân trái","Left leg"],["Chân phải","Right leg"],["Xuất xương + animation","Export skeleton + animation"],["Bộ xương đích","Target rig"],["Giữ rig hiện tại","Keep current rig"],["Metarig tham chiếu","Reference Metarig"],["Khác rig cần mapping và rest calibration. Không đổi tên để giả profile.","Changing rigs requires mapping and rest calibration; renaming is insufficient."],["Nhập rig đích FBX / GLB","Import target FBX / GLB"],["Mixamo mẫu có sẵn. Metarig cần file khung tham chiếu.","Mixamo sample is available. Metarig requires a reference rig."],["Xem / sửa mapping","Review / edit mapping"],["Định dạng","Format"],["FBX qua Blender","FBX via Blender"],[".blend qua Blender (skeleton + animation)",".blend via Blender (skeleton + animation)"],[".blend chưa giữ metadata Generate Rig nếu file tham chiếu không có metadata đó.",".blend cannot preserve Generate Rig metadata absent from the reference."],["Kèm mesh / skin (chỉ cùng rig)","Include mesh / skin (same rig only)"],["Đoạn xuất","Export range"],["Toàn clip","Whole clip"],["Vùng A – B","A – B range"],["Xuất animation","Export animation"],["Đồng bộ camera","Sync cameras"],["Tên xương","Bone names"],["XYZ khớp chọn","Selected joint axes"],["Góc","Euler order"],["Báo cáo JSON","JSON report"],["Báo cáo CSV","CSV report"],["Dùng rig tạo","Use editor rig"],["Rest","Rest"],["Rest nhập","Imported rest"],["Đối chiếu từng khớp","Joint comparison"],["Ghép cặp này","Pair these bones"],["Gợi ý theo tên","Suggest by name"],["Chọn xương A.","Select bone A."],["Chọn xương B.","Select bone B."],["Rest nhập ≠ frame đầu clip. Euler XYZ ≠ sửa trục rest/bone roll. Góc chênh lệch dùng quaternion World sau căn hướng hiển thị; dữ liệu gốc được giữ riêng.","Imported rest is not necessarily the first clip frame. Euler XYZ does not change rest axes/bone roll. Differences use World quaternions; source data is preserved."],["Xương A","Bone A"],["Xương B / mapping","Bone B / mapping"],["Độ dài gốc A / B","Native length A / B"],["Lệch rest World °","World rest difference °"],["Lệch pose delta °","Pose delta difference °"],["Cài đặt","Settings"],["Đóng","Close"],["Giao diện","Theme"],["Tối","Dark"],["Sáng","Light"],["Tùy màu","Custom"],["Màu nền giao diện","UI background"],["Nền khung 3D","3D background"],["Màu xương","Bone color"],["Kiểu xương","Bone style"],["Bát diện","Octahedral"],["Kích thước node","Joint marker size"],["Độ dài trục con","Local axis length"],["Nhúng model vào JSON dự án","Embed model in project JSON"],["Nhúng giúp mở lại đủ skin; file lớn hơn. Nếu tắt cần nhập lại cùng model.","Embedding restores model and skin, with a larger file. Otherwise reimport the same model."],["Mapping nguồn → đích","Source → target mapping"],["Các cặp gợi ý cần kiểm tra. Xương chưa ghép giữ rest. Root motion được chuyển theo tỉ lệ chiều cao; mesh chỉ xuất khi giữ rig.","Review suggested pairs. Unmapped bones keep rest. Root motion scales with rig height; mesh export requires the same rig."],["Tạo animation từ pose","Create animation from poses"],["Nhập nhân vật hoặc dùng Mixamo mẫu, chọn khớp từ danh sách hoặc màn hình.","Import a character or use the Mixamo sample. Select a joint in the list or viewport."],["Xoay bằng vòng gizmo / nhập góc. Lưu pose nếu muốn tái sử dụng.","Rotate using the gizmo or numeric angles. Save poses for reuse."],["Ở frame 0 bấm Ghi key. Tua sang frame khác, đổi pose và Ghi key tiếp.","Insert a key at frame 0. Scrub to another frame, change the pose and insert another key."],["Chọn key để đổi Step / Linear / Smooth. Bấm Phát để xem nội suy.","Select keys to change Step / Linear / Smooth. Play to preview interpolation."],["Lưu JSON để làm tiếp. Xuất GLB; FBX và .blend có script chạy trong Blender.","Save JSON to continue later. Export GLB; FBX and .blend use a Blender script."],["FK: xoay theo chuỗi xương. IK: kéo bàn tay/chân tới đích; Pole quyết định hướng gập. Local: trục khớp. World: trục cảnh.","FK rotates a bone chain. IK positions a hand/foot target; the pole sets bend direction. Local uses joint axes; World uses scene axes."],["Ctrl Z: Undo · Ctrl Shift Z: Redo · Space: phát/tạm dừng · K: ghi key · Escape: hủy kéo. Root có thể di chuyển theo animation.","Ctrl Z: Undo · Ctrl Shift Z: Redo · Space: play/pause · K: insert key · Escape: cancel drag. Root can move with the animation."],["Metarig đầu ra là skeleton tham chiếu và animation đã bake. Metadata Rigify/Generate Rig cần mẫu .blend riêng, chưa thể bảo đảm từ FBX/GLB.","Metarig output is the reference skeleton with baked animation. Rigify/Generate Rig metadata requires a dedicated .blend template and cannot be guaranteed from FBX/GLB."],["Đối chiếu chỉ đọc và báo cáo; không tự sửa bone roll hoặc rest của file gốc.","Comparison inspects and reports; it does not modify bone roll or source rest transforms."]]),localeOriginals=new WeakMap();
for(const [vi,en] of [['CONTROL RIG · NHÓM ĐIỀU KHIỂN','CONTROL RIG · GROUPS'],['Thân','Body'],['Tay','Arms'],['Chân','Legs'],['Ngón','Fingers'],['Xương gốc','Original bones'],['Cỡ control','Control size'],['Trái','Left'],['Phải','Right'],['Click vòng để xoay FK. Kéo hộp IK/Pole để đặt tay, chân; kéo Root để di chuyển cả nhân vật.','Click FK rings to rotate. Drag IK/Pole boxes to pose limbs and Root to move the character.'],['Snap về pose','Snap to pose'],['FK xoay khớp; IK kéo tay/chân, Pole điều khiển hướng gập. Chọn control trong khung 3D.','FK rotates joints; IK positions limbs and Pole sets bend direction. Select a control in the viewport.']])localeMap.set(vi,en);
for(const [vi,en]of [['Dự án & bộ xương','Project & rig'],['Đường cong XYZ','XYZ curves'],['Transform · Vị trí & xoay','Transform · Position & rotation'],['Hông','Hips'],['Ngực','Chest'],['Đầu','Head'],['Cây rig','Rig tree'],['Cây','Tree'],['Thuộc tính','Inspector'],['Xuất','Export'],['Tệp','File'],['Nhãn chọn','Selection labels'],['All Body · Toàn thân','All Body'],['Khớp / Control','Joint / Control'],['Chọn key','Key selection'],['Chọn toàn thân tại frame','Select body keys at frame'],['Kiểu control','Control style'],['Khớp chọn','Selected joint'],['Tắt','Off'],['Tất cả','All'],['Cơ bản','Basic'],['Hiển thị rig & trục','Rig visibility & axes'],['Hình control & nhóm','Control shapes & groups'],['Độ dày nét','Line width'],['Cỡ nhãn','Label size'],['Cỡ gizmo','Gizmo size'],['Khôi phục bố cục','Reset layout']])localeMap.set(vi,en);
for(const [vi,en]of [['Trái','Left'],['Phải','Right']])for(const [limb,english]of [['Tay','Arm'],['Chân','Leg']])for(const kind of ['IK','Pole'])localeMap.set(kind+' · '+vi+' · '+limb,kind+' · '+en+' · '+english);
for(const[vi,en]of [["Bóng pose", "Onion Skin"], ["Bóng pose (Onion Skin)", "Onion Skin"], ["Bật bóng pose", "Enable Onion Skin"], ["Cách lấy bóng", "Sampling"], ["Theo khoảng cách", "At intervals"], ["Theo keyframe", "At keyframes"], ["Số bóng trước", "Previous ghosts"], ["Số bóng sau", "Next ghosts"], ["Khoảng cách", "Spacing"], ["Đơn vị", "Unit"], ["Thành phần bóng", "Ghost parts"], ["Chỉ nhân vật", "Character only"], ["Chỉ xương", "Bones only"], ["Nhân vật + xương", "Character + bones"], ["Độ mờ nhân vật", "Character transparency"], ["Độ mờ xương", "Bone transparency"], ["Mờ dần theo khoảng cách", "Fade with distance"], ["Màu bóng trước", "Previous ghost color"], ["Màu bóng sau", "Next ghost color"], ["Hiện khi phát", "Show during playback"], ["Khôi phục Bóng pose", "Reset Onion Skin"], ["Hiện các tư thế trước và sau; chỉ nhân vật hiện tại được chỉnh sửa.", "Show previous and next poses; edit the current character."], ["Lấy mẫu cách đều hoặc tại các thời điểm đã ghi key gần nhất.", "Sample at regular intervals or at the nearest keyed times."], ["Số tư thế cũ, từ 0 đến 100.", "Previous pose count, from 0 to 100."], ["Số tư thế sắp tới, từ 0 đến 100.", "Next pose count, from 0 to 100."], ["Khoảng thời gian giữa hai bóng liên tiếp.", "Time between neighboring ghosts."], ["Frame dùng FPS clip; 20 tick = 1 giây.", "Frames use clip FPS; 20 ticks = 1 second."], ["Hiện cả cơ thể và khung xương hoặc chỉ một thành phần. Không mesh thì dùng xương line.", "Show character and bones together or separately. Rigs without meshes use bone lines."], ["0% rõ hoàn toàn; 100% trong suốt. Chỉ áp dụng cho cơ thể bóng.", "0% is opaque; 100% is transparent. Applies to the ghost character."], ["Điều chỉnh xương line riêng; không đổi độ mờ cơ thể.", "Adjust bone lines separately from character transparency."], ["Bóng xa thời điểm hiện tại nhạt hơn.", "Poses farther from the current time are fainter."], ["Màu tư thế trước playhead.", "Color of poses before the playhead."], ["Màu tư thế sau playhead.", "Color of poses after the playhead."], ["Tiếp tục hiện bóng khi chạy animation; có thể tăng tải máy.", "Keep ghosts visible during playback; increases processing load."]])localeMap.set(vi,en);
for(const[vi,en]of [['Transform · Vị trí, xoay & tỉ lệ','Transform · Position, rotation & scale'],['Xoay (Rotation) · độ','Rotation · degrees'],['Vị trí (Position)','Position'],['Tỉ lệ (Scale)','Scale'],['Áp dụng cho','Apply to'],['Tỉ lệ xương','Bone proportions'],['Hình dáng skin · giữ nguyên khớp','Skin shape · preserve joints'],['Khóa XYZ','Lock XYZ'],['Rest tỉ lệ','Reset scale'],['Cài đặt · kéo để di chuyển','Settings · drag to move'],['Preset toàn bộ cài đặt','All settings preset'],['Lưu preset','Save preset'],['Nạp preset','Load preset']])localeMap.set(vi,en);
function translateUI(){const english=$('uiLanguage').value==='en';document.documentElement.lang=english?'en':'vi';const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);let node;while(node=walker.nextNode()){if(node.parentElement?.closest('script,style'))continue;let original=localeOriginals.get(node);if(original===undefined){original=node.nodeValue;localeOriginals.set(node,original);}const key=original.trim(),translated=localeMap.get(key);if(translated)node.nodeValue=english?original.replace(key,translated):original;}for(const [id,vi,en]of [['boneSearch','Tên hoặc bộ phận…','Name or body part…']])$(id).placeholder=english?en:vi;}



function pickOnionPose(ray,nodeDistance=Infinity){
 if(!$('onionEnabled').checked||!onion.group.visible)return false;const hits=[];ray.params.Line.threshold=.015;
 for(const [i,slot]of onion.slots.entries()){if(!onion.samples[i])continue;slot.rig.root.updateMatrixWorld(true);for(const object of [...(slot.wrapper.visible?slot.rig.mesh.filter(m=>m.visible):[]),...(slot.line.visible?[slot.line]:[])])for(const hit of ray.intersectObject(object,false))hits.push({...hit,time:onion.samples[i].time});}
 const hit=hits.sort((a,b)=>a.distance-b.distance)[0];if(!hit||nodeDistance<hit.distance-.01)return false;
 if($('showMesh').checked&&$('meshFaces').checked){const current=ray.intersectObjects(rig.mesh.filter(m=>m.visible))[0];if(current&&current.distance<hit.distance-.01)return false;}
 if(draft&&!confirm('Pose hiện tại chưa ghi key. Bỏ pose chưa ghi để chuyển tới bóng?'))return true;
 playing=false;seek(hit.time);$(mode==='rig'?'rigShowBones':'showBones').checked=true;select(selected);info('Đã chuyển tới bóng pose · '+Math.round(hit.time*project.fps)+' frame. Không tự tạo key.');return true;
}
function focusSelected(){if(mode==='compare')return;const v=activeEditView,o=currentObject();if(!o)return;const p=o.getWorldPosition(new T.Vector3()),direction=v.camera.position.clone().sub(v.orbit.target).normalize(),distance=T.MathUtils.clamp(Number($('focusDistance').value)||.9,.2,5);v.orbit.target.copy(p);v.camera.position.copy(p).addScaledVector(direction,distance);if(v.orthographic){v.camera.zoom=(v.camera.top-v.camera.bottom)/distance;v.camera.updateProjectionMatrix();}v.orbit.update();v.dirty=true;}
function resetThreeQuarter(v){
 setupViewPreset(v,'reset');const box=new T.Box3().setFromObject(v.rig?.root||v.wrapper);
 if(v.rig)for(const rec of v.rig.records)box.expandByPoint(rec.o.getWorldPosition(new T.Vector3()));
 if(!box.isEmpty()){
  const center=box.getCenter(new T.Vector3()),radius=Math.max(.4,box.getSize(new T.Vector3()).length()/2),direction=new T.Vector3(2,-3.3,.65).normalize();if(!v.edit&&v.displayUp!=='z')direction.applyQuaternion(C.kinematics.blenderBasis.clone().invert());
  v.orbit.target.copy(center);
  if(v.orthographic){const aspect=v.container.clientWidth/Math.max(1,v.container.clientHeight);v.camera.zoom=1.7/(radius/Math.min(1,aspect));v.camera.position.copy(center).addScaledVector(direction,5);}
  else{const fov=T.MathUtils.degToRad(v.camera.fov/2),aspect=v.container.clientWidth/Math.max(1,v.container.clientHeight),angle=Math.min(fov,Math.atan(Math.tan(fov)*aspect));v.camera.position.copy(center).addScaledVector(direction,radius/Math.sin(angle)*1.12);}
 }
 v.camera.updateProjectionMatrix();const sync=$('syncCameras').checked;if(!v.edit)$('syncCameras').checked=false;v.orbit.update();$('syncCameras').checked=sync;v.dirty=true;
 if(v.presetSelect)v.presetSelect.value='reset';else if(v.edit)$('cameraPreset').value='reset';
}
function clampSettingsWindow(){const d=$('settings'),r=d.getBoundingClientRect();d.style.left=Math.max(0,Math.min(innerWidth-r.width,r.left))+'px';d.style.top=Math.max(0,Math.min(innerHeight-60,r.top))+'px';}
function openSettings(group){if(group)selectStudioSettings(group);if(!$('settings').open)$('settings').show();clampSettingsWindow();}
function setupSettingsWindow(){
 const title=$('settingsTitle'),dialog=$('settings');let drag;
 title.addEventListener('pointerdown',e=>{if(e.button!==0||e.target.closest('button'))return;const r=dialog.getBoundingClientRect();drag={x:e.clientX,y:e.clientY,left:r.left,top:r.top,id:e.pointerId};title.setPointerCapture(e.pointerId);e.preventDefault();});
 title.addEventListener('pointermove',e=>{if(!drag||drag.id!==e.pointerId)return;dialog.style.left=drag.left+e.clientX-drag.x+'px';dialog.style.top=drag.top+e.clientY-drag.y+'px';clampSettingsWindow();});
 const end=()=>{if(!drag)return;const id=drag.id;drag=null;if(title.hasPointerCapture(id))title.releasePointerCapture(id);};
 for(const ev of ['pointerup','pointercancel','lostpointercapture'])title.addEventListener(ev,end);
 dialog.addEventListener('close',end);window.addEventListener('blur',end);window.addEventListener('resize',()=>{if(dialog.open)clampSettingsWindow();});
 window.addEventListener('keydown',e=>{if(e.key==='Escape'&&dialog.open){e.preventDefault();dialog.close();}});
}
function cameraSnapshot(v){return {p:v.camera.position.toArray(),target:v.orbit.target.toArray(),zoom:v.camera.zoom,ortho:v.orthographic};}
function settingsPreset(){const settings=readSettings();delete settings.sourceUnits;return {type:'animation-studio-settings',version:1,coordinateSystem:'blender-z-up',settings,workspaceLayout:workspaceSnapshot(),cameras:{edit:editViews.map(cameraSnapshot),A:cameraSnapshot(compareA),B:cameraSnapshot(compareB)}};}
function loadSettingsPreset(data){
 if(!data||data.type!=='animation-studio-settings'||data.version!==1||!data.settings||typeof data.settings!=='object'||Array.isArray(data.settings))throw Error('Không phải preset cài đặt phiên bản 1.');
 const settings={};
 for(const[id,value]of Object.entries(data.settings)){
  if(!settingIds.includes(id)||id==='sourceUnits')continue;const el=$(id);
  if(el.type==='checkbox'){if(typeof value!=='boolean')throw Error('Preset checkbox sai: '+id);settings[id]=value;}
  else if(el.tagName==='SELECT'){if(![...el.options].some(o=>o.value===String(value)))throw Error('Preset lựa chọn sai: '+id);settings[id]=String(value);}
  else if(el.type==='range'){if((typeof value!=='number'&&typeof value!=='string')||String(value).trim()===''||!Number.isFinite(+value))throw Error('Preset số sai: '+id);settings[id]=Math.max(+el.min,Math.min(+el.max,+value));}
  else if(el.type==='color'){if(typeof value!=='string'||!/^#[0-9a-f]{6}$/i.test(value))throw Error('Preset màu sai: '+id);settings[id]=value;}
  else if(['motionLayerX','motionLayerY'].includes(id)){if((typeof value!=='number'&&typeof value!=='string')||String(value).trim()===''||!Number.isFinite(+value)||+value< -1||+value>100000)throw Error('Tọa độ bảng nổi không hợp lệ: '+id);settings[id]=String(value);}
 }
 if(data.workspaceLayout&&(data.workspaceLayout.version!==1||!data.workspaceLayout.workspaces||typeof data.workspaceLayout.workspaces!=='object'||Array.isArray(data.workspaceLayout.workspaces)))throw Error('Bố cục preset không hợp lệ.');
 const cameras=data.cameras||{};
 if(cameras.edit&&(!Array.isArray(cameras.edit)||cameras.edit.length>4))throw Error('Camera preset không hợp lệ.');
 const valid=c=>c&&['p','target'].every(k=>Array.isArray(c[k])&&c[k].length===3&&c[k].every(v=>Number.isFinite(v)&&Math.abs(v)<10000))&&typeof c.ortho==='boolean'&&Number.isFinite(c.zoom)&&c.zoom>=.01&&c.zoom<=100&&c.p.some((v,i)=>Math.abs(v-c.target[i])>1e-6);
 for(const c of [...(cameras.edit||[]),cameras.A,cameras.B].filter(c=>c!==undefined))if(!valid(c))throw Error('Camera preset không hợp lệ.');
 // Validate everything before changing any setting; source units belong to the model.
 applySettings(data.coordinateSystem==='blender-z-up'?settings:V.blenderSettings(settings));if(data.workspaceLayout)loadWorkspaceLayout(data.workspaceLayout);
 const apply=(v,c)=>{if(!v||!c)return;V.projection(v,c.ortho);v.camera.position.fromArray(c.p);v.camera.zoom=c.zoom;v.orbit.target.fromArray(c.target);if(data.coordinateSystem!=='blender-z-up'){C.kinematics.blenderPoint(v.camera.position);C.kinematics.blenderPoint(v.orbit.target);}v.camera.updateProjectionMatrix();v.orbit.update();syncProjectionButton(v);v.dirty=true;};
 const sync=$('syncCameras').checked;$('syncCameras').checked=false;for(const[i,c]of (cameras.edit||[]).entries())apply(editViews[i],c);apply(compareA,cameras.A);apply(compareB,cameras.B);$('syncCameras').checked=sync;
 info('Đã nạp preset cài đặt; model, pose và keyframe được giữ.');
}
function setupNumericInputs(){
 for(const input of document.querySelectorAll('input[type=number]')){input.dataset.number='true';input.type='text';input.inputMode='decimal';input.addEventListener('focus',()=>input.select());input.addEventListener('click',()=>input.select());input.addEventListener('keydown',e=>{if(!['ArrowUp','ArrowDown'].includes(e.key))return;const n=Number(input.value);if(!input.value.trim()||!Number.isFinite(n))return;e.preventDefault();let v=n+(e.key==='ArrowUp'?1:-1)*(Number(input.step)||1);if(input.min!=='')v=Math.max(+input.min,v);if(input.max!=='')v=Math.min(+input.max,v);input.value=String(+v.toFixed(8));input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));input.select();});}
 const kinds={rx:'q',ry:'q',rz:'q',px:'p',py:'p',pz:'p',sx:'s',sy:'s',sz:'s'};
 const restore=drag=>{project=C.clone(drag.before.project);S.apply(rig,project.skinAdjustments);for(const[id,p]of Object.entries(drag.before.pose))C.apply(id==='root'?rig.root:record(rig,id).o,p);for(const[id,p]of Object.entries(drag.before.controls))C.apply(rig.controls[id].object,p);for(const[id,m]of drag.before.modes)rig.chains.find(c=>c.id===id).mode=m;draft=drag.before.draft;rig.root.updateMatrixWorld(true);};
 const end=cancel=>{const drag=numericDrag;if(!drag)return;numericDrag=null;document.body.classList.remove('number-drag');if(drag.input.hasPointerCapture(drag.pointer))drag.input.releasePointerCapture(drag.pointer);if(drag.moved){if(cancel){restore(drag);drag.input.value=drag.value;refresh();}else if(drag.kind==='s'&&$('scaleTarget').value==='skin'){onion.clear();commit();refresh();}else markPose();}};
 for(const[id,kind]of Object.entries(kinds)){
  const input=$(id);
  input.addEventListener('pointerdown',e=>{if(e.button!==0||input.disabled||numericDrag)return;input.focus({preventScroll:true});input.select();numericDrag={input,kind,pointer:e.pointerId,x:e.clientX,value:input.value,n:Number(input.value),before:snapshot(),moved:false};input.setPointerCapture(e.pointerId);e.preventDefault();});
  input.addEventListener('pointermove',guard(e=>{const drag=numericDrag;if(!drag||drag.input!==input||drag.pointer!==e.pointerId)return;const dx=e.clientX-drag.x;if(!drag.moved&&Math.abs(dx)<4)return;drag.moved=true;document.body.classList.add('number-drag');let n=drag.n+dx*(kind==='q'?1:kind==='s'?.01:.1)*(e.shiftKey?.1:1);if(kind==='s')n=Math.max(.05,Math.min(5,n));input.value=n.toFixed(3);numericPose(kind,false,id);e.preventDefault();}));
  input.addEventListener('pointerup',()=>end(false));input.addEventListener('pointercancel',()=>end(true));input.addEventListener('lostpointercapture',()=>{if(numericDrag?.input===input)end(false);});
 }
 window.addEventListener('keydown',e=>{if(e.key==='Escape'&&numericDrag){e.preventDefault();e.stopImmediatePropagation();end(true);}},{capture:true});window.addEventListener('blur',()=>end(true));
}
listen('saveSettingsPreset','click',()=>download(JSON.stringify(settingsPreset(),null,2),'AnimationStudio_settings.json','application/json'));
listen('settingsPresetInput','change',async e=>{try{const f=e.target.files[0];if(!f)return;if(f.size>1024*1024)throw Error('Preset quá lớn (1 MB).');loadSettingsPreset(JSON.parse(await f.text()));}finally{e.target.value='';}});

for(const preset of C.easing.presets.filter(p=>p.id!=='linear')){const option=document.createElement('option');option.value=preset.id;option.textContent=preset.name;$('interpolation').append(option);}
easingPanel=new EasingPanel($('viewportGrid'),{state:scope=>({count:easingRefs(scope).length,preview:!!easingPreview}),action:guard(easingAction)});
listen('easingBtn','click',()=>{cancelEasingPreview();smoothingPanel.hide();easingPanel.open($('interpolation').value,Number($('easingStrength').value)/100);});
smoothingPanel=new SmoothingPanel($('viewportGrid'),{state:()=>({lab:!!project?.lab,loop:project?.loop||[0,2],fps:project?.fps||30,preview:easingPreview?.tool==='smoothing'}),action:guard(smoothingAction)});
listen('smoothingBtn','click',()=>{cancelEasingPreview();easingPanel.hide();smoothingPanel.open();});
document.addEventListener('pointerdown',e=>{if(easingPreview&&!e.target.closest('#easingPanel,#smoothingPanel,#graphPanel,#playBtn,#speedInput,#loop'))cancelEasingPreview();},true);
motionPanel=new MotionPanel($('viewportGrid'),{state:motionPanelState,action:(...args)=>{try{return motionAction(...args);}catch(e){info(e.message,true);}},position:(x,y)=>{$('motionLayerX').value=Number.isFinite(x)?Math.max(0,x):-1;$('motionLayerY').value=Number.isFinite(y)?Math.max(0,y):-1;try{localStorage.setItem('animation-studio-settings',JSON.stringify(readSettings()));}catch{}syncMotionPanel();}});
graphEditor=new GraphEditor($('graphPanel'),{state:graphState,action:graphAction});
$('timeline').addEventListener('pointerdown',e=>{if(e.button===0)$('timeline').focus({preventScroll:true});});
// File picker keeps its normal lifecycle; only the surrounding menu closes.
document.addEventListener('pointerdown',e=>{if(!$('fileMenu').contains(e.target))$('fileMenu').open=false;});
window.addEventListener('keydown',e=>{if(e.key==='Escape')$('fileMenu').open=false;});
$('projectInput').addEventListener('change',()=>{$('fileMenu').open=false;});

function resetTransformValue(id){const o=currentObject();if(!o)return;const kind=id[0]==='r'?'q':id[0]==='s'?'s':'p',axis='xyz'.indexOf(id[1]);if(kind==='s'){const lock=$('scaleUniform').checked;$('scaleUniform').checked=false;try{$(id).value=1;numericPose(kind,true,id);}finally{$('scaleUniform').checked=lock;}return;}const rec=record(rig,selected),rest=selected==='root'?rig.rootRest:rig.controls[selected]?.rest||rec?.rest;if(!rest)return;let values;if(kind==='q'){const q=new T.Quaternion().fromArray(rest.q);if($('space').value==='world'&&o.parent)q.premultiply(o.parent.getWorldQuaternion(new T.Quaternion()));const e=new T.Euler().setFromQuaternion(q,'XYZ');values=[e.x,e.y,e.z].map(deg);}else{const v=new T.Vector3().fromArray(rest.p);if($('space').value==='world'&&o.parent)o.parent.localToWorld(v);values=v.toArray();}$(id).value=values[axis];numericPose(kind,true,id);}
for(const id of ['rx','ry','rz','px','py','pz','sx','sy','sz']){const button=document.createElement('button');button.type='button';button.className='reset-value';button.textContent='↺';button.setAttribute('aria-label','Reset '+id+' về tư thế gốc');button.title='Hồi riêng giá trị Rest của ô này';button.addEventListener('click',guard(()=>resetTransformValue(id)));$(id).parentElement.append(button);}
for(const option of [...$('rigStyle').options].filter(o=>!['basic'].includes(o.value))){const b=document.createElement('button');b.type='button';b.textContent=option.textContent;b.dataset.rigPreset=option.value;b.onclick=()=>{$('rigStyle').value=option.value;$('rigStyle').dispatchEvent(new Event('change'));$('rigPresetMenu').open=false;};$('rigPresetChoices').append(b);}
listen('timelineUnit','change',()=>{syncTime();syncProject();if(selectionKeys.length)$('keyFrame').value=+(Math.min(...selectionKeys.map(k=>k.time))*timelineRate()).toFixed(3);});
const interpolationNames={linear:['Linear','Tuyến tính'],step:['Step','Giữ pose'],smooth:['Smooth','Êm đầu/cuối'],auto:['Auto','Tiếp tuyến tự động'],cubic:['Cubic spline','Spline nhiều key']};
function interpolationLabel(id){const pair=interpolationNames[id];if(pair)return pair.join(' | ');const p=C.easing.presets.find(p=>p.id===id);return p?p.name+' | '+p.description:id;}
function syncInterpolationChoice(){if(!$('interpolationPicker'))return;$('interpolationPicker').textContent=interpolationLabel($('interpolation').value)+' ▾';}
const interpolationWindow=document.createElement('section');interpolationWindow.id='interpolationWindow';interpolationWindow.className='interpolation-window';interpolationWindow.hidden=true;interpolationWindow.setAttribute('role','dialog');interpolationWindow.setAttribute('aria-label','Chọn nội suy bằng hình');
for(const option of $('interpolation').options){const b=document.createElement('button');b.type='button';b.dataset.interpolation=option.value;const curve=option.value==='auto'||option.value==='cubic'?'smooth':option.value;const path=Array.from({length:41},(_,i)=>{const u=i/40,y=C.easing.progress(u,{interp:curve});return(i?'L':'M')+(6+u*96).toFixed(1)+' '+(46-y*36).toFixed(1);}).join(' ');b.innerHTML='<svg viewBox="0 0 108 56" aria-hidden="true"><path d="M6 8V46H102" class="curve-axis"/><path d="'+path+'" class="curve-line"/></svg>';const label=document.createElement('span');label.textContent=interpolationLabel(option.value);b.append(label);if(['auto','cubic'].includes(option.value))b.title='Hình minh họa; đường cong thực phụ thuộc nhiều key và tiếp tuyến.';b.onclick=()=>{$('interpolation').value=option.value;syncInterpolationChoice();interpolationWindow.hidden=true;$('interpolationPicker').setAttribute('aria-expanded','false');};interpolationWindow.append(b);}
document.body.append(interpolationWindow);listen('interpolationPicker','click',()=>{const rect=$('interpolationPicker').getBoundingClientRect();interpolationWindow.hidden=!interpolationWindow.hidden;interpolationWindow.style.left=Math.max(8,Math.min(innerWidth-600,rect.left))+'px';interpolationWindow.style.top=Math.max(8,Math.min(innerHeight-420,rect.top-420))+'px';$('interpolationPicker').setAttribute('aria-expanded',String(!interpolationWindow.hidden));});
document.addEventListener('pointerdown',e=>{if(!e.target.closest('#interpolationWindow,#interpolationPicker')){interpolationWindow.hidden=true;$('interpolationPicker').setAttribute('aria-expanded','false');}if(!e.target.closest('#rigPresetMenu'))$('rigPresetMenu').open=false;});
window.addEventListener('keydown',e=>{if(e.key==='Escape'){interpolationWindow.hidden=true;$('rigPresetMenu').open=false;$('interpolationPicker').setAttribute('aria-expanded','false');}});
syncInterpolationChoice();

viewportToolbar=new ViewportToolbar($('viewportGrid'),{changed:persist=>{dirtyViews();if(persist)try{localStorage.setItem('animation-studio-settings',JSON.stringify(readSettings()));}catch{}},reset:()=>{applySettings({...Ground.defaults,meshPoints:false,meshLines:false,meshFaces:true,meshTexture:true,meshSmooth:true,meshFront:false,meshOverlay:false,meshDoubleSided:true,viewGridXZ:false,viewGridXY:true,viewGridYZ:false,viewWorldAxes:false,background:'#171b20'});viewportToolbar.sync();}});
for(const id of ['meshPoints','meshLines','meshFaces','meshTexture','meshSmooth','meshFront','meshOverlay','meshDoubleSided','viewGridXZ','viewGridXY','viewGridYZ','viewWorldAxes','background'])listen(id,'change',()=>{viewportToolbar.sync();dirtyViews();});
listen('inPlace','change',()=>{if(sourcePreview){sourcePreview.inPlace=$('inPlace').checked;seekSourceClip(time);return;}if(draft){$('inPlace').checked=!!project.inPlace;info('Ghi key hoặc hủy pose chưa ghi trước khi đổi Đi tại chỗ.',true);return;}project.inPlace=$('inPlace').checked;C.evaluate(rig,project,time);commit();refresh();});
listen('inPlaceExport','change',()=>{project.inPlaceExport=$('inPlaceExport').checked;commit();});
document.addEventListener('visibilitychange',()=>{if(document.hidden){scenePlaying=false;if(playing){playing=false;syncTime();}if(editorSlots.B)editorSlots.B.playing=false;}lastStamp=performance.now();});
for(const event of ['focusin','click'])document.addEventListener(event,e=>{if(!numericDrag&&e.target.matches('input[type=number],input[data-number=true]'))e.target.select();});
setupModernUI();setupNumericInputs();setupSettingsWindow();applyMouseSettings();
try{const settings=JSON.parse(localStorage.getItem('animation-studio-settings')||'null');if(settings)applySettings(V.blenderSettings(settings));}catch{}
$('syncCameras').checked=false;
window.__studio={
 setHostActive(active){if(active&&!hostActive){hostActive=true;lastStamp=performance.now();requestAnimationFrame(frame);}else if(!active)hostActive=false;},
 graph:()=>graphEditor,graphAction,previewSourceClip,endSourcePreview,useQuickClip,
 dual:{enable:setDualEnabled,activate:activateEditorSlot,mode:setDualTimeline,slots:()=>({active:activeEditorSlot,enabled:dualEnabled,timeline:dualTimelineMode,A:editorSlots.A?.project.name,B:editorSlots.B?.project.name})},
 get state(){return{sourceClip:sourcePreview?{index:sourcePreview.index,time:sourcePreview.time,duration:sourcePreview.duration}:null,project:C.clone(project),time,selected,draft,dirty,mode,studioMode,errors:[...errors],bones:rig?.records.length,profile:rig?.profile,onionRevision,ik:rig?.chains.map(c=>({id:c.id,mode:c.mode,outOfReach:c.outOfReach})),historyIndex};},
 select,selectUser,seek,installAsset:loadModel,loadProject,switchStudioMode,project:()=>C.clone(project),pose:()=>C.capture(rig),controls:()=>Object.fromEntries(Object.entries(rig.controls).map(([id,c])=>[id,C.snap(c.object)])),recordNames:()=>rig.records.map(r=>({id:r.id,name:r.name,parent:r.parent})),buildGLB,
 onion:()=>onion,onionCore:O,report,loadCompare,retarget:C.retarget,core:C,rig:()=>rig,get view(){return editView;},editorViews:()=>editViews,widgetPick:W.pick,views:{get edit(){return editView;},A:compareA,B:compareB},
 compareDebug:{tick:tickCompare,sample:compareSamplePose,state:side=>({clip:comparison[side].clip,time:comparison[side].time,playing:comparison[side].playing})},
 async exportCapture(){const r=await buildGLB();return{...r,data:base64(r.data)};},
 settingsPreset:settingsPreset,loadSettingsPreset,boneSide,constrainPose,solvePoseIK,
 serialized(embed=true){const p=C.clone(project);p.parallelModes=parallelSave();p.rig.asset=embed?rig.asset:null;if(rig.isBOBJ)p.rig.bobjEulerOrder=rig.bobjEulerOrder;p.settings=readSettings();p.workspaceMode=mode;p.selected=selected;p.workspaceLayout=workspaceSnapshot();return p;},
 apiTests(){const checks=[];const rest={p:[0,0,0],q:[0,0,0,1],s:[1,1,1]},a={...rest,time:0,interp:'linear'},b={...rest,p:[10,0,0],q:new T.Quaternion().setFromEuler(new T.Euler(0,Math.PI/2,0)).toArray(),time:1,interp:'linear'};const m=C.sampleKeys([a,b],.5,rest);checks.push({name:'linear quaternion normalized',ok:Math.abs(m.p[0]-5)<1e-8&&Math.abs(new T.Quaternion().fromArray(m.q).length()-1)<1e-8});a.interp='step';checks.push({name:'step holds',ok:C.sampleKeys([a,b],.5,rest).p[0]===0});a.interp='smooth';checks.push({name:'smooth differs at quarter',ok:Math.abs(C.sampleKeys([a,b],.25,rest).p[0]-1.5625)<1e-8});checks.push({name:'CSV formula escaping',ok:C.csvCell('=1+1').startsWith('"\'')});return checks;}
};
setupModernWorkspace();setupMinimalUX();setupStudioWorkspace();setupQuickAnimation();setupStudioDebug();await loadModel(sampleBytes(),'Mixamo T-Pose.fbx',true);setMode('rig');await initializeDualEditor();syncWorkspaceTools();minimalBooting=false;syncMinimalUI();setupDirector();window.__studio.ready=true;requestAnimationFrame(frame);



// UI adapters preserve the existing rig, keyframe and export controllers.

function syncWorkspaceTools(){
 const pole=selected.startsWith('pole_'),control=!!rig?.controls[selected],locked=!!(rig&&boneIKChain());
 for(const b of document.querySelectorAll('[data-transform-tool]')){const tool=b.dataset.transformTool;b.disabled=locked||pole&&tool!=='translate'&&tool!=='select'||control&&tool==='scale';const active=workspaceSelectOnly?tool==='select':tool===$('transformMode').value;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));}
 if(workspaceSelectOnly)for(const v of editViews){v.gizmo.detach();v.moveGizmo.detach();}
}
function setupModernWorkspace(){
 const grip=document.querySelector('.left-resize');grip.setAttribute('aria-label','Đổi chiều cao Rig / Pose');grip.setAttribute('aria-orientation','horizontal');
 for(const b of document.querySelectorAll('[data-editor-tab]'))b.onclick=()=>{setAnimationEditor(b.dataset.editorTab);persistLayout();};
 for(const b of document.querySelectorAll('[data-transform-tool]'))b.onclick=()=>{workspaceSelectOnly=b.dataset.transformTool==='select';if(!workspaceSelectOnly){$('transformMode').value=b.dataset.transformTool;$('transformMode').dispatchEvent(new Event('change'));}syncWorkspaceTools();};
 $('transformMode').addEventListener('change',()=>{workspaceSelectOnly=false;if(rig)for(const v of editViews)configureGizmo(v);syncWorkspaceTools();});
 const observer=new MutationObserver(()=>syncWorkspaceTools());observer.observe($('selectedTag'),{childList:true,subtree:true});
 const results=document.querySelector('.compare-results'),sidebar=document.createElement('aside');sidebar.id='compareSidebar';sidebar.className='panel';sidebar.append(results.querySelector('.row'),results.querySelector('.comparison-details'));$('compareWorkspace').append(sidebar);
 const resize=document.createElement('div');resize.className='compare-side-resize';resize.setAttribute('role','separator');resize.setAttribute('aria-label','Đổi rộng thông tin đối chiếu');resize.tabIndex=0;$('compareWorkspace').append(resize);let drag=null;
 const width=n=>{$('compareWorkspace').style.setProperty('--compare-side-width',Math.max(230,Math.min(innerWidth*.45,n))+'px');compareA.dirty=true;compareB.dirty=true;};
 resize.onpointerdown=e=>{if(e.button)return;drag={x:e.clientX,w:sidebar.clientWidth};resize.setPointerCapture(e.pointerId);e.preventDefault();};resize.onpointermove=e=>{if(drag)width(drag.w+drag.x-e.clientX);};resize.onpointerup=resize.onpointercancel=resize.onlostpointercapture=()=>drag=null;resize.onkeydown=e=>{if(['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();width(sidebar.clientWidth+(e.key==='ArrowLeft'?10:-10));}};
 const update=()=>{syncWorkspaceTools();};$('modeRig').addEventListener('click',update);$('modeCreate').addEventListener('click',update);
}


function setupMinimalDOM(){
 document.body.classList.add('minimal-studio');
 const hidden=(id,type,value)=>{const input=document.createElement('input');input.id=id;input.type=type;input.hidden=true;if(type==='checkbox')input.checked=value;else input.value=value;document.body.append(input);return input;};
 hidden('uiSidebarOpen','checkbox',true);hidden('uiSidebarTab','text','properties');const ratio=hidden('compareSplit','range','.5');ratio.min='.2';ratio.max='.8';ratio.step='.01';ratio.value='.5';
 const themes=document.createElement('details');themes.id='minimalThemeSettings';themes.open=true;themes.innerHTML='<summary>Giao diện · 20 preset màu</summary><label class="field">Preset<select id="uiThemePreset"></select></label><div id="themeSwatches" class="theme-swatches" hidden></div><details><summary>Chỉnh màu</summary><div id="themeColorFields"></div><label class="field">Nền khung 3D<input id="minimalViewportColor" type="color"></label><button type="button" id="resetThemeColors">Khôi phục màu preset</button><small>Chữ tự cân tương phản khi đổi màu nền. Màu XYZ và trạng thái chọn khớp giữ ý nghĩa riêng.</small></details>';
 $('appPresetSettings').after(themes);
 for(const light of [true,false]){const group=document.createElement('optgroup');group.label=light?'10 màu sáng':'10 màu tối';minimalThemeNames.forEach((name,i)=>{const option=document.createElement('option');option.value=(light?'light':'dark')+'-'+i;option.textContent=(light?'Sáng · ':'Tối · ')+name;group.append(option);const b=document.createElement('button');b.type='button';b.dataset.themePreset=option.value;b.title=option.textContent;b.setAttribute('aria-label',option.textContent);const p=minimalPalette(light,i);b.style.background=p.uiMain;b.style.color=p.uiText;b.textContent=name;$('themeSwatches').append(b);});$('uiThemePreset').append(group);}
 $('uiThemePreset').value='dark-0';for(const[id,label]of minimalColorFields){const field=document.createElement('label');field.className='field';field.textContent=label;const input=document.createElement('input');input.type='color';input.id=id;input.value=minimalPalette(false,0)[id];field.append(input);$('themeColorFields').append(field);}
 for(const id of ['theme','themeColor'])$(id).closest('label').hidden=true;
 const sidebar=document.createElement('aside');sidebar.id='minimalSidebar';sidebar.innerHTML='<div class="minimal-tabs" role="group" aria-label="Công cụ Animation">'+[['rig','Rig'],['pose','Pose'],['properties','Thuộc tính'],['material','Material'],['export','Xuất']].map(([id,name])=>'<button type="button" data-sidebar="'+id+'">'+name+'</button>').join('')+'<button type="button" id="closeMinimalSidebar" aria-label="Đóng cột công cụ">×</button></div>';
 const library=document.querySelector('.library'),props=document.querySelector('.properties');sidebar.append(library,props);$('createWorkspace').append(sidebar);
 const exportHome=document.createElement('section');exportHome.id='minimalExport';exportHome.className='panel';exportHome.append($('exportPanel'));sidebar.append(exportHome);
 const material=document.createElement('section');material.id='minimalMaterial';material.className='panel';material.innerHTML='<h3>Material / Texture</h3><small>Chọn mesh, gán ảnh riêng hoặc toàn bộ; lưu và mở model cùng texture.</small><button type="button" id="minimalTexture">Mở Texture / Material</button>';sidebar.append(material);
 const advanced=document.createElement('details');advanced.id='minimalAdvanced';advanced.innerHTML='<summary>Tùy chọn nâng cao</summary>';
 for(const id of ['limbOptions','labPanel'])if($(id))advanced.append($(id));props.append(advanced);advanced.open=false;
 const nav=$('modeCreate').parentElement;const rigGroup=document.createElement('span');rigGroup.className='minimal-rig-actions';rigGroup.append($('modeRig'),$('rigPresetMenu'));
 const stageRow=document.querySelector('.stage-toolbar>.row');stageRow.prepend(rigGroup);
 const display=document.createElement('details');display.id='minimalViewMenu';display.className='minimal-menu';display.innerHTML='<summary>Hiển thị ▾</summary><div></div>';const displayBody=display.querySelector('div');
 for(const id of ['meshPointBtn','meshLineBtn','meshFaceBtn','meshFrontBtn','viewportSettingsBtn','textureEditor'])displayBody.append($(id));stageRow.append(display);
 $('toggleTree').textContent='Rig';$('toggleProperties').textContent='Thuộc tính';$('toggleTimeline').textContent='Timeline';
 $('rigPresetMenu').querySelector('div').append(document.querySelector('.rig-stylebar'));
 const keyOptions=document.createElement('details');keyOptions.id='minimalKeyOptions';keyOptions.innerHTML='<summary>Keyframe · nội suy · tùy chọn ▾</summary>';keyOptions.append(document.querySelector('.timeline-controls'),document.querySelector('.key-editor'));$('animationBottom').prepend(keyOptions);
 const speed=document.createElement('details');speed.id='minimalSpeed';speed.className='minimal-menu';speed.innerHTML='<summary id="minimalSpeedLabel">1× ▾</summary><div></div>';for(const el of [...document.querySelectorAll('[data-speed]'),$('speedSlider'),$('speedInput')])speed.querySelector('div').append(el);document.querySelector('.transport').append(speed);
 const timelineRoot=$('animationArea').querySelector('.area-header');const keyQuick=document.createElement('span');keyQuick.className='minimal-key-quick';keyQuick.append($('keyBtn'),$('autoKey').closest('label'));timelineRoot.append(keyQuick);
}
function applyMinimalTheme(settings){
 if(!settings.uiThemePreset&&settings.theme){$('uiThemePreset').value=settings.theme==='light'?'light-0':'dark-0';const old=minimalPalette(settings.theme==='light',0);if(settings.theme==='custom'&&/^#[0-9a-f]{6}$/i.test(settings.themeColor||''))old.uiMain=settings.themeColor;for(const[id]of minimalColorFields)$(id).value=old[id];}
 const light=$('uiThemePreset').value.startsWith('light');document.body.classList.toggle('light',light);document.documentElement.style.colorScheme=light?'light':'dark';
 const contrast=(a,b)=>{const rgb=h=>h.match(/[0-9a-f]{2}/gi).map(x=>parseInt(x,16)/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4),lum=h=>{const r=rgb(h);return .2126*r[0]+.7152*r[1]+.0722*r[2];},x=lum(a),y=lum(b);return(Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
 const actionText=contrast('#000000',$('uiAccent').value)>contrast('#ffffff',$('uiAccent').value)?'#000000':'#ffffff';document.body.style.setProperty('--action-text',actionText);
 const surfaces=['uiMain','uiPanel','uiInput'];for(const id of ['uiText','uiMuted'])if(surfaces.some(s=>contrast($(id).value,$(s).value)<4.5)){const choices=['#101318','#f5f7fa'];$(id).value=choices.sort((a,b)=>Math.min(...surfaces.map(s=>contrast(b,$(s).value)))-Math.min(...surfaces.map(s=>contrast(a,$(s).value))))[0];}
 for(const[id,,token]of minimalColorFields){document.documentElement.style.setProperty(token,$(id).value);document.body.style.setProperty(token,$(id).value);}
 $('minimalViewportColor').value=$('background').value;document.querySelectorAll('[data-theme-preset]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.themePreset===$('uiThemePreset').value)));
}
function chooseMinimalTheme(value){$('uiThemePreset').value=value;const[mode,index]=value.split('-'),palette=minimalPalette(mode==='light',Number(index));for(const[id]of minimalColorFields)$(id).value=palette[id];$('theme').value='custom';$('themeColor').value=palette.uiMain;applySettings(readSettings());}
function syncMinimalUI(){
 if(!$('minimalSidebar'))return;if(!['rig','pose','properties','material','export'].includes($('uiSidebarTab').value))$('uiSidebarTab').value='properties';const tab=$('uiSidebarTab').value,open=$('uiSidebarOpen').checked;
 $('createWorkspace').classList.toggle('minimal-sidebar-closed',!open);document.querySelector('.library').hidden=!['rig','pose'].includes(tab);document.querySelector('.properties').hidden=tab!=='properties';$('minimalMaterial').hidden=tab!=='material';$('minimalExport').hidden=tab!=='export';
 if(['rig','pose'].includes(tab)){$('treeSection').hidden=tab==='pose';$('poseSection').hidden=tab==='rig';}
 document.querySelectorAll('[data-sidebar]').forEach(b=>{b.classList.toggle('active',b.dataset.sidebar===tab);b.setAttribute('aria-pressed',String(b.dataset.sidebar===tab));});
 $('modeCreate').classList.toggle('active',mode!=='compare');$('modeRig').classList.toggle('active',$('rigVisible').checked);$('modeRig').setAttribute('aria-pressed',String($('rigVisible').checked));$('rigOptions').setAttribute('aria-expanded',String($('rigPresetMenu').open));
 $('toggleTree').setAttribute('aria-expanded',String(open&&['rig','pose'].includes(tab)));$('toggleProperties').setAttribute('aria-expanded',String(open&&tab==='properties'));
 syncStudioWorkspace();$('minimalSpeedLabel').textContent=$('speedInput').value+'× ▾';document.querySelector('.compare-grid')?.style.setProperty('--compare-split',Number($('compareSplit').value)*100+'%');
}
function showMinimalSidebar(tab,toggle=false){if(toggle&&$('uiSidebarTab').value===tab&&$('uiSidebarOpen').checked)$('uiSidebarOpen').checked=false;else{$('uiSidebarTab').value=tab;$('uiSidebarOpen').checked=true;}syncMinimalUI();try{localStorage.setItem('animation-studio-settings',JSON.stringify(readSettings()));}catch{}editView.dirty=true;}
function setupMinimalUX(){
 document.querySelectorAll('[data-sidebar]').forEach(b=>b.onclick=()=>showMinimalSidebar(b.dataset.sidebar));$('closeMinimalSidebar').onclick=()=>{$('uiSidebarOpen').checked=false;syncMinimalUI();try{localStorage.setItem('animation-studio-settings',JSON.stringify(readSettings()));}catch{}};
 for(const[id,tab]of [['toggleTree','rig'],['toggleProperties','properties']])$(id).addEventListener('click',e=>{e.stopImmediatePropagation();showMinimalSidebar(tab,true);},true);
 $('minimalTexture').onclick=()=>$('textureEditor').click();$('uiThemePreset').addEventListener('change',()=>chooseMinimalTheme($('uiThemePreset').value));$('resetThemeColors').onclick=()=>chooseMinimalTheme($('uiThemePreset').value);document.querySelectorAll('[data-theme-preset]').forEach(b=>b.onclick=()=>chooseMinimalTheme(b.dataset.themePreset));$('minimalViewportColor').oninput=()=>{$('background').value=$('minimalViewportColor').value;$('background').dispatchEvent(new Event('change'));};
 $('rigPresetMenu').addEventListener('toggle',()=>syncMinimalUI());$('minimalSpeed').addEventListener('toggle',()=>syncMinimalUI());for(const id of ['speedInput','speedSlider'])$(id).addEventListener('input',syncMinimalUI);document.querySelectorAll('[data-speed]').forEach(b=>b.addEventListener('click',syncMinimalUI));
 document.querySelectorAll('.reset-value').forEach(b=>{const input=b.parentElement.querySelector('input'),row=document.createElement('span');row.className='transform-value-row';input.before(row);row.append(input,b);});
 const splitter=document.createElement('div');splitter.id='compareABResize';splitter.setAttribute('role','separator');splitter.setAttribute('aria-label','Đổi tỷ lệ hai khung 3D A/B');splitter.setAttribute('aria-orientation','vertical');splitter.tabIndex=0;document.querySelector('.compare-grid').insertBefore(splitter,document.querySelector('[data-area=B]'));let drag=null;
 const setRatio=value=>{$('compareSplit').value=Math.max(.2,Math.min(.8,value));splitter.setAttribute('aria-valuenow',Math.round(Number($('compareSplit').value)*100));syncMinimalUI();compareA.dirty=true;compareB.dirty=true;};
 const finish=cancel=>{if(!drag)return;if(cancel)setRatio(drag.value);drag=null;try{localStorage.setItem('animation-studio-settings',JSON.stringify(readSettings()));}catch{}};
 splitter.onpointerdown=e=>{if(e.button)return;drag={value:Number($('compareSplit').value),pointer:e.pointerId};splitter.setPointerCapture(e.pointerId);e.preventDefault();};splitter.onpointermove=e=>{if(!drag)return;const r=splitter.parentElement.getBoundingClientRect();setRatio((e.clientX-r.left)/(r.width-6));};splitter.onpointerup=()=>finish(false);splitter.onpointercancel=()=>finish(true);splitter.onlostpointercapture=()=>finish(false);splitter.onkeydown=e=>{if(e.key==='Escape'){finish(true);return;}if(!['ArrowLeft','ArrowRight','Home'].includes(e.key))return;e.preventDefault();setRatio(e.key==='Home'?.5:Number($('compareSplit').value)+(e.key==='ArrowRight'?.02:-.02));try{localStorage.setItem('animation-studio-settings',JSON.stringify(readSettings()));}catch{}};window.addEventListener('blur',()=>finish(true));
 document.addEventListener('pointerdown',e=>{for(const id of ['minimalViewMenu','minimalSpeed'])if(!e.target.closest('#'+id))$(id).open=false;});window.addEventListener('keydown',e=>{if(e.key==='Escape')for(const id of ['minimalViewMenu','minimalSpeed'])$(id).open=false;});
 syncMinimalUI();
}

document.addEventListener('pointerdown',e=>{if(directorPending&&!e.target.closest?.('#directorPanel,.transport'))directorCancel();},true);
