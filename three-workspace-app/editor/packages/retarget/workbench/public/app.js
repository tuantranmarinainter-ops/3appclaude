// App 1 Workbench UI. Every number shown comes from the server's inspect result or the run's report.json.
import { boneChooser, closeBoneChooser } from './bone-chooser.js'
import { Viewer, FPS } from './viewer.js'
import { jointSettings, JOINT_SETTINGS_KEY } from './joint-overlay.js'
import { executeTransfer, suggestActionKey } from './transfer.js'

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
  actionRanges: {}, checked: new Set(), actionFilter: '', actionEdits: new Map(), actionKeys: new Map(),
  run: null, running: false, result: null, stale: false, resultOptions: null, actionMap: new Map(),
  selected: null, scale: { applied: null },
  libraryCharacters: null, libraryDestinations: new Set(), libraryActions: new Map(), transferCharacters: new Set(),
  transferFailed: [], transferRunning: false, transferConfig: null, requestBobj: false,
  batch: null, batchRun: null, batchCancelRequested: false, batchFailedEntries: [], batchPresets: new Map(), batchKeys: new Map(), batchEdits: new Map(), batchSelection: new Map(), batchProgress: null, batchCurrent: null, batchRows: [], reviewRows: [], runAbort: false, runQuiet: false,
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
let displaySettings = jointSettings()
try { displaySettings = jointSettings(JSON.parse(localStorage.getItem(JOINT_SETTINGS_KEY))) } catch { /* Storage may be unavailable. */ }
function applyJointSettings() { for (const pane of [viewer.left, viewer.right]) pane.joints.settings = displaySettings }
applyJointSettings()
for (const [key, title, type, min, max] of [
  ['points', 'Điểm khớp', 'checkbox'], ['color', 'Màu điểm', 'color'], ['size', 'Cỡ điểm (px)', 'range', 3, 20],
  ['labels', 'Tên xương', 'checkbox'], ['fontSize', 'Cỡ chữ (px)', 'range', 8, 24], ['scope', 'Phạm vi tên', 'select'],
]) {
  const input = h(type === 'select' ? 'select' : 'input', { type: type === 'select' ? undefined : type, min, max, step: 1, 'aria-label': title })
  if (type === 'select') for (const [value, text] of [['selected', 'Khớp đang chọn'], ['all', 'Tất cả khớp'], ['unmapped', 'Chỉ khớp chưa map']]) input.append(h('option', { value, text }))
  if (type === 'checkbox') input.checked = displaySettings[key]
  else input.value = displaySettings[key]
  input.addEventListener('input', () => {
    displaySettings = jointSettings({ ...displaySettings, [key]: type === 'checkbox' ? input.checked : type === 'range' ? Number(input.value) : input.value })
    applyJointSettings()
    try { localStorage.setItem(JOINT_SETTINGS_KEY, JSON.stringify(displaySettings)) } catch { /* Display still works without persistence. */ }
  })
  $('jointSettings').append(h('label', {}, title, input))
}
let activeMappingTarget = null
let hoveredMappingTarget = null
function syncMappingHighlights() {
  const selected = state.rows.find((row) => row.target === (hoveredMappingTarget ?? activeMappingTarget))
  viewer.left.joints.selected = new Set(selected?.source ? [selected.source] : [])
  viewer.right.joints.selected = new Set(selected ? [selected.target] : [])
  viewer.left.joints.mapped = new Set(state.rows.filter((row) => row.source).map((row) => row.source))
  viewer.right.joints.mapped = new Set(state.rows.filter((row) => row.source).map((row) => row.target))
  for (const tr of document.querySelectorAll('#mapRows tr')) tr.classList.toggle('active-mapping', tr.dataset.target === activeMappingTarget)
}
// One assignment boundary shared by source-point picking and the mapping chooser.
function assignMappingSource(target, source) {
  const row = state.rows.find((item) => item.target === target)
  if (!row || !state.inspect) return false
  if (source && !state.inspect.sourceBones.some((bone) => bone.name === source)) { toast(`"${source}" không phải xương của nguồn này.`, 'err'); return false }
  row.source = source || null
  row.via = row.source === row.original ? row.via : row.source ? 'edited' : null
  state.dirty = state.rows.some((item) => item.source !== item.original) || state.dirty
  state.stale = state.stale || !!state.result
  state.inspectSeq++ // an in-flight inspect would overwrite the edit
  renderMapping(); refreshSteps()
  return true
}
viewer.left.joints.onPick = (source) => {
  if (!activeMappingTarget) { toast('Chọn ô mapping cần sửa, rồi bấm điểm xương nguồn.'); return }
  assignMappingSource(activeMappingTarget, source)
}
viewer.right.joints.onPick = (target) => {
  const row = state.rows.find((item) => item.target === target.replace(/^mixamorig:?/i, ''))
  if (!row) return
  activeMappingTarget = row.target
  syncMappingHighlights()
  const input = [...document.querySelectorAll('#mapRows input')].find((item) => item.dataset.target === row.target)
  input?.focus()
}
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
$('actionSel').addEventListener('change', (event) => {
  const index = Number(event.target.value), entry = state.batch?.entries.find((item) => item.sourceId === state.source?.sourceId), action = entry?.inspect?.actions?.find((item) => item.index === index)
  if (entry && action) previewBatchAction(entry, action); else selectAction(index)
})

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
  if (state.batch) renderReview(); else renderActionPicker()
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
function openActionPicker() {
  picker.hidden = false; $('actionPickerBtn').setAttribute('aria-expanded', 'true'); renderActionPicker()
  // Tag suggestions need the character's required actions: load the library list once, then render again.
  if (!state.libraryCharacters) api('/api/library/characters').then((body) => { state.libraryCharacters = body.characters; renderActionPicker() }).catch(() => { /* defaults stay */ })
}
/** Library defaults (`requiredActions`) used before a character is chosen. */
const DEFAULT_REQUIRED_ACTIONS = ['idle', 'walk', 'run', 'talk', 'happy', 'sad', 'surprised', 'angry', 'attack', 'hit', 'fall', 'jump'].map((key) => ({ key, label: key[0].toUpperCase() + key.slice(1) }))
function pickerRequiredActions() {
  const charId = [...state.transferCharacters][0] || (state.target?.id?.startsWith('lib-') ? state.target.id.slice(4) : '')
  const required = state.libraryCharacters?.find((item) => item.charId === charId)?.requiredActions
  return required?.length ? required : DEFAULT_REQUIRED_ACTIONS
}
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
function batchKey(entry, action) { return `${entry.sourceId}:${action.index}` }
function selectedBatchGroups() {
  const entries = state.batch?.entries ?? []
  return entries.map((entry) => ({ entry, actions: (entry.inspect?.actions ?? []).filter((action) => state.batchSelection.has(batchKey(entry, action))) })).filter((group) => group.actions.length)
}
/** Shows one batch animation: loads the entry's source into the left pane once per file, then only switches the clip. */
function previewBatchAction(entry, action = entry.inspect?.actions?.[0]) {
  if (!entry.sourceId) return
  const key = action ? batchKey(entry, action) : null
  state.batchCurrent = key
  if (shownBatchEntry !== entry.sourceId) {
    shownBatchEntry = entry.sourceId
    state.source = { sourceId: entry.sourceId, name: entry.name, format: entry.inspect?.format, bytes: entry.bytes ?? 0, sha256: entry.sha256, uploaded: !entry.path, path: entry.path }
    const saved = state.batchPresets.get(entry.sourceId)
    state.inspect = entry.inspect; state.inspectError = null; state.rows = (entry.inspect?.mapping?.joints ?? []).map((joint) => ({ ...joint, original: joint.source })); state.preset = saved?.preset ?? null; state.presetFamily = saved?.family ?? entry.inspect?.mapping?.family ?? null; state.dirty = false
    state.actionMap = new Map(); state.result = null; state.stale = false
    viewer.clearResult(); fillActionSelect()
    $('armatureBox').hidden = state.source.format !== 'bobj'
    clear($('sourceInfo')).append(h('b', { text: entry.name }), h('span', { text: ` · ${entry.inspect?.actions?.length ?? 0} animation · sha256 ${(entry.sha256 ?? '').slice(0, 16)}…` }))
  }
  state.selected = action?.index ?? null
  renderReview(false, true)
  let left = Promise.resolve()
  if (state.source.format === 'bobj') { leftLoad = null; viewer.clearSource(); setOverlay('left', 'Nguồn .bobj là thư viện Action của Minecraft20, không có mesh.') }
  else left = ensureLeft(entry)
  left.catch(() => {}).then(() => {
    if (!action || state.batchCurrent !== key) return
    if (!(state.actionMap.has(action.index) && !state.stale)) schedulePreview(70)
    selectAction(action.index)
  })
  refreshSteps()
}
let shownBatchEntry = null, leftLoad = null, previewTimer = 0, previewSeq = 0
function ensureLeft(entry) {
  if (leftLoad?.id === entry.sourceId) return leftLoad.promise
  setOverlay('left', 'Đang tải nguồn vào viewer…')
  const promise = viewer.loadSource(`/api/sources/${entry.sourceId}/file`, entry.inspect?.format).then((count) => { if (leftLoad?.promise === promise && count >= 0) setOverlay('left', '') })
    .catch((error) => { if (leftLoad?.promise === promise) setOverlay('left', `Không dựng được viewer cho file này (vẫn xem thử bên phải được):\n${error.message}`, true) })
  leftLoad = { id: entry.sourceId, promise }
  return promise
}
function resetBatchView() {
  shownBatchEntry = null; leftLoad = null; clearTimeout(previewTimer); clearTimeout(prefetchTimer); previewResults.clear(); viewer.suspended = false; previewSeq++
  state.batchRows = []; state.reviewRows = []; state.batchCurrent = null
  renderReview(true)
}
/** Preview of the animation on screen, debounced; a newer request cancels the one in flight so nothing queues up or sticks. */
function schedulePreview(delay = 70) {
  if (!state.batch || state.selected === null || !state.target) return
  clearTimeout(previewTimer)
  if (previewResults.has(JSON.stringify(previewPayload(state.selected)))) { runPreview(); return }
  if (!canRunReason([state.selected])) viewer.suspended = true
  previewTimer = setTimeout(runPreview, delay)
}
async function runPreview() {
  clearTimeout(previewTimer)
  if (!state.batch || state.selected === null) { viewer.suspended = false; return }
  const seq = ++previewSeq
  if (state.running) {
    if (state.run) api(`/api/runs/${state.run}/cancel`, { method: 'POST' }).catch(() => {})
    else state.runAbort = true
    while (state.running) await sleep(40)
    if (seq !== previewSeq) return
  }
  await runNow([state.selected], null, { quiet: true })
}

