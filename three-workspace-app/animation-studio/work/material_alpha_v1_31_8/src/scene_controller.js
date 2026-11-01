// Scene runtimes own cloned rigs. Editor A/B is an authoring workspace, not the scene clock.
var sceneRuntimes = new Map(),
  sceneAssets = new Map(),
  sceneLayer = null,
  scenePanel = null,
  sceneTime = 0,
  scenePlaying = false,
  sceneEditing = null,
  sceneUndo = [],
  sceneRedo = [],
  sceneSerial = 0,
  sceneEpoch = 0,
  sceneBusy = false,
  sceneLastStamp = 0,
  sceneWasDual = false,
  sceneOriginalTime = 0;
function sceneId(prefix) {
  return prefix + '-' + ++sceneSerial + '-' + Date.now().toString(36);
}
function sceneRevision() {
  return 'scene-' + sceneEpoch + '-' + sceneProject.revision;
}
function sceneSourceProject(p) {
  const out = C.clone(p);
  const prune = (o) => {
    if (!o || typeof o !== 'object') return;
    if (o.rig) delete o.rig.asset;
    for (const k of [
      'textureOverrides',
      'parallelModes',
      'settings',
      'draft',
      'draftControls',
      'draftModes',
      'draftRigOptions',
      'workspaceLayout',
    ])
      delete o[k];
    if (o.lab?.base) prune(o.lab.base);
  };
  prune(out);
  return out;
}
function sceneSnapshotEditor() {
  captureEditorSlot();
  const h = snapshot();
  return {
    asset: C.clone(rig.asset),
    project: sceneSourceProject(project),
    units: $('sourceUnits').value,
    textureOverrides: Tex.serialize(rig, V.sourceMaterial),
    activeRoot: rig.activeRoot,
    draft: h.pose,
    draftControls: h.controls,
    draftModes: h.modes,
    draftRigOptions: h.options,
    draftDirty: draft,
    time,
    selected,
  };
}
function sceneHistoryPush() {
  sceneUndo.push(C.clone(sceneProject));
  if (sceneUndo.length > 30) sceneUndo.shift();
  sceneRedo = [];
}
function scenePersistLibrary() {
  try {
    localStorage.setItem('animation-studio-scene-library-v2', JSON.stringify(sceneProject.library));
  } catch (e) {
    scenePanel?.message('Thư viện chỉ giữ trong phiên này: bộ nhớ đầy. Hãy lưu cảnh JSON.', true);
  }
}
function sceneChange(fn) {
  if (sceneBusy) throw Error('Chờ xuất cảnh hoàn tất.');
  const next = C.clone(sceneProject);
  fn(next);
  const valid = SceneStudio.validate(next);
  sceneCancelPending();
  sceneHistoryPush();
  valid.revision = sceneProject.revision + 1;
  sceneProject = valid;
  scenePending = null;
  sceneEpoch++;
  scenePersistLibrary();
  syncSceneStudio();
  syncScenePreview();
  return sceneContext();
}
function sceneCancelPending() {
  if (scenePending?.addedActor) {
    const id = scenePending.addedActor;
    const rt = sceneRuntimes.get(id);
    rt?.wrapper.removeFromParent();
    if (rt) disposeObject(rt.rig.root);
    sceneRuntimes.delete(id);
    sceneAssets.delete(id);
  }
  scenePending = null;
}
async function sceneStage(operation, parameters, revision) {
  if (sceneBusy) throw Error('Đang xuất cảnh.');
  if (revision !== sceneRevision())
    throw Error('Dữ liệu cảnh đã thay đổi. Đọc lại get_scene_context.');
  sceneCancelPending();
  let candidate,
    addedActor = null;
  if (operation === 'add_actor') {
    const src = SceneStudio.actor(
        sceneProject,
        parameters.cloneActorId || sceneProject.actors[0]?.id,
      ),
      spec = {
        ...C.clone(src),
        id: parameters.id || sceneId('actor'),
        name: parameters.name || src.name + ' copy',
        slot: 'external',
        transform: parameters.transform || src.transform,
      };
    delete spec.studio;
    candidate = SceneStudio.operation(sceneProject, 'add_actor', spec);
    const rt = await scenePrepare(sceneAssets.get(src.id), spec);
    sceneRuntimes.set(spec.id, rt);
    sceneAssets.set(spec.id, rt.studio);
    addedActor = spec.id;
  } else candidate = SceneStudio.operation(sceneProject, operation, parameters);
  const check = SceneEval.check(candidate, sceneRuntimes);
  if (!check.ok) {
    if (addedActor) {
      sceneRuntimes.delete(addedActor);
      sceneAssets.delete(addedActor);
    }
    throw Error(check.errors.join('\n'));
  }
  scenePending = {
    id: sceneId('scene-patch'),
    base: revision,
    candidate,
    summary: operation,
    addedActor,
  };
  if (sceneMode) syncScenePreview();
  return {
    patchId: scenePending.id,
    baseRevision: revision,
    summary: operation,
    scene: SceneStudio.summary(candidate),
  };
}
function sceneUndoAction(redo = false) {
  const from = redo ? sceneRedo : sceneUndo,
    to = redo ? sceneUndo : sceneRedo;
  if (!from.length) throw Error('Không còn bước ' + (redo ? 'Redo' : 'Undo') + ' cảnh.');
  to.push(C.clone(sceneProject));
  const next = from.pop();
  next.revision = sceneProject.revision + 1;
  sceneProject = SceneStudio.validate(next);
  sceneEpoch++;
  scenePending = null;
  sceneEditing = null;
  scenePersistLibrary();
  syncSceneStudio();
  syncScenePreview();
  return sceneContext();
}
function sceneMotionAdd(next, a, p, name) {
  const value = sceneSourceProject(p);
  if (value.rig.fingerprint !== a.rigFingerprint) throw Error('Motion khác rig actor.');
  C.validateProject(value, sceneRuntimes.get(a.id).rig);
  const item = {
    id: sceneId('motion'),
    name: (name || p.name || 'Motion').slice(0, 120),
    tags: ['motion', a.name.slice(0, 40)],
    rigFingerprint: a.rigFingerprint,
    duration: value.duration,
    project: value,
  };
  SceneStudio.addLibraryItem(next, 'motions', item);
  return item;
}
function sceneAppendMotion(next, actorId, sourceId, start) {
  const a = SceneStudio.actor(next, actorId),
    m = SceneStudio.motion(next, sourceId),
    at = start ?? a.clips.reduce((end, c) => Math.max(end, c.start + c.length), 0),
    length = Math.min(m.duration, next.duration - at);
  if (length <= 0) throw Error('Timeline đã đầy; tăng thời lượng cảnh.');
  return SceneStudio.addClip(next, actorId, {
    id: sceneId('clip'),
    sourceId: m.id,
    start: at,
    length,
    sourceLength: m.duration,
    fade: Math.min(0.15, length),
    align: 'continue',
  });
}
async function scenePrepare(studio, actorData) {
  if (!studio?.asset?.data) throw Error('Cảnh thiếu model nhúng: ' + actorData.name);
  const asset = studio.asset,
    bytes = Uint8Array.from(atob(asset.data), (c) => c.charCodeAt(0)).buffer,
    r = await parseAsset(bytes, asset.name, false, asset.resources || [], asset.companions || []),
    rt = SceneEval.initialize(r);
  if (r.fingerprint !== actorData.rigFingerprint)
    throw Error(actorData.name + ': rig model không khớp file cảnh.');
  r.activeRoot = studio.activeRoot || null;
  const p = C.validateProject(studio.project, r);
  Tex.validateOverrides(r, studio.textureOverrides || []);
  await Tex.restore(r, studio.textureOverrides || []);
  S.apply(r, p.skinAdjustments || {});
  return {
    ...rt,
    studio: { ...C.clone(studio), project: sceneSourceProject(p) },
    bind: r.fingerprint,
  };
}
async function sceneAddModel({ sample = false, slot } = {}) {
  if (sceneBusy) throw Error('Đang xuất cảnh.');
  let studio;
  if (sample) {
    const r = await parseAsset(sampleBytes(), 'Mixamo T-Pose.fbx');
    studio = {
      asset: r.asset,
      project: C.newProject(r),
      units: 'cm',
      textureOverrides: [],
      activeRoot: null,
    };
    disposeObject(r.root);
  } else {
    if (draft) throw Error('Ghi key pose đang chỉnh trước khi thêm vào cảnh.');
    if (slot && slot !== activeEditorSlot && editorSlots[slot]) {
      captureEditorSlot();
      const other = editorSlots[slot];
      studio = {
        asset: C.clone(other.rig.asset),
        project: sceneSourceProject(other.project),
        units: other.sourceUnits,
        textureOverrides: Tex.serialize(other.rig, V.sourceMaterial),
        activeRoot: other.rig.activeRoot,
      };
    } else studio = sceneSnapshotEditor();
  }
  const count = sceneProject.actors.length,
    id = count === 0 ? 'actor-a' : count === 1 ? 'actor-b' : sceneId('actor'),
    a = {
      id,
      name: studio.project.rig.name || studio.asset.name,
      slot: count === 0 ? 'A' : count === 1 ? 'B' : 'external',
      rigFingerprint: studio.project.rig.fingerprint,
      profile: studio.project.rig.profile || 'Khác',
      units: studio.units,
      transform: { position: [count * 2, 0, 0], rotation: [0, 0, count ? 180 : 0], scale: 1 },
    },
    runtime = await scenePrepare(studio, a);
  sceneRuntimes.set(id, runtime);
  sceneAssets.set(id, runtime.studio);
  try {
    sceneChange((next) => {
      SceneStudio.addActor(next, a);
      const item = sceneMotionAdd(next, a, studio.project);
      sceneAppendMotion(next, id, item.id, 0);
    });
  } catch (e) {
    sceneRuntimes.delete(id);
    sceneAssets.delete(id);
    disposeObject(runtime.rig.root);
    throw e;
  }
  scenePanel?.choose(id, SceneStudio.actor(sceneProject, id).clips[0]?.id);
  sceneFitCamera();
  return id;
}
function sceneContext() {
  const state = SceneStudio.summary(sceneProject);
  return {
    revision: sceneRevision(),
    scene: state,
    time: sceneTime,
    playing: scenePlaying,
    editing: sceneEditing,
    pending: scenePending ? { id: scenePending.id, summary: scenePending.summary } : null,
  };
}
function sceneHeartbeat() {
  return {
    revision: sceneRevision(),
    name: sceneProject.name,
    duration: sceneProject.duration,
    fps: sceneProject.fps,
    actorCount: sceneProject.actors.length,
    clipCount: sceneProject.actors.reduce((n, a) => n + a.clips.length, 0),
    markerCount: sceneProject.markers.length,
    time: sceneTime,
  };
}
function sceneConnectLayer() {
  if (!sceneLayer) sceneLayer = new T.Group();
  if (sceneLayer.parent !== editView.scene) editView.scene.add(sceneLayer);
  for (const [id, rt] of sceneRuntimes) {
    rt.wrapper.visible = sceneProject.actors.some((a) => a.id === id && a.visible && !a.muted);
    if (rt.wrapper.parent !== sceneLayer) sceneLayer.add(rt.wrapper);
  }
  sceneLayer.visible = sceneMode;
}
function syncSceneStudio() {
  if (!scenePanel) return;
  scenePanel.update(sceneContext());
  scenePanel.contacts(sceneProject.actors, sceneRuntimes);
  scenePanel.time(sceneTime, scenePlaying);
}
function syncScenePreview() {
  if (!sceneMode || !sceneRuntimes) return;
  sceneConnectLayer();
  const current = scenePending?.candidate || sceneProject;
  const result = SceneEval.evaluate(current, sceneRuntimes, Math.min(sceneTime, current.duration));
  editView.wrapper.visible = !!sceneEditing;
  editView.visual.visible = !!sceneEditing;
  if (sceneEditing) {
    const a = SceneStudio.actor(current, sceneEditing.actorId),
      rt = sceneRuntimes.get(a.id);
    rt.wrapper.visible = false;
    SceneEval.place({ wrapper: editView.wrapper }, a);
  }
  if (result.warnings.length)
    scenePanel?.message(
      result.warnings[0].contactId +
        ': mục tiêu ngoài tầm, lệch ' +
        result.warnings[0].distanceMeters.toFixed(3) +
        ' m',
      true,
    );
  editView.dirty = true;
  scenePanel?.time(sceneTime, scenePlaying);
  return result;
}
function sceneSeek(value) {
  if (!Number.isFinite(value)) throw Error('Thời gian cảnh không hợp lệ.');
  sceneTime = Math.max(0, Math.min(sceneProject.duration, value));
  if (!sceneEditing) time = sceneTime;
  scenePlaying = false;
  syncScenePreview();
  syncTime();
}
function sceneFrame(stamp) {
  const dt = Math.max(0, (stamp - sceneLastStamp) / 1000);
  sceneLastStamp = stamp;
  if (scenePlaying) {
    sceneTime += dt * Number($('speedInput').value || 1);
    if (sceneTime > sceneProject.duration) {
      if ($('loop').checked) sceneTime %= sceneProject.duration;
      else {
        sceneTime = sceneProject.duration;
        scenePlaying = false;
      }
    }
  }
  time = sceneTime;
  syncScenePreview();
  for (const view of editViews)
    if (view.container.clientWidth && view.container.clientHeight) showView(view);
  syncTime();
}
function sceneFitCamera() {
  if (!sceneLayer) return;
  sceneLayer.updateMatrixWorld(true);
  const box = new T.Box3().setFromObject(sceneLayer);
  if (box.isEmpty()) return;
  const center = box.getCenter(new T.Vector3()),
    radius = Math.max(0.5, box.getSize(new T.Vector3()).length());
  editView.orbit.target.copy(center);
  editView.camera.position
    .copy(center)
    .add(new T.Vector3(radius * 0.8, -radius * 1.1, radius * 0.6));
  editView.orbit.update();
  editView.dirty = true;
}
function sceneExit() {
  sceneMode = false;
  time = Math.min(sceneOriginalTime, project.duration);
  playing = false;
  scenePlaying = false;
  sceneEditing = null;
  sceneLayer && (sceneLayer.visible = false);
  editView.wrapper.visible = true;
  editView.visual.visible = true;
  editView.wrapper.position.set(0, 0, 0);
  editView.wrapper.quaternion.copy(C.kinematics.blenderBasis);
  editView.wrapper.scale.setScalar(2 / rig.height);
  editView.wrapper.updateMatrixWorld(true);
  C.evaluate(rig, project, Math.min(time, project.duration));
  scenePanel?.hide();
  if (sceneWasDual) setDualEnabled(true).catch((e) => info(e.message, true));
  refresh();
}
async function sceneShow(show = true) {
  if (!sceneMode) {
    sceneWasDual = dualEnabled;
    sceneOriginalTime = time;
  }
  endSourcePreview(false);
  playing = false;
  if (mode === 'compare') setMode('rig');
  sceneMode = true;
  scenePlaying = false;
  sceneLastStamp = performance.now();
  if (!sceneProject.actors.length) {
    await sceneAddModel();
    const other = activeEditorSlot === 'A' ? 'B' : 'A';
    if (editorSlots[other]) await sceneAddModel({ slot: other });
  }
  if (dualEnabled) await setDualEnabled(false);
  sceneConnectLayer();
  syncSceneStudio();
  syncScenePreview();
  sceneFitCamera();
  if (show) scenePanel.show();
  return sceneContext();
}
function sceneSerializable() {
  if (sceneEditing) sceneApplyEdit();
  const result = SceneStudio.validate(sceneProject);
  result.viewportGround = {
    ...Ground.normalize(readSettings()),
    background: $('background').value,
  };
  for (const a of result.actors) {
    const saved = sceneAssets.get(a.id);
    if (!saved) throw Error('Thiếu asset actor ' + a.name);
    a.studio = C.clone(saved);
    a.studio.units = a.units;
  }
  return result;
}
async function sceneOpen(input) {
  const raw = input?.text ? JSON.parse(await input.text()) : C.clone(input),
    prepared = new Map(),
    assets = new Map();
  // Upgrade only deterministic fields from 1.31; reject incompatible references instead of dropping clips.
  for (const m of raw.library?.motions || [])
    if (m.duration === undefined && m.project) m.duration = m.project.duration;
  raw.coordinateSystem ??= 'blender-z-up';
  for (const a of raw.actors || []) {
    if (a.studio?.project?.rig?.fingerprint) a.rigFingerprint = a.studio.project.rig.fingerprint;
  }
  const next = SceneStudio.validate(raw);
  try {
    for (const a of next.actors) {
      const rt = await scenePrepare(a.studio, a);
      for (const c of a.clips)
        C.validateProject(SceneStudio.motion(next, c.sourceId).project, rt.rig);
      prepared.set(a.id, rt);
      assets.set(a.id, rt.studio);
      delete a.studio;
    }
  } catch (e) {
    for (const rt of prepared.values()) disposeObject(rt.rig.root);
    throw e;
  }
  const checked = SceneEval.check(next, prepared);
  if (!checked.ok) {
    for (const rt of prepared.values()) disposeObject(rt.rig.root);
    throw Error(checked.errors.join('\n'));
  }
  for (const rt of sceneRuntimes.values()) rt.wrapper.removeFromParent();
  sceneRuntimes = prepared;
  sceneAssets = assets;
  sceneProject = next;
  sceneProject.revision++;
  sceneEpoch++;
  sceneUndo = [];
  sceneRedo = [];
  scenePending = null;
  sceneEditing = null;
  sceneTime = 0;
  sceneMode = true;
  scenePlaying = false;
  scenePersistLibrary();
  applySettings({
    ...Ground.normalize(raw.viewportGround),
    ...(typeof raw.viewportGround?.background === 'string' &&
    /^#[0-9a-f]{6}$/i.test(raw.viewportGround.background)
      ? { background: raw.viewportGround.background }
      : {}),
  });
  syncSceneStudio();
  syncScenePreview();
  sceneFitCamera();
  return sceneContext();
}
async function sceneEdit(actorId, clipId) {
  if (draft && !sceneEditing)
    throw Error('Ghi key hoặc lưu pose hiện tại trước khi đổi bài chỉnh.');
  const a = SceneStudio.actor(sceneProject, actorId),
    clip = a.clips.find((c) => c.id === clipId),
    saved = sceneAssets.get(actorId);
  if (a.locked) throw Error('Actor đang khóa.');
  scenePlaying = false;
  sceneEditing = null;
  sceneMode = false;
  const p = clip ? SceneStudio.motion(sceneProject, clip.sourceId).project : saved.project,
    data = {
      ...C.clone(p),
      rig: { ...p.rig, asset: C.clone(saved.asset) },
      settings: readSettings(),
      textureOverrides: C.clone(saved.textureOverrides || []),
    };
  dirty = false;
  await loadProject(data);
  $('sourceUnits').value = a.units;
  sceneMode = true;
  sceneEditing = { actorId, clipId: clip?.id || null };
  time = clip
    ? Math.min(p.duration, Math.max(0, (sceneTime - clip.start) * clip.speed) + clip.sourceStart)
    : 0;
  C.evaluate(rig, project, time);
  syncScenePreview();
  scenePanel.message('Đang chỉnh ' + a.name + '. Ghi key rồi bấm “Ghi nguồn mới vào clip”.');
  return sceneEditing;
}
function sceneApplyEdit() {
  if (!sceneEditing) throw Error('Chọn clip và bấm Chỉnh key/rig trước.');
  if (draft) throw Error('Ghi key pose trước khi cập nhật nguồn.');
  const edit = { ...sceneEditing },
    studio = sceneSnapshotEditor();
  sceneChange((next) => {
    const a = SceneStudio.actor(next, edit.actorId);
    SceneStudio.setActor(next, a.id, { units: studio.units });
    const m = sceneMotionAdd(next, a, studio.project);
    if (edit.clipId) {
      const current = SceneStudio.actor(next, edit.actorId),
        c = current.clips.find((c) => c.id === edit.clipId);
      if (current.locked) throw Error('Actor đang khóa.');
      c.sourceId = m.id;
      c.sourceStart = Math.min(c.sourceStart, Math.max(0, m.duration - 0.1));
      c.sourceLength = Math.min(c.sourceLength, m.duration - c.sourceStart);
      c.name = m.name;
    } else sceneAppendMotion(next, a.id, m.id);
  });
  sceneAssets.set(edit.actorId, studio);
  const rt = sceneRuntimes.get(edit.actorId);
  S.apply(rt.rig, studio.project.skinAdjustments || {});
  for (const row of Tex.rows(rig, V.sourceMaterial)) {
    const texture = row.material.map,
      resource = texture?.userData?.studioImage;
    if (resource) {
      const copy = texture.clone();
      Tex.assign(rt.rig, [row.key], resource, { true: copy, false: copy });
    }
  }
  sceneEditing = null;
  syncScenePreview();
}
function sceneSelected() {
  const a = SceneStudio.actor(sceneProject, scenePanel.selectedActor || sceneProject.actors[0]?.id),
    c = a.clips.find((c) => c.id === scenePanel.selectedClip);
  return { a, c };
}
async function sceneExport({ includeFbx = false, downloadFile = false } = {}) {
  if (sceneBusy) throw Error('Đang xuất cảnh.');
  if (scenePending) throw Error('Apply hoặc hủy preview trước khi xuất.');
  if (sceneEditing) throw Error('Ghi nguồn mới vào clip trước khi xuất.');
  sceneBusy = true;
  scenePlaying = false;
  try {
    const result = await ScenePackage.build(SceneStudio.validate(sceneProject), sceneRuntimes, {
      includeFbx,
    });
    if (downloadFile) download(result.data, result.filename, 'application/zip');
    scenePanel?.message(
      'Đã xuất ' +
        result.report.actors +
        ' actor · ' +
        result.report.warnings.length +
        ' cảnh báo.',
    );
    return result;
  } finally {
    sceneBusy = false;
    syncScenePreview();
  }
}
async function sceneCall(tool, args = {}) {
  if (tool === 'get_scene_context') return sceneContext();
  if (tool === 'preview_scene_patch')
    return sceneStage(args.operation, args.parameters || {}, args.expectedRevision);
  if (tool === 'apply_scene_patch') {
    if (sceneBusy) throw Error('Đang xuất cảnh.');
    if (
      !scenePending ||
      scenePending.id !== args.patchId ||
      args.expectedRevision !== sceneRevision() ||
      scenePending.base !== sceneRevision()
    )
      throw Error('Bản chỉnh cảnh hết hiệu lực.');
    sceneHistoryPush();
    sceneProject = SceneStudio.validate(scenePending.candidate);
    sceneProject.revision++;
    sceneEpoch++;
    scenePending = null;
    scenePersistLibrary();
    syncSceneStudio();
    syncScenePreview();
    return sceneContext();
  }
  if (tool === 'cancel_scene_patch') {
    sceneCancelPending();
    syncScenePreview();
    return { cancelled: true };
  }
  if (args.expectedRevision !== sceneRevision())
    throw Error('Dữ liệu cảnh đã thay đổi. Đọc lại context.');
  if (tool === 'undo_scene') return sceneUndoAction(!!args.redo);
  if (tool === 'export_scene') {
    const result = await sceneExport({ includeFbx: !!args.includeFbx });
    if (result.data.byteLength > 17 * 1024 * 1024)
      throw Error('Gói quá lớn cho MCP; dùng Xuất ZIP trên giao diện.');
    return {
      filename: result.filename,
      format: 'zip',
      encoding: 'base64',
      data: base64(result.data),
      report: result.report,
    };
  }
  throw Error('Lệnh cảnh không hỗ trợ.');
}
function sceneSeedLibrary() {
  try {
    const saved = JSON.parse(localStorage.getItem('animation-studio-scene-library-v2') || 'null');
    if (saved) {
      const candidate = C.clone(sceneProject);
      candidate.library = saved;
      SceneStudio.validate(candidate);
      sceneProject.library = saved;
    }
  } catch {}
}
function sceneSaveTemplate(next) {
  const value = {
    id: sceneId('template'),
    name: next.name,
    tags: ['fight', 'scene'],
    roles: next.actors.map((a) => ({
      role: a.id,
      name: a.name,
      rigFingerprint: a.rigFingerprint,
      transform: C.clone(a.transform),
    })),
    clips: next.actors.flatMap((a) => a.clips.map((c) => ({ ...C.clone(c), role: a.id }))),
    markers: C.clone(next.markers),
  };
  SceneStudio.addLibraryItem(next, 'templates', value);
}
async function sceneAction(action, args = {}) {
  if (action === 'preset')
    return sceneChange((n) => {
      if (n.actors.length < 2) throw Error('Thêm ít nhất hai actor để dùng mẫu.');
      const A = n.actors[0],
        B = n.actors[1],
        ma = SceneStudio.motion(n, scenePanel.get('scenePresetA').value),
        mb = SceneStudio.motion(n, scenePanel.get('scenePresetB').value),
        style = scenePanel.get('scenePreset').value,
        length = Math.min(3, n.duration * 0.65),
        hit = n.duration * 0.45,
        startA = Math.max(0, hit - length * 0.65),
        startB = Math.max(0, hit - length * 0.25),
        id = sceneId('preset'),
        labels = {
          'punch-dodge': ['Ra đòn', 'Né'],
          'kick-fall': ['Đá', 'Ngã'],
          'run-block': ['Tiến công', 'Đỡ'],
        },
        names = labels[style];
      const clipA = {
          id: 'role-a',
          role: A.id,
          sourceId: ma.id,
          name: names[0] + ' · ' + ma.name,
          start: startA,
          length,
          sourceStart: 0,
          sourceLength: ma.duration,
          speed: ma.duration / length,
          loop: false,
          reverse: false,
          fade: Math.min(0.15, length),
          align: 'continue',
          rootMotion: 'baked',
        },
        clipB = {
          ...clipA,
          id: 'role-b',
          role: B.id,
          sourceId: mb.id,
          name: names[1] + ' · ' + mb.name,
          start: startB,
          length: Math.min(length, n.duration - startB),
          sourceLength: mb.duration,
          speed: mb.duration / Math.min(length, n.duration - startB),
        };
      SceneStudio.addLibraryItem(n, 'templates', {
        id,
        name: names.join(' → '),
        tags: ['fight', style],
        roles: [
          { role: A.id, name: A.name, rigFingerprint: A.rigFingerprint, transform: A.transform },
          { role: B.id, name: B.name, rigFingerprint: B.rigFingerprint, transform: B.transform },
        ],
        clips: [clipA, clipB],
        markers: [
          {
            id: 'impact',
            label: names[0] + ' / ' + names[1],
            kind: 'contact',
            time: hit,
            bindings: [
              { clipId: 'role-a', localTime: hit - startA },
              { clipId: 'role-b', localTime: hit - startB },
            ],
          },
        ],
      });
      SceneStudio.applyTemplate(n, id, { [A.id]: A.id, [B.id]: B.id });
    });
  if (action === 'collapse') {
    scenePanel.hide();
    return;
  }
  if (action === 'exit') return sceneExit();
  if (action === 'play') {
    if (sceneEditing) throw Error('Ghi nguồn vào clip trước khi phát cảnh.');
    if (sceneTime >= sceneProject.duration) sceneTime = 0;
    scenePlaying = !scenePlaying;
    sceneLastStamp = performance.now();
    scenePanel.time(sceneTime, scenePlaying);
    return;
  }
  if (action === 'seek') return sceneSeek(args.time);
  if (action === 'undo' || action === 'redo') return sceneUndoAction(action === 'redo');
  if (action === 'settings')
    return sceneChange((n) => {
      n.name = args.name;
      n.duration = args.duration;
      n.fps = args.fps;
    });
  if (action === 'add-current') return sceneAddModel();
  if (action === 'add-sample') return sceneAddModel({ sample: true });
  if (action === 'save') {
    const data = sceneSerializable();
    download(
      JSON.stringify(data, null, 2),
      ScenePackage.safeName(data.name) + '.scene.json',
      'application/json',
    );
    return;
  }
  if (action === 'open') return sceneOpen(args.file);
  if (action === 'export')
    return sceneExport({ includeFbx: scenePanel.get('sceneFbx').checked, downloadFile: true });
  if (action === 'check') {
    const r = SceneEval.check(sceneProject, sceneRuntimes);
    scenePanel.message(
      [...r.errors, ...r.warnings].join('\n') ||
        'Cảnh hợp lệ về dữ liệu. Contact và kết quả Minecraft cần xem thử.',
      !r.ok,
    );
    return r;
  }
  if (action === 'actor') return sceneChange((n) => SceneStudio.setActor(n, args.actorId, args));
  if (action === 'select-actor') {
    scenePanel.choose(args.actorId, SceneStudio.actor(sceneProject, args.actorId).clips[0]?.id);
    return;
  }
  if (action === 'remove-actor')
    return sceneChange((n) => {
      if (SceneStudio.actor(n, args.actorId).locked) throw Error('Actor đang khóa.');
      n.contacts = n.contacts.filter(
        (c) => c.source.actorId !== args.actorId && c.target.actorId !== args.actorId,
      );
      for (const m of n.markers) m.bindings = m.bindings.filter((b) => b.actorId !== args.actorId);
      n.actors = n.actors.filter((a) => a.id !== args.actorId);
    });
  if (action === 'add-current-clip') {
    if (draft) throw Error('Ghi key trước khi thêm clip.');
    return sceneChange((n) => {
      const a = SceneStudio.actor(n, args.actorId),
        m = sceneMotionAdd(n, a, project);
      const clip = sceneAppendMotion(n, a.id, m.id);
      scenePanel.choose(a.id, clip.id);
    });
  }
  if (action === 'move-clip')
    return sceneChange((n) => SceneStudio.moveClip(n, args.actorId, args.clipId, args));
  if (action === 'update-clip') {
    const p = scenePanel.clipArgs();
    return sceneChange((n) => SceneStudio.moveClip(n, p.actorId, p.clipId, p));
  }
  if (action === 'delete-clip') {
    const { a, c } = sceneSelected();
    if (!c) throw Error('Chọn clip.');
    return sceneChange((n) => SceneStudio.deleteClip(n, a.id, c.id));
  }
  if (action === 'duplicate-clip') {
    const { a, c } = sceneSelected();
    if (!c) throw Error('Chọn clip.');
    return sceneChange((n) =>
      SceneStudio.addClip(n, a.id, {
        ...C.clone(c),
        id: sceneId('clip'),
        start: c.start + c.length,
      }),
    );
  }
  if (action === 'split-clip') {
    const { a, c } = sceneSelected();
    if (!c || c.loop || c.reverse) throw Error('Cắt clip thường; bỏ Loop/Reverse trước.');
    const offset = sceneTime - c.start;
    if (offset <= 0 || offset >= c.length || offset * c.speed >= c.sourceLength)
      throw Error('Vạch thời gian cần nằm trong phần chuyển động của clip.');
    return sceneChange((n) => {
      const source = n.actors.find((x) => x.id === a.id).clips.find((x) => x.id === c.id);
      if (n.markers.some((m) => m.bindings.some((b) => b.clipId === c.id && b.actorId === a.id)))
        throw Error('Bỏ liên kết mốc trước khi cắt.');
      source.length = offset;
      source.sourceLength = offset * c.speed;
      SceneStudio.addClip(n, a.id, {
        ...C.clone(c),
        id: sceneId('clip'),
        start: sceneTime,
        length: c.length - offset,
        sourceStart: c.sourceStart + offset * c.speed,
        sourceLength: c.sourceLength - offset * c.speed,
        fade: 0,
      });
    });
  }
  if (action === 'edit-clip') {
    const { a, c } = sceneSelected();
    return sceneEdit(a.id, c?.id);
  }
  if (action === 'apply-edit') return sceneApplyEdit();
  if (action === 'add-marker')
    return sceneChange((n) => {
      const time = scenePanel.numeric('sceneMarkerTick') / 20,
        { a, c } = sceneSelected();
      SceneStudio.addMarker(n, {
        id: sceneId('marker'),
        time,
        label: scenePanel.get('sceneMarkerLabel').value,
        kind: scenePanel.get('sceneMarkerKind').value,
        bindings:
          c && time >= c.start && time <= c.start + c.length
            ? [{ actorId: a.id, clipId: c.id, localTime: time - c.start }]
            : [],
      });
    });
  if (action === 'retime-marker')
    return sceneChange((n) => SceneStudio.retimeMarker(n, args.markerId, args.time));
  if (action === 'lock-marker')
    return sceneChange((n) => SceneStudio.setMarker(n, args.markerId, { locked: args.locked }));
  if (action === 'bind-marker')
    return sceneChange((n) => {
      const marker = n.markers.find((m) => m.id === args.markerId),
        c = SceneStudio.actor(n, args.actorId).clips.find((c) => c.id === args.clipId);
      if (!c) throw Error('Chọn clip trước.');
      const b = { actorId: args.actorId, clipId: c.id, localTime: marker.time - c.start };
      SceneStudio.setMarker(n, args.markerId, {
        bindings: [
          ...marker.bindings.filter((x) => x.actorId !== b.actorId || x.clipId !== b.clipId),
          b,
        ],
      });
    });
  if (action === 'contact-select') {
    scenePanel.contacts(sceneProject.actors, sceneRuntimes);
    return;
  }
  if (action === 'add-contact')
    return sceneChange((n) => {
      const start = scenePanel.numeric('sceneContactStart') / 20,
        end = scenePanel.numeric('sceneContactEnd') / 20,
        source = {
          actorId: scenePanel.get('sceneContactSource').value,
          boneId: scenePanel.get('sceneSourceBone').value,
        },
        target = {
          actorId: scenePanel.get('sceneContactTarget').value,
          boneId: scenePanel.get('sceneTargetBone').value,
        };
      let m = n.markers
        .filter((m) => m.kind === 'contact')
        .sort((a, b) => Math.abs(a.time - start) - Math.abs(b.time - start))[0];
      if (!m)
        m = SceneStudio.addMarker(n, {
          id: sceneId('marker'),
          time: start,
          label: 'Tiếp xúc',
          kind: 'contact',
        });
      SceneStudio.addContact(n, {
        id: sceneId('contact'),
        markerId: m.id,
        source,
        target,
        start,
        end,
        strength: 1,
      });
      const check = SceneEval.check(n, sceneRuntimes);
      if (!check.ok) throw Error(check.errors.join('\n'));
    });
  if (action === 'capture-motion')
    return sceneChange((n) => {
      const { a } = sceneSelected();
      sceneMotionAdd(n, a, project);
    });
  if (action === 'capture-pose')
    return sceneChange((n) => {
      const { a } = sceneSelected(),
        rt = sceneRuntimes.get(a.id);
      SceneStudio.addLibraryItem(n, 'poses', {
        id: sceneId('pose'),
        name: a.name + ' pose ' + Math.round(sceneTime * 20) + 't',
        tags: ['pose'],
        rigFingerprint: a.rigFingerprint,
        data: C.capture(rt.rig),
      });
    });
  if (action === 'capture-profile')
    return sceneChange((n) => {
      const { a } = sceneSelected(),
        r = sceneRuntimes.get(a.id).rig;
      SceneStudio.addLibraryItem(n, 'rigProfiles', {
        id: sceneId('profile'),
        name: a.name + ' rig',
        tags: ['rig'],
        rigFingerprint: a.rigFingerprint,
        units: a.units,
        bones: r.records.map(({ id, name, parent }) => ({ id, name, parent })),
      });
    });
  if (action === 'capture-template') return sceneChange(sceneSaveTemplate);
  if (action === 'library-use') {
    const { a } = sceneSelected(),
      item = sceneProject.library[args.kind].find((x) => x.id === args.id);
    if (!item) throw Error('Mục thư viện không tồn tại.');
    if (args.kind === 'motions') return sceneChange((n) => sceneAppendMotion(n, a.id, item.id));
    if (args.kind === 'poses') {
      if (item.rigFingerprint !== a.rigFingerprint) throw Error('Pose khác rig.');
      await sceneEdit(a.id, scenePanel.selectedClip);
      for (const [id, p] of Object.entries(item.data))
        C.apply(id === 'root' ? rig.root : record(rig, id).o, p);
      writeKeys(Object.keys(item.data));
      commit();
      refresh();
      return;
    }
    if (args.kind === 'rigProfiles')
      return sceneChange((n) => {
        if (item.rigFingerprint !== a.rigFingerprint) throw Error('Hồ sơ khác rig.');
        SceneStudio.setActor(n, a.id, { units: item.units });
      });
    if (args.kind === 'templates')
      return sceneChange((n) => {
        const bindings = {};
        for (const role of item.roles || []) {
          const target =
            n.actors.find((a) => a.id === role.role) ||
            n.actors.find(
              (a) =>
                a.rigFingerprint === role.rigFingerprint && !Object.values(bindings).includes(a.id),
            );
          if (!target) throw Error('Thiếu actor phù hợp vai ' + role.name);
          bindings[role.role] = target.id;
          SceneStudio.setActor(n, target.id, { transform: role.transform });
        }
        SceneStudio.applyTemplate(n, item.id, bindings);
      });
  }
  throw Error('Thao tác cảnh chưa được hỗ trợ: ' + action);
}
function setupSceneStudio() {
  sceneSeedLibrary();
  scenePanel = new ScenePanel(sceneAction);
  sceneDialog = scenePanel.el;
  const button = document.createElement('button');
  button.id = 'sceneStudioBtn';
  button.textContent = 'Dựng cảnh';
  button.onclick = guard(() => sceneShow(true));
  $('modeCompare').before(button);
  window.__studio.scene = {
    context: sceneContext,
    call: sceneCall,
    open: () => sceneShow(false),
    addModel: sceneAddModel,
    addCurrentClip: (slot) => {
      const a = sceneProject.actors.find((a) => a.slot === slot);
      if (!a) throw Error('Không tìm thấy actor.');
      return sceneAction('add-current-clip', { actorId: a.id });
    },
    export: sceneExport,
    serialized: sceneSerializable,
    load: sceneOpen,
    seek: sceneSeek,
    exit: sceneExit,
    action: sceneAction,
    project: () => C.clone(sceneProject),
    runtime: (id) => sceneRuntimes.get(id),
    sample: (options) => ScenePackage.sample(sceneProject, sceneRuntimes, options),
  };
  syncSceneStudio();
}
setupSceneStudio();
