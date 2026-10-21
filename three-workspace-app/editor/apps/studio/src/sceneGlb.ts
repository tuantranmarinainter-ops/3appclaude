import { createHash, randomUUID } from 'node:crypto'
import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { BoxGeometry, SphereGeometry, CylinderGeometry, ConeGeometry, PlaneGeometry, TorusGeometry, Color, Euler, Matrix4, Quaternion, Vector3, type BufferGeometry } from 'three'
import { createFrameSnapshot, evaluateFrame, sceneBasisMatrix } from '@topview/3d-builder/evaluate'
import type { UnifiedProject } from '@bbs/animation-workspace-shared'
import { resolveUnifiedAssetFile } from './unifiedAssetFiles'
import { projectEvaluationScene, sampleProjectSkeletonRange } from './unifiedSkeletonEvaluation'

export interface SceneGlbArgs { frameStart: number; frameEnd: number }
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
const canonical = (name: string) => name.split(':').pop()!.replace(/^mixamorig[0-9]*/i, '').replace(/[^a-z0-9]/gi, '').toLowerCase()
const vec = (v: { x: number; y: number; z: number }) => new Vector3(v.x, v.y, v.z)

export function validateSceneGlbArgs(project: UnifiedProject, args: SceneGlbArgs) {
  const t = project.scene.content.timeline
  if (!args || Object.keys(args).some(k => !['frameStart','frameEnd'].includes(k)) || !Number.isSafeInteger(args.frameStart) || !Number.isSafeInteger(args.frameEnd) || args.frameStart < t.frameStart || args.frameEnd < args.frameStart || args.frameEnd > t.frameEnd || args.frameEnd-args.frameStart > 9000 || !Number.isFinite(t.fps) || t.fps <= 0) throw new TypeError('Scene GLB requires a valid inclusive frameStart/frameEnd within the timeline (maximum 9001 frames)')
  const unsupported = project.scene.content.nodes.filter(n => n.visible && n.type === 'character' && !Object.values(project.characters).some(c => c.nodeId === n.id))
  if (unsupported.length) throw new TypeError('Scene GLB requires shared Character source bindings for every visible character')
}