// Keep only a small window of results; keys include the source, mapping, target and every bake option.
const previewResults = new Map(), previewPending = new Map()
let previewQueue = Promise.resolve(), prefetchTimer = 0
function previewPayload(action) {
  return structuredClone({ sourceId: state.source.sourceId, targetId: state.target.id,
    options: { ...readOptions(), actionRanges: state.actionRanges, actions: [action], previewAction: action, preview: false, review: true }, wait: true,
    ...(state.preset ? { mappingPreset: state.preset, presetFamily: state.presetFamily } : {}) })
}
function cachedPreview(payload) {
  const key = JSON.stringify(payload)
  if (previewResults.has(key)) {
    const result = previewResults.get(key)
    previewResults.delete(key); previewResults.set(key, result)
    return Promise.resolve(result)
  }
  if (previewPending.has(key)) return previewPending.get(key)
  const promise = previewQueue.catch(() => {}).then(() => api('/api/runs', { method: 'POST', json: payload })).then((result) => {
    if (result.status !== 'CANCELLED') {
      previewResults.set(key, result)
      while (previewResults.size > 12) previewResults.delete(previewResults.keys().next().value)
    }
    return result
  }).finally(() => previewPending.delete(key))
  previewPending.set(key, promise); previewQueue = promise
  return promise
}
function prefetchNextPreview() {
  clearTimeout(prefetchTimer)
  const index = state.reviewRows.findIndex((row) => row.key === state.batchCurrent)
  const next = state.reviewRows[index + 1]
  if (index < 0 || !next || next.entry.sourceId !== state.source?.sourceId) return
  const payload = previewPayload(next.action.index), current = state.batchCurrent
  prefetchTimer = setTimeout(() => {
    if (!state.running && state.batchCurrent === current) cachedPreview(payload).then((result) => {
      const glb = result.files?.find((file) => file.kind === 'glb')
      if (glb && !result.files.some((file) => file.kind === 'originalGlb') && !result.report.model && result.manifest?.glb?.mode !== 'model') return viewer.preloadResult(glb.url)
    }).catch(() => {})
  }, 90)
}

