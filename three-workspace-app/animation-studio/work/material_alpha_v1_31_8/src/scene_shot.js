// "1 khung · Cả cảnh" (scene mode): shot placement, camera keys and the per-character registry.
// No DOM and no editor state here, so it is unit-testable in Node. Glue lives in shot_controller.js.
//
// Coordinates. App 2 (shot.json) is glTF Y-up metres, yaw about +Y. The editor is Blender Z-up and shows
// every model through a wrapper with the "blender basis" (rotation X +90 deg: (x,y,z)_Yup -> (x,-z,y)_Zup).
// A character placed at position p / yaw θ / scale s therefore gets the wrapper matrix
//   W = B · T(p) · R_y(θ) · S(s)   (position = B·p, quaternion = B·R_y(θ) = R_z(θ)·B)
// so Wᵢ · (model-space point) is exactly where App 2 puts it, only re-expressed in Z-up.
import * as T from 'three';
import * as ShotPackage from './shot_package.js';

export const BASIS = new T.Quaternion().setFromAxisAngle(new T.Vector3(1, 0, 0), Math.PI / 2);
const BASIS_MATRIX = new T.Matrix4().makeRotationFromQuaternion(BASIS);
const BASIS_INVERSE = BASIS_MATRIX.clone().invert();

/** Y-up point/vector -> Z-up (rotation X +90 deg). */
export const pointToZUp = (p) => new T.Vector3(p[0], -p[2], p[1]);
/** Z-up point/vector -> Y-up (inverse of pointToZUp). */
export const pointToYUp = (p) => new T.Vector3(p.x, p.z, -p.y);

/** Matrix B·T(p)·R_y(yaw)·S(scale): the wrapper transform of a placed character (editor Z-up world). */
export function placementMatrix(placement, scale = 1) {
  const m = new T.Matrix4().compose(
    new T.Vector3(...placement.position),
    new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), T.MathUtils.degToRad(placement.yawDegrees)),
    new T.Vector3(scale, scale, scale),
  );
  return BASIS_MATRIX.clone().multiply(m);
}
/** Writes placementMatrix into an Object3D's position/quaternion/scale. */
export function applyPlacement(object, placement, scale = 1) {
  placementMatrix(placement, scale).decompose(object.position, object.quaternion, object.scale);
  object.updateMatrixWorld(true);
}
export function matrixClose(a, b, epsilon = 1e-9) {
  return a.elements.every((v, i) => Math.abs(v - b.elements[i]) <= epsilon);
}
/** Editor Z-up world matrix -> App 2 Y-up world matrix (column-major 16 numbers, like Matrix4.elements). */
export function matrixToYUp(matrix) {
  return BASIS_INVERSE.clone().multiply(matrix).toArray();
}

/** Linear interpolation of shot.camera.keys at a (fractional) shot frame, in App 2 Y-up. Clamped outside the keys. */
export function sampleCameraKeys(keys, frame) {
  if (!Array.isArray(keys) || !keys.length) return null;
  const last = keys.length - 1;
  const out = (a, b, w) => ({
    position: a.position.map((v, i) => v + (b.position[i] - v) * w),
    lookAt: a.lookAt.map((v, i) => v + (b.lookAt[i] - v) * w),
    fovYDegrees: a.fovYDegrees + (b.fovYDegrees - a.fovYDegrees) * w,
  });
  if (frame <= keys[0].frame) return out(keys[0], keys[0], 0);
  if (frame >= keys[last].frame) return out(keys[last], keys[last], 0);
  let lo = 0,
    hi = last;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (keys[mid].frame <= frame) lo = mid;
    else hi = mid;
  }
  const a = keys[lo],
    b = keys[hi];
  return out(a, b, (frame - a.frame) / (b.frame - a.frame));
}
/** Shot camera sample -> editor Z-up (position, lookAt, fov). */
export function cameraToZUp(sample) {
  return {
    position: pointToZUp(sample.position),
    lookAt: pointToZUp(sample.lookAt),
    fovYDegrees: sample.fovYDegrees,
  };
}
export const filmAspect = (shot) =>
  typeof shot?.camera?.aspect === 'number' && Number.isFinite(shot.camera.aspect) && shot.camera.aspect > 0
    ? shot.camera.aspect
    : 16 / 9;
/** Inner rectangle (pixels) of the film frame inside a viewport; the rest is letterbox/pillarbox. */
export function filmRect(aspect, width, height) {
  const viewAspect = width / height;
  if (aspect >= viewAspect) {
    const h = width / aspect;
    return { x: 0, y: (height - h) / 2, w: width, h };
  }
  const w = height * aspect;
  return { x: (width - w) / 2, y: 0, w, h: height };
}
/**
 * Vertical FOV the full viewport needs so that the film rectangle sees exactly `fovY` vertically.
 * Pillarbox (film narrower): unchanged. Letterbox (film wider): the viewport shows more above/below the bars.
 */
export function viewportFov(fovY, aspect, width, height) {
  const viewAspect = width / height;
  if (aspect <= viewAspect) return fovY;
  const t = Math.tan(T.MathUtils.degToRad(fovY) / 2) * (aspect / viewAspect);
  return T.MathUtils.radToDeg(2 * Math.atan(t));
}

/**
 * Same node/animation preparation as app.js parseAsset for GLB, so a viewer actor has the same bone names and
 * animation bindings as the editing rig: rebind clip tracks by node UUID, then restore original names.
 */
