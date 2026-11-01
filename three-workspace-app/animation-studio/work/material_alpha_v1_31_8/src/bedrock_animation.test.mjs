import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import * as C from './core.js';
import * as B from './bedrock_animation.js';

// Two-bone rig under a scaled armature (like Mixamo's 0.01 root) with non-zero rest rotations.
function fixture() {
  const root = new T.Group(), armature = new T.Group(), hip = new T.Bone(), arm = new T.Bone();
  armature.scale.setScalar(0.01);
  hip.name = 'mixamorig:Hips';
  arm.name = 'mixamorig:LeftArm';
  hip.position.set(0, 100, 0);
  arm.position.set(15, 20, -3);
  arm.quaternion.setFromEuler(new T.Euler(0.3, -0.5, 1.1, 'XYZ'));
  root.add(armature);
  armature.add(hip);
  hip.add(arm);
  const rig = C.makeRig(root), project = C.newProject(rig);
  project.duration = 1;
  project.loop = [0, 1];
  return { rig, project };
}
const restOf = (rig, id) => rig.records.find((r) => r.id === id).rest;
const turned = (rest, deg) => ({
  p: [...rest.p],
  q: new T.Quaternion().fromArray(rest.q).multiply(new T.Quaternion().setFromEuler(new T.Euler(...deg.map((d) => (d * Math.PI) / 180), 'XYZ'))).toArray(),
  s: [...(rest.s || [1, 1, 1])],
});
const angle = (a, b) => new T.Quaternion().fromArray(a).normalize().angleTo(new T.Quaternion().fromArray(b).normalize());
const roundTrip = (rig, project) => {
  const { file } = B.exportAnimation(project, rig, { sample: (keys, t, rest) => C.sampleKeys(keys, t, rest, project) });
  return { file, back: B.importAnimation(JSON.parse(JSON.stringify(file)), rig) };
};

test('numeric keys round trip within 1e-4 (rotation, position, scale, step, catmullrom)', () => {
  const { rig, project } = fixture();
  const arm = rig.records[1].id, hip = rig.records[0].id;
  const rest = restOf(rig, arm), hipRest = restOf(rig, hip);
  C.addKey(project, arm, 0, turned(rest, [0, 0, 0]), 'linear');
  C.addKey(project, arm, 0.25, turned(rest, [40, -20, 75]), 'step');
  C.addKey(project, arm, 0.5, { ...turned(rest, [-30, 60, 10]), s: [1.2, 0.8, 1] }, 'auto');
  C.addKey(project, arm, 1, turned(rest, [5, 5, 5]), 'linear');
  C.addKey(project, hip, 0, { ...hipRest, p: [0.4, 101, -2] }, 'linear');
  C.addKey(project, hip, 1, { ...hipRest, p: [-3, 98.5, 7] }, 'linear');
  const { file, back } = roundTrip(rig, project);
  const name = Object.keys(file.animations)[0];
  assert.equal(name, 'animation.animation_m_i');
  assert.deepEqual(Object.keys(file.animations[name].bones).sort(), ['Hips', 'LeftArm']);
  assert.equal(file.animations[name].bones.LeftArm.rotation['0.5'].lerp_mode, 'catmullrom');
  assert.ok(file.animations[name].bones.LeftArm.rotation['0.5'].pre, 'step before 0.5 must emit pre/post');
  for (const id of [arm, hip]) {
    const a = project.keys[id], b = back.keys[id];
    assert.equal(b.length, a.length);
    a.forEach((k, i) => {
      assert.ok(Math.abs(k.time - b[i].time) < 1e-9);
      assert.ok(angle(k.q, b[i].q) * (180 / Math.PI) < 1e-4, `rotation ${id}@${k.time}`);
      k.p.forEach((v, j) => assert.ok(Math.abs(v - b[i].p[j]) < 1e-4, `position ${id}@${k.time}`));
      (k.s || [1, 1, 1]).forEach((v, j) => assert.ok(Math.abs(v - b[i].s[j]) < 1e-4, `scale ${id}@${k.time}`));
      assert.equal(b[i].interp, k.interp === 'cubic' ? 'auto' : k.interp, `interp ${id}@${k.time}`);
    });
  }
});

