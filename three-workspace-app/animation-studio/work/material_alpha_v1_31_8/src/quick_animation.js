function setupQuickAnimation() {
  const row = document.createElement('div');
  row.className = 'studio-group quick-animation';
  row.setAttribute('role', 'group');
  row.setAttribute('aria-label', 'Chọn nhanh animation của model');
  row.innerHTML =
    '<button type="button" id="quickModelImport">Nhập model</button><label>Animation<select id="quickAnimation" aria-label="Animation có sẵn trong model"></select></label><label id="quickBobjEulerLabel" hidden>Euler BOBJ<select id="quickBobjEuler" aria-label="Thứ tự Euler clip BOBJ"><option>XYZ</option><option>YXZ</option><option>ZXY</option><option selected>ZYX</option><option>YZX</option><option>XZY</option></select></label><button type="button" id="quickUseClip">Dùng để chỉnh sửa</button><span id="quickClipStatus" role="status"></span>';
  document.querySelector('.transport').prepend(row);
  listen('quickModelImport', 'click', () => $('modelInput').click());
  listen('quickAnimation', 'change', () => {
    try {
      if ($('quickAnimation').value === 'edit') endSourcePreview();
      else previewSourceClip(Number($('quickAnimation').value));
    } catch (e) {
      syncQuickAnimation();
      throw e;
    }
  });
  listen('quickUseClip', 'click', useQuickClip);
  listen('quickBobjEuler', 'change', () => {
    if (!rig?.isBOBJ) return;
    rig.bobjEulerOrder = $('quickBobjEuler').value;
    if (sourcePreview) sourcePreview.seek(sourcePreview.time);
    dirtyViews();
  });
  for (const type of ['pointerdown', 'click', 'change', 'input'])
    document.addEventListener(
      type,
      (e) => {
        if (sourcePreview && sourcePreviewBlocked(e.target, e.target.id)) {
          e.preventDefault();
          e.stopImmediatePropagation();
        }
      },
      true,
    );
  syncQuickAnimation();
  setupFloatingAnimationList();
}

function sourcePreviewBlocked(target, id) {
  return (
    !!target &&
    (!!target.closest?.(
      '.properties,#poseSection,#boneList,#controlList,#animationArea,#transformTools,#jointLimitSettings,#motionLayerWindow',
    ) ||
      [
        'inPlaceExport',
        'clipName',
        'newQuick',
        'newBtn',
        'rootBtn',
        'rigSelect',
        'keyBtn',
        'autoKey',
        'undoBtn',
        'redoBtn',
        'saveBtn',
        'exportQuick',
        'openRigFromSettings',
      ].includes(id))
  );
}

function syncQuickAnimation() {
  if (!$('quickAnimation')) return;
  const select = $('quickAnimation');
  if (quickClipRig !== rig) {
    quickClipRig = rig;
    const clips = rig?.clips || [];
    fillOptions(
      select,
      [
        ['edit', clips.length ? 'Bài đang chỉnh' : 'Model không có animation'],
        ...clips.map((c, i) => [
          String(i),
          (c.name || 'Animation ' + (i + 1)) +
            ' · ' +
            (c.duration > 0
              ? c.duration.toFixed(2) +
                ' s' +
                (c.userData?.warcraft ? (c.userData.nonLooping ? ' · không lặp' : ' · lặp') : '')
              : 'Pose tĩnh'),
        ]),
      ],
      'edit',
    );
  }
  if (!select.options.length)
    fillOptions(select, [['edit', 'Nhập model để chọn animation']], 'edit');
  select.disabled = !rig?.clips.length;
  select.value = sourcePreview ? String(sourcePreview.index) : 'edit';
  $('quickBobjEulerLabel').hidden = !rig?.isBOBJ;
  if (rig?.isBOBJ) $('quickBobjEuler').value = rig.bobjEulerOrder || 'ZYX';
  $('quickUseClip').disabled = !sourcePreview;
  $('quickClipStatus').textContent = sourcePreview ? 'Xem clip gốc · chỉnh sửa đang khóa' : '';
  document.body.classList.toggle('source-clip-preview', !!sourcePreview);
  $('playBtn').disabled = !!sourcePreview && !sourcePreview.duration;
  window.studioAnimationList?.draw();
  $('inPlace').checked = sourcePreview ? sourcePreview.inPlace : !!project?.inPlace;
  if (sourcePreviewLocks)
    for (const [e, state] of sourcePreviewLocks)
      if (state.kind === 'disabled') e.disabled = true;
      else e.inert = true;
}

