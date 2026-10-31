import { evaluateMolang } from './molang.js';
import * as Keymap from './keymap.js';

// Molang controls are mounted inside the shared key editor in both layouts.
export function installMolangPanel(host, actions) {
  const panel = document.createElement('details');
  panel.id = 'molangPanel';
  panel.className = 'molang-panel';
  panel.innerHTML = `<summary>Molang · Biểu thức keyframe</summary>
    <div class="molang-controls"><small id="molangSelection">Chọn một key của khớp để sửa biểu thức.</small>
      <div id="molangAxes" class="molang-axes" aria-label="Giá trị keyframe theo trục"></div>
      <label>Thành phần <select id="molangChannel"><option value="p0">Vị trí X</option><option value="p1">Vị trí Y</option><option value="p2">Vị trí Z</option><option value="r0">Xoay X (độ)</option><option value="r1">Xoay Y (độ)</option><option value="r2">Xoay Z (độ)</option><option value="s0">Tỉ lệ X</option><option value="s1">Tỉ lệ Y</option><option value="s2">Tỉ lệ Z</option></select></label>
      <label>Biểu thức <input id="molangExpression" type="text" spellcheck="false" placeholder="math.sin(query.anim_time * 90)"></label>
      <button id="molangApply" type="button">Áp dụng</button><output id="molangError" role="status" aria-live="polite"></output>
      <small>Dùng query.anim_time và variable.tên. Để trống để xóa biểu thức.</small>
      <strong>Biến xem trước</strong><div id="molangVariables"></div>
      <div class="molang-add"><label>Tên biến <input id="molangVariableName" type="text" placeholder="speed" spellcheck="false"></label><button id="molangAddVariable" type="button">Thêm biến</button></div>
      <button id="molangBake" type="button">Chuyển biểu thức thành keyframe</button>
    </div>`;
  host.append(panel);
  const $ = id => panel.querySelector('#' + id);
  let selectedSignature = '', variablesSignature = '';
  for (const [path, label] of [['p','Vị trí'], ['r','Xoay (độ)'], ['s','Tỉ lệ']]) {
    for (const [axis, axisLabel] of ['X','Y','Z'].entries()) {
      const field = document.createElement('label'); field.textContent = `${label} ${axisLabel}`;
      const input = document.createElement('input'); input.type = 'text'; input.spellcheck = false;
      input.id = `molang-${path}${axis}`; input.dataset.channel = path + axis;
      input.addEventListener('change', () => { const value = input.value; const result = actions.apply(input.dataset.channel, value); sync(true); if (result?.error) input.value = value; input.setAttribute('aria-invalid', result?.error ? 'true' : 'false'); $('molangError').textContent = result?.error || 'Đã cập nhật giá trị key.'; });
      Keymap.on(input, 'app.4', e => { if (e.key === 'Enter') { e.preventDefault(); input.blur(); } });
      field.append(input); $('molangAxes').append(field);
    }
  }
  function sync(force = false) {
    const state = actions.state();
    const ref = state.ref;
    const signature = ref ? `${ref.id}:${ref.time}:${$('molangChannel').value}:${ref.key.molang?.[$('molangChannel').value] || ''}` : '';
    if (force || signature !== selectedSignature) {
      selectedSignature = signature;
      $('molangSelection').textContent = ref ? `Key ${ref.id} · ${ref.time.toFixed(3)} giây` : 'Chọn một key của khớp để sửa biểu thức.';
      $('molangExpression').value = ref?.key?.molang?.[$('molangChannel').value] || '';
      $('molangError').textContent = '';
    }
    for (const input of $('molangAxes').querySelectorAll('input')) {
      input.disabled = !ref || state.readOnly;
      const expression = ref?.key?.molang?.[input.dataset.channel];
      const error = expression && evaluateMolang(expression, { anim_time: ref.time, life_time: ref.time, variables: state.variables }).error;
      input.setAttribute('aria-invalid', error ? 'true' : 'false');
      if (document.activeElement !== input) {
        const channel = input.dataset.channel;
        const value = ref?.key?.molang?.[channel] ?? ref?.values?.[channel];
        input.value = value === undefined ? '' : String(typeof value === 'number' ? +value.toFixed(5) : value);
      }
    }
    const currentExpression = ref?.key?.molang?.[$('molangChannel').value];
    const currentError = currentExpression && evaluateMolang(currentExpression, { anim_time: ref.time, life_time: ref.time, variables: state.variables }).error;
    $('molangExpression').setAttribute('aria-invalid', currentError ? 'true' : 'false');
    $('molangApply').disabled = !ref || state.readOnly;
    $('molangExpression').disabled = !ref || state.readOnly;
    $('molangBake').disabled = state.readOnly || !state.hasExpressions;
    const vars = state.variables || {};
    const next = JSON.stringify(vars);
    if (force || next !== variablesSignature) {
      variablesSignature = next;
      const list = $('molangVariables');
      list.replaceChildren();
      for (const [name, value] of Object.entries(vars).sort(([a],[b]) => a.localeCompare(b))) {
        const row = document.createElement('div'); row.className = 'molang-variable';
        const label = document.createElement('label'); label.textContent = `variable.${name}`;
        const slider = document.createElement('input'); slider.type = 'range'; slider.min = String(Math.min(-10, value)); slider.max = String(Math.max(10, value)); slider.step = '0.01'; slider.value = String(value); slider.disabled = state.readOnly; slider.setAttribute('aria-label', `Giá trị ${name}`);
        const number = document.createElement('input'); number.type = 'number'; number.step = 'any'; number.value = String(value); number.disabled = state.readOnly; number.setAttribute('aria-label', `Số ${name}`);
        const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'Xóa'; remove.disabled = state.readOnly; remove.setAttribute('aria-label', `Xóa biến ${name}`);
        slider.addEventListener('input', () => { number.value = slider.value; actions.previewVariable(name, Number(slider.value)); variablesSignature = JSON.stringify(actions.state().variables || {}); });
        slider.addEventListener('change', () => { actions.setVariable(name, Number(slider.value)); sync(true); });
        number.addEventListener('change', () => { const v = Number(number.value); if (Number.isFinite(v)) actions.setVariable(name, v); sync(true); });
        remove.addEventListener('click', () => { actions.removeVariable(name); sync(true); });
        row.append(label, slider, number, remove); list.append(row);
      }
    }
    $('molangAddVariable').disabled = state.readOnly;
    $('molangVariableName').disabled = state.readOnly;
  }
  $('molangChannel').addEventListener('change', () => sync(true));
  $('molangApply').addEventListener('click', () => { const result = actions.apply($('molangChannel').value, $('molangExpression').value); $('molangExpression').setAttribute('aria-invalid', result?.error ? 'true' : 'false'); $('molangError').textContent = result?.error || 'Đã cập nhật biểu thức.'; selectedSignature = '';  });
  Keymap.on($('molangExpression'), 'app.4', e => { if (e.key === 'Enter') { e.preventDefault(); $('molangApply').click(); } });
  $('molangAddVariable').addEventListener('click', () => { const error = actions.addVariable($('molangVariableName').value.trim()); $('molangError').textContent = error || ''; if (!error) { $('molangVariableName').value = ''; sync(true); } });
  $('molangBake').addEventListener('click', () => { const error = actions.bake(); $('molangError').textContent = error || 'Đã bake biểu thức thành key số.'; sync(); });
  return { root: panel, sync };
}