/** glTF 2.0 writer: copies verified embedded mesh/skin/texture bytes, remaps references, and replaces source clips with one baked scene clip. */
class SceneGlbWriter {
  json: any = { asset: { version:'2.0',generator:'BBS scene.export.glb' }, scene:0,scenes:[{nodes:[]}], nodes:[],meshes:[],materials:[],textures:[],samplers:[],images:[],skins:[],cameras:[],bufferViews:[],accessors:[],animations:[{name:'Scene',samplers:[],channels:[]}] }
  parts: Buffer[] = []
  length = 0
  append(bytes:Buffer) { const offset=this.length, padded=Buffer.alloc(Math.ceil(bytes.length/4)*4);bytes.copy(padded);this.parts.push(padded);this.length+=padded.length;return offset }
  floats(values:number[],size:number) {
    if(values.some(v=>!Number.isFinite(v)||Math.abs(v)>3.4e38))throw new TypeError('Scene samples must fit finite float32 values')
    const bytes=Buffer.alloc(values.length*4);values.forEach((v,i)=>bytes.writeFloatLE(v,i*4))
    const bufferView=this.json.bufferViews.length;this.json.bufferViews.push({buffer:0,byteOffset:this.append(bytes),byteLength:bytes.length})
    const index=this.json.accessors.length;this.json.accessors.push({bufferView,componentType:5126,type:({1:'SCALAR',2:'VEC2',3:'VEC3',4:'VEC4'} as Record<number,string>)[size],count:values.length/size,...(size===1?{min:[Math.min(...values)],max:[Math.max(...values)]}:{})});return index
  }
  node(node:any,parent?:number) { const index=this.json.nodes.length;this.json.nodes.push(node);if(parent===undefined)this.json.scenes[0].nodes.push(index);else(this.json.nodes[parent].children??=[]).push(index);return index }
  asset(bytes:Buffer,parent:number,flatten=false) {
    if(bytes.length<20||bytes.readUInt32LE(0)!==0x46546c67||bytes.readUInt32LE(4)!==2||bytes.readUInt32LE(8)!==bytes.length)throw new TypeError('Scene export currently requires embedded GLB model/prop sources; convert FBX/glTF to GLB first')
    const jsonLength=bytes.readUInt32LE(12), source=JSON.parse(bytes.subarray(20,20+jsonLength).toString('utf8')), binHeader=20+jsonLength
    const bin=binHeader+8<=bytes.length?bytes.subarray(binHeader+8,binHeader+8+bytes.readUInt32LE(binHeader)):Buffer.alloc(0)
    if((source.buffers??[]).some((b:any)=>b.uri)||source.buffers?.length>1||(source.images??[]).some((i:any)=>i.uri&&!i.uri.startsWith('data:')))throw new TypeError('Scene export resources must be embedded')
    const allowed=/^(KHR_materials_|KHR_texture_transform$|KHR_mesh_quantization$|KHR_draco_mesh_compression$|KHR_texture_basisu$|EXT_texture_webp$)/
    if((source.extensionsUsed??[]).some((e:string)=>!allowed.test(e)))throw new TypeError('Unsupported source GLB extension in scene export')
    const offsets:Record<string,number>=Object.fromEntries(['nodes','meshes','materials','textures','samplers','images','skins','cameras','bufferViews','accessors'].map(k=>[k,this.json[k].length]))
    const add=(kind:string,index:number|undefined)=>index===undefined?undefined:index+offsets[kind]!
    const byteOffset=this.append(bin)
    const remapTextures=(value:any,key=''):any=>{
      if(Array.isArray(value))return value.map(v=>remapTextures(v,key))
      if(!value||typeof value!=='object')return value
      return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,k==='index'&&/texture$/i.test(key)&&typeof v==='number'?add('textures',v):remapTextures(v,k)]))
    }
    for(const v of source.bufferViews??[])this.json.bufferViews.push({...v,buffer:0,byteOffset:byteOffset+(v.byteOffset??0)})
    for(const a of source.accessors??[])this.json.accessors.push({...a,bufferView:add('bufferViews',a.bufferView),...(a.sparse?{sparse:{...a.sparse,indices:{...a.sparse.indices,bufferView:add('bufferViews',a.sparse.indices.bufferView)},values:{...a.sparse.values,bufferView:add('bufferViews',a.sparse.values.bufferView)}}}:{})})
    this.json.samplers.push(...(source.samplers??[]))
    for(const image of source.images??[])this.json.images.push({...image,bufferView:add('bufferViews',image.bufferView)})
    for(const texture of source.textures??[]) {
      const next={...texture,sampler:add('samplers',texture.sampler),source:add('images',texture.source)}
      if(next.extensions)next.extensions=Object.fromEntries(Object.entries(next.extensions).map(([key,v]:[string,any])=>[key,{...v,source:add('images',v.source)}]))
      this.json.textures.push(next)
    }
    for(const m of source.materials??[])this.json.materials.push(remapTextures(m))
    for(const mesh of source.meshes??[])this.json.meshes.push({...mesh,primitives:mesh.primitives.map((p:any)=>({...p,attributes:Object.fromEntries(Object.entries(p.attributes).map(([k,v])=>[k,add('accessors',v as number)])),indices:add('accessors',p.indices),material:add('materials',p.material),...(p.extensions?.KHR_draco_mesh_compression?{extensions:{...p.extensions,KHR_draco_mesh_compression:{...p.extensions.KHR_draco_mesh_compression,bufferView:add('bufferViews',p.extensions.KHR_draco_mesh_compression.bufferView)}}}:{}),...(p.targets?{targets:p.targets.map((t:any)=>Object.fromEntries(Object.entries(t).map(([k,v])=>[k,add('accessors',v as number)])))}:{})}))})
    for(const skin of source.skins??[])this.json.skins.push({...skin,skeleton:undefined,joints:skin.joints.map((i:number)=>add('nodes',i)),inverseBindMatrices:add('accessors',skin.inverseBindMatrices)})
    this.json.cameras.push(...(source.cameras??[]))
    for(const n of source.nodes??[])this.json.nodes.push({...n,name:`${parent}:${n.name??'node'}`,extras:{...n.extras,sourceBoneName:n.name},mesh:add('meshes',n.mesh),skin:add('skins',n.skin),camera:add('cameras',n.camera),children:n.children?.map((i:number)=>add('nodes',i))})
    const roots=source.scenes?.[source.scene??0]?.nodes
    if(!Array.isArray(roots))throw new TypeError('Source GLB has no default scene')
    this.json.nodes[parent].children=roots.map((i:number)=>add('nodes',i))
    for(const ext of source.extensionsUsed??[])this.json.extensionsUsed=[...new Set([...(this.json.extensionsUsed??[]),ext])]
    for(const ext of source.extensionsRequired??[])this.json.extensionsRequired=[...new Set([...(this.json.extensionsRequired??[]),ext])]
    const joints=new Set<number>((source.skins??[]).flatMap((skin:any)=>skin.joints))
    const bones=new Map<string,number>()
    for(const i of flatten ? joints : []) {
      const index=add('nodes',i)!, name=canonical(source.nodes[i].name??'')
      if(!name||bones.has(name))throw new TypeError('Scene export needs unambiguous skin bone names')
      bones.set(name,index)
      // Flatten skin joints under the actor: sampling their evaluated world matrices preserves deformation,
      // regardless of source grouping, model basis, unit conversion or root-motion policy.
      for(const node of this.json.nodes)if(node.children)node.children=node.children.filter((child:number)=>child!==index)
      this.json.nodes[parent].children.push(index)
    }
    return bones
  }
  geometry(geometry:BufferGeometry,color:string,parent:number) {
    const attributes:Record<string,number>={}
    for(const [name,semantic] of [['position','POSITION'],['normal','NORMAL'],['uv','TEXCOORD_0']]) {
      const attr=geometry.getAttribute(name!);if(attr)attributes[semantic!]=this.floats(Array.from(attr.array),attr.itemSize)
    }
    const position=this.json.accessors[attributes.POSITION!];geometry.computeBoundingBox();position.min=geometry.boundingBox!.min.toArray();position.max=geometry.boundingBox!.max.toArray()
    let indices:number|undefined
    if(geometry.index) {
      const values=Array.from(geometry.index.array),data=Buffer.alloc(values.length*4);values.forEach((v,i)=>data.writeUInt32LE(v,i*4));const bv=this.json.bufferViews.length;this.json.bufferViews.push({buffer:0,byteOffset:this.append(data),byteLength:data.length});indices=this.json.accessors.length;this.json.accessors.push({bufferView:bv,componentType:5125,count:values.length,type:'SCALAR'})
    }
    const material=this.json.materials.length;this.json.materials.push({pbrMetallicRoughness:{baseColorFactor:[...new Color(color).toArray(),1],metallicFactor:0,roughnessFactor:0.8}})
    const mesh=this.json.meshes.length;this.json.meshes.push({primitives:[{attributes,indices,material}]});this.json.nodes[parent].mesh=mesh;geometry.dispose()
  }
  track(node:number,path:string,input:number,values:number[],size:number) {
    const a=this.json.animations[0],sampler=a.samplers.length;a.samplers.push({input,output:this.floats(values,size),interpolation:'LINEAR'});a.channels.push({sampler,target:{node,path}})
  }
  finish() {
    this.json.buffers=[{byteLength:this.length}]
    const json=Buffer.from(JSON.stringify(this.json)), padded=Buffer.alloc(Math.ceil(json.length/4)*4,32);json.copy(padded)
    const head=Buffer.alloc(20);head.writeUInt32LE(0x46546c67,0);head.writeUInt32LE(2,4);head.writeUInt32LE(20+padded.length+8+this.length,8);head.writeUInt32LE(padded.length,12);head.writeUInt32LE(0x4e4f534a,16)
    const bin=Buffer.alloc(8);bin.writeUInt32LE(this.length,0);bin.writeUInt32LE(0x004e4942,4);return Buffer.concat([head,padded,bin,...this.parts])
  }
}

