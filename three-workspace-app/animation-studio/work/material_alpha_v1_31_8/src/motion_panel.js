const regions = [
  'body',
  'head',
  'rightArm',
  'leftArm',
  'rightLeg',
  'leftLeg',
  'rightHand',
  'leftHand',
];
const labels = {
  body: 'Thân',
  head: 'Đầu',
  rightArm: 'Tay phải',
  leftArm: 'Tay trái',
  rightLeg: 'Chân phải',
  leftLeg: 'Chân trái',
  rightHand: 'Bàn tay phải',
  leftHand: 'Bàn tay trái',
};
const button = (action, text, title, extra = '') =>
  `<button type="button" data-action="${action}" title="${title}" aria-label="${title}" ${extra}>${text}</button>`;
const node = (key, x, y, r = 9) =>
  `<g class="motion-joint" data-joint="${key}" role="button" tabindex="0"><title></title><circle cx="${x}" cy="${y}" r="${r + 5}" class="motion-hit"/><circle cx="${x}" cy="${y}" r="${r}"/><text x="${x + 11}" y="${y - 8}" class="motion-pin-mark"></text></g>`;
const handFingers = [
  ['Pinky', 13, 55, 0, -17],
  ['Ring', 28, 49, 0, -23],
  ['Middle', 43, 46, 0, -26],
  ['Index', 58, 51, 0, -23],
  ['Thumb', 66, 91, 12, -13],
];
function hand(side, x, flip) {
  return `<g class="motion-hand" data-hand="${side}" transform="translate(${x} 145) scale(${flip} 1)"><g class="motion-hand-art">${handFingers.map(([name, bx, by, dx, dy]) => `<path class="motion-finger-shape" data-finger="${name}" d="M${bx} ${by} L${bx + dx * 3} ${by + dy * 3}"/>`).join('')}<path class="motion-skin motion-palm" data-region="${side}Hand" d="M5 55 Q32 47 64 55 L68 80 Q77 82 76 96 Q68 112 58 126 L20 125 Q6 108 5 86Z"/><path class="motion-palm-crease" d="M14 72 Q36 79 58 71 M13 94 Q33 103 51 98 M57 79 Q42 91 48 114"/>${handFingers.map(([name, bx, by, dx, dy]) => [1, 2, 3].map((i) => node(side + name + i, bx + dx * (i - 0.5), by + dy * (i - 0.5), 3.3)).join('')).join('')}</g><path class="motion-hand-grip" d="M9 62 Q35 55 61 62 L61 86 Q49 98 53 119 L23 118 Q10 99 9 62Z" role="slider" tabindex="0" aria-label="${side === 'left' ? 'Bàn tay trái' : 'Bàn tay phải'}: cuộn xuống nắm, cuộn lên mở; hoặc giữ chuột trái và rê" aria-valuemin="0" aria-valuemax="100"><title>Cuộn xuống nắm · cuộn lên mở · 5% mỗi nấc; hoặc giữ chuột trái và rê</title></path><text class="motion-hand-value" x="36" y="140" text-anchor="middle" transform="${flip < 0 ? 'translate(72 0) scale(-1 1)' : ''}">0%</text></g>`;
}
function pictogram() {
  return `<svg id="motionBody" viewBox="0 0 420 332" aria-label="Sơ đồ chọn khớp cơ thể và ngón tay">
<defs><linearGradient id="motionHandMetal" gradientUnits="userSpaceOnUse" x1="0" x2="78"><stop stop-color="#626665"/><stop offset=".48" stop-color="#c5c9c7"/><stop offset="1" stop-color="#838985"/></linearGradient><linearGradient id="motionMetal" x1="0" x2="1"><stop stop-color="#626665"/><stop offset=".45" stop-color="#c2c6c4"/><stop offset="1" stop-color="#767c79"/></linearGradient></defs>
<g class="motion-anatomy" fill="url(#motionMetal)" stroke="#515753" stroke-width="1.5">
<path data-region="head" d="M200 57 L201 69 L219 69 L220 57Z"/><ellipse data-region="head" cx="210" cy="37" rx="17" ry="25"/>
<path data-region="body" d="M182 70 Q210 63 238 70 L231 101 L224 124 L228 151 Q211 162 192 151 L196 124 L189 101Z"/>
<path data-region="body" d="M193 150 Q210 159 227 150 L234 173 L219 190 L210 177 L200 190 L185 174Z"/>
<path data-region="rightArm" d="M183 74 Q171 80 174 96 L166 117 L181 122 L193 89Z"/>
<path data-region="rightArm" d="M168 119 Q160 133 157 159 L167 165 L180 122Z"/>
<path data-region="leftArm" d="M237 74 Q249 80 246 96 L254 117 L239 122 L227 89Z"/>
<path data-region="leftArm" d="M252 119 Q260 133 263 159 L253 165 L240 122Z"/>
<path data-region="rightHand" d="M157 158 L151 177 L156 190 L163 174 L167 164Z"/>
<path data-region="leftHand" d="M263 158 L269 177 L264 190 L257 174 L253 164Z"/>
<path data-region="rightLeg" d="M187 171 Q181 191 183 216 L190 233 L201 222 L205 183Z"/>
<path data-region="leftLeg" d="M233 171 Q239 191 237 216 L230 233 L219 222 L215 183Z"/>
<path data-region="rightLeg" d="M185 225 Q180 245 189 278 L197 278 L202 227Z"/>
<path data-region="leftLeg" d="M235 225 Q240 245 231 278 L223 278 L218 227Z"/>
<path data-region="rightLeg" d="M189 275 L182 291 Q164 301 171 310 Q187 319 199 301 L198 277Z"/>
<path data-region="leftLeg" d="M231 275 L238 291 Q256 301 249 310 Q233 319 221 301 L222 277Z"/>
</g>${hand('right', 22, 1)}${hand('left', 398, -1)}
<g class="motion-joints">${[
    ['head', 210, 36],
    ['neck', 210, 65, 6],
    ['chest', 210, 88],
    ['spine', 210, 122],
    ['hips', 210, 158],
    ['rightShoulder', 184, 77],
    ['leftShoulder', 236, 77],
    ['rightElbow', 174, 120],
    ['leftElbow', 246, 120],
    ['rightWrist', 162, 163],
    ['leftWrist', 258, 163],
    ['rightHip', 191, 175],
    ['leftHip', 229, 175],
    ['rightKnee', 191, 226],
    ['leftKnee', 229, 226],
    ['rightAnkle', 193, 278],
    ['leftAnkle', 227, 278],
    ['rightToe', 181, 305],
    ['leftToe', 239, 305],
  ]
    .map((x) => node(...x))
    .join('')}</g>
<text x="65" y="310" class="motion-side">R · Phải</text><text x="355" y="310" class="motion-side">L · Trái</text></svg>`;
}
export class MotionPanel {
  constructor(host, { state, action, position }) {
    this.host = host;
    this.state = state;
    this.action = action;
    this.position = position;
    this.tab = 'ik';
    this.mask = new Set(regions);
    this.collapsed = false;
    this.drag = null;
    this.lastRig = null;
    const root = (this.root = document.createElement('section'));
    root.id = 'motionLayerWindow';
    root.className = 'motion-panel';
    root.hidden = true;
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'false');
    root.setAttribute('aria-labelledby', 'motionLayerTitle');
    root.innerHTML = `<div class="motion-titlebar" id="motionLayerHandle" tabindex="0" title="Kéo để di chuyển; phím mũi tên dịch bảng"><b id="motionLayerTitle">Edit Motion Layer</b>${button('collapse', '−', 'Thu gọn / mở rộng bảng')}${button('close', '×', 'Đóng Edit Motion Layer')}</div>
<div class="motion-content"><div class="motion-tools">${button('move', '↔ G', 'Di chuyển khớp (G)')}${button('rotate', '⟳ R', 'Xoay khớp (R)')}<select id="motionSpace" aria-label="Không gian transform"><option value="world">World</option><option value="local">Local</option></select><span class="push"></span>${button('controls', '◇', 'Bật/tắt control trong khung 3D')}${button('bones', '♧', 'Bật/tắt xương trong khung 3D')}</div>
<div class="motion-tabs" role="tablist" aria-label="Chế độ Edit Motion Layer">${['ik', 'fk', 'mixer'].map((t, i) => `<button type="button" role="tab" id="motionTab_${t}" data-tab="${t}" aria-controls="motionBodyArea">${['IK Mode', 'FK Mode', 'Pose Mixer'][i]}</button>`).join('')}</div>
<div id="motionBodyArea" class="motion-body" role="tabpanel">${pictogram()}<div class="motion-mask-tools" hidden>${button('maskAll', '□', 'Chọn tất cả vùng')}${button('maskNone', '×', 'Bỏ chọn tất cả vùng')}${button('maskInvert', '▧', 'Đảo vùng chọn')}</div>
<div class="motion-pin-tools">${button('pinPosition', 'T⌖', 'Ghim / bỏ ghim vị trí chi chọn')}${button('pinRotation', 'R⌖', 'Ghim / bỏ ghim góc chi chọn')}${button('pinFeet', '♙⇣', 'Ghim vị trí và góc cả hai bàn chân')}${button('pinHands', '♙↔', 'Ghim vị trí và góc cả hai bàn tay')}${button('pinAll', '♙⌖', 'Ghim vị trí và góc bốn chi')}${button('unpinAll', '♙○', 'Bỏ mọi ghim')}<span class="motion-divider"></span>${button('ik', 'IK', 'Chuyển chi chọn sang IK')}${button('fk', 'FK', 'Chuyển chi chọn sang FK')}</div></div>
<div class="motion-mixer" hidden><div class="motion-region-buttons">${regions.map((id) => `<button type="button" data-mask="${id}" title="Chọn vùng ${labels[id]}">${labels[id]}</button>`).join('')}</div><div class="motion-tools"><select id="motionPoseLibrary" aria-label="Pose đã lưu"></select>${button('applyPose', 'Áp pose', 'Áp pose thư viện lên vùng chọn')}</div></div>
<div class="motion-scope">${button('full', '♙', 'Toàn thân · phạm vi pose và key')}${button('part', '◉', 'Bộ phận · phạm vi pose và key')}<span class="motion-divider"></span>${button('mirrorRL', 'R→L', 'Mirror pose phải sang trái trên vùng chọn')}${button('mirrorBoth', '↔', 'Mirror pose hai bên trên vùng chọn')}${button('mirrorLR', 'L→R', 'Mirror pose trái sang phải trên vùng chọn')}<label title="Giữ đích IK bàn chân trên cao độ sàn của Lab"><input type="checkbox" id="motionFloor">Sàn</label></div>
<div class="motion-layer-row"><select id="motionActiveLayer" aria-label="Lớp sửa chuyển động"></select><input id="motionWeight" type="range" min="0" max="1" step=".01" aria-label="Ảnh hưởng lớp sửa"><output id="motionWeightValue"></output></div>
<div id="motionSelection" class="motion-selection" role="status"></div>
<details class="motion-transform"><summary>Transform · Vị trí và góc xoay</summary><div class="motion-values">${['px', 'py', 'pz', 'rx', 'ry', 'rz'].map((id) => `<label>${id.startsWith('p') ? 'P' : 'R'}${id[1].toUpperCase()}${id.startsWith('r') ? '°' : ''}<input id="motion_${id}" data-field="${id}" type="text" inputmode="decimal" aria-label="${id.startsWith('p') ? 'Vị trí' : 'Góc xoay'} ${id[1].toUpperCase()}"></label>`).join('')}</div></details>
<div class="motion-actions">${button('key', 'Set Key', 'Ghi key theo phạm vi tại frame hiện tại')}${button('reset', 'Reset', 'Bỏ hiệu ứng lớp sửa đang chọn tại frame này, theo phạm vi')}${button('copy', 'Copy Pose', 'Copy pose theo phạm vi')}${button('paste', 'Paste Pose', 'Dán pose theo phạm vi')}</div>
<div class="motion-actions motion-all">${button('copyAll', 'Copy All Pose', 'Copy pose toàn thân của armature đang hoạt động')}${button('pasteAll', 'Paste All Pose', 'Dán pose toàn thân của armature đang hoạt động')}</div><small class="motion-help">Xanh lá: chọn · Cyan: ghim T/R · Kéo thanh tiêu đề để di chuyển</small></div>`;
    const footer = document.createElement('div');
    footer.className = 'motion-footer';
    for (const el of root.querySelectorAll('.motion-actions,.motion-help')) footer.append(el);
    root.append(footer);
    host.append(root);
    const notice = document.createElement('p');
    notice.id = 'motionLockReason';
    notice.setAttribute('role', 'status');
    root.querySelector('.motion-titlebar').after(notice);
    const armature = document.createElement('select');
    armature.id = 'motionArmature';
    armature.setAttribute('aria-label', 'Armature chỉnh pose');
    notice.after(armature);
    armature.addEventListener('change', () => this.action('armature', { value: armature.value }));
    root.addEventListener('click', (e) => {
      if (this.suppressHandClick || (e.target.closest('.motion-hand-grip') && this.tab !== 'mixer'))
        return;
      const tab = e.target.closest('[role=tab][data-tab]');
      if (tab) {
        this.tab = tab.dataset.tab;
        this.sync();
        return;
      }
      const mask = e.target.closest('[data-mask]');
      if (mask) {
        this.toggleMask(mask.dataset.mask);
        return;
      }
      const shape = e.target.closest('[data-region]');
      if (shape && this.tab === 'mixer') {
        this.toggleMask(shape.dataset.region);
        return;
      }
      const joint = e.target.closest('[data-joint]');
      if (joint && this.tab !== 'mixer' && joint.getAttribute('aria-disabled') !== 'true') {
        this.action('joint', { key: joint.dataset.joint, tab: this.tab });
        return;
      }
      const b = e.target.closest('[data-action]');
      if (!b) return;
      const a = b.dataset.action;
      if (a === 'collapse') {
        this.collapsed = !this.collapsed;
        root.classList.toggle('collapsed', this.collapsed);
        b.setAttribute('aria-expanded', String(!this.collapsed));
        this.clamp();
      } else if (a === 'maskAll' || a === 'maskNone' || a === 'maskInvert') {
        this.mask = new Set(
          regions.filter((id) => a === 'maskAll' || (a === 'maskInvert' && !this.mask.has(id))),
        );
        this.sync();
      } else
        this.action(a, {
          mask: [...this.mask],
          tab: this.tab,
          pose: Number(this.el('motionPoseLibrary').value),
        });
    });
    root.addEventListener('keydown', (e) => {
      const joint = e.target.closest('[data-joint]');
      if (joint && ['Enter', ' '].includes(e.key)) {
        e.preventDefault();
        e.stopPropagation();
        joint.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      }
      if (
        e.target.matches('[role=tab]') &&
        ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)
      ) {
        e.preventDefault();
        e.stopPropagation();
        const tabs = ['ik', 'fk', 'mixer'],
          i = tabs.indexOf(this.tab);
        this.tab =
          e.key === 'Home'
            ? 'ik'
            : e.key === 'End'
              ? 'mixer'
              : tabs[(i + (e.key === 'ArrowRight' ? 1 : 2)) % 3];
        this.sync();
        this.el('motionTab_' + this.tab).focus();
      }
    });
    for (const [id, action] of [
      ['motionSpace', 'space'],
      ['motionFloor', 'floor'],
      ['motionActiveLayer', 'layer'],
      ['motionWeight', 'weight'],
      ...['px', 'py', 'pz', 'rx', 'ry', 'rz'].map((id) => ['motion_' + id, 'value']),
    ])
      this.el(id).addEventListener('change', (e) =>
        this.action(action, {
          value: e.target.type === 'checkbox' ? e.target.checked : e.target.value,
          field: e.target.dataset.field,
        }),
      );
    this.el('motionWeight').addEventListener(
      'input',
      (e) => (this.el('motionWeightValue').textContent = Math.round(e.target.value * 100) + '%'),
    );
    root.querySelectorAll('[data-field]').forEach((input) => {
      input.addEventListener('focus', () => input.select());
      input.addEventListener('click', () => input.select());
    });
    this.setupHandDrag();
    this.setupDrag();
    new ResizeObserver(() => this.clamp()).observe(host);
  }
  el(id) {
    return this.root.querySelector('#' + id);
  }
  toggleMask(id) {
    this.mask.has(id) ? this.mask.delete(id) : this.mask.add(id);
    this.sync();
  }
  clamp() {
    if (this.root.hidden || !this.host.clientWidth || !this.host.clientHeight) return;
    const s = this.state(),
      w = this.root.offsetWidth,
      h = this.root.offsetHeight;
    const x = this.drag ? parseFloat(this.root.style.left) : Number(s.x),
      y = this.drag ? parseFloat(this.root.style.top) : Number(s.y);
    this.root.style.left =
      Math.max(
        6,
        Math.min(
          this.host.clientWidth - w - 6,
          Number.isFinite(x) && x >= 0 ? x : this.host.clientWidth - w - 12,
        ),
      ) + 'px';
    this.root.style.top =
      Math.max(6, Math.min(this.host.clientHeight - h - 6, Number.isFinite(y) && y >= 0 ? y : 12)) +
      'px';
  }
  setupDrag() {
    const h = this.el('motionLayerHandle');
    h.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.target.closest('button')) return;
      this.drag = {
        pointer: e.pointerId,
        x: e.clientX,
        y: e.clientY,
        left: parseFloat(this.root.style.left),
        top: parseFloat(this.root.style.top),
      };
      h.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    h.addEventListener('pointermove', (e) => {
      if (!this.drag) return;
      this.root.style.left = this.drag.left + e.clientX - this.drag.x + 'px';
      this.root.style.top = this.drag.top + e.clientY - this.drag.y + 'px';
      this.clamp();
      e.preventDefault();
    });
    const end = (cancel) => {
      if (!this.drag) return;
      const d = this.drag;
      this.drag = null;
      if (h.hasPointerCapture(d.pointer)) h.releasePointerCapture(d.pointer);
      if (cancel) {
        this.root.style.left = d.left + 'px';
        this.root.style.top = d.top + 'px';
      } else this.position(parseFloat(this.root.style.left), parseFloat(this.root.style.top));
    };
    h.addEventListener('pointerup', () => end(false));
    h.addEventListener('pointercancel', () => end(true));
    h.addEventListener('lostpointercapture', () => end(true));
    window.addEventListener('blur', () => end(true));
    h.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.drag) {
        e.preventDefault();
        end(true);
      }
      if (e.target !== h || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key))
        return;
      e.preventDefault();
      e.stopPropagation();
      const x =
          parseFloat(this.root.style.left) +
          (e.key === 'ArrowLeft' ? -10 : e.key === 'ArrowRight' ? 10 : 0),
        y =
          parseFloat(this.root.style.top) +
          (e.key === 'ArrowUp' ? -10 : e.key === 'ArrowDown' ? 10 : 0);
      this.position(x, y);
      this.clamp();
    });
    window.addEventListener(
      'keydown',
      (e) => {
        if (e.key === 'Escape' && this.drag) {
          e.preventDefault();
          end(true);
        }
      },
      true,
    );
  }
  setupHandDrag() {
    let drag = null;
    let wheel = null,
      wheelSide = null,
      wheelRemainder = 0,
      wheelTimer = 0;
    const finishWheel = () => {
      if (!wheel) return;
      clearTimeout(wheelTimer);
      this.action('handEnd', {});
      wheel = null;
      this.sync();
    };
    this.root.addEventListener(
      'wheel',
      (e) => {
        const el = e.target.closest('.motion-hand');
        if (!el || this.tab === 'mixer' || drag) return;
        const side = el.dataset.hand,
          hand = this.state().hands[side];
        if (!hand?.enabled) return;
        e.preventDefault();
        e.stopPropagation();
        if (wheelSide !== side) {
          finishWheel();
          wheelRemainder = 0;
          wheelSide = side;
        }
        wheelRemainder += e.deltaY * (e.deltaMode === 1 ? 32 : e.deltaMode === 2 ? 100 : 1);
        const steps = Math.trunc(wheelRemainder / 100);
        if (!steps) return;
        wheelRemainder -= steps * 100;
        if (!wheel) {
          if (this.action('handStart', { side }) !== true) return;
          wheel = { side, value: hand.value };
        }
        wheel.value = Math.max(0, Math.min(1, wheel.value + steps * 0.05));
        this.action('handMove', { value: wheel.value });
        this.sync();
        clearTimeout(wheelTimer);
        wheelTimer = setTimeout(finishWheel, 220);
      },
      { passive: false },
    );
    const end = (cancel) => {
      if (!drag) return;
      const d = drag;
      drag = null;
      this.action('handEnd', { cancel });
      if (d.el.hasPointerCapture(d.pointer)) d.el.releasePointerCapture(d.pointer);
      this.suppressHandClick = true;
      setTimeout(() => (this.suppressHandClick = false), 0);
    };
    this.root.addEventListener('pointerdown', (e) => {
      const el = e.target.closest('.motion-hand-grip');
      if (
        !el ||
        e.button !== 0 ||
        this.tab === 'mixer' ||
        el.getAttribute('aria-disabled') === 'true'
      )
        return;
      finishWheel();
      const side = el.closest('[data-hand]').dataset.hand,
        value = this.state().hands[side]?.value;
      if (!Number.isFinite(value) || this.action('handStart', { side }) !== true) return;
      drag = { el, side, pointer: e.pointerId, y: e.clientY, value };
      el.setPointerCapture(e.pointerId);
      el.focus();
      e.preventDefault();
      e.stopPropagation();
    });
    this.root.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.pointer) return;
      this.action('handMove', {
        value: Math.max(0, Math.min(1, drag.value + (e.clientY - drag.y) / 120)),
      });
      e.preventDefault();
      e.stopPropagation();
    });
    this.root.addEventListener('pointerup', (e) => {
      if (drag && e.pointerId === drag.pointer) end(false);
    });
    this.root.addEventListener('pointercancel', () => end(true));
    this.root.addEventListener('lostpointercapture', () => end(true));
    window.addEventListener('blur', () => end(true));
    window.addEventListener(
      'keydown',
      (e) => {
        if (e.key === 'Escape' && wheel) {
          e.preventDefault();
          clearTimeout(wheelTimer);
          this.action('handEnd', { cancel: true });
          wheel = null;
          this.sync();
        }
        if (drag && e.key === 'Escape') {
          e.preventDefault();
          e.stopImmediatePropagation();
          end(true);
        }
      },
      true,
    );
    this.root.addEventListener('keydown', (e) => {
      const el = e.target.closest('.motion-hand-grip');
      if (
        !el ||
        !['ArrowUp', 'ArrowDown'].includes(e.key) ||
        this.tab === 'mixer' ||
        el.getAttribute('aria-disabled') === 'true'
      )
        return;
      e.preventDefault();
      e.stopPropagation();
      const side = el.closest('[data-hand]').dataset.hand,
        value = this.state().hands[side].value;
      if (this.action('handStart', { side }) === true) {
        this.action('handMove', {
          value: Math.max(0, Math.min(1, value + (e.key === 'ArrowDown' ? 0.05 : -0.05))),
        });
        this.action('handEnd', {});
      }
    });
  }
  sync() {
    const s = this.state();
    this.root.hidden = !s.visible;
    if (!s.visible) return;
    if (this.lastRig !== s.rig) {
      this.lastRig = s.rig;
      this.mask = new Set(regions);
    }
    this.el('motionLockReason').textContent = [
      s.lockedReason,
      s.rigDiagnostic,
      ...Object.entries(s.hands)
        .filter(([, hand]) => !hand.enabled)
        .map(
          ([side, hand]) =>
            (side === 'left' ? 'Tay trái: ' : 'Tay phải: ') + (hand.reason || 'Thiếu xương ngón.'),
        ),
    ]
      .filter(Boolean)
      .join(' · ');
    this.el('motionLockReason').hidden = !this.el('motionLockReason').textContent;
    this.root.querySelector('.motion-content').inert = !!s.lockedReason;
    this.root.querySelector('.motion-footer').inert = !!s.lockedReason;
    const selector = this.el('motionArmature');
    selector.hidden = (s.armatures?.length || 0) < 2;
    selector.disabled = !!s.readOnly;
    const signature = JSON.stringify(s.armatures || []);
    if (selector.dataset.options !== signature) {
      selector.innerHTML = '';
      for (const [value, label] of [
        ['', 'Chọn Armature để chỉnh pose'],
        ...(s.armatures || []).map((armature) => [armature.id, armature.name]),
      ]) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = label;
        selector.append(option);
      }
      selector.dataset.options = signature;
    }
    selector.value = s.activeRoot || '';
    this.root.dataset.tab = this.tab;
    this.root.querySelectorAll('[data-tab]').forEach((e) => {
      const on = e.dataset.tab === this.tab;
      e.setAttribute('aria-selected', String(on));
      e.tabIndex = on ? 0 : -1;
    });
    this.el('motionBodyArea').setAttribute('aria-labelledby', 'motionTab_' + this.tab);
    this.root.querySelector('.motion-mask-tools').hidden = this.tab !== 'mixer';
    this.root.querySelector('.motion-mixer').hidden = this.tab !== 'mixer';
    this.root.querySelector('.motion-pin-tools').hidden = this.tab === 'mixer';
    this.root.querySelectorAll('[data-region],[data-mask]').forEach((e) => {
      const id = e.dataset.region || e.dataset.mask;
      e.classList.toggle('masked', this.mask.has(id));
      if (e.dataset.mask) e.setAttribute('aria-pressed', String(this.mask.has(id)));
    });
    this.root.querySelectorAll('[data-joint]').forEach((e) => {
      const d = s.points[e.dataset.joint],
        id = d && (this.tab === 'ik' ? d.ik || d.id : d.id),
        enabled = !!id;
      e.setAttribute('aria-disabled', String(!enabled));
      e.tabIndex = enabled && this.tab !== 'mixer' ? 0 : -1;
      e.setAttribute(
        'aria-label',
        (!enabled && d?.reason) || d?.label || e.dataset.joint + ' · không có xương tương ứng',
      );
      e.querySelector('title').textContent = e.getAttribute('aria-label');
      e.classList.toggle('chosen', enabled && s.selected === id);
      const pin = d?.effector && s.pins.find((p) => p.id === d.effector);
      e.classList.toggle('pinned', !!pin);
      e.querySelector('.motion-pin-mark').textContent = pin
        ? (pin.position ? 'T' : '') + (pin.rotation ? 'R' : '')
        : '';
    });
    this.root.querySelectorAll('[data-hand]').forEach((el) => {
      const h = s.hands[el.dataset.hand],
        value = h?.value || 0,
        grip = el.querySelector('.motion-hand-grip');
      grip.setAttribute('aria-disabled', String(!h?.enabled));
      grip.setAttribute('aria-valuenow', String(Math.round(value * 100)));
      grip.tabIndex = h?.enabled && this.tab !== 'mixer' ? 0 : -1;
      grip.querySelector('title').textContent = h?.enabled
        ? 'Cuộn xuống nắm · cuộn lên mở · 5% mỗi nấc; hoặc giữ chuột trái và rê'
        : h?.reason || 'Không có đủ xương ngón tay.';
      el.querySelector('.motion-hand-value').textContent = Math.round(value * 100) + '%';
      el.querySelectorAll('[data-finger]').forEach((path) => {
        const [, x, y, dx, dy] = handFingers.find((f) => f[0] === path.dataset.finger),
          length = dy * 3 * (1 - value * 0.72),
          width = dx * 3 * (1 - value * 0.75);
        path.setAttribute(
          'd',
          `M${x} ${y} Q${x + width * 0.8} ${y + length * 0.65} ${x + width} ${y + length}`,
        );
      });
      el.querySelectorAll('.motion-joint').forEach((j) => {
        const base = handFingers.find((f) => j.dataset.joint.includes(f[0]));
        const i = Number(j.dataset.joint.at(-1));
        j.setAttribute(
          'transform',
          `translate(${-base[3] * (i - 0.5) * value * 0.75} ${-base[4] * (i - 0.5) * value * 0.72})`,
        );
      });
    });
    for (const a of ['move', 'rotate', 'full', 'part', 'controls', 'bones']) {
      const on =
        a === 'move'
          ? s.transform === 'translate'
          : a === 'rotate'
            ? s.transform === 'rotate'
            : a === 'full'
              ? s.scope === 'full'
              : a === 'part'
                ? s.scope === 'part'
                : s[a];
      this.root.querySelector('[data-action=' + a + ']').setAttribute('aria-pressed', String(on));
    }
    const pin = s.pins.find((p) => p.id === s.effector);
    for (const [a, k] of [
      ['pinPosition', 'position'],
      ['pinRotation', 'rotation'],
    ]) {
      const b = this.root.querySelector('[data-action=' + a + ']');
      b.disabled = !s.effector;
      b.setAttribute('aria-pressed', String(!!pin?.[k]));
    }
    for (const a of ['ik', 'fk']) {
      const b = this.root.querySelector('[data-action=' + a + ']');
      b.disabled = !s.chain;
      b.setAttribute('aria-pressed', String(s.chain?.mode === a));
    }
    for (const a of ['paste', 'pasteAll'])
      this.root.querySelector('[data-action=' + a + ']').disabled = !s.canPaste;
    this.el('motionSpace').value = s.space;
    this.el('motionFloor').checked = s.floor;
    this.el('motionSelection').textContent = s.label + ' · ' + Math.round(s.frame) + 'f';
    const options = (el, items, value) => {
      const signature = JSON.stringify(items);
      if (el.dataset.options !== signature) {
        el.replaceChildren(
          ...items.map(([v, t]) => {
            const o = document.createElement('option');
            o.value = v;
            o.textContent = t;
            return o;
          }),
        );
        el.dataset.options = signature;
      }
      if (value !== undefined) el.value = value;
    };
    options(
      this.el('motionActiveLayer'),
      s.layers.map((l) => [l.id, l.name]),
      s.layer,
    );
    options(
      this.el('motionPoseLibrary'),
      s.poses.length ? s.poses.map((p, i) => [i, p.name]) : [['', 'Chưa lưu pose']],
    );
    this.root.querySelector('[data-action=applyPose]').disabled = !s.poses.length;
    if (document.activeElement !== this.el('motionWeight')) {
      this.el('motionWeight').value = s.weight;
      this.el('motionWeightValue').textContent = Math.round(s.weight * 100) + '%';
    }
    for (const [id, v] of Object.entries(s.values)) {
      const el = this.el('motion_' + id);
      if (document.activeElement !== el) el.value = v.value;
      el.disabled = v.disabled;
    }
    this.root.querySelector('[data-action=move]').disabled = s.moveDisabled;
    this.root.querySelector('[data-action=rotate]').disabled = s.rotateDisabled;
    this.clamp();
  }
}
