# Đợt 1 — kết quả kiểm tra (2026-11-01)

Nhánh `codex/backlog-d1-data`, dựa trên `claude/hub8-174-176` đã gộp main tại `82ad0cbd73448aec293dafc72001ea4df73db8a1` (không xung đột). Không merge PR.

## Gate đầy đủ

Lệnh thực chạy: `/tmp/run-backlog-pnpm test:all` (pnpm 10.28.2, môi trường trong `/tmp/backlog-validation-env.sh`). Exit **0**; tất cả **14 gate PASS**.

| Gate | Kết quả | Đạt | Lỗi | Bỏ qua | Giây |
| --- | --- | ---: | ---: | ---: | ---: |
| install | PASS | — | — | — | 2 |
| builder-build | PASS | — | — | — | 30 |
| typecheck | PASS | — | — | — | 35 |
| lint | PASS | — | — | — | 15 |
| builder-tests | PASS | 654 | 0 | 1 | 22 |
| retarget-tests | PASS | 249 | 0 | 12 | 84 |
| studio-tests | PASS | 350 | 0 | 5 | 194 |
| python-tests | PASS | 123 | 0 | 1 | 21 |
| app3-build | PASS | — | — | — | 0 |
| app3-features | PASS | — | — | — | 0 |
| app3-features-previous-embed | PASS | — | — | — | 0 |
| app3-tests | PASS | 134 | 0 | 1 | 638 |
| app3-mcp-demo | PASS | 1 | 0 | 0 | 163 |
| app3-mcp-demo-hook | PASS | 1 | 0 | 0 | 162 |

**Tổng: 1.512 đạt, 0 lỗi, 20 bỏ qua / 1.532 test.** Toàn bộ 35 file App 3 được tìm trực tiếp; chạy tuần tự. Các import gom test cũ được bỏ để tránh chạy trùng. Selector iframe lấy phiên bản chuẩn v1.34; test toolbar chọn rõ Classic, test các layout mới vẫn chạy. So ảnh silhouette vẫn yêu cầu sai khác 0 tại cùng camera/thời điểm; giữ các assertion orbit, playback, material, scene và revision; không đổi golden.

Bỏ qua: builder 1 và retarget 12 phụ thuộc mẫu ngoài chưa có; Studio 5 phụ thuộc kho native riêng, SHA baseline hoặc FBX Mixamo65 cụ thể; Python 1 vì fixture BOBJ đã pin không có native Action; App 3 1 vì thiếu bản HTML sau layout nhưng trước keymap. Không thay assertion hay giả mẫu để chạy các trường hợp này. Chi tiết từng skip: `/tmp/backlog-validation-final.json`.

## Kiểm bổ sung

- `pnpm build` gồm builder + Studio production: PASS (`/tmp/backlog-final-build.log`).
- Production offline: PASS, 0 request ngoài (`/tmp/backlog-offline-final.log`).
- Lint sau lần cập nhật script Debug cuối: PASS, 0 lỗi / 4 cảnh báo sẵn có; 1.133 key × 15 ngôn ngữ (`/tmp/backlog-final-script-lint.log`).
- 40 test camera chuyên biệt và source/test typecheck: PASS.
- Camera native App 2 → điểm neo → DAT: 112 mẫu / 784 giá trị; sai số codec 0, vị trí 3,1776437161565096e-14 m, góc 1,7075472925031877e-6°, FOV 0°. Xem `CAMERA-BBS-SEMANTICS-2026-11-01.md`.
- Chromium production: lái WASDQE 30 giây, khoá camera, kéo/lăn/E và đổi timeline giữ camera/shot; FOV 120°, revision server 1 → 1 khi đứng yên 5 giây. Bố cục 1.600 px và 700 px không tràn.
- Debug qua UI: 25 dòng JSONL, 3 KeyE, 1 `scene.apply/document.replace` HTTP 200, revision 0 → 1. Log tải về `/tmp/backlog-camera-debug-final/camera-debug.txt`.

## Ảnh và provenance

- Trước mã sửa: `/tmp/backlog-before-code-evidence/d1-before-code-camera-pilot.png`; snapshot độc lập đúng commit nền, manifest và cách dựng nằm cùng thư mục.
- Sau mã sửa: `/tmp/backlog-camera-css-final/camera-after-code-pilot.png`, `camera-after-lock-idle.png`, `camera-locked-700px.png`.
- Log đầy đủ: `/tmp/backlog-canonical-serial.log`; summary JSON: `/tmp/backlog-canonical-serial-summary.json`.
- Fixture FBX công khai, giữ nguyên: three.js r180 commit `0af9729d0c143a86a1d725d6e2c3ad83301f3f34`, `Samba Dancing.fbx`, SHA256 `b9003ee562c87bf03051c3a502411b0808d3513f1d74a2011f7530d9f067069f`. Dùng để kiểm film native; không coi là project/mẫu riêng của người dùng.
- Fixture BOBJ tham chiếu đúng SHA256 đã pin; chỉ nằm ngoài repo qua symlink tạm, không commit. Các ảnh/binary/project thử đều không commit.

## Giới hạn

Chuỗi dao động FOV lịch sử 120° ↔ 78,83° trên project gốc: **NOT_REPRODUCED**. Đã tái hiện trước/sau các lỗi mất key, callback FOV thừa và race lưu/tải trong báo cáo camera. Không có project thật Gỗ Xưa/Đen trong môi trường. Trong game BBS thật: **NOT_RUN**.
