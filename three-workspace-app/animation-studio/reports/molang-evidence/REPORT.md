## App 3 — Gói 2: biểu thức Molang cho keyframe

Animator có thể nhập số hoặc biểu thức cho từng trục vị trí, xoay và tỉ lệ của key đã chọn; kết quả được xem theo thời gian và có thể chuyển thành key số để xuất. Biến `v.*` có ô giá trị và thanh trượt; lỗi hiển thị tiếng Việt và ô đỏ, giữ giá trị số dự phòng. Thao tác chỉnh key, biến và bake hỗ trợ Undo/Redo.

Nhánh `codex/app3-bb-molang` từ main `7418b6f` (đã merge #181). Panel dùng chung hai bố cục; hai hành động mới đăng ký qua `Keymap.register`. Project version 1 cũ vẫn mở, trường `molang` và `molangVariables` là tuỳ chọn.

### Kết quả thật

| Kiểm tra | Kết quả |
| --- | --- |
| `pnpm test:all`: install, builder build, typecheck, lint, App 3 build/features | PASS |
| `pnpm test:all`: builder / retarget / Studio / Python / App 3 | PASS: 627/249/302/117/64; FAIL: 0; SKIP: 1/12/7/0/0 |
| Toàn bộ `src/*.test.mjs` (một lượt) | PASS **153**, FAIL **0**, SKIP **5**, tổng 158 |
| Ảnh hưởng ID | PASS: **458/458** ID main, **434/434** ID v1.31.8 |
| GLB có biểu thức so với bake, 1 s/30 FPS và 0,1 s/24 FPS | PASS: 31 và 4 mẫu; 20.460 và 2.640 giá trị float; sai lệch tối đa **0** |
| Minecraft20 từ `sample.fbx`, project không biểu thức so trước/sau | PASS: từng byte, **117.932 byte**, SHA-256 `414f42596174969ec5c4c5120b66c53ee62ffbb6e1f4f098166deb7607cbf2b1` |

Năm SKIP của App 3: hai test cần `SHOT_TEST_ASSET` GLB chuẩn hoá từ App 1; hai test cần server Studio tích hợp qua biến môi trường; một test kéo viền yêu cầu `APP3_RESIZE_BROWSER=1`. Test bố cục và keymap khác vẫn chạy. Các SKIP của `pnpm test:all` được ghi trong log và summary.

- Browser Chromium kiểm cả classic/modes: chọn key thật, chín ô, Enter, lỗi đỏ rồi sửa hợp lệ, biến, bake và Undo/Redo.
- Parser không dùng `eval`: ưu tiên toán tử, so sánh, `?:`, sin/cos theo độ, abs/clamp/lerp/min/max/random seed ổn định, `query.anim_time`/`q.anim_time`, `query.life_time`, `variable.*`/`v.*`; lỗi không crash.
- `query.life_time` tăng theo thời gian đã phát trong preview, kể cả khi `anim_time` lặp; seek đặt lại đồng hồ preview. Khi bake/export, thời gian sống được xác định theo thời điểm lấy mẫu; App 3 không mô phỏng thời gian sống độc lập của thực thể Minecraft.
- Bake tại lưới FPS và điểm cuối. Ví dụ 1 giây × 30 FPS → **31 key**; 0,1 giây × 24 FPS → **0, 1/24, 2/24, 0,1**.

### Lệnh

```sh
# three-workspace-app/editor
BLENDER_EXTERN_DRACO_LIBRARY_PATH=/tmp/blender-4.3.2-linux-x64/4.3/python/lib/python3.11/site-packages/libextern_draco.so pnpm test:all

# three-workspace-app/animation-studio
node work/material_alpha_v1_31_8/src/build.mjs
KEYMAP_BASELINE_HTML=/tmp/molang-baseline.html \
KEYMAP_EVIDENCE_DIR=/tmp/molang-keymap-evidence \
APP3_LAYOUT_EVIDENCE_DIR=/tmp/molang-layout-evidence \
BB_EVIDENCE_DIR=/tmp/molang-export-evidence \
node --experimental-strip-types \
  --loader ./work/material_alpha_v1_31_8/src/shot_test_loader.mjs \
  --test --test-concurrency=1 work/material_alpha_v1_31_8/src/*.test.mjs

node --experimental-strip-types \
  --loader ./work/material_alpha_v1_31_8/src/shot_test_loader.mjs \
  tools/bb-timeline-export-regression.mjs \
  /tmp/molang-baseline.html /tmp/molang-export-evidence

node --experimental-strip-types \
  --loader ./work/material_alpha_v1_31_8/src/shot_test_loader.mjs \
  tools/molang-glb-regression.mjs
```

Hai suite chạy trên hai worktree cô lập có `src` và HTML build giống từng byte để tránh đụng build/cache. Node 22.15, Chromium đi kèm Playwright; không ghi kho thật. Log từng gate `pnpm test:all`, log full App 3 và kết quả so byte được lưu trong `reports/molang-evidence/`.

### File và bản quyền

- `src/molang.js`, `molang.test.mjs`: parser/bộ đánh giá độc lập và test.
- `src/core.js`, `molang_integration.test.mjs`: dữ liệu key, preview, bake, project cũ, Animation Lab và test.
- `src/molang_panel.js`, `app.js`, `style.css`, `molang.browser.test.mjs`: ô trục, biến, lỗi, bake, Keymap và browser test.
- `src/build.mjs`: đóng gói module vào HTML standalone. `app3_pose_clipboard.test.mjs`: thu hẹp selector summary gốc do panel mới thêm summary; giữ nguyên assertion.
- `vendor/BLOCKBENCH_PROVENANCE.md`: SPDX/provenance; parser tự viết, không chép mã Blockbench hay thư viện ngoài.
- `tools/molang-glb-regression.mjs` và `reports/molang-evidence/`: công cụ, log và số đo; ảnh chụp không được lưu trong kho.

Lượt `pnpm test:all` đầu FAIL một test Studio H4 vì Blender hệ thống thiếu `libextern_draco.so`. Đã tải thư viện Blender 4.3.2 chính thức vào `/tmp`, đối chiếu SHA-256 archive `4da1c956673c0485e63054e563ee69198cc8f80d8157dd7592dffc8a6a5592e6`; test H4 chạy riêng PASS và đã chạy lại toàn bộ gate với biến `BLENDER_EXTERN_DRACO_LIBRARY_PATH`. Không commit thư viện.

Không cập nhật bản nhúng App 2, package, golden hoặc dữ liệu người dùng. Windows/GPU thật/game/kho thật: **NOT_RUN**. So ảnh cổ điển với baseline *trước Gói 5* trong test Gói 5: **NOT_RUN** vì Gói 2 chủ động thêm panel; test đổi bố cục vẫn chạy.

