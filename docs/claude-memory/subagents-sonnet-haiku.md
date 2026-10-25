---
name: subagents-sonnet-haiku
description: "Khi phát sinh lỗi, được huy động subagent nhưng chỉ dùng model Sonnet (effort medium) hoặc Haiku, cấm Opus và Fable"
metadata:
  node_type: memory
  type: feedback
  originSessionId: 11be8693-7072-4bca-96c4-df2b88ac30aa
  modified: 2026-10-24T01:19:45.955Z
---

Người dùng (2026-10-25, MVP chạy quy trình Hero/Gỗ Xưa/Đen): khi có lỗi phát sinh, Claude được tự huy động subagent để sửa song song cho nhanh,
nhưng **chỉ dùng `model: "sonnet"` (effort medium) hoặc `model: "haiku"`; không dùng Opus, không dùng Fable.**

**Why:** muốn sửa nhanh để test/làm việc ngay, đồng thời giới hạn chi phí.

**How to apply:** giao lỗi độc lập (debug một route, sửa một file) cho subagent Sonnet medium; việc tra cứu/đọc đơn giản cho Haiku. Brief đủ ngữ cảnh,
worktree riêng, không tự merge. Claude vẫn tự kiểm kết quả bằng số trước khi báo. Liên quan [[retarget-verify-rules]].
