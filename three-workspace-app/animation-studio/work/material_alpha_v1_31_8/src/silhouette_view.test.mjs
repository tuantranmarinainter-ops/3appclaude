import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const require = createRequire(
  new URL('../../../../editor/apps/studio/package.json', import.meta.url),
);
const threeURL = pathToFileURL(
  path.join(path.dirname(require.resolve('three')), 'three.module.js'),
).href;
const T = await import(threeURL);
const code = readFileSync(new URL('./silhouette_view.js', import.meta.url), 'utf8').replace(
  "'three'",
  JSON.stringify(threeURL),
);
const { SilhouetteView } = await import(
  'data:text/javascript;base64,' + Buffer.from(code).toString('base64')
);

test('silhouette render transaction restores exact materials/visibility/environment and owns one flat material per mesh', () => {
  const scene = new T.Scene(),
    group = new T.Group(),
    original = new T.MeshStandardMaterial({ color: 0xff0000 });
  scene.add(group);
  const a = new T.Mesh(new T.BoxGeometry(), original),
    b = new T.Mesh(new T.BoxGeometry(), [original, original]);
  group.add(a, b);
  const helper = new T.AxesHelper(),
    floor = new T.Mesh(new T.PlaneGeometry(), original);
  scene.add(helper, floor);
  const background = new T.Color(0x123456),
    fog = new T.Fog(0xff0000, 1, 10);
  scene.background = background;
  scene.fog = fog;
  scene.overrideMaterial = original;
  const renderer = {
      toneMapping: T.ACESFilmicToneMapping,
      outputColorSpace: T.LinearSRGBColorSpace,
      shadowMap: { enabled: true },
    },
    view = { scene, renderer };
  const controller = new SilhouetteView();
  controller.set(true);
  let disposed = 0;
  const restore = controller.prepare(view, [a, b]);
  assert.ok(a.material.isMeshBasicMaterial);
  assert.equal(a.material.color.getHex(), 0x111111);
  assert.notEqual(a.material, b.material);
  assert.equal(a.material.toneMapped, false);
  a.material.addEventListener('dispose', () => disposed++);
  b.material.addEventListener('dispose', () => disposed++);
  const first = a.material;
  assert.equal(floor.visible, false);
  assert.equal(helper.visible, false);
  assert.equal(scene.background.getHex(), 0xf2f2f2);
  assert.equal(scene.fog, null);
  assert.equal(renderer.shadowMap.enabled, false);
  restore();
  assert.equal(a.material, original);
  assert.deepEqual(b.material, [original, original]);
  assert.equal(floor.visible, true);
  assert.equal(helper.visible, true);
  assert.equal(scene.background, background);
  assert.equal(scene.fog, fog);
  assert.equal(scene.overrideMaterial, original);
  assert.equal(renderer.toneMapping, T.ACESFilmicToneMapping);
  assert.equal(renderer.outputColorSpace, T.LinearSRGBColorSpace);
  assert.equal(renderer.shadowMap.enabled, true);
  const again = controller.prepare(view, [a, b]);
  assert.equal(a.material, first);
  again();
  controller.set(false);
  assert.equal(disposed, 2);
  assert.equal(controller.views.size, 0);
  assert.throws(() => controller.set(1), /boolean/);
});

test('silhouette prunes replaced meshes and restores hidden flags even after a rendering error', () => {
  const controller = new SilhouetteView(),
    scene = new T.Scene(),
    renderer = {
      toneMapping: 0,
      outputColorSpace: T.SRGBColorSpace,
      shadowMap: { enabled: false },
    },
    view = { scene, renderer };
  const mesh = new T.Mesh(new T.BoxGeometry(), new T.MeshBasicMaterial());
  mesh.visible = false;
  scene.add(mesh);
  controller.set(true);
  let disposed = 0;
  const restore = controller.prepare(view, [mesh]);
  mesh.material.addEventListener('dispose', () => disposed++);
  try {
    throw Error('render failed');
  } catch {
  } finally {
    restore();
  }
  assert.equal(mesh.visible, false);
  controller.prepare(view, [])();
  assert.equal(disposed, 1);
  controller.set(false);
});

test('silhouette keeps separate caches across views sharing a rig and disposes both', () => {
  const controller = new SilhouetteView(),
    scene = new T.Scene(),
    mesh = new T.Mesh(new T.BoxGeometry(), new T.MeshStandardMaterial());
  scene.add(mesh);
  const renderer = () => ({
      toneMapping: 0,
      outputColorSpace: T.SRGBColorSpace,
      shadowMap: { enabled: false },
    }),
    a = { scene, renderer: renderer() },
    b = { scene, renderer: renderer() },
    original = mesh.material;
  controller.set(true);
  let disposed = 0;
  const restoreA = controller.prepare(a, [mesh]),
    materialA = mesh.material;
  materialA.addEventListener('dispose', () => disposed++);
  restoreA();
  const restoreB = controller.prepare(b, [mesh]);
  assert.notEqual(mesh.material, materialA);
  mesh.material.addEventListener('dispose', () => disposed++);
  restoreB();
  assert.equal(mesh.material, original);
  controller.set(false);
  assert.equal(disposed, 2);
  assert.equal(controller.views.size, 0);
});
