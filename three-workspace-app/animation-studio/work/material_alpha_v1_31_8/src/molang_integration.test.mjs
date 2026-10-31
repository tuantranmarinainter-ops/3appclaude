import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import * as C from './core.js';
import { previewAt } from './timeline_tools.js';

const pose = () => ({ p: [0, 0, 0], q: [0, 0, 0, 1], s: [1, 1, 1] });
function fixture() {
  const root = new T.Group(), bone = new T.Bone();
  root.add(bone);
  const rig = C.makeRig(root), project = C.newProject(rig);
  project.duration = 1;
  project.loop = [0, 1];
  C.addKey(project, 'b0', 0, pose(), 'linear');
  return { rig, project };
}
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`);

test('expression preview, fallback, validation and JSON round trip', () => {
  const { rig, project } = fixture();
  project.molangVariables = { amplitude: 15 };
  assert.equal(C.setKeyExpression(project, 'b0', 0, 'r', 0, 'math.sin(q.anim_time*360)*v.amplitude').error, null);
  assert.equal(C.setKeyExpression(project, 'b0', 0, 'p', 0, 'q.anim_time*4').error, null);
  const saved = C.validateProject(JSON.parse(JSON.stringify(project)), rig);
  for (const [time, rotation, position] of [[0, 0, 0], [0.25, 15, 1], [0.5, 0, 2]]) {
    C.evaluate(rig, saved, time);
    close(C.graphCurves.euler(C.snap(rig.records[0].o).q)[0], rotation);
    close(rig.records[0].o.position.x, position);
  }
  const previous = saved.keys.b0[0].p[0];
  assert.ok(C.setKeyExpression(saved, 'b0', 0, 'p', 0, 'math.sin(').error);
  C.evaluate(rig, saved, 0.25);
  close(rig.records[0].o.position.x, previous);
  assert.equal(saved.keys.b0[0].molang.p0, 'math.sin(');
  const beforeLongExpression = structuredClone(saved);
  assert.ok(C.setKeyExpression(saved, 'b0', 0, 'p', 0, '1'.repeat(4097)).error);
  assert.deepEqual(saved, beforeLongExpression);
  assert.doesNotThrow(() => C.validateProject(saved, rig));
  C.setKeyExpression(saved, 'b0', 0, 'p', 0, '');
  assert.equal(saved.keys.b0[0].molang.p0, undefined);
});

test('bake samples expression tracks at project FPS without altering source or unrelated tracks', () => {
  const { rig, project } = fixture();
  C.addKey(project, 'root', 0, pose(), 'step');
  C.setKeyExpression(project, 'b0', 0, 'p', 0, 'q.anim_time * 4');
  C.setKeyExpression(project, 'b0', 0, 'r', 1, 'q.anim_time * 90');
  const before = structuredClone(project), baked = C.bakeExpressions(project);
  assert.deepEqual(project, before);
  assert.deepEqual(baked.keys.root, project.keys.root);
  assert.equal(baked.keys.b0.length, project.duration * project.fps + 1);
  for (let i = 0; i < baked.keys.b0.length; i++) {
    const time = i / project.fps;
    C.evaluate(rig, project, time);
    const expected = C.snap(rig.records[0].o);
    C.evaluate(rig, baked, time);
    const actual = C.snap(rig.records[0].o);
    expected.p.forEach((v, j) => close(v, actual.p[j]));
    expected.q.forEach((v, j) => close(v, actual.q[j]));
    assert.equal(baked.keys.b0[i].molang, undefined);
  }
  assert.equal(C.hasExpressions(baked), false);
  assert.deepEqual(C.bakeExpressions(baked), baked);
});

test('Lab base and layers use project variables and bake all expression tracks', () => {
  const { rig, project } = fixture();
  project.molangVariables = { amplitude: 2 };
  C.setKeyExpression(project, 'b0', 0, 'p', 0, 'v.amplitude * q.anim_time');
  project.lab = C.motionLab.create(project);
  project.keys = {};
  C.addKey(project, 'b0', 0, pose(), 'linear');
  C.setKeyExpression(project, 'b0', 0, 'p', 1, 'v.amplitude * q.anim_time');
  C.evaluate(rig, project, 0.5);
  const before = C.snap(rig.records[0].o);
  close(before.p[0], 1);
  close(before.p[1], 1);
  const baked = C.bakeExpressions(project);
  assert.equal(C.hasExpressions(baked), false);
  C.evaluate(rig, baked, 0.5);
  C.snap(rig.records[0].o).p.forEach((v, i) => close(v, before.p[i]));
});

test('bake retains all FPS grid samples and the non-grid endpoint', () => {
  const { project } = fixture();
  project.duration = 0.1;
  project.fps = 24;
  C.setKeyExpression(project, 'b0', 0, 'p', 0, 'q.anim_time');
  const keys = C.bakeExpressions(project).keys.b0;
  assert.deepEqual(keys.map((key) => key.time), [0, 1 / 24, 2 / 24, 0.1]);
  keys.forEach((key) => close(key.p[0], key.time));
});

test('life_time keeps advancing across playback loops while anim_time wraps', () => {
  const { rig, project } = fixture();
  C.setKeyExpression(project, 'b0', 0, 'p', 0, 'q.anim_time');
  C.setKeyExpression(project, 'b0', 0, 'p', 1, 'query.life_time');
  for (const elapsed of [0.25, 1.25]) {
    const time = previewAt(project, elapsed).time;
    close(time, 0.25);
    C.evaluate(rig, project, time, { lifeTime: elapsed });
    close(rig.records[0].o.position.x, 0.25);
    close(rig.records[0].o.position.y, elapsed);
  }
  C.evaluate(rig, project, 0.25);
  close(rig.records[0].o.position.y, 0.25);
  close(C.bakeExpressions(project).keys.b0[15].p[1], 0.5);

  project.lab = C.motionLab.create(project);
  project.keys = {};
  C.addKey(project, 'b0', 0, pose(), 'linear');
  C.setKeyExpression(project, 'b0', 0, 'p', 2, 'query.life_time');
  C.evaluate(rig, project, 0.25, { lifeTime: 1.25 });
  close(rig.records[0].o.position.y, 1.25);
  close(rig.records[0].o.position.z, 1.25);
});
