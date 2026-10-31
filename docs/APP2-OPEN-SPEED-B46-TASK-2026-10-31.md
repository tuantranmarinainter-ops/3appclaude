# Task Luồng B: App 2 — dọn PR #177 và mở project dưới 2 giây (B46) (2026-10-31)

> Người dùng giao 2026-10-31. Giao Codex (Luồng B của task điều phối chung). **Không tự merge**, không tự đóng PR nào.
> Liên quan: `docs/B43-APP2-SPEED-TASK-2026-10-31.md` (nhánh `docs/b43-app2-speed-task`), PR #177 và báo cáo
> `editor/apps/studio/test/B43-REPORT.md` trên nhánh `codex/b43-app2-speed`, backlog B35, B39, B43.

## Hiện trạng
- PR #177 (B43, nháp) đã: cache thư viện cả phiên, GLB nhân vật 304 (~39 → ~8 ms), VFX tải lười, bỏ polling.
  **Mở project vẫn ~3,4 s** (fixture B43: 300 pack, 16 asset ~42 MiB, 2 nhân vật thư viện, 1 cue), mục tiêu < 2 s.
  Thư viện → App 2 ~2,4 s (tải lại trang).
- PR #177 commit `test/B43-PERFORMANCE-RESULTS.json` (~2.400 dòng) — cần bỏ.
- PR #174 (B34, MC20 gán động tác), #175 (B35+B26, refresh từng phần), #176 (B35–B40, tốc độ + timeline) còn mở từ
  26/10, **sửa cùng file** với #177 (`app/api/library/route.ts`, `app/library/page.tsx`, `StudioOverlay.tsx`,
  `character-height/*`, `libraryModels.ts`).
- Đọc trên nhánh `codex/b43-app2-speed`:
  - `StudioOverlay.tsx`: mỗi lệnh (undo/redo `runHistory`, đổi asset, relink…) làm `loadUnifiedProject` **trước** để lấy
    revision rồi **sau** để làm mới → 2 lần tải project mỗi lệnh (dòng ~189–194, 211–216, 230–237, 247–254, 266–268, 434).
  - Undo/Redo và một số lệnh gọi `setEditorKey(k => k + 1)` → **remount `DirectorStudio`** → tạo `AssetLoader` mới →
    mất `characterTemplates`/`propTemplates` (`packages/builder/src/engine/io/AssetLoader.ts`, cache theo instance) →
    tải + parse lại mọi GLB.
  - `AssetLoader` dùng `GLTFLoader` + `DRACOLoader` trên luồng chính; template nhân vật dùng lại qua `SkeletonUtils.clone`.
  - Sang Thư viện: `WorkspaceNavigation` dẫn tới `/library` (trang Next riêng); `LocalHostAdapter` mở popup
    `/library?app2=1`; bảng gán động tác `window.open('/library?…', '_blank')`. Quay về App 2 = tải lại trang.

## Phân vùng file (tránh đụng Luồng A, C)
- **Được sửa:** `three-workspace-app/editor/apps/studio/**` **trừ** `public/animation-studio/**`,
  `app/workbench/components/animation-creation/**`, `src/app3Embed.ts`, `scripts/embed-app3.mjs` (vùng Luồng C).
- `packages/builder`: chỉ khi số đo chứng minh cần (vd cache template dùng chung giữa các lần mount, parse GLB trong worker).
  Khi đó **đề xuất trước trong PR nháp**, tuân `editor/AGENTS.md` §3 (không `fetch`/`/api/` trong package, thêm API không
  đổi chữ ký cũ, chạy golden `pnpm test:evaluate` không regenerate).
- Không sửa `packages/retarget`, `animation-studio/`, `vfx/`.

## B1 — Dọn PR #177 (nhánh `codex/b43-app2-speed`)
1. Viết lại lịch sử nhánh, bỏ `editor/apps/studio/test/B43-PERFORMANCE-RESULTS.json`; giữ tóm tắt số đo trong
   `B43-REPORT.md`. Không commit file > 100 KB.
2. Thêm mục **"Đối chiếu PR cũ"** vào mô tả #177: với từng PR #174, #175, #176 — liệt kê thay đổi nào đã được #177 thay thế,
   thay đổi nào còn giá trị riêng (nêu file/hàm), và xung đột merge dự kiến. Đề xuất: đóng / rebase lên #177 / giữ nguyên.
   **Không tự đóng PR.**
3. Chạy lại `pnpm test:all`; bỏ trạng thái nháp **chỉ khi** người dùng chấp nhận mục tiêu < 2 s được chuyển sang B2.
   Ghi rõ điều đó trong mô tả.

## B2 — Mở project < 2 s (nhánh `codex/b46-app2-open-speed`, dựa trên `codex/b43-app2-speed`)
### Bước 1: đo trước, không sửa
- Dùng fixture B43 (tái tạo bằng `test/b43Fixtures.ts`) và production build (`pnpm build` + `next start`), Chromium Playwright
  đi kèm, 3 mẫu mỗi phép đo.
