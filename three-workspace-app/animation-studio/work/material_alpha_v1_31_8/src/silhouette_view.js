import * as T from 'three';

// A render-only transaction: authoring/export never sees substituted materials.
export class SilhouetteView {
 constructor(){this.enabled=false;this.views=new Map();}
 set(enabled){
  if(typeof enabled!=='boolean')throw new TypeError('enabled must be boolean');
  this.enabled=enabled;
  if(!enabled){for(const cache of this.views.values())for(const material of cache.values())material.dispose();this.views.clear();}
  return{enabled};
 }
 prepare(view,meshes){
  if(!this.enabled)return()=>{};
  const targets=new Set(meshes),allowed=new Set([view.scene]);
  let cache=this.views.get(view);if(!cache){cache=new Map();this.views.set(view,cache);}
  for(const [mesh,material]of cache)if(!targets.has(mesh)){material.dispose();cache.delete(mesh);}
  for(const mesh of targets)for(let object=mesh;object;object=object.parent)allowed.add(object);
  const visibility=[],materials=[];
  const {scene,renderer}=view,background=scene.background,fog=scene.fog,override=scene.overrideMaterial;
  const toneMapping=renderer.toneMapping,colorSpace=renderer.outputColorSpace,shadows=renderer.shadowMap.enabled;
  const restore=()=>{
   for(const [mesh,material]of materials)mesh.material=material;
   for(const [object,visible]of visibility)object.visible=visible;
   scene.background=background;scene.fog=fog;scene.overrideMaterial=override;
   renderer.toneMapping=toneMapping;renderer.outputColorSpace=colorSpace;renderer.shadowMap.enabled=shadows;
  };
  try{
   scene.traverse(object=>{visibility.push([object,object.visible]);object.visible=allowed.has(object);});
   for(const mesh of targets){
    let material=cache.get(mesh);
    if(!material){material=new T.MeshBasicMaterial({color:0x111111,side:T.DoubleSide,toneMapped:false,fog:false});cache.set(mesh,material);}
    materials.push([mesh,mesh.material]);mesh.material=material;
   }
   scene.background=new T.Color(0xf2f2f2);scene.fog=null;scene.overrideMaterial=null;
   renderer.toneMapping=T.NoToneMapping;renderer.outputColorSpace=T.SRGBColorSpace;renderer.shadowMap.enabled=false;
   return restore;
  }catch(error){restore();throw error;}
 }
}
