import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const num = (v) => {
  if (!Number.isFinite(v)) throw Error('BOBJ: dữ liệu không hữu hạn.');
  return Math.abs(v) < 1e-10 ? '0' : Number(v.toFixed(9)).toString();
};
const matrixOf = (o) => o.matrixWorld.clone();
const compose = (p) => new T.Matrix4().compose(p.p, p.q, p.s);
function decompose(matrix, label) {
  const p = new T.Vector3(),
    q = new T.Quaternion(),
    s = new T.Vector3();
  matrix.decompose(p, q, s);
  const result = { p, q, s },
    again = compose(result);
  if (
    matrix.elements.some(
      (v, i) =>
        !Number.isFinite(v) || Math.abs(v - again.elements[i]) > 1e-5 * Math.max(1, Math.abs(v)),
    )
  )
    throw Error('BOBJ: transform có shear không biểu diễn được: ' + label);
  return result;
}
// Three.js intrinsic ZYX equals Blender's XYZ matrix composition (Rz Ry Rx).
function continuousEuler(q, previous) {
  const e = new T.Euler().setFromQuaternion(q, 'ZYX'),
    a = [e.x, e.y, e.z],
    b = [e.x + Math.PI, Math.PI - e.y, e.z + Math.PI];
  for (const v of [a, b])
    for (let j = 0; j < 3; j++)
      v[j] += Math.round((previous[j] - v[j]) / (2 * Math.PI)) * 2 * Math.PI;
  return a.reduce((s, v, j) => s + (v - previous[j]) ** 2, 0) <=
    b.reduce((s, v, j) => s + (v - previous[j]) ** 2, 0)
    ? a
    : b;
}

