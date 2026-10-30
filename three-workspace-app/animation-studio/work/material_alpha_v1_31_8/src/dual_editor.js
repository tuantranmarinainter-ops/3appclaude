function captureEditorSlot(side = activeEditorSlot) {
  if (!rig) return;
  editorSlots[side] = {
    view: editView,
    views: editViews,
    onion,
    rig,
    project,
    time,
    playing,
    selected,
    selectionKeys,
    history,
    historyIndex,
    dirty,
    draft,
    studioMode,
    studioBanks,
    labClipId,
    mapping,
    targetRig,
    onionRevision,
    sourceUnits: $('sourceUnits').value,
    speed: Number($('speedInput').value) || 1,
    loop: $('loop').checked,
  };
}

function restoreEditorSlot(side) {
  const s = editorSlots[side];
  if (!s) throw Error('Nhân vật ' + side + ' chưa sẵn sàng.');
  editView = s.view;
  editViews = s.views;
  activeEditView = s.view;
  onion = s.onion;
  rig = s.rig;
  project = s.project;
  time = s.time;
  playing = s.playing;
  selected = s.selected;
  selectionKeys = s.selectionKeys;
  history = s.history;
  historyIndex = s.historyIndex;
  dirty = s.dirty;
  draft = s.draft;
  studioMode = s.studioMode;
  studioBanks = s.studioBanks;
  labClipId = s.labClipId;
  mapping = s.mapping;
  targetRig = s.targetRig;
  onionRevision = s.onionRevision;
  activeEditorSlot = side;
}

function syncEditorSlotUI() {
  const s = editorSlots[activeEditorSlot];
  $('sourceUnits').value = s.sourceUnits;
  $('loop').checked = s.loop;
  setSpeed(s.speed);
  $('studioMode').value = studioMode;
  $('labPanel').hidden = studioMode !== 'lab' || mode === 'compare';
  $('labClipLane').hidden = studioMode !== 'lab' || mode === 'compare';
  $('viewportModeTag').textContent =
    mode === 'rig' ? 'CONTROL RIG' : studioMode === 'lab' ? 'ANIMATION LAB' : 'POSE EDITOR';
  fillOptions(
    $('rigSelect'),
    [['', 'Tất cả armature'], ...rig.armatures.map((a) => [a.id, a.name])],
    rig.activeRoot || '',
  );
  fillOptions(
    $('ikChain'),
    rig.chains
      .filter((c) => !rig.activeRoot || c.root === rig.activeRoot)
      .map((c) => [c.id, c.label]),
  );
  renderBones();
  syncProject();
  select(selected);
  syncButtons();
  syncQuickAnimation();
  syncWorkspaceTools();
  $('saveBtn').textContent = dirty ? 'Lưu dự án •' : 'Lưu dự án';
  $('dualActiveLabel').textContent = 'Đang chỉnh ' + activeEditorSlot + ' · ' + rig.name;
  for (const side of ['A', 'B'])
    editorSlots[side]?.view.container.classList.toggle('active-view', side === activeEditorSlot);
  refresh();
}

function activateEditorSlot(side) {
  if (!dualEnabled || side === activeEditorSlot || mode === 'compare') return;
  if (numericDrag || motionHandDrag || rigDrag)
    throw Error('Hoàn tất thao tác kéo trước khi đổi nhân vật.');
  endSourcePreview(false);
  stopTimelineScrub();
  endTimelineKeyDrag(true);
  cancelEasingPreview();
  const sharedTime = time,
    sharedPlaying = playing;
  captureEditorSlot();
  restoreEditorSlot(side);
  if (dualTimelineMode === 'shared') {
    time = Math.min(sharedTime, project.duration);
    playing = sharedPlaying;
    C.evaluate(rig, project, time);
  }
  syncEditorSlotUI();
}

async function createSecondEditor() {
  if (editorSlots.B) return;
  const container = document.createElement('div');
  container.id = 'editViewportB';
  container.className = 'viewport';
  container.hidden = true;
  $('viewportGrid').append(container);
  const view = makeView(container, true);
  view.projectionButton = null;
  installCameraInput(view);
  installRigPointer(view);
  installGizmoPriority(view);
  installTextureDrop(view, 'editor');
  container.addEventListener(
    'pointerdown',
    guard(() => activateEditorSlot('B')),
    true,
  );
  container.addEventListener(
    'drop',
    guard(() => activateEditorSlot('B')),
    true,
  );
  captureEditorSlot('A');
  editView = view;
  editViews = [view];
  activeEditView = view;
  onion = new O.OnionSkin(view);
  activeEditorSlot = 'B';
  try {
    const candidate = await parseAsset(sampleBytes(), 'Mixamo T-Pose.fbx');
    await install(candidate);
    captureEditorSlot('B');
  } catch (error) {
    view.renderer.dispose();
    container.remove();
    throw error;
  } finally {
    restoreEditorSlot('A');
    syncEditorSlotUI();
  }
}

