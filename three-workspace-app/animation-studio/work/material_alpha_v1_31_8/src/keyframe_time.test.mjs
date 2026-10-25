import {test} from 'node:test';
import assert from 'node:assert/strict';
import {transformKeyTimes} from './keyframe_time.js';
const key=frame=>({time:frame/30,p:[frame,0,0],q:[0,0,0,1],s:[1,1,1],interp:'linear'});
const project={duration:4,keys:{root:[0,30,45,60,90].map(key)},ikModes:{arm:[{time:3,mode:'ik'}]},ikOptions:{},lab:{clips:[{speed:1,length:4}]}};
const refs=[30,45,60].map(f=>({id:'root',time:f/30}));
test('30-60 compressed to 30-45 doubles speed and ripple moves later tracks -15 frames',()=>{
 const before=structuredClone(project),result=transformKeyTimes(project,refs,1,1.5,true);
 assert.deepEqual(result.project.keys.root.map(k=>k.time*30),[0,30,37.5,45,75]);assert.equal(result.project.ikModes.arm[0].time*30,75);
 assert.equal((60-30)/(result.project.keys.root[3].time-result.project.keys.root[1].time),60);
 assert.deepEqual(result.project.keys.root.map(k=>k.p),project.keys.root.map(k=>k.p));assert.deepEqual(result.project.lab,project.lab);assert.deepEqual(project,before);
});
test('move, expand, left edge and single key preserve values',()=>{
 assert.deepEqual(transformKeyTimes(project,refs,.5,1.5).selection.map(r=>r.time),[.5,1,1.5]);
 assert.deepEqual(transformKeyTimes(project,refs,1,2.5,true).selection.map(r=>r.time),[1,1.75,2.5]);
 assert.deepEqual(transformKeyTimes(project,refs,.5,2).selection.map(r=>r.time),[.5,1.25,2]);
 assert.equal(transformKeyTimes(project,[refs[0]],.5,.5).selection[0].time,.5);
});
test('collision, stale selection, collapsed/reversed range and out of bounds reject atomically',()=>{
 const before=structuredClone(project);
 for(const run of [()=>transformKeyTimes(project,refs,0,1),()=>transformKeyTimes(project,refs,1,3),()=>transformKeyTimes(project,refs,1,1),()=>transformKeyTimes(project,refs,2,1),()=>transformKeyTimes(project,refs,-1,1),()=>transformKeyTimes(project,[{id:'root',time:.1}],1,1)])assert.throws(run);
 assert.deepEqual(project,before);
});
