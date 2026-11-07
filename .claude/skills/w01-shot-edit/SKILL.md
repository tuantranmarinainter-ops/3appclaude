---
name: w01-shot-edit
description: Sửa nội dung một shot App 2 (nhịp động tác, xuất hiện/ẩn nhân vật, prop bám tay, cue VFX, thay model prop, ánh nhìn) trên bản thử rồi áp sang project thật bằng một lệnh. Dùng khi người dùng nói "chỉnh shot", "dời frame", "nhân vật xuất hiện/đáp xuống ở khung…", "thay gậy/prop", "ghi thật", "chuyển sang bản thật", hoặc khi ảnh duyệt và khung 3D App 2 khác nhau.
---

# Sửa shot App 2: bản thử → duyệt → ghi thật

Việc này lặp lại nhiều. Phần tốn thời gian nhất là chuyển từ bản thử sang project thật và kiểm khung 3D. Hãy dùng script, đừng viết lại.

## Ít token (bắt buộc)
- **Mỗi lần sửa một shot = một phiên mới.** Không sửa tiếp trong phiên đã dài (mỗi lượt đọc lại toàn bộ lịch sử).
- **Đọc/sửa/đo bằng MCP `w01-shot`** (`.mcp.json` gốc repo, chi tiết trong `w01-shot-new/SKILL.md` mục "Ít token"),
  không viết curl/Python/JS hay script `.mjs` riêng cho từng lần:
  `shot_read` (clips/keys/cues/cast), `shot_edit` (moveClip/setClip/removeClip/setKeys/addCue/removeCue, một bước hoàn tác, có `dryRun`),
  `shot_undo`, `shot_measure` (floor/height/distance/contact/continuity/gates). `shot` = slug hoặc đường dẫn `shot.json`
  (bản thử từ `sandbox.py` chưa có shot.json: tạo tay với `project`, `api`, `projectsDir`, `library`, `editor`, `work`, `chars`).
- MCP chưa nạp (phiên mở ở checkout không có `.mcp.json`): chạy `node .claude/skills/w01-shot-new/mcp/server.mjs` của một checkout main qua stdio,
  hoặc dùng các script dưới đây. Chỉ viết script riêng khi MCP thiếu thao tác (vd. prop bám tay), và ghi lại để thêm vào MCP.
- `shot_edit setKeys` ghi lớp fcurve, **không** ghi userKeys. Shot có userKeys ở khung đó thì khoá người dùng vẫn đè lên: kiểm bằng `shot_read keys`.

## Quy trình
1. **Bản thử**: skill `w01-test-sandbox` (`sandbox.py all --name <x> … --from-projects <thư mục project thật> --port 31xx`).
   Ghi lại **revision của project thật lúc sao chép** (`project.json → revision`); bước 5 cần số này.
2. **Đọc trước khi sửa** (`references/traps.md`): clip của từng nhân vật, fcurves, **userKeys** (lớp khoá người dùng đè fcurves),
   cue VFX. Kể cho người dùng hiện trạng bằng khung hình (30 khung/giây), hỏi kịch bản nếu chưa rõ.
3. **Sửa bằng lệnh App 2** (có lịch sử), viết script nhỏ trong `<worktree>/work/<chủ đề>/` dùng `scripts/w01api.mjs`:
   `scene.apply` (`document.replace` với scene + fcurves), `library.place`, `motion.place`, `motion.binding.set`, `asset.import`,
   `vfx.cue.add|update|remove`. Cần ma trận xương (prop bám tay): chạy `.mts` bằng tsx, gọi `sampleProjectSkeletonRange`.
4. **Kiểm** cả hai nơi, có số:
   - `python -I scripts/stills.py <id> 0,30,40,72 --out S:/Claude/w01/work/<chủ đề>/<tên>`: ảnh qua camera shot (bỏ qua userKeys!).
   - Khung 3D App 2: `references/viewport-probe.md` (đọc `frameOut` từng khung + ảnh trong "chế độ xem camera").
   Gửi ảnh cho người dùng, nói rõ khung nào làm gì. Không quay video khi chưa có lệnh.
5. **Ghi thật** khi người dùng nói "ghi thật": từ `three-workspace-app/editor` của một worktree đã build builder:
   ```
   pnpm --filter @topview/3d-builder exec tsx S:/Claude/w01/.claude/skills/w01-shot-edit/scripts/apply_to_real.mts \
     --from S:/Claude/w01-samples/<x>-projects --to S:/Claude/w01-samples/tap15v3/projects --project <id> --expect-rev <rev lúc sao chép> --dry-run
   ```
   Xem kế hoạch, bỏ `--dry-run` để ghi (~5 giây, không cần server). Script sao lưu `project.json` vào `S:/Claude/w01/work/backup-real/`,
   từ chối nếu project thật đã đổi sau khi sao chép, rồi so 5 mục (clips, nodes, timeline, fcurves, cues) phải `MATCH`.
   Thư viện mặc định là kho thật (chỉ đọc khi `library.place`). App 2 của người dùng (3016) đang mở shot đó thì nhắc họ tải lại trang.
6. Báo: revision cũ → mới, đường dẫn bản sao lưu, cách hoàn tác (nút "Hoàn tác" trong App 2), điều chưa kiểm (BBS trong game).

## Không làm
- Không ghi project thật trước khi người dùng duyệt. Không gỡ userKeys của người dùng khi chưa nói với họ.
- Không chạy `stills.py` hay server thử trên cổng 3016/3002. `w01api.mjs` từ chối 3016 trừ khi `W01_ALLOW_REAL=1`.
