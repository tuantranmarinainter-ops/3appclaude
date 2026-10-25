---
name: default-vietnamese-ui
description: "Giao diện mọi app mặc định tiếng Việt (nhất là App 2 Topview), không theo ngôn ngữ trình duyệt; App 1 Workbench luôn nền tối"
metadata:
  node_type: memory
  type: feedback
  originSessionId: 11be8693-7072-4bca-96c4-df2b88ac30aa
  modified: 2026-10-24T06:38:45.429Z
---

Người dùng (2026-10-24): "mặc định tất cả là tiếng Việt, đặc biệt là trong app 2 topview"; trước đó: Workbench "tôi luôn dùng nền tối".

**Why:** người dùng làm việc bằng tiếng Việt, thường qua điện thoại; tiếng Anh/nền sáng xuất hiện do theo trình duyệt/hệ điều hành gây khó dùng.

**How to apply:** Studio dùng `INITIAL_LOCALE = 'vi'` khi chưa có lựa chọn lưu (PR #104); app/UI mới viết nhãn tiếng Việt trước; không tự theo prefers-color-scheme sáng. Liên quan [[reply-vietnamese]].
