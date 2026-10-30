# B43 — kết quả triển khai và kiểm tra

Nhánh `codex/b43-app2-speed` từ main `ec98f88`. Đặc tả đọc từ nhánh `docs/b43-app2-speed-task`.
Chỉ sửa `editor/apps/studio/`; không đổi package, App 3, App 4, golden hay binary. Không dùng kho thật.

## Thay đổi

- `src/libraryClient.ts`: cache hồ sơ cả phiên, chia sẻ promise đang chạy cho cùng URL, bỏ cache lỗi. Sự kiện `bbs-library-changed` làm mất hiệu lực; đồng bộ với opener cùng origin và bfcache `pageshow`. GET raw/charId chỉ khử trùng đồng thời, không giữ kết quả lâu.
- `character-height/hooks/useCharacterHeights.ts`, `character-height/index.tsx`: bỏ timer/focus/revision; tải theo tập ID nhân vật trong cảnh và sự kiện thay đổi. Bỏ qua kết quả cũ nếu đang có lượt refresh mới.
- `animation-assign/hooks/useAssignData.ts`, `animation-assign/index.tsx`, `AnimationWorkspace.tsx`, `app/library/page.tsx`: dùng cache chung; thông báo sau khi gán/sửa hồ sơ và khi mở Thư viện. `AnimationWorkspace.tsx` là host App 2 được đặc tả chỉ định, không sửa mã App 3.
- `src/libraryModels.ts`, `app/api/library/route.ts`: cache GLB LRU tối đa 16 mục/200 MiB, phụ thuộc path/mtime/ctime/size model, texture và metadata; chia sẻ cả lượt dựng đồng thời. Không đổi thuật toán fingerprint hoặc URL project. Profile PATCH xoá cache nhân vật. ETag/immutable/304 chỉ sau khi xác nhận fingerprint còn đúng; URL cũ vẫn 409 khi texture đổi.
- `src/vfxPreviewClient.ts`, hai hook `vfx-cues`, `StudioOverlay.tsx`: một promise danh sách dùng chung; viewport chỉ lấy danh sách khi có cue, có live scene từ onReady và đã nhường hai animation frame. Chỉ gửi sheet đang dùng tới Stage. Bảng chọn ẩn không mount/tải thư viện; khi người dùng mở mới tải thumbnails. Lỗi thư viện vẫn giữ placeholder/manual input.
- Route `vfx-previews/[effect]`: SHA-256 ETag, private/must-revalidate và 304; kiểm session/file trước 304.
- Các file `test/b43*`: fixture, test cache/route, browser hook và harness production. `test/B43-REPORT.md` lưu báo cáo tóm tắt các phép đo.

## Đo trước/sau

Linux Chromium `/usr/bin/chromium`, ANGLE SwiftShader; production build riêng trên main và nhánh task.
Ba mẫu liên tiếp mỗi bản, không chạy build/suite nặng trong khi đo. Fixture dùng riêng: 300 pack metadata tổng hợp,
16 asset (~42 MiB padding nhị phân, model hình học rất nhỏ), hai nhân vật thư viện, một cue `aura01`.
Thời gian mở/quay về chờ Store ready, tất cả nhân vật runtime hiện hữu và hai animation frame.
Đây không phải mức phức tạp geometry/texture của Shot 01 thật. Bảng dưới ghi trung vị và giá trị lớn nhất của ba mẫu.

| Thao tác | Trước: trung vị / lớn nhất (ms) | Sau: trung vị / lớn nhất (ms) | Kết quả |
|---|---:|---:|---|
| Mở project | 3496.02 / 3503.95 | 3449.45 / 3576.91 | **FAIL** mục tiêu <2000 |
| Thư viện → App 2, link thật/tải lại trang | 2686.14 / 2955.60 | 2446.64 / 2532.53 | PASS <3000 |
| GLB lần hai, conditional HTTP | 38.86 / 43.88 (200) | 7.67 / 7.77 (304) | PASS <50 |

GLB đã được scene truy cập trước cặp đo HTTP: không gọi đây là đo dựng cold. Fixture nhỏ không tái hiện chi phí 1,3–2 s của texture thật.

| Request | Trước mở / sau mở | Trước quay về / sau quay về |
|---|---:|---:|
| `?characters=1` | 2 / 1 | 2 / 1 |
| `?raw=1` | 1 / 1 | 1 / 1 |
| `?charId=` | 1 / 1 | 1 / 1 |
| Danh sách VFX | 2 / 1 | 2 / 1 |

