import * as G from './graph_curves.js';
const colors = ['#ee9292', '#8ae0aa', '#8eafff'],
  names = ['X', 'Y', 'Z'];
export class GraphEditor {
  constructor(host, { state, action }) {
    this.host = host;
    this.state = state;
    this.action = (...a) => {
      try {
        return action(...a);
      } catch (e) {
        this.message(e.message);
        return false;
      }
    };
    this.times = [];
    this.axis = 0;
    this.path = 'r';
    this.visible = [true, true, true];
    this.box = null;
    this.drag = null;
    this.pending = null;
    this.view = null;
    host.querySelector('.graphbar').innerHTML =
      `<label>Đường cong<select id="graphPath"><option value="rotation">Rotation · Euler XYZ (độ)</option><option value="position">Position · Local</option><option value="scale">Scale · %</option></select></label><span id="graphAxes">${names.map((n, i) => `<button data-axis="${i}" aria-pressed="${i === 0}" style="color:${colors[i]}">${n}</button><label title="Hiện ${n}"><input data-visible="${i}" type="checkbox" checked></label>`).join('')}</span><select id="graphUnit" aria-label="Đơn vị thời gian"><option value="frame">Frame</option><option value="tick">Tick · 20/s</option></select><label><input id="graphSnap" type="checkbox" checked>Snap</label><button id="graphFit">Fit All</button><button id="graphFitSelection">Fit Selection</button><button id="graphHide">Ẩn Graph</button>`;
    this.canvas = host.querySelector('canvas');
    this.canvas.tabIndex = 0;
    this.canvas.setAttribute(
      'aria-label',
      'Đường cong. Chuột trái kéo key, Ctrl chọn nhiều, Shift khóa hướng, chuột giữa pan.',
    );
    const footer = document.createElement('div');
    footer.className = 'graph-editbar';
    footer.innerHTML = `<label>Thời điểm<input id="graphTime" type="number" step="1"></label><label>Giá trị<input id="graphValue" type="number" step="any"></label><button id="graphApplyValue">Đặt key</button><select id="graphSide" aria-label="Phía tiếp tuyến"><option value="both">Both · hai phía</option><option value="in">In · đi vào</option><option value="out">Out · đi ra</option></select><div id="graphTangents"></div><button id="graphConvert">Tạo Euler curves</button><span id="graphPreviewButtons" hidden><button id="graphOriginal">Xem gốc</button><button id="graphProcessed">Xem xử lý</button><button id="graphAccept">Áp dụng</button><button id="graphCancel">Hủy</button></span><small id="graphMessage" role="status"></small>`;
    host.append(footer);
    const descriptions = [
      ['linear', 'Linear | Tuyến tính'],
      ['step', 'Step | Giữ giá trị'],
      ['auto', 'Auto | Tự động'],
      ['smooth', 'Smooth | Mượt'],
      ['spline', 'Spline | Tùy chỉnh'],
      ['break', 'Break | Tách'],
      ['unify', 'Unify | Liên kết'],
    ];
    host.querySelector('#graphTangents').innerHTML = descriptions
      .map(
        ([type, label]) =>
          `<button data-tangent="${type}" title="${label}"><svg viewBox="0 0 40 20" width="40" height="20" aria-hidden="true"><path fill="none" stroke="currentColor" d="${type === 'step' ? 'M2 18H35V2' : type === 'linear' ? 'M2 18L38 2' : type === 'break' ? 'M2 18L20 10L38 14' : 'M2 18C20 18 20 2 38 2'}"/></svg>${label}</button>`,
      )
      .join('');
    host.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.axis !== undefined) {
        this.axis = +b.dataset.axis;
        this.draw();
      }
      if (b.dataset.tangent) {
        if (!this.editable()) return;
        const s = this.state(),
          keys = structuredClone(s.keys),
          indices = this.indices(keys);
        if (!indices.length) return this.message('Chọn key trước khi đặt tiếp tuyến.');
        G.tangent(
          keys,
          indices,
          this.path,
          this.axis,
          b.dataset.tangent,
          host.querySelector('#graphSide').value,
        );
        this.action('commit', keys);
        this.draw();
      }
    });
    host.addEventListener('change', (e) => {
      if (e.target.id === 'graphPath') {
        this.path = { rotation: 'r', position: 'p', scale: 's' }[e.target.value];
        this.times = [];
        this.view = null;
      }
      if (e.target.dataset.visible !== undefined) {
        this.visible[+e.target.dataset.visible] = e.target.checked;
        this.view = null;
      }
      this.draw();
    });
    const on = (id, fn) => host.querySelector('#' + id).addEventListener('click', fn);
    on('graphFit', () => {
      this.view = null;
      this.draw();
    });
    on('graphFitSelection', () => this.fitSelection());
    on('graphHide', () => {
      host.open = false;
    });
    on('graphConvert', () => {
      const s = this.state();
      if (s.blocked) return this.message(s.blocked);
      this.action('convert');
      this.draw();
    });
    for (const [id, a] of [
      ['graphOriginal', 'original'],
      ['graphProcessed', 'processed'],
      ['graphAccept', 'accept'],
      ['graphCancel', 'cancel'],
    ])
      on(id, () => {
        this.action(a);
        this.draw();
      });
    on('graphApplyValue', () => {
      if (!this.editable()) return;
      if (!this.times.length) return this.message('Chọn key trước.');
      const s = this.state(),
        t = Number(host.querySelector('#graphTime').value) / this.rate(),
        v = Number(host.querySelector('#graphValue').value) / this.factor();
      if (
        !host.querySelector('#graphTime').value.trim() ||
        !host.querySelector('#graphValue').value.trim() ||
        !Number.isFinite(v) ||
        !Number.isFinite(t)
      )
        return this.message('Nhập thời điểm và giá trị hợp lệ.');
      this.applyEdit({
        dt: t - Math.min(...this.times),
        dv:
          v -
          G.value(
            s.keys.find((k) => k.time === this.times[0]),
            this.path,
            this.axis,
          ),
      });
    });
    this.canvas.addEventListener('pointerdown', (e) => this.down(e));
    this.canvas.addEventListener('pointermove', (e) => this.move(e));
    this.canvas.addEventListener('pointerup', (e) => this.up(e));
    this.canvas.addEventListener('pointercancel', () => this.cancel());
    this.canvas.addEventListener('lostpointercapture', () => {
      if (this.drag) this.cancel();
    });
    this.canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        if (!this.box) return;
        const p = this.point(e),
          v = this.coord(p),
          f = e.deltaY > 0 ? 1.15 : 1 / 1.15,
          b = this.box;
        this.view = {
          t0: v.t + (b.t0 - v.t) * f,
          t1: v.t + (b.t1 - v.t) * f,
          v0: v.v + (b.v0 - v.v) * f,
          v1: v.v + (b.v1 - v.v) * f,
        };
        this.draw();
      },
      { passive: false },
    );
    this.canvas.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this.cancel();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        e.stopPropagation();
        this.times = this.state().keys.map((k) => k.time);
        this.draw();
      }
      if (['ArrowLeft', 'ArrowRight'].includes(e.key)) {
        e.preventDefault();
        e.stopPropagation();
        const s = this.state();
        this.action('seek', s.time + (e.key === 'ArrowRight' ? 1 : -1) / this.rate());
      }
    });
    for (const input of host.querySelectorAll('input[type=number]'))
      input.addEventListener('focus', () => input.select());
    window.addEventListener('blur', () => this.cancel());
    const splitter = document.createElement('div');
    splitter.className = 'graph-splitter';
    splitter.tabIndex = 0;
    splitter.setAttribute('role', 'separator');
    splitter.setAttribute('aria-label', 'Chiều cao Graph');
    host.prepend(splitter);
    let resize = null;
    splitter.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      resize = { y: e.clientY, h: this.height || 180 };
      splitter.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    splitter.addEventListener('pointermove', (e) => {
      if (!resize) return;
      this.height = Math.max(125, Math.min(600, resize.h + resize.y - e.clientY));
      this.draw();
    });
    splitter.addEventListener('pointerup', () => (resize = null));
    splitter.addEventListener('pointercancel', () => (resize = null));
    splitter.addEventListener('keydown', (e) => {
      if (['ArrowUp', 'ArrowDown'].includes(e.key)) {
        e.preventDefault();
        this.height = Math.max(
          125,
          Math.min(600, (this.height || 180) + (e.key === 'ArrowUp' ? 10 : -10)),
        );
        this.draw();
      }
    });
  }
  message(m) {
    this.host.querySelector('#graphMessage').textContent = m;
  }
  rate() {
    return this.host.querySelector('#graphUnit').value === 'tick' ? 20 : this.state().fps;
  }
  factor() {
    return this.path === 's' ? 100 : 1;
  }
  indices(ks) {
    return ks
      .map((k, i) => (this.times.some((t) => Math.abs(k.time - t) < 1e-7) ? i : -1))
      .filter((i) => i >= 0);
  }
  editable() {
    const s = this.state();
    if (s.blocked) {
      this.message(s.blocked);
      return false;
    }
    if (s.conversion) {
      this.message('Áp dụng hoặc Hủy xem thử Euler trước khi chỉnh.');
      return false;
    }
    if ((this.path === 'r' && s.keys.some((k) => !k.graph?.euler)) || !s.keys.length) {
      this.message('Cần key; Rotation cần Tạo Euler curves trước khi chỉnh.');
      return false;
    }
    return true;
  }
  point(e) {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  coord(p) {
    const b = this.box;
    return {
      t: b.t0 + ((p.x - 52) / (b.w - 64)) * (b.t1 - b.t0),
      v: b.v1 - ((p.y - 12) / (b.h - 40)) * (b.v1 - b.v0),
    };
  }
  screen(t, v) {
    const b = this.box;
    return {
      x: 52 + ((t - b.t0) / (b.t1 - b.t0)) * (b.w - 64),
      y: 12 + ((b.v1 - v) / (b.v1 - b.v0)) * (b.h - 40),
    };
  }
  fitSelection() {
    const s = this.state(),
      ks = s.keys.filter((k) => this.times.includes(k.time));
    if (!ks.length) return;
    const times = ks.map((k) => k.time),
      v = ks.map((k) => G.value(k, this.path, this.axis) * this.factor()),
      dt = Math.max(1 / s.fps, Math.max(...times) - Math.min(...times)),
      dv = Math.max(1, Math.max(...v) - Math.min(...v));
    this.view = {
      t0: Math.min(...times) - dt * 0.2,
      t1: Math.max(...times) + dt * 0.2,
      v0: Math.min(...v) - dv * 0.2,
      v1: Math.max(...v) + dv * 0.2,
    };
    this.draw();
  }
  draw() {
    const s = this.state();
    if (
      !s?.project ||
      !this.host.open ||
      this.host.closest('#animationArea')?.dataset.editor === 'dope'
    )
      return;
    const token = s.id + '|' + s.bank + '|' + s.project.rig.fingerprint;
    if (this.token !== token) {
      this.token = token;
      this.times = [];
      this.view = null;
    }
    this.times = this.times.filter((t) => s.keys.some((k) => Math.abs(k.time - t) < 1e-7));
    const c = this.canvas,
      ctx = c.getContext('2d'),
      w = Math.max(200, c.clientWidth || 500),
      h = this.height || 180,
      dpr = window.devicePixelRatio || 1;
    c.style.height = h + 'px';
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#111c2b';
    ctx.fillRect(0, 0, w, h);
    const factor = this.factor(),
      samples = [];
    let prev = null;
    for (let i = 0; i <= 200; i++) {
      const t = (s.duration * i) / 200,
        v = s.sample(t),
        r = v.graph?.euler || G.continuous(v.q, prev);
      prev = r;
      samples.push({ t, v: this.path === 'r' ? r : v[this.path].map((x) => x * factor) });
    }
    const vals = samples.flatMap((x) => x.v.filter((_, j) => this.visible[j]));
    const lo = vals.length ? Math.min(...vals) : 0,
      hi = vals.length ? Math.max(...vals) : 1,
      pad = Math.max(1, (hi - lo) * 0.12);
    const view = this.view || { t0: 0, t1: Math.max(0.1, s.duration), v0: lo - pad, v1: hi + pad };
    this.box = { ...view, w, h };
    ctx.font = '10px Segoe UI';
    ctx.fillStyle = '#aebccc';
    ctx.strokeStyle = '#2e3b4c';
    for (let i = 0; i <= 5; i++) {
      const x = 52 + ((w - 64) * i) / 5,
        t = view.t0 + ((view.t1 - view.t0) * i) / 5,
        y = 12 + ((h - 40) * i) / 5;
      ctx.beginPath();
      ctx.moveTo(x, 12);
      ctx.lineTo(x, h - 28);
      ctx.stroke();
      ctx.fillText((t * this.rate()).toFixed(1), x - 8, h - 9);
      ctx.fillText((view.v1 - ((view.v1 - view.v0) * i) / 5).toFixed(1), 2, y + 3);
    }
    this.hits = [];
    for (let axis = 0; axis < 3; axis++) {
      if (!this.visible[axis]) continue;
      ctx.strokeStyle = colors[axis];
      ctx.lineWidth = axis === this.axis ? 2 : 1;
      ctx.beginPath();
      samples.forEach((v, i) => {
        const p = this.screen(v.t, v.v[axis]);
        i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y);
      });
      ctx.stroke();
      for (let i = 0; i < s.keys.length; i++) {
        const k = s.keys[i],
          p = this.screen(k.time, G.value(k, this.path, axis) * factor);
        if (p.x < 50 || p.x > w - 10 || p.y < 8 || p.y > h - 25) continue;
        const chosen = this.times.includes(k.time) && axis === this.axis;
        ctx.fillStyle = chosen ? '#ffdf73' : colors[axis];
        ctx.fillRect(p.x - 4, p.y - 4, 8, 8);
        this.hits.push({ ...p, type: 'key', i, axis });
        if (chosen && !s.blocked && !s.conversion && (!(this.path === 'r') || k.graph?.euler))
          for (const side of ['in', 'out']) {
            const neighbor = s.keys[i + (side === 'in' ? -1 : 1)];
            if (!neighbor) continue;
            const dt = (neighbor.time - k.time) / 3,
              hp = this.screen(
                k.time + dt,
                G.value(k, this.path, axis) * factor +
                  G.slope(s.keys, i, this.path, axis, side) * dt * factor,
              );
            ctx.strokeStyle = colors[axis];
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(hp.x, hp.y);
            ctx.stroke();
            ctx.strokeRect(hp.x - 3, hp.y - 3, 6, 6);
            this.hits.push({ ...hp, type: 'handle', side, i, axis, dt });
          }
      }
    }
    const play = this.screen(s.time, 0);
    ctx.strokeStyle = '#f8ba78';
    ctx.beginPath();
    ctx.moveTo(play.x, 0);
    ctx.lineTo(play.x, h - 24);
    ctx.stroke();
    if (this.drag?.kind === 'box') {
      const a = this.drag.start,
        b = this.drag.end || a;
      ctx.strokeStyle = '#91b8ff';
      ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
    }
    this.host
      .querySelectorAll('[data-axis]')
      .forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.axis === this.axis)));
    const chosen = s.keys.find((k) => this.times.includes(k.time));
    if (document.activeElement?.id !== 'graphTime')
      this.host.querySelector('#graphTime').value = chosen
        ? (chosen.time * this.rate()).toFixed(3)
        : '';
    if (document.activeElement?.id !== 'graphValue')
      this.host.querySelector('#graphValue').value = chosen
        ? (G.value(chosen, this.path, this.axis) * factor).toFixed(3)
        : '';
    this.host.querySelector('#graphConvert').hidden =
      this.path !== 'r' || (s.keys.every((k) => k.graph?.euler) && s.keys.length > 0);
    this.host.querySelector('#graphPreviewButtons').hidden = !s.conversion;
    const layer = s.project.lab?.layers.find((x) => x.id === s.project.lab.activeLayer);
    if (!this.drag)
      this.message(
        s.conversion
          ? s.conversionMessage
          : s.blocked ||
              `${layer ? 'Layer: ' + layer.name : 'Classic'} · ${s.id} · Local · ${this.path === 'r' ? 'độ' : this.path === 's' ? '%' : 'đơn vị dự án'} · ${this.times.length} key chọn`,
      );
  }
  down(e) {
    if (![0, 1].includes(e.button) || !this.box) return;
    e.preventDefault();
    this.canvas.focus();
    const p = this.point(e),
      s = this.state();
    if (e.button === 1) {
      this.drag = { kind: 'pan', start: p, view: { ...this.box } };
    } else if (p.y > this.box.h - 26) {
      this.drag = { kind: 'seek' };
      this.action('seek', Math.round(this.coord(p).t * this.rate()) / this.rate());
    } else {
      const hit =
        [...this.hits]
          .reverse()
          .find((h) => h.axis === this.axis && Math.hypot(h.x - p.x, h.y - p.y) < 9) ||
        this.hits.find((h) => h.type === 'key' && Math.hypot(h.x - p.x, h.y - p.y) < 9);
      if (hit) {
        this.axis = hit.axis;
        const t = s.keys[hit.i].time;
        if (e.ctrlKey || e.metaKey) {
          this.times = this.times.includes(t)
            ? this.times.filter((x) => x !== t)
            : [...this.times, t];
          this.draw();
          return;
        }
        if (!this.times.includes(t)) this.times = [t];
        this.draw();
        if (!this.editable()) return;
        this.drag = {
          kind: hit.type,
          start: p,
          coord: this.coord(p),
          keys: structuredClone(s.keys),
          times: [...this.times],
          hit,
          view: { ...this.box },
          project: s.project,
          changed: false,
        };
      } else
        this.drag = { kind: 'box', start: p, add: e.ctrlKey || e.metaKey, times: [...this.times] };
    }
    this.canvas.setPointerCapture(e.pointerId);
  }
  move(e) {
    if (!this.drag) return;
    const p = this.point(e),
      d = this.drag;
    if (d.kind === 'pan') {
      const b = d.view;
      this.view = {
        t0: b.t0 - ((p.x - d.start.x) / (b.w - 64)) * (b.t1 - b.t0),
        t1: b.t1 - ((p.x - d.start.x) / (b.w - 64)) * (b.t1 - b.t0),
        v0: b.v0 + ((p.y - d.start.y) / (b.h - 40)) * (b.v1 - b.v0),
        v1: b.v1 + ((p.y - d.start.y) / (b.h - 40)) * (b.v1 - b.v0),
      };
      this.draw();
      return;
    }
    if (d.kind === 'seek') {
      this.action('seek', Math.round(this.coord(p).t * this.rate()) / this.rate());
      return;
    }
    if (d.kind === 'box') {
      d.end = p;
      this.draw();
      return;
    }
    this.pending = { p, shift: e.shiftKey };
    if (!this.raf)
      this.raf = requestAnimationFrame(() => {
        this.raf = null;
        this.flush();
      });
  }
  flush() {
    const d = this.drag,
      p = this.pending;
    if (!d || !p) return;
    this.pending = null;
    try {
      const v = this.coord(p.p);
      let keys;
      if (d.kind === 'handle') {
        keys = structuredClone(d.keys);
        const k = keys[d.hit.i],
          m = (v.v / this.factor() - G.value(k, this.path, this.axis)) / d.hit.dt;
        G.handle(keys, d.hit.i, this.path, this.axis, d.hit.side, m);
      } else {
        let dt = v.t - d.coord.t,
          dv = (v.v - d.coord.v) / this.factor();
        if (p.shift) {
          if (Math.abs(p.p.x - d.start.x) > Math.abs(p.p.y - d.start.y)) dv = 0;
          else dt = 0;
        }
        if (this.host.querySelector('#graphSnap').checked)
          dt = Math.round(dt * this.rate()) / this.rate();
        const result = G.edit(d.keys, d.times, this.path, this.axis, {
          dt,
          dv,
          duration: this.state().duration,
        });
        keys = result.keys;
        this.times = result.times;
      }
      d.candidate = keys;
      d.changed = true;
      this.action('preview', keys);
      this.view = { t0: d.view.t0, t1: d.view.t1, v0: d.view.v0, v1: d.view.v1 };
      this.draw();
    } catch (e) {
      d.candidate = null;
      this.action('cancel');
      this.times = [...d.times];
      this.message(e.message);
    }
  }
  up(e) {
    if (!this.drag) return;
    this.flush();
    const d = this.drag;
    this.drag = null;
    if (d.kind === 'box') {
      const a = d.start,
        b = d.end || a,
        lo = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y) },
        hi = { x: Math.max(a.x, b.x), y: Math.max(a.y, b.y) };
      const times = this.hits
        .filter(
          (h) =>
            h.type === 'key' &&
            h.axis === this.axis &&
            h.x >= lo.x &&
            h.x <= hi.x &&
            h.y >= lo.y &&
            h.y <= hi.y,
        )
        .map((h) => this.state().keys[h.i].time);
      this.times = [...new Set([...(d.add ? d.times : []), ...times])];
    } else if (d.candidate) this.action('commit', d.candidate);
    if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
    this.draw();
  }
  cancel() {
    if (!this.drag) return;
    const d = this.drag;
    this.drag = null;
    this.pending = null;
    if (d.kind === 'key' || d.kind === 'handle') {
      this.action('cancel');
      this.times = d.times;
    }
    this.draw();
  }
  applyEdit(args) {
    if (!this.times.length) return this.message('Chọn key trước.');
    try {
      const s = this.state(),
        r = G.edit(s.keys, this.times, this.path, this.axis, { ...args, duration: s.duration });
      if (this.action('commit', r.keys) !== false) this.times = r.times;
      this.draw();
    } catch (e) {
      this.message(e.message);
    }
  }
}