function lockSourcePreview() {
  sourcePreviewLocks = new Map();
  for (const selector of [
    '.properties',
    '#poseSection',
    '#boneList',
    '#controlList',
    '#animationArea',
    '#transformTools',
    '#jointLimitSettings',
    '#exportPanel',
  ]) {
    const e = document.querySelector(selector);
    if (e) {
      sourcePreviewLocks.set(e, { kind: 'inert', value: !!e.inert });
      e.inert = true;
    }
  }
  for (const id of [
    'inPlaceExport',
    'clipName',
    'newQuick',
    'newBtn',
    'rootBtn',
    'rigSelect',
    'keyBtn',
    'autoKey',
    'undoBtn',
    'redoBtn',
    'saveBtn',
    'exportQuick',
    'motionLayerToggle',
    'openRigFromSettings',
  ]) {
    const e = $(id);
    if (e) {
      sourcePreviewLocks.set(e, { kind: 'disabled', value: e.disabled });
      e.disabled = true;
    }
  }
  for (const v of editViews) {
    v.gizmo.detach();
    v.moveGizmo.detach();
  }
}

function previewSourceClip(index) {
  if (mode === 'compare') throw Error('Chọn clip nguồn trong workspace Animation.');
  if (!rig?.clips[index] || !Number.isInteger(index)) throw Error('Model không có animation này.');
  if (
    numericDrag ||
    motionHandDrag ||
    editViews.some((v) => v.gizmo.dragging || v.moveGizmo.dragging)
  )
    throw Error('Hoàn tất hoặc hủy thao tác kéo trước khi xem clip.');
  if (!sourcePreview) {
    if (rigDrag) cancelRigDrag();
    stopTimelineScrub();
    endTimelineKeyDrag(true);
    cancelEasingPreview();
    easingPanel?.hide();
    smoothingPanel?.hide();
    if (motionPanel) motionPanel.root.hidden = true;
    const saved = snapshot();
    sourcePreview = new ClipPreview(rig);
    sourcePreview.inPlace = !!project.inPlace;
    sourcePreview.saved = saved;
    lockSourcePreview();
  }
  try {
    playing = sourcePreview.select(index);
    if (rig.clips[index].userData?.warcraft)
      $('loop').checked = !rig.clips[index].userData.nonLooping;
  } catch (e) {
    endSourcePreview();
    throw e;
  }
  time = 0;
  lastStamp = performance.now();
  onion.hide();
  dirtyViews();
  syncQuickAnimation();
  syncTime();
  info(
    'Xem clip gốc: ' + (rig.clips[index].name || 'Animation') + '. Bài đang chỉnh được giữ riêng.',
  );
}

function seekSourceClip(value) {
  sourcePreview.seek(value);
  time = sourcePreview.time;
  dirtyViews();
  syncTime();
}

function endSourcePreview(paint = true) {
  if (!sourcePreview) return;
  const view = sourcePreview,
    saved = view.saved;
  sourcePreview = null;
  playing = false;
  view.dispose();
  time = saved.time;
  selected = saved.selected;
  draft = saved.draft;
  selectionKeys = C.clone(saved.selectionKeys || []);
  rig.activeRoot = saved.activeRoot;
  for (const [id, p] of Object.entries(saved.pose))
    C.apply(id === 'root' ? rig.root : rig.controls[id]?.object || record(rig, id)?.o, p);
  for (const [id, p] of Object.entries(saved.controls)) C.apply(rig.controls[id].object, p);
  for (const [id, m] of saved.modes) rig.chains.find((c) => c.id === id).mode = m;
  rig.root.updateMatrixWorld(true);
  if (sourcePreviewLocks)
    for (const [e, state] of sourcePreviewLocks)
      e[state.kind === 'disabled' ? 'disabled' : 'inert'] = state.value;
  sourcePreviewLocks = null;
  syncQuickAnimation();
  syncButtons();
  for (const v of editViews) configureGizmo(v);
  dirtyViews();
  if (paint) {
    select(selected);
    refresh();
    info('Đã trở lại Bài đang chỉnh; pose và frame được khôi phục.');
  }
}