function primitive(kind:string,p:Record<string,number>):BufferGeometry {
  switch(kind) {
    case 'BoxGeometry':return new BoxGeometry(p.width??1,p.height??1,p.depth??1)
    case 'SphereGeometry':return new SphereGeometry(p.radius??0.5,24,16)
    case 'CylinderGeometry':return new CylinderGeometry(p.radiusTop??0.5,p.radiusBottom??0.5,p.height??1,24)
    case 'ConeGeometry':return new ConeGeometry(p.radius??0.5,p.height??1,24)
    case 'PlaneGeometry':return new PlaneGeometry(p.width??1,p.height??1)
    case 'TorusGeometry':return new TorusGeometry(p.radius??0.5,p.tube??0.15,12,24)
    default:throw new TypeError(`Unsupported primitive in scene export: ${kind}`)
  }
}

export async function exportSceneGlb(project:UnifiedProject,args:SceneGlbArgs) {
  validateSceneGlbArgs(project,args)
  const writer=new SceneGlbWriter(), scene=projectEvaluationScene(project),snapshot=createFrameSnapshot(),timeline=project.scene.content.timeline
  const selected=project.scene.content.nodes.filter(n=>n.visible&&n.type!=='path')
  const wrappers=new Map<string,number>(), boneMaps=new Map<string,Map<string,number>>()
  for(const node of selected) {
    const wrapper=writer.node({name:node.id,extras:{sceneNodeId:node.id,displayName:node.name},children:[]});wrappers.set(node.id,wrapper)
    if(node.type==='character'||node.type==='prop') {
      const character=Object.values(project.characters).find(c=>c.nodeId===node.id),assetId=character?.assetId??node.metadata?.assetId
      if(typeof assetId!=='string')throw new TypeError(`Scene node ${node.id} has no verified asset`)
      const source=await resolveUnifiedAssetFile(project,assetId,'source')
      const bones=writer.asset(source.bytes,wrapper,!!character);if(character)boneMaps.set(node.id,bones)
    } else if(node.type==='primitive')writer.geometry(primitive(node.primitive!.kind,node.primitive!.parameters),node.primitive?.appearance?.color??'#bbbbbb',wrapper)
    else if(node.type==='camera') {
      if(node.camera?.projection!=='perspective')throw new TypeError('Scene GLB currently requires perspective cameras')
      const camera=writer.json.cameras.length;writer.json.cameras.push({name:node.name,type:'perspective',perspective:{yfov:(node.camera.fov??50)*Math.PI/180,znear:node.camera.near??0.01,zfar:node.camera.far??1000}});writer.json.nodes[wrapper].camera=camera
    }
  }
  if(writer.json.nodes.length*(args.frameEnd-args.frameStart+2)>2_000_000)throw new RangeError('Scene GLB exceeds the two-million node-sample budget; shorten the range')
  const characterIds=Object.values(project.characters).filter(c=>wrappers.has(c.nodeId)).map(c=>c.id)
  const skeletons=characterIds.length?sampleProjectSkeletonRange(project,{startFrame:args.frameStart,endFrame:args.frameEnd,sampleFps:timeline.fps},characterIds):null
  const series=new Map<number,{p:number[];q:number[];s:number[]}>(),times:number[]=[],cameraFovs=new Map<number,number[]>()
  const record=(index:number,matrix:Matrix4)=>{
    const p=new Vector3(),q=new Quaternion(),s=new Vector3();matrix.decompose(p,q,s)
    const previous=series.get(index)??{p:[],q:[],s:[]};if(previous.q.length&&q.dot(new Quaternion().fromArray(previous.q.slice(-4)))<0)q.set(-q.x,-q.y,-q.z,-q.w)
    previous.p.push(...p.toArray());previous.q.push(...q.normalize().toArray());previous.s.push(...s.toArray());series.set(index,previous)
    if(previous.p.length===3) { const node=writer.json.nodes[index];delete node.matrix;node.translation=p.toArray();node.rotation=q.toArray();node.scale=s.toArray() }
  }
  for(let i=0;i<=args.frameEnd-args.frameStart+1;i++) {
    const frame=args.frameStart+i,endpoint=frame===args.frameEnd+1
    evaluateFrame({...scene,exportSampleBoundary:endpoint?'left':'right'},frame,snapshot)
    const skeletonSample=skeletons?(await skeletons.next()).value:undefined
    times.push(i/timeline.fps)
    for(const node of selected) {
      const wrapper=wrappers.get(node.id)!,t=snapshot.transforms.get(node.id)
      if(!t)throw new TypeError(`No evaluated transform for ${node.id}`)
      const sample=skeletonSample?.skeletonSamples.find((s:any)=>s.nodeId===node.id)
      let matrix:Matrix4
      if(boneMaps.has(node.id)&&!sample)throw new TypeError(`Missing skeleton sample for ${node.id}`)
      if(sample) {
        const unit=sample.metersPerUnit,basis=node.metadata?.modelBasisToScene
        matrix=new Matrix4().fromArray(sample.actorWorldMatrix).multiply(new Matrix4().makeScale(unit,unit,unit))
        if(basis!==undefined)matrix.multiply(sceneBasisMatrix(basis))
        const inverse=matrix.clone().invert(),bones=boneMaps.get(node.id)!
        for(const [name,index] of bones) {
          const bone=sample.bones.find((b:any)=>canonical(b.name)===name)
          if(!bone)throw new TypeError(`Sample missing skin bone ${name}`)
          record(index,inverse.clone().multiply(new Matrix4().fromArray(bone.worldMatrix)))
        }
      } else {
        const q=new Quaternion().setFromEuler(new Euler(t.rotation.x*Math.PI/180,t.rotation.y*Math.PI/180,t.rotation.z*Math.PI/180,'XYZ'))
        if(node.type==='camera'&&!t.useEuler&&t.lookAt)q.setFromRotationMatrix(new Matrix4().lookAt(vec(t.position),vec(t.lookAt),new Vector3(0,1,0)))
        matrix=new Matrix4().compose(vec(t.position),q,vec(t.scale))
        if(node.type==='prop') {
          const unit=node.metadata?.modelUnitMeters??1
          matrix.multiply(new Matrix4().makeScale(unit,unit,unit))
          if(node.metadata?.modelBasisToScene!==undefined)matrix.multiply(sceneBasisMatrix(node.metadata.modelBasisToScene))
        }
      }
      record(wrapper,matrix)
      if(node.type==='camera'&&t.fov!==undefined) {
        const index=writer.json.nodes[wrapper].camera, camera=writer.json.cameras[index]
        if(i===0)camera.perspective.yfov=t.fov*Math.PI/180
        const values=cameraFovs.get(index)??[];values.push(t.fov*Math.PI/180);cameraFovs.set(index,values)
      }
    }
  }
  // Preserve authored group-local transforms. Character actor matrices are already in scene meters.
  for(const node of selected)if(node.parentId&&node.type!=='character') {
    const parent=wrappers.get(node.parentId),child=wrappers.get(node.id)!
    if(parent!==undefined){writer.json.nodes[parent].children.push(child);writer.json.scenes[0].nodes=writer.json.scenes[0].nodes.filter((n:number)=>n!==child)}
  }
  const input=writer.floats(times,1)
  for(const [node,values] of series){writer.track(node,'translation',input,values.p,3);writer.track(node,'rotation',input,values.q,4);writer.track(node,'scale',input,values.s,3)}
  let animatedFovCount=0
  for(const [index,values] of cameraFovs)if(values.some(v=>Math.abs(v-values[0]!)>1e-7)) {
    const animation=writer.json.animations[0],sampler=animation.samplers.length
    animation.samplers.push({input,output:writer.floats(values,1),interpolation:'LINEAR'})
    animation.channels.push({sampler,target:{path:'pointer',extensions:{KHR_animation_pointer:{pointer:`/cameras/${index}/perspective/yfov`}}}})
    writer.json.extensionsUsed=[...new Set([...(writer.json.extensionsUsed??[]),'KHR_animation_pointer'])];animatedFovCount++
  }
  const bytes=writer.finish()
  return {bytes,report:{frameStart:args.frameStart,frameEnd:args.frameEnd,fps:timeline.fps,sampleCount:times.length,animatedFovCount,nodeCount:writer.json.nodes.length,characterCount:characterIds.length,skinCount:writer.json.skins.length,clipCount:1,sha256:hash(bytes)}}
}

