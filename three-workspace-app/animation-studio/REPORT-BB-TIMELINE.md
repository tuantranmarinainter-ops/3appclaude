# Gói 1 — timeline kiểu Blockbench

## Nhánh và phạm vi

Clone Git đầy đủ tại `/workspace/3appclaude-app3-bb` (`git rev-parse --is-shallow-repository`: false).
Nhánh `codex/app3-bb-timeline` dựa `origin/app3-prettier` (`c61e2cc`), vì commit đó chưa nằm trong main `ec98f88` khi bắt đầu.
PR đích main; không tự merge. Không tìm thấy bản Gói 1 cục bộ được nói tới trong workspace, nên triển khai các phần thiếu theo đặc tả `docs/APP3-BLOCKBENCH-FEATURES-TASK-2026-10-31.md` ở nhánh tài liệu.

Chỉ App 3 thay đổi, cộng đúng một dòng giấy phép ở `three-workspace-app/NOTICE` mà mục Bản quyền của đặc tả yêu cầu.
Không cập nhật bản nhúng App 2; không đổi App 1/2/4, packages, golden hay fixture. Test Next.js tự sinh tsconfig/cache trong clone riêng; các thay đổi sinh ra đó được loại khỏi commit.

## Chức năng

- `timeline_tools.js`: nhảy key theo xương chọn hoặc tất cả khi không chọn (Root là control toàn nhân vật); thời điểm trùng chỉ là một điểm dừng.
- Hai nút cạnh Play và phím `,`/`.`; không bắt phím trong input/textarea/select/contenteditable/dialog. Navigation không ghi project/history.
- Menu chuột phải: 8 màu và Bỏ màu, áp vào tất cả key đang chọn; lưu `key.color`, đọc lại, Undo/Redo. Timeline dùng lookup màu theo lần vẽ, không quét toàn bộ track cho từng hình thoi. Key được chọn có viền sáng để vẫn thấy màu.
- `playMode`: `once` (Một lần, dừng và về đầu vùng), `loop`, `hold` (Giữ khung cuối). Trường tuỳ chọn, project cũ mặc định Lặp như checkbox cũ. Giữ ID `loop` làm compatibility mirror ẩn, không bỏ control/bridge cũ.
- `startDelay`/`loopDelay` là số giây không âm, tuỳ chọn/default 0. Delay theo tốc độ xem; thời gian pause/host ẩn không được cộng vào elapsed. Giữ A–B; preview không ghi lại key và exporter hiện có bỏ qua các trường này, có ghi chú ngay ở transport.
- Tất cả thay đổi màu/mode/delay đi qua history hiện có. Menu pose cũ được giữ: sửa vị trí theo chiều cao thật và giới hạn cuộn để màu mới không đẩy các mục copy/paste khỏi màn hình.
- GPL-3.0-or-later: LICENSE đầy đủ, NOTICE, README, provenance riêng; `build.mjs` đưa LICENSE/NOTICE vào HTML standalone. Chính sách cuối clip chuyển thể từ `Timeline.loop` của Blockbench (`js/animations/timeline.js`, commit `ec0b2827104d0799c153bfb5f867579c0c44652f`), giữ copyright/SPDX trong module riêng. Không lấy Vue/jQuery hoặc nhập GPL vào bundle App 2.

Giữ CRLF của các file JS/HTML hiện có; file cũ LF giữ LF. Phần JS mới định dạng single quote, printWidth 100 theo app3-prettier.

## Build, ID và test

Từ `three-workspace-app/animation-studio/`:

```text
node work/material_alpha_v1_31_8/src/build.mjs
node --test work/material_alpha_v1_31_8/src/*.test.mjs
```

Build PASS: `outputs/Animation_Studio_v1_33_0.html`, 70 module vendor/importmap, gồm fixture `../builtin-assets/animation-studio/sample.fbx` thật từ clone.
Trên cloud dùng Node 22.15 với native TypeScript stripping/resolver vendor để chạy assertion thật; Node 24 trong phiên có thể chỉ báo wrapper file, không dùng kết quả đó làm số assertion:

```text
PLAYWRIGHT_BROWSERS_PATH=/tmp/b43-playwright /tmp/node-v22.15.0-linux-x64/bin/node --experimental-strip-types --loader ./work/material_alpha_v1_31_8/src/shot_test_loader.mjs --test --test-concurrency=1 work/material_alpha_v1_31_8/src/*.test.mjs
```

Đã cài dependency editor từ lockfile và build builder để các test MCP cũ mở Studio riêng được. Không sửa source của editor/builder. Chromium hệ thống trên cloud; chưa chạy Windows.

