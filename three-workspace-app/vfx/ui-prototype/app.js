(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.VfxPrototype = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  const FALLBACK_EFFECTS = [
    { id:"arcane-ring", name:"Vòng phép Tinh Vân", type:"Vòng phép", colors:["xanh","tím"], duration:2.4, loop:true, source:"Effekseer Sample", license:"CC0", gameVerified:true, renderer:"sprite", accent:"#7c6cff" },
    { id:"ember-aura", name:"Hào quang Hổ Phách", type:"Hào quang", colors:["cam","vàng"], duration:3.2, loop:true, source:"Nội bộ", license:"CC0", gameVerified:true, renderer:"sprite", accent:"#ff9e45" },
    { id:"frost-slash", name:"Vệt chém Băng Lam", type:"Vệt chém", colors:["xanh","trắng"], duration:.8, loop:false, source:"Effekseer Sample", license:"CC0", gameVerified:false, renderer:"effekseer", accent:"#58c8ff" },
    { id:"solar-shot", name:"Đạn Nhật Quang", type:"Đạn", colors:["vàng","trắng"], duration:1.4, loop:false, source:"Kenney Particle Pack", license:"CC0", gameVerified:true, renderer:"sprite", accent:"#ffe26a" },
    { id:"void-impact", name:"Va chạm Hư Không", type:"Va chạm / Nổ", colors:["tím","đen"], duration:1.1, loop:false, source:"Nội bộ", license:"CC0", gameVerified:false, renderer:"cpu", accent:"#bd64ff" },
    { id:"jade-shield", name:"Khiên Ngọc Lục", type:"Khiên", colors:["xanh lá","trắng"], duration:4, loop:true, source:"Effekseer Sample", license:"CC0", gameVerified:true, renderer:"sprite", accent:"#54dda1" },
    { id:"storm-vortex", name:"Lốc Tố Phong", type:"Lốc", colors:["xanh","xám"], duration:2.8, loop:true, source:"Nội bộ", license:"CC0", gameVerified:false, renderer:"effekseer", accent:"#70a8ff" }
  ];

  function normalizeText(value) {
    return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase().trim();
  }

  function filterEffects(effects, filters) {
    const query = normalizeText(filters && (filters.query || filters.search));
    const type = filters && filters.type;
    const verified = Boolean(filters && (filters.verified || filters.gameVerified));
    const color = normalizeText(filters && filters.color);
    const duration = filters && filters.duration;
    const loop = filters && filters.loop;
    const source = filters && filters.source;
    const license = filters && filters.license;
    return effects.filter((effect) => {
      const haystack = normalizeText([effect.name, effect.type, effect.source, effect.license, ...(effect.colors || [])].join(" "));
      const durationMatch = !duration || (duration === 'short' && effect.duration <= 1.5) || (duration === 'medium' && effect.duration > 1.5 && effect.duration < 3) || (duration === 'long' && effect.duration >= 3);
      return (!query || haystack.includes(query)) && (!type || effect.type === type) && (!verified || effect.gameVerified === true) &&
        (!color || (effect.colors || []).some((value) => normalizeText(value) === color)) && durationMatch &&
        (!loop || (loop === 'loop' ? effect.loop : !effect.loop)) && (!source || effect.source === source) && (!license || effect.license === license);
    });
  }

  function createInitialVersions() {
    return { selectedId:"v3", next:4, items:[
      { id:"v1", label:"Bản 1", instruction:"Vòng phép xanh tím, bán kính 2 block", time:"10:12" },
      { id:"v2", label:"Bản 2", instruction:"Thêm tia lửa bay lên", time:"10:14" },
      { id:"v3", label:"Bản 3", instruction:"Xanh hơn, nổ muộn 0,5 s", time:"10:16" }
    ]};
  }

  function addVersion(state, instruction) {
    const copy = { selectedId:state.selectedId, next:state.next || state.items.length + 1, items:state.items.map((x) => ({...x})) };
    const id = `v${copy.next}`;
    copy.items.push({ id, label:`Bản ${copy.next}`, instruction:String(instruction || "Điều chỉnh thông số"), time:"Bây giờ" });
    copy.next += 1; copy.selectedId = id; return copy;
  }

  function selectVersion(state, id) {
    if (!state.items.some((item) => item.id === id)) return state;
    return { ...state, selectedId:id, items:state.items.map((x) => ({...x})) };
  }

  if (typeof document === "undefined") return { normalizeText, filterEffects, createInitialVersions, addVersion, selectVersion };

  const $ = (selector, scope=document) => scope.querySelector(selector);
  const $$ = (selector, scope=document) => [...scope.querySelectorAll(selector)];
  const state = { effects:FALLBACK_EFFECTS, selected:FALLBACK_EFFECTS[0], view:"library", playing:false, versions:createInitialVersions(), loadState:"ready" };
  const inspectorTemplates = {
    library: () => `<div class="panel-title"><div><small>CHI TIẾT</small><strong>${state.selected.name}</strong></div><button class="icon-button" aria-label="Thêm vào yêu thích">☆</button></div><div class="hero-swatch" style="--accent:${state.selected.accent}"><i></i></div><div class="metadata"><div><span>Loại</span><b>${state.selected.type}</b></div><div><span>Thời lượng</span><b>${String(state.selected.duration).replace('.', ',')} giây</b></div><div><span>Phát</span><b>${state.selected.loop ? 'Lặp liên tục' : 'Một lần'}</b></div><div><span>Nguồn</span><b>${state.selected.source}</b></div><div><span>License</span><b>${state.selected.license}</b></div></div><div class="verification ${state.selected.gameVerified ? 'passed':''}"><b>${state.selected.gameVerified ? '✓ Dữ liệu mẫu: đã chạy game' : '○ Dữ liệu mẫu: chưa kiểm game'}</b><small>${state.selected.gameVerified ? 'Nhãn minh hoạ · không phải kết quả đo' : 'Cần qua danh sách kiểm thực tế'}</small></div><button class="primary wide" data-nav="preview">Mở trong khung xem <span>→</span></button>`,
    preview: () => `<div class="panel-title"><div><small>XEM TRƯỚC</small><strong>Thiết lập khung</strong></div></div><div class="form-section"><h3>Môi trường</h3><label>Nhân vật so cỡ<select><option>Steve · 1,8 block</option><option>Không hiện nhân vật</option></select></label><label>Cỡ hiệu ứng<div class="input-unit"><input value="2,0"><span>block</span></div></label><label class="switch"><input type="checkbox" checked><i></i><span>Hiện thước block</span></label></div><div class="form-section"><h3>Renderer</h3><div class="callout good"><b>Mô phỏng renderer</b><span>Dữ liệu mẫu · chưa đo GPU thật</span></div><label>Chế độ<select><option>Bảng sprite đã nướng</option><option>Effekseer native</option><option>Mô phỏng CPU</option></select></label></div><div class="honest-state"><b>Preview bảng sprite</b><p>Hình này không xác nhận hiệu ứng đã chạy trong BBS FS.</p></div>`,
    generate: () => `<div class="panel-title"><div><small>TẠO TỪ MÔ TẢ</small><strong>EffectSpec</strong></div><span class="draft-pill">NHÁP</span></div><div class="form-section compact"><label>Mô tả tiếng Việt<textarea id="promptInput" rows="3">Vòng phép xanh tím bán kính hai block, tụ sáng rồi nổ</textarea></label><label>Chủ đề<input value="Vòng phép tinh vân"></label><label>Bảng màu<div class="color-chips"><i style="--c:#55bfff"></i><i style="--c:#795cff"></i><i style="--c:#f0eaff"></i><button aria-label="Thêm màu">＋</button></div></label><div class="two-col"><label>Thời lượng<div class="input-unit"><input value="2,5"><span>giây</span></div></label><label>Cỡ<div class="input-unit"><input value="2,0"><span>block</span></div></label></div><label class="switch"><input type="checkbox"><i></i><span>Lặp hiệu ứng</span></label><label>Thời điểm phát<select><option>Tụ sáng rồi nổ</option><option>Phát ngay</option><option>Xuất hiện dần</option></select></label><label>Seed<input value="28461"></label><button class="primary" id="generateOptions">Tạo 3 phương án mô phỏng</button></div><div class="revision-box"><input id="revisionInput" value="Xanh hơn, nổ muộn 0,5 s" aria-label="Yêu cầu sửa bằng lời"><button id="revisionButton">Tạo phiên bản</button></div><div class="version-list"><h3>Lịch sử phiên bản</h3>${state.versions.items.map(v => `<button class="version ${v.id === state.versions.selectedId ? 'active':''}" data-version="${v.id}"><i></i><span><b>${v.label}</b><small>${v.instruction}</small></span><time>${v.time}</time></button>`).join('')}</div>`,
    edit: () => `<div class="panel-title"><div><small>THUỘC TÍNH</small><strong id="nodeTitle">Lõi phép</strong></div><button class="icon-button" aria-label="Tuỳ chọn">•••</button></div><div class="node-pills" aria-label="Chọn lớp"><button class="active" data-node="Lõi phép">✦ Lõi</button><button data-node="Quầng sáng">◉ Quầng</button><button data-node="Tia lửa">· Tia lửa</button></div><div class="mode-switch"><button class="active">Cơ bản</button><button>Nâng cao</button></div><div class="advanced-note" hidden>Đường dẫn kỹ thuật: node/root/core · CommonValues</div><div class="form-section sliders"><label>Mật độ <output>72</output><input type="range" value="72"></label><label>Kích thước <output>58</output><input type="range" value="58"></label><label>Tốc độ <output>42</output><input type="range" value="42"></label><label>Độ sáng <output>65</output><input type="range" value="65"></label><label>Màu lõi<div class="color-field"><i></i><input value="#B8E5FF"></div></label></div><div class="curve-card"><div><b>Độ mờ theo thời gian</b><button>↗</button></div><svg viewBox="0 0 240 90" role="img" aria-label="Đường cong độ mờ tăng nhanh rồi giảm"><path class="curve-grid" d="M0 22H240M0 45H240M0 68H240M60 0V90M120 0V90M180 0V90"/><path class="curve-line" d="M0 82 C35 80 38 20 72 16 S180 18 240 83"/><circle cx="72" cy="16" r="4"/><circle cx="240" cy="83" r="4"/></svg></div><button class="secondary wide">Đặt lại lớp này</button>`,
    package: () => `<div class="panel-title"><div><small>ĐÓNG GÓI</small><strong>BBS / AAA</strong></div></div><div class="demo-warning"><b>Kết quả minh hoạ</b><span>Chưa chạy validator, game hoặc backend đóng gói.</span></div><div class="score"><div><strong>82</strong><span>/100</span></div><p><b>Điểm mẫu · không phải gate thật</b><br>4 mục mẫu · 1 cần xử lý</p></div><div class="check-list"><button class="pass"><i>✓</i><span><b>Cấu trúc hợp lệ · mẫu</b><small>3 lớp · 0 node hỏng</small></span></button><button class="pass"><i>✓</i><span><b>Texture đầy đủ · mẫu</b><small>4 tệp · 1,8 MB</small></span></button><button class="pass"><i>✓</i><span><b>License & credits · mẫu</b><small>CC0 · đã ghi nguồn</small></span></button><button class="warn"><i>!</i><span><b>Tương thích AAA 2.2.3 · mẫu</b><small>Blend Add sẽ được xấp xỉ</small></span></button><button><i>○</i><span><b>Kiểm trong game thật</b><small>NOT_RUN · bắt buộc trước khi duyệt</small></span></button></div><div class="package-actions"><label>Chế độ cue<select id="cueMode"><option>Tự phát</option><option>Phát thủ công</option></select></label><button class="secondary" disabled title="Chưa nối backend bbs-package">Xuất gói BBS / AAA</button><button class="primary" disabled title="Chưa có bridge App 2">Gửi sang App 2 <span>→</span></button><small class="blocked-reason">Khoá trong prototype: cần backend đóng gói và bridge App 2.</small></div>`
  };

  function renderEffects() {
    const effects = filterEffects(state.effects, { query:$("#searchInput").value, type:$("#typeFilter").value, verified:$("#verifiedFilter").checked, color:$("#colorFilter").value, duration:$("#durationFilter").value, loop:$("#loopFilter").value, source:$("#sourceFilter").value, license:$("#licenseFilter").value });
    $("#libraryCount").textContent = `${effects.length} hiệu ứng`;
    $("#emptyState").hidden = effects.length > 0;
    $("#effectList").hidden = effects.length === 0;
    $("#effectList").innerHTML = effects.map((effect) => `<button role="option" aria-selected="${effect.id === state.selected.id}" class="effect-card ${effect.id === state.selected.id ? 'selected':''}" data-effect="${effect.id}" style="--accent:${effect.accent}"><span class="thumb"><i></i><em>${effect.loop ? '↻' : '1×'}</em></span><span class="card-copy"><b>${effect.name}</b><small>${effect.type} · ${String(effect.duration).replace('.', ',')}s</small><span>${effect.gameVerified ? '<i class="mini-check">✓</i> Mẫu: đã chạy game' : 'Mẫu: chưa kiểm game'}</span></span></button>`).join("");
    $$('[data-effect]').forEach((button) => button.addEventListener('click', () => selectEffect(button.dataset.effect)));
  }

  function selectEffect(id) {
    state.selected = state.effects.find((effect) => effect.id === id) || state.selected;
    $("#sceneTitle").textContent = state.selected.name;
    $("#timelineTitle").textContent = state.selected.name;
    $("#sceneMeta").textContent = `${String(state.selected.duration).replace('.', ',')} s · ${state.selected.loop ? 'Lặp' : 'Một lần'} · 2,0 block`;
    $("#effectVisual").style.setProperty('--effect-accent', state.selected.accent);
    const visual=$("#effectVisual");
    if(state.selected.previewUrl){ visual.classList.add('sprite-live'); visual.style.backgroundImage=`url("${state.selected.previewUrl}")`; visual.style.backgroundSize=`${state.selected.columns * 100}% ${state.selected.rows * 100}%`; }
    else { visual.classList.remove('sprite-live'); visual.style.backgroundImage=''; }
    updatePlayback();
    renderEffects(); renderInspector();
  }

  function renderInspector() {
    $("#inspectorContent").innerHTML = inspectorTemplates[state.view]();
    $$('[data-nav]').forEach((button) => button.addEventListener('click', () => setView(button.dataset.nav)));
    $$('[data-version]').forEach((button) => button.addEventListener('click', () => { state.versions=selectVersion(state.versions, button.dataset.version); renderInspector(); }));
    $$('.mode-switch button').forEach((button,index)=>button.addEventListener('click',()=>{ $$('.mode-switch button').forEach(b=>b.classList.remove('active'));button.classList.add('active');const note=$('.advanced-note');if(note)note.hidden=index===0; }));
    $$('[data-node]').forEach(button=>button.addEventListener('click',()=>{$$('[data-node]').forEach(b=>b.classList.remove('active'));button.classList.add('active');$('#nodeTitle').textContent=button.dataset.node;}));
    $$('.sliders input[type="range"]').forEach(input=>input.addEventListener('input',()=>{input.closest('label').querySelector('output').value=input.value;$('#effectVisual').style.filter=`brightness(${.55+Number(input.value)/100})`;}));
    $('#generateOptions')?.addEventListener('click',()=>showToast('Đã tạo 3 phương án mô phỏng A / B / C. Chưa gọi backend.'));
    $('#revisionButton')?.addEventListener('click',()=>{state.versions=addVersion(state.versions,$('#revisionInput').value);renderInspector();showToast('Đã thêm phiên bản mô phỏng, lịch sử cũ được giữ.');});
  }

  function setView(view) {
    state.view = view;
    $$('.flow-tabs button').forEach((button) => button.classList.toggle('active', button.dataset.view === view));
    document.body.dataset.view = view;
    renderInspector();
    if (view === 'generate') showToast('Điền mô tả, chỉnh EffectSpec rồi tạo nhiều phương án.');
  }

  function showToast(message) {
    const toast=$("#toast"); toast.textContent=message; toast.hidden=false;
    clearTimeout(showToast.timer); showToast.timer=setTimeout(() => { toast.hidden=true; }, 2800);
  }

  function updatePlayback() {
    const scrubber=$("#scrubber"); if(!scrubber)return;
    const ratio=Number(scrubber.value)/100, duration=state.selected.duration || 1, current=ratio*duration;
    $("#timecode").textContent=`00:${current.toFixed(2).padStart(5,'0')} / 00:${duration.toFixed(2).padStart(5,'0')}`;
    $(".playhead").style.left=`${ratio*100}%`;
    if(state.selected.previewUrl){ const frame=Math.min(state.selected.frames-1,Math.floor(ratio*state.selected.frames)); const col=frame%state.selected.columns,row=Math.floor(frame/state.selected.columns); $("#effectVisual").style.backgroundPosition=`${state.selected.columns===1?0:col/(state.selected.columns-1)*100}% ${state.selected.rows===1?0:row/(state.selected.rows-1)*100}%`; }
  }

  function setLoadState(kind, message) {
    state.loadState=kind;
    if (kind === 'loading') { $("#effectList").innerHTML='<div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div>'; $("#libraryCount").textContent='Đang tải…'; }
    if (kind === 'error') { $("#effectList").innerHTML=`<div class="error-state"><b>Không tải được preview thật</b><p>${message || 'Route không phản hồi.'}</p><button data-action="retry">Thử lại</button></div>`; $("#libraryCount").textContent='Dữ liệu mẫu vẫn khả dụng'; }
  }

  async function loadEffects() {
    const params=new URLSearchParams(location.search); const live=params.get('previews');
    if (live) {
      setLoadState('loading');
      try {
        const base=live === '1' || live === 'true' ? '' : live.replace(/\/$/, '');
        const response=await fetch(`${base}/api/unified/vfx-previews`); if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload=await response.json(); const sheetEntries=payload && payload.sheets && !Array.isArray(payload.sheets) ? Object.entries(payload.sheets) : null; const rows=sheetEntries ? sheetEntries.map(([name,meta])=>({name,...meta,previewUrl:`${base}/api/unified/vfx-previews/${encodeURIComponent(name)}`})) : (Array.isArray(payload) ? payload : payload.effects || payload.items || []);
        if (rows.length) state.effects=rows.map((row,index) => ({ id:row.id || row.effectId || normalizeText(row.name).replace(/\s+/g,'-') || `live-${index}`, name:row.name || row.label || `Hiệu ứng ${index+1}`, type:row.type || 'Bảng sprite thật', colors:row.colors || [], duration:Number(row.duration || (row.frames && row.fps ? row.frames/row.fps : 1)), loop:Boolean(row.loop), source:row.source || 'Studio route', license:row.license || 'Chưa rõ', gameVerified:Boolean(row.gameVerified), renderer:'sprite', accent:row.accent || '#68a7ff', previewUrl:row.previewUrl || row.url, frames:Number(row.frames||1), columns:Number(row.columns||1), rows:Number(row.rows||1) }));
        state.selected=state.effects[0] || state.selected; renderEffects(); selectEffect(state.selected.id); showToast(`Đã đọc ${state.effects.length} preview từ Studio.`);
      } catch (error) { setLoadState('error', `${error.message}. Bỏ ?previews để dùng dữ liệu mẫu.`); setTimeout(renderEffects, 2400); }
      return;
    }
    try { const response=await fetch('mock-effects.json'); if (response.ok) state.effects=await response.json(); } catch (_) { /* file:// uses embedded fallback */ }
    state.selected=state.effects[0]; renderEffects(); selectEffect(state.selected.id);
  }

  function initDividers() {
    const bench=$(".workbench"), defaults={left:280,right:310,bottom:190};
    for (const key of Object.keys(defaults)) { const saved=Number(localStorage.getItem(`vfx-layout-${key}`)); if (saved) bench.style.setProperty(`--${key}`, `${saved}px`); }
    $$('[data-divider]').forEach((divider) => {
      const key=divider.dataset.divider;
      const apply=(value) => { const limits=key==='bottom'?[130,330]:key==='left'?[220,430]:[260,430]; const clamped=Math.max(limits[0],Math.min(limits[1],value)); bench.style.setProperty(`--${key}`,`${clamped}px`); localStorage.setItem(`vfx-layout-${key}`,clamped); };
      divider.addEventListener('pointerdown',(event) => { divider.setPointerCapture(event.pointerId); const start={x:event.clientX,y:event.clientY,value:parseFloat(getComputedStyle(bench).getPropertyValue(`--${key}`))}; const move=(e) => apply(key==='left'?start.value+e.clientX-start.x:key==='right'?start.value-(e.clientX-start.x):start.value-(e.clientY-start.y)); const end=() => { divider.removeEventListener('pointermove',move); divider.removeEventListener('pointerup',end); }; divider.addEventListener('pointermove',move); divider.addEventListener('pointerup',end); });
      divider.addEventListener('dblclick',() => { localStorage.removeItem(`vfx-layout-${key}`); apply(defaults[key]); });
      divider.addEventListener('keydown',(event) => { const d=(event.key==='ArrowRight'||event.key==='ArrowDown')?10:(event.key==='ArrowLeft'||event.key==='ArrowUp')?-10:0; if(d){ event.preventDefault(); const current=parseFloat(getComputedStyle(bench).getPropertyValue(`--${key}`)); apply(current+(key==='right'||key==='bottom'?-d:d)); } });
    });
  }

  function init() {
    const fill=(selector,values)=>$(selector).insertAdjacentHTML('beforeend',[...new Set(values)].map(value=>`<option>${value}</option>`).join(''));
    fill('#typeFilter',FALLBACK_EFFECTS.map(e=>e.type)); fill('#colorFilter',FALLBACK_EFFECTS.flatMap(e=>e.colors)); fill('#sourceFilter',FALLBACK_EFFECTS.map(e=>e.source)); fill('#licenseFilter',FALLBACK_EFFECTS.map(e=>e.license));
    ['input','change'].forEach(event => ['#searchInput','#typeFilter','#verifiedFilter','#colorFilter','#durationFilter','#loopFilter','#sourceFilter','#licenseFilter'].forEach(selector=>$(selector).addEventListener(event,renderEffects)));
    $("#scrubber").addEventListener('input',updatePlayback);
    $("#speedSelect").addEventListener('change',()=>$("#effectVisual").style.animationDuration=`${2/Number($("#speedSelect").value)}s`);
    $$('.flow-tabs button').forEach((button)=>button.addEventListener('click',()=>setView(button.dataset.view)));
    $$('[data-bg]').forEach((button)=>button.addEventListener('click',()=>{ $$('[data-bg]').forEach(b=>b.classList.remove('active')); button.classList.add('active'); $("#scene").className=`scene scene-${button.dataset.bg}`; }));
    $("#helpButton").addEventListener('click',()=>$("#helpDialog").showModal());
    $("#main").addEventListener('click',(event)=>{ const action=event.target.closest('[data-action]')?.dataset.action; if(!action)return; if(action==='clear-filters'){ $("#searchInput").value=''; $("#typeFilter").value=''; $("#verifiedFilter").checked=false; renderEffects(); } if(action==='play'){ state.playing=!state.playing; event.target.closest('button').textContent=state.playing?'Ⅱ':'▶'; $("#effectVisual").classList.toggle('paused',!state.playing); } if(action==='loop') event.target.closest('button').classList.toggle('active'); if(action==='fit') showToast('Đã đưa hiệu ứng vừa khung (F).'); if(action==='export') showToast('Prototype: gói chưa được tạo. Backend bbs-package sẽ thực hiện bước này.'); if(action==='send-app2') showToast(`Prototype: sẽ gửi cue “${$("#cueMode")?.value || 'Tự phát'}” sang App 2.`); });
    setInterval(()=>{if(!state.playing)return;const scrubber=$("#scrubber"),speed=Number($("#speedSelect").value);let value=Number(scrubber.value)+speed; if(value>100)value=$('[data-action="loop"]').classList.contains('active')?0:100;scrubber.value=String(value);updatePlayback();},100);
    document.addEventListener('keydown',(event)=>{ if(['INPUT','SELECT','TEXTAREA'].includes(event.target.tagName))return; const key=event.key.toLowerCase(); if(event.key===' '){event.preventDefault();$('[data-action="play"]').click();} if(key==='k'&&state.playing)$('[data-action="play"]').click(); if(key==='j'||key==='l'){const s=$("#scrubber");s.value=String(Math.max(0,Math.min(100,Number(s.value)+(key==='j'?-4:4))));updatePlayback();} if(key==='f')$('[data-action="fit"]').click(); if('12345'.includes(key)){ const b=$(`[data-workspace="${key}"]`); if(b){$$('[data-workspace]').forEach(x=>x.classList.remove('active'));b.classList.add('active');showToast(key==='4'?'Đang ở workspace VFX.':`Prototype: workspace ${key} chưa được nối URL.`);} } });
    initDividers(); renderInspector(); loadEffects();
  }
  document.addEventListener('DOMContentLoaded',init);
  return { normalizeText, filterEffects, createInitialVersions, addVersion, selectVersion };
});
