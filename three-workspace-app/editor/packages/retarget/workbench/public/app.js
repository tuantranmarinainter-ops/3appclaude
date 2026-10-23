// App 1 Workbench UI. Every number shown comes from the server's inspect result or the run's report.json.
import { Viewer, FPS } from './viewer.js'
import { executeTransfer } from './transfer.js'

const $ = (id) => document.getElementById(id)
/** Tiny DOM builder; text always goes through textContent so file/bone names can never inject markup. */
function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag)
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === undefined || value === null || value === false) continue
    if (key === 'class') el.className = value
    else if (key === 'text') el.textContent = value
    else if (key.startsWith('on')) el.addEventListener(key.slice(2), value)
    else if (key === 'dataset') Object.assign(el.dataset, value)
    else if (value === true) el.setAttribute(key, '')
    else el.setAttribute(key, value)
  }
  for (const kid of kids.flat()) if (kid !== null && kid !== undefined && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)))
  return el
}
const clear = (el) => { el.replaceChildren(); return el }
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms))
const fmtBytes = (n) => n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n >= 1024 ? `${(n / 1024).toFixed(0)} KB` : `${n} B`
const fmt = (n, digits = 2) => (typeof n === 'number' && Number.isFinite(n) ? n.toFixed(digits) : '–')

const CODE_HINTS = {
  NO_ACTION: 'Nguồn không có Action nào (hoặc chỉ số Action được chọn không tồn tại).',
  MISSING_REQUIRED_JOINTS: 'Thiếu xương chính (Hips, Spine, Head, tay, chân). Sửa ở tab Mapping rồi xác nhận.',
  ACTION_EMPTY: 'Action rỗng (không có thời lượng): có thể là một tư thế đơn.',
  ACTION_UNSUPPORTED: 'Action có kênh không hỗ trợ.',
  ACTION_FAILED: 'Bake Action bị lỗi.',
  ACTION_BUDGET: 'Action vượt giới hạn số mẫu.',
  MODEL_MODE_FAMILY_UNSUPPORTED: 'Model mode đợt 1 chỉ hỗ trợ nguồn có rig kiểu Mixamo.',
  DRACO_UNSUPPORTED: 'Nguồn nén Draco/meshopt: cần giải nén trước khi dùng Model mode.',
}
const QUALITY_TITLES = {
  HIPS_BELOW_GROUND: 'Hông chui xuống đất', HIPS_TOO_HIGH: 'Hông bay quá cao', FEET_PENETRATE: 'Chân lún dưới mặt sàn', FOOT_SLIDE: 'Trượt chân khi đang chạm đất',
}
const STAGES = { queued: 'Đang xếp hàng', inspect: 'Đọc rig & ghép mapping', bake: 'Bake Action', roundtrip: 'Đọc lại GLB & đo chất lượng', model: 'Dựng model + skin', bobj: 'Xuất .bobj Minecraft20', original: 'Áp về bộ xương gốc' }

const state = {
  source: null, targets: [], target: null,
  inspect: null, inspecting: false, inspectError: null, inspectSeq: 0,
  rows: [], filter: 'all', search: '', preset: null, presetFamily: null, dirty: false,
  actionRanges: {}, checked: new Set(), actionFilter: '',
  run: null, running: false, result: null, stale: false, resultOptions: null, actionMap: new Map(),
  selected: null, scale: { applied: null },
  libraryCharacters: null, libraryDestinations: new Set(), libraryActions: new Map(),
  transferFailed: [], transferRunning: false, requestBobj: false,
}

// ---------------------------------------------------------------- feedback
function toast(message, kind = 'info', sticky = false) {
  const el = h('div', { class: `toast ${kind}`, role: kind === 'err' ? 'alert' : 'status' }, h('span', { text: message }), h('button', { type: 'button', 'aria-label': 'Đóng', text: '×', onclick: () => el.remove() }))
  $('toasts').append(el)
  if (!sticky) setTimeout(() => el.remove(), kind === 'err' ? 12000 : 5000)
}
window.addEventListener('error', (event) => toast(`Lỗi giao diện: ${event.message}`, 'err'))
window.addEventListener('unhandledrejection', (event) => toast(`Lỗi: ${event.reason?.message ?? event.reason}`, 'err'))

async function api(path, { method = 'GET', json, body, headers } = {}) {
  let response
  try {
    response = await fetch(path, { method, headers: { ...(json ? { 'content-type': 'application/json' } : {}), ...headers }, body: json ? JSON.stringify(json) : body })
  } catch {
    throw new Error('Không kết nối được máy chủ Workbench. Kiểm tra cửa sổ lệnh còn chạy không.')
  }
  const text = await response.text()
  let data
  try { data = JSON.parse(text) } catch { /* not JSON */ }
  if (!response.ok) throw new Error(data?.error ?? `Máy chủ trả lỗi ${response.status}`)
  return data
}

// ---------------------------------------------------------------- viewer + timeline
const viewer = new Viewer($('leftHost'), $('rightHost'), onViewerFrame)
let scrubbing = false, frames = 0, wasPlaying = true
function onViewerFrame(time) {
  const frame = Math.round(time * FPS)
  if (!scrubbing) $('timeline').value = String(frame)
  $('frameLabel').textContent = `${frame} / ${frames} · ${time.toFixed(2)}s`
}
function setOverlay(side, text, error = false) {
  const el = $(side === 'left' ? 'leftMsg' : 'rightMsg')
  el.textContent = text ?? ''
  el.classList.toggle('err', error)
}
$('playBtn').addEventListener('click', () => { viewer.playing = !viewer.playing; $('playBtn').textContent = viewer.playing ? '❚❚' : '▶' })
$('timeline').addEventListener('pointerdown', () => { scrubbing = true; wasPlaying = viewer.playing; viewer.playing = false })
$('timeline').addEventListener('input', (event) => { viewer.seek(Number(event.target.value) / FPS); viewer.apply() })
window.addEventListener('pointerup', () => { if (!scrubbing) return; scrubbing = false; viewer.playing = wasPlaying })
$('timeline').addEventListener('keydown', () => { viewer.playing = false; $('playBtn').textContent = '▶' })
$('speedSel').addEventListener('change', (event) => { viewer.speed = Number(event.target.value) })
$('tgMesh').addEventListener('change', (event) => viewer.setToggle('mesh', event.target.checked))
$('tgSkel').addEventListener('change', (event) => viewer.setToggle('skeleton', event.target.checked))
$('tgGrid').addEventListener('change', (event) => viewer.setToggle('grid', event.target.checked))
$('frameBtn').addEventListener('click', () => viewer.frameAll())
$('actionSel').addEventListener('change', (event) => selectAction(Number(event.target.value)))

/** Contact ranges (frame pairs, from report.quality) as colored ticks above the timeline. */
function drawContacts(contactRanges, total) {
  const canvas = $('contactCanvas')
  const width = canvas.clientWidth || 300
  canvas.width = width
  const ctx = canvas.getContext('2d')
  ctx.clearRect(0, 0, width, canvas.height)
  if (!contactRanges || !total) return
  const css = getComputedStyle(document.documentElement)
  const draw = (ranges, y, color) => {
    ctx.fillStyle = color
    for (const [a, b] of ranges ?? []) ctx.fillRect(Math.floor(a / total * width), y, Math.max(2, Math.ceil((b - a + 1) / total * width)), 6)
  }
  draw(contactRanges.left, 0, css.getPropertyValue('--left-foot').trim() || '#2563eb')
  draw(contactRanges.right, 7, css.getPropertyValue('--right-foot').trim() || '#ea580c')
}

function selectAction(sourceIndex) {
  state.selected = sourceIndex
  const action = state.inspect?.actions?.[sourceIndex]
  const mapped = state.actionMap.get(sourceIndex)
  const duration = mapped?.duration ?? action?.durationSeconds ?? 1
  const info = viewer.select({ sourceIndex: state.source?.format === 'bobj' ? null : sourceIndex, glbIndex: state.stale ? null : mapped?.glbIndex ?? null, duration })
  frames = Math.round(duration * FPS)
  $('timeline').max = String(frames)
  $('actionSel').value = String(sourceIndex)
  drawContacts(state.stale ? null : mapped?.quality?.contactRanges, frames + 1)
  const parts = []
  let bad = false
  if (info.source && action && viewer.source?.animations[sourceIndex] && viewer.source.animations[sourceIndex].name !== action.name) { parts.push('Tên clip nguồn trong viewer khác tên Action'); bad = true }
  if (info.right) {
    parts.push(`Track gắn vào đích: ${info.right.bound}/${info.right.total}`)
    if (info.right.bound < info.right.total) bad = true
  } else if (state.result && !mapped) { parts.push('Action này chưa được xuất'); bad = true }
  const staleMsg = 'Đã đổi tuỳ chọn/mapping: chạy lại để xem kết quả mới.'
  if (state.stale && state.result) setOverlay('right', staleMsg)
  else if ($('rightMsg').textContent === staleMsg) setOverlay('right', '')
  $('bindInfo').textContent = parts.join(' · ')
  $('bindInfo').classList.toggle('bad', bad)
  renderActions(false)
  renderActionPicker()
}

function fillActionSelect() {
  const select = clear($('actionSel'))
  const actions = state.inspect?.actions ?? []
  for (const action of actions) select.append(h('option', { value: String(action.index), text: `${action.index} · ${action.displayName ?? action.name} (${fmt(action.durationSeconds)} s)${state.result && !state.stale && !state.actionMap.has(action.index) ? ' — chưa xuất' : ''}` }))
  select.disabled = !actions.length
  renderActionPicker()
}

