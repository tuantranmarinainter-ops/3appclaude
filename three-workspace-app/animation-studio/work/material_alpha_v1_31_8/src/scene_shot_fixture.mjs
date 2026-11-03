// Test helper for the "1 khung · Cả cảnh" browser tests. buildSceneShot is serialised with toString() and runs
// inside the built Animation Studio page: it keys the sample Mixamo rig, exports two different animated GLBs with
// the app's own exporter, and returns the in-memory files of a scene-mode shot package (no Studio, no disk).
export const buildSceneShot = async ({ count = 3, heightScale, aspect = 2, sceneMode = true, names }) => {
  const S = window.__studio,
    C = S.core;
  const { sha256 } = await import('@studio/shot-package');
  const T = await import('three');
  const rest = C.capture(S.rig());
  const bone = (n) => S.rig().records.find((r) => r.name === 'mixamorig:' + n).id;
  const quat = (x, y, z) => new T.Quaternion().setFromEuler(new T.Euler(x, y, z)).toArray();
  async function makeGlb(variant) {
    const p = S.serialized(false);
    p.keys = {};
    p.duration = 2;
    p.loop = [0, 2];
    const put = (id, t, edit) => {
      const v = C.clone(rest[id]);
      edit(v);
      C.addKey(p, id, t, v, 'linear');
    };
    for (const t of [0, 1, 2]) {
      const k = t / 2;
      put('root', t, () => {});
      put(bone('Hips'), t, (v) => {
        v.q = quat(0, (variant ? -1 : 1) * 0.8 * k, 0);
        v.p = [v.p[0] + (variant ? -40 : 40) * k, v.p[1], v.p[2] + 15 * Math.sin(k * Math.PI)];
      });
      put(bone('LeftArm'), t, (v) => (v.q = quat(0, 0, Math.sin(k * Math.PI))));
      put(bone('RightUpLeg'), t, (v) => (v.q = quat(-0.9 * k, 0, 0)));
    }
    await S.loadProject(p);
    const exported = await S.exportCapture();
    return Uint8Array.from(atob(exported.data), (c) => c.charCodeAt(0));
  }
  const glbs = [await makeGlb(0), await makeGlb(1)];
  const files = {};
  const shot = {
    version: '1.0.0',
    shotId: 'scene-shot-test',
    sceneId: 'scene',
    fps: 30,
    frameRange: [0, 60],
    camera: { keys: [] },
    characters: [],
    references: [],
  };
  if (sceneMode) shot.sceneMode = true;
  if (aspect) shot.camera.aspect = aspect;
  for (let f = 0; f <= 60; f++) {
    const a = (f / 60) * Math.PI * 0.5;
    shot.camera.keys.push({
      frame: f,
      position: [4 * Math.sin(a), 1.6, 4 * Math.cos(a) + 1],
      lookAt: [0.3, 1, 0],
      fovYDegrees: 40 + f * 0.1,
    });
  }
  const places = [
    [0, 0, 0, 0],
    [1.6, 0, -1, 90],
    [-1.5, 0, -0.5, -135],
    [2.5, 0, 1.5, 30],
    [-2.4, 0, 1.2, 200],
  ];
  for (let i = 0; i < count; i++) {
    const bytes = glbs[i % 2],
      id = 'char' + i,
      uuid = [8, 4, 4, 4, 12].map((n, j) => (i + 1 + j).toString(16).padStart(n, '0')).join('-'),
      hash = await sha256(bytes),
      prefix = 'characters/' + id;
    files[prefix + '.glb'] = bytes;
    files[prefix + '.manifest.json'] = new TextEncoder().encode(
      JSON.stringify({ version: '1.0.0', glbSha256: hash, actions: [{ uuid, name: 'Act' + i, glbAnimationIndex: 0 }] }),
    );
    const [x, y, z, yaw] = places[i];
    shot.characters.push({
      characterId: id,
      glb: prefix + '.glb',
      manifest: prefix + '.manifest.json',
      glbSha256: hash,
      actionUuid: uuid,
      clip: { sourceStartSeconds: 0, sourceEndSeconds: 2, speed: 1, loop: false, reverse: false },
      placement: { position: [x, y, z], yawDegrees: yaw },
      rootPolicy: 'skeletal',
      editable: true,
      ...(names?.[i] ? { name: names[i] } : {}),
      ...(heightScale ? { heightScale, heightBlocks: heightScale * 1.8 } : {}),
    });
  }
  files['shot.json'] = new TextEncoder().encode(JSON.stringify(shot));
  return { files, shot };
};
