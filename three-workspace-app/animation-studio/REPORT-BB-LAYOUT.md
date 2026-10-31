# Gói 5 — bố cục theo chế độ

Nhánh `codex/app3-bb-layout` dựa trên main sau khi PR #178 và #179 được merge. PR đích main, không tự merge. Chỉ sửa `three-workspace-app/animation-studio/`; không cập nhật bản nhúng ở App 2.

## Thay đổi

- `src/layout_modes.js` và `src/layout_modes.css`: Pose / Animate / Xuất / So sánh, hai sidebar, timeline dưới, overflow, thu gọn và nhớ kích thước theo tab. Dùng lại resizer và DOM gốc, không tạo bản sao panel.
- ⚙ → Giao diện: đổi ngay giữa chế độ/cổ điển, lưu localStorage và preset. Người dùng cũ có layout-v2 mặc định cổ điển. Lựa chọn giao diện không ghi vào project hoặc Undo/Redo.
- Ctrl+1/2/3 chỉ bắt ngoài input/dialog. Màn hình ≤1024 dùng ngăn kéo; màn hình quá nhỏ có thông báo và Vẫn mở.
- `app.js`, `workspace_ui.js`, `index.html`, `build.mjs`: điểm nối tối thiểu. Màu giao diện mới dùng biến CSS; màu cổ điển giữ nguyên.
- Các test giao diện cũ chọn cổ điển tường minh bằng `classic_test_layout.mjs`, giữ nguyên assertions chức năng. Bộ test mới kiểm tra mặc định theo chế độ và cả hai bố cục.
- Mã bố cục tự viết, không chép mã/ảnh/biểu tượng Blockbench; SPDX và provenance trong App 3. Giữ kiểu xuống dòng của file cũ.

## Kiểm

Kết quả cuối cùng và lệnh tái hiện ghi trong mô tả PR; log nguyên lượt chạy nằm tại `reports/g5-suite.tap.txt`.

Browser kiểm 10 lần đổi bố cục giữa lúc đang có key, project/history không đổi, Undo/Redo, preset, reload, mặc định người dùng cũ, tab và Ctrl+1/2/3, resize theo tab, drawer, Vẫn mở, không trùng ID, không pageerror.
Ảnh cổ điển trước/sau so toàn bộ buffer PNG: **giống hệt** tại 1920×1080 và 1024×768.
Checker: **434/434** ID gốc và **453/453** ID Gói 1 đều còn; bản mới 456 ID tĩnh (thêm các nút/panel động lúc chạy).

## Ảnh

Lượt kiểm trước đã đối chiếu ảnh chụp Chromium: ảnh cổ điển trước/sau giống hệt tại cả hai kích thước. Các SVG bằng chứng đã được loại khỏi lịch sử nhánh theo yêu cầu; manifest chỉ ghi hash và số đo lịch sử.
Raw PNG và dữ liệu project thử chỉ nằm ở thư mục test bên ngoài Git. Test mặc định xuất ảnh vào editor/.test-results/app3-layout để CI thu artifact; `APP3_LAYOUT_EVIDENCE_DIR` cho phép chọn thư mục cô lập khác.

## Giới hạn

Chạy trên Linux / Chromium / SwiftShader, không có Windows runner trong phiên. Kiểm tương tác thực trên Windows và dữ liệu người dùng: **NOT_RUN**. Không dùng kho thật, project thật hay thư mục game.

## Kiểm resize tuỳ chọn ngoài suite mặc định

`APP3_RESIZE_BROWSER=1 node --test work/material_alpha_v1_31_8/src/workspace_resize.browser.test.mjs`: **0 PASS / 1 FAIL** tại assertion chiều cao timeline sau reload. Chạy cùng bài trên Gói1 chưa có Gói5 cũng **0 PASS / 1 FAIL**, cùng số đo initial/resized và cùng assertion. Đây là lỗi đã có ở baseline, không sửa hành vi cổ điển trong Gói5. Giữ nguyên log hai lượt ở `reports/g5-resize-opt-in.tap.txt` và `reports/g1-resize-baseline.tap.txt`; không cộng/trộn hai lượt này vào bộ test mặc định.

## Kết quả cuối

| Bộ kiểm | Kết quả |
|---|---|
| Baseline Gói1, toàn bộ suite một lượt | **132 PASS / 0 FAIL / 5 SKIP** (137 case) |
| Gói5, toàn bộ suite một lượt | **135 PASS / 0 FAIL / 5 SKIP** (140 case) |
| Build standalone + builder dependency | **PASS** |
| Chromium Gói5 chạy riêng trên HTML thật | **1 PASS / 0 FAIL / 0 SKIP** |
| 10 lần đổi bố cục + project/history/Undo/Redo/preset/reload | **PASS** |
| Workflow ↔ tab, menu nâng cao, vào/ra So sánh, Ctrl+1/2/3 | **PASS** |
| Tablet: drawer, hàng key nằm trong màn hình, Vẫn mở | **PASS** |
| Ảnh cổ điển trước/sau, 1920×1080 và 1024×768 | **PASS — sai khác 0**, buffer PNG giống hệt |
| Giữ ID | **PASS — 434/434** gốc, **453/453** Gói1; bản mới 456 ID tĩnh |
| sample.fbx → Minecraft20 BOBJ trước/sau | **PASS — 117932 byte giống hệt**, SHA `414f42596174969ec5c4c5120b66c53ee62ffbb6e1f4f098166deb7607cbf2b1` |
| Resize cổ điển bật cờ ngoài suite mặc định | **FAIL trên cả baseline và Gói5** — xem log/giải thích dưới |
| Windows/GPU thật/game/kho thật | **NOT_RUN** |
