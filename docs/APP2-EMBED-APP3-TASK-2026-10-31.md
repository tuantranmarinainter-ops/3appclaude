# Task Luồng C: đưa App 3 mới vào App 2 (bản nhúng v1.34.0) (2026-10-31)

> Người dùng giao 2026-10-31. Giao Codex (Luồng C của task điều phối chung). Một nhánh + một PR vào `main`, **không tự merge**.
> Bắt đầu **sau khi PR #182 (Gói 2 Molang) đã merge**. Nhánh gợi ý `codex/app2-embed-app3-v1.34`.

## Vì sao
App 3 trên `main` đã có Gói 1 (timeline), Gói 2 (Molang), Gói 5 (bố cục theo chế độ) và Gói 6 (phím tắt), nhưng App 2 vẫn
nhúng bản cũ `v1.33.0`. Người dùng mở App 3 từ App 2 nên **chưa thấy** các tính năng mới.

## Hiện trạng (đọc trên `main` 7418b6f)
- Bản nhúng: `three-workspace-app/editor/apps/studio/public/animation-studio/` có `v1.31.8/`, `v1.32.0/`, `v1.33.0/`;
  mỗi thư mục gồm `index.html` (~9 MB, App 3 build một file), `host-bridge.js` (~27 KB), `README.md`.
- App 2 trỏ cứng tới `v1.33.0` trong `app/workbench/components/animation-creation/index.tsx`:
  `FRAME_URL`, `BRIDGE_URL`, `CHANNEL = 'bbs-animation-studio-v1.33.0'`, `title="Animation Studio 1.33.0"`. Iframe cùng origin;
  khi iframe `onLoad`, App 2 chèn `<script src=BRIDGE_URL data-bbs-host-bridge>` vào tài liệu của iframe; hai bên trao đổi
  bằng `postMessage` có kiểm `origin`, `source` và `channel`.
- `CHANNEL` còn lặp lại ở `animation-creation/hooks/useSilhouetteSync.ts` (App 2) và `animation-studio/.../src/host_bridge.js`
  (App 3), cùng các test App 3 (`app3_bridge.test.mjs`, `app3_browser.test.mjs`).
- Chỗ khác nhắc tới phiên bản nhúng: `editor/apps/studio/test/app3Height.test.ts` (đọc `v1.33.0/host-bridge.js`),
  `editor/scripts/test-all.mjs` bước `app3-features` (so `v1.31.8/index.html` với
  `animation-studio/outputs/Animation_Studio_v1_33_0.html`), `animation-studio/tools/test-mc20-controls-browser.mjs`
  (đọc `v1.33.0/index.html`).
- App 3 build: `animation-studio/work/material_alpha_v1_31_8/src/build.mjs` luôn ghi ra
  `animation-studio/outputs/Animation_Studio_v1_33_0.html` (tên cố định).
- Gói phát hành CLI: `editor/apps/studio/scripts/stage-standalone.mjs` chép **toàn bộ** `public/` → mỗi bản nhúng thêm ~9 MB.
- Giấy phép: App 3 là **GPL-3.0** (`animation-studio/LICENSE`, `NOTICE`); App 2 là Apache-2.0. Ranh giới hợp lệ hiện tại:
  App 2 chỉ chạy App 3 trong iframe và giao tiếp bằng thông điệp; không import mã App 3 vào bundle App 2.

## Phân vùng file (tránh đụng Luồng A, B)
- **Được sửa:** `editor/apps/studio/public/animation-studio/**`, `editor/apps/studio/app/workbench/components/animation-creation/**`,
  file mới `editor/apps/studio/src/app3Embed.ts`, file mới `editor/apps/studio/scripts/embed-app3.mjs`,
  `editor/apps/studio/test/app3Height.test.ts` và test mới trong `editor/apps/studio/test/`, `editor/scripts/test-all.mjs` (chỉ bước app3).
