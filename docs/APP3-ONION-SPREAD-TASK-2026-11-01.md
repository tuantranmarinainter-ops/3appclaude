# Task App 3: giãn bóng onion skin để dễ nhìn và dễ chọn (2026-11-01)

> Người dùng giao 2026-11-01. Giao Codex. Một nhánh `codex/app3-onion-spread` + một PR vào `main`, **không tự merge**.
> Chỉ sửa `three-workspace-app/animation-studio/`. App 3 là GPL-3.0 (xem `docs/DECISIONS.md`).

## Người dùng muốn gì
"Tôi chọn hiện trước và sau mỗi bên 10 khung, nhưng các bóng quá sít nhau. Muốn tuỳ chọn trong bánh răng để giãn / co bóng
cho dễ thấy và dễ chọn bóng để sửa pose. Chỉ bóng giãn ra; khi sang frame tiếp theo nhân vật vẫn ở đúng vị trí gốc."

Tức là: **dời vị trí hiển thị của các bóng** theo thứ tự (bóng xa hơn dời xa hơn), **không đổi dữ liệu animation**, không đổi vị trí
nhân vật thật, không tạo key.

## Hiện trạng (đọc trên `main` 9697415)
- `src/onion_skin.js`: `defaults` (onionEnabled, onionSampling, onionBefore/After 0–100, onionStep, onionUnit, onionParts,
  opacity, onionFade, màu trước/sau, onionPlayback), `validate()`, `sampleTimes()` trả `{ time, side: 'before'|'after', rank }`.
  `OnionSkin.update()` đặt mỗi bóng `slot.wrapper.position/quaternion/scale` = `view.wrapper` rồi `C.evaluate` pose tại `sample.time`;
  đường xương vẽ từ `getWorldPosition` của bone bóng. Bỏ qua cập nhật khi `signature = JSON.stringify([time, revision, activeRoot, s])`
  không đổi.
- `src/app.js`: `readOnionSettings()` đọc mọi id trong `O.defaults` từ DOM; `syncOnionUI()`; nút `#onionOptions` mở
  `⚙ → #onionSettings`; `#onionReset` về `O.defaults`.
- **Chọn bóng đã có**: `pickOnionPose(ray)` raycast vào mesh/đường xương của từng bóng, trúng thì `seek(hit.time)` (không tạo key).
  Vì raycast dùng vị trí thật của bóng, bóng đã giãn vẫn chọn được nếu chỉ dời `slot.wrapper`.
- `core.js` có tính chiều cao rig (`height`), dùng làm đơn vị giãn.

## Yêu cầu
1. **Hai tuỳ chọn mới trong ⚙ → Onion skin** (`#onionSettings`), lưu cùng cài đặt onion (`O.defaults`, `validate`, `#onionReset`,
   preset cài đặt):
   - **"Giãn bóng"** `onionSpread`: 0–200 (% chiều cao nhân vật cho mỗi bậc bóng), mặc định **0** = như hiện nay. Thanh trượt + ô số,
     đổi là thấy ngay (không cần tải lại).
   - **"Hướng giãn"** `onionSpreadAxis`: `screen` (ngang màn hình, mặc định) · `x` · `z` · `motion` (theo hướng di chuyển).
2. **Vị trí bóng** (chỉ trong `OnionSkin.update`): `offset = dir × sign × rank × spacing`
   - `spacing = onionSpread / 100 × chiều cao nhân vật` (đơn vị thế giới, đúng với cả rig Mixamo tỉ lệ 0,01).
   - `sign` = −1 cho bóng **trước**, +1 cho bóng **sau** (trước một bên, sau một bên).
   - `rank` lấy từ `sampleTimes` (bóng 1 gần nhất, bóng 10 xa nhất), cả chế độ theo khoảng và theo key.
   - `dir`: `screen` = vector phải của camera chiếu xuống mặt phẳng ngang rồi chuẩn hoá (nhìn từ đâu cũng giãn sang hai bên màn hình);
     `x`/`z` = trục thế giới; `motion` = hướng dịch chuyển gốc giữa bóng xa nhất và frame hiện tại trên mặt phẳng ngang, nếu gần như
     không di chuyển (< 1% chiều cao) thì dùng `screen`.
   - Cộng `offset` vào `slot.wrapper.position` **sau** khi chép `view.wrapper`; đường xương tự theo vì vẽ từ vị trí thế giới.
3. **Không đổi gì khác:** nhân vật thật, project, lịch sử Hoàn tác, key, xuất file đều giữ nguyên. `onionSpread = 0` cho kết quả
   **giống hệt** hiện nay (so ảnh chụp).
4. **Cập nhật khi xoay camera:** với `screen`, thêm hướng `dir` (làm tròn, vd 2 chữ số) vào `signature` để bóng giãn lại khi xoay
   camera; vẫn giữ giới hạn 15 lần/giây hiện có.
5. **Chọn bóng:** click bóng đã giãn vẫn chuyển tới đúng frame của bóng (`pickOnionPose`) như hiện tại; khi bóng giãn chồng lên
   nhân vật thật, ưu tiên như logic hiện có. Thêm **đường mảnh nối** từ chân mỗi bóng về vị trí gốc của nó (bật/tắt, mặc định bật khi
   `onionSpread > 0`) để biết bóng đó thực ra ở đâu — tuỳ chọn `onionSpreadGuides`.
6. **Hiển thị:** chú thích onion (`#onionNotice`/legend) ghi "Bóng đã giãn — chỉ để nhìn, không đổi vị trí thật" khi `onionSpread > 0`.
   Phím tắt (nếu thêm, vd tăng/giảm giãn) đăng ký qua `Keymap.register`, không gán phím mặc định.
7. Hoạt động ở **cả hai bố cục** (cổ điển và theo chế độ) và khi sửa 2 nhân vật (`dual_editor`), không lỗi khi rig chỉ có xương
   (không mesh).

## Kiểm (bắt buộc, ghi trong mô tả PR)
- Unit: `validate` (giới hạn, giá trị lạ, mặc định); hàm thuần tính offset (screen/x/z/motion, sign, rank, fallback motion → screen).
- Trình duyệt (cả hai bố cục): bật 10 trước + 10 sau, giãn 0 → 60%: khoảng cách ngang giữa bóng 1 và bóng 10 tăng đúng
  `9 × 0,6 × chiều cao`; nhân vật thật, `project`, `historyIndex` **không đổi**; sang frame tiếp theo nhân vật thật vẫn ở vị trí gốc;
  xoay camera 90° thì bóng giãn theo hướng màn hình mới; click bóng thứ 7 phía sau → `time` = thời điểm của bóng đó, không tạo key;
  `onionSpread = 0` → ảnh chụp giống hệt trước khi sửa.
- Toàn bộ `src/*.test.mjs` một lượt (Chromium đi kèm Playwright, không viết cứng đường dẫn), build App 3, `check-features` không mất ID,
  xuất Minecraft20 từ `sample.fbx` giống từng byte.
- Lưu ý: bài `layout_modes.browser.test.mjs` hay quá hạn 240 s trên máy chậm (cũng xảy ra trên `main`); nếu gặp, ghi số đo, đừng
  sửa assertion để che.
- NOT_RUN được: Windows/GPU thật.

## Ranh giới
- Repo https://github.com/tuantranmarinainter-ops/3appclaude, nhánh từ `main`. Chỉ `three-workspace-app/animation-studio/`.
- Giữ CRLF/LF như file gốc. Không commit ảnh/log > 100 KB. Báo cáo tiếng Việt. KHÔNG tự merge.
