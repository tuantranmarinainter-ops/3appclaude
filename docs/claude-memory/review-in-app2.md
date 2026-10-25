---
name: review-in-app2
description: "Duyệt phim trong App 2 (\"Xem như BBS\"), không vào Minecraft/BBS FS để duyệt trừ khi người dùng yêu cầu"
metadata:
  node_type: memory
  type: feedback
  originSessionId: 11be8693-7072-4bca-96c4-df2b88ac30aa
  modified: 2026-10-22T12:31:20.068Z
---

Mọi việc duyệt cảnh/phim làm trong App 2 (chế độ "Xem như BBS", bảng duyệt cảnh, ảnh chụp từ App 2). Không mở game BBS FS để quay/chụp duyệt trừ khi người dùng yêu cầu rõ.

**Why:** người dùng thấy vòng xuất → vào game → chụp → duyệt quá lâu (2026-10-22), và đã dừng việc quay tiếp giữa chừng.

**How to apply:** khi cần cho người dùng xem kết quả, chụp từ App 2 (`scene.render` với `bbsLook`) và gửi ảnh; xuất film BBS chỉ ở bước cuối hoặc khi được yêu cầu. Kế hoạch: `docs/BBS-PREVIEW-TASKS-2026-10-22.md`. Gửi video kèm bản nhẹ 720p vì file lớn không xem được trên điện thoại. Liên quan [[three-app-pipeline]].
