import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import * as T from 'three';
import * as C from './core.js';
import { bakeEditedGLB, readGLB, resultFiles, placementPolicy } from './shot_export.js';
import { sha256 } from './shot_package.js';
import { minecraft20BOBJ } from './minecraft20_export.js';
import * as BOBJ from './bobj_loader.js';
import { loadAsset } from '../../../../editor/packages/retarget/cli/loadAsset.ts';
// GLTFExporter needs FileReader in Node; browser production uses native FileReader.
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
const assetPath = process.env.SHOT_TEST_ASSET;
test(
  'real App1 GLB → edited GLB → App1 loader and Python validate-result',
  { skip: !assetPath ? 'Set SHOT_TEST_ASSET to an App1-normalized GLB.' : false },
  async () => {
    const bytes = new Uint8Array(readFileSync(assetPath)),
      manifest = JSON.parse(readFileSync(assetPath.replace(/\.glb$/, '.manifest.json'), 'utf8')),
      root = await loadAsset(bytes, 'glb'),
      rig = C.makeRig(root),
      project = C.newProject(rig),
      clip = root.animations[0];
    project.fps = 30;
    project.duration = Math.round(clip.duration * 30) / 30;
    project.loop = [0, project.duration];
    project.name = clip.name;
    const mixer = new T.AnimationMixer(root),
      action = mixer.clipAction(clip);
    action.setLoop(T.LoopOnce, 1);
    action.clampWhenFinished = true;
    action.play();
    for (let i = 0; i <= Math.round(project.duration * 30); i++) {
      C.resetRig(rig);
      action.reset().play();
      mixer.setTime(i / 30);
      for (const [id, value] of Object.entries(C.capture(rig)))
        C.addKey(project, id, i / 30, value, 'linear');
    }
    mixer.stopAllAction();
    const id = manifest.actions[0].uuid,
      h = await sha256(bytes),
      character = {
        characterId: 'hero',
        glb: 'hero.glb',
        manifest: 'hero.manifest.json',
        glbSha256: h,
        actionUuid: id,
        clip: {
          sourceStartSeconds: 0,
          sourceEndSeconds: clip.duration,
          speed: 1,
          loop: false,
          reverse: false,
        },
        placement: { position: [1, 0, 2], yawDegrees: 0 },
        rootPolicy: 'skeletal',
        editable: true,
      };
    const shot = {
        version: '1.0.0',
        shotId: 'roundtrip',
        sceneId: 'scene',
        fps: 30,
        frameRange: [100, 100 + Math.round(project.duration * 30)],
        camera: { keys: [{ frame: 100, position: [0, 2, 5], lookAt: [0, 1, 0], fovYDegrees: 45 }] },
        characters: [character],
        references: [],
      },
      shotBytes = new TextEncoder().encode(JSON.stringify(shot)),
      session = {
        shot,
        character,
        manifest,
        entry: manifest.actions[0],
        baseShotSha256: await sha256(shotBytes),
        sourceProject: structuredClone(project),
        placementKeys: [{ frame: 100, ...character.placement }],
      };
    // Modify one joint and translate actor root; actor displacement must not leak into skeletal GLB.
    const edited = structuredClone(project),
      bone = rig.records.find((r) => C.canon(r.name) === 'leftarm');
    edited.keys[bone.id].forEach(
      (k) =>
        (k.q = new T.Quaternion()
          .fromArray(k.q)
          .multiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 0, 1), 0.1))
          .toArray()),
    );
    edited.keys.root.forEach((k) => (k.p[0] += 2));
    const policy = placementPolicy(rig, edited, session);
    assert.equal(policy.placementKeys[0].position[0], 3);
    assert.deepEqual(policy.project.keys.root, session.sourceProject.keys.root);
    const glb = await bakeEditedGLB(rig, policy.project, session.entry.name),
      json = readGLB(glb).json,
      names = json.skins[0].joints.map((i) => json.nodes[i].name);
    assert.equal(names.length, 65);
    assert.equal(new Set(names).size, 65);
    assert(names.every((n) => !n.startsWith('mixamorig')));
    assert.equal(json.animations.length, 1);
    assert.equal(json.animations[0].name, session.entry.name);
    assert.equal(json.extras.bakeFps, 30);
    const loaded = await loadAsset(glb, 'glb');
    let joints = 0;
    loaded.traverse((o) => {
      if (o.isBone) joints++;
    });
    assert.equal(joints, 65);
    assert.equal(loaded.animations.length, 1);
    const files = await resultFiles(session, glb, policy.placementKeys),
      result = JSON.parse(new TextDecoder().decode(files['result.json']));
    assert.notEqual(result.edits[0].newActionUuid, id);
    assert.equal(result.baseShotSha256, session.baseShotSha256);
    if (process.env.SHOT_TEST_MINECRAFT20) {
      const bobj = await minecraft20BOBJ(glb),
        parsed = BOBJ.parse(new TextEncoder().encode(bobj)),
        joints = [];
      parsed.traverse((o) => {
        if (o.isBone) joints.push(o.name);
      });
      assert.equal(joints.length, 20);
      assert(joints.includes('body') && joints.includes('anchor'));
      assert.equal(parsed.bobjActions.length, 1);
      const result = JSON.parse(new TextDecoder().decode(files['result.json'])),
        path = 'edits/hero.minecraft20.bobj';
      result.edits[0].bobj = path;
      files[path] = new TextEncoder().encode(bobj);
      files['result.json'] = new TextEncoder().encode(JSON.stringify(result));
      console.log(
        'BOBJ App3 loader PASS: ' +
          joints.length +
          ' joints, ' +
          parsed.bobjActions.length +
          ' Action',
      );
    }
    const temp = mkdtempSync(join(tmpdir(), 'shot-result-'));
    try {
      for (const [n, b] of Object.entries({
        'shot/shot.json': shotBytes,
        'shot/hero.glb': bytes,
        'shot/hero.manifest.json': new TextEncoder().encode(JSON.stringify(manifest)),
        ...Object.fromEntries(Object.entries(files).map(([n, b]) => ['result/' + n, b])),
      })) {
        mkdirSync(dirname(join(temp, n)), { recursive: true });
        writeFileSync(join(temp, n), b);
      }
      const check = spawnSync(
        'python',
        [
          '-m',
          'agent.shot_package',
          'validate-result',
          join(temp, 'result'),
          '--shot',
          join(temp, 'shot'),
        ],
        { cwd: fileURLToPath(new URL('../../../../', import.meta.url)), encoding: 'utf8' },
      );
      assert.equal(check.status, 0, check.stdout + check.stderr);
      console.log(
        'Python validate-result PASS; App1 loadAsset: 65 joints, one Action; ' +
          glb.length +
          ' bytes',
      );
      if (process.env.SHOT_TEST_OUTPUT) {
        mkdirSync(process.env.SHOT_TEST_OUTPUT, { recursive: true });
        for (const [n, b] of Object.entries(files)) {
          const dest = join(process.env.SHOT_TEST_OUTPUT, n);
          mkdirSync(dirname(dest), { recursive: true });
          writeFileSync(dest, b);
        }
      }
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  },
);