test('Bedrock units: 16 px per block through the armature scale, X/Y rotation and X position flipped', () => {
  const { rig, project } = fixture();
  const hip = rig.records[0].id, rest = restOf(rig, hip);
  C.addKey(project, hip, 0, { ...rest, p: [rest.p[0] + 100, rest.p[1], rest.p[2]] }, 'linear');
  const { file } = roundTrip(rig, project);
  const value = Object.values(file.animations)[0].bones.Hips.position;
  // 100 local units * 0.01 m = 1 block = 16 px, X negated.
  assert.deepEqual(value, [-16, 0, 0]);
  const arm = rig.records[1].id, armRest = restOf(rig, arm);
  const bone = B.exportBones(rig).find((b) => b.id === arm);
  const q = B.quatZYX(B.eulerZYX(armRest.q).map((v, i) => v + [10, 20, 30][i]));
  assert.deepEqual(B.toBedrock('r', { q }, bone).map((v) => Math.round(v * 1e6) / 1e6), [-10, -20, 30]);
});

test('Molang expressions export as wrapped strings and import back unchanged', () => {
  const { rig, project } = fixture();
  const arm = rig.records[1].id, rest = restOf(rig, arm);
  C.addKey(project, arm, 0, turned(rest, [0, 0, 0]), 'linear');
  C.addKey(project, arm, 1, turned(rest, [0, 0, 0]), 'linear');
  project.molangVariables = { amp: 15 };
  assert.equal(C.setKeyExpression(project, arm, 0, 'r', 2, 'math.sin(q.anim_time*360)*v.amp').error, null);
  assert.equal(C.setKeyExpression(project, arm, 0, 'p', 0, 'q.anim_time*4').error, null);
  assert.equal(C.setKeyExpression(project, arm, 1, 's', 1, '1 + q.anim_time').error, null);
  const { file, back } = roundTrip(rig, project);
  const tag = Object.values(file.animations)[0].bones.LeftArm;
  assert.equal(typeof tag.rotation['0.0'][2], 'string');
  assert.match(tag.rotation['0.0'][2], /math\.sin\(q\.anim_time\*360\)\*v\.amp/);
  assert.deepEqual(back.keys[arm][0].molang, { r2: 'math.sin(q.anim_time*360)*v.amp', p0: 'q.anim_time*4' });
  assert.deepEqual(back.keys[arm][1].molang, { s1: '1 + q.anim_time' });
});

test('easing and smooth tracks are baked with a warning; play mode and delays map to loop fields', () => {
  const { rig, project } = fixture();
  const arm = rig.records[1].id, rest = restOf(rig, arm);
  C.addKey(project, arm, 0, turned(rest, [0, 0, 0]), 'ease:quad-inout');
  C.addKey(project, arm, 1, turned(rest, [0, 90, 0]), 'linear');
  project.playMode = 'hold';
  project.startDelay = 0.5;
  const out = B.exportAnimation(project, rig, { sample: (keys, t, r) => C.sampleKeys(keys, t, r, project) });
  const animation = Object.values(out.file.animations)[0];
  assert.equal(animation.loop, 'hold_on_last_frame');
  assert.equal(animation.start_delay, 0.5);
  assert.equal(Object.keys(animation.bones.LeftArm.rotation).length, 31);
  assert.ok(out.warnings.some((w) => w.includes('bake')));
  const back = B.importAnimation(out.file, rig);
  assert.equal(back.playMode, 'hold');
  assert.equal(back.startDelay, 0.5);
  project.playMode = 'loop';
  project.loopDelay = 0.25;
  assert.equal(Object.values(B.exportAnimation(project, rig, { sample: (k, t, r) => C.sampleKeys(k, t, r, project) }).file.animations)[0].loop_delay, 0.25);
});

test('foreign files: compact values, scalar scale, unmatched bones and errors', () => {
  const { rig } = fixture();
  const json = {
    format_version: '1.8.0',
    animations: {
      'animation.wave': {
        loop: true,
        animation_length: 2,
        bones: {
          LeftArm: { rotation: [0, 0, 45], scale: 2 },
          Tail: { rotation: { '0.0': [0, 0, 0], '1.0': [0, 30, 0] } },
        },
      },
    },
  };
  assert.deepEqual(B.listAnimations(json), ['animation.wave']);
  const { mapping, unmatched } = B.matchBones(json.animations['animation.wave'], rig);
  assert.deepEqual(unmatched, ['Tail']);
  const back = B.importAnimation(json, rig, { mapping });
  const arm = rig.records[1].id;
  assert.equal(back.duration, 2);
  assert.equal(back.playMode, 'loop');
  assert.deepEqual(Object.keys(back.keys), [arm]);
  assert.deepEqual(back.keys[arm][0].s.map((v) => Math.round(v * 1e6) / 1e6), restOf(rig, arm).s.map((v) => v * 2));
  assert.throws(() => B.listAnimations({}), /animations/);
  assert.throws(() => B.importAnimation({ animations: { a: { bones: { LeftArm: { rotation: { x: [0, 0, 0] } } } } } }, rig), /thời gian/);
});
