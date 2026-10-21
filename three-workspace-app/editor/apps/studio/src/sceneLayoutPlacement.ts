import { constantPlacementKeys,updateConstantPlacementKeys } from './constantPlacementKeys'
import { projectEvaluationScene } from './unifiedSkeletonEvaluation'
import { Matrix4, Quaternion, Vector3 } from 'three'
import { sceneBasisMatrix,createFrameSnapshot,evaluateFrame } from '@topview/3d-builder/evaluate'
import type { SkeletonProfile, UnifiedProject } from '@bbs/animation-workspace-shared'

export const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
export function fields(v: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(v).some(k => !allowed.includes(k))) throw new TypeError('Unknown layout argument')
}
export function profilePoints(profile: SkeletonProfile | undefined): Array<{ name: string; point: Vector3 }> {
  if (!profile) return []
  const bones = new Map(profile.bones.map(b => [b.id, b])), cache = new Map<string, Matrix4>(), pending = new Set<string>()
  const world = (id: string): Matrix4 => {
    if (cache.has(id)) return cache.get(id)!
    const b = bones.get(id); if (!b || pending.has(id)) throw new TypeError('Invalid skeleton hierarchy')
    pending.add(id)
    const r = b.rest as { position: number[]; rotation: number[]; scale: number[] }
    if (!r || ![r.position,r.rotation,r.scale].every(Array.isArray)) throw new TypeError('Invalid rest pose')
    const local = new Matrix4().compose(new Vector3().fromArray(r.position),new Quaternion().fromArray(r.rotation),new Vector3().fromArray(r.scale))
    const value = b.parentId ? world(b.parentId).clone().multiply(local) : local
    pending.delete(id); cache.set(id,value); return value
  }
  const basis = sceneBasisMatrix(profile.basisToScene).scale(new Vector3().setScalar(profile.metersPerUnit))
  return profile.bones.map(b => ({ name: b.name, point: new Vector3().setFromMatrixPosition(basis.clone().multiply(world(b.id))) }))
}
export function characterNode(project: UnifiedProject, id: unknown) {
  if (typeof id !== 'string') throw new TypeError('characterId must be a string')
  const character = project.characters[id]
  const node = project.scene.content.nodes.find(n => n.id === (character?.nodeId ?? id) && n.type === 'character')
  if (!node) throw new TypeError(`Character not found: ${id}`)
  return node
}
export function requireStaticPlacement(project: UnifiedProject, nodeId: string, writing = true, evaluated?: UnifiedProject['scene']['content']['nodes'][number]['transform']) {
  if(!writing)return
  const node = project.scene.content.nodes.find(n => n.id === nodeId)!
  if (writing && node.locked || node.parentId) throw new TypeError('Layout edits require unlocked, unparented nodes')
  const transform=evaluated??node.transform
  if (node.type === 'character' && (Math.abs(transform.rotation.x)>1e-6 || Math.abs(transform.rotation.z)>1e-6 || Object.values(transform.scale).some(v=>v<=0))) throw new TypeError('Layout requires upright characters with positive scale')
  constantPlacementKeys(project,nodeId)
  const animation = project.scene.content.timeline.animation
  if (animation.motionClips.some(c => c.target.nodeId === nodeId && c.motion.rootMotion?.policy === 'trajectory') ||
      animation.cameraMotionClips.some(c => c.target.nodeId === nodeId) ||
      animation.pathMotionClips.some(p => p.target.nodeId === nodeId)) throw new TypeError('Layout edits do not overwrite trajectory/path/camera animation')
}
export function bodyDimensions(project: UnifiedProject, nodeId: string) {
  const c = Object.values(project.characters).find(c => c.nodeId === nodeId),node = project.scene.content.nodes.find(n => n.id === nodeId)!
  const points = profilePoints(c ? project.skeletons[c.skeletonId] : undefined).map(p => ({...p,point:p.point.multiply(new Vector3(node.transform.scale.x,node.transform.scale.y,node.transform.scale.z))}))
  const feet = points.filter(p => /foot|toe|low_left_leg|low_leg_right/i.test(p.name))
  const floor = feet.length ? Math.min(...feet.map(p => p.point.y)) : 0
  const hips = points.find(p => /(?:hips|pelvis|body)$/i.test(p.name))
  const height = hips ? Math.abs(hips.point.y-floor) : 1
  const radius = Math.max(0.15, height * 0.22 * Math.max(node.transform.scale.x,node.transform.scale.z)/node.transform.scale.y)
  return { floor, radius, source: points.length ? 'skeleton-rest' : 'assumed-origin-and-0.22m-radius' }
}

