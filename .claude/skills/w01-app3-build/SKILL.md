---
name: w01-app3-build
description: Build lại App 3 (Animation Studio) và cập nhật bản nhúng mà App 2 phục vụ (public/animation-studio/v1.34.0: index.html, host-bridge.js, README hash), rồi kiểm không mất chức năng. Dùng NGAY sau mọi lần sửa file trong three-workspace-app/animation-studio/work/material_alpha_v1_31_8/src (onion, menu, toolbar, host_bridge.js, shot_controller…), khi test app3Embed báo sai hash, hoặc khi merge/rebase bị xung đột README.md/index.html của v1.34.0.
---

# Build App 3 nhúng trong App 2

App 2 nạp App 3 trong iframe từ `three-workspace-app/editor/apps/studio/public/animation-studio/v<ver>/`
(`<ver>` = `APP3_EMBED_VERSION` trong `apps/studio/src/app3Embed.ts`, hiện `1.34.0`). Bản này là **file build**, không tự cập nhật
khi sửa nguồn ở `three-workspace-app/animation-studio/work/material_alpha_v1_31_8/src`. Test `app3Embed` so SHA-256 trong
`v<ver>/README.md`, nên quên build lại hoặc chép tay sai là test đỏ và App 2 chạy bản cũ.

## Một lệnh
```bash
python .claude/skills/w01-app3-build/scripts/app3_build.py            # nguồn đã commit
python .claude/skills/w01-app3-build/scripts/app3_build.py --allow-dirty   # đang sửa dở, chưa commit
```
Script gọi `editor/apps/studio/scripts/embed-app3.mjs` (script chính thức: build `src/build.mjs`, chép `index.html` + `host-bridge.js`
+ LICENSE/NOTICE, **ghi lại README với hash mới**), rồi:
- `animation-studio/tools/check-features.mjs`: so với bản đang phục vụ ở HEAD, **không được mất id phần tử nào**. Người dùng chốt
  "App 3 giữ mọi chức năng của Animation Studio": ẩn/dời UI thì được, xoá thì không.
- `node --test` các test đơn vị App 3 (onion, bridge, layout, workflow, shot_package).
- `app3Embed.test.ts` (hash README).
In `PASS/FAIL` từng bước; cuối cùng liệt kê thư mục cần commit.

Đừng chép tay `outputs/Animation_Studio_v1_33_0.html` rồi sửa hash bằng `sed`. Cách đó từng gây xung đột và sai hash nhiều lần;
script chính thức đã làm đúng việc này.

## Xung đột hash khi gộp nhánh
Hai nhánh cùng sửa App 3 → `v<ver>/README.md` (và có thể `index.html`) xung đột. Đừng sửa tay từng dòng hash:
1. Giải xung đột **file nguồn** trong `src/` trước (đó mới là nội dung thật).
2. `python …/app3_build.py --allow-dirty`: build lại từ nguồn đã gộp, README được ghi lại toàn bộ.
3. `git add three-workspace-app/editor/apps/studio/public/animation-studio/v<ver>/ <file nguồn>` rồi commit merge.

## Thứ tự làm việc khi sửa App 3
1. Sửa nguồn trong `work/material_alpha_v1_31_8/src` (không sửa thẳng `v<ver>/index.html`).
2. Thêm/sửa test `*.test.mjs` cạnh file (chạy `node --test <file>` trong `src/`).
3. Chạy script trên. Có server App 2 đang chạy (`next start`) thì chỉ cần tải lại trang: thư mục `public/` đọc trực tiếp từ đĩa.
   Sửa cả code TS/TSX của App 2 thì phải `pnpm build` lại và khởi động lại server.
4. Commit nguồn + test + `v<ver>/` cùng một commit.

Test Chromium của App 3 (`*.browser.test.mjs`, test Studio cần `APP3_RUNTIME_BASE`) không nằm trong script. Chạy riêng khi đổi bố cục/UI lớn.
