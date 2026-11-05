# Tập 15 · Shot 03 — film, cú nảy và âm thanh (2026-11-05)

## A — Film

- PASS: xuất từ commit `12e50d5080283d6cb493b0c872c7cafe8467d8d0`, job `82574775-68b8-41fe-a6c0-755c2c77788e`, snapshot revision 314. Preflight không có lỗi; cảnh báo gồm `CAMERA_STATIONARY`, `SHOT_NOT_APPROVED`, `CLIP_BLEND_ZONE`, `VFX_BBS_MISSING`, `CHARACTER_BELOW_FLOOR`, `CHARACTER_FLOATING`.
- PASS: gỡ hai cue mắt tại revision 313–314; `history.undo` an toàn tại 315–316. Hai cue có ID và mọi thuộc tính khớp trước khi gỡ.
- PASS: ZIP `S:/Claude/w01-samples/tap15v3/film-zips/20261105-new-Tap15-shot03-gay.zip`, 8.265.492 byte, SHA-256 `0429aa7c68c8ebc1636c23c58527f708540edfd052ec635ecd1a0b4c2e7e2c7e`. Kiểm CRC 85 mục và hash 45 file model/texture đạt.
- PASS: BbsCodec đọc 4 actor model, 6 replay VFX; gậy `visible` 0→1 tick 51, 151 key texture, 151 key root. So ma trận hướng film với App 2 tại tick 90/100/120: sai lệch lần lượt 0,00000241° / 0,00000241° / 0,00000171° (giới hạn 10°).
- PASS: Hero Y = −20 tại tick 26 và −60 tại tick 48, so với neo mặt đất −60 tương ứng cao 40 m và đáp đất.
- PASS: kiểm không có `java`/`javaw`, gỡ install `91052ba1-f700-45fa-9bb7-90be54641212`, cài tài nguyên job với install `0c6b4c59-2130-4d64-afaf-e2ac709ad6bf`, rồi chép `.dat` sau khi kiểm lại Java và hash bản cũ. File trong world `Thế giới mới (1)` có SHA-256 `f8669dd74c30c03752685bb8752e9e790b8f9f7dde99dbde2a14b248aee492c2`, khớp ZIP.
- PASS: sao lưu `.dat` cũ tại `S:/Claude/w01-samples/game-backups/films-2026-11-05/Tap15-shot03-gay-before-shot03.dat`, SHA-256 `be256e6b0c16b3fda4b30176a312929f1e7e86746ceab6f2c8e0aa4249b30343`; sao lưu project tại `S:/Claude/w01-samples/game-backups/shot03-project-2026-11-05/project.json`.
- NOT_RUN: phát và kiểm bằng mắt trong Minecraft. Dữ liệu đo đặt tại `S:/Claude/w01/work/shot03-measure/`; lệnh xuất dùng `scripts/film/export-install.mjs`, cài dùng `uninstall.mjs` và `install-job.mjs` qua server thử 3140.

## B — Cú nảy và đoạn nối