// ---------------------------------------------------------------- batch review list (virtualized, next to the viewers)
const REVIEW_ROW = 28
function buildBatchRows() {
  state.batchRows = []
  for (const entry of state.batch?.entries ?? []) {
    if (!entry.sourceId) continue
    for (const action of entry.inspect?.actions ?? []) state.batchRows.push({ key: batchKey(entry, action), entry, action, text: `${entry.name} ${action.name} ${action.nameVi ?? ''} ${action.index + 1}`.toLocaleLowerCase('vi') })
  }
}
function reviewLabel(row) {
  const edit = state.batchEdits.get(row.key)
  const name = edit?.name ?? row.action.name, vi = edit ? edit.nameVi : row.action.nameVi
  return vi ? `${name} | ${vi}` : name
}
function setKept(row, on) { on ? state.batchSelection.set(row.key, { sourceId: row.entry.sourceId, index: row.action.index }) : state.batchSelection.delete(row.key) }
function afterSelectionChange() { renderReview(); renderActionPicker() }
function renderReview(refilter = false, reveal = false) {
  const show = !!state.batch && state.batchRows.length > 0
  $('review').hidden = !show
  document.querySelector('.viewers').classList.toggle('has-review', show)
  if (!show) return
  if (refilter) { const q = $('reviewSearch').value.trim().toLocaleLowerCase('vi'); state.reviewRows = q ? state.batchRows.filter((row) => row.text.includes(q)) : state.batchRows }
  updateReviewCount()
  $('reviewInner').style.height = `${state.reviewRows.length * REVIEW_ROW}px`
  if (reveal) {
    const at = state.reviewRows.findIndex((row) => row.key === state.batchCurrent), list = $('reviewList')
    if (at >= 0) { if (at * REVIEW_ROW < list.scrollTop) list.scrollTop = at * REVIEW_ROW; else if ((at + 1) * REVIEW_ROW > list.scrollTop + list.clientHeight) list.scrollTop = (at + 1) * REVIEW_ROW - list.clientHeight }
  }
  drawReviewRows()
}
function updateReviewCount() {
  const total = state.batchRows.length, shown = state.reviewRows.length, kept = state.batchSelection.size
  $('reviewCount').textContent = `đã chọn ${kept}/${total}${shown !== total ? ` · lọc ${shown}` : ''}`
  $('reviewTransfer').textContent = `Chuyển sang nhân vật đích (${kept})`
  $('reviewTransfer').disabled = !kept || !state.target || state.transferRunning
}
function drawReviewRows() {
  const list = $('reviewList'), rows = state.reviewRows, first = Math.max(0, Math.floor(list.scrollTop / REVIEW_ROW) - 4), last = Math.min(rows.length, Math.ceil((list.scrollTop + (list.clientHeight || 400)) / REVIEW_ROW) + 4)
  const frag = document.createDocumentFragment()
  for (let i = first; i < last; i++) {
    const row = rows[i], kept = state.batchSelection.has(row.key), current = row.key === state.batchCurrent, label = reviewLabel(row)
    frag.append(h('div', { class: `review-row${kept ? '' : ' dropped'}${current ? ' current' : ''}`, role: 'option', 'aria-selected': String(current), dataset: { i: String(i) }, style: `top:${i * REVIEW_ROW}px`, title: `${row.entry.name} · ${label}` },
      h('input', { type: 'checkbox', checked: kept, 'aria-label': `Giữ ${label}` }), h('span', { class: 'idx', text: String(row.action.index + 1) }),
      h('span', { class: 'nm', text: (state.batch.entries.length > 1 ? `${label} · ${row.entry.name}` : label) + (row.entry.status === 'duplicate' ? (row.entry.inLibrary ? ' (đã có trong kho)' : ' (file trùng)') : '') }), h('span', { class: 'dur', text: `${fmt(row.action.durationSeconds)}s` })))
  }
  $('reviewInner').replaceChildren(frag)
}
function stepReview(delta) {
  const rows = state.reviewRows
  if (!rows.length) return
  const at = rows.findIndex((row) => row.key === state.batchCurrent)
  const next = rows[at < 0 ? (delta > 0 ? 0 : rows.length - 1) : (at + delta + rows.length) % rows.length]
  previewBatchAction(next.entry, next.action)
}
let reviewFrame = 0
$('reviewList').addEventListener('scroll', () => { cancelAnimationFrame(reviewFrame); reviewFrame = requestAnimationFrame(drawReviewRows) })
$('reviewInner').addEventListener('click', (event) => {
  const el = event.target.closest('.review-row'), row = el && state.reviewRows[Number(el.dataset.i)]
  if (!row) return
  if (event.target.matches('input')) { setKept(row, event.target.checked); el.classList.toggle('dropped', !event.target.checked); updateReviewCount(); renderActionPicker() }
  else { previewBatchAction(row.entry, row.action); $('reviewList').focus({ preventScroll: true }) }
})
$('reviewSearch').addEventListener('input', () => renderReview(true))
$('reviewPrev').addEventListener('click', () => stepReview(-1))
$('reviewNext').addEventListener('click', () => stepReview(1))
$('reviewAll').addEventListener('click', () => { for (const row of state.reviewRows) setKept(row, true); afterSelectionChange() })
$('reviewNone').addEventListener('click', () => { for (const row of state.reviewRows) setKept(row, false); afterSelectionChange() })
$('reviewInvert').addEventListener('click', () => { for (const row of state.reviewRows) setKept(row, !state.batchSelection.has(row.key)); afterSelectionChange() })
$('reviewTransfer').addEventListener('click', () => { openActionPicker(); $('transferOpen').click() })
new ResizeObserver(() => { if (!$('review').hidden) drawReviewRows() }).observe($('reviewList'))
window.addEventListener('keydown', (event) => {
  if (!state.batch || $('review').hidden || event.ctrlKey || event.metaKey || event.altKey || event.target.matches?.('input,textarea,select,[contenteditable]')) return
  const delta = event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? -1 : 0
  if (delta) { event.preventDefault(); stepReview(delta); return }
  if (event.key === ' ' && (event.target === document.body || event.target === $('reviewList'))) {
    const row = state.batchRows.find((item) => item.key === state.batchCurrent)
    if (row) { event.preventDefault(); setKept(row, !state.batchSelection.has(row.key)); afterSelectionChange() }
  }
})
/** Everything starts kept (files with an error stay dropped; duplicates are kept but tagged "trùng"); the first animation plays in both panes so review can begin at once. */
function startBatchReview() {
  buildBatchRows()
  for (const entry of state.batch.entries) if (entry.status !== 'error') for (const action of entry.inspect?.actions ?? []) state.batchSelection.set(batchKey(entry, action), { sourceId: entry.sourceId, index: action.index })
  renderReview(true)
  const first = state.batchRows.find((row) => state.batchSelection.has(row.key)) ?? state.batchRows[0]
  if (first) previewBatchAction(first.entry, first.action)
}
function openBatchMapping(entry) {
  if (!entry.inspect?.mapping?.joints?.length) return
  previewBatchAction(entry, null)
  closeActionPicker()
  activateTab('mapping')
  renderAll()
  refreshSteps()
}
function renderBatchActionPicker(query) {
  const groups = state.batch?.entries ?? [], body = h('div', { class: 'batch-action-groups' })
  $('actionPickerHandle').querySelector('strong').textContent = 'Animation của lô'
  $('actionPicker').setAttribute('aria-label', 'Animation của lô')
  let total = 0, selected = 0, selectedFiles = 0
  for (const entry of groups) {
    const actions = entry.inspect?.actions ?? []
    total += actions.length
    const chosen = actions.filter((action) => state.batchSelection.has(batchKey(entry, action)))
    selected += chosen.length; if (chosen.length) selectedFiles++
    const group = h('details', { class: 'batch-action-group', open: true })
    const selectGroup = (check) => { for (const action of actions) { const key = batchKey(entry, action); if (check) state.batchSelection.set(key, { sourceId: entry.sourceId, index: action.index }); else state.batchSelection.delete(key) } renderActionPicker() }
    const duplicateLabel = entry.inLibrary ? 'Đã có trong kho' : 'File trùng trong lô'
    const summary = h('summary', {}, `${entry.name} · ${actions.length} animation · ${entry.status === 'duplicate' ? duplicateLabel : entry.status === 'error' ? `Lỗi: ${entry.error ?? 'thiếu xương chính'}` : entry.status === 'ready' ? 'Sẵn sàng' : entry.status}`,
      h('button', { type: 'button', text: 'Chọn hết', onclick: (event) => { event.preventDefault(); event.stopPropagation(); selectGroup(true) } }),
      h('button', { type: 'button', text: 'Bỏ hết', onclick: (event) => { event.preventDefault(); event.stopPropagation(); selectGroup(false) } }))
    group.append(summary)
    if (entry.status === 'error' || !actions.length) {
      if (entry.error) group.append(h('p', { class: 'note', text: entry.error }))
      if (entry.sourceId && entry.inspect?.mapping?.joints?.length) group.append(h('button', { type: 'button', class: 'primary', text: 'Sửa mapping', onclick: (event) => { event.preventDefault(); event.stopPropagation(); openBatchMapping(entry) } }))
      body.append(group); continue
    }
    const tableBody = h('tbody')
    for (const action of actions.filter((item) => !query || `${entry.name} ${item.name} ${item.nameVi ?? ''}`.toLocaleLowerCase('vi').includes(query.trim().toLocaleLowerCase('vi')))) {
      const key = batchKey(entry, action), checkbox = h('input', { type: 'checkbox', 'aria-label': `Chọn ${entry.name}: ${action.name}`, onclick: (event) => event.stopPropagation(), onchange: (event) => { event.target.checked ? state.batchSelection.set(key, { sourceId: entry.sourceId, index: action.index }) : state.batchSelection.delete(key); renderActionPicker() } })
      checkbox.checked = state.batchSelection.has(key)
      const required = pickerRequiredActions(), actionKey = state.batchKeys.get(key) ?? suggestActionKey(required, [action.name]) ?? ''
      const tag = h('select', { 'aria-label': `Thẻ ${entry.name}: ${action.name}`, onclick: (event) => event.stopPropagation(), onchange: (event) => state.batchKeys.set(key, event.target.value) }, h('option', { value: '', text: '—' }), ...required.map((item) => h('option', { value: item.key, text: `${item.label} (${item.key})` })))
      tag.value = actionKey
      const edit = state.batchEdits.get(key) ?? { name: action.name, nameVi: action.nameVi ?? '' }
      const nameCell = h('td', { class: 'name' })
      const startRename = (event) => {
        event?.stopPropagation?.()
        const english = h('input', { value: edit.name, 'aria-label': `Tên Anh ${entry.name} ${action.name}` })
        const vi = h('input', { value: edit.nameVi, placeholder: 'Tên tiếng Việt', 'aria-label': `Tên Việt ${entry.name} ${action.name}` })
        const save = () => {
          if (!english.value.trim()) { toast('Tên tiếng Anh không được để trống', 'err'); return }
          state.batchEdits.set(key, { name: english.value.trim(), nameVi: vi.value.trim() }); renderActionPicker()
        }
        const saveButton = h('button', { type: 'button', text: '✓', title: 'Lưu tên', 'aria-label': `Lưu tên ${entry.name} ${action.name}`, onclick: (click) => { click.stopPropagation(); save() } })
        for (const input of [english, vi]) {
          input.addEventListener('click', (click) => click.stopPropagation())
          input.addEventListener('keydown', (key) => { key.stopPropagation(); if (key.key === 'Enter') save(); else if (key.key === 'Escape') renderActionPicker() })
        }
        clear(nameCell).append(english, vi, saveButton)
        english.focus()
      }
      nameCell.addEventListener('dblclick', startRename)
      nameCell.append(h('span', { text: edit.nameVi ? `${edit.name} | ${edit.nameVi}` : edit.name }),
        h('button', { type: 'button', class: 'icon-button', text: '✎', title: 'Đổi tên', 'aria-label': `Đổi tên ${entry.name}: ${action.name}`, onclick: startRename }))
      tableBody.append(h('tr', { class: 'clickable', onclick: () => previewBatchAction(entry, action) }, h('td', {}, checkbox), h('td', { class: 'num', text: String(action.index + 1) }), nameCell, h('td', {}, tag), h('td', { class: 'num', text: `${fmt(action.durationSeconds)} s` }), h('td', { class: 'quality', text: action.ready ? 'Sẵn sàng' : 'Cần kiểm tra' })))
    }
    group.append(h('table', {}, h('thead', {}, h('tr', {}, h('th'), h('th', { text: '#' }), h('th', { text: 'Tên animation' }), h('th', { text: 'Thẻ động tác' }), h('th', { text: 'Thời lượng' }), h('th', { text: 'Trạng thái' }))), tableBody)); body.append(group)
  }
  $('actionPickerCount').textContent = `đã chọn ${selected}/${total} (${selectedFiles} file)`
  renderReview()
  $('transferOpen').disabled = selected === 0 || !state.target || state.transferRunning
  if (!body.children.length) body.append(h('p', { class: 'empty', text: 'Chưa có file kiểm tra được.' }))
  clear($('actionPickerList')).append(body)
}
function renderActionPicker() {
  if (!picker || picker.hidden) return
  if (state.batch) { renderBatchActionPicker($('actionPickerSearch').value); return }
  $('actionPickerHandle').querySelector('strong').textContent = 'Animation của nguồn'
  $('actionPicker').setAttribute('aria-label', 'Animation của nguồn')
  const actions = state.inspect?.actions ?? [], query = $('actionPickerSearch').value
  $('actionPickerCount').textContent = `đã chọn ${selectedActionIndices().length}/${actions.length}`
  $('transferOpen').disabled = !actions.length || !selectedActionIndices().length || !state.target || state.transferRunning
  const body = h('tbody')
  for (const action of actions.filter((item) => actionMatches(item, query))) {
    const check = h('input', { type: 'checkbox', 'aria-label': `Chọn ${action.name}`, onclick: (event) => event.stopPropagation(), onchange: (event) => {
      event.target.checked ? state.checked.add(action.index) : state.checked.delete(action.index); markRunInputsChanged(false); renderActionPicker()
    } }); check.checked = state.checked.has(action.index)
    const quality = actionQuality(action)
    const edit = state.actionEdits.get(action.index) ?? { name: action.name, nameVi: action.nameVi ?? '' }
    const startRename = (event) => { event.stopPropagation(); state.renamingAction = action.index; renderActionPicker() }
    let name
    if (state.renamingAction === action.index) {
      const english = h('input', { type: 'text', class: 'rename', value: edit.name, 'aria-label': `Tên tiếng Anh ${action.name}`, onclick: (event) => event.stopPropagation() })
      const vietnamese = h('input', { type: 'text', class: 'rename', value: edit.nameVi, placeholder: 'Tên tiếng Việt', 'aria-label': `Tên tiếng Việt ${action.name}`, onclick: (event) => event.stopPropagation() })
      const save = () => {
        const trimmed = english.value.trim()
        if (!trimmed) { toast('Tên tiếng Anh không được để trống', 'err'); english.focus(); return }
        state.actionEdits.set(action.index, { name: trimmed, nameVi: vietnamese.value.trim() }); state.renamingAction = null; renderActionPicker()
      }
      const cancel = () => { state.renamingAction = null; renderActionPicker() }
      const keys = (event) => { event.stopPropagation(); if (event.key === 'Enter') { event.preventDefault(); save() } else if (event.key === 'Escape') { event.preventDefault(); cancel() } }
      english.addEventListener('keydown', keys); vietnamese.addEventListener('keydown', keys)
      name = h('td', { class: 'name renaming' }, english, h('span', { text: ' | ' }), vietnamese,
        h('button', { type: 'button', class: 'icon', title: 'Lưu tên (Enter)', text: '✓', onclick: (event) => { event.stopPropagation(); save() } }),
        h('button', { type: 'button', class: 'icon', title: 'Huỷ (Esc)', text: '✕', onclick: (event) => { event.stopPropagation(); cancel() } }))
      queueMicrotask(() => english.focus())
    } else {
      name = h('td', { class: 'name', ondblclick: startRename }, h('span', { text: edit.nameVi ? `${edit.name} | ${edit.nameVi}` : edit.name }),
        h('button', { type: 'button', class: 'icon rename-btn', title: 'Đổi tên (nhấp đúp vào tên)', 'aria-label': `Đổi tên ${edit.name}`, text: '✎', onclick: startRename }))
    }
    const required = pickerRequiredActions()
    const keySelect = h('select', { 'aria-label': `Thẻ động tác ${edit.name}`, onclick: (event) => event.stopPropagation(), onchange: (event) => state.actionKeys.set(action.index, event.target.value) }, h('option', { value: '', text: '—' }), ...required.map((item) => h('option', { value: item.key, text: `${item.label} (${item.key})` })))
    if (required.length) { keySelect.value = state.actionKeys.get(action.index) ?? suggestActionKey(required, [edit.name]) ?? ''; if (keySelect.value) state.actionKeys.set(action.index, keySelect.value) }
    body.append(h('tr', { class: `clickable${state.selected === action.index ? ' active' : ''}`, dataset: { index: String(action.index) }, onclick: () => selectAction(action.index) },
      h('td', {}, check), h('td', { class: 'num', text: String(action.index + 1) }), name, h('td', {}, keySelect),
      h('td', { class: 'num', text: `${fmt(action.durationSeconds)} s` }), h('td', { class: 'quality' }, h('span', { class: `chip ${quality.class}`, title: quality.title, text: quality.text }))))
  }
  if (!body.children.length) body.append(h('tr', {}, h('td', { colspan: 6, class: 'empty', text: 'Không có animation khớp.' })))
  clear($('actionPickerList')).append(h('table', {}, h('thead', {}, h('tr', {}, h('th'), h('th', { text: '#' }), h('th', { text: 'Tên Anh | Việt' }), h('th', { text: 'Thẻ động tác' }), h('th', { text: 'Thời lượng' }), h('th', { text: 'Chất lượng' }))), body))
}
$('actionPickerBtn').addEventListener('click', openActionPicker)
$('actionPickerClose').addEventListener('click', closeActionPicker)
$('actionPickerSearch').addEventListener('input', renderActionPicker)
$('actionPickerAll').addEventListener('click', () => { if (state.batch) for (const entry of state.batch.entries) for (const action of entry.inspect?.actions ?? []) state.batchSelection.set(batchKey(entry, action), { sourceId: entry.sourceId, index: action.index }); else for (const action of state.inspect?.actions ?? []) state.checked.add(action.index); markRunInputsChanged(false); renderActionPicker() })
$('actionPickerNone').addEventListener('click', () => { if (state.batch) state.batchSelection.clear(); else state.checked.clear(); markRunInputsChanged(false); renderActionPicker() })
$('actionPickerInvert').addEventListener('click', () => { if (state.batch) for (const entry of state.batch.entries) for (const action of entry.inspect?.actions ?? []) { const key = batchKey(entry, action); state.batchSelection.has(key) ? state.batchSelection.delete(key) : state.batchSelection.set(key, { sourceId: entry.sourceId, index: action.index }) } else for (const action of state.inspect?.actions ?? []) state.checked.has(action.index) ? state.checked.delete(action.index) : state.checked.add(action.index); markRunInputsChanged(false); renderActionPicker() })
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
/** Single-file runs export the ticked Actions; in batch mode a run is the preview of the animation on screen. */
function runActions() { return state.batch ? (state.selected === null ? [] : [state.selected]) : selectedActionIndices() }
function canRunReason(actions = runActions()) {
  if (!state.source) return 'Chọn nguồn ở bước 1.'
  if (state.inspecting) return 'Đang kiểm tra…'
  if (!state.inspect) return 'Bấm "Kiểm tra" ở bước 3.'
  if (state.inspect.blocker) return `Đang bị chặn: ${state.inspect.blocker.code}.`
  if (state.dirty) return 'Mapping đã sửa nhưng chưa xác nhận (tab Mapping).'
  if (state.inspect.mapping.needsUserConfirmation && !state.preset) return 'Mapping gợi ý theo hình học: cần xác nhận ở tab Mapping trước khi chạy.'
  if (!actions.length) return state.batch ? 'Chọn một animation trong danh sách duyệt để chạy.' : 'Chưa chọn Action nào để xuất (tab Actions).'
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
  // Batch mode: the run control stays enabled while running (restarts the preview), next to Huỷ.
  $('runBtn').disabled = (state.running && !state.batch) || !!reason
  $('runBtn').textContent = state.batch ? (state.running ? 'Chạy lại animation này' : 'Chạy chuẩn hoá animation này') : 'Chạy chuẩn hoá'
  $('runBtn').title = reason ?? ''
  $('inspectBtn').disabled = !source || state.inspecting || state.running
  $('runInfo').replaceChildren(...(reason && !state.running ? [h('span', { text: reason })] : []),
    ...(state.stale && state.result ? [h('span', { class: 'chip warn', text: 'Kết quả cũ: đã đổi tuỳ chọn/mapping, chạy lại để cập nhật' })] : []))
  if (!reason && !state.running && !state.result) $('runInfo').textContent = 'Sẵn sàng. Bấm "Chạy chuẩn hoá".'
}

