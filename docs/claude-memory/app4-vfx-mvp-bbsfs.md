---
name: app4-vfx-mvp-bbsfs
description: App 4 VFX MVP gate — every effect exported into BBS FS must actually run there
metadata:
  node_type: memory
  type: project
  originSessionId: 11be8693-7072-4bca-96c4-df2b88ac30aa
  modified: 2026-10-22T01:26:13.616Z
---

MVP of App 4 VFX (Effekseer, `three-workspace-app/vfx/`, chốt 2026-10-22): **mọi hiệu ứng xuất vào BBS FS phải chạy được trong BBS FS thật.** Đây là tiêu chí MVP, không phải giai đoạn sau.

**Why:** người dùng làm phim trong BBS FS; VFX chỉ có giá trị khi phát được trong film (xuất film chỉ từ App 2). Kế hoạch gốc `docs/VFX-APP4-PLAN.md` để BBS ở giai đoạn 5 — người dùng đã nâng lên MVP.

**How to apply:** không xuất/không đưa vào gói BBS FS hiệu ứng nào chưa kiểm chạy được; gate riêng "chạy trong BBS FS" (khác cấu trúc hợp lệ / hình đúng ý / hiệu năng). Effect dùng tính năng ngoài khả năng của bản BBS/AAA thật thì chặn hoặc cảnh báo khi xuất. Liên quan [[three-app-pipeline]], [[retarget-verify-rules]].