// ---------------------------------------------------------------- pinned source Action picker
const picker = $('actionPicker'), pickerStorageKey = 'w01.actionPicker.v1'
function openActionPicker() { picker.hidden = false; $('actionPickerBtn').setAttribute('aria-expanded', 'true'); renderActionPicker() }
function closeActionPicker() { picker.hidden = true; $('actionPickerBtn').setAttribute('aria-expanded', 'false') }
function savePickerBounds() {
  if (picker.hidden || picker.offsetWidth < 100 || picker.offsetHeight < 100) return
  try { localStorage.setItem(pickerStorageKey, JSON.stringify({ left: picker.style.left, top: picker.style.top, width: picker.style.width, height: picker.style.height })) } catch { /* storage can be disabled or full */ }
}
function restorePickerBounds() {
  try {
    const saved = JSON.parse(localStorage.getItem(pickerStorageKey) ?? 'null')
    if (saved) for (const key of ['left', 'top', 'width', 'height']) if (typeof saved[key] === 'string' && /^\d+(?:\.\d+)?px$/.test(saved[key])) picker.style[key] = saved[key]
    const left = Math.max(0, Math.min(innerWidth - 120, parseFloat(picker.style.left) || 0)), top = Math.max(0, Math.min(innerHeight - 60, parseFloat(picker.style.top) || 0))
    picker.style.left = `${left}px`; picker.style.top = `${top}px`
  } catch { /* ignore corrupt local preference */ }
}
function actionMatches(action, query) { const q = query.trim().toLocaleLowerCase('vi'); return !q || `${action.name} ${action.nameVi ?? ''} ${action.index}`.toLocaleLowerCase('vi').includes(q) }
function actionQuality(action) {
  const mapped = state.actionMap.get(action.index), skipped = state.result?.report?.skippedActions?.find((item) => item.index === action.index)
  if (skipped) return { text: skipped.code, class: 'warn', title: skipped.message }
  if (mapped?.perAction) return { text: mapped.perAction.status, class: mapped.perAction.status, title: (mapped.quality?.warnings ?? []).map((item) => item.message).join('\n') }
  return { text: action.ready ? 'Sẵn sàng' : 'Cần kiểm tra', class: action.ready ? 'PASS' : 'warn', title: '' }
}
function renderActionPicker() {
  if (!picker || picker.hidden) return
  const actions = state.inspect?.actions ?? [], query = $('actionPickerSearch').value
  $('actionPickerCount').textContent = `đã chọn ${selectedActionIndices().length}/${actions.length}`
  $('transferOpen').disabled = !actions.length || !selectedActionIndices().length || !state.target || state.transferRunning
  const body = h('tbody')
  for (const action of actions.filter((item) => actionMatches(item, query))) {
    const check = h('input', { type: 'checkbox', 'aria-label': `Chọn ${action.name}`, onclick: (event) => event.stopPropagation(), onchange: (event) => {
      event.target.checked ? state.checked.add(action.index) : state.checked.delete(action.index); markRunInputsChanged(false); renderActionPicker()
    } }); check.checked = state.checked.has(action.index)
    const quality = actionQuality(action)
    body.append(h('tr', { class: `clickable${state.selected === action.index ? ' active' : ''}`, dataset: { index: String(action.index) }, onclick: () => selectAction(action.index) },
      h('td', {}, check), h('td', { class: 'num', text: String(action.index + 1) }), h('td', { class: 'name', text: action.displayName ?? action.name }),
      h('td', { class: 'num', text: `${fmt(action.durationSeconds)} s` }), h('td', { class: 'quality' }, h('span', { class: `chip ${quality.class}`, title: quality.title, text: quality.text }))))
  }
  if (!body.children.length) body.append(h('tr', {}, h('td', { colspan: 5, class: 'empty', text: 'Không có animation khớp.' })))
  clear($('actionPickerList')).append(h('table', {}, h('thead', {}, h('tr', {}, h('th'), h('th', { text: '#' }), h('th', { text: 'Tên Anh | Việt' }), h('th', { text: 'Thời lượng' }), h('th', { text: 'Chất lượng' }))), body))
}
$('actionPickerBtn').addEventListener('click', openActionPicker)
$('actionPickerClose').addEventListener('click', closeActionPicker)
$('actionPickerSearch').addEventListener('input', renderActionPicker)
$('actionPickerAll').addEventListener('click', () => { for (const action of state.inspect?.actions ?? []) state.checked.add(action.index); markRunInputsChanged(false); renderActionPicker() })
$('actionPickerNone').addEventListener('click', () => { state.checked.clear(); markRunInputsChanged(false); renderActionPicker() })
$('actionPickerInvert').addEventListener('click', () => { for (const action of state.inspect?.actions ?? []) state.checked.has(action.index) ? state.checked.delete(action.index) : state.checked.add(action.index); markRunInputsChanged(false); renderActionPicker() })
window.addEventListener('keydown', (event) => { if ((event.key === 'a' || event.key === 'A') && !event.ctrlKey && !event.metaKey && !event.altKey && !event.target.matches('input,textarea,select')) { event.preventDefault(); openActionPicker() } })
let pickerDrag = null
$('actionPickerHandle').addEventListener('pointerdown', (event) => { if (event.target.closest('button')) return; const rect = picker.getBoundingClientRect(); pickerDrag = { x: event.clientX - rect.left, y: event.clientY - rect.top }; event.currentTarget.setPointerCapture(event.pointerId) })
$('actionPickerHandle').addEventListener('pointermove', (event) => { if (!pickerDrag) return; picker.style.left = `${Math.max(0, Math.min(innerWidth - 120, event.clientX - pickerDrag.x))}px`; picker.style.top = `${Math.max(0, Math.min(innerHeight - 60, event.clientY - pickerDrag.y))}px` })
$('actionPickerHandle').addEventListener('pointerup', () => { pickerDrag = null; savePickerBounds() })
new ResizeObserver(savePickerBounds).observe(picker)
restorePickerBounds()

// ---------------------------------------------------------------- steps
function setStep(n, status, label) {
  const el = $(`step${n}`)
  el.classList.remove('locked', 'active', 'done', 'busy', 'error', 'blocked')
  el.classList.add(status)
  $(`state${n}`).textContent = label
}
function canRunReason() {
  if (!state.source) return 'Chọn nguồn ở bước 1.'
  if (state.inspecting) return 'Đang kiểm tra…'
  if (!state.inspect) return 'Bấm "Kiểm tra" ở bước 3.'
  if (state.inspect.blocker) return `Đang bị chặn: ${state.inspect.blocker.code}.`
  if (state.dirty) return 'Mapping đã sửa nhưng chưa xác nhận (tab Mapping).'
  if (state.inspect.mapping.needsUserConfirmation && !state.preset) return 'Mapping gợi ý theo hình học: cần xác nhận ở tab Mapping trước khi chạy.'
  if (!selectedActionIndices().length) return 'Chưa chọn Action nào để xuất (tab Actions).'
  return null
}
function refreshSteps() {
  const source = state.source, inspect = state.inspect
  setStep(1, source ? 'done' : 'active', source ? 'Đã chọn' : 'Cần chọn')
  setStep(2, !source ? 'locked' : 'done', state.target ? 'Đã chọn' : 'Cần chọn')
  if (!source) setStep(3, 'locked', 'Chờ bước 1')
  else if (state.inspecting) setStep(3, 'busy', 'Đang kiểm tra')
  else if (state.inspectError) setStep(3, 'error', 'Lỗi')
  else if (!inspect) setStep(3, 'active', 'Cần chạy')
  else if (inspect.blocker) setStep(3, 'blocked', 'BLOCKED')
  else setStep(3, 'done', 'Xong')
  if (!inspect) setStep(4, 'locked', 'Chờ bước 3')
  else setStep(4, 'active', 'Tuỳ chọn')
  const reason = canRunReason()
  if (state.running) setStep(5, 'busy', 'Đang chạy')
  else if (state.result && !state.stale) setStep(5, state.result.status === 'PASS' ? 'done' : state.result.status === 'BLOCKED' ? 'blocked' : 'error', state.result.status)
  else if (!inspect || inspect.blocker) setStep(5, 'locked', 'Chờ bước 3')
  else setStep(5, reason ? 'locked' : 'active', reason ? 'Chưa sẵn sàng' : 'Sẵn sàng')
  // Step 5's body stays visible once step 3 is done so the reason a run is disabled is readable.
  if (inspect && !inspect.blocker) $('step5').classList.remove('locked')
  $('runBtn').disabled = state.running || !!reason
  $('runBtn').title = reason ?? ''
  $('inspectBtn').disabled = !source || state.inspecting || state.running
  $('runInfo').replaceChildren(...(reason && !state.running ? [h('span', { text: reason })] : []),
    ...(state.stale && state.result ? [h('span', { class: 'chip warn', text: 'Kết quả cũ: đã đổi tuỳ chọn/mapping, chạy lại để cập nhật' })] : []))
  if (!reason && !state.running && !state.result) $('runInfo').textContent = 'Sẵn sàng. Bấm "Chạy chuẩn hoá".'
}

