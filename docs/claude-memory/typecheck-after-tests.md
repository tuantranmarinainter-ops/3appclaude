---
name: typecheck-after-tests
description: "Sau khi thêm/sửa file test TS, chạy `pnpm typecheck` toàn workspace trước khi push — vitest/tsx không kiểm kiểu, CI main từng đỏ vì vậy"
metadata:
  node_type: memory
  type: feedback
  originSessionId: 11be8693-7072-4bca-96c4-df2b88ac30aa
  modified: 2026-10-21T18:15:46.131Z
---

Test silhouette của builder (6695735) qua vitest nhưng có lỗi ép kiểu TS2352; CI GitHub trên main đỏ, Codex phát hiện khi nộp E3 (2026-10-22).

**Why:** vitest và `node --import tsx --test` chỉ bóc kiểu, không kiểm; `tsconfig` của builder/retarget có gồm thư mục test, còn Studio thì loại `*.test.ts`.

**How to apply:** trước mỗi commit có file `.ts`, chạy `pnpm typecheck` (từ `three-workspace-app/editor`), không chỉ chạy test. Với PR của Codex cũng chạy `pnpm typecheck` toàn workspace, không chỉ typecheck Studio. Test trình duyệt App 3 cần `APP3_RUNTIME_BASE` + server Studio cô lập (BBS_UNIFIED_PROJECTS_DIR riêng) mới chạy thật; nếu bị skip thì chưa có bằng chứng.

Liên quan: [[retarget-verify-rules]]
