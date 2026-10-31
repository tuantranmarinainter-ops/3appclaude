import * as T from 'three';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import * as C from './core.js';
export const defaults = {
  onionEnabled: false,
  onionSampling: 'interval',
  onionBefore: '2',
  onionAfter: '2',
  onionStep: '5',
  onionUnit: 'frames',
  onionParts: 'mesh',
  onionMeshOpacity: '75',
  onionBoneOpacity: '40',
  onionFade: true,
  onionBeforeColor: '#78aaff',
  onionAfterColor: '#ffb266',
  onionPlayback: false,
  onionSpread: '0',
  onionSpreadAxis: 'screen',
  onionSpreadGuides: true,
};
export function validate(settings = {}) {
  const result = { ...defaults };
  for (const [id, fallback] of Object.entries(defaults)) {
    const x = settings?.[id];
    if (typeof fallback === 'boolean') {
      if (typeof x === 'boolean') result[id] = x;
    } else if (id.endsWith('Color')) {
      if (typeof x === 'string' && /^#[0-9a-f]{6}$/i.test(x)) result[id] = x;
    } else if (['onionSampling', 'onionUnit', 'onionParts', 'onionSpreadAxis'].includes(id)) {
      if (
        {
          onionSampling: ['interval', 'keys'],
          onionUnit: ['frames', 'ticks'],
          onionParts: ['mesh', 'bones', 'both'],
          onionSpreadAxis: ['screen', 'x', 'z', 'motion'],
        }[id].includes(x)
      )
        result[id] = x;
    } else if (
      (typeof x === 'number' || (typeof x === 'string' && x.trim() !== '')) &&
      Number.isFinite(+x)
    ) {
      const max = id === 'onionStep' ? 120 : id === 'onionSpread' ? 200 : 100,
        min = id === 'onionStep' ? 1 : 0;
      result[id] = String(Math.max(min, Math.min(max, Math.round(+x))));
    }
  }
  return result;
}
export function keyTimes(rig, project) {
  const ids = new Set(['root', ...C.activeRecords(rig).map((r) => r.id)]),
    chains = rig.chains.filter((c) => !rig.activeRoot || c.root === rig.activeRoot);
  for (const c of chains) for (const id of ['ik_' + c.id, 'pole_' + c.id]) ids.add(id);
  const sourceTimes = project.lab?.clips.flatMap((c) => [c.start, c.start + c.length]) || [];
  const times = [
    ...sourceTimes,
    ...Array.from(ids).flatMap((id) => (project.keys[id] || []).map((k) => k.time)),
    ...chains.flatMap((c) =>
      [...(project.ikModes[c.id] || []), ...(project.ikOptions?.[c.id] || [])].map((k) => k.time),
    ),
  ]
    .filter((t) => Number.isFinite(t) && t >= 0 && t <= project.duration)
    .sort((a, b) => a - b);
  return times.filter((t, i) => !i || t - times[i - 1] > 1e-7);
}
export function sampleTimes(project, time, s, times) {
  if (!times.length) return [];
  const before = +s.onionBefore,
    after = +s.onionAfter;
  if (s.onionSampling === 'keys')
    return [
      ...times
        .filter((t) => t < time - 1e-7)
        .reverse()
        .slice(0, before)
        .map((t, i) => ({ time: t, side: 'before', rank: i + 1 })),
      ...times
        .filter((t) => t > time + 1e-7)
        .slice(0, after)
        .map((t, i) => ({ time: t, side: 'after', rank: i + 1 })),
    ];
  const step = +s.onionStep / (s.onionUnit === 'ticks' ? 20 : project.fps),
    result = [];
  for (const [side, sign, count] of [
    ['before', -1, before],
    ['after', 1, after],
  ])
    for (let i = 1; i <= count; i++) {
      const t = time + sign * i * step;
      if (t >= -1e-7 && t <= project.duration + 1e-7)
        result.push({ time: T.MathUtils.clamp(t, 0, project.duration), side, rank: i });
    }
  return result;
}
// Directions and displacements are world-space; up follows the view's ground plane.
export function spreadOffset(axis, screenRight, motion, up, height, spread, side, rank) {
  const normal = up.clone().normalize();
  const screen = screenRight.clone().projectOnPlane(normal);
  if (screen.lengthSq() < 1e-12) screen.set(1, 0, 0).projectOnPlane(normal);
  screen.normalize();
  const travel = motion.clone().projectOnPlane(normal);
  let dir = screen;
  if (axis === 'x') dir = new T.Vector3(1, 0, 0);
  else if (axis === 'z') dir = new T.Vector3(0, 0, 1);
  else if (axis === 'motion' && travel.length() >= height * 0.01) dir = travel.normalize();
  return dir.clone().multiplyScalar((side === 'before' ? -1 : 1) * rank * height * spread / 100);
}
export class OnionSkin {
  constructor(view) {
    this.view = view;
    this.group = new T.Group();
    this.group.name = 'Onion Skin preview';
    view.scene.add(this.group);
    this.slots = [];
    this.source = null;
    this.signature = '';
    this.evaluations = 0;
    this.lastUpdate = -Infinity;
    this.samples = [];
    this.elapsed = 0;
    this.revision = -1;
  }
  hide() {
    const changed = this.group.visible;
    this.group.visible = false;
    return changed;
  }
  release(s) {
    s.meshMaterial.dispose();
    s.lineMaterial.dispose();
    s.line.geometry.dispose();
    s.guide.geometry.dispose();
    s.guide.material.dispose();
    s.guide.removeFromParent();
    const skeletons = new Set(s.rig.mesh.filter((m) => m.isSkinnedMesh).map((m) => m.skeleton));
    skeletons.forEach((x) => x.dispose());
    s.wrapper.removeFromParent();
    s.line.removeFromParent();
  }
  clear() {
    const changed = this.slots.length > 0;
    for (const s of this.slots) this.release(s);
    this.group.clear();
    this.slots = [];
    this.source = null;
    this.signature = '';
    this.samples = [];
    return changed;
  }
  create(source) {
    // SkeletonUtils separates bone state; geometry and source textures stay read-only.
    const root = cloneSkeleton(source.root),
      bones = [],
      mesh = [];
    root.traverse((o) => {
      if (o.isBone) bones.push(o);
      if (o.isMesh) mesh.push(o);
      if (o.isLine || o.isPoints) o.visible = false;
    });
    const records = source.records.map((r, i) => ({ ...r, o: bones[i] })),
      r = { ...source, root, records, mesh, controls: {}, chains: [] },
      wrapper = new T.Group();
    wrapper.add(root);
    this.group.add(wrapper);
    for (const [id, c] of Object.entries(source.controls)) {
      const object = new T.Object3D();
      C.apply(object, c.rest);
      wrapper.add(object);
      r.controls[id] = { object, rest: c.rest };
    }
    r.chains = C.chainSpecs(r);
    for (const c of r.chains) {
      C.kinematics.init(r, c, wrapper);
      const original = source.chains.find((x) => x.id === c.id);
      c.baseB.copy(original.baseB);
      c.baseE.copy(original.baseE);
      c.pivotOffset.copy(original.pivotOffset);
    }
    const meshMaterial = new T.MeshBasicMaterial({
        transparent: true,
        depthWrite: false,
        depthTest: true,
      }),
      lineMaterial = new T.LineBasicMaterial({
        transparent: true,
        depthWrite: false,
        depthTest: true,
      });
    for (const m of mesh) {
      m.material = Array.isArray(m.material) ? m.material.map(() => meshMaterial) : meshMaterial;
      m.castShadow = false;
      m.receiveShadow = false;
      m.renderOrder = 1;
    }
    const geometry = new T.BufferGeometry();
    geometry.setAttribute(
      'position',
      new T.Float32BufferAttribute(new Float32Array(records.filter((r) => r.parent).length * 6), 3),
    );
    const line = new T.LineSegments(geometry, lineMaterial);
    line.frustumCulled = false;
    line.renderOrder = 2;
    this.group.add(line);
    const guide = new T.Line(new T.BufferGeometry().setFromPoints([new T.Vector3(), new T.Vector3()]),
      new T.LineBasicMaterial({ transparent: true, opacity: 0.55, depthWrite: false }));
    guide.frustumCulled = false;
    this.group.add(guide);
    const slot = { rig: r, wrapper, line, guide, meshMaterial, lineMaterial };
    this.slots.push(slot);
    return slot;
  }
  update(source, project, time, s, revision, playing, stamp) {
    if (!s.onionEnabled) {
      const changed = this.clear();
      return this.hide() || changed;
    }
    if (playing && !s.onionPlayback) return this.hide();
    if (this.source !== source) {
      this.clear();
      this.source = source;
      this.revision = -1;
      this.lastUpdate = -Infinity;
    }
    const up = this.view.camera.up.clone().normalize();
    const screenRight = new T.Vector3(1, 0, 0).applyQuaternion(this.view.camera.getWorldQuaternion(new T.Quaternion())).projectOnPlane(up).normalize();
    const directionKey = +s.onionSpread && ['screen', 'motion'].includes(s.onionSpreadAxis)
      ? screenRight.toArray().map(n => Math.round(n * 100) / 100) : null;
    const key = JSON.stringify([time, revision, source.activeRoot, s, directionKey]);
    if (key === this.signature) {
      const changed = !this.group.visible;
      this.group.visible = true;
      return changed;
    }
    if (stamp - this.lastUpdate < 1000 / 15) return false;
    const start = performance.now();
    this.lastUpdate = stamp;
    if (this.revision !== revision || this.activeRoot !== source.activeRoot) {
      this.times = keyTimes(source, project);
      this.revision = revision;
      this.activeRoot = source.activeRoot;
    }
    const samples = sampleTimes(project, time, s, this.times);
    this.samples = samples;
    this.signature = key;
    this.group.visible = true;
    const active = new Set(C.activeRecords(source).map((r) => r.id)),
      hasMesh = source.mesh.some(
        (m) =>
          !source.activeRoot ||
          (m.isSkinnedMesh &&
            m.skeleton.bones.some((b) =>
              source.records.some((r) => r.o === b && active.has(r.id)),
            )),
      );
    this.hasMesh = hasMesh;
    const height = source.height * this.view.wrapper.getWorldScale(new T.Vector3()).y;
    let motion = new T.Vector3();
    if (+s.onionSpread && s.onionSpreadAxis === 'motion' && samples.length) {
      const far = samples.reduce((a, b) => Math.abs(b.time - time) > Math.abs(a.time - time) ? b : a);
      const slot = this.slots[0] || this.create(source);
      slot.wrapper.position.copy(this.view.wrapper.position);
      slot.wrapper.quaternion.copy(this.view.wrapper.quaternion);
      slot.wrapper.scale.copy(this.view.wrapper.scale);
      slot.rig.activeRoot = source.activeRoot;
      slot.wrapper.updateMatrixWorld(true);
      C.evaluate(slot.rig, project, far.time);
      slot.wrapper.updateMatrixWorld(true);
      const current = source.root.getWorldPosition(new T.Vector3());
      motion = slot.rig.root.getWorldPosition(new T.Vector3()).sub(current);
    }
    for (let i = 0; i < samples.length; i++) {
      const sample = samples[i],
        slot = this.slots[i] || this.create(source),
        r = slot.rig;
      slot.wrapper.position.copy(this.view.wrapper.position);
      slot.wrapper.quaternion.copy(this.view.wrapper.quaternion);
      slot.wrapper.scale.copy(this.view.wrapper.scale);
      const displacement = spreadOffset(s.onionSpreadAxis, screenRight, motion, up, height, +s.onionSpread, sample.side, sample.rank);
      // The preview group shares the scene's world coordinates with the real wrapper.
      slot.wrapper.position.add(displacement);
      r.activeRoot = source.activeRoot;
      slot.wrapper.updateMatrixWorld(true);
      C.evaluate(r, project, sample.time);
      slot.wrapper.updateMatrixWorld(true);
      const origin = r.records.reduce((lowest, rec) => {
        const point = rec.o.getWorldPosition(new T.Vector3());
        return !lowest || point.dot(up) < lowest.dot(up) ? point : lowest;
      }, null) || r.root.getWorldPosition(new T.Vector3());
      const guidePositions = slot.guide.geometry.getAttribute('position');
      guidePositions.setXYZ(0, origin.x, origin.y, origin.z);
      guidePositions.setXYZ(1, origin.x - displacement.x, origin.y - displacement.y, origin.z - displacement.z);
      guidePositions.needsUpdate = true;
      slot.guide.visible = !!+s.onionSpread && s.onionSpreadGuides;
      const color = sample.side === 'before' ? s.onionBeforeColor : s.onionAfterColor,
        fade = s.onionFade ? 1 / sample.rank : 1;
      slot.guide.material.color.set(color);
      slot.meshMaterial.color.set(color);
      slot.meshMaterial.opacity = (1 - +s.onionMeshOpacity / 100) * fade;
      slot.lineMaterial.color.set(color);
      slot.lineMaterial.opacity = (1 - +s.onionBoneOpacity / 100) * fade;
      slot.wrapper.visible = s.onionParts !== 'bones' && hasMesh && slot.meshMaterial.opacity > 0;
      for (const m of r.mesh)
        m.visible =
          !source.activeRoot ||
          (m.isSkinnedMesh &&
            m.skeleton.bones.some((b) =>
              r.records.some((rec) => rec.o === b && active.has(rec.id)),
            ));
      slot.line.visible = (s.onionParts !== 'mesh' || !hasMesh) && slot.lineMaterial.opacity > 0;
      const positions = slot.line.geometry.getAttribute('position');
      let offset = 0;
      for (const rec of r.records)
        if (rec.parent) {
          const parent = r.records.find((x) => x.id === rec.parent),
            a = parent.o.getWorldPosition(new T.Vector3()),
            b = rec.o.getWorldPosition(new T.Vector3());
          if (!active.has(rec.id)) a.copy(b);
          positions.setXYZ(offset++, a.x, a.y, a.z);
          positions.setXYZ(offset++, b.x, b.y, b.z);
        }
      positions.needsUpdate = true;
      slot.line.geometry.computeBoundingSphere();
      this.evaluations++;
    }
    for (const slot of this.slots.splice(samples.length)) this.release(slot);
    this.elapsed = performance.now() - start;
    return true;
  }
}