function labHasContent(p) {
  const lab = p?.lab;
  if (!lab) return false;
  const hasKeys = (keys) => Object.values(keys || {}).some((a) => a.length);
  return (
    hasKeys(lab.base?.keys) ||
    hasKeys(p.keys) ||
    lab.layers.some((l) => hasKeys(l.keys)) ||
    lab.pins.length > 0 ||
    lab.markers.length > 0 ||
    lab.clips.length > 1
  );
}

function useQuickClip() {
  if (!sourcePreview) return;
  const index = sourcePreview.index,
    clip = rig.clips[index],
    length = Math.ceil(clip.duration * project.fps) / project.fps;
  if (length < 0.1 || length > 300 || Math.ceil(length * project.fps) > 9000) {
    info(
      'Clip vẫn xem được, nhưng chuyển sang chỉnh sửa cần 0.1–300 giây và tối đa 9000 mẫu.',
      true,
    );
    return;
  }
  const bank = studioBanks.lab,
    labProject =
      studioMode === 'lab'
        ? project
        : bank?.freshProject || bank?.history?.[bank.historyIndex]?.project;
  if (
    labHasContent(labProject) &&
    !confirm(
      'Thay clip nguồn trong Animation Lab? Các lớp sửa, ghim và marker hiện có sẽ được giữ và áp lên clip mới. Bạn có thể Undo sau khi thay.',
    )
  )
    return;
  endSourcePreview(false);
  switchStudioMode('lab');
  $('labSourceClip').value = String(index);
  useImportedClip();
  seek(0);
  playing = false;
  showMinimalSidebar('properties');
  syncQuickAnimation();
  syncTime();
}