- Baseline trước sửa (clone độc lập `c61e2cc`): **124 PASS / 2 FAIL / 5 SKIP**, toàn bộ 22 file test. Hai FAIL: F1 checker coi chuỗi ID động xuống dòng bởi Prettier là ID mất; A5 test xoá dùng selector khớp mọi menuitem, trong khi menu đã có bốn mục. Không giấu các lỗi baseline này.
- Sau sửa: **130 PASS / 2 FAIL / 5 SKIP**, toàn bộ 24 file test (137 case). Lượt E5 đầu lỗi `apiRequestContext.get: read ECONNRESET`; cùng file E5 chạy lại qua hook mặc định đã PASS thật, không SKIP. Lượt A7 đọc HTML trước sửa vị trí menu bị mục copy pose ngoài viewport; đã sửa popup và chạy lại A7 **PASS** (cả Chromium mặc định và SwiftShader). Giữ kết quả raw và retest riêng, không gọi lượt raw FAIL là PASS. Năm SKIP gồm bridge/silhouette tích hợp cần APP3_RUNTIME_BASE, hai mẫu SHOT_TEST_ASSET ngoài repo và resize cần APP3_RESIZE_BROWSER=1. Sau retest không còn lỗi đã tái hiện chưa xử lý; chưa có một lượt full raw mới 0 FAIL nên PR để draft.
- Logic Gói 1: **5 PASS / 0 FAIL / 0 SKIP** (nhảy key và điểm trùng, màu/JSON/Bỏ màu, indexed lookup, project cũ, ba mode tại đầu/giữa/sau cuối, start/loop delay, quá nhiều vòng, lỗi dữ liệu).
- Chromium Gói 1 trên HTML thật: **1 PASS / 0 FAIL / 0 SKIP**, thao tác nút/phím, tô nhiều key, Bỏ màu, Undo/Redo màu/mode/cả hai delay, reopen, ba mode và start wait thực. Không ép click xuyên phần ngoài viewport. Chờ trạng thái cuối thay vì đòi phải render một frame giữa trên software renderer.
- `node tools/check-features.mjs <before.html> <after.html>`: PASS **447/447** ID baseline trước sửa; so bản nhúng v1.31.8: PASS **434/434**, bản mới 453 ID. Checker chỉ chuẩn hoá whitespace của phép ghép ID JavaScript, không loại ID thật. Thử bỏ `playBtn` trên bản sao tạm vẫn báo FAIL/missing/unresolved đúng.
- Test A5 chỉ đổi selector sang đúng menuitem tên `Xoá`, không bỏ assertion. F1 checker giữ số ID baseline, không đổi golden hay nới kiểm chức năng.

## Kiểm xuất Minecraft20 với sample.fbx

Nguồn thật: `three-workspace-app/builtin-assets/animation-studio/sample.fbx`.
SHA-256 nguồn: `0c3fd77e693707a1f6c99da95070d482c568b3b91d1f9a060f3b5b53db77768d`.
Mở baseline HTML và bản sau, dùng cùng project version 1 từ model này với 4 key tổng hợp xác định; xuất GLB Mixamo65 rồi qua exporter Minecraft20 hiện có. So BOBJ bằng `Buffer.deepEqual`, không chỉ so pose/hình.

| Bản xuất | Byte | SHA-256 |
|---|---:|---|
| Trước Gói 1 | 117932 | `414f42596174969ec5c4c5120b66c53ee62ffbb6e1f4f098166deb7607cbf2b1` |
| Sau Gói 1, project cũ | 117932 | giống hệt |
| Sau Gói 1, có màu/mode/startDelay/loopDelay | 117932 | giống hệt |

**PASS, không chênh byte.** Đây là sample T-pose + key tổng hợp, không tuyên bố đã đo animation Samba/game.
Script tái lập: `tools/bb-timeline-export-regression.mjs <before.html> <evidence-dir>` (dùng cùng loader/Node nêu trên), chạy sau browser test để lấy fixture project/GLB riêng ngoài repo. `BB_EVIDENCE_DIR` chọn thư mục bằng chứng.

## Ảnh và giới hạn

Ảnh đã chụp và xem trong phiên cloud, ngoài repo:
`/tmp/app3-bb-evidence-final/timeline-colored.png` và `timeline-color-menu.png`.
Cùng thư mục có `browser-result.json`, `export-result.json`, các GLB/BOBJ/project tạm. Không commit các file binary/model/project này.
Ảnh được trình bày trong phiên chat; công cụ hiện tại không có chức năng upload ảnh đính kèm GitHub, nên phần đính ảnh trực tiếp trên PR: **NOT_RUN**.

**NOT_RUN:** Windows/GPU thật; kiểm game; các test cần `APP3_RUNTIME_BASE`/`SHOT_TEST_ASSET`/`APP3_RESIZE_BROWSER=1` bên ngoài không được cấp. Các bài đó giữ SKIP đúng điều kiện, không tạo dữ liệu giả để gọi là mẫu thật.
Gói 2 chưa bắt đầu trước khi PR này được mở. Bản nhúng App 2 chỉ cập nhật riêng sau merge, kèm LICENSE GPL cạnh index.html.