// Text BOBJ dialect already consumed by bobj_loader.js / BBS: rest * pose,
// row-major armature-space rest matrices, radians ZYX, 20 ticks per second.
export async function bobj(
  buffer,
  fps,
  { includeMesh = true, up = 'y', flipUV = true, preserveJointNames = false } = {},
) {
  if (!Number.isFinite(fps) || fps < 1 || fps > 120) throw Error('BOBJ: FPS không hợp lệ.');
  const gltf = await new GLTFLoader().parseAsync(buffer, ''),
    clip = gltf.animations[0];
  if (!clip) throw Error('Không có animation để xuất BOBJ.');
  // Bind tracks before restoring punctuation stripped by GLTFLoader (Minecraft hand .end joints).
  if (preserveJointNames) {
    for (const track of clip.tracks) {
      const binding = T.PropertyBinding.parseTrackName(track.name),
        node = T.PropertyBinding.findNode(gltf.scene, binding.nodeName);
      if (node && !binding.objectName)
        track.name =
          node.uuid +
          '.' +
          binding.propertyName +
          (binding.propertyIndex !== undefined ? '[' + binding.propertyIndex + ']' : '');
    }
    gltf.scene.traverse((o) => {
      if (typeof o.userData.name === 'string' && o.userData.name) o.name = o.userData.name;
    });
  }
  const scene = gltf.scene,
    objects = [];
  scene.updateMatrixWorld(true);
  scene.traverse((o) => {
    if (o.isBone || o.userData.studioJoint) objects.push(o);
  });
  if (!objects.length) throw Error('BOBJ: không tìm thấy xương.');
  // BBS consumes integer ticks. Sample directly at 20 Hz, preserving t=0;
  // round the final time up by at most one tick and retain the exact final pose.
  const tickRate = 20,
    count = Math.ceil(clip.duration * tickRate) + 1;
  if (count * (objects.length + 1) > 2000000)
    throw Error('BOBJ: quá nhiều mẫu; giảm FPS hoặc đoạn xuất.');
  const used = new Set(),
    safe = (name, fallback) => {
      let base = String(name || fallback).replace(/[\s\x00-\x1f/\\#]+/g, '_') || fallback;
      if (Number.isFinite(Number(base))) base = 'Bone_' + base;
      let n = base,
        i = 2;
      while (used.has(n)) n = base + '_' + i++;
      used.add(n);
      return n;
    };
  const arm = 'AnimationStudio',
    names = [safe('StudioRoot', 'Root'), ...objects.map((o, i) => safe(o.name, 'Bone' + i))],
    index = new Map(objects.map((o, i) => [o, i + 1]));
  const parents = [
    -1,
    ...objects.map((o) => {
      let p = o.parent;
      while (p && !index.has(p)) p = p.parent;
      return p ? index.get(p) : 0;
    }),
  ];
  const nativeRest = [new T.Matrix4(), ...objects.map(matrixOf)],
    restScale = nativeRest.map((m, i) => decompose(m, names[i]).s);
  if (restScale.some((v) => v.toArray().some((x) => Math.abs(x) < 1e-10)))
    throw Error('BOBJ: scale nghỉ bằng 0.');
  // Remove static object/bone scale from bind axes; the same right-hand
  // correction on every animated world matrix preserves skin deformation.
  const normalize = (matrices) =>
    matrices.map((m, i) =>
      m
        .clone()
        .multiply(
          new T.Matrix4().makeScale(1 / restScale[i].x, 1 / restScale[i].y, 1 / restScale[i].z),
        ),
    );
  const restWorld = normalize(nativeRest),
    restLocal = restWorld.map((m, i) =>
      parents[i] < 0 ? m.clone() : restWorld[parents[i]].clone().invert().multiply(m),
    );
  for (let i = 0; i < restLocal.length; i++) {
    if (Math.abs(restLocal[i].determinant()) < 1e-12)
      throw Error('BOBJ: scale nghỉ bằng 0: ' + names[i]);
    decompose(restLocal[i], names[i]);
  }
  const lines = [
    '# Animation Studio 1.28.1 — BOBJ / BBS',
    '# units: metres; up: ' + up + '; rotation: ZYX radians; ticks_per_second: 20',
    'arm_name ' + arm,
    'arm_action ' + safe(clip.name, 'Animation'),
  ];
  for (let i = 0; i < names.length; i++) {
    const child = parents.findIndex((p) => p === i),
      tail =
        child >= 0
          ? new T.Vector3().setFromMatrixPosition(restWorld[child])
          : new T.Vector3(0, 0.05, 0).applyMatrix4(restWorld[i]);
    const rowMajor = restWorld[i].clone().transpose().toArray();
    lines.push(
      'arm_bone ' +
        names[i] +
        (parents[i] >= 0 ? ' ' + names[parents[i]] : ' ') +
        ' ' +
        [...tail.toArray(), ...rowMajor].map(num).join(' '),
    );
  }
  let vertexOffset = 0,
    uvOffset = 0,
    normalOffset = 0,
    meshCount = 0;
  if (includeMesh) {
    const meshes = [];
    scene.traverse((o) => {
      if (o.isMesh) meshes.push(o);
    });
    for (const mesh of meshes) {
      const g = mesh.geometry,
        pos = g.getAttribute('position');
      if (!pos) continue;
      if (vertexOffset + pos.count > 2000000) throw Error('BOBJ: quá nhiều đỉnh.');
      mesh.skeleton?.update();
      if (!g.getAttribute('normal')) g.computeVertexNormals();
      const normals = g.getAttribute('normal'),
        normalMatrix = new T.Matrix3().getNormalMatrix(mesh.matrixWorld);
      const uv = g.getAttribute('uv'),
        si = g.getAttribute('skinIndex'),
        sw = g.getAttribute('skinWeight');
      let rigid = mesh.parent;
      while (rigid && !index.has(rigid)) rigid = rigid.parent;
      lines.push('o ' + safe(mesh.name, 'Mesh' + meshCount++), 'o_arm ' + arm);
      for (let v = 0; v < pos.count; v++) {
        const point = mesh.getVertexPosition(v, new T.Vector3()).applyMatrix4(mesh.matrixWorld);
        lines.push('v ' + point.toArray().map(num).join(' '));
        const weights = new Map();
        if (mesh.isSkinnedMesh && si && sw) {
          for (let j = 0; j < 4; j++) {
            const w = sw.getComponent(v, j);
            if (w <= 0) continue;
            const bone = mesh.skeleton.bones[si.getComponent(v, j)],
              id = index.get(bone);
            if (id === undefined) throw Error('BOBJ: mesh tham chiếu xương ngoài rig.');
            weights.set(id, (weights.get(id) || 0) + w);
          }
        }
        if (!weights.size) weights.set(rigid ? index.get(rigid) : 0, 1);
        const total = [...weights.values()].reduce((a, b) => a + b, 0);
        for (const [id, w] of weights) lines.push('vw ' + names[id] + ' ' + num(w / total));
      }
      // glTF/MDX use top-left image UVs; BOBJ uses the Blender/OBJ convention.
      for (let v = 0; v < pos.count; v++)
        lines.push(
          'vt ' +
            num(uv ? uv.getX(v) : 0) +
            ' ' +
            num(uv ? (flipUV ? 1 - uv.getY(v) : uv.getY(v)) : 0),
        );
      for (let v = 0; v < pos.count; v++)
        lines.push(
          'vn ' +
            new T.Vector3()
              .fromBufferAttribute(normals, v)
              .applyNormalMatrix(normalMatrix)
              .toArray()
              .map(num)
              .join(' '),
        );
      const ids = g.index?.array || Array.from({ length: pos.count }, (_, i) => i);
      for (let k = 0; k + 2 < ids.length; k += 3)
        lines.push(
          'f ' +
            [ids[k], ids[k + 1], ids[k + 2]]
              .map(
                (v) =>
                  vertexOffset + v + 1 + '/' + (uvOffset + v + 1) + '/' + (normalOffset + v + 1),
              )
              .join(' '),
        );
      vertexOffset += pos.count;
      uvOffset += pos.count;
      normalOffset += pos.count;
    }
  }
  const actionName = lines[3].slice('arm_action '.length);
  lines.push('an ' + actionName);
  const channels = names.map(() => ({
      location: [[], [], []],
      rotation: [[], [], []],
      scale: [[], [], []],
    })),
    previous = names.map(() => [0, 0, 0]),
    times = [];
  const mixer = new T.AnimationMixer(scene),
    action = mixer.clipAction(clip);
  action.setLoop(T.LoopOnce, 1);
  action.clampWhenFinished = true;
  action.play();
  try {
    for (let f = 0; f < count; f++) {
      const t = Math.min(clip.duration, f / tickRate);
      times.push(f);
      mixer.setTime(t);
      scene.updateMatrixWorld(true);
      const worlds = normalize([new T.Matrix4(), ...objects.map(matrixOf)]);
      for (let i = 0; i < names.length; i++) {
        const local =
            parents[i] < 0 ? worlds[i] : worlds[parents[i]].clone().invert().multiply(worlds[i]),
          delta = restLocal[i].clone().invert().multiply(local),
          p = decompose(delta, names[i]),
          angles = continuousEuler(p.q, previous[i]);
        previous[i] = angles;
        for (const [key, values] of [
          ['location', p.p.toArray()],
          ['rotation', angles],
          ['scale', p.s.toArray()],
        ])
          values.forEach((v, j) => channels[i][key][j].push(v));
      }
    }
  } finally {
    mixer.stopAllAction();
    mixer.uncacheRoot(scene);
  }
  for (let i = 0; i < names.length; i++) {
    lines.push('ao ' + names[i]);
    for (const path of ['location', 'rotation', 'scale'])
      for (let axis = 0; axis < 3; axis++) {
        lines.push('ag ' + path + ' ' + axis);
        const values = channels[i][path][axis];
        for (let f = 0; f < times.length; f++) {
          const t = num(times[f]),
            v = num(values[f]);
          lines.push('kf ' + t + ' ' + v + ' LINEAR ' + t + ' ' + v + ' ' + t + ' ' + v);
        }
      }
  }
  return lines.join('\n') + '\n';
}