- PASS: dùng `sandbox.py projects` và `sandbox.py library` tạo bản sao tại `S:/Claude/w01/work/shot03-sandbox/`; thư viện có 31 action, 21 pack (379 MB pack). Không ghi thư viện thật.
- PASS B1 trên hai film thử đã giải mã: 151 tick, actor nảy tối đa 0,494385 m; COG chênh 0 m, toàn bộ 81 track xương chênh vị trí tối đa 1,87×10⁻¹⁵ m sau quy đổi. COG Y tại tick 54 là 0,5801656 đơn vị gốc trong cả hai film. Không tái hiện được giả thuyết cộng hai lần; chưa sửa mã sản phẩm B1. Đã thêm fcurve ba khóa vào project bản sao bằng `scene.apply`, revision 316→317. Chưa ghi project thật.
- PASS: test hồi quy film manifest và skeleton evaluator 17 test; `pnpm typecheck` toàn workspace. Các số B1 chi tiết tại `S:/Claude/w01/work/shot03-hop-fix/tmp/b1-measurements.json`; lệnh `node tmp/b1-export.mjs baseline`, `node tmp/b1-export.mjs hop`, giải mã BbsCodec và `python -I -X utf8 tmp/b1-measure.py`.
- PASS B2: `scene.apply` vào bản sao revision 317→318, trộn 4 khung `smooth`, `footLock:false`, `phaseOffsetSeconds:-0.1`. App 2: 15,51° trước và 4,50° sau tại frame 115→116; điểm nối 171→172 là 5,80°. Film xuất và giải mã: tick 76→77 / 77→78 lần lượt 12,75° / 4,25°; tick 114→115 là 6,30°. Lưới film 20 Hz không có đủ mẫu đúng cả frame 115 và 116. Đỉnh toàn vùng trộn 11,91°/frame App 2 và 17,35°/tick film. Số 51,08° ban đầu không đúng do chưa tách scale khỏi ma trận. Lệnh `node tmp/b2-apply-export.mjs`, BbsCodec, `node tmp/b2-measure.mjs`; kết quả `tmp/b2-world-measurements.json`, `tmp/b2-app2-measurements.json`.
- PASS: `pnpm lint` sau khi sửa 7 lỗi ranh giới có sẵn ở commit gốc; còn 5 cảnh báo. `pnpm typecheck`, `pnpm test:evaluate` (803 đạt, 1 bỏ qua), `pnpm build`, `pnpm --filter @topview/3d-studio test:offline` (3142, 0 request ngoài), filmManifest 12/12 đạt.
- NOT_RUN: xem trực quan trong App 2 và BBS; film thử chỉ gồm Gỗ Xưa, bỏ VFX. Chưa áp thay đổi cú nảy/trộn vào project thật.
- FAIL review: `setMotionClipBlend('missing', {curve:'linear', footLock:false})` có thể trả thành công và tạo Undo rỗng do fallback. Cần sửa và thêm test cho clip thiếu, clip không có blend, patch gộp hợp lệ và số frame không đổi; agent đã dừng trước khi sửa. Lưu `footLock:false` khiến project không đọc được bằng phiên bản App 2 cũ; báo rõ rủi ro tương thích.
- FAIL `git diff --check`: báo trailing whitespace ở các dòng CRLF; cần kiểm tra theo cấu hình Git và giữ nguyên kiểu xuống dòng như người dùng yêu cầu. Không tự chuyển đổi toàn tệp.
- NOT_RUN: chạy lại gate sau khi sửa finding review; commit, push và PR B. Các test đã báo PASS áp dụng cho trạng thái trước khi sửa finding.

## C — Âm thanh

- PASS chuẩn bị: sáu SFX tự tổng hợp 01–05, 07 trong `S:/Claude/w01/work/shot03-c-qa/`, 48 kHz mono PCM 16-bit. Script và CREDITS nằm cùng thư mục; chưa nghe duyệt, chưa copy vào thư mục audio đích, chưa commit script.
- Người dùng xác nhận các giọng được phép sử dụng và yêu cầu **chỉ dùng CapCut** trong VoiceStudio; đã cung cấp lệnh chạy `cd "S:\ChatGPT\MMO TOOL\TTS1"; .\.venv\Scripts\python.exe app.py`. App đã chạy với TEMP, TMP và LOCALAPPDATA trỏ sang `S:/Claude/w01/work/shot03-c-qa/`; cửa sổ có integrity cao hơn công cụ điều khiển nên chưa thao tác được. Người dùng chưa chọn giọng cụ thể cho Hero/Gỗ Xưa trong câu hỏi đang chờ.
- NOT_RUN: 5 câu TTS, tiếng rên riêng (đồng thời dùng làm SFX 06), chuyển WAV 48 kHz, CREDITS hoàn chỉnh, import/gắn cue, nghe kiểm, xuất film có âm, nhánh/PR C.

## Bàn giao cho Claude — dừng theo yêu cầu người dùng

- Worktree B: `S:/Claude/w01/work/shot03-hop-fix`, nhánh `claude/shot03-hop-fix`, HEAD `12e50d5`; có thay đổi chưa commit và các file mới chưa được theo dõi. Hai test cũ được chuyển sang `src/headless/__tests__/`, không phải xóa chức năng. `tmp/` chứa ZIP, `.dat` và script QA; không commit binary/golden.
- Project thử `S:/Claude/w01/work/shot03-sandbox/projects`, thư viện thử `S:/Claude/w01/work/shot03-sandbox/library`; Shot 03 thử đã có fcurve và blend như trên. Chỉ dùng cổng 3140–3149; 3140/3141/3142 không còn server thử chạy khi bàn giao.
- Repo chính `S:/Claude/w01` ban đầu có thay đổi chưa commit của người dùng, không reset/stash/chuyển nhánh hoặc ghi đè. Project thật gần nhất kiểm revision 316 sau khi khôi phục cue; **phải đọc lại trước bất kỳ lệnh ghi nào**.
- Tiếp tục theo thứ tự: sửa finding review B, xác minh tương thích và diff/line ending, chạy lại mọi gate theo `editor/AGENTS.md` và typecheck toàn workspace trước push, kiểm UI bằng bản thử nếu khả dụng, mở PR B vào `claude/film-prop-anim`; rồi làm C trên nhánh xếp chồng `claude/shot03-audio`. Không tự merge.
