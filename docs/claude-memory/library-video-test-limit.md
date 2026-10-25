---
name: library-video-test-limit
description: "Khi kiểm thử video thư viện animation (App 5) chỉ tạo tối đa 5 video, không quay cả kho"
metadata:
  node_type: memory
  type: feedback
  originSessionId: 11be8693-7072-4bca-96c4-df2b88ac30aa
  modified: 2026-10-24T00:07:28.169Z
---

Khi review/test tính năng quay video động tác thư viện (M2, `/api/library/previews`), chỉ tạo **5 video test**, không chạy cho cả kho.

**Why:** người dùng dặn 2026-10-24 ("quay animation chỉ làm test 5 video thôi") — quay cả kho tốn GPU/thời gian và ghi đầy kho thật.

**How to apply:** luôn truyền `actionUuids` (≤ 5 action, chọn đại diện: kho chung, nhân vật Minecraft 20; **không quay Chirity** — người dùng dặn 2026-10-24) thay vì gọi không tham số; chạy trên kho tạm. Video: nền sáng kiểu Mixamo, không lưới. Liên quan [[review-in-app2]].