- Ghi **mốc thời gian** (performance.mark trong `apps/studio`, không trong package) và Performance profile, tách:
  1. `ensureUnifiedSession` + `GET /api/unified/projects/<id>` (mạng + JSON parse),
  2. tải byte từng GLB (song song hay tuần tự? tổng byte),
  3. parse GLB (`GLTFLoader.parse`, Draco) — thời gian **chặn luồng chính** (long task > 50 ms),
  4. dựng cảnh/skeleton/clone, gán motion,
  5. React render/commit của `StudioOverlay` và panel,
  6. request khác trong lúc mở (thư viện, VFX, cover…).
- Thêm 3 phép đo: **Ctrl+Z** (đang remount), **quay về từ App 3**, **Thư viện → App 2**.
- Đưa bảng phân rã vào mô tả PR **trước khi** sửa (commit đầu chỉ có công cụ đo).

### Bước 2: sửa theo số đo (ưu tiên từ trên xuống, bỏ mục nào số đo cho thấy không đáng)
1. **Một lần tải project mỗi lệnh:** `sendUnifiedCommand` đã trả `revision`; dùng project hiện có trong state làm
   `expectedRevision`, chỉ tải lại **một** lần sau lệnh (hoặc dùng dữ liệu lệnh trả về nếu đủ). Xung đột revision (409) →
   tải lại một lần rồi báo người dùng, không lặp vô hạn.
2. **Không remount editor khi Undo/Redo và lệnh thường:** áp project mới vào store/adapter hiện tại thay cho
   `setEditorKey`. Nếu bắt buộc remount (đổi tài liệu, lỗi phục hồi), giữ cache template GLB **ngoài** instance `AssetLoader`
   (đề xuất API package nếu cần). Mục tiêu Ctrl+Z < 0,3 s, 0 request GLB.
3. **Tải GLB song song, ưu tiên thứ nhìn thấy:** nhân vật/props trong khung nhìn đầu tiên trước; còn lại tải nền. Hiện cảnh
   khi phần nhìn thấy sẵn sàng (đo "first useful frame" riêng với "tất cả nhân vật").
4. **Parse GLB không chặn giao diện:** nếu bước 1 cho thấy parse > 100 ms/lần, chuyển parse/Draco sang worker hoặc chia nhỏ;
   đề xuất trước nếu phải sửa package.
5. **Thư viện ↔ App 2 không tải lại trang:** điều hướng phía client (Next `router.push`/`<Link>` trong cùng layout) cho
   đường `WorkspaceNavigation → /library → App 2`, giữ runtime/cache. Popup `/library?app2=1` và tab gán động tác giữ hành vi
   hiện tại (đã đồng bộ bằng `bbs-library-changed`), chỉ đổi nếu đo thấy cần.
6. Các request còn lại khi mở mà không cần cho khung đầu: hoãn sau `onReady`.

### Mục tiêu đo (fixture B43, production build, trung vị 3 mẫu)
| Thao tác | Hiện tại | Mục tiêu |
| --- | --- | --- |
| Mở project tới khung đầu dùng được | ~3,4 s (tới đủ nhân vật) | < 1,5 s |
| Mở project tới đủ mọi nhân vật | ~3,4 s | < 2 s |
| Ctrl+Z / Ctrl+Y | remount, tải lại GLB | < 0,3 s, 0 request GLB |
| Quay về từ App 3 | chưa đo | < 2 s, chỉ tải clip/motion đổi |
| Thư viện → App 2 (điều hướng trong app) | ~2,4 s | < 1 s |
| Số lần `GET /api/unified/projects/<id>` mỗi lệnh | 2 | 1 |

## Kiểm (ghi trong mô tả PR, số trước/sau)
- `pnpm test:all` (gồm `test:evaluate` golden không đổi, typecheck, lint, Studio, App 3 build/features).
- `pnpm --filter @topview/3d-studio test:offline`.
- Test mới: đếm request project mỗi lệnh = 1; Ctrl+Z không remount (đếm số lần mount `DirectorStudio` = 1, request GLB = 0);
  409 revision xử lý đúng; điều hướng Thư viện → App 2 không `navigation.type === 'reload'`.
- Bảng thời gian trước/sau đủ 6 dòng mục tiêu, kèm phân rã của bước 1.
- Chromium Playwright đi kèm (không viết cứng `/usr/bin/chromium`).
- NOT_RUN: kho thật 368 pack, Shot 01 thật, Windows/GPU thật — Claude/người dùng đo khi review.

## Ranh giới
- Repo https://github.com/tuantranmarinainter-ops/3appclaude. Không tự merge, không tự đóng PR.
- Không commit binary, fixture lớn, log/JSON > 100 KB, ảnh. Không đổi golden.
- Không đổi định dạng project, URL asset hay fingerprint đang lưu trong project.
- Báo cáo tiếng Việt, ghi rõ phần NOT_RUN.