// ---------------------------------------------------------------- step 1: source
async function useSource(info) {
  state.source = info; state.inspect = null; state.inspectError = null; state.rows = []; state.preset = null; state.presetFamily = null; state.dirty = false
  state.result = null; state.stale = false; state.actionMap = new Map(); state.checked = new Set(); state.actionRanges = {}; state.selected = null
  viewer.clearResult(); fillActionSelect(); drawContacts(null, 0); frames = 0; $('timeline').max = '0'
  $('armatureBox').hidden = info.format !== 'bobj'
  clear($('sourceInfo')).append(h('span', {}, h('b', { text: info.name }), ` · .${info.format} · ${fmtBytes(info.bytes)}`), h('span', { text: `sha256 ${info.sha256.slice(0, 16)}…` }),
    h('span', { text: info.uploaded ? 'Đã tải lên thư mục tạm của phiên (file gốc không bị chạm vào).' : `Đọc tại chỗ: ${info.path}` }))
  renderAll()
  refreshSteps()
  if (info.format === 'bobj') { viewer.clearSource(); setOverlay('left', 'Nguồn .bobj là thư viện Action của Minecraft20, không có mesh.\nXem kết quả ở khung bên phải.') }
  else {
    setOverlay('left', 'Đang tải nguồn vào viewer…')
    try {
      await viewer.loadSource(`/api/sources/${info.sourceId}/file`, info.format)
      if (state.source === info) setOverlay('left', '')
    } catch (error) {
      viewer.clearSource()
      if (state.source === info) setOverlay('left', `Không dựng được viewer cho nguồn này (vẫn có thể kiểm tra và chạy):\n${error.message}`, true)
    }
  }
  inspectNow()
}
async function uploadFile(file) {
  if (!file) return
  if (!/\.(glb|fbx|bobj)$/i.test(file.name)) { toast(`Định dạng không hỗ trợ: ${file.name}. Dùng .glb .fbx .bobj, hoặc dán đường dẫn cho .gltf.`, 'err'); return }
  setStep(1, 'busy', 'Đang tải lên')
  try {
    const info = await api('/api/sources', { method: 'POST', headers: { 'x-file-name': encodeURIComponent(file.name) }, body: file })
    await useSource(info)
  } catch (error) { toast(error.message, 'err'); refreshSteps() }
}
async function usePath() {
  const path = $('pathInput').value.trim()
  if (!path) { toast('Dán đường dẫn file vào ô trước.', 'err'); return }
  setStep(1, 'busy', 'Đang đọc')
  try {
    const armaturePath = $('armatureInput').value.trim()
    await useSource(await api('/api/sources', { method: 'POST', json: { path, ...(armaturePath ? { armaturePath } : {}) } }))
  } catch (error) { toast(error.message, 'err'); refreshSteps() }
}
$('drop').addEventListener('click', () => $('fileInput').click())
$('drop').addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); $('fileInput').click() } })
$('fileInput').addEventListener('change', (event) => { uploadFile(event.target.files[0]); event.target.value = '' })
for (const type of ['dragenter', 'dragover']) $('drop').addEventListener(type, (event) => { event.preventDefault(); $('drop').classList.add('over') })
for (const type of ['dragleave', 'drop']) $('drop').addEventListener(type, (event) => { event.preventDefault(); $('drop').classList.remove('over') })
$('drop').addEventListener('drop', (event) => uploadFile(event.dataTransfer.files[0]))
$('pathBtn').addEventListener('click', usePath)
$('addTargetBtn').addEventListener('click', async () => {
  const path = $('addTargetPath').value.trim()
  if (!path) { toast('Nhập đường dẫn file .glb của nhân vật', 'err'); return }
  $('addTargetBtn').disabled = true
  try {
    const target = await api('/api/targets', { method: 'POST', json: { path, name: $('addTargetName').value.trim() } })
    state.targets = (await api('/api/targets')).targets
    renderTargets()
    toast(`Đã thêm nhân vật đích ${target.name} (hông ${fmt(target.hipsHeightMeters)} m) vào thư viện`, 'ok')
    $('addTargetPath').value = ''; $('addTargetName').value = ''
  } catch (error) { toast(`Không thêm được: ${error.message}`, 'err') }
  finally { $('addTargetBtn').disabled = false }
})
$('pathInput').addEventListener('keydown', (event) => { if (event.key === 'Enter') usePath() })
// A stray drop outside the zone must not navigate away to the file.
for (const type of ['dragover', 'drop']) window.addEventListener(type, (event) => event.preventDefault())

// ---------------------------------------------------------------- step 2: target
function renderTargets() {
  const box = clear($('targets'))
  for (const target of state.targets) {
    const selected = state.target?.id === target.id && !state.mc20
    box.append(h('button', { type: 'button', class: 'target', role: 'radio', 'aria-checked': String(selected), onclick: () => { setMc20(false); chooseTarget(target) } },
      h('b', { text: target.library ? target.name : `Nhân vật ${target.name}` }), h('small', { text: `${target.original ? 'bộ xương gốc · ' : target.library ? 'thư viện · ' : ''}hông ${fmt(target.hipsHeightMeters)} m` })))
  }
  // Minecraft20 is an extra output on top of the Mixamo65 GLB (the solver is Mixamo65 → Minecraft20), so it rides on the selected character.
  box.append(h('button', { type: 'button', class: 'target', role: 'radio', 'aria-checked': String(!!state.mc20 && !state.mc20Skin), onclick: () => setMc20(true) },
    h('b', { text: 'Minecraft 20' }), h('small', { text: 'xuất .bobj cho BBS FS' })))
  // Named Minecraft20 characters (library skins): same .bobj output, previewed on the mannequin wearing their skin.
  for (const character of state.mc20Characters ?? []) {
    box.append(h('button', { type: 'button', class: 'target', role: 'radio', 'aria-checked': String(!!state.mc20 && state.mc20Skin === character.id), onclick: () => setMc20(true, character.id) },
      h('b', { text: character.name }), h('small', { text: 'Minecraft 20 · skin thư viện' })))
  }
}
function setMc20(on, skinId = null) {
  if (!!state.mc20 === on && (state.mc20Skin ?? null) === skinId) return
  state.mc20 = on; state.mc20Skin = on ? skinId : null
  // Switching the view never touches the options (that would mark the result stale); only a missing .bobj output is turned on.
  const box = $('optionsForm').elements.bobj
  if (on && !box.checked) { box.checked = true; box.dispatchEvent(new Event('change', { bubbles: true })) }
  renderTargets()
  $('rightCaption').textContent = on ? 'Kết quả trên ma-nơ-canh Minecraft 20 (.bobj)' : 'Kết quả trên nhân vật đích'
  if (!on) { viewer.hideSteve(); setOverlay('right', ''); if (state.selected !== undefined) selectAction(state.selected); return }
  showSteveResult()
}
/** Steve in the right pane; with a run that wrote a .bobj, its Actions play on him (the GLB still uses the Mixamo character). */
async function showSteveResult() {
  setOverlay('right', 'Đang tải ma-nơ-canh Minecraft 20…')
  try {
    await viewer.showSteve(state.mc20Skin ?? null)
    const run = state.result?.files?.some((file) => file.kind === 'bobj') ? state.result.runId : null
    if (run) await viewer.loadSteveClips(run)
    setOverlay('right', '')
    if (!run) toast('Đã nạp ma-nơ-canh Minecraft 20 (tay chân trái xanh, phải cam). Bấm "Chạy chuẩn hoá" để xuất .bobj và phát animation.', 'ok')
  } catch (error) { setOverlay('right', `Không tải được ma-nơ-canh: ${error.message}`, true) }
  if (state.selected !== undefined) selectAction(state.selected)
}
async function chooseTarget(target) {
  if (state.target?.id === target.id) return
  state.target = target
  state.result = null; state.stale = false; state.actionMap = new Map(); state.preset = null; state.presetFamily = null; state.dirty = false
  renderTargets(); renderAll(); refreshSteps()
  setOverlay('right', 'Đang tải nhân vật đích…')
  try { await viewer.loadTarget(target.displayUrl ?? target.url); setOverlay('right', '') } catch (error) { setOverlay('right', `Không tải được nhân vật đích: ${error.message}`, true) }
  if (state.source) inspectNow()
}

// ---------------------------------------------------------------- step 3: inspect
function groundSummary(ground) {
  const rows = (ground.perAction ?? []).filter((item) => item.applied)
  const skipped = (ground.perAction ?? []).filter((item) => item.skipped).length
  const tail = skipped ? ` · BỎ QUA ${skipped} Action vì lệch quá lớn (sai đơn vị/hệ số root?)` : ''
  if (!rows.length) return `${ground.mode}: không cần dời${tail}`
  const max = Math.max(...rows.map((item) => item.maxOffsetMeters))
  return `${ground.mode}: nâng tối đa ${(max * 100).toFixed(1)} cm ở ${rows.length}/${ground.perAction.length} Action${tail}`
}

function readOptions() {
  const form = $('optionsForm')
  const get = (name) => form.elements[name]
  const number = (name) => { const value = get(name).value.trim(); return value === '' ? undefined : Number(value) }
  return {
    mode: form.elements.mode.value, rootPolicy: get('rootPolicy').value, rootScale: number('rootScale'), ground: get('ground').value, calibrate: get('calibrate').value,
    facingDegrees: number('facingDegrees'), swapSides: get('swapSides').value, unitMeters: number('unitMeters'), upAxis: get('upAxis').value, bobj: get('bobj').checked, bobjRoot: get('bobjRoot').value,
  }
}
let inspectTimer = 0
function inspectSoon() { clearTimeout(inspectTimer); inspectTimer = setTimeout(inspectNow, 450) }
async function inspectNow() {
  if (!state.source || !state.target) return
  clearTimeout(inspectTimer)
  const seq = ++state.inspectSeq
  state.inspecting = true; state.inspectError = null
  refreshSteps()
  $('inspectInfo').textContent = 'Đang đọc rig, ghép mapping, liệt kê Action…'
  try {
    const { mode, bobj, bobjRoot, ...inspectOptions } = readOptions()
    const result = await api('/api/inspect', { method: 'POST', json: { sourceId: state.source.sourceId, targetId: state.target.id, options: inspectOptions,
      ...(state.preset ? { mappingPreset: state.preset, presetFamily: state.presetFamily } : {}) } })
    if (seq !== state.inspectSeq) return
    state.inspect = result
    if (!state.preset) state.presetFamily = result.mapping.family
    state.rows = result.mapping.joints.map((joint) => ({ ...joint, original: joint.source }))
    state.dirty = false
    if (!state.checked.size) state.checked = new Set(result.actions.map((action) => action.index))
    else state.checked = new Set([...state.checked].filter((index) => result.actions[index]))
    if (state.selected === null || !result.actions[state.selected]) state.selected = result.actions.length ? 0 : null
  } catch (error) {
    if (seq !== state.inspectSeq) return
    state.inspect = null; state.inspectError = error.message
    toast(`Kiểm tra thất bại: ${error.message}`, 'err')
  }
  state.inspecting = false
  fillActionSelect()
  renderInspectInfo(); renderAll(); refreshSteps()
  if (state.inspect && state.selected !== null && !state.running) selectAction(state.selected)
}
$('inspectBtn').addEventListener('click', inspectNow)

