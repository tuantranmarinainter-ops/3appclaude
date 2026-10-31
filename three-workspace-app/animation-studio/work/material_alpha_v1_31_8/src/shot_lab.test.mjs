import { useClassicLayout } from './classic_test_layout.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
const artifact = fileURLToPath(
  new URL('../../../outputs/Animation_Studio_v1_33_0.html', import.meta.url),
);
const { chromium } = createRequire(
  new URL('../../../../editor/apps/studio/package.json', import.meta.url),
)('playwright');

test(
  'shot export bakes weighted Motion Lab layers and clip timing without losing edits or doubling actor travel',
  { skip: !existsSync(artifact), timeout: 120000 },
  async () => {
    const server = createServer((_req, res) => {
      res.setHeader('content-type', 'text/html');
      res.end(readFileSync(artifact));
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await useClassicLayout(page);
      await page.goto(`http://127.0.0.1:${server.address().port}/`);
      await page.waitForFunction(() => window.__studio?.ready);
      const result = await page.evaluate(async () => {
        const T = await import('three'),
          C = await import('@studio/core'),
          { placementPolicy, bakeEditedGLB, readGLB } = await import('@studio/shot-export');
        const assert = {
          ok(value) {
            if (!value) throw Error('Lab pose/root assertion failed');
          },
          equal(a, b) {
            if (a !== b) throw Error(`Expected ${a} === ${b}`);
          },
          deepEqual(a, b) {
            if (JSON.stringify(a) !== JSON.stringify(b)) throw Error('Lab state changed');
          },
        };
        const root = new T.Group(),
          bone = new T.Bone();
        bone.name = 'NativeJaw';
        root.add(bone);
        const rig = C.makeRig(root),
          base = C.newProject(rig);
        base.duration = 1;
        base.loop = [0, 1];
        const pose = { p: [0, 0, 0], q: [0, 0, 0, 1], s: [1, 1, 1] };
        C.addKey(base, 'root', 0, pose, 'linear');
        C.addKey(base, 'root', 1, { ...pose, p: [1, 0, 0] }, 'linear');
        C.addKey(base, 'b0', 0, pose, 'linear');
        C.addKey(
          base,
          'b0',
          1,
          {
            ...pose,
            q: new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 0, 1), 0.4).toArray(),
          },
          'linear',
        );
        const project = C.clone(base);
        project.lab = C.motionLab.create(base);
        project.keys = {};
        project.ikModes = {};
        project.ikOptions = {};
        project.lab.clips[0].reverse = true;
        project.lab.layers[0].weight = 0.5;
        C.addKey(
          project,
          'b0',
          0,
          {
            ...pose,
            q: new T.Quaternion().setFromAxisAngle(new T.Vector3(1, 0, 0), 0.6).toArray(),
          },
          'linear',
        );
        C.addKey(project, 'root', 0, { ...pose, p: [2, 0, 0] }, 'linear');
        project.lab.layers.push({
          id: 'muted',
          name: 'Muted',
          weight: 1,
          muted: true,
          keys: { b0: [{ ...pose, p: [100, 0, 0], time: 0, interp: 'linear' }] },
          ikModes: {},
          ikOptions: {},
        });
        const before = C.clone(project),
          expected = [];
        for (let frame = 0; frame <= 30; frame++) {
          C.evaluate(rig, project, frame / 30);
          expected.push({ bone: C.snap(bone), root: C.snap(root) });
        }
        const live = C.capture(rig),
          session = {
            sourceProject: base,
            character: { placement: { position: [3, 0, 0], yawDegrees: 0 } },
            placementKeys: [],
            shot: { frameRange: [60, 90] },
          };
        const policy = placementPolicy(rig, project, session);
        assert.deepEqual(project, before);
        assert.deepEqual(C.capture(rig), live);
        assert.equal(policy.project.lab, undefined);
        assert.deepEqual(policy.project.keys.root, base.keys.root);
        for (let frame = 0; frame <= 30; frame++) {
          C.evaluate(rig, policy.project, frame / 30);
          assert.ok(
            bone.quaternion.angleTo(new T.Quaternion().fromArray(expected[frame].bone.q)) < 1e-7,
          );
          assert.ok(
            bone.position.distanceTo(new T.Vector3().fromArray(expected[frame].bone.p)) < 1e-7,
          );
          const placement = policy.placementKeys.find((k) => k.frame === 60 + frame);
          assert.ok(
            Math.abs(placement.position[0] - (3 + expected[frame].root.p[0] - frame / 30)) < 1e-7,
          );
        }
        const output = readGLB(await bakeEditedGLB(rig, policy.project, 'Lab edit')).json;
        assert.equal(output.animations.length, 1);
        assert.equal(output.skins[0].joints.length, 1);
        assert.equal(output.animations[0].channels.length, 3);
        return {
          frames: 31,
          joints: output.skins[0].joints.length,
          labEditsPreserved: true,
          rootSeparated: true,
        };
      });
      assert.deepEqual(result, {
        frames: 31,
        joints: 1,
        labEditsPreserved: true,
        rootSeparated: true,
      });
    } finally {
      await browser.close();
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  },
);
