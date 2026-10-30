import * as T from 'three';
export const defaults = {
  handDisplay: 'bones',
  handNodeShape: 'diamond',
  handNodeSize: '.006',
  rigInFront: true,
  rigDepthPart: 'all',
  meshPoints: false,
  meshLines: false,
  meshFaces: true,
  meshTexture: true,
  meshSmooth: true,
  meshFront: false,
  meshOverlay: false,
  viewportLayout: 'single',
  viewportSplitX: '0.5',
  viewportSplitY: '0.5',
  viewGridXZ: false,
  viewGridXY: true,
  viewGridYZ: false,
  viewWorldAxes: false,
  meshDoubleSided: true,
  combinedGizmo: false,
  space: 'world',
  transformMode: 'rotate',
  poleDistance: '0.3',
  controlDragSensitivity: '1',
};
export function isHand(rig, rec) {
  let r = rec;
  while (r) {
    if (/^(left|right)hand$|^hand[._][lr]$/i.test(r.name.replace(/^mixamorig[:_]?/i, '')))
      return true;
    r = rig.records.find((x) => x.id === r.parent);
  }
  return false;
}
export function markerGeometry(shape) {
  return shape === 'diamond'
    ? new T.RingGeometry(0.62, 1, 4)
    : shape === 'circle'
      ? new T.RingGeometry(0.62, 1, 32)
      : new T.SphereGeometry(1, 8, 6);
}
export function projection(v, orthographic) {
  if (v.orthographic === orthographic) return;
  const old = v.camera,
    distance = old.position.distanceTo(v.orbit.target),
    height = old.isOrthographicCamera
      ? (old.top - old.bottom) / old.zoom
      : (2 * distance * Math.tan(T.MathUtils.degToRad(old.fov / 2))) / old.zoom;
  v.camera = orthographic ? v.ortho : v.perspective;
  v.orthographic = orthographic;
  v.camera.position.copy(old.position);
  v.camera.quaternion.copy(old.quaternion);
  if (orthographic) v.camera.zoom = (v.ortho.top - v.ortho.bottom) / height;
  else {
    const next = height / (2 * Math.tan(T.MathUtils.degToRad(v.camera.fov / 2)));
    v.camera.zoom = 1;
    v.camera.position
      .copy(v.orbit.target)
      .add(old.position.clone().sub(v.orbit.target).normalize().multiplyScalar(next));
  }
  v.camera.updateProjectionMatrix();
  v.orbit.object = v.camera;
  for (const g of [v.gizmo, v.moveGizmo]) if (g) g.camera = v.camera;
  v.orbit.update();
  v.dirty = true;
}
const displays = new WeakMap();
export function sourceMaterial(mesh) {
  return displays.get(mesh)?.original || mesh.material;
}
export function clearMeshDisplay(v) {
  for (const d of v.meshDisplays || []) {
    d.mesh.material = d.original;
    d.mesh.renderOrder = d.renderOrder;
    for (const o of [d.points, d.lines]) {
      o.removeFromParent();
      o.geometry.dispose();
      o.material.dispose();
    }
    d.depth.removeFromParent();
    for (const m of [...d.materials, ...d.depthMaterials]) m.dispose();
    displays.delete(d.mesh);
  }
  v.meshDisplays = [];
}
function makeMeshDisplay(v, mesh) {
  const geometry = mesh.geometry,
    count = geometry.getAttribute('position').count,
    index = geometry.index,
    edges = new Set(),
    pairs = [];
  const add = (a, b) => {
    const key = Math.min(a, b) + ':' + Math.max(a, b);
    if (!edges.has(key)) {
      edges.add(key);
      pairs.push(a, b);
    }
  };
  for (let i = 0; i < (index ? index.count : count); i += 3) {
    const a = index ? index.getX(i) : i,
      b = index ? index.getX(i + 1) : i + 1,
      c = index ? index.getX(i + 2) : i + 2;
    add(a, b);
    add(b, c);
    add(c, a);
  }
  const pg = new T.BufferGeometry();
  pg.setAttribute('position', new T.Float32BufferAttribute(new Float32Array(count * 3), 3));
  const eg = new T.BufferGeometry();
  eg.setAttribute('position', new T.Float32BufferAttribute(new Float32Array(pairs.length * 3), 3));
  const points = new T.Points(
      pg,
      new T.PointsMaterial({ color: 0x79cfc5, size: 3, sizeAttenuation: false, depthWrite: false }),
    ),
    lines = new T.LineSegments(eg, new T.LineBasicMaterial({ color: 0x79cfc5, depthWrite: false }));
  for (const o of [points, lines]) {
    o.matrixAutoUpdate = false;
    o.frustumCulled = false;
    o.name = 'Viewport mesh display only';
    v.scene.add(o);
  }
  const original = mesh.material,
    materials = (Array.isArray(original) ? original : [original]).map((m) => m.clone()),
    maps = materials.map((m) => m.map);
  const sides = materials.map((m) => m.side),
    transparent = materials.map((m) => m.transparent),
    depthWrites = materials.map((m) => m.depthWrite),
    depthMaterials = materials.map((m) => {
      const n = m.clone();
      n.colorWrite = false;
      n.depthWrite = true;
      n.transparent = false;
      n.side = T.DoubleSide;
      n.polygonOffset = true;
      n.polygonOffsetFactor = 1;
      n.polygonOffsetUnits = 1;
      return n;
    });
  const depth = mesh.clone(false);
  depth.material = Array.isArray(original) ? depthMaterials : depthMaterials[0];
  depth.matrixAutoUpdate = false;
  depth.frustumCulled = false;
  depth.renderOrder = -2;
  depth.name = 'Viewport depth occluder';
  v.scene.add(depth);
  const d = {
    mesh,
    renderOrder: mesh.renderOrder,
    original,
    materials,
    maps,
    sides,
    transparent,
    depthWrites,
    depth,
    depthMaterials,
    points,
    lines,
    pairs,
  };
  displays.set(mesh, d);
  return d;
}
export function meshDisplay(v, settings, visible, camera = v.camera) {
  if (!v.meshDisplays) v.meshDisplays = [];
  for (const mesh of v.rig.mesh) {
    let d = displays.get(mesh);
    if (
      !d &&
      !settings.meshPoints &&
      !settings.meshLines &&
      settings.meshTexture &&
      settings.meshSmooth &&
      settings.meshDoubleSided !== false
    ) {
      mesh.visible = visible && settings.meshFaces;
      continue;
    }
    if (!d) {
      d = makeMeshDisplay(v, mesh);
      v.meshDisplays.push(d);
    }
    mesh.material = Array.isArray(d.original) ? d.materials : d.materials[0];
    const occluder = settings.meshFront && (settings.meshPoints || settings.meshLines);
    mesh.visible = visible && settings.meshFaces;
    mesh.renderOrder = d.renderOrder;
    d.depth.visible = visible && occluder;
    d.depth.matrix.copy(mesh.matrixWorld);
    d.materials.forEach((m, i) => {
      const map = settings.meshTexture ? d.maps[i] : null,
        flat = !settings.meshSmooth,
        side = settings.meshDoubleSided !== false ? T.DoubleSide : T.FrontSide,
        depthOnly = false;
      m.colorWrite = true;
      m.depthWrite = d.depthWrites[i];
      if (m.side !== side || m.transparent !== d.transparent[i]) {
        m.side = side;
        m.transparent = d.transparent[i];
        m.needsUpdate = true;
      }
      if (m.map !== map || m.flatShading !== flat) {
        m.map = map;
        m.flatShading = flat;
        m.needsUpdate = true;
      }
    });
    d.points.visible = visible && settings.meshPoints;
    d.lines.visible = visible && settings.meshLines;
    for (const o of [d.points, d.lines]) {
      o.material.depthTest = !!settings.meshFront;
      o.renderOrder = 1;
      o.matrix.copy(mesh.matrixWorld);
    }
    if (d.points.visible || d.lines.visible) {
      mesh.skeleton?.update();
      const pos = d.points.geometry.getAttribute('position'),
        epos = d.lines.geometry.getAttribute('position'),
        point = new T.Vector3();
      if (d.revision !== v.rig.visualRevision || !d.cameraIndices) {
        for (let i = 0; i < pos.count; i++) {
          mesh.getVertexPosition(i, point);
          pos.setXYZ(i, point.x, point.y, point.z);
        }
        for (let i = 0; i < d.pairs.length; i++) {
          const j = d.pairs[i];
          epos.setXYZ(i, pos.getX(j), pos.getY(j), pos.getZ(j));
        }
        pos.needsUpdate = true;
        epos.needsUpdate = true;
        d.revision = v.rig.visualRevision;
        d.cameraIndices = new Map();
      }
      if (settings.meshFront) {
        const signature =
          camera.uuid +
          ':' +
          camera.matrixWorld.elements.join(',') +
          ':' +
          camera.projectionMatrix.elements.join(',');
        let cached = d.cameraIndices.get(signature);
        if (!cached) {
          const vertices = new Set(),
            edges = new Set(),
            index = mesh.geometry.index,
            count = index ? index.count : pos.count,
            A = new T.Vector3(),
            B = new T.Vector3(),
            C = new T.Vector3(),
            normal = new T.Vector3(),
            center = new T.Vector3(),
            localCamera = mesh.worldToLocal(camera.position.clone()),
            toward = camera
              .getWorldDirection(new T.Vector3())
              .negate()
              .transformDirection(mesh.matrixWorld.clone().invert());
          for (let i = 0; i < count; i += 3) {
            const a = index ? index.getX(i) : i,
              b = index ? index.getX(i + 1) : i + 1,
              c = index ? index.getX(i + 2) : i + 2;
            A.fromBufferAttribute(pos, a);
            B.fromBufferAttribute(pos, b);
            C.fromBufferAttribute(pos, c);
            normal.subVectors(B, A).cross(C.clone().sub(A));
            center
              .copy(A)
              .add(B)
              .add(C)
              .multiplyScalar(1 / 3);
            if (
              normal.dot(camera.isOrthographicCamera ? toward : localCamera.clone().sub(center)) <=
              0
            )
              continue;
            for (const j of [a, b, c]) vertices.add(j);
            for (const [x, y] of [
              [a, b],
              [b, c],
              [c, a],
            ])
              edges.add(Math.min(x, y) + ':' + Math.max(x, y));
          }
          const lineIndices = [];
          for (let i = 0; i < d.pairs.length; i += 2) {
            const x = d.pairs[i],
              y = d.pairs[i + 1];
            if (edges.has(Math.min(x, y) + ':' + Math.max(x, y))) lineIndices.push(i, i + 1);
          }
          cached = {
            points: new T.Uint32BufferAttribute([...vertices], 1),
            lines: new T.Uint32BufferAttribute(lineIndices, 1),
          };
          if (d.cameraIndices.size >= 4)
            d.cameraIndices.delete(d.cameraIndices.keys().next().value);
          d.cameraIndices.set(signature, cached);
        }
        d.points.geometry.setIndex(cached.points);
        d.lines.geometry.setIndex(cached.lines);
      } else {
        d.points.geometry.setIndex(null);
        d.lines.geometry.setIndex(null);
      }
    }
  }
}

export function blenderSettings(settings) {
  if (settings.coordinateSystem === 'blender-z-up') return settings;
  const result = { ...settings, coordinateSystem: 'blender-z-up' };
  if (typeof settings.viewGridXZ === 'boolean') result.viewGridXY = settings.viewGridXZ;
  if (typeof settings.viewGridXY === 'boolean') result.viewGridXZ = settings.viewGridXY;
  return result;
}
