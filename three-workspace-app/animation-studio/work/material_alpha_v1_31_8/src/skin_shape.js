import * as T from 'three';
const bases = new WeakMap();
export function validate(adjustments, rig) {
  if (adjustments === undefined) return {};
  if (!adjustments || typeof adjustments !== 'object' || Array.isArray(adjustments))
    throw Error('Hình dáng skin không hợp lệ.');
  const ids = new Set(rig.records.map((r) => r.id));
  for (const [id, s] of Object.entries(adjustments))
    if (
      !ids.has(id) ||
      !Array.isArray(s) ||
      s.length !== 3 ||
      s.some((v) => !Number.isFinite(v) || v < 0.05 || v > 5)
    )
      throw Error('Tỉ lệ skin phải từ 0.05 đến 5: ' + id);
  return structuredClone(adjustments);
}
// Use bind-space weights, so changing a pose never changes the region being edited.
export function apply(rig, adjustments = {}) {
  const selected = new Map(
    Object.entries(adjustments).map(([id, s]) => [rig.records.find((r) => r.id === id)?.o, s]),
  );
  for (const mesh of rig.mesh) {
    if (!mesh.isSkinnedMesh) continue;
    let base = bases.get(mesh);
    if (!base && !selected.size) continue;
    if (!base) {
      mesh.geometry = mesh.geometry.clone();
      const g = mesh.geometry;
      base = {
        position: g.attributes.position.clone(),
        normal: g.attributes.normal?.clone(),
        morphs: (g.morphAttributes.position || []).map((a) => a.clone()),
      };
      bases.set(mesh, base);
    }
    const g = mesh.geometry,
      pos = g.attributes.position,
      indices = g.attributes.skinIndex,
      weights = g.attributes.skinWeight;
    if (!indices || !weights) continue;
    const transforms = mesh.skeleton.bones.map((bone, i) => {
      const s = selected.get(bone);
      if (!s) return null;
      const toBone = mesh.skeleton.boneInverses[i].clone().multiply(mesh.bindMatrix);
      return { s: new T.Vector3(...s), toBone, fromBone: toBone.clone().invert() };
    });
    const original = new T.Vector3(),
      deformed = new T.Vector3(),
      point = new T.Vector3(),
      delta = new T.Vector3();
    for (let i = 0; i < pos.count; i++) {
      original.fromBufferAttribute(base.position, i);
      deformed.copy(original);
      for (let j = 0; j < 4; j++) {
        const w = weights.getComponent(i, j),
          t = transforms[indices.getComponent(i, j)];
        if (!t || !w) continue;
        point.copy(original).applyMatrix4(t.toBone).multiply(t.s).applyMatrix4(t.fromBone);
        deformed.addScaledVector(point.sub(original), w);
      }
      pos.setXYZ(i, deformed.x, deformed.y, deformed.z);
      delta.copy(deformed).sub(original);
      if (!g.morphTargetsRelative)
        for (let j = 0; j < base.morphs.length; j++) {
          point.fromBufferAttribute(base.morphs[j], i).add(delta);
          g.morphAttributes.position[j].setXYZ(i, point.x, point.y, point.z);
        }
    }
    pos.needsUpdate = true;
    for (const a of g.morphAttributes.position || []) a.needsUpdate = true;
    if (!selected.size && base.normal) {
      g.setAttribute('normal', base.normal.clone());
    } else g.computeVertexNormals();
    g.computeBoundingBox();
    g.computeBoundingSphere();
  }
}
