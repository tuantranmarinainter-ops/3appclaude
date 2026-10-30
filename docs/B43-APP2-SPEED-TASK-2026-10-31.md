# Task B43: App 2 mở nhanh — bỏ gọi thư viện lặp, cache GLB nhân vật, VFX tải lười (2026-10-31)

> Người dùng giao 2026-10-31. Giao Codex. Một nhánh + một PR vào `main`, **không tự merge**.
> Chi tiết lỗi + số đo gốc: `docs/BACKLOG-2026-10-25.md` mục B26, B39, B43.
> Mục 2 của `docs/B35-B40-APP2-SPEED-TIMELINE-TASK-2026-10-26.md` (bỏ polling `?characters=1`) **chưa làm** — task này thay mục đó.
> Ngoài phạm vi (làm sau): Thư viện ↔ App 2 không tải lại trang; gộp `loadUnifiedProject` hai lần sau mỗi lệnh.

## Mục tiêu người dùng
"Tôi muốn App 2 nhanh như App 3." App 3 là một trang tĩnh, không gọi server khi đang làm. App 2 hiện gọi server
liên tục và dựng lại dữ liệu nặng mỗi lần mở / quay lại, trên server Node một luồng nên các request chặn nhau.

## Số đo hiện trạng (B43, server dev 3025, kho thật 368 pack, Shot 01)
| Thao tác | Hiện tại | Mục tiêu |
| --- | --- | --- |
| Mở Shot 01 | ~5,5 s | < 2 s |
| Thư viện → App 2 | ~7,9 s | < 3 s (phần còn lại do tải lại trang, ngoài phạm vi) |
| `?modelCharacter=` mỗi nhân vật thư viện | 1,3–2 s, dựng lại mỗi lần | lần 2 < 50 ms (304 hoặc cache) |
| `vfx-previews/aura01` | 3,6 s, tải ngay khi mở | không tải nếu cảnh không có VFX; có VFX thì sau khi cảnh hiện |
| `?characters=1`, `?raw=1`, `?charId=` khi mở | mỗi thứ 2 lần | tối đa 1 lần |

## Hiện trạng trong code (đã đọc trên `main` ec98f88)
1. `apps/studio/app/workbench/components/character-height/index.tsx`: `useEffect` gọi `/api/library?characters=1`
   (`cache: 'no-store'`) khi mount, **mỗi 15 s** (`setInterval`), **mỗi lần cửa sổ focus**, và chạy lại khi
   `project.revision` đổi (mỗi lệnh sửa cảnh). Cùng URL còn được gọi ở `animation-assign/hooks/useAssignData.ts`
   và `app/library/page.tsx`.
2. `apps/studio/app/api/library/route.ts` nhánh `modelCharacter`: mỗi request gọi `libraryCharacterModel()`
   (`src/libraryModels.ts`) — đọc GLB gốc, băm sha256 base + từng texture, dựng lại GLB; có thể gọi thêm lần nữa với
   `faceForward=false` khi fingerprint lệch. Trả `Cache-Control: no-store` dù URL đã chứa `fingerprint`.
3. `apps/studio/app/workbench/components/vfx-cues/hooks/useVfxPreview.ts` (gọi từ `StudioOverlay.tsx` dòng ~166):
   mount là gọi `GET /api/unified/vfx-previews` **dù project không có cue VFX nào**; ảnh từng hiệu ứng
   `/api/unified/vfx-previews/[effect]` trả `Cache-Control: no-store`. `useVfxEffectLibrary.ts` gọi lại cùng danh sách
   khi mở bảng chọn hiệu ứng.
4. `AnimationWorkspace.tsx` `openLibraryPicker`: gọi `?raw=1` + `?charId=` mỗi lần mở bộ chọn, không cache.

## Yêu cầu
### A. Gọi thư viện một lần (B26, B43)
1. Tạo cache phía client dùng chung cho `?characters=1` (vd `apps/studio/src/libraryClient.ts`): một promise đang chạy
   được dùng lại (khử trùng request đồng thời); kết quả giữ đến khi bị **làm mất hiệu lực** rõ ràng.
2. Làm mất hiệu lực khi: thêm/sửa hồ sơ nhân vật hoặc chiều cao (POST `/api/library` các operation liên quan), gán động
   tác xong, hoặc quay về từ trang Thư viện. Dùng một sự kiện cửa sổ (vd `bbs-library-changed`), **không** polling.