export function prepareViewerRoot(root, animations) {
  root.animations = animations;
  root.traverse((o) => {
    if (o.userData.axisSystem === 'blender' && o.name === 'AnimationStudioUnits') {
      o.quaternion.premultiply(BASIS.clone().invert());
      o.userData.axisSystem = 'minecraft';
    }
  });
  for (const clip of animations)
    for (const track of clip.tracks) {
      const binding = T.PropertyBinding.parseTrackName(track.name),
        node = T.PropertyBinding.findNode(root, binding.nodeName);
      if (node && !binding.objectName)
        track.name =
          node.uuid +
          '.' +
          binding.propertyName +
          (binding.propertyIndex !== undefined ? '[' + binding.propertyIndex + ']' : '');
    }
  root.traverse((o) => {
    const original = o.userData.originalName || o.userData.name;
    if (typeof original === 'string' && original) o.name = original;
  });
  return root;
}

/**
 * Direct clip sampler for the editor bake (no AnimationMixer). Tracks must already be bound by node UUID
 * (parseAsset / prepareViewerRoot). Why not the mixer: three's PropertyMixer only writes a node when the sampled value
 * differs from the previous frame's sample; the bake resets the rig to rest between frames, so every channel that is
 * constant over a stretch (held root height, static Jaw, a clip boundary) silently fell back to the rest pose.
 * Position/quaternion/scale only (the editor records nothing else); time clamps to the clip like LoopOnce.
 */
export function createClipSampler(clip, root) {
  const nodes = new Map();
  root.traverse((o) => nodes.set(o.uuid, o));
  const channels = [];
  for (const track of clip.tracks) {
    const dot = track.name.lastIndexOf('.'),
      node = nodes.get(track.name.slice(0, dot)),
      path = track.name.slice(dot + 1);
    if (!node || !['position', 'quaternion', 'scale'].includes(path)) continue;
    channels.push({ node, path, interpolant: track.createInterpolant() });
  }
  return {
    channels: channels.length,
    /** True when the clip animates `node` (position/quaternion/scale). */
    animates: (node) => channels.some((c) => c.node === node),
    /** Writes the pose at `seconds` onto the nodes; call after resetting them to rest. */
    sample(seconds) {
      const t = Math.min(Math.max(seconds, 0), clip.duration);
      for (const c of channels) c.node[c.path].fromArray(c.interpolant.evaluate(t));
    },
  };
}

/** Bone name -> App 2 Y-up world matrix for every Bone under `root` (matrices must be current). */
export function sampleBones(root) {
  const bones = {};
  root.traverse((o) => {
    if (o.isBone) bones[o.name] = matrixToYUp(o.matrixWorld);
  });
  return bones;
}

/**
 * Per-character registry. An entry is
 *   { characterId, character (shot.characters[i]), bytes, placement, scale, duration, editing, rig,
 *     group, root, viewer }
 * where viewer = { group, root, mixer, action } (a parsed GLB scene driven by an AnimationMixer, no rig).
 * A viewer entry has group/root = viewer.group/viewer.root. The editing entry has group = the editor wrapper and
 * root = rig.root (the editor evaluates its keys); its `viewer` stays null until ensureViewer builds a hidden
 * one from the kept GLB bytes, so S3 can switch the editing character without re-fetching the package.
 */
export function createRegistry() {
  const entries = new Map();
  const frames = [];
  let fpsPlaying = null,
    openMs = null,
    lastTime = NaN;
  return {
    entries,
    get active() {
      return entries.size > 0;
    },
    add(entry) {
      entries.set(entry.characterId, entry);
      return entry;
    },
    get: (id) => entries.get(id),
    list: () => [...entries.values()],
    viewers: () => [...entries.values()].filter((e) => !e.editing),
    /** Set every viewer mixer to the editor time (shot time 0 = frameRange[0]); returns true when something moved. */
    sync(time, force = false) {
      if (!force && time === lastTime) return false;
      lastTime = time;
      for (const e of entries.values()) {
        const v = e.viewer;
        if (!v || (e.editing && !v.group.visible)) continue;
        const t = Math.max(0, Math.min(time, e.duration));
        v.action.reset().play();
        // An edited character plays its baked edit clip (shot time == clip time); the others play the F2 clip.
        v.mixer.setTime(v.direct ? t : ShotPackage.clipTime(e.character.clip, t));
        v.group.updateMatrixWorld(true);
      }
      return true;
    },
    forget() {
      lastTime = NaN;
    },
    /** Per character: bones/root world matrices in App 2 Y-up (directly comparable with sampleProjectSkeletonRange). */
    sample() {
      return [...entries.values()].map((e) => {
        e.group.updateMatrixWorld(true);
        e.root.updateMatrixWorld(true);
        return {
          characterId: e.characterId,
          editing: !!e.editing,
          bones: sampleBones(e.root),
          root: matrixToYUp(e.root.matrixWorld),
        };
      });
    },
    /** Call once per rAF frame. */
    tick(stamp, playing) {
      frames.push(stamp);
      while (frames.length && stamp - frames[0] > 1000) frames.shift();
      if (playing && frames.length > 1)
        fpsPlaying = ((frames.length - 1) * 1000) / (stamp - frames[0]);
    },
    setOpenMs(ms) {
      openMs = ms;
    },
    stats() {
      const viewers = [...entries.values()].filter((e) => !e.editing).length;
      return { characters: entries.size, viewers, fps: fpsPlaying, openMs };
    },
    clear() {
      entries.clear();
      frames.length = 0;
      fpsPlaying = null;
      openMs = null;
      lastTime = NaN;
    },
  };
}
