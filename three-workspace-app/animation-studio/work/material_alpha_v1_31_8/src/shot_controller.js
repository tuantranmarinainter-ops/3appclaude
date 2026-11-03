// Concatenated with app.js by build.mjs; authoring state remains in the existing editor.
import { minecraft20BOBJ } from './minecraft20_export.js';
import * as ShotExport from './shot_export.js';
import * as ShotPackage from './shot_package.js';
import * as SceneShot from './scene_shot.js';
import { unzipSync, zipSync } from 'three/addons/libs/fflate.module.js';
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
  let state = null,
    editing = null;
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
    return { root: gltf.scene, mixer, action };
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
  return {
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
      state = {
        files,
        shot,
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
  };
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
      const baked = C.newProject(candidate);
      baked.name = entry.name || clip.name;
      baked.fps = 30;
      baked.duration = duration;
      baked.loop = [0, duration];
      const mixer = new T.AnimationMixer(candidate.root),
        action = mixer.clipAction(clip);
      action.setLoop(T.LoopOnce, 1);
      action.clampWhenFinished = true;
      action.play();
      try {
        for (let frame = 0; frame <= frames; frame++) {
          const t = frame / 30;
          C.resetRig(candidate);
          action.reset().play();
          mixer.setTime(ShotPackage.clipTime(character.clip, t));
          candidate.root.updateMatrixWorld(true);
          for (const [id, value] of Object.entries(C.capture(candidate)))
            C.addKey(baked, id, t, value, 'linear');
        }
      } finally {
        mixer.stopAllAction();
        mixer.uncacheRoot(candidate.root);
        disposeObject(candidate.root);
      }
      // Scene mode: parse every other character first (same rule as above: a broken GLB must not replace the editor).
      const viewers =
        shot.sceneMode === true ? await sceneShotView.prepare(files, shot, character) : [];
      if ((dirty || draft) && !interactive) {
        for (const v of viewers) disposeObject(v.parsed.root);
        throw Error('UNSAVED_CHANGES');
      }
      if ((dirty || draft) && !confirm('Thay bài đang chỉnh bằng gói shot?')) {
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
      metadata.textContent =
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
          ? '\nCả cảnh: ' + shot.characters.length + ' nhân vật (chỉ nhân vật đầu được sửa)'
          : '');
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
