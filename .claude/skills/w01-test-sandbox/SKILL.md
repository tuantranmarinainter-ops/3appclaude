---
name: w01-test-sandbox
description: Dựng bản thử AN TOÀN cho App 2/App 3 của W01: git worktree riêng, bản sao project, bản sao thư viện chỉ gồm gói cảnh cần, cấu hình server (launch.json) có W01_LIBRARY trỏ bản sao. Dùng trước MỌI lần chạy server/test có thể ghi dữ liệu (lưu clip, chuyển động tác, xuất film, gộp clip), khi cần "link test" cho người dùng, hoặc khi giao việc cho agent khác cần dữ liệu thử.
---

# Bản thử an toàn W01

**Vì sao cần:** server App 2 đọc project từ `BBS_UNIFIED_PROJECTS_DIR` và thư viện từ `W01_LIBRARY`. **`W01_LIBRARY` mặc định là
thư viện THẬT** (`S:\Claude\w01-library`, 16 GB). Thao tác "Lưu clip gộp", chuyển động tác, chuyển MC20… sẽ ghi thẳng vào đó.
Project thật của người dùng (`S:\Claude\w01-samples\tap15v3`) và thư mục game Minecraft (`S:\Minecraft\…`) cũng không được ghi khi thử.

## Một lệnh cho bản thử mới
```bash
python .claude/skills/w01-test-sandbox/scripts/sandbox.py all --name k6 --branch claude/my-fix \
  --from-projects S:/Claude/w01-samples/tall-projects --port 3121 [--prod]
```
Lệnh này tạo:
- `S:/Claude/w01-k6` (worktree + `pnpm install` + build builder)
- `S:/Claude/w01-samples/k6-projects` (bản sao project, gỡ junction)
- `S:/Claude/w01-samples/k6-lib` (thư viện con: chỉ động tác/gói mà các project đó tham chiếu; Tập 15 ≈ 2,5 GB)
- mục `k6` trong `S:\Claude\w01\.claude\launch.json`

Có `--prod` thì chạy thêm `pnpm build` để dùng `next start` (mở nhanh ~2 giây). Bỏ `--prod` thì dùng `next dev`.
Khởi động bằng công cụ preview theo tên (`preview_start name=k6`); agent không có công cụ đó thì chạy lệnh trong `runtimeArgs`.

Từng bước riêng: `worktree`, `projects`, `library [--dry-run]`, `launch` (xem `--help`). Script **từ chối** đích là kho thật/project thật
và các cổng đang dùng (3002, 3046, 3048, 3050).

## Nguồn dữ liệu có sẵn (chỉ đọc, đừng sửa)
- `S:/Claude/w01-samples/tall-projects`: Tập 15 · Shot 01 (Đen + Gỗ Xưa) và Shot 02. Bản sao "chuẩn" để copy tiếp.
- `S:/Claude/w01-samples/tall-lib`: thư viện con khớp bộ project trên.
Đừng chạy server của mình trên thư mục của người khác (vd `clip-blend-*`, `test-all6-*`, `tall-*` đang được server 3046/3048/3050 dùng).

## Bẫy đã gặp
- Next dev ở cổng khác 3002 tự thêm `.next-dev-<port>/types/**/*.ts` vào `apps/studio/tsconfig.json`. **Hoàn tác** trước khi commit.
- `next start` đọc `.next` đã build: sửa TS/TSX thì `pnpm build` lại và khởi động lại server. Sửa file trong `public/` (App 3 nhúng) thì chỉ cần tải lại trang.
- Build lại khi server `next start` đang chạy: dừng server trước, nếu không trang sẽ lỗi.
- `C:\w01-samples\*` là junction. Copy phải gỡ junction (script đã làm), nếu không sẽ ghi vào kho mẫu gốc.
- Trình duyệt dùng chung giữa các agent: mở **tab riêng** cho bản thử của mình, đừng điều hướng tab đang dùng của người khác.
- PATH trên máy thiếu System32: gọi PowerShell bằng đường dẫn tuyệt đối. Bash heredoc làm mất `\`: sửa code bằng Edit/Write.

## Dọn
`git worktree remove S:/Claude/w01-k6` (khi nhánh đã merge), xoá `k6-projects`/`k6-lib` khi người dùng không còn dùng link thử,
xoá mục `k6` trong `launch.json`.
