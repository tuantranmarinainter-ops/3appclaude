// Concatenated with app.js by build.mjs; authoring state remains in the existing editor.
import { minecraft20BOBJ } from './minecraft20_export.js';
import * as ShotExport from './shot_export.js';
import * as ShotPackage from './shot_package.js';
import * as SceneShot from './scene_shot.js';
import * as SceneSelect from './scene_select.js';
import { unzipSync, zipSync } from 'three/addons/libs/fflate.module.js';
/**
 * Bakes the character's shot clip into linear 30 FPS keys on `candidate` (a freshly parsed rig), exactly the way the
 * first editing character always was. Shared by openFiles and by the first switch to another scene character.
 */
function bakeCharacterProject(candidate, character, entry, clip, frames) {
  const duration = frames / 30,
    baked = C.newProject(candidate);
  baked.name = entry.name || clip.name;
  baked.fps = 30;
  baked.duration = duration;
  baked.loop = [0, duration];
  const mixer = new T.AnimationMixer(candidate.root),
    action = mixer.clipAction(clip);
  action.setLoop(T.LoopOnce, 1);
  action.clampWhenFinished = true;
  action.play();
  // Baked GLBs can animate a non-bone node above the top bone (e.g. "<NAME>_Armature"); the rig records bones only,
  // so that motion is folded into the top bone's local transform.
  candidate.root.updateMatrixWorld(true);
  const rootInverse = candidate.root.matrixWorld.clone().invert(),
    ancestors = (r) => rootInverse.clone().multiply(r.o.parent.matrixWorld),
    wrapped = candidate.records
      .filter((r) => !r.parent && r.o.parent && r.o.parent !== candidate.root)
      .map((r) => ({ r, restInverse: ancestors(r).invert() })),
    identity = new T.Matrix4();
  try {
    for (let frame = 0; frame <= frames; frame++) {
      const t = frame / 30;
      C.resetRig(candidate);
      action.reset().play();
      mixer.setTime(ShotPackage.clipTime(character.clip, t));
      candidate.root.updateMatrixWorld(true);
      const captured = C.capture(candidate);
      for (const { r, restInverse } of wrapped) {
        const delta = restInverse.clone().multiply(ancestors(r));
        if (delta.elements.every((v, i) => Math.abs(v - identity.elements[i]) < 1e-9)) continue;
        const p = new T.Vector3(),
          q = new T.Quaternion(),
          sc = new T.Vector3();
        delta.multiply(r.o.matrix).decompose(p, q, sc);
        captured[r.id] = { p: p.toArray(), q: q.toArray(), s: sc.toArray() };
      }
      for (const [id, value] of Object.entries(captured)) C.addKey(baked, id, t, value, 'linear');
    }
  } finally {
    mixer.stopAllAction();
    mixer.uncacheRoot(candidate.root);
  }
  return baked;
}
// "1 khung · Cả cảnh": viewer actors (mesh + mixer, no rig), placement, shot camera, letterbox, debug hooks.
// Only active while a shot with sceneMode === true is open; everything else in this file is unchanged.
function setupSceneShotView() {
  const registry = SceneShot.createRegistry(),
    button = $('sceneCameraBtn'),
    frameBox = document.createElement('div');
  frameBox.id = 'sceneCameraFrame';
  frameBox.hidden = true;
  frameBox.setAttribute('aria-hidden', 'true');
  editView.container.append(frameBox);
  const DIM_OPACITY = 0.5;
  let state = null,
    editing = null,
    switching = false,
    lastSwitchMs = null,
    onEditingChanged = null;
  // Per-character editor state, keyed by characterId:
  //   { rig (kept; null until first edit-switch), baseProject (baked F2 keys), baseHash, saved ({project, history,
  //     historyIndex, selected, selectionKeys, dirty, time} while not editing), hash, edited, hRef/hLen (cache key),
  //     bakedHash (hash the viewer's edited clip was baked for), savedHash (hash at the last host save: dirty = hash !==
  //     savedHash, while edited = hash !== baseHash stays the "differs from the baked F2 keys" mark/export criterion) }
  const stores = new Map();
  const label = document.createElement('div');
  label.id = 'sceneEditingLabel';
  label.hidden = true;
  label.setAttribute('role', 'status');
  editView.container.append(label);
  const list = document.createElement('div');
  list.id = 'sceneCharacterList';
  list.hidden = true;
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', 'Nhân vật trong cảnh');
  const mountList = () => {
    const body = document.querySelector('#floatingAnimationList .floating-animation-body');
    if (body) body.prepend(list);
    else if (!list.isConnected) editView.container.append(list);
  };
  mountList();
  const shotPlacement = (character) => ({
    scale: character.heightScale > 0 ? character.heightScale : 1,
    placement: character.placement,
  });
  async function parseViewer(bytes, character, manifest) {
    const entry = manifest.actions.find((a) => a.uuid === character.actionUuid),
      index = entry?.glbAnimationIndex;
    if (!Number.isInteger(index) || index < 0)
      throw Error('Manifest thiếu glbAnimationIndex hợp lệ cho ' + character.characterId + '.');
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      gltf = await new GLTFLoader().parseAsync(buffer, ''),
      clip = gltf.animations[index];
    if (!clip) {
      disposeObject(gltf.scene);
      throw Error('glbAnimationIndex không tồn tại trong GLB của ' + character.characterId + '.');
    }
    SceneShot.prepareViewerRoot(gltf.scene, gltf.animations);
    gltf.scene.traverse((o) => {
      if (o.isSkinnedMesh) o.frustumCulled = false;
    });
    const mixer = new T.AnimationMixer(gltf.scene),
      action = mixer.clipAction(clip);
    action.setLoop(T.LoopOnce, 1);
    action.clampWhenFinished = true;
    action.play();
    // Viewers are only ever seen dimmed (the editing rig has its own, untouched materials).
    SceneSelect.dimViewer(gltf.scene, DIM_OPACITY);
    return { root: gltf.scene, mixer, action, baseClip: clip, direct: false, editedClip: null };
  }
  function mountViewer(entry, parsed, visible) {
    const group = new T.Group();
    group.name = 'SceneViewer:' + entry.characterId;
    group.visible = visible;
    SceneShot.applyPlacement(group, entry.placement, entry.scale);
    group.add(parsed.root);
    editView.scene.add(group);
    entry.viewer = { group, ...parsed };
    if (!entry.editing) {
      entry.group = group;
      entry.root = parsed.root;
    }
  }
  function disposeViewer(entry) {
    const v = entry.viewer;
    if (!v) return;
    v.mixer.stopAllAction();
    v.mixer.uncacheRoot(v.root);
    v.group.removeFromParent();
    disposeObject(v.root);
    entry.viewer = null;
  }
  const containerSize = () => [editView.container.clientWidth, editView.container.clientHeight];
  function placeFrameBox() {
    const [w, h] = containerSize();
    if (!w || !h || !state) return;
    const r = SceneShot.filmRect(state.aspect, w, h);
    Object.assign(frameBox.style, {
      left: r.x + 'px',
      top: r.y + 'px',
      width: r.w + 'px',
      height: r.h + 'px',
    });
  }
  function updateCamera() {
    const [w, h] = containerSize();
    if (!state?.camera || !w || !h) return;
    const frame = state.shot.frameRange[0] + time * state.shot.fps,
      raw = SceneShot.sampleCameraKeys(state.shot.camera.keys, frame);
    if (!raw) return;
    const s = SceneShot.cameraToZUp(raw),
      fov = SceneShot.viewportFov(s.fovYDegrees, state.aspect, w, h),
      signature = [...s.position.toArray(), ...s.lookAt.toArray(), fov, w, h].join();
    if (signature === state.signature) return;
    state.signature = signature;
    if (editView.camera !== editView.perspective) {
      V.projection(editView, false);
      syncProjectionButton(editView);
    }
    const camera = editView.perspective;
    camera.position.copy(s.position);
    editView.orbit.target.copy(s.lookAt);
    camera.lookAt(s.lookAt);
    camera.fov = fov;
    camera.updateProjectionMatrix();
    placeFrameBox();
    for (const v of editViews) v.dirty = true;
  }
  function setCamera(on) {
    if (!state || state.camera === !!on) return;
    state.camera = !!on;
    state.signature = '';
    button.setAttribute('aria-pressed', String(state.camera));
    button.classList.toggle('active', state.camera);
    frameBox.hidden = !state.camera;
    if (state.camera) {
      state.savedFov = editView.perspective.fov;
      updateCamera();
    } else if (state.savedFov) {
      editView.perspective.fov = state.savedFov;
      editView.perspective.updateProjectionMatrix();
      for (const v of editViews) v.dirty = true;
    }
  }
  button.onclick = () => setCamera(!state?.camera);
  // Dragging the view (orbit/pan/zoom start) or choosing another preset/projection leaves the shot camera.
  editView.orbit.addEventListener('start', () => setCamera(false));
  $('cameraPreset').addEventListener('change', () => setCamera(false));
  $('projectionBtn').addEventListener('click', () => setCamera(false));
  function clear() {
    for (const entry of registry.list()) disposeViewer(entry);
    // Kept rigs of characters that are not being edited; the current rig is disposed by the next mount() as usual.
    for (const st of stores.values())
      if (st.rig) {
        retainedRigs.delete(st.rig);
        if (st.rig !== rig) disposeObject(st.rig.root);
      }
    stores.clear();
    label.hidden = true;
    list.hidden = true;
    list.replaceChildren();
    registry.clear();
    if (state) {
      setCamera(false);
      if ($('viewportLayout').value === 'sceneSingle')
        $('viewportLayout').value = state.previousLayout;
    }
    state = null;
    editing = null;
    button.hidden = true;
    frameBox.hidden = true;
  }

  // ---- per-character editor state (S3) -------------------------------------------------------------------------
  const nameOf = (id) => SceneSelect.displayName(registry.get(id)?.character);
  /** Recomputes the editing character's hash/edited flag when its undo stack moved (cheap check, hash only on change). */
  function refreshEditing(force = false) {
    const st = editing && stores.get(editing.characterId);
    if (!st) return false;
    const ref = history[historyIndex];
    if (!force && st.hRef === ref && st.hLen === history.length) return false;
    st.hRef = ref;
    st.hLen = history.length;
    st.hash = SceneSelect.keysHash(project);
    const edited = st.hash !== st.baseHash;
    const changed = st.edited !== edited;
    st.edited = edited;
    return changed || force;
  }
  const isEdited = (id) => {
    if (editing?.characterId === id) refreshEditing();
    return !!stores.get(id)?.edited;
  };
  const editedIds = () => [...stores.keys()].filter(isEdited);
  /** Differs from the last saved state (host dirty flag / unsaved guards); `edited` keeps meaning "differs from F2". */
  const isDirty = (id) => {
    if (editing?.characterId === id) refreshEditing();
    const st = stores.get(id);
    return !!st && st.hash != null && st.hash !== st.savedHash;
  };
  const dirtyIds = () => [...stores.keys()].filter(isDirty);
  /** The host saved: re-baseline every character's saved hash (the ● edited mark and export are unaffected). */
  function markSaved() {
    if (!state) return false;
    refreshEditing(true);
    for (const st of stores.values()) if (st.hash != null) st.savedHash = st.hash;
    return true;
  }
  function renderList() {
    if (!state) return;
    list.replaceChildren();
    for (const entry of registry.list()) {
      const row = document.createElement('button'),
        edited = isEdited(entry.characterId),
        current = entry === editing;
      row.type = 'button';
      row.className = 'scene-character-row' + (current ? ' active' : '');
      row.dataset.characterId = entry.characterId;
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', String(current));
      row.title = entry.characterId + (edited ? ' · đã sửa' : '');
      const name = document.createElement('span');
      name.textContent = nameOf(entry.characterId);
      const mark = document.createElement('span');
      mark.className = 'scene-edited-mark';
      mark.textContent = edited ? '●' : '';
      mark.setAttribute('aria-label', edited ? 'đã sửa' : '');
      row.append(name, mark);
      row.onclick = () => switchTo(entry.characterId).catch((e) => info(e.message || String(e), true));
      list.append(row);
    }
    label.textContent = 'Đang sửa: ' + nameOf(editing.characterId);
  }
  /** Parses one non-editing character's GLB into a rig (once) and bakes its F2 clip into editable keys. */
  async function buildRig(entry) {
    const character = entry.character,
      manifest = ShotPackage.readJSON(state.files, character.manifest),
      action = manifest.actions.find((a) => a.uuid === character.actionUuid),
      index = action?.glbAnimationIndex;
    if (!Number.isInteger(index) || index < 0)
      throw Error('Manifest thiếu glbAnimationIndex hợp lệ cho ' + character.characterId + '.');
    const bytes = entry.bytes,
      candidate = await parseAsset(
        bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
        character.glb,
      ),
      clip = candidate.clips[index];
    try {
      if (!clip) throw Error('glbAnimationIndex không tồn tại trong GLB của ' + character.characterId + '.');
      const baked = bakeCharacterProject(
        candidate,
        character,
        action,
        clip,
        state.shot.frameRange[1] - state.shot.frameRange[0],
      );
      C.resetRig(candidate);
      return { rig: candidate, baked: C.validateProject(baked, candidate) };
    } catch (error) {
      disposeObject(candidate.root);
      throw error;
    }
  }
  function setViewerClip(entry, clip, direct) {
    const v = entry.viewer;
    v.mixer.stopAllAction();
    if (v.editedClip) v.mixer.uncacheClip(v.editedClip);
    v.action = v.mixer.clipAction(clip);
    v.action.setLoop(T.LoopOnce, 1);
    v.action.clampWhenFinished = true;
    v.action.play();
    v.direct = direct;
    v.editedClip = direct ? clip : null;
  }
  /**
   * How an edited character that is not being edited keeps playing its EDITED keys: when the user leaves it, the
   * editor's own evaluation (C.evaluate: keys, IK, in-place...) is sampled at 30 FPS on the still-installed rig into
   * an AnimationClip that drives the character's viewer (same mixer path as every unedited viewer, no rig/IK per
   * frame). Exact on every 1/30 s step (shot frames); linear/slerp between. Characters whose keys equal the baked F2
   * keys keep the original F2 clip, so unedited characters are never touched.
   */
  function bakeLeavingViewer(entry, st) {
    if (st.edited) {
      if (st.bakedHash === st.hash) return;
      const pairs = SceneSelect.pairNodes(
          entry.rig.root,
          [entry.rig.root, ...entry.rig.records.map((r) => r.o)],
          entry.viewer.root,
        ),
        clip = SceneSelect.bakePoseClip(
          pairs,
          SceneSelect.sampleTimes(entry.duration, 30),
          (t) => C.evaluate(entry.rig, project, t),
          'edited:' + entry.characterId,
        );
      setViewerClip(entry, clip, true);
      st.bakedHash = st.hash;
    } else if (st.bakedHash) {
      setViewerClip(entry, entry.viewer.baseClip, false);
      st.bakedHash = null;
    }
  }
  /** Restores a character's saved editor state (history, project, selection) on the rig that is now installed. */
  function restoreSaved(sv, store, keepTime) {
    history = sv.history;
    historyIndex = sv.historyIndex;
    restoreHistory(historyIndex); // pose, IK modes/options, selection, panels
    project = C.clone(sv.project);
    dirty = sv.dirty;
    store.saved = null;
    if (!draft) {
      selectionKeys = sv.selectionKeys;
      select(sv.selected);
      seek(keepTime);
    }
  }
  /** Why a switch is refused right now (null when allowed); install() would reset or discard these states. */
  function switchBlocker() {
    if (draft) return 'Đang có tư thế chưa ghi key: ghi key hoặc bỏ trước khi chuyển nhân vật.';
    if (sceneMode && !sceneEditing)
      return 'Đang ở chế độ Dựng cảnh (chỉ đọc): thoát Dựng cảnh trước khi chuyển nhân vật.';
    if (studioMode !== 'classic')
      return 'Đang ở Animation Lab: chuyển về Pose Editor (Classic) trước khi chuyển nhân vật.';
    return null;
  }
  async function switchTo(characterId) {
    if (!state || switching) return false;
    const next = registry.get(characterId);
    if (!next) throw Error('Không có nhân vật ' + characterId + ' trong cảnh.');
    if (next === editing) return false;
    assertEditingAllowed();
    const blocker = switchBlocker();
    if (blocker) throw Error(blocker);
    switching = true;
    const started = performance.now(),
      prev = editing,
      prevStore = stores.get(prev.characterId),
      nextStore = stores.get(characterId);
    let fresh = null,
      entered = false;
    const nextWasRetained = !!nextStore.rig;
    try {
      // Everything that can fail or take time comes first: a broken GLB changes nothing.
      if (!nextStore.rig) fresh = await buildRig(next);
      await sceneShotApi.ensureViewer(prev.characterId);
      if (!state || editing !== prev) {
        if (fresh) disposeObject(fresh.rig.root);
        return false;
      }
      // ---- leave the current character: save its editor state, hand its viewer the edited keys
      refreshEditing(true);
      prevStore.saved = {
        project: C.clone(project),
        history,
        historyIndex,
        selected,
        selectionKeys: C.clone(selectionKeys),
        dirty,
        time,
      };
      bakeLeavingViewer(prev, prevStore);
      retainedRigs.add(prev.rig);
      // ---- enter the next one
      const nextRig = nextStore.rig || fresh.rig,
        keepTime = time,
        camera = editView.camera,
        saved = {
          position: camera.position.clone(),
          zoom: camera.zoom,
          target: editView.orbit.target.clone(),
        };
      retainedRigs.delete(nextRig);
      // A retained rig still carries the pose it was left in; install()/setupIK capture rest/base values from the
      // current pose, so start from the rest pose exactly like a first visit.
      if (nextWasRetained) {
        C.resetRig(nextRig);
        nextRig.root.updateMatrixWorld(true);
      }
      window.__studio.setDisplayHint(nextRig.root, next.scale * nextRig.height);
      await install(nextRig, { keepScene: true });
      // install() re-frames the camera for a new model; a character switch keeps the user's view.
      camera.position.copy(saved.position);
      camera.zoom = saved.zoom;
      camera.updateProjectionMatrix();
      editView.orbit.target.copy(saved.target);
      editView.orbit.update();
      prev.editing = false;
      prev.group = prev.viewer.group;
      prev.root = prev.viewer.root;
      next.editing = true;
      next.rig = nextRig;
      next.group = editView.wrapper;
      next.root = nextRig.root;
      next.matrix = SceneShot.placementMatrix(next.placement, next.scale);
      SceneShot.applyPlacement(editView.wrapper, next.placement, next.scale);
      prev.viewer.group.visible = true;
      if (next.viewer) next.viewer.group.visible = false;
      editing = next;
      nextStore.rig = nextRig;
      entered = true;
      const sv = nextStore.saved;
      if (sv) restoreSaved(sv, nextStore, keepTime);
      else {
        project = fresh.baked;
        nextStore.baseProject = C.clone(project);
        nextStore.baseHash = SceneSelect.keysHash(project);
        nextStore.savedHash = nextStore.baseHash;
        history = [snapshot()];
        historyIndex = 0;
        dirty = false;
        syncProject();
        seek(keepTime);
      }
      syncButtons();
      refreshEditing(true);
      registry.sync(time, true);
      for (const v of editViews) v.dirty = true;
      lastSwitchMs = performance.now() - started;
      renderList();
      onEditingChanged?.(next.character, nextStore);
      info('Đang sửa: ' + nameOf(characterId));
      return true;
    } catch (error) {
      if (!entered) await rollbackSwitch();
      throw error;
    } finally {
      switching = false;
    }
    /** The previous character stays the editing one: put its rig back, drop the fresh rig, change nothing else. */
    async function rollbackSwitch() {
      try {
        const nextRig = nextStore.rig || fresh?.rig,
          nextMounted = !!nextRig && editView.rig === nextRig;
        if (editView.rig !== prev.rig) {
          // The next rig was (partly) mounted: mount() disposes it unless it is a kept rig.
          if (nextWasRetained && nextRig) retainedRigs.add(nextRig);
          retainedRigs.delete(prev.rig);
          C.resetRig(prev.rig);
          prev.rig.root.updateMatrixWorld(true);
          window.__studio.setDisplayHint(prev.rig.root, prev.scale * prev.rig.height);
          await install(prev.rig, { keepScene: true });
          SceneShot.applyPlacement(editView.wrapper, prev.placement, prev.scale);
          const sv = prevStore.saved;
          if (sv) restoreSaved(sv, prevStore, sv.time);
        } else {
          retainedRigs.delete(prev.rig);
          prevStore.saved = null;
        }
        // A fresh rig that never got mounted (install failed before mount) is still ours to dispose.
        if (fresh && !nextMounted) disposeObject(fresh.rig.root);
        editing = prev;
        prev.editing = true;
        prev.viewer.group.visible = false;
        syncButtons();
        refreshEditing(true);
        registry.sync(time, true);
        for (const v of editViews) v.dirty = true;
        renderList();
      } catch (rollbackError) {
        info('Không khôi phục được nhân vật đang sửa: ' + (rollbackError.message || rollbackError), true);
      }
    }
  }
  // ---- click selection (S3): raycast against the viewers' skinned meshes --------------------------------------
  const raycaster = new T.Raycaster();
  // Raycaster ignores `visible`: the editing character's meshes still occlude when hidden (bones-only display), so a
  // click on its (invisible) body or limbs never reaches a character standing behind it.
  const meshesOf = (root, includeHidden = false) => {
    const out = [];
    root.traverse((o) => {
      if (o.isMesh && (o.visible || includeHidden) && o.geometry && !o.userData.boneId) out.push(o);
    });
    return out;
  };
  /**
   * Nearest hit per character under a pointer event: [{characterId, distance, editing}].
   * SkinnedMesh.raycast intersects the *current* skinned vertices (applyBoneTransform) but tests a bounding sphere
   * cached from an earlier pose, so every mesh's cache is dropped first. No fallback volumes were needed: the
   * triangle test is pose-accurate (browser test clicks the projected position of several bones).
   */
  function hitsAt(clientX, clientY) {
    const rect = editView.renderer.domElement.getBoundingClientRect(),
      ndc = SceneSelect.toNDC(clientX, clientY, rect);
    raycaster.setFromCamera(new T.Vector2(ndc.x, ndc.y), editView.camera);
    const hits = [];
    for (const entry of registry.list()) {
      const root = entry.editing ? entry.rig?.root : entry.viewer?.root;
      if (!root || (!entry.editing && !entry.viewer.group.visible)) continue;
      root.updateMatrixWorld(true);
      const meshes = meshesOf(root, !!entry.editing);
      for (const m of meshes) if (m.isSkinnedMesh) m.boundingSphere = null;
      const hit = raycaster.intersectObjects(meshes, false)[0];
      if (hit) hits.push({ characterId: entry.characterId, distance: hit.distance, editing: !!entry.editing });
    }
    return hits;
  }
  const pickAt = (x, y) => SceneSelect.pickCharacter(hitsAt(x, y));
  // Consulted by the Control Rig root-widget pick: in scene mode the big root ring yields to a viewer character whose
  // body is under the pointer (and not hidden behind the editing character's own mesh).
  editView.rootPickYields = (e) =>
    !!state && !switching && !silhouetteView.enabled && !sourcePreview && mode !== 'compare' && !!pickAt(e.clientX, e.clientY);
  (() => {
    const canvas = editView.renderer.domElement;
    let down = null;
    // Registered without capture: the Control Rig handler (capture phase, stopImmediatePropagation on a widget hit)
    // runs first, so a click on a control never reaches this and keeps its old behaviour.
    canvas.addEventListener('pointerdown', (e) => {
      const blocked =
        !state ||
        switching ||
        e.button !== 0 ||
        silhouetteView.enabled ||
        sourcePreview ||
        mode === 'compare' ||
        editView.gizmo?.axis ||
        editView.moveGizmo?.axis;
      down = blocked ? null : { x: e.clientX, y: e.clientY, id: e.pointerId };
    });
    canvas.addEventListener('pointerup', (e) => {
      const start = down;
      down = null;
      if (!start || start.id !== e.pointerId || !state) return;
      if (!SceneSelect.isClick(start, { x: e.clientX, y: e.clientY })) return;
      // The editor's own handler (registered earlier on this canvas) already used this click to select a bone/control.
      if (e.studioPicked) return;
      const id = pickAt(e.clientX, e.clientY);
      if (id) switchTo(id).catch((error) => info(error.message || String(error), true));
    });
    canvas.addEventListener('pointercancel', () => (down = null));
  })();
  const sceneShotApi = {
    registry,
    get active() {
      return registry.active;
    },
    get cameraActive() {
      return !!state?.camera;
    },
    get shot() {
      return state?.shot ?? null;
    },
    clear,
    setCamera,
    /** Parse every non-editing character before the editor is replaced, so a broken GLB changes nothing. */
    async prepare(files, shot, editingCharacter) {
      const parsed = [];
      try {
        for (const character of shot.characters) {
          if (character === editingCharacter) continue;
          const manifest = ShotPackage.readJSON(files, character.manifest);
          parsed.push({ character, parsed: await parseViewer(files[character.glb], character, manifest) });
        }
      } catch (error) {
        for (const p of parsed) disposeObject(p.parsed.root);
        throw error;
      }
      return parsed;
    },
    /** After the editing character is installed: place everything and switch to the "Cả cảnh" layout. */
    attach(files, shot, editingCharacter, parsedViewers, startedAt) {
      const duration = (shot.frameRange[1] - shot.frameRange[0]) / shot.fps,
        previousLayout =
          $('viewportLayout').value === 'sceneSingle' ? 'single' : $('viewportLayout').value;
      const context = directorContext();
      state = {
        files,
        shot,
        bridge: Object.freeze({
          character: editingCharacter,
          characterId: editingCharacter.characterId,
          actionUuid: editingCharacter.actionUuid,
          glbSha256: editingCharacter.glbSha256,
          rig: context.rig,
          rootUuid: context.rootUuid,
          slot: context.slot,
          activeRoot: context.activeRoot,
          rigObject: rig,
        }),
        aspect: SceneShot.filmAspect(shot),
        camera: false,
        previousLayout,
        signature: '',
      };
      const base = (character) => ({
        characterId: character.characterId,
        character,
        bytes: files[character.glb],
        duration,
        ...shotPlacement(character),
        viewer: null,
      });
      editing = registry.add({
        ...base(editingCharacter),
        editing: true,
        rig,
        group: editView.wrapper,
        root: rig.root,
      });
      // The editor keeps the wrapper scale from this hint across later resets; placement is a visual parent transform only.
      editing.matrix = SceneShot.placementMatrix(editing.placement, editing.scale);
      window.__studio.setDisplayHint(rig.root, editing.scale * rig.height);
      SceneShot.applyPlacement(editView.wrapper, editing.placement, editing.scale);
      for (const { character, parsed } of parsedViewers)
        mountViewer(registry.add({ ...base(character), editing: false, rig: null }), parsed, true);
      stores.clear();
      for (const e of registry.list())
        stores.set(e.characterId, {
          rig: e.editing ? rig : null,
          baseProject: e.editing ? C.clone(project) : null,
          baseHash: e.editing ? SceneSelect.keysHash(project) : null,
          saved: null,
          hash: e.editing ? SceneSelect.keysHash(project) : null,
          savedHash: e.editing ? SceneSelect.keysHash(project) : null,
          edited: false,
          hRef: null,
          hLen: -1,
          bakedHash: null,
        });
      mountList();
      list.hidden = false;
      label.hidden = false;
      refreshEditing(true);
      renderList();
      // The character list lives in the left dock: open it (without stealing keyboard focus).
      const dock = $('floatingAnimationList');
      if (dock?.hidden) {
        dock.hidden = false;
        $('animationListToggle')?.setAttribute('aria-expanded', 'true');
      }
      registry.sync(time, true);
      button.hidden = false;
      button.setAttribute('aria-pressed', 'false');
      button.classList.remove('active');
      $('viewportLayout').value = 'sceneSingle';
      applyViewportLayout();
      for (const v of editViews) v.dirty = true;
      registry.setOpenMs(performance.now() - startedAt);
      return editing;
    },
    /** Build (once) a hidden viewer for the editing character, so a later switch needs no GLB re-parse. */
    async ensureViewer(characterId) {
      const entry = registry.get(characterId);
      if (!entry) throw Error('Không có nhân vật ' + characterId + ' trong cảnh.');
      if (entry.viewer) return entry;
      const manifest = ShotPackage.readJSON(state.files, entry.character.manifest);
      mountViewer(entry, await parseViewer(entry.bytes, entry.character, manifest), false);
      return entry;
    },
    /** Called every rAF frame from frame(): follow the editor time, drive the shot camera, measure FPS. */
    tick(stamp) {
      registry.tick(stamp, playing);
      if (!state) return;
      // "Dựng cảnh" (the other scene mode) resets the wrapper on exit; put the editing character back at its F2 place.
      if (!sceneMode && editing && editing.rig === rig) {
        editView.wrapper.updateMatrix();
        if (!SceneShot.matrixClose(editView.wrapper.matrix, editing.matrix)) {
          SceneShot.applyPlacement(editView.wrapper, editing.placement, editing.scale);
          for (const v of editViews) v.dirty = true;
        }
      }
      if (registry.sync(time)) for (const v of editViews) v.dirty = true;
      if (state.camera) updateCamera();
      if (!switching && refreshEditing()) renderList();
    },
    setTime(t) {
      seek(t);
      registry.sync(time, true);
    },
    sample() {
      registry.sync(time, true);
      return registry.sample();
    },
    stats: () => registry.stats(),
    /** Object3D roots a host should frame after opening: every character in the scene. */
    fitRoots: () => registry.list().map((e) => e.root),
    // ---- S3: switching, per-character state, measurement hooks
    /** Make `characterId` the editing character (same path as a 3D click or a click in the left list). */
    select: (characterId) => switchTo(characterId),
    editing: () => editing?.characterId ?? null,
    edited: () => editedIds(),
    /** True when any scene character differs from its baked F2 keys (host dirty flag). */
    anyEdited: () => !!state && editedIds().length > 0,
    /** True when any scene character differs from its last saved state (host dirty flag, open/shotOpen guards). */
    anyDirty: () => !!state && dirtyIds().length > 0,
    dirty: () => dirtyIds(),
    markSaved,
    /**
     * Identity the App 2 broker session was leased for: frozen at attach (shotOpen), unaffected by switching the
     * editing character (that one lives in session.character / editing()). The host bridge reports this.
     */
    bridgePin: () => state?.bridge ?? null,
    keysHash(characterId) {
      const st = stores.get(characterId);
      if (!st) return null;
      if (editing?.characterId === characterId) refreshEditing();
      return st.hash;
    },
    undo: () => $('undoBtn').click(),
    redo: () => $('redoBtn').click(),
    /** Nearest hit per character at a client position (tests: where a click would land). */
    hitsAt,
    pickAt,
    get lastSwitchMs() {
      return lastSwitchMs;
    },
    get switching() {
      return switching;
    },
    /** shot_controller's workspace registers here so shotExport follows the editing character. */
    onEditingChanged(fn) {
      onEditingChanged = fn;
    },
    /** The editing character's state, for host/session code. */
    editingStore: () => (editing ? stores.get(editing.characterId) : null),
  };
  return sceneShotApi;
}
function setupShotWorkspace() {
  let session = null,
    busy = false;
  const sceneShotView = (window.__studio.sceneShot = setupSceneShotView());
  const menu = $('fileMenu').querySelector('div'),
    open = document.createElement('button'),
    input = document.createElement('input');
  open.textContent = 'Mở gói shot';
  input.type = 'file';
  input.accept = '.zip';
  menu.append(open, input);
  const panel = document.createElement('details');
  panel.id = 'shotPanel';
  panel.hidden = true;
  panel.open = true;
  const heading = document.createElement('summary');
  heading.textContent = 'Shot';
  const metadata = document.createElement('pre');
  metadata.style.maxHeight = '140px';
  metadata.style.overflow = 'auto';
  panel.append(heading, metadata);
  $('minimalSidebar').append(panel);
  const failure = document.createElement('dialog');
  failure.style.whiteSpace = 'pre-wrap';
  const errors = document.createElement('pre'),
    close = document.createElement('button');
  close.textContent = 'Đóng';
  close.onclick = () => failure.close();
  failure.append(errors, close);
  document.body.append(failure);
  const exportButton = document.createElement('button');
  exportButton.textContent = 'Xuất gói kết quả';
  exportButton.hidden = true;
  menu.append(exportButton);
  const describeShot = (shot, character) =>
    'Shot: ' +
    shot.shotId +
    '\nNhân vật: ' +
    character.characterId +
    '\nFrame: ' +
    shot.frameRange.join(' → ') +
    ' @30 FPS\nVị trí (m): ' +
    character.placement.position.join(', ') +
    '; yaw ' +
    character.placement.yawDegrees +
    '°\nRoot: ' +
    character.rootPolicy +
    '\nCamera (chỉ xem):\n' +
    JSON.stringify(shot.camera, null, 2) +
    (shot.sceneMode === true
      ? '\nCả cảnh: ' + shot.characters.length + ' nhân vật (đang sửa nhân vật được chọn)'
      : '');
  // Scene mode: the editing character changed; shotExport must follow it (it exports the CURRENT editing character).
  sceneShotView.onEditingChanged((character, store) => {
    if (!session || session.shot.sceneMode !== true) return;
    const manifest = ShotPackage.readJSON(session.files, character.manifest);
    Object.assign(session, {
      character,
      manifest,
      entry: manifest.actions.find((a) => a.uuid === character.actionUuid),
      rigFingerprint: rig.fingerprint,
      sourceProject: C.clone(store.baseProject),
      placementKeys: [{ frame: session.shot.frameRange[0], ...C.clone(character.placement) }],
      displayHeight: sceneShotView.registry.get(character.characterId).scale * rig.height,
    });
    metadata.textContent = describeShot(session.shot, character);
  });
  const clear = () => {
    session = null;
    panel.hidden = true;
    exportButton.hidden = true;
  };
  async function exportFiles({ includeMinecraft20 = false } = {}) {
    if (!session || session.rigFingerprint !== rig.fingerprint)
      throw Error('Không có shot đang chỉnh.');
    if (busy || sceneMode || sourcePreview || directorPending || draft)
      throw Error('Ghi key và đóng preview/cảnh trước khi xuất.');
    const duration = (session.shot.frameRange[1] - session.shot.frameRange[0]) / 30;
    if (Math.abs(project.duration - duration) > 1e-6)
      throw Error('Không được đổi thời lượng shot.');
    const wasPlaying = playing,
      locked = [$('createWorkspace'), document.querySelector('header')].map((e) => [e, !!e.inert]);
    busy = true;
    playing = false;
    for (const [e] of locked) e.inert = true;
    try {
      const policy = ShotExport.placementPolicy(rig, project, session),
        glb = await ShotExport.bakeEditedGLB(rig, policy.project, session.entry.name);
      const files = await ShotExport.resultFiles(session, glb, policy.placementKeys);
      if (includeMinecraft20) {
        const result = ShotPackage.readJSON(files, 'result.json'),
          path = result.edits[0].glb.replace(/\.glb$/, '.minecraft20.bobj');
        files[path] = new TextEncoder().encode(await minecraft20BOBJ(glb));
        result.edits[0].bobj = path;
        files['result.json'] = new TextEncoder().encode(JSON.stringify(result, null, 2) + '\n');
      }
      return files;
    } finally {
      busy = false;
      for (const [e, value] of locked) e.inert = value;
      playing = wasPlaying;
      lastStamp = performance.now();
      refresh();
    }
  }
  const exportDialog = document.createElement('dialog'),
    choice = document.createElement('label'),
    checkbox = document.createElement('input'),
    submit = document.createElement('button'),
    cancel = document.createElement('button');
  checkbox.type = 'checkbox';
  choice.append(checkbox, document.createTextNode(' Kèm BOBJ Minecraft20 (animation-only)'));
  submit.textContent = 'Xuất ZIP';
  cancel.textContent = 'Hủy';
  cancel.onclick = () => exportDialog.close();
  exportDialog.append(choice, submit, cancel);
  document.body.append(exportDialog);
  exportButton.onclick = () => exportDialog.showModal();
  submit.onclick = guard(async () => {
    submit.disabled = true;
    try {
      const files = await exportFiles({ includeMinecraft20: checkbox.checked });
      download(
        zipSync(files),
        session.shot.shotId.replace(/[^a-zA-Z0-9_-]/g, '_') + '.result.zip',
        'application/zip',
      );
      exportDialog.close();
    } finally {
      submit.disabled = false;
    }
  });
  async function openFiles(files, { interactive = true, blank = false } = {}) {
    if (busy) throw Error('Đang xử lý gói shot.');
    const startedAt = performance.now(),
      openingRig = rig,
      openingRevision = directorRevision(),
      verifySource = () => {
        if (!interactive && (rig !== openingRig || directorRevision() !== openingRevision))
          throw Error('REVISION_CONFLICT');
      };
    busy = true;
    try {
      const issues = await ShotPackage.validateShot(files);
      if (issues.length) {
        errors.textContent = issues
          .map((i) => i.code + ' · ' + i.path + '\n' + i.message)
          .join('\n\n');
        failure.showModal();
        throw Error('Gói shot không hợp lệ (' + issues.length + ' lỗi).');
      }
      const shot = ShotPackage.readJSON(files, 'shot.json'),
        character = shot.characters.find((c) => c.editable),
        manifest = ShotPackage.readJSON(files, character.manifest),
        entry = manifest.actions.find((a) => a.uuid === character.actionUuid),
        index = entry.glbAnimationIndex;
      if (!Number.isInteger(index) || index < 0)
        throw Error('Manifest thiếu glbAnimationIndex hợp lệ cho actionUuid.');
      const bytes = files[character.glb],
        buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      // Parse and sample before replacing the current editor, so broken GLB/Action cannot replace it.
      const candidate = await parseAsset(buffer, character.glb),
        clip = candidate.clips[index];
      if (!clip) {
        disposeObject(candidate.root);
        throw Error('glbAnimationIndex không tồn tại trong GLB.');
      }
      if (character.clip.sourceEndSeconds > clip.duration + 1e-5) {
        disposeObject(candidate.root);
        throw Error('Clip vượt quá thời lượng Action trong GLB.');
      }
      const frames = shot.frameRange[1] - shot.frameRange[0],
        duration = frames / 30;
      if (duration < 0.1 || duration > 300) {
        disposeObject(candidate.root);
        throw Error('Editor hiện hỗ trợ shot dài >=0.1 và <=300 giây.');
      }
      let baked;
      try {
        baked = bakeCharacterProject(candidate, character, entry, clip, frames);
      } finally {
        disposeObject(candidate.root);
      }
      // Scene mode: parse every other character first (same rule as above: a broken GLB must not replace the editor).
      const viewers =
        shot.sceneMode === true ? await sceneShotView.prepare(files, shot, character) : [];
      const sceneEdited = sceneShotView.anyDirty();
      if ((dirty || draft || sceneEdited) && !interactive) {
        for (const v of viewers) disposeObject(v.parsed.root);
        throw Error('UNSAVED_CHANGES');
      }
      if ((dirty || draft || sceneEdited) && !confirm('Thay bài đang chỉnh bằng gói shot?')) {
        for (const v of viewers) disposeObject(v.parsed.root);
        return false;
      }
      if (sceneMode) sceneExit();
      try {
        verifySource();
        await loadModel(buffer, character.glb, true, [], [], verifySource);
      } catch (error) {
        for (const v of viewers) disposeObject(v.parsed.root);
        throw error;
      }
      if (blank) {
        baked.keys = {};
        baked.name = 'Animation mới';
      }
      project = C.validateProject(baked, rig);
      time = 0;
      history = [snapshot()];
      historyIndex = 0;
      dirty = false;
      syncProject();
      seek(0);
      session = {
        files,
        shot,
        character,
        manifest,
        entry,
        baseShotSha256: await ShotPackage.sha256(files['shot.json']),
        sourceProject: C.clone(project),
        rigFingerprint: rig.fingerprint,
        placementKeys: [{ frame: shot.frameRange[0], ...C.clone(character.placement) }],
      };
      if (shot.sceneMode === true) {
        const editing = sceneShotView.attach(files, shot, character, viewers, startedAt);
        // The host reads this to keep the wrapper at the scene scale (instead of heightBlocks / rig.height).
        session.displayHeight = editing.scale * rig.height;
        session.sceneMode = true;
      }
      metadata.textContent = describeShot(shot, character);
      panel.hidden = false;
      exportButton.hidden = false;
      info('Đã mở shot ' + shot.shotId + ' · ' + character.characterId);
      return true;
    } finally {
      busy = false;
    }
  }
  open.onclick = () => input.click();
  input.onchange = guard(async () => {
    try {
      if (input.files[0])
        await openFiles(unzipSync(new Uint8Array(await input.files[0].arrayBuffer())));
    } finally {
      input.value = '';
    }
  });
  window.__studio.shot = {
    openFiles,
    exportFiles,
    clear,
    get session() {
      return session;
    },
    get busy() {
      return busy;
    },
    // Host bridge (Studio): whole shot/result packages as ZIP bytes.
    openZip: (bytes, options) => openFiles(unzipSync(new Uint8Array(bytes)), options),
    async exportZip(options) {
      return zipSync(await exportFiles(options));
    },
  };
}
setupShotWorkspace();
