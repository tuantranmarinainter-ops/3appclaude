import { registerWidgetKey } from './shortcut_context.js';
import * as E from './easing.js';
const pathFor = (id, strength) =>
  Array.from({ length: 65 }, (_, i) => {
    const u = i / 64,
      y = E.progress(u, { interp: id, easingStrength: strength });
    return (i ? 'L' : 'M') + (8 + u * 100).toFixed(2) + ' ' + (51 - y * 34).toFixed(2);
  }).join(' ');
export class EasingPanel {
  constructor(host, { state, action }) {
    this.state = state;
    this.action = action;
    this.choice = 'linear';
    this.strength = 1;
    this.scope = 'selection';
    this.animated = 'linear';
    this.raf = 0;
    this.root = document.createElement('section');
    this.root.id = 'easingPanel';
    this.root.className = 'easing-panel';
    this.root.hidden = true;
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-modal', 'false');
    this.root.setAttribute('aria-labelledby', 'easingTitle');
    this.root.innerHTML = `<div class="easing-header"><b id="easingTitle">Easing · Transition Curve Presets</b><button type="button" data-action="close" aria-label="Đóng easing">×</button></div><div class="easing-body"><p>Chọn mẫu để xem trước trên nhân vật. Chỉ Áp dụng mới thay key.</p><div class="easing-controls"><label>Phạm vi<select id="easingScope"><option value="selection">Key đã chọn</option><option value="body">Toàn thân tại các key chọn</option></select></label><button type="button" data-action="current">Chọn key ở frame hiện tại</button></div><div class="easing-grid">${E.presets.map((p) => `<button type="button" class="easing-card" data-preset="${p.id}" aria-pressed="false" title="${p.description}"><svg viewBox="0 0 116 62" aria-hidden="true"><path class="easing-axis" d="M8 8 V51 H108"/><path class="easing-linear" d="M8 51 L108 17"/><path class="easing-curve"/><circle class="easing-dot" cx="8" cy="51" r="3"/></svg><b>${p.name}</b><small>${p.description}</small></button>`).join('')}</div><label class="easing-strength">Strength<input id="easingPanelStrength" type="range" min="0" max="100" step="1" value="100"><input id="easingPanelStrengthValue" type="number" min="0" max="100" value="100" step="1" aria-label="Strength phần trăm"></label><small>0% = Linear · 100% = mẫu đầy đủ. Back/Elastic có thể vượt đích; Scale và IK vẫn giữ giới hạn hợp lệ.</small><div id="easingStatus" role="status"></div></div><div class="easing-footer"><button type="button" data-action="preview">Phát preview</button><button type="button" data-action="apply">Áp dụng</button><button type="button" data-action="cancel">Hủy preview</button></div>`;
    host.append(this.root);
    this.root.addEventListener('click', (e) => {
      const card = e.target.closest('[data-preset]');
      if (card) {
        this.choice = card.dataset.preset;
        this.animated = this.choice;
        this.sync();
        this.action('preview', this.args());
        return;
      }
      const button = e.target.closest('[data-action]');
      if (button) this.action(button.dataset.action, this.args());
    });
    this.root.querySelector('#easingScope').addEventListener('change', (e) => {
      this.scope = e.target.value;
      this.action('cancel', this.args());
      this.sync();
    });
    for (const id of ['easingPanelStrength', 'easingPanelStrengthValue'])
      this.root.querySelector('#' + id).addEventListener('input', (e) => {
        const n = Number(e.target.value);
        if (e.target.value.trim() === '' || !Number.isFinite(n) || n < 0 || n > 100) return;
        this.strength = n / 100;
        this.sync();
      });
    for (const id of ['easingPanelStrength', 'easingPanelStrengthValue'])
      this.root
        .querySelector('#' + id)
        .addEventListener('change', () => this.action('preview', this.args()));
    this.root.addEventListener('pointerover', (e) => {
      const card = e.target.closest('[data-preset]');
      if (card) this.animated = card.dataset.preset;
    });
    registerWidgetKey(this.root, (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this.action('close', this.args());
      }
    });
  }
  args() {
    return { interp: this.choice, strength: this.strength, scope: this.scope };
  }
  open(interp, strength) {
    this.choice = E.presets.some((p) => p.id === interp) ? interp : 'linear';
    this.strength = Number.isFinite(strength) ? strength : 1;
    this.root.hidden = false;
    this.sync();
    this.root.querySelector('[data-preset="' + this.choice + '"]').focus({ preventScroll: true });
    cancelAnimationFrame(this.raf);
    this.tick();
  }
  hide() {
    this.root.hidden = true;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }
  tick() {
    if (this.root.hidden) return;
    const card = this.root.querySelector('[data-preset="' + this.animated + '"]'),
      u = (performance.now() % 1800) / 1800;
    card?.querySelector('.easing-dot').setAttribute('cx', 8 + u * 100);
    card
      ?.querySelector('.easing-dot')
      .setAttribute(
        'cy',
        51 - E.progress(u, { interp: this.animated, easingStrength: this.strength }) * 34,
      );
    this.raf = requestAnimationFrame(() => this.tick());
  }
  sync() {
    if (this.root.hidden) return;
    const state = this.state(this.scope);
    this.root.querySelectorAll('[data-preset]').forEach((card) => {
      card.setAttribute('aria-pressed', String(card.dataset.preset === this.choice));
      card
        .querySelector('.easing-curve')
        .setAttribute('d', pathFor(card.dataset.preset, this.strength));
    });
    this.root.querySelector('#easingPanelStrength').value = Math.round(this.strength * 100);
    this.root.querySelector('#easingPanelStrengthValue').value = Math.round(this.strength * 100);
    this.root.querySelector('#easingStatus').textContent =
      state.message ||
      `${state.count} kênh key chọn · ${state.preview ? 'Đang preview, chưa lưu' : 'Chưa thay đổi key'}`;
    this.root.querySelector('[data-action=apply]').disabled = !state.count;
  }
}
