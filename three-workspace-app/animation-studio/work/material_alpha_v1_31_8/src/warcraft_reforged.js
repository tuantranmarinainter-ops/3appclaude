import {parseReforged,FloatAnimation,Vector3Animation,Vector4Animation} from '@vendor/mdx-runtime';

function track(vector,name){
 if(!vector?.Keys?.length)return null;
 const a=name==='KGRT'?new Vector4Animation():name==='KMTA'?new FloatAnimation():new Vector3Animation();
 a.name=name;a.interpolationType=vector.LineType;a.globalSequenceId=vector.GlobalSeqId??-1;
 if(![0,1,2,3].includes(a.interpolationType))throw Error('Warcraft: interpolation không hợp lệ.');
 for(const k of vector.Keys){const value=name==='KMTA'?[k.Vector?.[0]??k.Value]:k.Vector;a.frames.push(k.Frame);a.values.push(new Float32Array(value));if(a.interpolationType>1){a.inTans.push(new Float32Array(name==='KMTA'?[k.InTan?.[0]??k.InTan]:k.InTan));a.outTans.push(new Float32Array(name==='KMTA'?[k.OutTan?.[0]??k.OutTan]:k.OutTan));}}
 return a;
}

export function alphaTrack(alpha){return track(alpha,'KMTA');}

// Preserve the upstream track classes: its evaluator dispatches with instanceof.
// HD parser -> the same node evaluator used by the Classic import path.
export function adaptReforged(ast){
 const nodes=ast.Nodes.filter(Boolean),convert=n=>({name:n.Name,objectId:n.ObjectId,parentId:n.Parent??-1,flags:n.Flags,
  animations:[track(n.Translation,'KGTR'),track(n.Rotation,'KGRT'),track(n.Scaling,'KGSC')].filter(Boolean)});
 const genericObjects=nodes.map(convert),byId=new Map(genericObjects.map(n=>[n.objectId,n]));
 const list=name=>(ast[name]||[]).map(n=>byId.get(n.ObjectId));
 const first=(v,fallback)=>typeof v==='number'?v:v?.Keys?.[0]?.Vector?.[0]??fallback;
 const model={version:ast.Version,name:ast.Info.Name,genericObjects,bones:list('Bones'),helpers:list('Helpers'),attachments:list('Attachments'),lights:list('Lights'),
  particleEmitters:list('ParticleEmitters'),particleEmitters2:list('ParticleEmitters2'),ribbonEmitters:list('RibbonEmitters'),eventObjects:list('EventObjects'),collisionShapes:list('CollisionShapes'),
  globalSequences:ast.GlobalSequences||[],pivotPoints:ast.PivotPoints,
  sequences:ast.Sequences.map(s=>({name:s.Name,interval:s.Interval,nonLooping:s.NonLooping})),
  textures:ast.Textures.map(t=>({path:t.Image,replaceableId:t.ReplaceableId||0,wrapMode:t.Flags||0})),
  materials:ast.Materials.map(m=>({layers:m.Layers.map(l=>{const alphaAnimation=alphaTrack(l.Alpha);return{textureId:first(l.TextureID,0),coordId:l.CoordId||0,alpha:first(l.Alpha,1),alphaAnimation,filterMode:l.FilterMode||0,flags:l.Shading||0,
   shaderType:l.ShaderTypeId||0,textureAnimationId:l.TVertexAnimId??-1,animations:[alphaAnimation,...(l.TextureID?.Keys?['dynamic']:[])].filter(Boolean)};})})),
  geosetAnimations:ast.GeosetAnims,bindPoses:ast.BindPoses?.flatMap(p=>p.Matrices)||[],
  geosets:ast.Geosets.map(g=>({vertices:g.Vertices,normals:g.Normals,faces:g.Faces,uvSets:g.TVertices,vertexGroups:g.VertexGroup,
   matrixGroups:g.Groups.map(a=>a.length),matrixIndices:g.Groups.flat(),skin:g.SkinWeights,lod:g.LevelOfDetail,materialId:g.MaterialID})),
  faceEffects:ast.FaceFX?.length||0,popcorn:ast.ParticleEmitterPopcorns?.length||0};
 return model;
}

export function parseHD(bytes){
 const data=bytes instanceof ArrayBuffer?bytes:bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);
 const ast=parseReforged(data);if(ast.Version!==1800)throw Error('Warcraft: MDX '+ast.Version+' chưa hỗ trợ; bản này nhận Classic 800 và MDX 1800.');
 return adaptReforged(ast);
}
