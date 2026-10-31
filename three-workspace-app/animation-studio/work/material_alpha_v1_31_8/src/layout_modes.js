// SPDX-License-Identifier: GPL-3.0-or-later
// Original App 3 layout implementation; no Blockbench source, branding or icons copied.
export const LAYOUT_SETTINGS = 'animation-studio-settings';
export function initialLayout(storage) {
  try {
    const saved = JSON.parse(storage.getItem(LAYOUT_SETTINGS) || '{}');
    if (['modes', 'classic'].includes(saved.layoutMode)) return saved.layoutMode;
  } catch {
    /* A damaged settings blob must not discard an existing classic layout. */
  }
  try {
    return storage.getItem('animation-studio-layout-v2') !== null ? 'classic' : 'modes';
  } catch {
    return 'modes';
  }
}
export function initializeLayoutPreference() {
  let preferred = 'modes';
  try {
    preferred = initialLayout(window.localStorage);
  } catch {}
  document.getElementById('layoutMode').value = preferred;
  try {
    const saved = JSON.parse(localStorage.getItem(LAYOUT_SETTINGS) || '{}');
    if (typeof saved.layoutModePanels === 'string' && saved.layoutModePanels.length < 20000)
      document.getElementById('layoutModePanels').value = saved.layoutModePanels;
  } catch {
    /* Storage can be blocked. */
  }
}
export function panelState(value = {}) {
  const defaults = {
    leftOpen: true,
    rightOpen: true,
    bottomOpen: true,
    left: 260,
    right: 320,
    timeline: 240,
    drawer: '',
    tool: 'default',
    collapsed: {},
  };
  const result = { ...defaults };
  for (const key of ['leftOpen', 'rightOpen', 'bottomOpen'])
    if (typeof value?.[key] === 'boolean') result[key] = value[key];
  for (const [key, min, max] of [
    ['left', 180, 600],
    ['right', 220, 600],
    ['timeline', 80, 500],
  ])
    if (Number.isFinite(value?.[key])) result[key] = Math.max(min, Math.min(max, value[key]));
  if (['left', 'right', ''].includes(value?.drawer)) result.drawer = value.drawer;
  if (value?.tool === 'material') result.tool = 'material';
  if (value?.collapsed && typeof value.collapsed === 'object')
    for (const [key, flag] of Object.entries(value.collapsed))
      if (typeof flag === 'boolean') result.collapsed[key] = flag;
  return result;
}
export function installModeLayout({ save, workflow, invalidate, restoreClassic }) {
  const $ = (id) => document.getElementById(id),
    body = document.body;
  body.classList.add('layout-classic');
  const root = document.documentElement,
    workspace = $('createWorkspace'),
    stage = workspace.querySelector('.stage');
  const preference = $('layoutMode'),
    serialized = $('layoutModePanels');
  const fromWorkflow = { blocking: 'pose', refine: 'animate', export: 'export' };
  const toWorkflow = { pose: 'blocking', animate: 'refine', export: 'export' };
  let layout = 'classic',
    tab = 'pose',
    drawerSmall = innerWidth <= 1024,
    allowedSmall = false,
    applying = false;
  let classicVariables = {};
  let nativeOpen = new Map();
  const anchors = new Map(),
    slots = new Map(),
    originalMessage = $('pcOnlyNotice').querySelector('p').textContent;
  let settings = {};
  try {
    settings = JSON.parse(serialized.value || '{}');
  } catch {}
  const states = Object.fromEntries(
    ['pose', 'animate', 'export', 'compare'].map((name) => [name, panelState(settings[name])]),
  );
  if (['pose', 'animate', 'export'].includes(settings.active)) tab = settings.active;
  const make = (tag, id, text) => {
    const node = document.createElement(tag);
    if (id) node.id = id;
    if (text) node.textContent = text;
    return node;
  };
  const remember = (node) => {
    if (node && !anchors.has(node)) {
      const mark = document.createComment('classic-layout:' + (node.id || node.className));
      node.before(mark);
      anchors.set(node, mark);
    }
    return node;
  };
  const move = (node, target) => {
    if (node) {
      remember(node);
      target.append(node);
    }
  };
  const nav = make('nav', 'layoutModeTabs');
  nav.dataset.modeLayout = '';
  nav.setAttribute('aria-label', 'Chế độ làm việc');
  nav.setAttribute('role', 'tablist');
  const buttons = new Map();
  for (const [name, label, key] of [
    ['pose', 'Pose', '1'],
    ['animate', 'Animate', '2'],
    ['export', 'Xuất', '3'],
    ['compare', 'So sánh', ''],
  ]) {
    const button = make('button', 'layoutTab-' + name, label);
    button.type = 'button';
    button.setAttribute('role', 'tab');
    button.title = key ? label + ' · Ctrl+' + key : label;
    button.setAttribute(
      'aria-controls',
      name === 'compare' ? 'compareWorkspace' : 'createWorkspace',
    );
    button.onclick = () => selectTab(name, true);
    nav.append(button);
    buttons.set(name, button);
  }
  const paneButtons = new Map();
  for (const [kind, label] of [
    ['left', 'Cây & Pose'],
    ['right', 'Thuộc tính'],
    ['bottom', 'Timeline'],
  ]) {
    const button = make('button', 'layoutPane-' + kind, label);
    button.type = 'button';
    button.className = 'layout-pane-toggle';
    button.onclick = () => togglePane(kind);
    nav.append(button);
    paneButtons.set(kind, button);
  }
  body.querySelector('header').after(nav);
  const left = make('aside', 'layoutLeft'),
    right = make('aside', 'layoutRight');
  for (const [side, node] of [
    ['left', left],
    ['right', right],
  ]) {
    node.dataset.modeLayout = '';
    node.dataset.layoutPane = side;
    node.setAttribute(
      'aria-label',
      side === 'left' ? 'Cây xương, pose và dự án' : 'Transform, IK và xuất',
    );
  }
  workspace.prepend(left);
  workspace.append(right);
  const main = make('div', 'layoutMainTools');
  main.dataset.modeLayout = '';
  main.setAttribute('role', 'toolbar');
  main.setAttribute('aria-label', 'Công cụ chế độ hiện tại');
  const tools = make('div', 'layoutTransformTools'),
    playback = make('div', 'layoutPlaybackTools');
  const more = make('details', 'layoutMoreTools'),
    summary = make('summary', null, '…');
  summary.title = 'Công cụ khác';
  summary.setAttribute('aria-label', 'Công cụ khác');
  const overflow = make('div', 'layoutMoreContent');
  more.append(summary, overflow);
  main.append(tools, playback, more);
  stage.prepend(main);
  const material = make('button', 'layoutMaterial', 'Vật liệu / Texture');
  material.type = 'button';
  material.onclick = () => {
    states[tab].tool = 'material';
    more.open = false;
    render();
    persist();
  };
  overflow.append(material);
  const back = make('button', 'layoutDefaultTools', 'Về công cụ chế độ');
  back.type = 'button';
  back.onclick = () => {
    states[tab].tool = 'default';
    render();
    persist();
  };
  right.prepend(back);
  const slotSpecs = [
    ['project', 'Dự án & bộ xương', 'projectDetails', left, ['pose', 'animate', 'export']],
    ['rig', 'Cây xương / Điều khiển', 'treeSection', left, ['pose', 'animate']],
    ['poses', 'Thư viện pose', 'poseSection', left, ['pose', 'animate']],
    ['clipboard', 'Bộ nhớ pose', 'blockingPoseClipboard', left, ['pose', 'animate']],
    [
      'properties',
      'Transform / IK',
      workspace.querySelector('.properties'),
      right,
      ['pose', 'animate'],
    ],
    ['export', 'Xuất animation', 'exportPanel', right, ['export']],
    ['material', 'Vật liệu', 'minimalMaterial', right, []],
  ];
  for (const [id, label, target, parent, tabs] of slotSpecs) {
    const node = typeof target === 'string' ? $(target) : target;
    if (!node) continue;
    remember(node);
    const wrapper = make('details', 'layoutSlot-' + id);
    wrapper.dataset.layoutSlot = id;
    wrapper.open = !['project', 'poses', 'clipboard'].includes(id);
    const heading = make('summary', null, label);
    wrapper.append(heading);
    parent.append(wrapper);
    slots.set(id, { node, wrapper, tabs });
    wrapper.addEventListener('toggle', () => {
      if (layout === 'modes' && !applying) {
        states[tab].collapsed[id] = !wrapper.open;
        persist();
      }
    });
  }
  const stageToolbar = stage.querySelector('.stage-toolbar'),
    workflowTools = $('workflowTools');
  for (const node of [
    stageToolbar,
    workflowTools,
    $('transformTools'),
    $('restartBtn'),
    $('prevFrame'),
    $('prevKey'),
    $('playBtn'),
    $('nextKey'),
    $('nextFrame'),
  ])
    remember(node);
  const leftGrip = $('studioLeftDivider'),
    rightGrip = workspace.querySelector('[data-resize=right]');
  remember(leftGrip);
  remember(rightGrip);
  if (leftGrip) leftGrip.dataset.layoutGrip = 'left';
  if (rightGrip) rightGrip.dataset.layoutGrip = 'right';
  const backdrop = make('button', 'layoutDrawerBackdrop');
  backdrop.dataset.modeLayout = '';
  backdrop.setAttribute('aria-label', 'Đóng ngăn kéo');
  backdrop.onclick = () => {
    states[tab].drawer = '';
    render();
    persist();
  };
  workspace.append(backdrop);
  const openSmall = make('button', 'layoutOpenSmall', 'Vẫn mở');
  openSmall.type = 'button';
  openSmall.dataset.modeLayout = '';
  openSmall.onclick = () => {
    allowedSmall = true;
    phoneNotice();
    invalidate();
  };
  $('pcOnlyNotice').append(openSmall);
  function persist() {
    serialized.value = JSON.stringify({ ...states, active: tab === 'compare' ? 'pose' : tab });
    save();
  }
  function phoneNotice() {
    const small = innerWidth < 600 || innerHeight < 480;
    root.classList.toggle(
      'phone-blocked',
      layout === 'modes' ? small && !allowedSmall : !!window.studioPhoneBlocked,
    );
    $('pcOnlyNotice').querySelector('p').textContent =
      layout === 'modes'
        ? 'Màn hình quá nhỏ để xem và chỉnh keyframe cơ bản. Có thể tiếp tục bằng ngăn kéo.'
        : originalMessage;
  }
  function togglePane(kind) {
    const state = states[tab];
    if (innerWidth <= 1024 && kind !== 'bottom') state.drawer = state.drawer === kind ? '' : kind;
    else
      state[kind === 'bottom' ? 'bottomOpen' : kind + 'Open'] =
        !state[kind === 'bottom' ? 'bottomOpen' : kind + 'Open'];
    render();
    persist();
  }
  function render() {
    if (layout !== 'modes') return;
    applying = true;
    body.dataset.layoutTab = tab;
    const state = states[tab];
    body.classList.toggle('layout-left-closed', !state.leftOpen);
    body.classList.toggle('layout-right-closed', !state.rightOpen);
    body.classList.toggle('layout-bottom-closed', !state.bottomOpen);
    body.classList.toggle('layout-drawer-left', state.drawer === 'left');
    body.classList.toggle('layout-drawer-right', state.drawer === 'right');
    for (const [name, button] of buttons) {
      const active = tab === name;
      button.setAttribute('aria-selected', String(active));
      button.tabIndex = active ? 0 : -1;
      button.hidden = name === 'compare' && $('compareWorkspace').hidden && tab !== 'compare';
    }
    for (const [kind, button] of paneButtons) {
      button.hidden = tab === 'compare' || (kind === 'bottom' && tab !== 'animate');
      button.setAttribute(
        'aria-expanded',
        String(
          innerWidth <= 1024 && kind !== 'bottom'
            ? state.drawer === kind
            : state[kind === 'bottom' ? 'bottomOpen' : kind + 'Open'],
        ),
      );
    }
    for (const [id, { wrapper, tabs }] of slots) {
      wrapper.hidden =
        id === 'material'
          ? state.tool !== 'material'
          : (state.tool === 'material' && tabs.includes(tab) && wrapper.parentElement === right) ||
            !tabs.includes(tab);
      wrapper.open =
        state.collapsed[id] === undefined
          ? !['project', 'poses', 'clipboard'].includes(id)
          : !state.collapsed[id];
    }
    back.hidden = state.tool !== 'material';
    for (const [name, property] of [
      ['left', '--studio-left-width'],
      ['right', '--right-width'],
      ['timeline', '--timeline-height'],
    ])
      root.style.setProperty(property, state[name] + 'px');
    applying = false;
    phoneNotice();
    invalidate();
  }
  function selectTab(next, notify = false) {
    if (!['pose', 'animate', 'export', 'compare'].includes(next)) return;
    if (next === 'compare') {
      $('modeCompare').click();
      tab = 'compare';
    } else {
      if (!$('compareWorkspace').hidden) $('modeCreate').click();
      tab = next;
      if (notify) workflow(toWorkflow[next]);
    }
    render();
    persist();
  }
  function setLayout(next) {
    next = next === 'classic' ? 'classic' : 'modes';
    preference.value = next;
    if (next === layout) {
      render();
      return;
    }
    if (next === 'modes') {
      classicVariables = Object.fromEntries(
        ['--studio-left-width', '--right-width', '--timeline-height'].map((key) => [
          key,
          root.style.getPropertyValue(key),
        ]),
      );
      layout = next;
      body.classList.add('layout-modes');
      body.classList.remove('layout-classic');
      for (const { node, wrapper } of slots.values()) move(node, wrapper);
      nativeOpen = new Map(
        ['projectDetails', 'poseLibrary', 'exportPanel'].map((id) => [$(id), $(id).open]),
      );
      for (const node of nativeOpen.keys()) node.open = true;
      move(stageToolbar, overflow);
      move(workflowTools, overflow);
      move($('transformTools'), tools);
      for (const id of ['restartBtn', 'prevFrame', 'prevKey', 'playBtn', 'nextKey', 'nextFrame'])
        move($(id), playback);
      if (leftGrip) {
        move(leftGrip, workspace);
        leftGrip.style.gridColumn = '2';
      }
      if (rightGrip) {
        move(rightGrip, workspace);
        rightGrip.style.gridColumn = '4';
      }
      if (!$('compareWorkspace').hidden) tab = 'compare';
      render();
    } else {
      layout = next;
      body.classList.remove(
        'layout-modes',
        'layout-left-closed',
        'layout-right-closed',
        'layout-bottom-closed',
        'layout-drawer-left',
        'layout-drawer-right',
      );
      body.classList.add('layout-classic');
      for (const [node, anchor] of [...anchors].reverse()) anchor.after(node);
      for (const [node, open] of nativeOpen) node.open = open;
      if (leftGrip) leftGrip.style.removeProperty('grid-column');
      if (rightGrip) rightGrip.style.removeProperty('grid-column');
      for (const [key, value] of Object.entries(classicVariables)) {
        if (value) root.style.setProperty(key, value);
        else root.style.removeProperty(key);
      }
      restoreClassic();
      phoneNotice();
      invalidate();
    }
    persist();
  }
  preference.addEventListener('change', () => setLayout(preference.value));
  document.addEventListener(
    'keydown',
    (event) => {
      if (
        layout !== 'modes' ||
        !event.ctrlKey ||
        event.altKey ||
        event.metaKey ||
        event.shiftKey ||
        !['1', '2', '3'].includes(event.key) ||
        event.target.closest('input,textarea,select,[contenteditable=true]') ||
        document.querySelector('dialog[open]')
      )
        return;
      event.preventDefault();
      event.stopImmediatePropagation();
      selectTab(['pose', 'animate', 'export'][Number(event.key) - 1], true);
    },
    true,
  );
  $('toggleTimeline').addEventListener(
    'click',
    (event) => {
      if (layout === 'modes') {
        event.stopImmediatePropagation();
        togglePane('bottom');
      }
    },
    true,
  );
  new MutationObserver(() => {
    if (layout !== 'modes') return;
    const compare = !$('compareWorkspace').hidden;
    if (compare && tab !== 'compare') {
      tab = 'compare';
      render();
    } else if (!compare && tab === 'compare') {
      tab = fromWorkflow[body.dataset.workflowStep] || 'pose';
      render();
    }
  }).observe($('compareWorkspace'), { attributes: true, attributeFilter: ['hidden'] });
  new MutationObserver(() => {
    if (layout === 'modes' && $('compareWorkspace').hidden) {
      const next = fromWorkflow[body.dataset.workflowStep];
      if (next && next !== tab) {
        tab = next;
        render();
        persist();
      }
    }
  }).observe(body, { attributes: true, attributeFilter: ['data-workflow-step'] });
  new MutationObserver(() => {
    if (layout !== 'modes' || applying) return;
    let changed = false;
    for (const [name, key] of [
      ['left', '--studio-left-width'],
      ['right', '--right-width'],
      ['timeline', '--timeline-height'],
    ]) {
      const value = parseFloat(root.style.getPropertyValue(key));
      if (Number.isFinite(value) && Math.abs(states[tab][name] - value) > 0.1) {
        states[tab][name] = value;
        changed = true;
      }
    }
    if (changed) persist();
  }).observe(root, { attributes: true, attributeFilter: ['style'] });
  window.addEventListener('resize', () => {
    const small = innerWidth <= 1024;
    if (small !== drawerSmall) {
      drawerSmall = small;
      states[tab].drawer = '';
    }
    phoneNotice();
    if (layout === 'modes') render();
  });
  setLayout(preference.value);
  return {
    setLayout,
    selectTab,
    get layout() {
      return layout;
    },
    get tab() {
      return tab;
    },
    acceptSettings() {
      try {
        const value = JSON.parse(serialized.value || '{}');
        for (const key of Object.keys(states)) states[key] = panelState(value[key]);
      } catch {}
      setLayout(preference.value);
    },
  };
}
