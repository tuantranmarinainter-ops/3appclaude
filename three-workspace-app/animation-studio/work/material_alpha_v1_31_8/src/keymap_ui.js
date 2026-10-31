// SPDX-License-Identifier: GPL-3.0-or-later
// UI component; the host routes keydown to captureKey before dispatching actions.
export function createKeymapUI({ registry, normalizeKey, save, download, setMousePreset, getMousePreset, availablePresets = [] }) {
  const root = document.createElement('section');
  root.className = 'keymap-settings';
  let capture = null;
  const element = (tag, text) => {
    const node = document.createElement(tag);
    if (text != null) node.textContent = text;
    return node;
  };
  const button = (text, click) => {
    const b = element('button', text);
    b.type = 'button'; b.addEventListener('click', click); return b;
  };
  const preset = document.createElement('select');
  for (const [value, label] of [['app3','App 3 (mặc định)'],['blockbench','Kiểu Blockbench (một phần)'],['blender','Kiểu Blender (một phần)'],['maya','Kiểu Maya (một phần)'],['cinema4d','Kiểu Cinema 4D (một phần)']]) {
    const option = element('option', label); option.value = value;
    if (value !== 'app3' && !availablePresets.includes(value)) { option.disabled = true; option.textContent += ' (chưa có)'; }
    preset.append(option);
  }
  const priority = document.createElement('select');
  for (const [value, label] of [['app3','App 3'],['preset','Bộ phím đã chọn']]) {
    const option = element('option', label); option.value = value; priority.append(option);
  }
  const search = document.createElement('input'); search.type = 'search'; search.placeholder = 'Tìm hành động hoặc phím'; search.setAttribute('aria-label', 'Tìm phím tắt');
  const only = document.createElement('input'); only.type = 'checkbox';
  const onlyLabel = element('label', ' Chỉ hiện phím trùng'); onlyLabel.prepend(only);
  const mouse = document.createElement('select');
  for (const [value, label] of [['mouse','Mặc định (chuột)'],['trackpad','Mặc định (trackpad)'],['blender','Blender'],['maya','Maya'],['cinema4d','Cinema 4D']]) {
    const option = element('option', label); option.value = value; mouse.append(option);
  }
  mouse.addEventListener('change', () => { setMousePreset?.(mouse.value); save(); });
  const state = element('p'); state.setAttribute('role', 'status'); state.setAttribute('aria-live', 'polite');
  const list = element('div');
  const labelled = (label, input) => { const l = element('label', label + ' '); l.append(input); return l; };
  const update = () => { save(); render(); };
  preset.addEventListener('change', () => {
    registry.applyPreset(preset.value);
    setMousePreset?.(['blender', 'maya', 'cinema4d'].includes(preset.value) ? preset.value : 'mouse');
    update();
  });
  priority.addEventListener('change', () => { registry.setPriority(priority.value); update(); });
  search.addEventListener('input', render); only.addEventListener('change', render);
  const file = document.createElement('input'); file.type = 'file'; file.accept = '.json,application/json';
  file.addEventListener('change', async () => {
    try {
      if (!file.files[0]) return;
      const result = registry.importJSON(await file.files[0].text());
      if (!result.ok) throw new Error(result.error);
      state.textContent = 'Đã nhập bộ phím.'; update();
    } catch (error) { state.textContent = 'Không thể nhập bộ phím: ' + error.message; }
    finally { file.value = ''; }
  });
  root.append(labelled('Bộ phím', preset), labelled('Khi trùng phím, ưu tiên', priority), search, onlyLabel,
    button('Về mặc định tất cả', () => { registry.reset(); capture = null; update(); }),
    button('Xuất bộ phím', () => download(registry.exportJSON(), 'phim-tat.json', 'application/json')),
    labelled('Nhập bộ phím', file), labelled('Điều khiển chuột khung 3D', mouse), state, list);
  function render() {
    const current = registry.getState(); preset.value = current.preset; priority.value = current.priority;
    mouse.value = getMousePreset?.() || 'mouse';
    const q = search.value.trim().toLocaleLowerCase('vi'); list.replaceChildren();
    let group = null;
    for (const row of registry.getEntries()) {
      if (only.checked && !row.conflicts.length) continue;
      if (q && ![row.label, row.id, ...row.bindings].join(' ').toLocaleLowerCase('vi').includes(q)) continue;
      if (row.group !== group) { group = row.group; list.append(element('h4', group)); }
      const line = element('div'); line.className = 'keymap-row';
      const sourceNames = { app3: 'App 3', preset: 'Bộ phím', manual: 'Tự gán' };
      const desc = element('span', row.label + ' — ' + (row.bindings.join(' / ') || 'Chưa gán') + ' (' + (row.source.map(s => sourceNames[s] || s).join(', ') || 'trống') + ')');
      if (row.conflicts.length) desc.append(' — trùng: ' + row.conflicts.map(c => c.binding).join(', '));
      line.append(desc, button('Gán phím', () => { capture = row.id; state.textContent = 'Nhấn tổ hợp phím mới; Escape để huỷ.'; }),
        button('Xoá phím', () => { registry.setBindings(row.id, []); update(); }),
        button('Về mặc định', () => { registry.reset(row.id); update(); }));
      list.append(line);
    }
  }
  function captureKey(event) {
    if (!capture) return false;
    event.preventDefault(); event.stopImmediatePropagation();
    if (event.key === 'Escape') { capture = null; state.textContent = 'Đã huỷ gán phím.'; return true; }
    const key = normalizeKey(event); if (!key) return true;
    const old = registry.getBindings(capture);
    const keys = old.includes(key) ? old : [...old.slice(-1), key];
    let result = registry.setBindings(capture, keys);
    if (!result.ok && confirm('Phím đã được dùng. Thay thế phím của hành động cũ?')) result = registry.setBindings(capture, keys, { replace: true });
    if (result.ok) { capture = null; state.textContent = 'Đã gán phím.'; update(); }
    else state.textContent = 'Đã huỷ thay thế; nhấn tổ hợp khác hoặc Escape.';
    return true;
  }
  render();
  return { root, render, captureKey };
}
