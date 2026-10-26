# Task B34 (+ B19): gán động tác Mixamo65 cho nhân vật Minecraft20, tự chuyển, không sao chép (2026-10-26)

> Người dùng chốt 2026-10-26 (`docs/BACKLOG-2026-10-25.md` B34, B19). Giao Codex. Subagent dùng model **"sol 6.1" bản nhẹ**.
> Một nhánh + một PR vào `main`, **không tự merge**.

## Vai trò người dùng
Người làm phim Minecraft (BBS FS) một mình, hay điều khiển từ điện thoại. Đen, Hero, Gà, Chi Chi, Người bí ẩn là nhân vật
**Minecraft20** (model Emoticons). Kho có rất nhiều động tác **Mixamo65**. Người dùng muốn bấm "Gán cho Đen · Shot 01" trên một
động tác Mixamo65 là clip chạy ngay trên Đen — **không** sinh thêm động tác mới trong kho mỗi lần gán.

## Hiện trạng (main `01c9f3c`)
- Thư viện (`app/library/page.tsx`, `?assignTo=<nodeId>`) lọc theo nhân vật chỉ hiện động tác đã chuẩn hoá riêng cho Đen
  (ảnh `S:/Claude/w01-samples/ingame-measure-20261026/den-assign-library.png`, ngoài repo).
- `apps/studio/src/libraryCommands.ts` `placeLibraryActionForNode`: thử `library.place`; nếu `PROFILE_MISMATCH` thì
  `copyActionToCharacter` (cùng rig) hoặc `libraryAssign.assignToCharacter` (khác rig, N1b) → **tạo pack/Nháp mới trong kho** rồi mới gán.
- Đường chuyển Mixamo65 ↔ Minecraft20 (retarget) đã hoàn thiện — người dùng xác nhận, **không sửa `packages/retarget`**.
- B19: gán lại động tác đã có bản cũ trong project báo `ASSET_CONFLICT "already belongs to different project content"`.
  Bản sửa chưa merge: nhánh `claude/b19-stale-motion` (commit `dd45cf4`, thay bản cũ nếu không clip nào dùng) — **gộp vào task này**,
  thêm test.

## Yêu cầu
1. **Danh sách gán** cho node rig `minecraft20`: ba nhóm "Của nhân vật này" / "Mixamo65 (tự chuyển)" / "Minecraft20 cùng rig"
   (động tác của nhân vật MC20 khác + kho chung `minecraft20-actions`). Nút gán có ở mọi mục. Tiếng Việt.
2. **Gán Mixamo65 → Minecraft20 không sao chép:** không gọi `copyActionToCharacter`/`assignToCharacter` để tạo pack mới.
   Chuyển bằng retarget có sẵn ngay lúc gán, nạp kết quả vào **project** (asset/motion của project như hiện nay).
   Kho thư viện **không thêm pack/action/Nháp** nào.
3. **Công thức chuyển đổi (JSON) thay cho bản sao:** nếu cần lưu để gọi lại, lưu một file JSON nhỏ (vd trong project
   `extensions` hoặc `library/conversions/<sourceUuid>-<targetCharId>.json`): `sourceActionUuid`, `sourceSha256`,
   `sourceRig`, `targetCharId`, `targetRig`, `targetBaseModelSha256`, phiên bản bộ chuyển (git/hash preset), tham số
   (in-place, ground…). Khi xem trước, mở lại project, mở App 3 hoặc **xuất film BBS**, dựng lại chuyển động từ công thức
   (có thể cache theo khoá nội dung, cache xoá được, không phải dữ liệu gốc). Nguồn đổi hash → báo "Động tác gốc đã đổi —
   chuyển lại?" thay vì âm thầm dùng bản cũ.
4. **Minecraft20 cùng rig** (của nhân vật khác): gán thẳng, không sao chép (cùng 20 xương, rest giống — đã kiểm khi chuyển
   kho sang Emoticons). Không dùng chung uuid gây ASSET_CONFLICT (B19).
5. **Xuất film BBS** của clip đến từ công thức: động tác vào `model.bobj` của Đen như action thường (đường `stageOriginalLibraryBobjProfile`
   / pose tracks hiện có — xem `docs` + `filmManifest.ts`, PR #171/#173: action rỗng `w01_rest` cho Verity, xoay 180° cho
   actor BOBJ gốc, ghép action MC20 khi khung xương trùng). Không làm hỏng các quy tắc đó.
6. Áp cho mọi nhân vật `minecraft20`; Verity/Mixamo giữ hành vi hiện tại trừ B19.

## Kiểm (bắt buộc trước khi đẩy)
- Test: gán 1 động tác Mixamo65 cho node MC20 → project có clip/motion, **số pack trong kho không đổi**; gán lại lần 2 dùng
  lại công thức (không tạo thêm); nguồn đổi hash → báo chuyển lại; B19: xoá clip rồi gán lại động tác đã sửa → thành công,
  còn clip dùng bản cũ → vẫn báo xung đột; gán động tác MC20 của Hero cho Đen → không sao chép.
- `pnpm --filter @topview/3d-builder build`, `pnpm typecheck`, `pnpm lint`, test Studio liên quan, Python `agent.test_unified_cli`.
- Không sửa `packages/retarget`, không đổi golden, không commit binary/kho thật. Kho thật và project thật nằm ngoài repo:
  test bằng fixture tổng hợp; phần kiểm trên kho thật + trong game: NOT_RUN (Claude chạy trên Windows).

## Ranh giới
Repo https://github.com/tuantranmarinainter-ops/3appclaude — nhánh gợi ý `codex/b34-mc20-auto-convert`, dựa trên `main`
và gộp `claude/b19-stale-motion`. Báo cáo bằng số đo thật; ghi rõ phần NOT_RUN.
