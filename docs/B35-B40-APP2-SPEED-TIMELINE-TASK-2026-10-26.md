# Task B35–B40: App 2 nhanh hơn + timeline clip (copy, cùng động tác, tốc độ chậm) (2026-10-26)

> Người dùng giao 2026-10-26. Giao Codex. Subagent dùng model **"sol 6.1" bản nhẹ**.
> Một nhánh + một PR vào `main`, **không tự merge**. Task này **thay Phần 2** của `docs/B34-MC20-AUTO-CONVERT-TASK-2026-10-26.md`.
> Chi tiết lỗi + số đo: `docs/BACKLOG-2026-10-25.md` mục B35–B40.

## Vai trò người dùng
Người làm phim Minecraft một mình, hay điều khiển từ điện thoại. Họ đi App 2 → Thư viện → App 2, App 2 → App 3 → App 2,
bấm Ctrl+Z liên tục khi xếp cảnh. Hiện mỗi bước chờ vài giây đến ~9 s. Họ cần nhân bản clip trên timeline, đặt hai lần
cùng một động tác, và làm chậm động tác (0,1x–0,5x).

## Số đo hiện trạng (Claude đo trên server thử, Shot 01 bản sao, kho thật 368 pack)
| Thao tác | Hiện tại |
| --- | --- |
| `searchLibrary` / `getAction` / `listLibraryCharacters` / `resolveCharacter` (mỗi lần) | ~230 ms (gọi `writeIndex`: đọc 368 `meta.json` + ghi `index.json` 784 KB) |
| `rawActions` (`/api/library?raw=1`) | 1,9 s |
| `/api/library?characters=1` (`listLibraryCharacterDetails`, băm sha256 mọi texture) | 2,1 s |
| Mở project Shot 01 (các request chạy cùng lúc, Node một luồng) | ~9 s (file tĩnh 3 KB cũng chờ 8,7 s) |
| `GET /api/unified/projects/<id>` khi server rảnh | 30 ms |
| Ctrl+Z | tải project 2 lần + `setEditorKey(+1)` → remount editor, nạp lại mọi GLB |

## Yêu cầu
### A. Tốc độ (B35, B39)
1. **Thư viện không ghi khi đọc** (`packages/library/store.ts`, `library.ts`, `characters.ts`): cache index trong bộ nhớ,
   làm mới khi mtime/danh sách `packs/`, `characters/`, `models/` đổi hoặc sau thao tác ghi của chính process. Đọc **không**
   ghi `index.json` (kho thật chỉ đọc khi xem). Giữ tương thích CLI/MCP và test hiện có.
2. **`?characters=1`**: không băm texture mỗi lần (cache theo đường dẫn + mtime + size, hoặc dùng sha trong meta);
   `character-height/index.tsx` bỏ `setInterval` 15 s và gọi theo `focus`; chỉ gọi khi mở project / đổi hồ sơ nhân vật,
   cache theo fingerprint. (B26)
3. **Ctrl+Z / Redo** (`apps/studio/app/workbench/components/StudioOverlay.tsx` `runHistory`): không remount editor;
   một lần tải project, áp document mới vào store hiện tại; model/GLB đã nạp dùng lại theo hash.
4. **Quay về từ Thư viện / App 3**: chỉ nạp motion/clip mới; model đã có trong bộ nhớ hoặc cache trình duyệt không tải lại.
5. **Asset theo hash** (`app/api/unified/projects/[id]/assets/[assetId]/[variant]/route.ts` và tương tự): `Cache-Control:
   private, max-age=31536000, immutable` + `ETag` (hash), trả 304 khi `If-None-Match` khớp.
6. **Gán động tác** (`placeLibraryActionForNode`): kiểm khung trống **trước** khi chuyển động tác (hiện chuyển xong ~1,6 s mới báo trùng khung).

### B. Timeline clip (B36, B37, B38)
7. **Copy clip (B36)** — `packages/builder/src/components/timeline/`: Ctrl+kéo (Alt+kéo trên máy Mac) = nhân bản tại khung thả;
   chuột phải clip: **Sao chép / Dán tại đầu phát / Nhân bản / Xoá** (tiếng Việt); Ctrl+C / Ctrl+V khi timeline có focus.
   Bản sao là clip mới **cùng motion** (không thêm asset/pack/motion), giữ playback (tốc độ, lặp). Undo được.
8. **Hai clip cùng động tác (B37)** — `packages/builder/src/engine/objects/MotionPlayer.ts` `playAt`: `mixer.clipAction(filtered)`
   trả về cùng một `AnimationAction` cho mọi clip cùng motion → mỗi clip timeline phải có action riêng (vd clip đã lọc
   riêng theo `clipId`), dừng/uncache không ảnh hưởng clip kia. Test: 2 clip cùng motion ở 0–29 và 60–89 → khung 15 và 75
   cùng tư thế (so quaternion xương ≤ 0,1°), và phát liên tục qua cả hai.
9. **Tốc độ chậm (B38)** — `packages/builder/src/components/inspector/MotionClipConfigEditor.tsx` (`MOTION_SPEEDS = [1, 2, 3]`):
   nút nhanh **0,1 · 0,25 · 0,5 · 1 · 2** + **ô nhập số** 0,01–16 (bước 0,05). Độ dài clip trên timeline đổi theo tốc độ như hiện nay;
   xuất film BBS đúng tốc độ (kiểm `filmManifest`/pose tracks với clip 0,25x).

### C. Project phình (B40)
10. Xoá clip / gán đè: motion + asset + công thức `libraryMotionConversions` không clip nào dùng thì dọn khi lưu (hoặc nút
    "Dọn tài nguyên thừa" trong App 2, có xác nhận). Không xoá thứ còn được Undo cần — dọn theo lịch sử hoặc chỉ khi người dùng bấm.

## Kiểm (bắt buộc, ghi số trước/sau trong PR)
- Test đơn vị/tích hợp cho từng mục: index không ghi khi đọc; cache bị làm mới khi thêm pack; `?characters=1` lần 2 < 100 ms;
  asset trả 304; Ctrl+Z không remount (đếm số lần tạo editor / số request asset = 0); copy/paste/nhân bản clip; 2 clip cùng
  motion; tốc độ 0,25 qua xuất film; dọn motion thừa.
- Mục tiêu đo trên fixture lớn (≥ 300 pack tổng hợp, project ~16 asset): `searchLibrary` < 20 ms (lần 2), mở project < 2 s,
  Thư viện → App 2 < 1,5 s, Ctrl+Z < 0,3 s.
- `pnpm --filter @topview/3d-builder build`, `pnpm typecheck`, `pnpm lint`, `pnpm test:all` (hoặc các suite builder, library, studio, Python).
- Không sửa `packages/retarget`, không đổi golden, không commit binary / kho thật. Phần đo trên kho thật + Shot 01 thật: NOT_RUN
  (Claude đo trên Windows khi check hub).

## Ranh giới
Repo https://github.com/tuantranmarinainter-ops/3appclaude — nhánh gợi ý `codex/b35-app2-speed-timeline`, dựa trên `main`.
PR #174 (B34, nhánh `codex/b34-mc20-auto-convert`) **chưa merge** và cũng sửa `apps/studio/src/libraryCommands.ts`, `app/library/page.tsx`:
tránh đổi lớn hai file đó; nếu bắt buộc, giữ thay đổi nhỏ để dễ gộp. Báo cáo bằng số đo thật; ghi rõ phần NOT_RUN.
