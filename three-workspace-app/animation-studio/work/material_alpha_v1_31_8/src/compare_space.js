import * as T from 'three';

// Read deformed vertices directly: SkinnedMesh bounds can belong to an earlier pose.
export function bounds(rig) {
  rig.root.updateMatrixWorld(true);
  const box = new T.Box3(),
    point = new T.Vector3();
  for (const mesh of rig.mesh) {
    const positions = mesh.geometry.getAttribute('position');
    if (!positions) continue;
    for (let i = 0; i < positions.count; i++) {
      mesh.getVertexPosition(i, point);
      box.expandByPoint(point.applyMatrix4(mesh.matrixWorld));
    }
  }
  if (box.isEmpty())
    for (const rec of rig.records) box.expandByPoint(rec.o.getWorldPosition(point));
  if (box.isEmpty()) throw Error('Không có mesh hoặc xương để căn mặt đất.');
  return box;
}
export function place(rig, wrapper, dataUp, viewUp, basis) {
  wrapper.quaternion.identity();
  wrapper.scale.setScalar(1);
  wrapper.position.set(0, 0, 0);
  wrapper.updateMatrixWorld(true);
  const native = bounds(rig),
    height = native.getSize(new T.Vector3())[dataUp];
  wrapper.scale.setScalar(2 / (height > 1e-6 ? height : Math.max(1, rig.height)));
  if (dataUp !== viewUp) wrapper.quaternion.copy(viewUp === 'z' ? basis : basis.clone().invert());
  wrapper.updateMatrixWorld(true);
  const shown = bounds(rig),
    center = shown.getCenter(new T.Vector3());
  wrapper.position.copy(center).negate();
  wrapper.position[viewUp] = -shown.min[viewUp];
  wrapper.updateMatrixWorld(true);
  return { dataUp, viewUp, offset: wrapper.position.toArray(), scale: wrapper.scale.x };
}

export function alignClip(rig, wrapper, up, rest = false) {
  wrapper.position.set(0, 0, 0);
  wrapper.updateMatrixWorld(true);
  function under(rec, id) {
    while (rec) {
      if (rec.id === id) return true;
      rec = rig.records.find((x) => x.id === rec.parent);
    }
    return false;
  }
  const active = rig.records.filter((rec) => !rig.activeRoot || under(rec, rig.activeRoot)),
    name = (rec) =>
      rec.name
        .replace(/^mixamorig[:_]?/i, '')
        .toLowerCase()
        .replace(/[^a-z]/g, '');
  const feet = active.filter(
    (rec) =>
      /^(left|right)(foot|footend|toebase|toeend)$/.test(name(rec)) ||
      /^(foot|toe)(l|r)$/.test(name(rec)),
  );
  const points = feet.map((rec) => ({
    name: name(rec),
    point: rec.o.getWorldPosition(new T.Vector3()),
  }));
  const left = points.find((x) => /^leftfoot$|^footl$/.test(x.name)),
    right = points.find((x) => /^rightfoot$|^footr$/.test(x.name));
  const meshBox = bounds(rig),
    center =
      left && right
        ? left.point.clone().add(right.point).multiplyScalar(0.5)
        : points.length
          ? points
              .reduce((p, x) => p.add(x.point), new T.Vector3())
              .multiplyScalar(1 / points.length)
          : meshBox.getCenter(new T.Vector3());
  const floor = points.length ? Math.min(...points.map((x) => x.point[up])) : meshBox.min[up],
    source = points.length ? 'xương Foot/Toe' : 'đáy mesh (không nhận diện được Foot/Toe)';
  const motion =
    active.find((rec) => /^hips$|^root$/i.test(name(rec))) ||
    active.find((rec) => !rec.parent) ||
    active[0];
  const motionOrigin = motion?.o.getWorldPosition(new T.Vector3()).toArray();
  wrapper.position.copy(center).negate();
  wrapper.position[up] = -floor;
  wrapper.updateMatrixWorld(true);
  const warning =
    points.length && meshBox.min[up] < floor - 0.1
      ? 'Mesh thấp hơn xương bàn chân ' + (floor - meshBox.min[up]).toFixed(2) + ' đơn vị.'
      : '';
  return {
    source,
    origin: points.length ? 'trung điểm bàn chân' : 'tâm mesh',
    offset: wrapper.position.toArray(),
    viewUp: up,
    motionRoot: motion?.o,
    motionOrigin,
    warning,
  };
}
