import { AnimationClip, AnimationMixer, LoopOnce, Matrix4, QuaternionKeyframeTrack, VectorKeyframeTrack } from 'three'
import { bobjModelNodeName, bobjModelToGlb, parseBobjModel, buildBobjModel } from './bobjModel'
import { appendVerityActions } from './verityRig'
import { nativeSkeletonFingerprint } from './nativeSkeleton'

/** Bake an edited native GLB onto its own base, retaining the original bytes as a prefix. */
export function nativeActionBobj(original: Buffer, bytes: Buffer, uuid: string): string {
  const model = parseBobjModel(original.toString('utf8'))
  if (nativeSkeletonFingerprint(bobjModelToGlb(model, { faceForward: true }).bytes) !== nativeSkeletonFingerprint(bytes)) throw new Error('Result requires the character native skeleton')
  const jsonLength = bytes.readUInt32LE(12), json = JSON.parse(bytes.toString('utf8',20,20+jsonLength)), binary = bytes.subarray(28+jsonLength)
  if (json.animations?.length !== 1) throw new Error('Native result requires one Action')
  const root = buildBobjModel(model).root, nodes = new Map<string, typeof root>()
  root.traverse(node => { nodes.set(node.name, node as typeof root) })
  const floats = (index: number, width: number) => {
    const accessor=json.accessors[index], view=json.bufferViews[accessor?.bufferView]
    if (!Number.isSafeInteger(index) || index<0 || !view || accessor.componentType !== 5126 || accessor.sparse || view.buffer !== 0 || accessor.type!==({1:'SCALAR',3:'VEC3',4:'VEC4'} as Record<number,string>)[width]) throw new Error('Unsupported native animation accessor')
    const start=view.byteOffset??0, relative=accessor.byteOffset??0, stride=view.byteStride??width*4, count=accessor.count, length=view.byteLength
    if (![start,relative,stride,count,length].every(Number.isSafeInteger) || start<0 || relative<0 || count<1 || count>2000000 || stride<width*4 || stride%4 || stride>252 || length<0 || start+length>binary.length || relative+(count-1)*stride+width*4>length) throw new Error('Native animation accessor exceeds its buffer')
    const offset=start+relative
    return Array.from({length:count*width},(_,i)=>{const value=binary.readFloatLE(offset+Math.floor(i/width)*stride+i%width*4);if(!Number.isFinite(value))throw new Error('Native animation accessor is not finite');return value})
  }
  const tracks = json.animations[0].channels.map((channel: any) => {
    const sampler=json.animations[0].samplers[channel.sampler], source=json.nodes[channel.target.node], node=nodes.get(source.name), width=channel.target.path==='rotation'?4:3
    if (!node || !['translation','rotation','scale'].includes(channel.target.path) || sampler.interpolation && sampler.interpolation!=='LINEAR') throw new Error('Unsupported native animation track')
    const property=({translation:'position',rotation:'quaternion',scale:'scale'} as Record<string,string>)[channel.target.path]
    const Track=width===4?QuaternionKeyframeTrack:VectorKeyframeTrack
    return new Track(`${node.uuid}.${property}`,floats(sampler.input,1),floats(sampler.output,width))
  })
  const clip=new AnimationClip(`app3_${uuid}`,-1,tracks), mixer=new AnimationMixer(root), playing=mixer.clipAction(clip)
  if (!(clip.duration>0) || clip.duration*20*model.armature.bones.length>2000000) throw new Error('Native animation duration is invalid')
  playing.setLoop(LoopOnce,1); playing.clampWhenFinished=true; playing.play()
  const bones=model.armature.bones.map(bone=>({name:bone.name,restLocal:new Matrix4().fromArray([...bone.restLocal])})),ticks=Math.ceil(clip.duration*20),frames:Map<string,Matrix4>[]=[]
  for(let tick=0;tick<=ticks;tick++) {
    mixer.setTime(Math.min(tick/20,clip.duration))
    // Native GLB clip locals already carry the Root turn; faceForward changes only the static rest view.
    frames.push(new Map(bones.map(bone=>{const node=nodes.get(bobjModelNodeName(bone.name))!;node.updateMatrix();return [bone.name,node.matrix.clone()]})))
  }
  playing.stop();mixer.uncacheRoot(root)
  return appendVerityActions(original.toString('utf8'),bones,[{name:clip.name,ticks,frames}])
}
