import * as T from 'three';
import * as BOBJ from './bobj_loader.js';
import { motionOrigins, applyInPlace } from './core.js';

// This mixer owns only a temporary view of the imported model, never project keys.
export class ClipPreview {
  constructor(rig) {
    this.rig = rig;
    this.root = rig.root;
    this.mixer = new T.AnimationMixer(this.root);
    this.index = -1;
    this.time = 0;
    this.duration = 0;
    this.disposed = false;
    this.inPlace = false;
    this.origins = null;
    this.transforms = [];
    this.root.traverse((o) =>
      this.transforms.push({
        o,
        p: o.position.clone(),
        q: o.quaternion.clone(),
        s: o.scale.clone(),
        morph: o.morphTargetInfluences?.slice(),
      }),
    );
  }
  restore() {
    for (const x of this.transforms) {
      x.o.position.copy(x.p);
      x.o.quaternion.copy(x.q);
      x.o.scale.copy(x.s);
      if (x.morph) x.o.morphTargetInfluences.splice(0, x.morph.length, ...x.morph);
    }
    this.root.updateMatrixWorld(true);
  }
  rest() {
    for (const [o, v] of [
      [this.root, this.rig.rootRest],
      ...this.rig.records.map((r) => [r.o, r.rest]),
    ])
      if (v) {
        o.position.fromArray(v.p);
        o.quaternion.fromArray(v.q);
        o.scale.fromArray(v.s || [1, 1, 1]);
      }
    this.root.updateMatrixWorld(true);
  }
  select(index) {
    if (this.disposed) throw Error('Bộ xem clip đã đóng.');
    const clip = this.rig.clips[index];
    if (!Number.isInteger(index) || !clip || !Number.isFinite(clip.duration) || clip.duration < 0)
      throw Error('Animation nguồn không hợp lệ.');
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.root);
    this.restore();
    this.rest();
    this.index = index;
    this.duration = clip.duration;
    this.origins = null;
    this.action = this.rig.isBOBJ ? null : this.mixer.clipAction(clip);
    if (this.action) {
      this.action.setLoop(T.LoopOnce, 1);
      this.action.clampWhenFinished = true;
      this.action.play();
    }
    this.seek(0);
    this.origins = motionOrigins(this.rig);
    return this.duration > 0;
  }
  seek(value) {
    if (this.disposed || this.index < 0) throw Error('Chưa chọn animation nguồn.');
    if (!Number.isFinite(value)) throw Error('Thời gian không hợp lệ.');
    // Rebind after restoring rest: a repeated seek must not reuse the mixer's last output cache.
    this.time = T.MathUtils.clamp(value, 0, this.duration);
    this.mixer.stopAllAction();
    this.rest();
    if (this.rig.isBOBJ) {
      BOBJ.sample(this.rig, this.index, this.time, this.rig.bobjEulerOrder || 'ZYX');
    } else {
      this.action.reset().play();
      this.mixer.setTime(this.time);
    }
    this.root.updateMatrixWorld(true);
    if (this.inPlace && this.origins) applyInPlace(this.rig, this.origins);
  }
  advance(delta, loop) {
    if (!Number.isFinite(delta) || delta < 0) throw Error('Khoảng thời gian không hợp lệ.');
    if (!this.duration) return false;
    const next = this.time + delta;
    if (next >= this.duration) {
      this.seek(loop ? next % this.duration : this.duration);
      return !!loop;
    }
    this.seek(next);
    return true;
  }
  dispose() {
    if (this.disposed) return;
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.root);
    this.restore();
    this.action = null;
    this.disposed = true;
  }
}