function setupFloatingAnimationList() {
  const host = document.querySelector('#viewportShell'),
    panel = document.createElement('section');
  panel.id = 'floatingAnimationList';
  panel.className = 'floating-animation-list';
  panel.hidden = true;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Danh sách animation');
  panel.innerHTML =
    '<header><b>Danh sách animation</b><button type="button" aria-label="Đóng danh sách animation">×</button></header><div class="floating-animation-body"><label>Tìm clip<input type="search" placeholder="Tên animation…" aria-label="Tìm animation"></label><button type="button" data-return-edit>Bài đang chỉnh</button><div data-animation-list role="list"></div><button type="button" data-use-clip>Dùng để chỉnh sửa</button><small data-animation-status role="status"></small></div>';
  host.append(panel);
  const toggle = document.getElementById('animationListToggle'),
    list = panel.querySelector('[data-animation-list]'),
    search = panel.querySelector('input[type=search]');
  const draw = () => {
    list.replaceChildren();
    const clips = rig?.clips || [],
      query = search.value.trim().toLocaleLowerCase();
    for (let i = 0; i < clips.length; i++) {
      const clip = clips[i],
        name = clip.name || 'Animation ' + (i + 1);
      if (query && !name.toLocaleLowerCase().includes(query)) continue;
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'animation-clip-row';
      row.setAttribute('role', 'listitem');
      row.textContent =
        name + ' · ' + (clip.duration > 0 ? clip.duration.toFixed(2) + ' s' : 'Pose tĩnh');
      row.classList.toggle('active', !!sourcePreview && sourcePreview.index === i);
      row.onclick = () => {
        previewSourceClip(i);
        draw();
      };
      list.append(row);
    }
    if (!clips.length) list.textContent = 'Model không có animation.';
    panel.querySelector('[data-animation-status]').textContent = sourcePreview
      ? 'Đang xem clip gốc · bài chỉnh sửa được giữ riêng.'
      : '';
    panel.querySelector('[data-use-clip]').disabled = !sourcePreview;
  };
  const show = (on) => {
    panel.hidden = !on;
    toggle?.setAttribute('aria-expanded', String(on));
    if (on) {
      draw();
      search.focus();
    }
  };
  toggle?.addEventListener('click', () => show(panel.hidden));
  panel.querySelector('header button').onclick = () => show(false);
  panel.querySelector('[data-return-edit]').onclick = () => {
    endSourcePreview();
    draw();
  };
  panel.querySelector('[data-use-clip]').onclick = () => {
    useQuickClip();
    draw();
  };
  search.addEventListener('input', draw);
  let drag = null,
    head = panel.querySelector('header');
  head.addEventListener('pointerdown', (e) => {
    if (e.button || e.target.closest('button')) return;
    const a = panel.getBoundingClientRect(),
      b = host.getBoundingClientRect();
    drag = {
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      left: a.left - b.left,
      top: a.top - b.top,
    };
    head.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  head.addEventListener('pointermove', (e) => {
    if (!drag || drag.id !== e.pointerId) return;
    panel.style.right = 'auto';
    panel.style.left =
      Math.max(0, Math.min(host.clientWidth - panel.offsetWidth, drag.left + e.clientX - drag.x)) +
      'px';
    panel.style.top =
      Math.max(0, Math.min(host.clientHeight - 32, drag.top + e.clientY - drag.y)) + 'px';
  });
  head.addEventListener(
    'pointerup',
    (head.onpointercancel = head.onlostpointercapture = () => (drag = null)),
  );
  window.studioAnimationList = { draw };
}

function setupStudioDebug() {
  const host = document.querySelector('#viewportShell');
  if (!host) return;
  host.style.position = 'relative';
  const panel = document.createElement('section');
  panel.id = 'studioDebugPanel';
  panel.className = 'studio-debug-panel';
  panel.hidden = true;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Chẩn đoán vật liệu');
  panel.innerHTML =
    '<header><b>Debug · Vật liệu</b><button type="button" data-debug-close aria-label="Đóng bảng Debug">×</button></header><div class="studio-debug-body"><p data-debug-status>Chọn một khung 3D để xem dữ liệu.</p><div class="studio-debug-table-wrap"><table><thead><tr><th>Mesh / Material</th><th>Kênh</th><th>Ảnh nguồn</th><th>Alpha gốc / hiện tại</th><th>Trạng thái</th></tr></thead><tbody></tbody></table></div></div>';
  host.append(panel);
  let drag = null;
  const head = panel.querySelector('header');
  head.addEventListener('pointerdown', (e) => {
    if (e.button || e.target.closest('button')) return;
    const r = panel.getBoundingClientRect(),
      h = host.getBoundingClientRect();
    drag = {
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      left: r.left - h.left,
      top: r.top - h.top,
    };
    head.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  head.addEventListener('pointermove', (e) => {
    if (!drag || drag.id !== e.pointerId) return;
    const b = host.getBoundingClientRect();
    panel.style.left =
      Math.max(0, Math.min(host.clientWidth - panel.offsetWidth, drag.left + e.clientX - drag.x)) +
      'px';
    panel.style.top =
      Math.max(0, Math.min(host.clientHeight - 40, drag.top + e.clientY - drag.y)) + 'px';
  });
  head.addEventListener(
    'pointerup',
    (head.onpointercancel = head.onlostpointercapture = () => (drag = null)),
  );
  panel.addEventListener('click', (e) => {
    if (e.target.closest('[data-debug-close]')) panel.hidden = true;
  });
  const update = () => {
    const active =
      editViews?.find((v) => v.container.classList.contains('active-view')) ||
      editViews?.[0] ||
      compareA;
    renderMaterialDiagnostics(panel, active);
  };
  const syncView = (v) => {
    if (!v.debugControls) {
      v.debugView = 'shaded';
      const bar = document.createElement('div');
      bar.className = 'studio-debug-controls';
      bar.innerHTML =
        '<label>Debug <select aria-label="Chế độ debug vật liệu"><option value="shaded">Shaded</option><option value="albedo">Albedo · màu gốc</option><option value="normal">Normal</option><option value="ao">AO</option><option value="roughness">Roughness</option><option value="metalness">Metalness</option><option value="emissive">Emissive</option><option value="team">Team Color</option><option value="uv">UV · đường UV</option><option value="wire">Wireframe</option></select></label><button type="button">Chi tiết</button>';
      v.container.append(bar);
      const select = bar.querySelector('select');
      select.value = v.debugView;
      select.addEventListener('change', () => {
        v.debugView = select.value;
        v.dirty = true;
        renderMaterialDiagnostics(panel, v);
        drawUV(v);
      });
      bar.querySelector('button').addEventListener('click', () => {
        panel.hidden = false;
        renderMaterialDiagnostics(panel, v);
      });
      v.debugControls = bar;
      v.debugUV = document.createElement('canvas');
      v.debugUV.className = 'studio-debug-uv';
      v.debugUV.hidden = true;
      v.container.append(v.debugUV);
    }
    refreshDebugModes(v);
  };
  window.studioViewportSourceMaterial = (mesh) => V.sourceMaterial(mesh);
  window.studioDebug = { syncView, prepareRender, finishRender, renderMaterialDiagnostics };
}

function debugMaps(material) {
  return {
    albedo: material?.map,
    normal: material?.normalMap,
    ao: material?.aoMap,
    roughness: material?.roughnessMap,
    metalness: material?.metalnessMap,
    emissive: material?.emissiveMap,
    team: material?.userData?.studioTeamColorMap || material?.userData?.warcraftTeamColorMap,
  };
}
function debugRoleList(m) {
  const maps = debugMaps(m);
  return Object.entries(maps)
    .filter(([, map]) => map)
    .map(([role, map]) => ({ role, map }));
}
function refreshDebugModes(v) {
  const select = v.debugControls?.querySelector('select');
  if (!select) return;
  const available = new Set(['shaded', 'albedo', 'wire']);
  for (const mesh of v.rig?.mesh || []) {
    const source = window.studioViewportSourceMaterial?.(mesh) || mesh.material;
    for (const m of Array.isArray(source) ? source : [source])
      for (const [role, map] of Object.entries(debugMaps(m))) if (map) available.add(role);
    if (mesh.geometry.getAttribute('uv')) available.add('uv');
  }
  for (const option of select.options) {
    const ok = available.has(option.value);
    option.disabled = !ok;
    option.textContent =
      option.value === 'shaded'
        ? 'Shaded'
        : ({
            albedo: 'Albedo · màu gốc',
            normal: 'Normal',
            ao: 'AO',
            roughness: 'Roughness',
            metalness: 'Metalness',
            emissive: 'Emissive',
            team: 'Team Color',
            uv: 'UV · đường UV',
            wire: 'Wireframe',
          }[option.value] || option.value) + (ok ? '' : ' · không có dữ liệu');
  }
  if (select.selectedOptions[0]?.disabled) {
    select.value = 'shaded';
    v.debugView = 'shaded';
  }
  v.debugUV.hidden = v.debugView !== 'uv';
  if (v.debugView === 'uv') drawUV(v);
}
function drawUV(v) {
  const canvas = v.debugUV;
  if (!canvas || !v.rig) return;
  const w = canvas.clientWidth || 300,
    h = canvas.clientHeight || 220,
    dpr = Math.min(devicePixelRatio || 1, 2);
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  const c = canvas.getContext('2d');
  c.scale(dpr, dpr);
  c.fillStyle = '#141a21';
  c.fillRect(0, 0, w, h);
  c.strokeStyle = '#6bd0c0';
  c.lineWidth = 1;
  let triangles = 0;
  for (const mesh of v.rig.mesh || []) {
    const uv = mesh.geometry.getAttribute('uv'),
      idx = mesh.geometry.index;
    if (!uv) continue;
    c.beginPath();
    for (let i = 0; i < (idx ? idx.count : uv.count); i += 3) {
      const ids = [0, 1, 2].map((j) => (idx ? idx.getX(i + j) : i + j));
      if (ids.some((id) => id >= uv.count)) continue;
      const pts = ids.map((id) => [uv.getX(id) * w, (1 - uv.getY(id)) * h]);
      c.moveTo(...pts[0]);
      c.lineTo(...pts[1]);
      c.lineTo(...pts[2]);
      c.closePath();
      triangles++;
    }
    c.stroke();
  }
  c.fillStyle = '#d4dde5';
  c.font = '11px Segoe UI, sans-serif';
  c.fillText('UV layout · ' + triangles + ' triangles', 8, 16);
}
function renderMaterialDiagnostics(panel, v) {
  const body = panel.querySelector('tbody'),
    status = panel.querySelector('[data-debug-status]');
  body.replaceChildren();
  const r = v?.rig;
  if (!r) {
    status.textContent = 'Khung này chưa có model.';
    return;
  }
  let count = 0;
  for (const mesh of r.mesh || []) {
    const original = window.studioViewportSourceMaterial?.(mesh) || mesh.material,
      materials = Array.isArray(original) ? original : [original];
    for (const material of materials) {
      if (!material) continue;
      const maps = debugMaps(material),
        roles = [
          ['Diffuse', 'diffuse', maps.albedo],
          ['Normal', 'normal', maps.normal],
          ['AO', 'ao', maps.ao],
          ['Roughness', 'roughness', maps.roughness],
          ['Metalness', 'metalness', maps.metalness],
          ['Emissive', 'emissive', maps.emissive],
          ['Team Color', 'team', maps.team],
        ],
        wc = material.userData?.warcraftMaterial,
        alpha = wc
          ? `gốc ${Number(wc.alpha ?? 1).toFixed(2)} · hiện tại ${Number(material.opacity ?? 1).toFixed(2)}${wc.animatedAlpha ? ' · KMTA' : ''}`
          : '—';
      for (const [role, key, texture] of roles) {
        const tr = document.createElement('tr'),
          name = document.createElement('td'),
          channel = document.createElement('td'),
          file = document.createElement('td'),
          alphaCell = document.createElement('td'),
          state = document.createElement('td');
        name.textContent = (mesh.name || 'Mesh') + ' / ' + (material.name || 'Material');
        channel.textContent = role;
        const sources = material.userData?.warcraftTextureSources || {},
          requested =
            sources[key] ||
            (key === 'ao' || key === 'roughness' || key === 'metalness' ? sources.orm : '') ||
            (key === 'diffuse' ? material.userData?.studioSourceTexture : '');
        file.textContent =
          texture?.userData?.studioImage?.name || texture?.name || requested || '—';
        alphaCell.textContent = alpha;
        const staticallyHidden = wc && Number(wc.alpha) === 0 && !wc.animatedAlpha;
        state.textContent = texture
          ? staticallyHidden
            ? 'Đã nhận · lớp đang ẩn'
            : 'Đã nhận' +
              (texture.image?.width ? ' · ' + texture.image.width + '×' + texture.image.height : '')
          : requested
            ? staticallyHidden
              ? 'Thiếu nhưng đang ẩn'
              : wc?.animatedAlpha
                ? 'Thiếu và layer có thể hiện'
                : 'Đang dùng fallback · ' + requested
            : 'Không có kênh';
        state.className = texture
          ? 'debug-ok'
          : requested
            ? staticallyHidden
              ? 'debug-unsupported'
              : 'debug-missing'
            : 'debug-unsupported';
        tr.append(name, channel, file, alphaCell, state);
        body.append(tr);
        count++;
      }
    }
  }
  status.textContent = count
    ? `Khung ${v.container.getAttribute('aria-label') || v.container.id || ''} · ${count} dòng. “Không có kênh” nghĩa là model không cung cấp dữ liệu đó.`
    : 'Không tìm thấy material trong model.';
}
function prepareRender(v) {
  if (!v?.rig) return null;
  refreshDebugModes(v);
  if (!v.debugView || v.debugView === 'shaded') return null;
  const restores = [];
  for (const mesh of v.rig.mesh || []) {
    const originals = Array.isArray(mesh.material) ? mesh.material : [mesh.material],
      debug = originals.map((source) => {
        const map = debugMaps(source)[v.debugView];
        if (v.debugView === 'wire')
          return new T.MeshBasicMaterial({ color: 0x57c9bd, wireframe: true, side: T.DoubleSide });
        if (v.debugView === 'uv')
          return new T.MeshBasicMaterial({ color: 0x202832, side: T.DoubleSide });
        const m = new T.MeshBasicMaterial({ map, side: T.DoubleSide });
        m.toneMapped = false;
        return m;
      });
    restores.push([mesh, mesh.material, mesh.visible, debug]);
    if (v.debugView === 'uv') mesh.visible = false;
    else mesh.material = Array.isArray(mesh.material) ? debug : debug[0];
  }
  return restores;
}
function finishRender(restores) {
  if (!restores) return;
  for (const [mesh, originals, visible, debug] of restores) {
    mesh.material = originals;
    mesh.visible = visible;
    for (const material of debug) material.dispose();
  }
}