/** World axes: left=-X, front=+Z. Distances are horizontal centre-to-centre meters. */
export function previewCharacterLayout(project: UnifiedProject, args: Record<string, unknown>, world?: Map<string,{position:{x:number;y:number;z:number}}>) {
  fields(args,['placements','frame'])
  const timeline=project.scene.content.timeline,frame=args.frame===undefined?timeline.frameStart:args.frame
  if(typeof frame!=='number'||!Number.isFinite(frame)||frame<timeline.frameStart||frame>timeline.frameEnd)throw new TypeError('Invalid layout frame')
  const snapshot=createFrameSnapshot();evaluateFrame(projectEvaluationScene(project),frame,snapshot)
  if (!Array.isArray(args.placements) || !args.placements.length || args.placements.length > 32) throw new TypeError('placements must contain 1–32 edits')
  const edits = new Map<string, Record<string, unknown>>()
  for (const value of args.placements) {
    if (!record(value)) throw new TypeError('Invalid placement')
    fields(value,['characterId','position','relativeTo','relation','distanceMeters','lookAt'])
    const node = characterNode(project,value.characterId); requireStaticPlacement(project,node.id,true,snapshot.transforms.get(node.id))
    if (edits.has(node.id)) throw new TypeError('Duplicate character placement')
    if (value.position !== undefined && value.relativeTo !== undefined) throw new TypeError('Choose position or relativeTo')
    if (value.relativeTo === undefined && (value.relation !== undefined || value.distanceMeters !== undefined)) throw new TypeError('Relative placement requires relativeTo')
    edits.set(node.id,value)
  }
  const transforms = new Map(project.scene.content.nodes.filter(n => n.type === 'character').map(n => [n.id,{...structuredClone(n.transform),...structuredClone(snapshot.transforms.get(n.id)),position:structuredClone(world?.get(n.id)?.position??snapshot.transforms.get(n.id)!.position)}]))
  const pending = new Set<string>(), done = new Set<string>()
  const resolve = (id: string): void => {
    if (done.has(id) || !edits.has(id)) return
    if (pending.has(id)) throw new TypeError('Relative placement cycle')
    pending.add(id)
    const edit = edits.get(id)!, t = transforms.get(id)!
    if (edit.position !== undefined) {
      if (!record(edit.position)) throw new TypeError('position requires x,z')
      fields(edit.position,['x','z'])
      if (![edit.position.x,edit.position.z].every(v => typeof v === 'number' && Number.isFinite(v))) throw new TypeError('position requires finite x,z')
      t.position.x=edit.position.x as number; t.position.z=edit.position.z as number
    }
    if (edit.relativeTo !== undefined) {
      const reference = characterNode(project,edit.relativeTo)
      if(reference.id===id) throw new TypeError('A character cannot reference itself')
      requireStaticPlacement(project,reference.id,false); resolve(reference.id)
      const direction = {left:[-1,0],right:[1,0],front:[0,1],behind:[0,-1]}[edit.relation as string]
      if (!direction || typeof edit.distanceMeters !== 'number' || !Number.isFinite(edit.distanceMeters) || edit.distanceMeters <= 0 || edit.distanceMeters > 1000) throw new TypeError('Relative placement requires left/right/front/behind and distanceMeters in (0,1000]')
      const target = transforms.get(reference.id)!.position
      t.position.x=target.x+direction[0]!*edit.distanceMeters; t.position.z=target.z+direction[1]!*edit.distanceMeters
    }
    t.position.y=-bodyDimensions(project,id).floor || 0
    pending.delete(id); done.add(id)
  }
  for (const id of edits.keys()) resolve(id)
  for (const [id,edit] of edits) {
    if (edit.lookAt === undefined) continue
    if (!record(edit.lookAt)) throw new TypeError('lookAt requires characterId, cameraId, or point')
    fields(edit.lookAt,['characterId','cameraId','point'])
    if (Object.keys(edit.lookAt).length!==1) throw new TypeError('lookAt requires exactly one target')
    let target: {x:number;z:number}|undefined
    if (edit.lookAt.characterId !== undefined) {
      const reference=characterNode(project,edit.lookAt.characterId); requireStaticPlacement(project,reference.id,false)
      target=transforms.get(reference.id)!.position
    }
    else if (edit.lookAt.cameraId !== undefined) {
      const camera=project.scene.content.nodes.find(n=>n.id===(edit.lookAt as Record<string,unknown>).cameraId&&n.type==='camera')
      if(camera){requireStaticPlacement(project,camera.id,false);target=world?.get(camera.id)?.position??snapshot.transforms.get(camera.id)!.position}
    }
    else if (record(edit.lookAt.point)) {
      fields(edit.lookAt.point,['x','z'])
      if ([edit.lookAt.point.x,edit.lookAt.point.z].every(v=>typeof v==='number'&&Number.isFinite(v))) target=edit.lookAt.point as {x:number;z:number}
    }
    if(!target) throw new TypeError('Invalid lookAt target')
    const t=transforms.get(id)!,dx=target.x-t.position.x,dz=target.z-t.position.z
    if(Math.hypot(dx,dz)<1e-8) throw new TypeError('Look target coincides with character')
    t.rotation={x:0,y:Math.atan2(dx,dz)*180/Math.PI,z:0}
  }
  const all=[...transforms.entries()]
  for(let i=0;i<all.length;i++)for(let j=i+1;j<all.length;j++){
    const [a,ta]=all[i]!,[b,tb]=all[j]!
    if(!edits.has(a)&&!edits.has(b))continue
    if(Math.hypot(ta.position.x-tb.position.x,ta.position.z-tb.position.z)+1e-8<bodyDimensions(project,a).radius+bodyDimensions(project,b).radius) throw new TypeError('Requested layout overlaps character body radii; increase distance')
  }
  const placements=[...edits.keys()].map(nodeId=>({nodeId,transform:{position:transforms.get(nodeId)!.position,rotation:transforms.get(nodeId)!.rotation,scale:transforms.get(nodeId)!.scale},body:bodyDimensions(project,nodeId)}))
  const changedKeys=updateConstantPlacementKeys(project,placements)
  const document=structuredClone(project.scene)
  for(const p of placements)document.content.nodes.find(n=>n.id===p.nodeId)!.transform=p.transform
  return {sourceRevision:project.revision,frame,coordinateSystem:'world +Y up, +Z forward, left=-X',placements,
    operations:changedKeys?[{type:'document.replace',document,fcurves:changedKeys}]:placements.map(p=>({type:'node.transform.patch',nodeId:p.nodeId,position:p.transform.position,rotation:p.transform.rotation}))}
}
