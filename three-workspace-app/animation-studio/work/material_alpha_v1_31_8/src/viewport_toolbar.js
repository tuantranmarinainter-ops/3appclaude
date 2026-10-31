export class ViewportToolbar {
  constructor(host, { changed, reset }) {
    this.host = host;
    this.changed = changed;
    this.drag = null;
    this.resize = null;
    const $ = (id) => document.getElementById(id);
    this.$ = $;
    this.panel = document.createElement('section');
    this.panel.id = 'viewportSettingsPanel';
    this.panel.className = 'easing-panel viewport-settings';
    this.panel.hidden = true;
    this.panel.setAttribute('role', 'dialog');
    this.panel.setAttribute('aria-modal', 'false');
    this.panel.setAttribute('aria-labelledby', 'viewportSettingsTitle');
    this.panel.innerHTML = `<div class="easing-header"><b id="viewportSettingsTitle">3D View · Cài đặt hiển thị</b><button data-close aria-label="Đóng cài đặt 3D">×</button></div><div class="easing-body"><small>Áp dụng chung các khung 3D. Kéo thanh tiêu đề để di chuyển.</small><div class="view-settings-grid"></div><label>Background · Màu nền<input type="color" data-source="background"></label><button data-reset>Reset Display · Khôi phục hiển thị</button><small>Không đổi model, pose, key hoặc camera.</small></div>`;
    host.append(this.panel);
    for (const [id, label] of [
      ['meshPoints', 'Show Point · Điểm'],
      ['meshLines', 'Show Line · Cạnh'],
      ['meshFaces', 'Show Face · Bề mặt'],
      ['meshFront', 'Only Front Lines · Phía trước'],
      ['meshTexture', 'Textures · Skin'],
      ['meshSmooth', 'Smooth shading · Làm mịn'],
      ['meshDoubleSided', 'Show back faces · Hai mặt'],
      ['meshOverlay', 'Lines overwrite faces · Nổi qua mesh'],
      ['viewGridXZ', 'XZ plane · Mặt đất'],
      ['viewGridXY', 'XY plane'],
      ['viewGridYZ', 'YZ plane'],
      ['viewWorldAxes', 'Axes · Trục XYZ'],
    ]) {
      const field = document.createElement('label'),
        check = document.createElement('input');
      check.type = 'checkbox';
      check.dataset.source = id;
      field.append(check, document.createTextNode(label));
      this.panel.querySelector('.view-settings-grid').append(field);
    }
    const ground = document.createElement('details');
    ground.open = true;
    ground.innerHTML =
      '<summary>Nền & mặt đất</summary><label>Kiểu mặt đất<select data-source="groundMode"><option value="grid">Lưới · Studio</option><option value="grass">Đất cỏ · Kiểu Minecraft</option><option value="plane">Plane màu · Kiểu TABS</option></select></label><label>Màu plane<input type="color" data-source="groundColor"></label><label>Độ rộng (8–512 m)<input type="range" min="8" max="512" step="1" data-source="groundSize"></label><label><input type="checkbox" data-source="groundGrid">Lưới phủ mặt đất</label><small>Mã HEX và màu gợi ý: Cài đặt → Nền & mặt đất. Chỉ hiển thị, không xuất kèm model.</small>';
    this.panel.querySelector('[data-reset]').before(ground);
    this.panel.addEventListener('change', (e) => {
      const source = $(e.target.dataset.source);
      if (!source) return;
      if (source.type === 'checkbox') source.checked = e.target.checked;
      else source.value = e.target.value;
      if (source.id === 'meshFront' && source.checked) $('meshOverlay').checked = false;
      source.dispatchEvent(new Event('change'));
    });
    this.panel.addEventListener('click', (e) => {
      if (e.target.closest('[data-close]')) this.close();
      if (e.target.closest('[data-reset]')) reset();
    });
    $('viewportSettingsBtn').addEventListener('click', () => {
      this.panel.hidden = !this.panel.hidden;
      this.sync();
    });
    for (const [button, source] of [
      ['meshPointBtn', 'meshPoints'],
      ['meshLineBtn', 'meshLines'],
      ['meshFaceBtn', 'meshFaces'],
      ['meshFrontBtn', 'meshFront'],
    ])
      $(button).addEventListener('click', () => {
        $(source).checked = !$(source).checked;
        if ($(source).checked) {
          $('showMesh').checked = true;
          if (source === 'meshFaces') $('meshTexture').checked = true;
          if (source === 'meshFront') $('meshOverlay').checked = false;
          else if (source !== 'meshFaces' && !$('meshFront').checked)
            $('meshOverlay').checked = true;
        }
        $(source).dispatchEvent(new Event('change'));
      });
    const header = this.panel.querySelector('.easing-header');
    header.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.target.closest('button')) return;
      const a = this.panel.getBoundingClientRect(),
        b = host.getBoundingClientRect();
      this.drag = {
        x: e.clientX,
        y: e.clientY,
        left: a.left - b.left,
        top: a.top - b.top,
        id: e.pointerId,
      };
      header.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    header.addEventListener('pointermove', (e) => {
      const d = this.drag;
      if (!d || d.id !== e.pointerId) return;
      this.panel.style.right = 'auto';
      this.panel.style.left =
        Math.max(0, Math.min(host.clientWidth - this.panel.offsetWidth, d.left + e.clientX - d.x)) +
        'px';
      this.panel.style.top =
        Math.max(0, Math.min(host.clientHeight - 32, d.top + e.clientY - d.y)) + 'px';
    });
    const end = () => {
      this.drag = null;
    };
    header.addEventListener('pointerup', end);
    header.addEventListener('pointercancel', end);
    header.addEventListener('lostpointercapture', end);
    this.handles = ['x', 'y'].map((axis) => {
      const h = document.createElement('div');
      h.className = 'viewport-splitter split-' + axis;
      h.dataset.axis = axis;
      h.tabIndex = 0;
      h.setAttribute('role', 'separator');
      h.setAttribute(
        'aria-label',
        axis === 'x' ? 'Đổi chiều rộng các khung 3D' : 'Đổi chiều cao các khung 3D',
      );
      h.setAttribute('aria-orientation', axis === 'x' ? 'vertical' : 'horizontal');
      h.setAttribute('aria-valuemin', '20');
      h.setAttribute('aria-valuemax', '80');
      host.append(h);
      h.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        this.resize = {
          axis,
          initial: $(axis === 'x' ? 'viewportSplitX' : 'viewportSplitY').value,
          id: e.pointerId,
        };
        h.setPointerCapture(e.pointerId);
        e.preventDefault();
        e.stopPropagation();
      });
      h.addEventListener('pointermove', (e) => {
        if (!this.resize || this.resize.id !== e.pointerId) return;
        const b = host.getBoundingClientRect();
        this.setSplit(
          axis,
          axis === 'x' ? (e.clientX - b.left) / b.width : (e.clientY - b.top) / b.height,
          false,
        );
      });
      h.addEventListener('pointerup', () => this.finish());
      h.addEventListener('pointercancel', () => this.finish(true));
      h.addEventListener('lostpointercapture', () => this.finish());
      h.addEventListener('keydown', (e) => {
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
        e.preventDefault();
        const value =
          Number($(axis === 'x' ? 'viewportSplitX' : 'viewportSplitY').value) +
          (e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1) * (e.shiftKey ? 0.01 : 0.05);
        this.setSplit(axis, value, true);
      });
      return h;
    });
    window.addEventListener(
      'keydown',
      (e) => {
        if (e.key !== 'Escape') return;
        if (this.resize) {
          e.preventDefault();
          e.stopImmediatePropagation();
          this.finish(true);
        } else if (!this.panel.hidden) {
          e.preventDefault();
          e.stopImmediatePropagation();
          this.close();
        }
      },
      { capture: true },
    );
    window.addEventListener('blur', () => this.finish());
    new ResizeObserver(() => {
      if (!this.panel.hidden) {
        this.panel.style.left =
          Math.max(
            0,
            Math.min(
              host.clientWidth - this.panel.offsetWidth,
              parseFloat(this.panel.style.left) || 0,
            ),
          ) + 'px';
        if (this.panel.style.right !== 'auto') this.panel.style.left = '';
      }
    }).observe(host);
  }
  close() {
    this.panel.hidden = true;
    this.sync();
  }
  setSplit(axis, value, persist) {
    const el = this.$(axis === 'x' ? 'viewportSplitX' : 'viewportSplitY');
    el.value = Math.max(0.2, Math.min(0.8, Number.isFinite(value) ? value : 0.5));
    this.sync();
    this.changed(persist);
  }
  finish(cancel = false) {
    if (!this.resize) return;
    const d = this.resize;
    this.resize = null;
    if (cancel) this.$(d.axis === 'x' ? 'viewportSplitX' : 'viewportSplitY').value = d.initial;
    this.sync();
    this.changed(true);
  }
  sync() {
    const $ = this.$;
    for (const [button, source] of [
      ['meshPointBtn', 'meshPoints'],
      ['meshLineBtn', 'meshLines'],
      ['meshFaceBtn', 'meshFaces'],
      ['meshFrontBtn', 'meshFront'],
    ]) {
      const enabled = $(source).checked;
      $(button).classList.toggle('active', enabled);
      $(button).setAttribute('aria-pressed', String(enabled));
    }
    for (const proxy of this.panel.querySelectorAll('[data-source]')) {
      const el = $(proxy.dataset.source);
      if (proxy.type === 'checkbox') proxy.checked = el.checked;
      else proxy.value = el.value;
      proxy.disabled = !!el.disabled;
    }
    $('viewportSettingsBtn').setAttribute('aria-expanded', String(!this.panel.hidden));
    const layout = $('viewportLayout').value;
    for (const axis of ['x', 'y']) {
      const el = $(axis === 'x' ? 'viewportSplitX' : 'viewportSplitY'),
        n = Math.max(0.2, Math.min(0.8, Number(el.value) || 0.5));
      el.value = n;
      this.host.style.setProperty('--view-split-' + axis, n * 100 + '%');
      this.handles
        ?.find((h) => h.dataset.axis === axis)
        .setAttribute('aria-valuenow', Math.round(n * 100));
    }
    for (const h of this.handles || [])
      h.hidden =
        h.dataset.axis === 'x' ? layout === 'single' : !['triple', 'quad'].includes(layout);
  }
}