- **Không sửa:** mọi file trong `animation-studio/` (vùng Luồng A) — kể cả `build.mjs`, `host_bridge.js`, test App 3;
  `StudioOverlay.tsx`, `AnimationWorkspace.tsx`, `src/libraryClient.ts`… (vùng Luồng B); `packages/*`, `vfx/`.
  Nếu cần đổi gì trong App 3, ghi vào mục "Đề xuất cho Luồng A" trong PR.

## Yêu cầu
### 1. Một nguồn duy nhất cho thông tin nhúng
- Tạo `src/app3Embed.ts` export: `APP3_EMBED_VERSION = '1.34.0'`, `APP3_FRAME_URL`, `APP3_BRIDGE_URL`, `APP3_TITLE`,
  `APP3_BRIDGE_CHANNEL`.
- `animation-creation/index.tsx` và `hooks/useSilhouetteSync.ts` dùng các hằng này, không còn chuỗi `v1.33.0` viết cứng.
- **Kênh cầu nối là phiên bản giao thức, không phải phiên bản build:** giữ nguyên giá trị
  `APP3_BRIDGE_CHANNEL = 'bbs-animation-studio-v1.33.0'` vì `host_bridge.js` của App 3 vẫn dùng đúng chuỗi này.
  Ghi chú rõ trong mã và README: đổi kênh chỉ khi giao thức đổi, và phải đổi đồng thời ở App 3 (Luồng A).

### 2. Script tạo bản nhúng lặp lại được
- `scripts/embed-app3.mjs --version 1.34.0`:
  1. Kiểm cây làm việc `animation-studio/` sạch (không có thay đổi chưa commit), lấy SHA commit hiện tại.
  2. Chạy build App 3 (`node src/build.mjs` trong `animation-studio/work/material_alpha_v1_31_8`), lấy
     `outputs/Animation_Studio_v1_33_0.html` (tên file build cố định — **không** đổi `build.mjs`).
  3. Tạo `public/animation-studio/v<version>/`: `index.html` (bản build), `host-bridge.js` (**chép nguyên byte** từ
     `src/host_bridge.js` cùng commit), `LICENSE` và `NOTICE` (chép từ `animation-studio/`), `README.md`.
  4. Từ chối ghi đè thư mục đã tồn tại (trừ khi có `--force`).
- `README.md` của bản nhúng ghi: phiên bản, SHA commit nguồn, lệnh build, SHA-256 của `index.html` và `host-bridge.js`,
  kênh cầu nối, danh sách tính năng chính so với bản trước (Gói 1, 2, 5, 6), dòng "App 3 phân phối theo GPL-3.0".
- Script không ghi gì ngoài `public/animation-studio/v<version>/` (và `animation-studio/outputs/` do build App 3 sinh, không commit).

### 3. Bản nhúng v1.34.0
- Chạy script cho `1.34.0` từ `main` sau khi #182 merge; commit thư mục mới.
- **Giữ** `v1.31.8/` (mốc so ID của `app3-features`) và `v1.33.0/` (để quay lại nhanh). Với `v1.32.0/`: kiểm không còn
  tham chiếu nào, **đề xuất** xoá trong mô tả PR kèm số MB tiết kiệm cho gói CLI — chỉ xoá khi người dùng đồng ý.
- Quay lại bản cũ: chỉ cần đổi `APP3_EMBED_VERSION` (ghi cách làm trong README).

### 4. Hành vi bên trong App 2
- **Cài đặt dùng chung:** iframe cùng origin với App 2 nên `localStorage` (`animation-studio-settings`, `animation-studio-layout-v2`…)
  dùng chung với App 3 chạy riêng trên cùng origin. Kiểm: người đã có `animation-studio-layout-v2` mở trong App 2 thấy
  **bố cục cổ điển** (đúng quy tắc Gói 5); người mới thấy bố cục theo chế độ; đổi trong ⚙ được nhớ.