Focus: quan sát 1,2 s sau sự kiện; trước có 1 request hồ sơ, sau 0 (mọi loại thư viện/VFX khác 0).
Hook browser có fake interval clock 60 s: 0 timer/0 request thêm; không dùng khoảng quan sát focus để tuyên bố đã kiểm polling 60 s.
Cảnh có cue: bản sau chỉ yêu cầu ảnh `aura01`, không tải sprite không dùng. Cảnh **không cue** production:
0 danh sách + 0 ảnh VFX khi mở, focus và quay về Thư viện. Bảng chọn không được mở trong phép đo này.
Không lỗi JavaScript trong các mẫu cuối.

Các lượt thăm dò trước khi chặn mount bảng chọn ẩn/chốt tiêu chí chờ tất cả nhân vật được giữ tại `/tmp/b43-preliminary`,
không gộp với mẫu bản cuối. Không loại mẫu chậm trong ba mẫu cuối.

## Lệnh và kết quả thật

Từ `three-workspace-app/editor`, dùng pnpm 9.15.9:

- `pnpm --filter @topview/3d-builder build`: PASS.
- `pnpm typecheck`: PASS toàn workspace.
- `pnpm lint`: PASS, 4 warning có sẵn (không lỗi).
- `pnpm test:evaluate`: PASS — 112 file, 627 PASS / 1 SKIP, gồm golden; không regenerate.
- `pnpm build`: PASS builder + Studio; `pnpm --filter @topview/3d-studio build` PASS sau sửa mount VFX cuối.
- Suite Studio: 75 file, **305 PASS / 7 SKIP / 0 FAIL**. Chạy từng file thật bằng Node 22.15 + `--import ./packages/builder/node_modules/tsx/dist/loader.mjs` để lấy số assertion thay vì file-wrapper. Node 24/tsx có thể báo wrapper PASS mà chưa chạy assertion. Các test cameraFraming/unifiedSceneDemo cần cwd `apps/studio`; Chromium dùng cache tạm trỏ binary hệ thống, Java 17 trong PATH và `BLENDER_EXTERN_DRACO_LIBRARY_PATH` được cấu hình. Các lỗi môi trường đầu tiên đã được chạy lại PASS, không sửa test cũ để che lỗi. 7 SKIP theo điều kiện fixture/native có sẵn.
- Test mới `b43Client.test.ts`: 2 PASS; `b43Models.test.ts`: 1 PASS (đã nằm trong tổng Studio). Kiểm reuse đối tượng GLB chứng minh không dựng lại khi file không đổi; mtime thay đổi dựng lại nhưng giữ fingerprint byte; đổi nội dung texture làm URL cũ 409. Route VFX kiểm 304 body rỗng sau xác thực.
- `node apps/studio/test/b43Hooks.smoke.mjs`: PASS Chromium/React hooks thật — 3 read cùng cache, invalidation đúng một lượt, fake timers/focus, không cue, không tải trước scene ready, chia sẻ picker/preview và loại sheet không dùng. Bundle được dựng ở tmp, không commit.
- `PLAYWRIGHT_BROWSERS_PATH=/tmp/b43-playwright SMOKE_PORT=32439 pnpm --filter @topview/3d-studio test:offline`: PASS bản build cuối, 0 request ngoài máy.
- `B43_PHASE=before|after B43_SMOKE_PORT=32431 B43_OUTPUT=<json> node --import ./packages/builder/node_modules/tsx/dist/loader.mjs apps/studio/test/b43Performance.smoke.ts`: PASS các kiểm request/cache; chạy ba mẫu mỗi bản. `B43_NO_CUE=1` kiểm thêm cảnh không VFX. Baseline chạy cùng harness từ worktree main riêng.

**NOT_RUN:** kho thật 368 pack, Shot 01 thật, Windows/GPU thật và kiểm game. Không ghi vào kho/project/game người dùng.
**Không tuyên bố đạt toàn bộ tốc độ:** mục tiêu mở <2 s còn FAIL trên fixture software rendering; PR để draft.
Không mở rộng phạm vi sang điều hướng SPA Thư viện↔App 2 hay gộp project loads (đặc tả loại trừ).