// ---------------------------------------------------------------- step 1: source
async function useSource(info) {
  state.batch = null; state.batchSelection.clear(); state.batchPresets.clear(); $('batchPickerBtn').hidden = true; $('batchStatus').hidden = true; resetBatchView()
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
async function queueBatch({ files = [], paths = [], sourceIds = [], uploadId = null } = {}) {
  if (!state.target) { toast('Chọn nhân vật đích trước khi kiểm tra lô.', 'err'); return }
  if (files.filter((file) => /\.(glb|gltf|fbx|bobj)$/i.test(file.name)).length + paths.length + sourceIds.length > 2000) { toast('Mỗi lô tối đa 2000 file.', 'err'); return }
  if (files.some((file) => /\.gltf$/i.test(file.name)) && files.some((file) => !file.webkitRelativePath && !file.batchPath)) { toast('Chọn thư mục chứa .gltf để giữ các file .bin/texture bên cạnh, hoặc nhập đường dẫn thư mục.', 'err'); return }
  state.batch = null; state.batchSelection.clear(); state.batchPresets.clear(); state.batchKeys.clear(); state.batchEdits.clear(); state.result = null; resetBatchView()
  $('batchPickerBtn').hidden = true; $('batchStatus').hidden = false
  if (files.length) {
    const staged = await api('/api/batch-uploads', { method: 'POST' })
    uploadId = staged.uploadId
    $('batchStatus').hidden = false
    for (const [index, file] of files.entries()) {
      $('batchStatus').textContent = `Đang thêm file ${index + 1}/${files.length}: ${file.name}`
      const relativePath = file.batchPath || file.webkitRelativePath || (files.length === 1 ? file.name : `files/${index + 1}/${file.name}`)
      try { await api(`/api/batch-uploads/${uploadId}`, { method: 'POST', headers: { 'x-file-path': encodeURIComponent(relativePath) }, body: file }) }
      catch (error) { toast(`${file.name}: ${error.message}`, 'err'); $('batchStatus').textContent = 'Không tải hết được các file trong lô.'; return }
    }
  }
  if (!paths.length && !sourceIds.length && !uploadId) { $('batchStatus').hidden = true; return }
  $('batchCancel').hidden = false; $('batchPickerBtn').hidden = true
  try {
    const started = await api('/api/batches', { method: 'POST', json: { paths, sourceIds, ...(uploadId ? { uploadId } : {}), targetId: state.target.id, options: readOptions() } })
    state.batchRun = started.batchId; state.batchCancelRequested = false
    let current = started
    while (current.state === 'running') {
      $('batchStatus').textContent = `Đang kiểm tra file ${current.done}/${current.total}…`
      await sleep(250)
      current = await api(`/api/batches/${started.batchId}`)
    }
    state.batch = current
    $('batchStatus').textContent = current.state === 'cancelled'
      ? `Đã huỷ kiểm tra lô sau ${current.done}/${current.total} file.`
      : `Đã kiểm tra ${current.total} file · ${current.entries.filter((entry) => entry.status === 'ready' || entry.status === 'duplicate').length} dùng được · ${current.entries.filter((entry) => entry.status === 'error').length} lỗi.`
    $('batchPickerBtn').hidden = !current.entries.some((entry) => entry.inspect?.actions?.length)
    if (!$('batchPickerBtn').hidden) { startBatchReview(); renderActionPicker() }
  } catch (error) { $('batchStatus').textContent = `Kiểm tra lô thất bại: ${error.message}`; toast(error.message, 'err', true) }
  finally { state.batchRun = null; $('batchCancel').hidden = true }
}
async function usePath() {
  const path = $('pathInput').value.trim()
  if (!path) { toast('Dán đường dẫn file hoặc thư mục vào ô trước.', 'err'); return }
  setStep(1, 'busy', 'Đang đọc')
  await queueBatch({ paths: [path] }); refreshSteps()
}
$('drop').addEventListener('click', () => $('fileInput').click())
$('drop').addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); $('fileInput').click() } })
async function queueDrop(dataTransfer) {
  const files = []
  const readEntry = (entry) => new Promise((resolveEntry, rejectEntry) => {
    if (entry.isFile) entry.file((file) => { file.batchPath = String(entry.fullPath ?? file.name).replace(/^\/+/, ''); resolveEntry(file) }, rejectEntry)
    else if (entry.isDirectory) {
      const reader = entry.createReader(), found = []
      const next = () => reader.readEntries(async (items) => {
        if (!items.length) { try { for (const child of found) await readEntry(child); resolveEntry() } catch (error) { rejectEntry(error) }; return }
        found.push(...items); next()
      }, rejectEntry)
      next()
    } else resolveEntry()
  })
  const items = [...(dataTransfer?.items ?? [])]
  if (items.some((item) => item.webkitGetAsEntry?.())) {
    try { for (const item of items) { const entry = item.webkitGetAsEntry?.(); if (entry) await readEntry(entry); else if (item.kind === 'file') files.push(item.getAsFile()) } }
    catch (error) { toast(`Không đọc được thư mục thả vào: ${error.message}`, 'err'); return }
  } else files.push(...(dataTransfer?.files ?? []))
  const batchFiles = files.filter((file) => /\.(glb|gltf|fbx|bobj|bin|png|jpe?g|webp|ktx2)$/i.test(file.name))
  if (batchFiles.some((file) => /\.(glb|gltf|fbx|bobj)$/i.test(file.name))) await queueBatch({ files: batchFiles })
}
$('fileInput').addEventListener('change', (event) => { queueBatch({ files: [...event.target.files] }); event.target.value = '' })
$('folderInputBtn').addEventListener('click', () => $('folderInput').click())
$('folderInput').addEventListener('change', (event) => { queueBatch({ files: [...event.target.files] }); event.target.value = '' })
for (const type of ['dragenter', 'dragover']) $('drop').addEventListener(type, (event) => { event.preventDefault(); $('drop').classList.add('over') })
for (const type of ['dragleave', 'drop']) $('drop').addEventListener(type, (event) => { event.preventDefault(); $('drop').classList.remove('over') })
$('drop').addEventListener('drop', (event) => queueDrop(event.dataTransfer))
$('pathBtn').addEventListener('click', usePath)
$('batchPickerBtn').addEventListener('click', openActionPicker)
$('batchCancel').addEventListener('click', async () => {
  if (state.transferRunning && state.batch) {
    state.batchCancelRequested = true
    if (state.run) await api(`/api/runs/${state.run}/cancel`, { method: 'POST' })
  } else if (state.batchRun) await api(`/api/batches/${state.batchRun}/cancel`, { method: 'POST' })
})
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
  if (state.source) await inspectNow()
}

