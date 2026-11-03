# JS snippets for driving App 2 / App 3 (run in the App 2 page)

These are for inspection and setting up a test state. Do not use them to ship behaviour: fix the source instead.
App 3 lives in `iframe.wb-animation-creation-frame` (same origin), so `contentDocument` works. React inputs need the native
value setter plus an `input`/`change` event.

## Helpers (paste first)
```js
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const setValue = (el, v) => {
  const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v)
  el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }))
}
const app3 = () => document.querySelector('iframe.wb-animation-creation-frame')?.contentDocument
const host = () => app3()?.getElementById('bbsHostControls')   // "Dự án & trao đổi với cảnh" panel
const button = (root, text) => [...root.querySelectorAll('button')].find((b) => b.textContent.trim() === text)
```

## Switch workspace (top bar: "1 Chuẩn hoá", "2 Dựng cảnh", "3 Animation", "4 VFX", "5 Thư viện")
```js
[...document.querySelectorAll('button,a')].find((b) => /^\s*3\s*Animation\s*$/.test(b.textContent))?.click()
await sleep(10000)   // App 3 iframe + bridge
```

## F2 timeline
```js
// open the timeline (the button toggles: check first)
if (!document.querySelector('.t3d-timeline-clip')) button(document, 'Dòng thời gian')?.click()
// clips: data-clip-id, text = motion name; blend bands: .t3d-timeline-clip-blend (title = "Trộn N khung · …")
;[...document.querySelectorAll('.t3d-timeline-clip')].map((e) => e.dataset.clipId + ':' + e.textContent.trim().slice(0, 30))
// screen coords for a real click (screenshots are often half-scale: divide by the screenshot ratio)
const r = document.querySelector('[data-clip-id="ID"]').getBoundingClientRect()
```
The Undo/Redo buttons are labelled "Hoàn tác" / "Làm lại".

## F3: pick character, range, open shot
```js
const k = host()
const sel = k.querySelector('select')                       // first select = Nhân vật
setValue(sel, [...sel.options].find((o) => o.text.startsWith('Gỗ')).value)
await sleep(600)                                            // range auto-fills to the character's whole clip chain (#204)
const [from, to] = k.querySelectorAll('input[type=number]') // Từ frame / Đến frame
// setValue(from, '0'); setValue(to, '58')                  // only to override
button(k, 'Mở shot từ cảnh').click()
await sleep(25000)                                          // export + bake; chains of 5 clips can take ~45 s
;({ status: k.querySelector('[role=status]')?.textContent, error: k.querySelector('[role=alert]')?.textContent })
```
Keep each javascript call under ~40 s; split long waits across calls.

## App 3 settings (onion example)
```js
const d = app3(), w = d.defaultView
d.getElementById('onionOptions').click()          // opens "Cài đặt" at Bóng pose; toggles, so it may close an open dialog
const en = d.getElementById('onionEnabled'); if (!en.checked) en.click()
for (const [id, v] of [['onionSpread', '100'], ['onionSpreadAxis', 'x'], ['onionBefore', '5']]) {
  const el = d.getElementById(id); el.value = v
  for (const t of ['input', 'change']) el.dispatchEvent(new w.Event(t, { bubbles: true }))
}
// close: click the visible "Đóng" until it is gone
for (let i = 0; i < 3; i++) { const c = [...d.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Đóng' && b.getBoundingClientRect().width > 0); if (!c) break; c.click(); await sleep(400) }
// current frame
const f = d.getElementById('frameInput'); f.value = '29'; for (const t of ['input', 'change']) f.dispatchEvent(new w.Event(t, { bubbles: true }))
```
Other useful ids: `viewportLayout` (single/dual/triple/quad), `cameraPreset` (reset/front/side/left/top/back),
`layoutMoreTools` (the "…" menu, a `<details>`: set `.open = true`), `rigPresetMenu` (Control Rig ▾, holds `rigLabels` "Nhãn chọn"),
`layoutLeft` (left column, scroll it to reveal the host panel).

## Film export panel (App 2 "Xuất ▾" → "Gói BBS FS")
Advanced section summary text: "Tuỳ chọn nâng cao". It holds "Liệt kê phim trong world" / "Xoá gói ZIP cũ trong project".
The game folder field may point at the REAL Minecraft install: listing is read-only, deleting is not. Never confirm a delete while testing.