3. `character-height/index.tsx`: bỏ `setInterval` 15 s, bỏ `focus`; không chạy lại theo `project.revision`
   (chỉ cần khi danh sách nhân vật thư viện trong cảnh đổi). Chuyển logic tải vào `hooks/` theo AGENTS.md §8.
4. `useAssignData`, `app/library/page.tsx`, `AnimationWorkspace.openLibraryPicker` dùng cùng cache cho `?characters=1`;
   `?raw=1` / `?charId=` khử trùng request đồng thời (cùng URL đang chạy thì dùng lại promise).
5. Ghi trong PR: số request mỗi loại khi mở Shot 01 (trước/sau), đo bằng tab Network hoặc đếm trong test.

### B. Cache GLB nhân vật thư viện (B43)
6. Server: nhớ kết quả `libraryCharacterModel(charId, faceForward)` trong bộ nhớ, khoá theo `charId + faceForward +`
   mtime/size của file base model và texture (không băm lại nếu không đổi). Giới hạn bộ nhớ (vd LRU ~200 MB hoặc 16 mục).
   Ghi/sửa nhân vật trong process thì xoá mục tương ứng.
7. Route `modelCharacter`: khi `fingerprint` khớp, trả `Cache-Control: private, max-age=31536000, immutable` +
   `ETag: "<fingerprint>"`; `If-None-Match` khớp → **304** không dựng GLB. Lệch fingerprint vẫn trả 409 như cũ.
8. Không đổi định dạng `fingerprint` hay URL đang lưu trong project (`unifiedProjectStore.ts` dòng ~2014, ~2580).

### C. VFX tải lười
9. `useVfxPreview`: chỉ gọi `GET /api/unified/vfx-previews` khi project **có ít nhất một cue**; và chỉ sau khi cảnh đã
   hiện (sau `onReady` của `DirectorStudio` hoặc `requestIdleCallback`), không chặn lần vẽ đầu.
10. Chỉ tải ảnh của các hiệu ứng mà cue đang dùng (không tải cả thư viện sprite).
11. `useVfxEffectLibrary` và `useVfxPreview` dùng chung một promise/cache cho danh sách (gọi tối đa 1 lần mỗi phiên,
    trừ khi người dùng bấm làm mới).
12. Route `[effect]`: thêm `ETag` theo mtime+size (hoặc hash) và `Cache-Control: private, max-age=0, must-revalidate`;
    trả 304 khi khớp. Danh sách giữ `no-store` hoặc dùng ETag tương tự.

## Kiểm (bắt buộc, ghi số trước/sau trong PR)
- Test: cache `characters=1` khử trùng 3 lời gọi đồng thời thành 1 request; sự kiện làm mất hiệu lực gây tải lại đúng 1 lần;
  `character-height` không còn timer (dùng fake timers, 60 s không có request);
  `modelCharacter` lần 2 trả 304 với `If-None-Match`, `libraryCharacterModel` không bị gọi lại khi file không đổi;
  đổi mtime texture → dựng lại; `useVfxPreview` với project không có cue → 0 request VFX.
- Đo trên fixture lớn (≥ 300 pack tổng hợp, project ~16 asset, 2 nhân vật thư viện, 1 cue VFX): mở project, quay lại tab
  (focus), Thư viện → App 2. Ghi thời gian và số request.
- Từ `three-workspace-app/editor`: `pnpm --filter @topview/3d-builder build`, `pnpm typecheck`, `pnpm lint`,
  `pnpm test:evaluate`, suite test của `apps/studio`.
- Đo trên kho thật + Shot 01 thật: NOT_RUN (Claude/người dùng đo trên Windows khi review).

## Ranh giới
- Repo https://github.com/tuantranmarinainter-ops/3appclaude — nhánh gợi ý `codex/b43-app2-speed`, dựa trên `main`.
- Chỉ sửa `three-workspace-app/editor/apps/studio/`. **Không** sửa `packages/retarget`, `packages/builder`
  (không cần cho task này; nếu bắt buộc thì đề xuất trước), không sửa App 3, App 4 (`vfx/`).
- Không đổi golden, không commit binary / kho thật / ảnh preview.
- Giữ hành vi khi thư viện không đọc được: cảnh vẫn mở, VFX hiện nhãn thay thế như hiện tại.
- Báo cáo bằng số đo thật; ghi rõ phần NOT_RUN.
