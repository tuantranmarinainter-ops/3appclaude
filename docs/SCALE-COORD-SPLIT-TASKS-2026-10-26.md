# Task S1–S3: tỷ lệ nhân vật, toạ độ trong game, mỗi shot một project (2026-10-26)

> Người dùng chốt 2026-10-26: soạn đặc tả **B21, B22, B23** (`docs/BACKLOG-2026-10-25.md`) và giao AI code ngay.
> Subagent dùng model **"sol 6.1" bản nhẹ**. Mỗi task một nhánh + một PR vào `main`, **không tự merge**.

## Vai trò người dùng (đọc trước)
Một người làm phim hoạt hình Minecraft (BBS FS 2.7) một mình, hay điều khiển từ điện thoại. Họ dựng cảnh ở App 2, xuất
film, cài vào game rồi mở Minecraft xem. Họ cần: **nhân vật trong app cao đúng như trong game**; film vào game **nằm đúng
chỗ họ đang đứng, quay đúng hướng họ nhìn**; mỗi shot là một project **nhẹ, dễ chỉnh**. Thông báo bằng tiếng Việt, ngay
chỗ đang bấm.

## Số đo thật (người dùng, 2026-10-26) — dùng làm dữ liệu test
- Ảnh tỷ lệ: `S:\Claude\w01-samples\ingame-measure-20261026\scale-pillar.png` (ngoài repo). Cột gỗ 5 block:
  nhân vật Minecraft20 ≈ **1,8 block**; Chirity (nhóm Verity) ≈ **3,56 block** → tỷ lệ **≈ 2,0**.
- App hiện tại: Đen (MC20, model Emoticons) **2,03 m**; Gỗ Xưa (Verity, Mixamo65) **1,90 m** (1 m = 1 block).
- F3+C: `/execute in minecraft:overworld run tp @s 107.08 -60.00 207.13 -64.47 7.50`
  (chân ở X 107.08, Y −60 = sàn thế giới phẳng, Z 207.13; yaw −64.47°, pitch 7.5°).

## S1 — Tỷ lệ nhân vật đúng như trong game (B21)
**Mục tiêu:** chiều cao nhân vật trong App 2/App 3 = chiều cao trong BBS FS sau khi xuất, đo bằng block.
1. **Tìm nguyên nhân trước khi sửa** — ghi vào `docs/SCALE-REPORT-2026-10-26.md` bằng số:
   - chiều cao mesh nguồn (BOBJ/GLB thư viện, kể cả `BBSFix motion_scale` ở `packages/library/characters.ts`),
   - chiều cao sau khi vào scene App 2 (`stage.worldAabb`), chiều cao trong `model.bobj` đã xuất
     (`assets/models/unified/<id>/`) và scale form/actor ghi trong film `.dat`,
   cho **Đen (MC20)** và **Gỗ Xưa (Verity)** — để biết bước nào làm Verity thấp đi một nửa (normalize, `metersPerUnit`
   khi convert-model ở `apps/studio/src/unifiedJobs.ts`, hay BBS tự scale model).
2. Hồ sơ nhân vật thư viện (`meta.json`) thêm `heightBlocks` (số dương, tuỳ chọn). Mặc định theo rig nếu thiếu:
   `minecraft20` = **1,8**; nhóm Verity = **3,6** (Gỗ Xưa, Tiểu Nhị, Chirity — xem `memory`/hồ sơ nhân vật). Sửa được
   trong trang Thư viện (ô "Chiều cao (block)") qua `PATCH /api/library` operation `profile` hoặc operation mới.
3. App 2/App 3 hiển thị nhân vật đúng `heightBlocks` (scale đều cả mesh + xương + root motion, không làm trượt chân).
   Xuất film: model/actor trong BBS **cùng hệ số** → chiều cao trong game = `heightBlocks` (sai số ≤ 2%).
   Đổi `heightBlocks` sau khi đã có trong project: phải báo "Nhân vật đã đổi chiều cao — cập nhật trong cảnh?" và chỉ
   cập nhật khi người dùng đồng ý (không âm thầm đổi project).
4. Lưới sàn App 2 có vạch theo block (1 m = 1 block) và nhãn chiều cao khi chọn nhân vật ("Đen · 1,8 block").
5. Test: Đen ra 1,8 ± 0,04; Gỗ Xưa ra 3,6 ± 0,07 trong scene **và** trong `model.bobj` + scale xuất; Mixamo Samba giữ
   SHA `68fcdb75d373…` (không đụng retarget). Film đo: Đen + Gỗ Xưa T-pose cạnh cột 5 block (prop) để Claude kiểm trong
   game (gate in-game NOT_RUN).

## S2 — Đặt film đúng chỗ người chơi đứng, đúng hướng nhìn (B22)
Hiện có: `apps/studio/src/filmWorldAnchor.ts` (B15) chỉ **dời** (`destination`, mặc định 0,64,0), không xoay, gõ tay.
1. Hàm `parseMinecraftTp(text)` nhận dòng F3+C (`/execute in <dim> run tp @s X Y Z yaw pitch`, cả dạng `/tp @s X Y Z
   yaw pitch`, dấu phẩy/chấm, khoảng trắng thừa) → `{ dimension, x, y, z, yaw, pitch }`; sai dạng → lỗi tiếng Việt.