// ---------------------------------------------------------------- step 3: inspect
function adjustmentSummary(adjustments) {
  const changed = [...ADJUST_KEYS, 'proportionSide', 'strideSide', 'mirror', 'handPose', 'handSide'].filter((key) => adjustments[key] !== adjustments.defaults?.[key])
  const offsets = Object.keys(adjustments.jointOffsets ?? {})
  return changed.length || offsets.length ? [...changed.map((key) => `${key} ${adjustments[key]}`), ...offsets.map((joint) => `${joint} ${adjustments.jointOffsets[joint].join('/')}°`)].join(', ') : 'không đổi'
}
function groundSummary(ground) {
  const rows = (ground.perAction ?? []).filter((item) => item.applied)
  const skipped = (ground.perAction ?? []).filter((item) => item.skipped).length
  const tail = skipped ? ` · BỎ QUA ${skipped} Action vì lệch quá lớn (sai đơn vị/hệ số root?)` : ''
  if (!rows.length) return `${ground.mode}: không cần dời${tail}`
  const max = Math.max(...rows.map((item) => item.maxOffsetMeters))
  return `${ground.mode}: nâng tối đa ${(max * 100).toFixed(1)} cm ở ${rows.length}/${ground.perAction.length} Action${tail}`
}

const ADJUST_KEYS = ['armSpace', 'legSpace', 'shoulderWidth', 'upperArm', 'forearm', 'legLength', 'intensity', 'stride', 'vertical', 'trimStart', 'trimEnd', 'speed', 'handStrength']
const ADJUST_JOINTS = ['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head', 'LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand', 'RightShoulder', 'RightArm', 'RightForeArm', 'RightHand', 'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'RightUpLeg', 'RightLeg', 'RightFoot']
const adjustJointOffsets = {}, adjustJointAxes = {}
function readAdjustments() {
  const form = $('optionsForm')
  return { ...Object.fromEntries(ADJUST_KEYS.map((key) => [key, Number(form.elements[`adj_${key}`].value)])), proportionSide: form.elements.adj_proportionSide.value, strideSide: form.elements.adj_strideSide.value,
    mirror: form.elements.adj_mirror.checked, handPose: form.elements.adj_handPose.value, handSide: form.elements.adj_handSide.value, jointAxes: { ...adjustJointAxes }, jointOffsets: Object.fromEntries(Object.entries(adjustJointOffsets).filter(([, angles]) => angles.some((n) => n !== 0))) }
}
function renderAdjustOutputs() {
  const form = $('optionsForm')
  for (const out of form.querySelectorAll('[data-adj-out]')) {
    const value = Number(form.elements[`adj_${out.dataset.adjOut}`].value)
    out.textContent = out.dataset.unit === '%' ? `${Math.round(value * 100)}%` : out.dataset.unit === 'x' ? `${value.toFixed(2)}×` : (value > 0 ? '+' : '') + Math.round(value * 100)
  }
  const list = Object.entries(adjustJointOffsets).filter(([, angles]) => angles.some((n) => n !== 0)).map(([joint, angles]) => `${joint} ${angles.join('°, ')}°`)
  $('adjJointList').textContent = list.length ? `Đang xoay: ${list.join(' · ')}` : ''
}
function loadAdjustJoint() { const angles = adjustJointOffsets[$('adjJoint').value] ?? [0, 0, 0]; $('adjJointX').value = angles[0]; $('adjJointY').value = angles[1]; $('adjJointZ').value = angles[2]; $('adjJointAxes').value = adjustJointAxes[$('adjJoint').value] ?? 'local' }
for (const name of ADJUST_JOINTS) { $('adjJoint').append(h('option', { value: name, text: name })); $('adjJointAxes').append(h('option', { value: name, text: `Node: ${name}` })) }
$('adjJointAxes').addEventListener('change', (event) => { event.stopPropagation(); adjustJointAxes[$('adjJoint').value] = $('adjJointAxes').value; markOptionsChanged({ target: optionsForm.elements.adj_armSpace }) })
$('adjJoint').addEventListener('change', (event) => { event.stopPropagation(); loadAdjustJoint() })
for (const id of ['adjJointX', 'adjJointY', 'adjJointZ']) $(id).addEventListener('input', (event) => {
  event.stopPropagation()
  adjustJointOffsets[$('adjJoint').value] = [Number($('adjJointX').value) || 0, Number($('adjJointY').value) || 0, Number($('adjJointZ').value) || 0]
  markOptionsChanged({ target: optionsForm.elements.adj_armSpace })
})
function readOptions() {
  const form = $('optionsForm')
  const get = (name) => form.elements[name]
  const number = (name) => { const value = get(name).value.trim(); return value === '' ? undefined : Number(value) }
  return {
    mode: form.elements.mode.value, rootPolicy: get('rootPolicy').value, rootScale: number('rootScale'), ground: get('ground').value, calibrate: get('calibrate').value,
    facingDegrees: number('facingDegrees'), swapSides: get('swapSides').value, unitMeters: number('unitMeters'), upAxis: get('upAxis').value, bobj: get('bobj').checked, bobjRoot: get('bobjRoot').value,
    adjustments: readAdjustments(),
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
    state.checked = new Set([...state.checked].filter((index) => result.actions.some((action) => action.index === index)))
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
  if (state.batch && state.stale && state.inspect && !state.inspect.blocker && !state.dirty) schedulePreview(70)
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
  if (event?.target?.matches('#adjustLive, #adjJoint, #adjJointAxes, #adjJointX, #adjJointY, #adjJointZ')) return
  state.requestBobj = !!optionsForm.elements.bobj.checked
  if (state.result) { state.stale = true; refreshSteps(); renderOverview(); if (state.selected !== null) selectAction(state.selected) }
  if (!event?.target?.matches('[name=mode], [name=bobj], [name=bobjRoot], [name=rootScale], [name^=adj_]')) inspectSoon()
  renderAdjustOutputs()
  renderOptionHints()
  if (state.batch) { if (event?.target?.matches('[name^=adj_], [name=rootScale], [name=ground], [name=rootPolicy], [name=facingDegrees], [name=swapSides], [name=calibrate]')) schedulePreview(450) }
  else if ($('adjustLive').checked && event?.target?.matches('[name^=adj_]')) { clearTimeout(adjustPreviewTimer); adjustPreviewTimer = setTimeout(previewAdjustments, 450) }
}
let adjustPreviewTimer = 0
async function previewAdjustments() {
  if (state.batch) { await runPreview(); return }
  if (state.running) { clearTimeout(adjustPreviewTimer); adjustPreviewTimer = setTimeout(previewAdjustments, 450); return }
  if (state.selected === null) { toast('Chọn một Action để xem thử.', 'err'); return }
  await runNow([state.selected])
}
$('adjustPreview').addEventListener('click', previewAdjustments)
$('adjustReset').addEventListener('click', () => {
  for (const key of ADJUST_KEYS) optionsForm.elements[`adj_${key}`].value = optionsForm.elements[`adj_${key}`].dataset.default
  optionsForm.elements.adj_proportionSide.value = 'both'; optionsForm.elements.adj_strideSide.value = 'both'; optionsForm.elements.adj_mirror.checked = false
  for (const key of Object.keys(adjustJointOffsets)) delete adjustJointOffsets[key]
  for (const key of Object.keys(adjustJointAxes)) delete adjustJointAxes[key]
  optionsForm.elements.adj_handPose.value = 'original'; optionsForm.elements.adj_handSide.value = 'both'
  loadAdjustJoint()
  markOptionsChanged({ target: optionsForm.elements.adj_armSpace })
})
renderAdjustOutputs()
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
async function runNow(onlyActions = null, actionNames = null, { quiet = false } = {}) {
  clearTimeout(prefetchTimer)
  if (!quiet) {
    clearTimeout(previewTimer)
    while (state.running) await sleep(20)
    viewer.suspended = false
    clearTimeout(prefetchTimer)
    await previewQueue.catch(() => {})
  }
  const reason = canRunReason(onlyActions ?? runActions())
  if (reason) { if (quiet) { viewer.suspended = false; setOverlay('right', reason, true) } else toast(reason, 'err'); return }
  const all = onlyActions ?? runActions()
  const options = { ...readOptions(), actionRanges: state.actionRanges, preview: !quiet, ...(actionNames ? { actionNames } : {}), ...(all.length === state.inspect.actions.length ? {} : { actions: all }), ...(state.selected !== null && all.includes(state.selected) ? { previewAction: state.selected } : {}) }
  state.running = true; state.runAbort = false; state.runQuiet = quiet
  if (quiet) viewer.suspended = true
  $('progress').hidden = false; $('cancelBtn').hidden = false
  if (quiet) setOverlay('right', '')
  setProgress('queued', 0, 1, 0)
  refreshSteps()
  try {
    const payload = quiet ? previewPayload(all[0]) : { sourceId: state.source.sourceId, targetId: state.target.id, options, wait: false,
      ...(state.preset ? { mappingPreset: state.preset, presetFamily: state.presetFamily } : {}) }
    const requestKey = quiet ? JSON.stringify(payload) : null
    let current
    if (quiet) {
      const result = await cachedPreview(payload)
      current = { state: result.status === 'CANCELLED' ? 'CANCELLED' : 'done', result }
      if (state.runAbort || !state.source || !state.target || state.selected === null || requestKey !== JSON.stringify(previewPayload(state.selected))) return
    } else {
      const started = await api('/api/runs', { method: 'POST', json: payload })
      state.run = started.runId
      if (state.runAbort) await api(`/api/runs/${started.runId}/cancel`, { method: 'POST' }).catch(() => {})
      current = started
      let failures = 0
      while (current.state === 'running') {
        await sleep(300)
        try { current = await api(`/api/runs/${started.runId}`); failures = 0 } catch (error) { if (++failures > 5) throw error }
        setProgress(current.stage, current.done, current.total, current.elapsedMs)
      }
    }
    if (current.state === 'CANCELLED') { if (!quiet) { $('runInfo').textContent = 'CANCELLED — Đã huỷ lượt chạy'; toast('Đã huỷ lượt chạy', 'ok') } return }
    if (current.state === 'error') throw new Error(current.error)
    // Preview of an animation the user already moved away from: drop it instead of jumping back.
    if (quiet && !all.includes(state.selected)) return
    await finishRun(current.result, options, quiet)
    return current.result
  } catch (error) {
    if (quiet) setOverlay('right', `Xem thử thất bại: ${error.message}. Chỉnh lại hoặc bấm chạy lại.`, true)
    else toast(`Chạy thất bại: ${error.message}`, 'err', true)
    $('runInfo').textContent = `Chạy thất bại: ${error.message}`
  } finally {
    state.run = null
    $('cancelBtn').hidden = true
    state.running = false; state.runQuiet = false
    if (quiet) viewer.suspended = false
    if ($('rightMsg').dataset.progress) { delete $('rightMsg').dataset.progress; if (!$('rightMsg').classList.contains('err')) setOverlay('right', '') }
    $('progress').hidden = true
    refreshSteps()
    if (quiet && !state.runAbort) prefetchNextPreview()
  }
}
function setProgress(stage, done, total, elapsedMs) {
  const fraction = total > 0 ? Math.min(1, done / total) : 0
  $('progressBar').style.width = `${Math.round(fraction * 100)}%`
  const batch = state.batchProgress
  const batchLabel = batch ? ` · file ${batch.file}/${batch.files}, animation ${Math.min(batch.animationBase + done + 1, batch.animations)}/${batch.animations}` : ''
  $('progressText').textContent = `${STAGES[stage] ?? stage}${total > 1 ? ` ${Math.min(done + 1, total)}/${total}` : ''}${batchLabel} · ${(elapsedMs / 1000).toFixed(1)} s`
  if (state.runQuiet) { setOverlay('right', `Đang xem thử: ${$('progressText').textContent}`); $('rightMsg').dataset.progress = '1' }
}
async function finishRun(result, options, quiet = false) {
  state.result = result; state.stale = false; state.resultOptions = options
  state.actionMap = new Map()
  const report = result.report
  const manifestActions = result.manifest?.actions ?? []
  manifestActions.forEach((entry, glbIndex) => state.actionMap.set(entry.sourceActionIndex, { glbIndex, duration: entry.durationSeconds, uuid: entry.uuid, quality: report.roundtrip?.perAction?.[glbIndex]?.quality, perAction: report.roundtrip?.perAction?.[glbIndex] }))
  state.libraryDestinations = new Set()
  state.libraryActions = new Map(manifestActions.map((entry) => [entry.uuid, 'idle']))
  if (quiet) { renderOverview(); renderDownloads() } else { fillActionSelect(); renderAll(); activateTab('overview') }
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
    const first = quiet ? state.selected : report.roundtrip?.primaryAction ?? manifestActions[0]?.sourceActionIndex ?? state.selected ?? 0
    selectAction(first)
  } else setOverlay('right', `Không có GLB: ${result.status}${report.blocker ? ` — ${report.blocker.code}` : ''}`)
  if (!quiet || result.status !== 'PASS') toast(`Kết quả: ${result.status}${report.blocker ? ` (${report.blocker.code})` : ''}`, result.status === 'PASS' ? 'ok' : 'err')
}
$('runBtn').addEventListener('click', () => { if (state.batch) runPreview(); else runNow() })
$('cancelBtn').addEventListener('click', async () => {
  if (!state.run) { state.runAbort = true; return }
  if (state.batch && state.transferRunning) state.batchCancelRequested = true
  try { await api(`/api/runs/${state.run}/cancel`, { method: 'POST' }) } catch (error) { toast(error.message, 'err') }
})

async function prepareTransfer() {
  if (!state.libraryCharacters) state.libraryCharacters = (await api('/api/library/characters')).characters
  const destinations = clear($('transferCharacter'))
  const compatible = state.libraryCharacters.filter((character) => (state.batch && character.rig === 'minecraft20') || compatibleLibraryCharacter(character).enabled)
  state.transferCharacters = new Set([...state.transferCharacters].filter((charId) => compatible.some((character) => character.charId === charId)))
  const targetCharacter = state.target?.id?.startsWith('lib-') ? state.target.id.slice(4) : ''
  if (!state.transferCharacters.size && compatible.some((character) => character.charId === targetCharacter)) state.transferCharacters.add(targetCharacter)
  if (!state.transferCharacters.size && compatible[0]) state.transferCharacters.add(compatible[0].charId)
  for (const character of compatible) {
    const checked = state.transferCharacters.has(character.charId)
    const input = h('input', { type: 'checkbox', value: character.charId, 'aria-label': `Chọn ${character.name}`, onchange: (event) => {
      event.target.checked ? state.transferCharacters.add(character.charId) : state.transferCharacters.delete(character.charId)
      renderTransferDestinations(); renderTransferKeys(); renderActionPicker()
    } })
    input.checked = checked
    destinations.append(h('label', { class: `destination-card${checked ? ' selected' : ''}` }, input,
      h('span', {}, h('b', { text: character.name }), h('small', { text: character.rig }))))
  }
  const character = state.libraryCharacters.find((item) => item.charId === [...state.transferCharacters][0])
  $('transferCharacterPack').checked = !!character
  $('transferCharacterPack').disabled = !character
  renderTransferKeys()
  $('transferConfirm').hidden = false
  renderActionPicker()
}
function renderTransferDestinations() {
  const destinations = $('transferCharacter')
  if (!destinations?.children.length) return
  for (const input of destinations.querySelectorAll('input[type=checkbox]')) {
    const checked = state.transferCharacters.has(input.value)
    input.checked = checked
    input.closest('label')?.classList.toggle('selected', checked)
  }
}
function selectedTransferCharacters() {
  return (state.libraryCharacters ?? []).filter((character) => state.transferCharacters.has(character.charId))
}
function renderTransferKeys() {
  const characters = selectedTransferCharacters()
  const select = clear($('transferActionKey'))
  const requiredActions = characters.length
    ? (characters[0].requiredActions ?? []).filter((item) => characters.every((character) => (character.requiredActions ?? []).some((required) => required.key === item.key)))
    : []
  for (const required of requiredActions) select.append(h('option', { value: required.key, text: `${required.label} (${required.key})` }))
  if (!select.options.length) select.append(h('option', { value: 'idle', text: 'Đứng yên (idle)' }))
  const selectedNames = selectedActionIndices().map((index) => {
    const action = state.inspect?.actions?.find((item) => item.index === index)
    return action?.displayName ?? action?.name
  }).filter(Boolean)
  const suggestion = suggestActionKey(requiredActions, selectedNames)
  if (suggestion) select.value = suggestion
  if (!characters.length) $('transferCharacterPack').checked = false
  else if ($('transferCharacterPack').disabled) $('transferCharacterPack').checked = true
  $('transferCharacterPack').disabled = !characters.length
}
$('transferOpen').addEventListener('click', async () => { try { await prepareTransfer() } catch (error) { toast(`Không đọc được thư viện: ${error.message}`, 'err') } })
function syncBatchDestinationOptions() {
  const hasMinecraft20 = selectedTransferCharacters().some((character) => character.rig === 'minecraft20')
  if (state.batch && (hasMinecraft20 || $('transferShared').checked || state.transferConfig?.toShared)) $('optionsForm').elements.bobj.checked = true
  state.requestBobj = !!$('optionsForm').elements.bobj.checked
}
async function transferSelected(indices, retryConfig = null) {
  const config = retryConfig ?? { toCharacter: $('transferCharacterPack').checked, toShared: $('transferShared').checked, charIds: [...state.transferCharacters], key: $('transferActionKey').value }
  state.transferConfig = Object.freeze({ ...config })
  const toCharacter = config.toCharacter, toShared = config.toShared
  if (!toCharacter && !toShared) throw new Error('Chọn Bộ của nhân vật và/hoặc Kho dùng chung.')
  if (toCharacter && !config.charIds.length) throw new Error('Chọn ít nhất một nhân vật đích.')
  if (!indices.length) throw new Error('Chưa chọn animation.')
  state.transferRunning = true
  for (const control of $('transferConfirm').querySelectorAll('input,select,button')) control.disabled = true
  const selectedCharacter = state.libraryCharacters?.find((item) => item.charId === config.charIds[0])
  const characterTarget = state.targets.find((item) => item.id === `lib-${config.charIds[0]}`)
  if (selectedCharacter?.rig === 'mixamo65' && !characterTarget) throw new Error(`Nhân vật ${selectedCharacter.name} chưa có model đích trong Workbench. Tải lại Workbench sau khi thêm nhân vật.`)
  if (characterTarget && state.target?.id !== characterTarget.id) await chooseTarget(characterTarget)
  renderActionPicker(); $('transferStatus').textContent = `Đang chuẩn hoá ${indices.length} animation…`
  const transferNames = {}
  const nameCounts = new Map()
  for (const index of indices) { const edit = state.actionEdits.get(index); if (!edit) continue; const base = edit.name.trim(); const count = nameCounts.get(base.toLocaleLowerCase()) ?? 0; nameCounts.set(base.toLocaleLowerCase(), count + 1); transferNames[index] = { ...edit, name: count ? `${base}_${count + 1}` : base } }
  const transferred = await executeTransfer({ indices, toCharacter, toShared, normalize: (exact) => runNow(exact, transferNames),
    importCharacter: (result, succeeded) => api(`/api/runs/${result.runId}/character-library`, { method: 'POST', json: {
      charIds: config.charIds, actions: succeeded.map((action) => { const index = action.sourceActionIndex; const edited = state.actionEdits.get(index); return { uuid: action.uuid, key: state.actionKeys.get(index) || config.key, ...(edited ? { name: action.name, nameVi: edited.nameVi } : {}) } }),
    } }),
    importShared: (result, succeeded) => api(`/api/runs/${result.runId}/library`, { method: 'POST', json: { actions: succeeded.map((action) => ({ uuid: action.uuid, key: state.actionKeys.get(action.sourceActionIndex) || config.key || 'idle' })) } }),
  })
  const succeeded = transferred.actions, drafts = transferred.drafts, shared = transferred.shared
  state.transferFailed = transferred.failed
  $('transferRetry').hidden = !state.transferFailed.length
  if (!succeeded.length) throw new Error(`Không animation nào chuẩn hoá thành công. Có thể thử lại ${state.transferFailed.length} action lỗi.`)
  const targetNames = (state.libraryCharacters ?? []).filter((item) => config.charIds.includes(item.charId)).map((item) => item.name)
  const summary = [`Đã chuyển ${succeeded.length} animation`, ...(toCharacter ? [`→ ${targetNames.join(', ') || 'nhân vật'} (${drafts.length} Nháp)`] : []), ...(toShared ? [`+ kho dùng chung (${shared?.created === false ? 'đã có' : '1 gói'})`] : [])].join(' ')
  $('transferStatus').textContent = state.transferFailed.length ? `${summary}. Lỗi ${state.transferFailed.length}: ${state.transferFailed.map((index) => state.inspect.actions[index]?.displayName ?? index).join(', ')}` : summary
  if (!state.transferFailed.length) { state.libraryCharacters = null; state.transferConfig = null }
  return { normalized: succeeded.length, drafts: drafts.length, sharedPacks: toShared ? 1 : 0, failed: state.transferFailed }
}
$('transferStart').addEventListener('click', async () => {
  $('transferStart').disabled = true
  try { if (state.batch) await transferBatch(selectedBatchGroups()); else await transferSelected(selectedActionIndices()); toast('Đã chuyển animation vào thư viện', 'ok') }
  catch (error) { $('transferStatus').textContent = `Chuyển thất bại: ${error.message}`; toast(error.message, 'err', true) }
  finally { state.transferRunning = false; for (const control of $('transferConfirm').querySelectorAll('input,select,button')) control.disabled = false; renderActionPicker() }
})
async function transferBatch(groups, retryConfig = null) {
  const config = retryConfig ?? { toCharacter: $('transferCharacterPack').checked, toShared: $('transferShared').checked, charIds: [...state.transferCharacters], key: $('transferActionKey').value, licenseSource: $('transferLicenseSource').value.trim() }
  if (!config.toCharacter && !config.toShared) throw new Error('Chọn Bộ của nhân vật và/hoặc Kho dùng chung.')
  if (config.toCharacter && !config.charIds.length) throw new Error('Chọn ít nhất một nhân vật đích.')
  state.transferConfig = Object.freeze({ ...config }); state.transferRunning = true; state.batchFailedEntries = []; state.batchCancelRequested = false
  syncBatchDestinationOptions()
  $('batchRetry').hidden = true
  $('batchCancel').hidden = false; $('batchCancel').textContent = 'Huỷ chuyển lô'
  for (const control of $('transferConfirm').querySelectorAll('input,select,button')) control.disabled = true
  let completed = 0, drafts = 0, sharedPacks = 0
  const totalActions = groups.reduce((sum, item) => sum + item.actions.length, 0)
  for (const [position, group] of groups.entries()) {
    if (state.batchCancelRequested) break
    const { entry, actions } = group
    $('transferStatus').textContent = `Chuẩn hoá file ${position + 1}/${groups.length}, animation ${completed + 1}/${totalActions}…`
    try {
      if (!entry.sourceId || !entry.inspect || entry.inspect.blocker) throw new Error(entry.error ?? 'File thiếu xương chính hoặc không có Action')
      if (config.toCharacter) {
        const characterTarget = state.targets.find((item) => item.id === `lib-${config.charIds[0]}`)
        const character = state.libraryCharacters?.find((item) => item.charId === config.charIds[0])
        if (character?.rig === 'mixamo65' && !characterTarget) throw new Error(`Nhân vật ${character.name} chưa có model đích trong Workbench`)
        if (characterTarget && state.target?.id !== characterTarget.id) await chooseTarget(characterTarget)
      }
      state.source = { sourceId: entry.sourceId, name: entry.name, format: entry.inspect.format, bytes: entry.bytes ?? 0, sha256: entry.sha256, uploaded: !entry.path, path: entry.path }
      const saved = entry.sourceId ? state.batchPresets.get(entry.sourceId) : null
      state.inspect = entry.inspect; state.inspectError = null; state.rows = []; state.preset = saved?.preset ?? null; state.presetFamily = saved?.family ?? null; state.dirty = false
      if (!state.preset && entry.inspect.mapping?.needsUserConfirmation) {
        const assignments = Object.fromEntries((entry.inspect.mapping.joints ?? []).map((joint) => [joint.target, joint.source]))
        const mapped = await api('/api/preset', { method: 'POST', json: { sourceId: entry.sourceId, targetId: state.target.id, assignments } })
        state.preset = mapped.preset; state.presetFamily = mapped.family
      }
      state.checked = new Set(actions.map((action) => action.index)); state.selected = actions[0]?.index ?? null
      state.batchProgress = { file: position + 1, files: groups.length, animationBase: completed, animations: totalActions }
      const names = {}
      for (const action of actions) {
        const edit = state.batchEdits.get(batchKey(entry, action)) ?? { name: action.name, nameVi: action.nameVi ?? '' }
        names[action.index] = edit
      }
      const result = await runNow(actions.map((action) => action.index), names)
      if (!result || result.status !== 'PASS') throw new Error(result?.report?.blocker?.message ?? `Chuẩn hoá trả ${result?.status ?? 'lỗi'}`)
      const byIndex = new Map((result.manifest?.actions ?? []).map((action) => [action.sourceActionIndex, action]))
      const succeeded = actions.map((action) => byIndex.get(action.index)).filter(Boolean)
      const failedActions = actions.filter((action) => !byIndex.has(action.index))
      if (config.toCharacter && succeeded.length) {
        const sent = await api(`/api/runs/${result.runId}/character-library`, { method: 'POST', json: { charIds: config.charIds, actions: succeeded.map((action) => {
          const sourceAction = actions.find((item) => item.index === action.sourceActionIndex)
          const edit = state.batchEdits.get(batchKey(entry, sourceAction))
          return { uuid: action.uuid, key: state.batchKeys.get(batchKey(entry, sourceAction)) || config.key || 'idle', name: action.name, ...(action.nameVi ? { nameVi: action.nameVi } : edit ? { nameVi: edit.nameVi } : {}), sourceName: action.sourceName ?? sourceAction.sourceName ?? sourceAction.name }
        }) } })
        drafts += sent.drafts?.length ?? succeeded.length
      }
      if (config.toShared && succeeded.length) {
        const licenseSource = config.licenseSource || (entry.inspect.mapping?.family === 'mixamo' ? 'Mixamo (Adobe)' : '')
        const shared = await api(`/api/runs/${result.runId}/library`, { method: 'POST', json: { actions: succeeded.map((action) => {
          const sourceAction = actions.find((item) => item.index === action.sourceActionIndex)
          const edit = state.batchEdits.get(batchKey(entry, sourceAction))
          return { uuid: action.uuid, key: state.batchKeys.get(batchKey(entry, sourceAction)) || config.key || 'idle', name: action.name, ...(action.nameVi ? { nameVi: action.nameVi } : edit ? { nameVi: edit.nameVi } : {}), sourceName: action.sourceName ?? sourceAction.sourceName ?? sourceAction.name }
        }), ...(licenseSource ? { license: { id: 'internal-only', commitable: false, source: licenseSource } } : {}) } })
        // One shared pack per source file; it may already exist when the character drafts were made first.
        sharedPacks += 1
      }
      completed += succeeded.length
      if (failedActions.length) { entry.error = `${failedActions.length} animation lỗi`; state.batchFailedEntries.push({ entry, actions: failedActions }) }
    } catch (error) { state.batchFailedEntries.push(group); entry.error = error.message }
  }
  $('batchRetry').hidden = state.batchFailedEntries.length === 0
  const targetNames = (state.libraryCharacters ?? []).filter((item) => config.charIds.includes(item.charId)).map((item) => item.name)
  $('transferStatus').textContent = `${state.batchCancelRequested ? 'Đã huỷ' : 'Đã chuyển'} ${completed} animation${config.toCharacter ? ` → ${targetNames.join(', ') || 'nhân vật'} (${drafts} Nháp)` : ''}${config.toShared ? ` + kho dùng chung (${sharedPacks} gói)` : ''}${state.batchFailedEntries.length ? ` · ${state.batchFailedEntries.length} file lỗi, có thể thử lại` : ''}`
  state.batchProgress = null
  $('batchCancel').hidden = true; $('batchCancel').textContent = 'Huỷ kiểm tra lô'
  return { completed, failed: state.batchFailedEntries.length }
}
$('batchRetry').addEventListener('click', async () => {
  const failed = [...state.batchFailedEntries], config = state.transferConfig
  $('batchRetry').hidden = true
  try { await transferBatch(failed, config); toast('Đã thử lại các file lỗi', 'ok') }
  catch (error) { $('transferStatus').textContent = `Thử lại thất bại: ${error.message}`; $('batchRetry').hidden = !state.batchFailedEntries.length }
  finally { state.transferRunning = false; for (const control of $('transferConfirm').querySelectorAll('input,select,button')) control.disabled = false; renderActionPicker() }
})
$('transferRetry').addEventListener('click', async () => {
  const failed = [...state.transferFailed], config = state.transferConfig
  $('transferRetry').hidden = true
  try { await transferSelected(failed, config) } catch (error) { $('transferStatus').textContent = `Thử lại thất bại: ${error.message}`; $('transferRetry').hidden = !state.transferFailed.length }
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
    report.adjustments ? ['Hiệu chỉnh', adjustmentSummary(report.adjustments)] : null,
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
  closeBoneChooser()
  const box = clear($('tab-mapping'))
  hoveredMappingTarget = null
  if (!state.rows.some((row) => row.target === activeMappingTarget)) activeMappingTarget = null
  syncMappingHighlights()
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
  const toolbar = h('div', { class: 'toolbar' },
    h('input', { type: 'search', placeholder: 'Lọc theo tên khớp / xương…', value: state.search, 'aria-label': 'Lọc mapping', oninput: (event) => { state.search = event.target.value; renderMappingRows() } }),
    h('span', { class: 'seg row' }, FILTERS.map(([key, label]) => h('button', { type: 'button', 'aria-pressed': String(state.filter === key), onclick: () => { state.filter = key; renderMapping() }, text: label }))))
  const actions = h('div', { class: 'toolbar' },
    h('button', { type: 'button', class: 'primary', style: 'width:auto', onclick: confirmMapping, text: 'Xác nhận mapping', disabled: !state.dirty && !!state.preset }),
    h('button', { type: 'button', onclick: resetMapping, text: 'Đặt lại tự động', disabled: !state.dirty && !state.preset }),
    h('span', { class: 'chip', id: 'mapCount', text: `${mapped}/65 đã map` }))
  const body = h('tbody', { id: 'mapRows' })
  box.append(actions, toolbar, h('table', {}, h('thead', {}, h('tr', {}, h('th', { text: 'Khớp Mixamo65' }), h('th', { text: 'Xương nguồn (gõ để tìm, xoá = bỏ map)' }), h('th', { text: 'Cách map' }))), body))
  function renderMappingRowsInner() {
    closeBoneChooser()
    clear(body)
    for (const row of state.rows.filter(rowMatches)) {
      const input = h('input', { type: 'text', value: row.source ?? '', spellcheck: 'false', 'aria-label': `Xương nguồn cho ${row.target}`, placeholder: '— chưa map —' })
      input.dataset.target = row.target
      input.addEventListener('focus', () => { activeMappingTarget = row.target; syncMappingHighlights() })
      input.addEventListener('change', () => {
        const value = input.value.trim()
        if (value && !names.has(value)) { toast(`"${value}" không phải xương của nguồn này.`, 'err'); input.value = row.source ?? ''; return }
        assignMappingSource(row.target, value)
      })
      const dup = row.source && used.get(row.source) > 1
      body.append(h('tr', { dataset: { target: row.target }, onmouseenter: () => { hoveredMappingTarget = row.target; syncMappingHighlights() }, onmouseleave: () => { hoveredMappingTarget = null; syncMappingHighlights() }, class: `${row.source !== row.original ? 'edited' : ''} ${missing.has(row.target) && !row.source ? 'missing' : ''}` },
        h('td', { text: row.target }), h('td', {}, boneChooser(input, [...names], (value) => {
          if (assignMappingSource(row.target, value)) {
            const next = [...document.querySelectorAll('#mapRows input')].find((item) => item.dataset.target === row.target)
            next?.focus({ preventScroll: true })
          }
        }), dup ? h('small', { class: 'dup', text: 'Xương này đang gán cho nhiều khớp' }) : null),
        h('td', {}, h('span', { class: `via ${row.ambiguous ? 'ambiguous' : row.via ?? ''}`, text: row.ambiguous ? 'ambiguous' : row.via ?? (missing.has(row.target) ? 'thiếu bắt buộc' : '—') }))))
    }
    if (!body.children.length) body.append(h('tr', {}, h('td', { colspan: 3, class: 'empty', text: 'Không có dòng nào khớp bộ lọc.' })))
  }
  renderMappingRows = () => { renderMappingRowsInner(); syncMappingHighlights() }
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
    const entry = state.batch?.entries.find((item) => item.sourceId === state.source.sourceId)
    if (entry) {
      state.batchPresets.set(entry.sourceId, { preset, family: state.presetFamily })
      entry.inspect = state.inspect
      entry.status = state.inspect?.blocker ? 'error' : state.inspect?.actions?.length ? 'ready' : 'error'
      entry.error = state.inspect?.blocker?.message ?? (entry.status === 'error' ? 'File không có animation có thời lượng lớn hơn 0' : undefined)
      if (entry.status === 'ready') for (const action of entry.inspect.actions) state.batchSelection.set(batchKey(entry, action), { sourceId: entry.sourceId, index: action.index })
      buildBatchRows(); renderReview(true); renderActionPicker()
    }
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
