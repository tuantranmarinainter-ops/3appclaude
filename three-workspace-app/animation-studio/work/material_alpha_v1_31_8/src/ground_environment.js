import * as T from 'three';

// Viewport-only environment. Never parent this group under a rig or actor.
export const defaults={groundMode:'grid',groundColor:'#8bb7a5',groundSize:'80',groundGrid:false};
export const keys=Object.keys(defaults);
export function normalize(input={}){
 input=input&&typeof input==='object'&&!Array.isArray(input)?input:{};
 const mode=['grid','grass','plane'].includes(input.groundMode)?input.groundMode:defaults.groundMode;
 const color=typeof input.groundColor==='string'&&/^#[0-9a-f]{6}$/i.test(input.groundColor)?input.groundColor.toLowerCase():defaults.groundColor;
 const size=Number(input.groundSize),valid=input.groundSize!==''&&Number.isFinite(size);
 return{groundMode:mode,groundColor:color,groundSize:String(valid?Math.max(8,Math.min(512,size)):80),groundGrid:typeof input.groundGrid==='boolean'?input.groundGrid:false};
}
export function grassPixels(){
 // Original, deterministic 16px grass tile; no game assets or network request.
 const bytes=new Uint8Array(16*16*4);let seed=43871;
 for(let i=0;i<256;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;const n=(seed>>>27)-16,j=i*4;bytes[j]=103+n;bytes[j+1]=158+n;bytes[j+2]=62+Math.round(n*.6);bytes[j+3]=255;}
 return bytes;
}
export function create(scene){
 const group=new T.Group();group.name='StudioViewportGround';group.userData.studioEnvironment=true;scene.add(group);
 const texture=new T.DataTexture(grassPixels(),16,16,T.RGBAFormat);texture.colorSpace=T.SRGBColorSpace;texture.wrapS=texture.wrapT=T.RepeatWrapping;texture.magFilter=texture.minFilter=T.NearestFilter;texture.generateMipmaps=false;texture.needsUpdate=true;
 const material=new T.MeshStandardMaterial({color:0xffffff,roughness:1,metalness:0,side:T.DoubleSide});
 const plane=new T.Mesh(new T.PlaneGeometry(1,1),material);plane.name='ViewportOnlyPlane';plane.userData.studioEnvironment=true;group.add(plane);
 const grid=new T.GridHelper(1,16,0x52665b,0x52665b);grid.material.transparent=true;grid.material.opacity=.28;group.add(grid);
 group.visible=false;return{group,plane,grid,texture,size:null};
}
export function update(view,input,up='z'){
 const g=view.ground;if(!g)return;const s=normalize(input),size=Number(s.groundSize),flat=s.groundMode!=='grid';
 g.group.visible=flat;g.plane.visible=flat;g.grid.visible=flat&&s.groundGrid;
 if(!flat)return;
 for(const grid of [view.grid,view.gridXY,view.gridYZ])if(grid)grid.visible=false;
 g.group.rotation.set(up==='y'?-Math.PI/2:0,0,0);g.group.position.set(0,0,0);
 g.plane.position.set(0,0,-.003);g.plane.scale.set(size,size,1);
 const grass=s.groundMode==='grass',map=grass?g.texture:null;
 if(g.plane.material.map!==map){g.plane.material.map=map;g.plane.material.needsUpdate=true;}
 g.plane.material.color.set(grass?'#ffffff':s.groundColor);g.texture.repeat.set(size,size);
 if(g.size!==size){g.grid.geometry.dispose();const temp=new T.GridHelper(size,Math.min(128,Math.max(8,Math.round(size))),0x52665b,0x52665b);g.grid.geometry=temp.geometry;temp.material.dispose();g.size=size;}
 g.grid.rotation.set(Math.PI/2,0,0);g.grid.position.set(0,0,-.001);
}
export function dispose(g){if(!g)return;g.group.removeFromParent();g.plane.geometry.dispose();g.plane.material.dispose();g.grid.geometry.dispose();g.grid.material.dispose();g.texture.dispose();}