/** Same authenticated job-file protocol as shot.export, with a GLB artifact and measured provenance. */
export async function storeSceneGlb(project:UnifiedProject,built:Awaited<ReturnType<typeof exportSceneGlb>>) {
  const jobId=randomUUID(),root=path.resolve(process.env.BBS_UNIFIED_PROJECTS_DIR?.trim()||path.join(process.cwd(),'unified-projects')),dir=path.join(root,project.projectId,'.jobs',jobId),now=new Date().toISOString()
  const name='scene.glb',file={id:'0',name,mimeType:'model/gltf-binary',sizeBytes:built.bytes.length,sha256:hash(built.bytes),path:`output/${name}`}
  const record={jobId,projectId:project.projectId,type:'scene.export.glb',state:'succeeded',sourceRevision:project.revision,sourceSha256:hash(Buffer.from(JSON.stringify(project))),progress:1,createdAt:now,updatedAt:now,result:{files:[file],provenance:built.report,warnings:[],blockedRequests:[]}}
  try {await mkdir(path.join(dir,'output'),{recursive:true});await writeFile(path.join(dir,'output',name),built.bytes,{flag:'wx'});await writeFile(path.join(dir,'job.json.tmp'),JSON.stringify(record),{flag:'wx'});await rename(path.join(dir,'job.json.tmp'),path.join(dir,'job.json'))}
  catch(error){await rm(dir,{recursive:true,force:true});throw error}
  return {jobId,state:'succeeded',sourceRevision:project.revision,report:built.report}
}