- **Kích thước iframe:** đo kích thước thật của khung App 3 trong App 2 ở cửa sổ 1920×1080 và 1366×768. Bố cục theo chế độ
  phải dùng được (không mất nút chính, không cuộn ngang); ngưỡng ngăn kéo ≤ 1024 px tính theo **chiều rộng iframe**.
  Thông báo "chỉ dùng trên PC" không được che App 3 khi iframe hẹp nhưng màn hình lớn — nếu có, ghi vào "Đề xuất cho Luồng A".
- **Phím tắt:** phím tắt App 3 (Gói 6) chỉ chạy khi focus trong iframe; khi focus ở App 2, phím App 2 hoạt động như cũ;
  gõ trong ô nhập App 2 không kích hoạt App 3 và ngược lại. `Ctrl+1/2/3` trong iframe không đổi tab của App 2.
- **Trả kết quả về App 2:** luồng hiện có (sửa động tác trong App 3 → trả Action về App 2 → project tăng revision) chạy
  đúng với bản mới; đồng bộ silhouette (`useSilhouetteSync`) vẫn chạy.
- **Molang:** project có biểu thức trả về App 2 phải ở dạng App 2 đọc được (đã bake hoặc giá trị số); nếu App 3 trả về
  biểu thức chưa bake mà App 2 không hiểu, báo rõ trong PR và ghi vào "Đề xuất cho Luồng A".

### 5. Test và công cụ trỏ phiên bản
- `app3Height.test.ts`: đọc đường dẫn bridge từ `src/app3Embed.ts` (hoặc từ phiên bản mới), không viết cứng.
- `test-all.mjs` bước `app3-features`: so **cả** `v1.31.8/index.html` (mốc gốc) **và** `v1.33.0/index.html` (bản nhúng
  trước) với bản build mới; không mất ID nào.
- Test mới (Node + trình duyệt thật, trong `editor/apps/studio/test/`): App 2 mở project → mở tạo animation → iframe tải
  đúng `v1.34.0` → đổi tab bố cục, mở bảng Phím tắt, nhập một biểu thức Molang và bake → sửa một keyframe → trả về App 2 →
  revision tăng; kiểm phím tắt không rò giữa hai bên.
- Các test App 3 vẫn trỏ `v1.33.0` (`app3_browser.test.mjs`, `test-mc20-controls-browser.mjs`…) **không sửa** (vẫn chạy vì
  giữ `v1.33.0`); liệt kê trong PR để Luồng A cập nhật sau.

## Kiểm (ghi trong mô tả PR)
- `pnpm test:all` (editor) PASS; `pnpm --filter @topview/3d-studio test:offline` PASS (0 request ra ngoài).
- Test mới ở mục 5 PASS trên Chromium (Playwright đi kèm, không viết cứng đường dẫn trình duyệt).
- SHA-256 `host-bridge.js` trong `v1.34.0/` bằng SHA của `animation-studio/.../src/host_bridge.js` tại commit nguồn.
- Kích thước gói CLI (`stage-standalone`) trước/sau.
- Ảnh hoặc mô tả bằng chữ kích thước iframe đo được (không commit ảnh/SVG/log > 100 KB).
- NOT_RUN: Windows/GPU thật, Shot 01 thật, trong game.

## Ranh giới
- Repo https://github.com/tuantranmarinainter-ops/3appclaude, dựa trên `main` sau khi #182 merge. Không tự merge.
- Không import mã App 3 vào bundle App 2; chỉ iframe + `postMessage` + chèn `host-bridge.js` vào tài liệu của iframe.
- Không commit binary ngoài `index.html`/`host-bridge.js` của bản nhúng (đúng kiểu các bản trước). Báo cáo tiếng Việt.
- Lặp lại cho mỗi lần App 3 merge thêm gói: chạy `scripts/embed-app3.mjs --version 1.35.0` (rồi 1.36.0…), một PR mỗi lần.
