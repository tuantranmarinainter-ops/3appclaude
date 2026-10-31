// SPDX-License-Identifier: GPL-3.0-or-later
import * as Keymap from './keymap.js';
import { PRESETS } from './keymaps/presets.js';
export function installKeymapSettings({ mouseChanged }) {
  const $ = (id) => document.getElementById(id),
    root = $('keymapSettings');
  const make = (tag, text) => {
    const node = document.createElement(tag);
    if (text) node.textContent = text;
    return node;
  };
  const button = (text, fn) => {
    const b = make('button', text);
    b.type = 'button';
    b.onclick = fn;
    return b;
  };
  const presets = make('select');
  presets.id = 'keymapPreset';
  presets.setAttribute('aria-label', 'Bộ phím');
  for (const [id, label] of [
    ['app3', 'App 3 (mặc định)'],
    ['blockbench', 'Kiểu Blockbench'],
    ['blender', 'Kiểu Blender'],
    ['maya', 'Kiểu Maya'],
    ['cinema4d', 'Kiểu Cinema 4D'],
  ])
    presets.add(new Option(label, id));
  const priority = make('select');
  priority.id = 'keymapPriority';
  priority.setAttribute('aria-label', 'Khi trùng phím, ưu tiên');
  priority.add(new Option('App 3', 'app3'));
  priority.add(new Option('Bộ phím đã chọn', 'preset'));
  const mouse = make('select');
  mouse.id = 'keymapMouse';
  mouse.setAttribute('aria-label', 'Điều khiển chuột');
  for (const [id, label] of [
    ['default', 'Mặc định (chuột)'],
    ['trackpad', 'Mặc định (trackpad)'],
    ['blender', 'Blender'],
    ['maya', 'Maya'],
    ['cinema4d', 'Cinema 4D'],
  ])
    mouse.add(new Option(label, id));
  for (const [label, select] of [
    ['Bộ phím', presets],
    ['Khi trùng phím, ưu tiên', priority],
    ['Điều khiển chuột', mouse],
  ]) {
    const field = make('label', label);
    field.className = 'field';
    field.append(select);
    root.append(field);
  }
  const status = make('p');
  status.id = 'keymapStatus';
  status.setAttribute('role', 'status');
  root.append(status);
  const search = make('input');
  search.type = 'search';
  search.id = 'keymapSearch';
  search.placeholder = 'Tìm tên hành động hoặc tổ hợp phím';
  search.setAttribute('aria-label', 'Tìm phím tắt');
  root.append(search);
  const only = make('input');
  only.type = 'checkbox';
  only.id = 'keymapConflictsOnly';
  const onlyLabel = make('label', 'Chỉ hiện phím trùng');
  onlyLabel.prepend(only);
  root.append(onlyLabel);
  const toolbar = make('div');
  toolbar.className = 'row';
  root.append(toolbar);
  toolbar.append(
    button('Về mặc định tất cả', () => {
      Keymap.reset();
      applyMouse();
    }),
  );
  toolbar.append(
    button('Xuất bộ phím', () => {
      const blob = new Blob([JSON.stringify(Keymap.exportState(), null, 2)], {
          type: 'application/json',
        }),
        url = URL.createObjectURL(blob),
        a = make('a');
      a.href = url;
      a.download = 'animation-studio-keymap.json';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }),
  );
  const file = make('input');
  file.type = 'file';
  file.accept = '.json';
  file.id = 'keymapImport';
  file.hidden = true;
  file.onchange = async () => {
    try {
      if (file.files[0]) {
        Keymap.load(JSON.parse(await file.files[0].text()));
        applyMouse();
        status.textContent = 'Đã nhập bộ phím.';
      }
    } catch (e) {
      status.textContent = e.message;
    } finally {
      file.value = '';
    }
  };
  toolbar.append(
    button('Nhập bộ phím', () => file.click()),
    file,
  );
  const pending = make('div');
  pending.id = 'keymapConflict';
  pending.hidden = true;
  pending.setAttribute('role', 'alert');
  root.append(pending);
  const table = make('table');
  table.id = 'keymapTable';
  table.innerHTML =
    '<thead><tr><th>Hành động</th><th>Phím</th><th>Nguồn / trùng</th><th>Đặt lại</th></tr></thead>';
  const body = make('tbody');
  table.append(body);
  root.append(table);
  let active = null;
  function endCapture() {
    active = null;
    Keymap.setCapture(null);
  }
  function beginCapture(id, index) {
    endCapture();
    active = { id, index };
    status.textContent = 'Nhấn tổ hợp phím mới · Esc để huỷ';
    Keymap.setCapture((key, event) => {
      if (event.key === 'Escape') {
        endCapture();
        status.textContent = 'Đã huỷ.';
        return;
      }
      if (!key) return;
      try {
        const used = Keymap.assign(id, key, index);
        endCapture();
        if (!used.length) {
          status.textContent = 'Đã gán ' + key;
          return;
        }
        pending.replaceChildren(
          make('p', 'Phím ' + key + ' bị trùng: ' + used.map((a) => a.name).join(', ')),
        );
        pending.append(
          button('Thay thế', () => {
            Keymap.assign(id, key, index, true);
            pending.hidden = true;
            status.textContent = 'Đã thay thế.';
          }),
          button('Huỷ', () => {
            pending.hidden = true;
            status.textContent = 'Đã huỷ, giữ nguyên bộ phím.';
          }),
        );
        pending.hidden = false;
      } catch (e) {
        endCapture();
        status.textContent = e.message;
      }
    });
  }
  const titles = new WeakMap();
  function render() {
    presets.value = Keymap.state.preset;
    priority.value = Keymap.state.priority;
    mouse.value = Keymap.state.mouse;
    if (!active)
      status.textContent = Object.keys(Keymap.state.custom).length
        ? 'Tuỳ chỉnh · ' + presets.selectedOptions[0].text
        : 'Bộ phím: ' + presets.selectedOptions[0].text;
    const query = search.value.trim().toLocaleLowerCase();
    body.replaceChildren();
    let group = '';
    for (const a of [...Keymap.actions.values()].sort(
      (a, b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name),
    )) {
      const keys = Keymap.keysFor(a.id),
        conflict = Keymap.conflictFor(a.id);
      for (const node of document.querySelectorAll(
        a.selector || '[data-keymap-action="' + a.id + '"]',
      )) {
        if (!titles.has(node)) titles.set(node, a.name);
        node.title =
          titles.get(node) + (keys.length ? ' · ' + keys.join(' / ') : ' · Chưa gán phím');
        if (node.getAttribute('role') === 'menuitem') {
          let kbd = node.querySelector('kbd');
          if (!kbd) {
            kbd = make('kbd');
            kbd.setAttribute('aria-hidden', 'true');
            node.append(kbd);
          }
          kbd.textContent = keys.join(' / ');
        }
      }
      if (only.checked && !conflict.length) continue;
      if (query && ![a.name, a.group, ...keys].join(' ').toLocaleLowerCase().includes(query))
        continue;
      if (group !== a.group) {
        group = a.group;
        const row = make('tr'),
          cell = make('th', group);
        cell.colSpan = 4;
        row.append(cell);
        body.append(row);
      }
      const row = make('tr');
      row.dataset.keymapAction = a.id;
      const name = make('td', a.name);
      name.tabIndex = 0;
      name.onclick = () => beginCapture(a.id, 0);
      row.append(name);
      const cells = make('td');
      for (let i = 0; i < 2; i++)
        cells.append(button(keys[i] || '+ Gán phím', () => beginCapture(a.id, i)));
      row.append(cells);
      row.append(
        make(
          'td',
          (keys.length
            ? keys.map((key) => key + ': ' + Keymap.sourceFor(a.id, key)).join(' · ')
            : Keymap.sourceFor(a.id)) + (conflict.length ? ' · Trùng: ' + conflict.join(', ') : ''),
        ),
      );
      const controls = make('td');
      controls.append(
        button('Xoá phím', () => Keymap.clear(a.id)),
        button('Về mặc định', () => Keymap.reset(a.id)),
      );
      row.append(controls);
      body.append(row);
    }
  }
  function applyMouse() {
    mouseChanged(Keymap.state.mouse, PRESETS[Keymap.state.mouse]?.mouse);
  }
  presets.onchange = () => {
    Keymap.setPreference('preset', presets.value);
    if (['blender', 'maya', 'cinema4d'].includes(presets.value))
      Keymap.setPreference('mouse', presets.value);
    applyMouse();
  };
  priority.onchange = () => Keymap.setPreference('priority', priority.value);
  mouse.onchange = () => {
    Keymap.setPreference('mouse', mouse.value);
    applyMouse();
  };
  search.oninput = render;
  only.onchange = render;
  Keymap.subscribe(render);
  render();
  // Native dialog Escape still closes it; also release capture without swallowing later shortcuts.
  $('settings').addEventListener('close', () => {
    endCapture();
    pending.hidden = true;
  });
  return { render, applyMouse };
}