async function setDualEnabled(enabled) {
  if (enabled && sceneMode)
    throw Error('Cảnh dùng viewport chung. Thoát cảnh trước khi bật hai editor riêng.');
  const wasEnabled = dualEnabled;
  if (enabled && !editorSlots.B) await createSecondEditor();
  if (!enabled && activeEditorSlot === 'B') activateEditorSlot('A');
  dualEnabled = !!enabled;
  $('dualEnabledSettings').checked = dualEnabled;
  $('dualCharacterToggle').setAttribute('aria-pressed', String(dualEnabled));
  $('dualCharacterToggle').textContent = dualEnabled ? 'Hai nhân vật: Bật' : 'Hai nhân vật: Tắt';
  $('dualTimelineToolbarLabel').hidden = !dualEnabled;
  $('dualActiveLabel').hidden = !dualEnabled;
  $('viewportLayout').disabled = dualEnabled;
  if (dualEnabled) {
    if (!wasEnabled) singleViewportLayout = $('viewportLayout').value;
    $('viewportLayout').value = 'single';
    for (const v of editorSlots.A.views.slice(1)) v.container.hidden = true;
  } else {
    if (editorSlots.B) editorSlots.B.playing = false;
    $('viewportLayout').value = singleViewportLayout;
  }
  if (editorSlots.B) editorSlots.B.view.container.hidden = !dualEnabled;
  applyViewportLayout();
  applyGroundViews();
  if (dualEnabled) syncEditorSlotUI();
  try {
    localStorage.setItem('animation-studio-settings', JSON.stringify(readSettings()));
  } catch {}
}

function setDualTimeline(value) {
  if (!['shared', 'independent'].includes(value)) throw Error('Kiểu timeline không hợp lệ.');
  dualTimelineMode = value;
  $('dualTimelineToolbar').value = value;
  $('dualTimelineModeSettings').value = value;
  if (dualEnabled && value === 'shared' && editorSlots.B) {
    captureEditorSlot();
    const other = editorSlots[activeEditorSlot === 'A' ? 'B' : 'A'];
    other.time = Math.min(time, other.project.duration);
    other.playing = playing;
    other.view.dirty = true;
  }
  try {
    localStorage.setItem('animation-studio-dual-timeline', value);
  } catch {}
  try {
    localStorage.setItem('animation-studio-settings', JSON.stringify(readSettings()));
  } catch {}
}

function tickOtherEditor(dt) {
  if (!dualEnabled || mode === 'compare' || !editorSlots.B) return;
  const active = activeEditorSlot,
    other = active === 'A' ? 'B' : 'A',
    preview = sourcePreview,
    locks = sourcePreviewLocks;
  captureEditorSlot(active);
  restoreEditorSlot(other);
  sourcePreview = null;
  sourcePreviewLocks = null;
  inactiveEditorRender = true;
  try {
    if (dualTimelineMode === 'shared') {
      time = Math.min(editorSlots[active].time, project.duration);
      playing = editorSlots[active].playing;
    } else if (playing) {
      time += dt * editorSlots[other].speed;
      const [a, b] = project.loop;
      if (time > b) {
        if (editorSlots[other].loop) time = a + ((time - a) % (b - a));
        else {
          time = b;
          playing = false;
        }
      }
    }
    C.evaluate(rig, project, time);
    editView.dirty = true;
    if (editView.container.clientWidth && editView.container.clientHeight) showView(editView);
    captureEditorSlot(other);
  } finally {
    restoreEditorSlot(active);
    sourcePreview = preview;
    sourcePreviewLocks = locks;
    inactiveEditorRender = false;
  }
}

function setupDualEditor() {
  const toolbar = document.querySelector('.stage-toolbar .row');
  toolbar.insertAdjacentHTML(
    'beforeend',
    '<button id="dualCharacterToggle" type="button" aria-pressed="false">Hai nhân vật: Tắt</button><label id="dualTimelineToolbarLabel">Timeline <select id="dualTimelineToolbar" aria-label="Timeline hai nhân vật"><option value="shared">Chung timeline</option><option value="independent">Timeline riêng</option></select></label><span id="dualActiveLabel" role="status" hidden></span>',
  );
  $('dualTimelineToolbar').hidden = true;
  $('dualTimelineToolbarLabel').hidden = true;
  $('timelineSettings').insertAdjacentHTML(
    'beforeend',
    '<label><input id="dualEnabledSettings" type="checkbox">Hai nhân vật trong Animation</label><label>Timeline hai nhân vật<select id="dualTimelineModeSettings"><option value="shared">Chung timeline</option><option value="independent">Timeline riêng</option></select></label>',
  );
  $('dualCharacterToggle').addEventListener(
    'click',
    guard(() => setDualEnabled(!dualEnabled)),
  );
  $('dualEnabledSettings').addEventListener(
    'change',
    guard(() => setDualEnabled($('dualEnabledSettings').checked)),
  );
  for (const id of ['dualTimelineToolbar', 'dualTimelineModeSettings'])
    $(id).addEventListener(
      'change',
      guard(() => setDualTimeline($(id).value)),
    );
  $('editViewport').addEventListener(
    'pointerdown',
    guard(() => activateEditorSlot('A')),
    true,
  );
  $('editViewport').addEventListener(
    'drop',
    guard(() => activateEditorSlot('A')),
    true,
  );
}

async function initializeDualEditor() {
  captureEditorSlot('A');
  if ($('dualEnabledSettings').checked) await setDualEnabled(true);
  else $('dualTimelineToolbarLabel').hidden = true;
  setDualTimeline($('dualTimelineModeSettings').value || 'shared');
}
