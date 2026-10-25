---
name: three-app-pipeline
description: "Quy trình 3 app (chốt 2026-10-22): App1 áp anim lên nhân vật đích, App2 AI/MCP xếp cảnh + ghép film + xuất BBS FS, App3 blocking/chỉnh rồi trả Action về App2; kho anim App4 dùng chung"
metadata:
  node_type: memory
  type: project
  originSessionId: f6626a18-f838-4656-909f-ee7639aac603
  modified: 2026-10-23T06:44:47.822Z
---

Quy trình người dùng chốt hướng (2026-10-21, sửa 2026-10-22):
- Rig chuẩn hoá hiện tại: Mixamo65 và Minecraft20. Sau này thêm rig mở rộng = Mixamo + xương phụ (miệng ở head, cánh...).
- App 1: lấy animation từ nhân vật nguồn, chuẩn hoá lên từng nhân vật ĐÍCH. Làm lần lượt từng nhân vật của một bối cảnh.
  Kho animation đã chuẩn hoá: DÙNG CHUNG cho cả 3 app (chốt 2026-10-21). App 1 chuẩn hoá và ghi vào kho;
  App 1 cũng chọn nhân vật đích → áp kho; App 2/App 3 đọc kho.
  Kho tách thành App 4 (thư mục ngoài repo + packages/library + UI + MCP); bản nháp `docs/LIBRARY-CONTRACT.md`.
  Nạp kho: luôn qua App 1 trước (chuẩn hoá hàng loạt) rồi mới vào App 4. 4 điểm mở trong bản nháp đang tạm dừng.
- App 2: nhận các nhân vật ĐÃ có animation; AI qua MCP nhận cỡ cảnh/phân cảnh/góc máy để xếp vị trí nhân vật và camera;
  xuất gói shot cho App 3; nhận Action đã sửa từ App 3 (thay clip bằng UUID mới, giữ gốc); GHÉP FILM + XUẤT BBS FS.
- App 3: AI qua MCP làm blocking từng nhân vật, chỉnh chậm/mượt, xem timeline, rồi GỬI Action về App 2. App 3 KHÔNG tự xuất BBS FS
  (người dùng chốt 2026-10-22: "Nên để app2", đúng `docs/DECISIONS.md`).
- `.scene.bobj`: chưa rõ định dạng, để sau.
- **Đánh số lại (2026-10-23):** App 4 = VFX particle, App 5 = Thư viện (kho animation nói ở trên). Hiện trạng: App 1 Workbench chạy
  riêng cổng 3101; App 2 + App 3 (`/animation-studio/v1.32.0/`) + App 5 (`/library`) cùng Studio; App 4 chỉ có CLI Python.
  Người dùng chốt: **tạm để App 1 riêng, nối bằng thanh 5 workspace (W1); hoàn thiện xong mới ráp/gộp lại.**

**Why:** quyết định phạm vi từng app.
**How to apply:** App 2 ưu tiên import nhân vật+animation từ App 1 (GLB Mixamo65 và .bobj MC20, giữ xương phụ), MCP xếp cảnh, vòng gói shot ↔ App 3, rồi ghép film/xuất BBS FS. Kho animation thuộc App 4.
