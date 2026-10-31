## App 3 — Gói 6: phím tắt tập trung, giữ hành vi cũ

Nhánh `codex/app3-bb-keymap` từ main **5985e23** (đã có #178 và #180), một PR vào main, không tự merge. Chỉ thay đổi `three-workspace-app/animation-studio/`.


Bản WIP `c3b1969` đã có trên remote được giữ trong lịch sử. Commit hoàn thiện thay phần triển khai WIP bằng registry giữ từng handler widget; tree cuối chính là nội dung đã kiểm trên nền main 5985e23, không giữ hai hệ thống phím chạy song song. Bộ kiểm baseline trong bảng là main đã merge, không coi WIP chưa kiểm là baseline đã PASS.

### Kết quả

| Bộ kiểm | PASS | FAIL | SKIP / NOT_RUN |
|---|---:|---:|---|
| Baseline main, log đã merge của #180 (không chạy lại full baseline trong phiên này) | 135 | 0 | 5 SKIP |
| **Gói6: toàn bộ suite, một lượt, 148 test / 673,41 giây** | **143** | **0** | **5 SKIP** |
| Browser Gói6: 106 tổ hợp × 2 widget, hành vi App3/UI và đối chiếu main trước/sau cả hai bố cục (nằm trong lượt full) | 3 | 0 | 0 |
| Unit registry/preset/late registration/browser setup (nằm trong lượt full) | 5 | 0 | 0 |
| Build standalone / builder dependency / cài dependency & browser | PASS | 0 | — |
| Giữ ID | **456/456** của main, **434/434** gốc; bản mới 458 ID tĩnh | 0 | — |
| sample.fbx → Minecraft20 BOBJ trước/sau | **117932 byte giống hệt**, SHA `414f42596174969ec5c4c5120b66c53ee62ffbb6e1f4f098166deb7607cbf2b1` | 0 | — |
| Windows / GPU thật / game / kho thật | — | — | **NOT_RUN** |


- Chuyển **36 listener** cũ thành **97 hành động** có mã cố định; một listener `keydown` native duy nhất phân giải tổ hợp và gọi đúng callback của từng widget. Giữ `target/currentTarget`, thứ tự capture/bubble, stopPropagation, modifier theo hành vi gốc; gỡ handler của widget đã tháo. Không ghi đè handler giữa hai Graph/Motion/resize widget.
- Q/K/Space nhận đúng modifier, không còn Ctrl/Alt/Shift/Cmd vô tình reset camera, ghi key hoặc phát. Trong xem clip nguồn: nhảy key/khung còn dùng được, lệnh sửa key/Undo/Delete bị khoá, project và lịch sử không đổi.
- ⚙ → **Điều khiển → Phím tắt**: tìm theo tên/phím, gán tối đa hai phím, xoá/reset từng dòng hoặc tất cả, cảnh báo trùng với **Thay thế / Huỷ**, lọc chỉ phím trùng, cột nguồn **từng phím**.
- App 3 là ưu tiên mặc định. Chọn ưu tiên preset áp dụng ngay; phím gán tay luôn thắng. Có App 3 / Kiểu Blockbench / Blender / Maya / Cinema 4D, chuột/trackpad và các preset chuột; Space trong preset ưu tiên phân biệt Pose (đổi công cụ) / Animate (phát).
- Lưu localStorage, xuất/nhập JSON, đi cùng preset settings. Không đưa bộ phím vào project animation. Tooltip nút và menu xoá key cập nhật theo binding. `Keymap.register` dành cho các gói sau; đã kiểm phím lưu trước vẫn còn khi hành động được đăng ký muộn.

### Môi trường test đã sửa

- Clone Git đầy đủ, không shallow, có `builtin-assets/animation-studio/sample.fbx`.
- **PASS:** `npm ci` tại `animation-studio/work/material_alpha_v1_31_8`.
- **PASS:** `pnpm install --frozen-lockfile` tại `three-workspace-app/editor`.
- **PASS:** `npx playwright install chromium` tại `editor/apps/studio` (dependency Playwright của suite); Playwright **1.63.0**, Chromium đi kèm revision **1243**.
- `browser_test_options.mjs`: chỉ thêm `executablePath` khi có **CHROMIUM_PATH**, nếu không bỏ hẳn thuộc tính để Playwright dùng Chromium đi kèm. Không có fallback `/usr/bin/chromium`. Dùng chung cho các bài browser, kể cả MCP. Linux thêm cờ SwiftShader để chạy headless trong cloud; Windows không bị gán đường dẫn Linux. Unit kiểm cả cấu hình Windows/Linux.
- **PASS:** `pnpm --filter @topview/3d-builder build` (dependency của các bài MCP/shot; không sửa source package).

### Lệnh chạy thật

Từ `three-workspace-app/animation-studio`:

```sh
node work/material_alpha_v1_31_8/src/build.mjs
KEYMAP_BASELINE_HTML=/tmp/keymap-before.html \
KEYMAP_EVIDENCE_DIR=/tmp/keymap-evidence \
APP3_LAYOUT_BASELINE_HTML=/tmp/keymap-before.html \
APP3_LAYOUT_EVIDENCE_DIR=/tmp/keymap-layout-evidence \
BB_EVIDENCE_DIR=/tmp/keymap-export-evidence \
node --experimental-strip-types \
  --loader ./work/material_alpha_v1_31_8/src/shot_test_loader.mjs \
  --test --test-concurrency=1 work/material_alpha_v1_31_8/src/*.test.mjs
```

Dùng Node **22.15.0**, **không đặt CHROMIUM_PATH, không có preload đổi executable**. HTML baseline build từ worktree main 5985e23; toàn bộ dữ liệu thử/ảnh/export ở thư mục tạm, không chạm kho thật. Lượt full cuối lưu nguyên log ở `reports/g6-suite.tap.txt`; không cộng kết quả các lần thử riêng thành kết quả full.

```sh
node --experimental-strip-types \
  --loader ./work/material_alpha_v1_31_8/src/shot_test_loader.mjs \
  tools/bb-timeline-export-regression.mjs \
  /tmp/keymap-before.html /tmp/keymap-export-evidence
node tools/check-features.mjs /tmp/keymap-before.html outputs/Animation_Studio_v1_33_0.html
python tools/extract-keymaps.py /tmp/keymap-blockbench
```

### Mọi phím cũ: bảng và browser thật

[Bảng trước/sau đầy đủ](https://github.com/tuantranmarinainter-ops/3appclaude/blob/codex/app3-bb-keymap/three-workspace-app/animation-studio/reports/KEYMAP-BEFORE-AFTER.md) ghi vị trí 36 listener trước sửa và từng binding kiểm được. Browser phát **106 tổ hợp cũ trên hai widget độc lập** (212 lượt phím), kiểm đúng callback, modifier và currentTarget; có kiểm widget đã tháo không còn nhận phím.

Đối chiếu HTML main trước/sau bằng các thao tác thật ở **cả hai bố cục**: K/I, `,`/`.`, Ctrl+Z/Ctrl+Shift+Z, G/R, Shift+S, Graph Ctrl+A/ArrowLeft. Snapshot project, thời gian, history, công cụ, Silhouette và chọn key của Graph khớp. Kiểm thêm tương tác UI đổi phím/trùng/preset/JSON, kéo chuột Blender/Maya làm camera thật thay đổi, xem nguồn chỉ đọc. Các tổ hợp modifier có thể bị hệ điều hành/trình duyệt giữ (vd Ctrl+Q) được phát bằng KeyboardEvent bên trong Chromium để kiểm handler mà không đóng trình duyệt; không tuyên bố đã kiểm phím OS trên Windows.

### GPL / phạm vi preset

Preset được **trích tự động**, không gõ tay, từ commit Blockbench **ec0b2827104d0799c153bfb5f867579c0c44652f**: **84 default keybind** trích được và **128 ánh xạ** qua bốn preset. Có script, SPDX, NOTICE, provenance và SHA-256 nguồn, danh sách mọi hành động bỏ qua. Không dùng logo/ảnh/UI upstream.

Theo điều kiện **chỉ ánh xạ hành động App 3 có tương đương**, không tạo lệnh giả cho UV/mesh/paint, pivot chỉnh được, copy/cut/paste/duplicate key (Gói 2), đóng project. Các mục này ghi rõ trong `src/keymaps/PROVENANCE.json`; gói sau đăng ký khi có chức năng thật. Những tương đương đang có (Graph F3, marker Ctrl+M, khung `,`/`.`, move key ←/→, Ctrl+End, công cụ V/R, Undo/Redo, chọn/đảo chọn, đổi tên, sidebar, chụp PNG Ctrl+P, mở project, camera numpad, fullscreen) đã được nối.

### File sửa

- `work/material_alpha_v1_31_8/src/keymap.js`, `keymap_catalog.js`, `keymap_settings.js`, `keymaps/`: registry, routing, settings, preset/provenance.
- `src/app.js`, `layout_modes.js`, `workspace_ui.js`, `motion_panel.js`, `graph_editor.js`, `viewport_toolbar.js`, `easing_panel.js`, `smoothing_panel.js`: chuyển listener cũ thành đăng ký theo widget; nối settings và command có sẵn.
- `src/index.html`, `style.css`, `build.mjs`: mục settings, CSS bảng, import map/bundle.
- `src/browser_test_options.mjs`, các `*.test.mjs` có launch Chromium, `keymap.test.mjs`, `keymap.browser.test.mjs`: browser portable và kiểm hồi quy; không bỏ assertion cũ.
- `tools/extract-keymaps.py`, `tools/bb-timeline-export-regression.mjs`, `reports/`, `NOTICE`, `vendor/BLOCKBENCH_PROVENANCE.md`: công cụ/bằng chứng/giấy phép.

Giữ CRLF/LF của file cũ. Không sửa editor/App2/App4/retarget/builder/golden, không cập nhật bản nhúng App2, không commit binary hay dữ liệu người dùng.

**NOT_RUN:** Windows/GPU thật/game/kho thật. Các SKIP mặc định ghi nguyên lý do trong log (runtime App2 ngoài scope, asset GLB ngoài repo, bài resize bật opt-in).

### Ảnh cài đặt thật

![Bảng phím tắt Gói 6](https://raw.githubusercontent.com/tuantranmarinainter-ops/3appclaude/codex/app3-bb-keymap/three-workspace-app/animation-studio/reports/keymap-evidence/settings.svg)

SVG văn bản được chuyển lossless từ PNG Chromium tự chụp, kiểm tái dựng RGB sai khác 0; không nhúng PNG/base64 và không commit binary.
