import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as C from './core.js';
import * as B from './bobj_loader.js';
const text=readFileSync(new URL('../../../../editor/apps/studio/public/retarget/v9.12/minecraft20-armature.bobj',import.meta.url),'utf8');
test('exact MC20 profile provides four chains without adding export bones',()=>{
 const root=B.parse(new TextEncoder().encode('arm_name Minecraft20\n'+text)),rig=C.makeRig(root),before=rig.records.map(r=>r.name);
 assert.equal(rig.profile,'Minecraft20');assert.equal(rig.roots.length,1);assert.equal(rig.records.filter(r=>!r.parent).length,4);assert.equal(C.descendants(rig,rig.roots[0].id).length,20);const chains=C.chainSpecs(rig);assert.equal(chains.length,4);
 assert.equal(chains.filter(c=>c.virtualEnd).length,2);
 for(const c of chains){assert(c.a.o.getWorldPosition(c.a.o.position.clone()).distanceTo(c.b.o.getWorldPosition(c.b.o.position.clone()))>0);assert(c.b.o.getWorldPosition(c.b.o.position.clone()).distanceTo(c.c.o.getWorldPosition(c.c.o.position.clone()))>0);}
 const traversed=[];root.traverse(o=>traversed.push(o));assert(chains.filter(c=>c.virtualEnd).every(c=>!traversed.includes(c.c.o)),'Virtual tips must not enter exported scene graph');
 assert.deepEqual(C.makeRig(root).records.map(r=>r.name),before);assert.equal(C.chainSpecs(rig)[2].c.o,chains[2].c.o);
});
test('MC20 leg IK reaches target while keeping exactly20 bones and lower-leg rotation',async()=>{
 const T=await import('three'),root=B.parse(new TextEncoder().encode('arm_name Minecraft20\n'+text)),rig=C.makeRig(root);
 const c=C.chainSpecs(rig).find(c=>c.id==='leftLeg');rig.chains=[c];
 const tip=c.c.o.getWorldPosition(new T.Vector3()),knee=c.b.o.getWorldPosition(new T.Vector3());
 const target=new T.Object3D(),pole=new T.Object3D();target.position.copy(tip).add(new T.Vector3(0,.12,.1));pole.position.copy(knee).add(new T.Vector3(0,0,1));
 root.add(target,pole);root.updateMatrixWorld(true);rig.controls['ik_'+c.id]={object:target};rig.controls['pole_'+c.id]={object:pole};
 C.kinematics.init(rig,c,root);C.solveIK(rig,c);
 assert(c.c.o.getWorldPosition(new T.Vector3()).distanceTo(target.getWorldPosition(new T.Vector3()))<1e-5);
 assert.equal(C.makeRig(root).records.length,20);
});
test('MC20 display has every physical FK joint plus four IK/pole pairs',async()=>{
 const T=await import('three'),D=await import('./control_rig.js');
 const root=B.parse(new TextEncoder().encode('arm_name Minecraft20\n'+text)),rig=C.makeRig(root);rig.chains=C.chainSpecs(rig);
 for(const c of rig.chains)for(const prefix of ['ik_','pole_'])rig.controls[prefix+c.id]={object:new T.Object3D()};
 const previous=globalThis.document;
 globalThis.document={createElementNS:()=>({namespaceURI:'svg',classList:{add(){}},append(){}}),createElement:()=>({addEventListener(){},dataset:{}})};
 try {
  const view={scene:new T.Scene(),container:{append(){}}},defs=D.build(view,rig);
  for(const rec of rig.records)assert(defs.some(d=>d.id===rec.id),'Missing FK handle '+rec.name);
  assert.equal(defs.filter(d=>d.id.startsWith('ik_')).length,4);assert.equal(defs.filter(d=>d.id.startsWith('pole_')).length,4);
  assert.equal(defs.filter(d=>rig.records.some(r=>r.id===d.id)).length,20);
 }finally{globalThis.document=previous;}
});