function renderInspectInfo() {
  const box = clear($('inspectInfo'))
  const info = state.inspect
  if (state.inspectError) { box.append(h('span', { class: 'chip FAIL', text: 'Lỗi' }), h('span', { text: state.inspectError })); return }
  if (!info) { box.textContent = 'Chưa kiểm tra. Không bake — chỉ đọc rig, ghép mapping, liệt kê Action.'; return }
  box.append(...[
    h('span', {}, 'Family: ', h('b', { text: info.mapping.family }), ` · mapping ${info.mapping.mapped}/65`),
    h('span', { text: `${info.actions.length} Action · ${info.sourceBones.length} xương nguồn` }),
    info.blocker ? h('span', { class: 'chip BLOCKED', text: `BLOCKED ${info.blocker.code}` }) : h('span', { class: 'chip PASS', text: 'Có thể chạy' }),
    info.blocker ? h('span', { text: info.blocker.message }) : null,
    info.mapping.needsUserConfirmation && !state.preset ? h('span', { class: 'chip warn', text: `Mapping suy theo hình học (độ tin cậy ${fmt(info.mapping.confidence)}) — cần xác nhận` }) : null].filter(Boolean))
}

// ---------------------------------------------------------------- step 4: options
const optionsForm = $('optionsForm')
function markOptionsChanged(event) {
  state.requestBobj = !!optionsForm.elements.bobj.checked
  if (state.result) { state.stale = true; refreshSteps(); renderOverview(); if (state.selected !== null) selectAction(state.selected) }
  if (!event?.target?.matches('[name=mode], [name=bobj], [name=bobjRoot], [name=rootScale]')) inspectSoon()
  renderOptionHints()
}
optionsForm.addEventListener('input', markOptionsChanged)
optionsForm.addEventListener('change', markOptionsChanged)
/** Rotation buttons: turn the result by a quarter/half turn relative to the facing in use (or back to the measured one). */
function rotateResult(delta) {
  const input = optionsForm.elements.facingDegrees
  if (delta === 'auto') { input.value = ''; input.dispatchEvent(new Event('change', { bubbles: true })); toast('Đã bỏ xoay tay, dùng hướng đo được.', 'ok'); return }
  const current = input.value.trim() !== '' ? Number(input.value) : state.inspect?.facing?.yawDegrees ?? 0
  const next = ((current + Number(delta)) % 360 + 540) % 360 - 180 || 0
  input.value = String(next === -180 ? 180 : next)
  input.dispatchEvent(new Event('change', { bubbles: true }))
  toast(`Hướng mặt ${input.value}°. Bấm "Chạy chuẩn hoá" để áp dụng.`, 'ok')
}
for (const button of document.querySelectorAll('[data-rotate]')) button.addEventListener('click', () => rotateResult(button.dataset.rotate))
$('flipRunBtn')?.addEventListener('click', async () => { rotateResult(180); await inspectNow(); runNow() })

function applyRootScale(value) {
  const rounded = Number(value.toPrecision(4))
  optionsForm.elements.rootScale.value = String(rounded)
  optionsForm.elements.rootScale.dispatchEvent(new Event('input', { bubbles: true }))
  toast(`Đã điền hệ số root ${rounded}. Bấm "Chạy chuẩn hoá" để áp dụng.`, 'ok')
  $('step4').scrollIntoView({ block: 'nearest', behavior: 'smooth' })
}
function renderOptionHints() {
  const info = state.inspect
  const suggested = info?.proportions?.suggestedRootScale
  const button = $('applyScaleBtn')
  const current = Number(optionsForm.elements.rootScale.value)
  if (suggested && info.proportions.sourceHipsHeightMeters) {
    $('scaleHint').textContent = `Hông nguồn ${fmt(info.proportions.sourceHipsHeightMeters)} m, đích ${fmt(info.proportions.targetHipsHeightMeters)} m → gợi ý ${fmt(suggested, 3)}.`
    const same = Math.abs(current - Number(suggested.toPrecision(4))) < 1e-9
    button.hidden = same
    button.textContent = `Áp dụng ${Number(suggested.toPrecision(4))}`
    button.onclick = () => applyRootScale(suggested)
  } else { $('scaleHint').textContent = ''; button.hidden = true }
  const facing = info?.facing
  $('facingHint').textContent = facing ? `Đo được ${fmt(facing.measuredDegrees, 0)}°, đang dùng ${fmt(facing.yawDegrees, 0)}°${facing.ambiguous ? ' — MƠ HỒ, hãy nhập tay' : ''} (nguồn: ${facing.source}).` : ''
  const sides = info?.sides
  $('sidesHint').textContent = !sides ? '' : [
    sides.mirrored ? `Tên trái/phải NGƯỢC với mũi bàn chân${sides.swapped ? ' — đã tự đảo.' : ' — chưa đảo.'}` : null,
    sides.restTurnDegrees ? `Animation quay ${sides.restTurnDegrees}° so với tư thế rest (theo bước chân ${fmt(sides.evidenceMeters)} m) — đã xoay tư thế tham chiếu.` : null,
    !sides.mirrored && !sides.restTurnDegrees ? (sides.evidence === 'motion' ? `Bước chân khớp hướng rest (đồng thuận ${fmt(sides.agreement)}).`
      : 'Không đủ bước chân để kiểm hướng; nếu kết quả quay lưng hoặc ngược tay, dùng nút xoay / đảo.') : null].filter(Boolean).join(' ')
  $('modeHint').textContent = optionsForm.elements.mode.value === 'model'
    ? (info && info.mapping.family !== 'mixamo' ? `Nguồn là "${info.mapping.family}": Model mode đợt 1 sẽ trả BLOCKED (chỉ hỗ trợ Mixamo).` : 'Xuất kèm mesh, skin ≤ 4 influence, texture nhúng.')
    : 'Model mode: chỉ nguồn rig Mixamo; xuất kèm mesh, skin, texture.'
}

// ---------------------------------------------------------------- step 5: run
function selectedActionIndices() {
  const actions = state.inspect?.actions ?? []
  return actions.filter((action) => state.checked.has(action.index)).map((action) => action.index)
}
async function runNow(onlyActions = null) {
  const reason = canRunReason()
  if (reason) { toast(reason, 'err'); return }
  const all = onlyActions ?? selectedActionIndices()
  const options = { ...readOptions(), actionRanges: state.actionRanges, preview: true, ...(all.length === state.inspect.actions.length ? {} : { actions: all }), ...(state.selected !== null && all.includes(state.selected) ? { previewAction: state.selected } : {}) }
  state.running = true
  $('progress').hidden = false
  setProgress('queued', 0, 1, 0)
  refreshSteps()
  try {
    const started = await api('/api/runs', { method: 'POST', json: { sourceId: state.source.sourceId, targetId: state.target.id, options, wait: false,
      ...(state.preset ? { mappingPreset: state.preset, presetFamily: state.presetFamily } : {}) } })
    state.run = started.runId
    $('cancelBtn').hidden = false
    let current = started, failures = 0
    while (current.state === 'running') {
      await sleep(300)
      try { current = await api(`/api/runs/${started.runId}`); failures = 0 } catch (error) { if (++failures > 5) throw error }
      setProgress(current.stage, current.done, current.total, current.elapsedMs)
    }
    if (current.state === 'CANCELLED') { $('runInfo').textContent = 'CANCELLED — Đã huỷ lượt chạy'; toast('Đã huỷ lượt chạy', 'ok'); return }
    if (current.state === 'error') throw new Error(current.error)
    await finishRun(current.result, options)
    return current.result
  } catch (error) {
    toast(`Chạy thất bại: ${error.message}`, 'err', true)
    $('runInfo').textContent = `Chạy thất bại: ${error.message}`
  } finally {
    state.run = null
    $('cancelBtn').hidden = true
    state.running = false
    $('progress').hidden = true
    refreshSteps()
  }
}
function setProgress(stage, done, total, elapsedMs) {
  const fraction = total > 0 ? Math.min(1, done / total) : 0
  $('progressBar').style.width = `${Math.round(fraction * 100)}%`
  $('progressText').textContent = `${STAGES[stage] ?? stage}${total > 1 ? ` ${Math.min(done + 1, total)}/${total}` : ''} · ${(elapsedMs / 1000).toFixed(1)} s`
}
async function finishRun(result, options) {
  state.result = result; state.stale = false; state.resultOptions = options
  state.actionMap = new Map()
  const report = result.report
  const manifestActions = result.manifest?.actions ?? []
  manifestActions.forEach((entry, glbIndex) => state.actionMap.set(entry.sourceActionIndex, { glbIndex, duration: entry.durationSeconds, uuid: entry.uuid, quality: report.roundtrip?.perAction?.[glbIndex]?.quality, perAction: report.roundtrip?.perAction?.[glbIndex] }))
  state.libraryDestinations = new Set()
  state.libraryActions = new Map(manifestActions.map((entry) => [entry.uuid, 'idle']))
  fillActionSelect()
  renderAll()
  activateTab('overview')
  const glb = result.files.find((file) => file.kind === 'glb')
  if (glb) {
    setOverlay('right', 'Đang tải GLB kết quả vào viewer…')
    // Original-skeleton targets (Verity): play the result carried back onto the character's own bones.
    const original = result.files.find((file) => file.kind === 'originalGlb')
    try {
      if (original) await viewer.loadResult(original.url, 'model', report.original?.glbAnimationOffset ?? 0)
      else await viewer.loadResult(glb.url, report.model || result.manifest?.glb?.mode === 'model' ? 'model' : 'animation')
      setOverlay('right', '')
    } catch (error) { setOverlay('right', `Không phát được GLB kết quả: ${error.message}`, true) }
    if (state.mc20) await showSteveResult()
    const first = report.roundtrip?.primaryAction ?? manifestActions[0]?.sourceActionIndex ?? state.selected ?? 0
    selectAction(first)
  } else setOverlay('right', `Không có GLB: ${result.status}${report.blocker ? ` — ${report.blocker.code}` : ''}`)
  toast(`Kết quả: ${result.status}${report.blocker ? ` (${report.blocker.code})` : ''}`, result.status === 'PASS' ? 'ok' : 'err')
}
$('runBtn').addEventListener('click', () => runNow())
$('cancelBtn').addEventListener('click', async () => {
  if (!state.run) return
  try { await api(`/api/runs/${state.run}/cancel`, { method: 'POST' }) } catch (error) { toast(error.message, 'err') }
})

