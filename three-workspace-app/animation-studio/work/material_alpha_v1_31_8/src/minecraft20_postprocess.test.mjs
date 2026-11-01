import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as T from 'three';
import * as C from './core.js';
import * as BOBJ from './bobj_loader.js';
import { minecraft20BOBJ } from './minecraft20_export.js';
import { untwistLimbs, limbTwistDegrees } from './minecraft20_postprocess.js';
import { parseBobjArmature } from '../../../../editor/packages/retarget/src/reverse.ts';
import {
  untwistLimbs as app1Untwist,
  exportMinecraft20,
} from '../../../../editor/packages/retarget/cli/toMinecraft20.ts';
const armatureText = readFileSync(
  new URL(
    '../../../../editor/apps/studio/public/retarget/v9.12/minecraft20-armature.bobj',
    import.meta.url,
  ),
  'utf8',
);
const armature = parseBobjArmature(armatureText),
  matrixError = (a, b) => Math.max(...a.elements.map((v, i) => Math.abs(v - b.elements[i])));
function handError(worlds) {
  return Math.max(
    ...['low_left_arm.end', 'low_right_arm.end'].map((name) => {
      const b = armature.bones.find((b) => b.name === name),
        local = worlds.get(b.parent).clone().invert().multiply(worlds.get(name));
      return matrixError(local, new T.Matrix4().fromArray(b.restLocal));
    }),
  );
}
globalThis.FileReader = class {
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then((x) => {
      this.result = x;
      this.onloadend?.();
    });
  }
  readAsDataURL(blob) {
    blob.arrayBuffer().then((x) => {
      this.result = 'data:application/octet-stream;base64,' + Buffer.from(x).toString('base64');
      this.onloadend?.();
    });
  }
};
for (const degrees of [60, 120, 179])
  test('correct ' + degrees + ' degree twist, lock hands, preserve bend and match App1', () => {
    const worlds = new Map(
      armature.bones.map((b) => [b.name, new T.Matrix4().fromArray(b.restWorld)]),
    );
    for (const name of ['low_left_arm', 'low_right_arm', 'low_left_leg', 'low_leg_right']) {
      const b = armature.bones.find((b) => b.name === name),
        q = new T.Quaternion().setFromAxisAngle(
          new T.Vector3(...b.localTail).normalize(),
          (degrees * Math.PI) / 180,
        );
      worlds.get(name).multiply(new T.Matrix4().makeRotationFromQuaternion(q));
    }
    const before = [...worlds].map(([n, m]) => [n, m.toArray()]),
      corrected = untwistLimbs(armature, worlds),
      expected = app1Untwist(armature, worlds);
    assert(corrected.maxBeforeDegrees > 50);
    assert(Math.max(...Object.values(limbTwistDegrees(armature, corrected.worlds))) <= 15);
    assert(handError(corrected.worlds) < 1e-6);
    for (const [n, w] of corrected.worlds) {
      assert(matrixError(w, expected.worlds.get(n)) < 1e-12);
      assert.deepEqual(worlds.get(n).toArray(), before.find(([name]) => name === n)[1]);
    }
  });
test(
  'real normalized GLB: written BOBJ at every tick stays untwisted, hands rest, matches App1',
  { skip: !process.env.SHOT_TEST_ASSET ? 'Set SHOT_TEST_ASSET to App1 normalized GLB.' : false },
  async () => {
    const bytes = new Uint8Array(readFileSync(process.env.SHOT_TEST_ASSET)),
      samples = [];
    const text = await minecraft20BOBJ(bytes, { onSample: (s) => samples.push(s) }),
      root = BOBJ.parse(new TextEncoder().encode(text)),
      rig = C.makeRig(root),
      app1 = await exportMinecraft20(bytes, armatureText, { rootTravelMode: 'follow' });
    assert.equal(rig.records.length, 20);
    assert.equal(root.bobjActions.length, 1);
    assert(samples.length > 1);
    let maxTwist = 0,
      maxHand = 0,
      maxBefore = 0;
    for (const sample of samples) {
      assert(sample.maxAfterDegrees <= 15);
      assert(handError(sample.worlds) < 1e-6);
      maxBefore = Math.max(maxBefore, sample.maxBeforeDegrees);
      C.resetRig(rig);
      BOBJ.sample(rig, 0, sample.time);
      const worlds = new Map(rig.records.map((r) => [r.name, r.o.matrixWorld.clone()]));
      maxTwist = Math.max(maxTwist, ...Object.values(limbTwistDegrees(armature, worlds)));
      maxHand = Math.max(maxHand, handError(worlds));
    }
    assert(maxTwist <= 15, 'serialized twist ' + maxTwist);
    assert(maxHand <= 1e-6, 'serialized hand error ' + maxHand);
    assert(Math.abs(maxTwist - app1.report.limbTwist.maxAfterDegrees) <= 1);
    console.log(
      JSON.stringify({
        ticks: samples.length,
        maxBeforeDegrees: maxBefore,
        app3WrittenTwistDegrees: maxTwist,
        app1TwistDegrees: app1.report.limbTwist.maxAfterDegrees,
        handMatrixMaxError: maxHand,
      }),
    );
  },
);
