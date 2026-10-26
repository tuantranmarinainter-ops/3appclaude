import {test} from 'node:test';import assert from 'node:assert/strict';
import {capturePose,mapPose} from './pose_clipboard.js';
const pose=(p=[0,0,0])=>({p,q:[0,0,0,1],s:[1,1,1]});
function rig(prefix='',reverse=false){const records=[{id:'hip',name:prefix+'Hips',parent:null,rest:pose([0,1,0]),o:{position:{toArray:()=>[7,2,9]}}},{id:'arm',name:prefix+'LeftArm',parent:'hip',rest:pose([1,0,0]),o:{position:{toArray:()=>[1,0,0]}}}];if(reverse){records.reverse();for(const r of records){r.id='to-'+r.id;if(r.parent)r.parent='to-'+r.parent;}}return{fingerprint:'test',records,root:{position:{toArray:()=>[10,0,20]}}};}
test('maps by names and hierarchy across reordered IDs; keeps root place by default and copies XYZ on request',()=>{
 const source=rig('mixamorig:'),data={root:pose([3,4,5]),hip:pose([0,8,0]),arm:pose([1,.2,0])},clip=capturePose(source,data),target=rig('',true),before=structuredClone(clip);
 data.hip.p[1]=999;const mapped=mapPose(clip,target);assert.deepEqual(mapped.root.p,[10,0,20]);assert.deepEqual(mapped['to-hip'].p,[7,2,9]);assert.deepEqual(mapped['to-arm'].p,[1,.2,0]);
 const high=mapPose(clip,target,{keepHeight:true});assert.deepEqual(high.root.p,[3,4,5]);assert.deepEqual(high['to-hip'].p,[0,8,0]);assert.deepEqual(clip,before);
});
test('missing, ambiguous, changed hierarchy, orientation and non-finite poses reject without mutation',()=>{
 const source=rig(),clip=capturePose(source,{hip:pose(),arm:pose()}),target=rig();
 for(const mutate of [r=>r.records.pop(),r=>r.records.push({...r.records[1],id:'duplicate'}),r=>r.records[1].parent=null,r=>r.records[1].rest.q=[1,0,0,0]]){const to=rig();mutate(to);const before=JSON.stringify(to);assert.throws(()=>mapPose(clip,to));assert.equal(JSON.stringify(to),before);}
 const invalid=structuredClone(clip);invalid.data.arm.p[0]=NaN;assert.throws(()=>mapPose(invalid,target));assert.deepEqual(clip,capturePose(source,{hip:pose(),arm:pose()}));
});