async function prepareTransfer() {
  if (!state.libraryCharacters) state.libraryCharacters = (await api('/api/library/characters')).characters
  const select = clear($('transferCharacter'))
  const compatible = state.libraryCharacters.filter((character) => compatibleLibraryCharacter(character).enabled)
  for (const character of compatible) select.append(h('option', { value: character.charId, text: `${character.name} · ${character.rig}` }))
  const targetCharacter = state.target?.id?.startsWith('lib-') ? state.target.id.slice(4) : ''
  if (compatible.some((character) => character.charId === targetCharacter)) select.value = targetCharacter
  const character = compatible.find((item) => item.charId === select.value)
  $('transferCharacterPack').checked = !!character
  $('transferCharacterPack').disabled = !character
  renderTransferKeys()
  $('transferConfirm').hidden = false
}
function renderTransferKeys() {
  const character = state.libraryCharacters?.find((item) => item.charId === $('transferCharacter').value)
  const select = clear($('transferActionKey'))
  for (const required of character?.requiredActions ?? []) select.append(h('option', { value: required.key, text: `${required.label} (${required.key})` }))
  if (!select.options.length) select.append(h('option', { value: 'idle', text: 'Đứng yên (idle)' }))
  $('transferCharacterPack').disabled = !character
}
$('transferOpen').addEventListener('click', async () => { try { await prepareTransfer() } catch (error) { toast(`Không đọc được thư viện: ${error.message}`, 'err') } })
$('transferCharacter').addEventListener('change', renderTransferKeys)
async function transferSelected(indices) {
  const config = { toCharacter: $('transferCharacterPack').checked, toShared: $('transferShared').checked, charId: $('transferCharacter').value, key: $('transferActionKey').value }
  const toCharacter = config.toCharacter, toShared = config.toShared
  if (!toCharacter && !toShared) throw new Error('Chọn Bộ của nhân vật và/hoặc Kho dùng chung.')
  if (!indices.length) throw new Error('Chưa chọn animation.')
  state.transferRunning = true
  for (const control of $('transferConfirm').querySelectorAll('input,select,button')) control.disabled = true
  const selectedCharacter = state.libraryCharacters?.find((item) => item.charId === config.charId)
  const characterTarget = state.targets.find((item) => item.id === `lib-${config.charId}`)
  if (selectedCharacter?.rig === 'mixamo65' && characterTarget && state.target?.id !== characterTarget.id) await chooseTarget(characterTarget)
  renderActionPicker(); $('transferStatus').textContent = `Đang chuẩn hoá ${indices.length} animation…`
  const transferred = await executeTransfer({ indices, toCharacter, toShared, normalize: (exact) => runNow(exact),
    importCharacter: (result, succeeded) => api(`/api/runs/${result.runId}/character-library`, { method: 'POST', json: {
      charIds: [config.charId], actions: succeeded.map((action) => ({ uuid: action.uuid, key: config.key })),
    } }),
    importShared: (result) => api(`/api/runs/${result.runId}/library`, { method: 'POST', json: {}),
  })
  const succeeded = transferred.actions, drafts = transferred.drafts, shared = transferred.shared
  state.transferFailed = transferred.failed
  if (!succeeded.length) throw new Error('Không animation nào chuẩn hoá thành công.')
  const character = state.libraryCharacters?.find((item) => item.charId === config.charId)
  const summary = [`Đã chuyển ${succeeded.length} animation`, ...(toCharacter ? [`→ ${character?.name ?? 'nhân vật'} (${drafts.length} Nháp)`] : []), ...(toShared ? [`+ kho dùng chung (${shared?.created === false ? 'đã có' : '1 gói'})`] : [])].join(' ')
  $('transferStatus').textContent = state.transferFailed.length ? `${summary}. Lỗi ${state.transferFailed.length}: ${state.transferFailed.map((index) => state.inspect.actions[index]?.displayName ?? index).join(', ')}` : summary
  $('transferRetry').hidden = !state.transferFailed.length
  state.libraryCharacters = null
  return { normalized: succeeded.length, drafts: drafts.length, sharedPacks: toShared ? 1 : 0, failed: state.transferFailed }
}
$('transferStart').addEventListener('click', async () => {
  $('transferStart').disabled = true
  try { await transferSelected(selectedActionIndices()); toast('Đã chuyển animation vào thư viện', 'ok') }
  catch (error) { $('transferStatus').textContent = `Chuyển thất bại: ${error.message}`; toast(error.message, 'err', true) }
  finally { state.transferRunning = false; for (const control of $('transferConfirm').querySelectorAll('input,select,button')) control.disabled = false; renderActionPicker() }
})
$('transferRetry').addEventListener('click', async () => {
  const failed = [...state.transferFailed]
  $('transferRetry').hidden = true
  try { await transferSelected(failed) } catch (error) { $('transferStatus').textContent = `Thử lại thất bại: ${error.message}` }
  finally { state.transferRunning = false; for (const control of $('transferConfirm').querySelectorAll('input,select,button')) control.disabled = false; renderActionPicker() }
})

// ---------------------------------------------------------------- tabs
function activateTab(name) {
  for (const button of document.querySelectorAll('#tabs button')) button.setAttribute('aria-selected', String(button.dataset.tab === name))
  for (const pane of document.querySelectorAll('.tabpane')) pane.hidden = pane.id !== `tab-${name}`
}
$('tabs').addEventListener('click', (event) => { const button = event.target.closest('button[data-tab]'); if (button) activateTab(button.dataset.tab) })
$('tabs').addEventListener('keydown', (event) => {
  if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return
  const buttons = [...document.querySelectorAll('#tabs button')], index = buttons.findIndex((button) => button.getAttribute('aria-selected') === 'true')
  const next = buttons[(index + (event.key === 'ArrowRight' ? 1 : buttons.length - 1)) % buttons.length]
  next.focus(); activateTab(next.dataset.tab)
})
function renderAll() { renderOverview(); renderMapping(); renderActions(true); renderMc20(); renderDownloads(); renderOptionHints() }

const chip = (status, text) => h('span', { class: `chip ${status}`, text: text ?? status })
const kv = (rows) => h('dl', { class: 'kv' }, rows.filter(Boolean).flatMap(([key, value]) => [h('dt', { text: key }), h('dd', {}, value)]))

// ---- Tổng quan
function renderOverview() {
  const box = clear($('tab-overview'))
  const result = state.result, report = result?.report, info = state.inspect
  if (!result && !info) { box.append(h('div', { class: 'empty', text: 'Chọn nguồn và đích, rồi kiểm tra. Số đo hiện ở đây.' })); return }
  if (state.stale) box.append(h('div', { class: 'note', text: 'Kết quả bên dưới là của lần chạy trước. Bạn đã đổi tuỳ chọn/mapping — chạy lại để cập nhật.' }))
  if (!result) {
    box.append(h('div', { class: `status-big ${info.blocker ? 'BLOCKED' : 'NOT_RUN'}` }, h('b', { text: info.blocker ? 'BLOCKED' : 'CHƯA CHẠY' }),
      h('small', { text: info.blocker ? `${info.blocker.code}: ${info.blocker.message}` : 'Đã kiểm tra xong, chưa bake. Số liệu dưới đây là của bước kiểm tra.' })))
    if (info.blocker && CODE_HINTS[info.blocker.code]) box.append(h('div', { class: 'note info', text: CODE_HINTS[info.blocker.code] }))
    box.append(h('h3', { text: 'Kiểm tra (chưa bake)' }), inspectFacts(info))
    return
  }
  const gates = Object.entries(report.gates ?? {})
  box.append(h('div', { class: `status-big ${report.status}` }, h('b', { text: report.status }),
    h('small', { text: report.blocker ? `${report.blocker.code}: ${report.blocker.message}` : report.error ?? `${report.exportedActions ?? 0} Action xuất · ${fmt((report.elapsedMs ?? 0) / 1000, 1)} s` })))
  if (report.blocker && CODE_HINTS[report.blocker.code]) box.append(h('div', { class: 'note info', text: CODE_HINTS[report.blocker.code] }))
  if (gates.length) box.append(h('h3', { text: 'Gate' }), h('div', { class: 'chips' }, gates.map(([name, status]) => chip(status, `${name}: ${status}`))))
  if (report.contract) box.append(h('h3', { text: 'Hợp đồng GLB v1.0.0' }), h('div', { class: 'chips' }, Object.entries(report.contract).map(([name, status]) => chip(status, `${name}: ${status}`))))
  if (report.minecraft20) box.append(h('div', { class: 'chips' }, chip(report.minecraft20.status, `minecraft20: ${report.minecraft20.status}`)))

  const quality = report.quality?.warnings ?? []
  box.append(h('h3', { text: 'Cảnh báo chất lượng (đo trên GLB đã ghi)' }))
  if (!report.quality) box.append(h('div', { class: 'empty', text: 'Không có số đo chất lượng cho lần chạy này.' }))
  else if (!quality.length) box.append(h('div', { class: 'note info', text: 'Không có cảnh báo hông/chân/trượt chân.' }))
  const SIDE_TITLES = { SIDES_MIRRORED: 'Tên trái/phải ngược với giải phẫu', REST_FACING_TURNED: 'Animation quay khác hướng tư thế rest' }
  for (const warning of report.sides?.warnings ?? []) box.append(h('div', { class: 'warncard' },
    h('div', { class: 'head' }, h('b', { text: SIDE_TITLES[warning.code] ?? warning.code }), h('span', { class: 'chip warn', text: warning.code })),
    h('span', { text: warning.message }),
    h('small', { text: warning.code === 'REST_FACING_TURNED' ? 'Đã xoay tư thế tham chiếu cho khớp hướng animation; kết quả quay mặt +Z như các nhân vật khác.'
      : report.sides.swapped ? 'Đã tự đảo trái ↔ phải.' : warning.suggestion ?? '' })))
  const suggested = report.proportions?.suggestedRootScale
  for (const warning of quality) {
    const scaleHint = suggested && /root-scale/.test(warning.suggestion ?? '')
    box.append(h('div', { class: 'warncard' },
      h('div', { class: 'head' }, h('b', { text: QUALITY_TITLES[warning.code] ?? warning.code }), h('span', { class: 'chip warn', text: `${warning.code} · ${warning.actions} Action` })),
      h('span', { text: warning.message }),
      warning.examples?.length ? h('small', { text: `Ví dụ: ${warning.examples.join(', ')}` }) : null,
      warning.suggestion ? h('small', { text: `Gợi ý: ${warning.suggestion}` }) : null,
      scaleHint ? h('div', {}, h('button', { type: 'button', onclick: () => applyRootScale(suggested), text: `Áp dụng --root-scale ${Number(suggested.toPrecision(4))}` })) : null))
  }

  box.append(h('h3', { text: 'Tỉ lệ & hiệu chỉnh' }), kv([
    report.proportions ? ['Hông nguồn / đích', `${fmt(report.proportions.sourceHipsHeightMeters)} m / ${fmt(report.proportions.targetHipsHeightMeters)} m`] : null,
    report.proportions?.suggestedRootScale ? ['Root-scale gợi ý', fmt(report.proportions.suggestedRootScale, 3)] : null,
    report.input ? ['Root', `${report.input.rootPolicy} × ${fmt(report.proportions?.rootScale ?? report.input.rootScale, 4)}${report.proportions?.rootScaleSource === 'auto-units' ? ' (TỰ ĐỘNG: đơn vị file nguồn sai, hông nguồn không cỡ người)' : ''}`] : null,
    report.ground ? ['Chạm sàn', groundSummary(report.ground)] : null,
    report.calibration ? ['Hướng mặt', `${fmt(report.calibration.facingYawDegrees, 0)}° (đo ${fmt(report.calibration.measuredFacingYawDegrees, 0)}°${report.calibration.facingAmbiguous ? ', MƠ HỒ' : ''}, nguồn ${report.calibration.facingSource})`] : null,
    report.sides ? ['Trái / phải', `${report.sides.mode}${report.sides.swapped ? ', đã đảo' : ''}${report.sides.restTurnDegrees ? `, xoay rest ${report.sides.restTurnDegrees}°` : ''} · bằng chứng ${report.sides.evidence}${report.sides.agreement === null ? '' : ` (${fmt(report.sides.agreement)})`}`] : null,
    report.calibration ? ['Calibration', `${report.calibration.mode}, lệch lớn nhất ${fmt(report.calibration.maxDegrees, 1)}° / ${report.calibration.corrections.length} khớp`] : null,
  ]))
  if (report.mapping) box.append(h('h3', { text: 'Mapping' }), kv([
    ['Family', report.mapping.family], ['Đã map', `${report.mapping.mapped}/65`],
    report.mapping.missingRequired?.length ? ['Thiếu bắt buộc', report.mapping.missingRequired.join(', ')] : null,
    report.mapping.notInSourceRig?.length ? ['Không có trong rig nguồn', report.mapping.notInSourceRig.join(', ')] : null,
    report.mapping.needsUserConfirmation ? ['Suy theo hình học', `độ tin cậy ${fmt(report.mapping.confidence)} — cần người dùng xác nhận`] : null,
    report.input?.mapping === 'preset' ? ['Nguồn mapping', h('span', {}, 'preset đã xác nhận', report.mapping.presetFingerprintsMatch === false ? ' (fingerprint khác nguồn)' : ''), ] : null,
  ]))
  if (report.loss) box.append(h('h3', { text: 'Mất dữ liệu (đã ghi, vẫn xuất)' }), kv([
    ['Track bỏ (ngoài rig)', String(report.loss.prunedTracks?.count ?? 0)],
    ['Track scale bỏ', `${report.loss.scaleTracks?.dropped ?? 0}${report.loss.scaleTracks?.dropped ? ` (lệch tối đa ${fmt(report.loss.scaleTracks.maxDeviation * 100, 1)}%)` : ''}`],
    ['Quaternion chuẩn hoá', String(report.loss.quaternionTracks?.normalized ?? 0)],
    ['Xương nguồn không map', String(report.loss.unmappedSourceBones ?? 0)],
    ['Khớp đích giữ rest', String(report.loss.unmappedTargetJoints?.length ?? 0)],
  ]))
  if (report.skippedActions?.length) {
    const codes = Object.entries(report.skippedActions.reduce((acc, item) => ({ ...acc, [item.code]: (acc[item.code] ?? 0) + 1 }), {}))
    box.append(h('h3', { text: `Action bị bỏ qua (${report.skippedActions.length})` }), h('div', { class: 'chips' }, codes.map(([code, count]) => h('span', { class: 'chip warn', title: CODE_HINTS[code] ?? '', text: `${code} ×${count}` }))))
  }
  if (report.model) box.append(h('h3', { text: 'Model + Rig' }), kv([
    ['Trạng thái', chip(report.model.status)], ['Mesh / đỉnh', `${report.model.meshes} / ${report.model.vertices}`],
    ['Influence tối đa', `${report.model.maxInfluencesBefore} → ${report.model.maxInfluencesAfter}`],
    ['Weight bị bỏ', `${fmt(report.model.droppedWeight, 4)} (${report.model.affectedVertices} đỉnh)`],
    ['Ảnh nhúng', `${report.model.images.count} (${fmtBytes(report.model.images.bytes)})`],
    ['Sai lệch rest', `${fmt(report.model.restMaxErrorMeters * 1000, 4)} mm`], ['Vừa khít khớp', `max ${fmt(report.model.jointFit.maxMeters, 3)} m (${report.model.jointFit.worstJoint})`],
  ]))
  const preview = result.files.find((file) => file.kind === 'preview')
  if (preview) box.append(h('h3', { text: 'Preview (contact sheet từ GLB đã ghi)' }), h('img', { class: 'img', src: preview.url, alt: 'Contact sheet preview' }))
}
function inspectFacts(info) {
  return kv([
    ['Family', info.mapping.family], ['Đã map', `${info.mapping.mapped}/65`], ['Action', String(info.actions.length)], ['Xương nguồn', String(info.sourceBones.length)],
    info.proportions.sourceHipsHeightMeters ? ['Hông nguồn / đích', `${fmt(info.proportions.sourceHipsHeightMeters)} m / ${fmt(info.proportions.targetHipsHeightMeters)} m`] : null,
    info.proportions.suggestedRootScale ? ['Root-scale gợi ý', h('span', {}, fmt(info.proportions.suggestedRootScale, 3), ' ', h('button', { type: 'button', onclick: () => applyRootScale(info.proportions.suggestedRootScale), text: 'Áp dụng' }))] : null,
    info.facing ? ['Hướng mặt', `${fmt(info.facing.yawDegrees, 0)}° (đo ${fmt(info.facing.measuredDegrees, 0)}°${info.facing.ambiguous ? ', MƠ HỒ' : ''})`] : null,
    info.loss ? ['Track bỏ / scale / quaternion', `${info.loss.prunedTracks} / ${info.loss.droppedScaleTracks} / ${info.loss.normalizedQuaternions}`] : null,
    info.mapping.missingRequired.length ? ['Thiếu bắt buộc', info.mapping.missingRequired.join(', ')] : null,
  ])
}

// ---- Mapping
const FILTERS = [['all', 'Tất cả'], ['mapped', 'Đã map'], ['unmapped', 'Chưa map'], ['geometry', 'Geometry'], ['ambiguous', 'Ambiguous'], ['edited', 'Đã sửa']]
function rowMatches(row) {
  const f = state.filter
  if (f === 'mapped' && !row.source) return false
  if (f === 'unmapped' && row.source) return false
  if (f === 'geometry' && row.via !== 'geometry') return false
  if (f === 'ambiguous' && !row.ambiguous) return false
  if (f === 'edited' && row.source === row.original) return false
  const q = state.search.trim().toLowerCase()
  return !q || row.target.toLowerCase().includes(q) || (row.source ?? '').toLowerCase().includes(q)
}
function renderMapping() {
  const box = clear($('tab-mapping'))
  const info = state.inspect
  if (!info) { box.append(h('div', { class: 'empty', text: 'Kiểm tra nguồn để xem và sửa mapping 65 khớp.' })); return }
  const missing = new Set(info.mapping.missingRequired)
  const names = new Set(info.sourceBones.map((bone) => bone.name))
  const used = new Map()
  for (const row of state.rows) if (row.source) used.set(row.source, (used.get(row.source) ?? 0) + 1)
  const mapped = state.rows.filter((row) => row.source).length
  if (info.mapping.needsUserConfirmation && !state.preset) box.append(h('div', { class: 'note', text: `Mapping này được SUY RA từ cấu trúc cây + hình học (độ tin cậy ${fmt(info.mapping.confidence)}), không phải theo tên. Hãy kiểm lại từng dòng rồi bấm "Xác nhận mapping". ${(info.mapping.notes ?? []).join(' ')}` }))
  if (state.preset && !state.dirty) box.append(h('div', { class: 'note info', text: 'Mapping đã xác nhận (preset). Lần chạy sẽ dùng đúng preset này.' }))
  if (state.dirty) box.append(h('div', { class: 'note', text: 'Bạn đã sửa mapping. Bấm "Xác nhận mapping" để tạo preset; chưa xác nhận thì chưa chạy được.' }))
  if (info.mapping.presetFingerprintsMatch === false) box.append(h('div', { class: 'note', text: 'Preset có fingerprint khác nguồn/đích hiện tại — kiểm lại mapping.' }))
  const list = h('datalist', { id: 'boneList' }, info.sourceBones.map((bone) => h('option', { value: bone.name })))
  const toolbar = h('div', { class: 'toolbar' },
    h('input', { type: 'search', placeholder: 'Lọc theo tên khớp / xương…', value: state.search, 'aria-label': 'Lọc mapping', oninput: (event) => { state.search = event.target.value; renderMappingRows() } }),
    h('span', { class: 'seg row' }, FILTERS.map(([key, label]) => h('button', { type: 'button', 'aria-pressed': String(state.filter === key), onclick: () => { state.filter = key; renderMapping() }, text: label }))))
  const actions = h('div', { class: 'toolbar' },
    h('button', { type: 'button', class: 'primary', style: 'width:auto', onclick: confirmMapping, text: 'Xác nhận mapping', disabled: !state.dirty && !!state.preset }),
    h('button', { type: 'button', onclick: resetMapping, text: 'Đặt lại tự động', disabled: !state.dirty && !state.preset }),
    h('span', { class: 'chip', id: 'mapCount', text: `${mapped}/65 đã map` }))
  const body = h('tbody', { id: 'mapRows' })
  box.append(list, actions, toolbar, h('table', {}, h('thead', {}, h('tr', {}, h('th', { text: 'Khớp Mixamo65' }), h('th', { text: 'Xương nguồn (gõ để tìm, xoá = bỏ map)' }), h('th', { text: 'Cách map' }))), body))
  function renderMappingRowsInner() {
    clear(body)
    for (const row of state.rows.filter(rowMatches)) {
      const input = h('input', { type: 'text', value: row.source ?? '', list: 'boneList', spellcheck: 'false', 'aria-label': `Xương nguồn cho ${row.target}`, placeholder: '— chưa map —' })
      input.addEventListener('change', () => {
        const value = input.value.trim()
        if (value && !names.has(value)) { toast(`"${value}" không phải xương của nguồn này.`, 'err'); input.value = row.source ?? ''; return }
        row.source = value || null
        row.via = row.source === row.original ? row.via : row.source ? 'edited' : null
        state.dirty = state.rows.some((item) => item.source !== item.original) || state.dirty
        state.stale = state.stale || !!state.result
        state.inspectSeq++ // an in-flight inspect would overwrite the edit
        renderMapping(); refreshSteps()
      })
      const dup = row.source && used.get(row.source) > 1
      body.append(h('tr', { class: `${row.source !== row.original ? 'edited' : ''} ${missing.has(row.target) && !row.source ? 'missing' : ''}` },
        h('td', { text: row.target }), h('td', {}, input, dup ? h('small', { class: 'dup', text: 'Xương này đang gán cho nhiều khớp' }) : null),
        h('td', {}, h('span', { class: `via ${row.ambiguous ? 'ambiguous' : row.via ?? ''}`, text: row.ambiguous ? 'ambiguous' : row.via ?? (missing.has(row.target) ? 'thiếu bắt buộc' : '—') }))))
    }
    if (!body.children.length) body.append(h('tr', {}, h('td', { colspan: 3, class: 'empty', text: 'Không có dòng nào khớp bộ lọc.' })))
  }
  renderMappingRows = renderMappingRowsInner
  renderMappingRows()
}
let renderMappingRows = () => {}
async function confirmMapping() {
  const assignments = Object.fromEntries(state.rows.map((row) => [row.target, row.source]))
  try {
    const { preset, family } = await api('/api/preset', { method: 'POST', json: { sourceId: state.source.sourceId, targetId: state.target.id, assignments } })
    state.preset = preset; state.presetFamily = state.presetFamily ?? family; state.dirty = false
    toast('Đã tạo preset bbs.mixamo65-mapping-preset và kiểm tra lại với preset.', 'ok')
    state.stale = state.stale || !!state.result
    await inspectNow()
  } catch (error) { toast(`Không tạo được preset: ${error.message}`, 'err') }
}
async function resetMapping() {
  state.preset = null; state.dirty = false; state.stale = state.stale || !!state.result
  await inspectNow()
}

// ---- Actions
function renderActions(rebuild) {
  const box = $('tab-actions')
  if (!rebuild && box.querySelector('tbody')) {
    for (const tr of box.querySelectorAll('tbody tr')) tr.classList.toggle('sel', Number(tr.dataset.index) === state.selected)
    return
  }
  clear(box)
  const info = state.inspect
  if (!info) { box.append(h('div', { class: 'empty', text: 'Kiểm tra nguồn để xem danh sách Action.' })); return }
  const withResult = !!state.result && !state.stale
  const q = state.actionFilter.trim().toLowerCase()
  const shown = info.actions.filter((action) => !q || `${action.name} ${action.nameVi ?? ''}`.toLowerCase().includes(q) || String(action.index) === q)
  const toolbar = h('div', { class: 'toolbar' },
    h('input', { type: 'search', placeholder: 'Lọc Action theo tên / số…', value: state.actionFilter, 'aria-label': 'Lọc Action', oninput: (event) => { state.actionFilter = event.target.value; renderActions(true); box.querySelector('input[type=search]').focus() } }),
    h('button', { type: 'button', text: 'Chọn hết', onclick: () => { info.actions.forEach((action) => state.checked.add(action.index)); markRunInputsChanged() } }),
    h('button', { type: 'button', text: 'Bỏ hết', onclick: () => { state.checked.clear(); markRunInputsChanged() } }),
    h('button', { type: 'button', text: 'Chỉ hợp lệ', title: 'Bỏ Action rỗng / không hỗ trợ', onclick: () => { state.checked = new Set(info.actions.filter((action) => action.ready && action.durationSeconds > 0).map((action) => action.index)); markRunInputsChanged() } }),
    h('span', { class: 'chip', text: `${selectedActionIndices().length}/${info.actions.length} sẽ xuất` }))
  const head = h('tr', {}, h('th', { text: '' }), h('th', { class: 'num', text: '#' }), h('th', { text: 'Tên' }), h('th', { class: 'num', text: 'Giây' }), h('th', { text: 'Từ – đến (giây)' }), h('th', { text: 'Trạng thái' }),
    withResult ? [h('th', { text: 'Kết quả' }), h('th', { class: 'num', text: 'Hông min–max (m)' }), h('th', { class: 'num', text: 'Trượt (m)' }), h('th', { text: 'Cảnh báo' })] : null)
  const body = h('tbody')
  for (const action of shown) {
    const mapped = withResult ? state.actionMap.get(action.index) : null
    const skipped = withResult ? state.result.report.skippedActions?.find((item) => item.index === action.index) : null
    const per = mapped?.perAction, quality = per?.quality
    const checkbox = h('input', { type: 'checkbox', 'aria-label': `Xuất Action ${action.name}`, onclick: (event) => event.stopPropagation(), onchange: (event) => { event.target.checked ? state.checked.add(action.index) : state.checked.delete(action.index); markRunInputsChanged(false) } })
    checkbox.checked = state.checked.has(action.index)
    const range = state.actionRanges[action.index] ?? [0, action.durationSeconds]
    const rangeInputs = [0, 1].map((side) => h('input', { type: 'number', min: '0', max: String(action.durationSeconds), step: 'any', value: String(range[side]),
      'aria-label': `${side ? 'Đến' : 'Từ'} giây ${action.name}`, onclick: (event) => event.stopPropagation(),
      onchange: (event) => {
        const next = [...(state.actionRanges[action.index] ?? [0, action.durationSeconds])]
        next[side] = Number(event.target.value)
        if (!event.target.value || !Number.isFinite(next[side]) || next[0] < 0 || next[1] > action.durationSeconds || next[1] <= next[0]) {
          event.target.value = String(range[side]); toast('Khoảng thời gian phải nằm trong Action và từ < đến', 'err'); return
        }
        state.actionRanges[action.index] = next; markRunInputsChanged(false)
      } }))
    const status = !(action.durationSeconds > 0) ? 'rỗng' : action.ready ? 'sẵn sàng' : `kênh không hỗ trợ (${action.issueCount})`
    body.append(h('tr', { class: `clickable ${state.selected === action.index ? 'sel' : ''}`, dataset: { index: String(action.index) }, tabindex: '0', onclick: () => selectAction(action.index),
      onkeydown: (event) => { if (event.key === 'Enter') selectAction(action.index) } },
      h('td', {}, checkbox), h('td', { class: 'num', text: String(action.index) }), h('td', { text: action.displayName ?? action.name }), h('td', { class: 'num', text: fmt(action.durationSeconds) }),
      h('td', {}, rangeInputs), h('td', { text: status }),
      withResult ? [h('td', {}, per ? chip(per.status) : skipped ? h('span', { class: 'chip warn', title: skipped.message, text: skipped.code }) : '–'),
        h('td', { class: 'num', text: per ? `${fmt(per.hipsHeightRangeMeters[0])}–${fmt(per.hipsHeightRangeMeters[1])}` : '–' }),
        h('td', { class: 'num', text: quality ? fmt(Math.max(quality.footSlideMeters.left, quality.footSlideMeters.right)) : '–' }),
        h('td', {}, quality?.warnings?.length ? quality.warnings.map((warning) => h('span', { class: 'chip warn', title: warning.message, text: warning.code })) : quality ? '–' : '')] : null))
  }
  if (!shown.length) body.append(h('tr', {}, h('td', { colspan: 9, class: 'empty', text: 'Không có Action nào khớp.' })))
  box.append(toolbar, h('table', {}, h('thead', {}, head), body))
}
function markRunInputsChanged(rebuild = true) {
  if (state.result) state.stale = true
  if (rebuild) renderActions(true)
  else { const chipEl = $('tab-actions').querySelector('.toolbar .chip'); if (chipEl) chipEl.textContent = `${selectedActionIndices().length}/${state.inspect.actions.length} sẽ xuất` }
  refreshSteps(); renderOverview()
}

// ---- Minecraft20
function renderMc20() {
  const box = clear($('tab-mc20'))
  const report = state.result?.report
  if (!report?.minecraft20) {
    box.append(h('div', { class: 'empty', text: state.result ? 'Lần chạy này không xuất .bobj. Bật "Xuất thêm .bobj" ở bước 4 rồi chạy lại.' : 'Bật "Xuất thêm .bobj" ở bước 4 (Minecraft20 cho BBS FS) rồi chạy.' }))
    return
  }
  const mc = report.minecraft20
  box.append(h('div', { class: `status-big ${mc.status}` }, h('b', { text: mc.status }), h('small', { text: mc.format })),
    kv([['Action .bobj', String(mc.actions.length)], ['Ticks/giây', String(mc.ticksPerSecond)], ['Sai số đọc lại', `${mc.roundtripMaxErrorBlocks.toExponential(1)} block`],
      ['Armature', mc.armature], ['Root', mc.settings?.rootTravelMode ?? '–']]))
  const preview = state.result.files.find((file) => file.kind === 'bobjPreview')
  if (preview) box.append(h('h3', { text: 'Preview .bobj' }), h('img', { class: 'img', src: preview.url, alt: 'Preview Minecraft20' }))
  box.append(h('p', { class: 'note info', text: 'Chưa kiểm: mở file .bobj trong BBS FS thật (cần thử trong game).' }),
    h('h3', { text: 'Action' }), h('table', {}, h('thead', {}, h('tr', {}, h('th', { text: 'Tên .bobj' }), h('th', { text: 'Tên GLB' }), h('th', { class: 'num', text: 'Tick' }), h('th', { class: 'num', text: 'Kênh' }))),
      h('tbody', {}, mc.actions.slice(0, 500).map((action) => h('tr', {}, h('td', { text: action.name }), h('td', { text: state.inspect?.actions?.find((item) => item.name === action.glbName)?.displayName ?? action.glbName }), h('td', { class: 'num', text: String(action.ticks) }), h('td', { class: 'num', text: String(action.channels) }))))))
}

// ---- Tải về
const KIND_LABELS = { glb: 'GLB Mixamo65', manifest: 'Manifest JSON', report: 'Report JSON', preview: 'Preview PNG', bobj: '.bobj Minecraft20', bobjPreview: 'Preview .bobj PNG',
  originalBobj: '.bobj gốc + action mới (BBS FS)', originalGlb: 'GLB bộ xương gốc' }
function renderDownloads() {
  const box = clear($('tab-downloads'))
  const list = h('div', { class: 'dl' })
  if (state.result) {
    if (state.stale) box.append(h('div', { class: 'note', text: 'Các file dưới đây là của lần chạy trước.' }))
    for (const file of state.result.files) list.append(h('a', { href: file.url, download: file.name }, h('span', { text: `${KIND_LABELS[file.kind] ?? file.kind} · ${file.name}` }), h('span', { text: fmtBytes(file.bytes) })))
  }
  if (state.preset) {
    const stem = (state.source?.name ?? 'source').replace(/\.[^.]+$/, '')
    const blob = new Blob([JSON.stringify(state.preset, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    list.append(h('a', { href: url, download: `${stem}.mapping.json` }, h('span', { text: `Preset mapping · ${stem}.mapping.json (dùng với CLI --mapping)` }), h('span', { text: fmtBytes(blob.size) })))
  }
  if (!list.children.length) box.append(h('div', { class: 'empty', text: 'Chưa có file. Chạy chuẩn hoá hoặc xác nhận mapping để có file tải về.' }))
  else box.append(list, h('p', { class: 'note info', text: 'File nằm trong thư mục tạm của phiên Workbench; tải về để giữ lại. File nguồn của bạn không bị sửa.' }))
}

function compatibleLibraryCharacter(character) {
  const rig = state.result?.manifest?.rig ?? 'mixamo65'
  if (character.rig === rig) return { enabled: true, reason: '' }
  if (character.rig === 'verity' && (rig === 'mixamo65' || rig === 'mixamo65+verity')) {
    return { enabled: true, reason: '' }
  }
  if (character.rig === 'minecraft20' && (state.result?.files?.some((file) => file.kind === 'bobj') || state.requestBobj)) {
    return { enabled: true, reason: '' }
  }
  return { enabled: false, reason: `Không khớp rig ${rig}.` }
}

async function renderCharacterLibrary(host) {
  try {
    if (!state.libraryCharacters) state.libraryCharacters = (await api('/api/library/characters')).characters
    if (!host.isConnected || state.stale || !state.result) return
    clear(host).append(h('h3', { text: 'Đưa Action vào bộ của nhân vật' }))
    const characters = state.libraryCharacters
    if (!characters.length) { host.append(h('div', { class: 'empty', text: 'Chưa có nhân vật trong App 5.' })); return }
    const cards = h('div', { class: 'destination-grid' })
    for (const character of characters) {
      const compatible = compatibleLibraryCharacter(character)
      const checked = state.libraryDestinations.has(character.charId)
      const input = h('input', { type: 'checkbox', disabled: !compatible.enabled, 'aria-label': `Chọn ${character.name}`,
        onchange: (event) => { event.target.checked ? state.libraryDestinations.add(character.charId) : state.libraryDestinations.delete(character.charId); renderCharacterLibrary(host) } })
      input.checked = checked
      cards.append(h('label', { class: `destination-card${checked ? ' selected' : ''}${compatible.enabled ? '' : ' disabled'}`, title: compatible.reason }, input,
        h('span', {}, h('b', { text: character.name }), h('small', { text: `${character.rig} · ${character.counts.draft} nháp · ${character.counts.edited} đã chỉnh · ${character.counts.approved} đã duyệt` }),
          !compatible.enabled ? h('small', { class: 'bad', text: compatible.reason }) : null)))
    }
    const actions = state.result.manifest?.actions ?? []
    const commonKeys = (() => {
      const chosen = characters.filter((character) => state.libraryDestinations.has(character.charId))
      if (!chosen.length) return characters.flatMap((character) => character.requiredActions ?? []).filter((item, index, all) => all.findIndex((other) => other.key === item.key) === index)
      return (chosen[0].requiredActions ?? []).filter((item) => chosen.every((character) => (character.requiredActions ?? []).some((required) => required.key === item.key)))
    })()
    const actionTools = h('div', { class: 'toolbar' },
      h('button', { type: 'button', text: 'Chọn hết', onclick: () => { for (const action of actions) state.libraryActions.set(action.uuid, state.libraryActions.get(action.uuid) ?? commonKeys[0]?.key ?? 'idle'); renderCharacterLibrary(host) } }),
      h('button', { type: 'button', text: 'Bỏ hết', onclick: () => { state.libraryActions.clear(); renderCharacterLibrary(host) } }),
      h('span', { class: 'chip', text: `${state.libraryActions.size}/${actions.length} Action sẽ vào bộ nhân vật` }))
    const rows = h('tbody')
    for (const action of actions) {
      const selected = state.libraryActions.has(action.uuid)
      const check = h('input', { type: 'checkbox', 'aria-label': `Đưa Action ${action.name} vào bộ nhân vật`, onchange: (event) => {
        event.target.checked ? state.libraryActions.set(action.uuid, commonKeys[0]?.key ?? 'idle') : state.libraryActions.delete(action.uuid); renderCharacterLibrary(host)
      } }); check.checked = selected
      const key = h('select', { disabled: !selected, 'aria-label': `Thẻ động tác ${action.name}`, onchange: (event) => state.libraryActions.set(action.uuid, event.target.value) },
        commonKeys.map((required) => h('option', { value: required.key, text: `${required.label} (${required.key})` })))
      if (selected && !commonKeys.some((required) => required.key === state.libraryActions.get(action.uuid))) state.libraryActions.set(action.uuid, commonKeys[0]?.key ?? 'idle')
      key.value = state.libraryActions.get(action.uuid) ?? ''
      const sourceIndex = action.sourceActionIndex
      rows.append(h('tr', { class: 'clickable', onclick: (event) => { if (!event.target.closest('input,select')) selectAction(sourceIndex) } }, h('td', {}, check), h('td', { text: action.name }), h('td', {}, key), h('td', {}, h('button', { type: 'button', text: 'Xem nguồn + đích', onclick: () => selectAction(sourceIndex) }))))
    }
    const status = h('span', { class: 'note info', text: '' })
    const chosenNames = characters.filter((character) => state.libraryDestinations.has(character.charId)).map((character) => character.name)
    const send = h('button', { type: 'button', class: 'primary', disabled: !chosenNames.length || !state.libraryActions.size || !commonKeys.length,
      text: chosenNames.length === 1 ? `Đưa vào thư viện của ${chosenNames[0]}` : `Đưa vào thư viện của ${chosenNames.length || '…'} nhân vật` })
    send.addEventListener('click', async () => {
      send.disabled = true; status.textContent = 'Đang tạo các bản Nháp…'
      try {
        const result = await api(`/api/runs/${state.result.runId}/character-library`, { method: 'POST', json: {
          charIds: [...state.libraryDestinations], actions: [...state.libraryActions].map(([uuid, key]) => ({ uuid, key })),
        } })
        status.textContent = `Đã tạo ${result.drafts.length} bản Nháp trong ${chosenNames.length} bộ nhân vật.`
        toast('Đã đưa Action vào bộ nhân vật', 'ok')
        state.libraryCharacters = null
      } catch (error) { status.textContent = `Không đưa được vào thư viện: ${error.message}`; send.disabled = false }
    })
    host.append(cards, h('h4', { text: 'Action và thẻ động tác' }), actionTools,
      h('table', { class: 'library-actions' }, h('thead', {}, h('tr', {}, h('th'), h('th', { text: 'Action' }), h('th', { text: 'Thẻ động tác' }), h('th', { text: 'Xem thử' }))), rows),
      h('div', { class: 'send-app2' }, send, status))
  } catch (error) { clear(host).append(h('div', { class: 'note bad', text: `Không đọc được thư viện: ${error.message}` })) }
}

// ---------------------------------------------------------------- boot
async function boot() {
  renderTargets(); renderAll(); refreshSteps()
  setOverlay('right', 'Đang tải danh sách nhân vật đích…')
  try {
    const targetList = await api('/api/targets')
    state.targets = targetList.targets; state.mc20Characters = targetList.mc20 ?? []
    renderTargets()
    await chooseTarget(state.targets[0])
  } catch (error) {
    setOverlay('right', `Không tải được danh sách đích: ${error.message}`, true)
    toast(error.message, 'err', true)
  }
  refreshSteps()
}
boot()
