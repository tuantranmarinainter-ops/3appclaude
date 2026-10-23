# App 4 VFX — giao việc thiết kế UI/UX cho Codex (2026-10-23)

Người dùng giao 2026-10-23: **Codex thiết kế UI/UX cho App 4 (VFX particle, Effekseer)**. Đọc trước: `docs/VFX-APP4-PLAN.md`
(lõi effekseer-ai + MCP, render preview, đích Minecraft/AAA), `docs/VFX-BBS-PARTICLE-MAPPING.md`, `docs/VFX-REPORT-V4.md`,
`docs/ANIM-LIBRARY-TASKS-2026-10-23.md` (W1 thanh 5 workspace, W2 kéo viền khung, W3 render GPU).

## Bối cảnh (hiện trạng thật)
- App 4 **chưa có giao diện**: chỉ CLI/MCP Python trong `three-workspace-app/vfx/` (`src/effekseer_ai/`: `cli.py`, `mcp_server.py`,
  `preview.py`, `image_gate.py`, `bbs_package.py`, `ir_to_bbs.py`; `tools/bake_sprite_sheet.py`, `render_preview.py`).
- Hiệu ứng đang dùng trong phim: 10 mẫu Effekseer CC0 (`.efkefc`), nướng thành **bảng sprite** (ảnh + JSON lưới/fps/kích thước) để
  App 2 phát trong "Xem như BBS"; App 2 có nút **Hiệu ứng** (đặt cue, chọn *Tự phát* / *Phát thủ công* trong BBS FS).
- Đích cuối: **BBS FS 2.7 + AAA Particles** trong Minecraft 1.20.1; mọi hiệu ứng xuất ra phải chạy được trong game thật.
- Bộ app: 1 Chuẩn hoá · 2 Dựng cảnh · 3 Animation · **4 VFX** · 5 Thư viện, chuyển bằng thanh 5 workspace (W1, kiểu DaVinci Resolve).
  App 1 tạm chạy riêng; hoàn thiện xong mới gộp. Chuột mọi khung 3D: **trái xoay, giữa kéo, lăn zoom**. Giao diện **tiếng Việt**.

## Phạm vi việc V1 (thiết kế, chưa nối backend)
Ranh giới: chỉ sửa `three-workspace-app/vfx/` và `docs/VFX-*` (quy tắc App 4 trong `CLAUDE.md`). Nối vào App 2/Studio là việc sau,
**đề xuất trước, không tự làm**. Không commit ảnh/video/hiệu ứng (dữ liệu mẫu dùng JSON giả + hình vẽ CSS/SVG/canvas).

### Sản phẩm
1. **`docs/VFX-APP4-UIUX.md`** — đặc tả UI/UX:
   - Bố cục workspace kiểu DaVinci: hàng 5 workspace (4 VFX sáng), **trái** thư viện, **giữa** khung xem, **phải** inspector,
     **dưới** timeline; mọi viền chia kéo được (theo W2), nhớ kích thước.
   - Luồng chính (mỗi luồng có sơ đồ bước + trạng thái rỗng/đang tải/lỗi):
     a. **Thư viện hiệu ứng**: lưới thẻ có ảnh động (bảng sprite), tìm kiếm, lọc theo loại (hào quang, vòng phép, vệt chém,
        đạn/projectile, va chạm/nổ, khiên, lốc…), màu, độ dài, lặp/không lặp, nguồn + license (CC0…), trạng thái "đã chạy trong game".
     b. **Xem trước**: khung xem 3D (sprite hoặc render Effekseer), nền sáng/tối/"như BBS" (trời, cỏ), thước đo **block**, nhân vật
        mẫu để so cỡ, play/pause/scrub/lặp/tốc độ, chỉ báo renderer GPU/CPU (W3).
     c. **Tạo từ mô tả** (tiếng Việt → EffectSpec): ô mô tả + các trường chỉnh được (chủ đề, bảng màu, thời lượng, lặp, lớp, thời điểm
        phát, cỡ theo block, seed); kết quả nhiều phương án; **vòng sửa** bằng lời ("xanh hơn, nổ muộn 0,5 s") có lịch sử phiên bản.
     d. **Chỉnh thông số**: danh sách lớp/node, thuộc tính hay dùng bằng thanh trượt/màu/curve đơn giản; nâng cao mới hiện đủ.
     e. **Kiểm tra & đóng gói**: lỗi cấu trúc, texture thiếu, license/credits, profile AAA 2.2.3, danh sách kiểm trong game; xuất gói
        BBS/AAA; **"Gửi sang App 2"** (thành cue trong cảnh, chọn Tự phát/Thủ công).
   - Hệ thống thiết kế: dùng lại màu/chữ/khoảng cách của Studio (tối, accent), trạng thái nút, phím tắt (Space play, J/K/L, F khung
     vừa, 1–5 chuyển workspace), kích thước tối thiểu 1366×768 và 1920×1080, hỗ trợ bàn phím + nhãn cho trình đọc màn hình.
   - Bảng **ánh xạ màn hình ↔ chức năng backend** (lệnh CLI/MCP có thật vs. cần làm mới theo `VFX-APP4-PLAN.md` mục 4), để biết
     phần nào UI làm được ngay, phần nào chờ backend.
2. **Prototype bấm được**: `three-workspace-app/vfx/ui-prototype/index.html` (+ `app.js`, `styles.css`, `mock-effects.json`), mở trực
   tiếp bằng trình duyệt, **không cần build, không thêm dependency** (three.js nếu cần lấy từ bản sẵn trong repo hoặc CDN có phiên
   bản cố định). Đủ 5 luồng ở trên với dữ liệu giả; nếu có biến `?previews=<url>` thì đọc bảng sprite thật từ route
   `/api/unified/vfx-previews` của Studio (đã có) để hiện ảnh động thật.
3. Test nhỏ cho logic thuần của prototype (lọc/tìm kiếm, chuyển trạng thái phiên bản) chạy bằng `node --test`.

## Cách làm và nộp
- Agent điều phối chia subagent (model **sol 5.6** bản nhẹ): (1) đặc tả + luồng, (2) prototype, (3) test — chạy song song khi được.
- Nhánh `ai1/v1-vfx-uiux`, một PR. Mô tả PR có **ảnh chụp từng màn hình prototype** (đính kèm vào PR, không commit) và link file.
- **Không tự merge.** Người dùng duyệt thiết kế xong mới giao bước nối App 4 ↔ App 2 / backend.

## Lệnh gửi Codex
> Đọc `docs/VFX-APP4-UIUX-TASK.md` trên `main`. Thiết kế UI/UX cho App 4 VFX: đặc tả `docs/VFX-APP4-UIUX.md` + prototype bấm được
> `three-workspace-app/vfx/ui-prototype/` (không build, không thêm dependency, dữ liệu giả, giao diện tiếng Việt, bố cục kiểu
> DaVinci với thanh 5 workspace). Chia subagent model **sol 5.6** bản nhẹ, chạy song song. Chỉ sửa `three-workspace-app/vfx/` và
> `docs/VFX-*`. Nhánh `ai1/v1-vfx-uiux`, một PR có ảnh chụp từng màn hình, **không tự merge**.