2. `FilmWorldAnchor` thêm `yawDegrees` (tuỳ chọn) và `pivot` (điểm gốc trong cảnh): xoay **mọi** actor, camera, hiệu
   ứng, hậu cảnh quanh trục Y tại `pivot` sao cho hướng "trước" của cảnh (+Z app) trùng hướng nhìn người chơi
   (quy ước Minecraft: yaw 0 = +Z, yaw −90 = +X), rồi dời `pivot` tới (X, Y, Z). Yaw của actor/camera cộng thêm đúng
   góc đó. Pitch bỏ qua. Tuỳ chọn "Làm tròn về giữa block" (X, Z → n + 0,5; Y → số nguyên).
3. `pivot` chọn được: chân một nhân vật trong shot (mặc định nhân vật đầu tiên), gốc cảnh, hoặc mốc đặt tay trong cảnh.
4. UI bảng Xuất film: ô **"Dán vị trí từ game (F3+C)"** + hướng dẫn 1 dòng ("Trong game đứng đúng chỗ, nhìn về phía
   trước của cảnh, bấm F3+C rồi dán vào đây"); hiện X/Y/Z/hướng đã đọc. Nhớ vị trí theo **địa điểm** (tên do người dùng
   đặt, vd "Lâu đài") trong project; shot khác chọn lại từ danh sách.
5. Preflight hiện: "Cảnh sẽ nằm từ X…X, Y…Y, Z…Z; nhân vật gần nhất cách chỗ anh/chị đứng N block"; cảnh báo nếu có
   actor dưới sàn (Y < Y đứng − 1) hoặc xa > 64 block.
6. Test: dòng mẫu ở trên → pivot ra đúng (107.08, −60, 207.13); điểm (0,0,1) cách pivot 1 m về +Z app ra hướng
   (sin 64.47°, 0, cos 64.47°) ≈ (0.902, 0, 0.431) so với chân; camera yaw cộng −64.47°; series nhiều đoạn dùng chung
   một anchor; anchor cũ chỉ có `destination` vẫn chạy như trước.

## S3 — Mỗi shot một project (B23)
Tập 15 (`tap15v3`) đang là 1 project ~500 MB, 20 shot, 31 nút nhân vật → nặng, khó chỉnh.
1. Lệnh store mới `project.splitShots` (+ nút App 2 "Tách shot thành project", + CLI/MCP Python): với mỗi shot được
   chọn (mặc định tất cả) tạo **project mới** chứa đúng: nút nhân vật/đạo cụ/hậu cảnh/camera của shot (theo khoảng khung
   của shot và nút có clip/hiện trong khoảng đó, hậu cảnh `set_NN` gắn shot), clip động tác, keyframe/fcurve, cue âm
   thanh và VFX trong khoảng; **dời khung về 0**; giữ liên kết thư viện (`modelUrl`/fingerprint), asset dùng chung không
   chép thừa (content-addressed). Tên: "Tập 15 · Shot 01".
2. **Project gốc không đổi** (chỉ đọc). Kết quả ghi báo cáo: mỗi project mới — số nút, số clip, dung lượng, khung.
3. Nhóm "tập": danh sách project shot có thứ tự (metadata nhẹ, vd `episode: { name: 'Tập 15', order: 1 }`); trang
   chọn project hiện theo nhóm; xuất cả tập (series) từ nhóm theo thứ tự, điểm nối đúng lưới 20 tick (bội 3 khung ở 30 fps).
4. Test: project giả 3 shot (nhân vật dùng chung giữa 2 shot, 1 clip vắt qua ranh giới shot → cắt theo khoảng và cảnh
   báo), kiểm nội dung từng project mới, khung về 0, project gốc giữ nguyên byte, asset không nhân đôi. Chạy thử trên
   **bản sao** Tập 15 (không bao giờ ghi vào `S:\Claude\w01-samples\tap15v3`) — phần này Claude chạy trên Windows.

## Ranh giới
- Repo: https://github.com/tuantranmarinainter-ops/3appclaude — nhánh gợi ý `ai/s1-character-scale`,
  `ai/s2-film-anchor-yaw`, `ai/s3-split-shots`; S1 có thể chạm `packages/library` + `apps/studio`; S2/S3 chỉ `apps/studio`
  + `agent/` Python; không sửa `packages/retarget` (trừ khi report S1 chứng minh lỗi nằm ở đó — khi ấy dừng lại báo
  trước), không đổi golden, không commit binary.
- Trước khi đẩy (từ `three-workspace-app/editor`): `pnpm --filter @topview/3d-builder build`, `pnpm typecheck`, test
  Studio liên quan; Python `python -m unittest agent.test_unified_cli agent.test_unified_mcp`.
- Báo số đo thật; gate trong game = NOT_RUN cho tới khi Claude kiểm trên máy người dùng.
