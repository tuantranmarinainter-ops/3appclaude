# Task App 3: bổ sung tính năng kiểu Blockbench (2026-10-31)

> Người dùng giao 2026-10-31, **cho phép sửa App 3** (Animation Studio). Giao Codex.
> **4 gói = 4 nhánh + 4 PR** vào `main`, làm theo thứ tự, **không tự merge**.
> Phần hiệu ứng (particle/sound) **không** thuộc task này: hiệu ứng đi qua App 4 + làn VFX của App 2.

## Bối cảnh
So sánh App 3 với chế độ Animate của Blockbench (Claude, 2026-10-31): App 3 đã hơn Blockbench ở IK, easing, onion skin,
làm mượt, copy pose, co giãn nhóm key. App 3 còn thiếu: tiện ích timeline, biểu thức Molang, xuất/nhập animation
Bedrock JSON, Animation Controller.

## Bản quyền (bắt buộc đọc)
- Repo này là **Apache-2.0**. Blockbench là **GPL-3.0** → **không chép, không dịch lại mã Blockbench**. Chỉ học hành vi
  từ giao diện và làm theo **đặc tả định dạng công khai** (tài liệu Minecraft Bedrock của Microsoft: animation,
  animation controller, Molang).
- Thư viện Molang bên ngoài (vd MolangJS): kiểm `LICENSE` trước. Chỉ dùng nếu MIT/Apache/BSD; chép vào `vendor/` kèm
  file LICENSE + PROVENANCE như các vendor hiện có (`animation-studio/vendor/*_PROVENANCE*`). Nếu không chắc → tự viết
  bộ đánh giá nhỏ.

## Mã liên quan (đã đọc trên `main`)
Thư mục: `three-workspace-app/animation-studio/work/material_alpha_v1_31_8/src/`
- `core.js`: `newProject` (một project = **một** animation: `duration`, `fps` ∈ {24,30,60,120}, `keys[boneId]`,
  `ikModes`, `loop: [a, b]`), `validateProject`, `addKey`, `sampleKeys`/`sampleLegacy` (nội suy: `interp` gồm
  `step`, spline, `ease:*`), `evaluate`.
- `graph_curves.js` (`types = linear, step, auto, smooth, spline`), `easing.js`, `keyframe_time.js`.
- `app.js`: `drawTimeline`, `syncTime`, `playbackRange`, `keyOperation`, `writeKeys`, menu chuột phải keyframe
  (`closeTimelineKeyMenu`), `setupPoseContextMenu`; `index.html` có `#loop`, `#loopA`, `#loopB`, `#copyKey`.
- `motion_lab.js` / `motion_panel.js`: danh sách clip, tốc độ, marker.
- Xuất: `animation_export.js` (`bvh`, `fbx`), `minecraft20_export.js`, `bobj_export.js`.
- Test: `src/*.test.mjs` (`node --test`). Nhiều test cần bản build `animation-studio/outputs/Animation_Studio_v1_33_0.html`
  (chạy `node work/material_alpha_v1_31_8/src/build.mjs` từ `animation-studio/`) và gói `three`.

**Trước khi bắt đầu:** nhánh `app3-prettier` (chỉ định dạng lại `src/` bằng Prettier, giữ CRLF) nên được merge trước.
Nếu chưa merge, dựa nhánh mới trên `app3-prettier` để tránh xung đột toàn file.

## Quy tắc chung cho cả 4 gói
- Tương thích ngược: project cũ (`version: 1`) mở được y như trước; trường mới đều **tuỳ chọn**, có giá trị mặc định.
  Nếu phải đổi cấu trúc thì nâng `version` và viết hàm chuyển đổi + test.
- Giao diện **tiếng Việt**, theo phong cách hiện có. Mọi thao tác mới **Hoàn tác/Làm lại** được.
- Không làm hỏng: xuất Minecraft20/`.bobj`/GLB/FBX/BVH, cầu nối App 2 (`host_bridge.js`, `studio_bridge.js`).
- File mới tách theo chức năng (như `easing.js`, `onion_skin.js`), không dồn thêm vào `app.js` nếu tránh được.

## Gói 1 — Tiện ích timeline (nhánh `codex/app3-bb-timeline`)
1. **Nhảy keyframe trước / sau**: 2 nút cạnh Play + phím tắt (gợi ý `,` và `.`); nhảy theo key của xương đang chọn,
   không chọn xương thì theo mọi key.
2. **Tô màu keyframe**: chuột phải key → chọn 1 trong ~8 màu hoặc "Bỏ màu"; lưu trong key (`color`), vẽ trên timeline,
   áp cho nhiều key đang chọn.
3. **Chế độ phát**: `Một lần` / `Lặp` / `Giữ khung cuối` (thay checkbox `#loop`, giữ vùng lặp A–B). Lưu `project.playMode`;
   project cũ: `loop` bật → `Lặp`.
4. **Start delay / Loop delay** (giây): chờ trước khi bắt đầu, chờ giữa các vòng lặp; chỉ ảnh hưởng xem trước và xuất
   định dạng hỗ trợ (Bedrock JSON ở gói 3); xuất khác bỏ qua + ghi chú.
- Test: nhảy key đúng thứ tự (kể cả key cùng thời điểm), màu lưu/đọc lại, 3 chế độ phát cho đúng thời gian mẫu tại
  t = 0, giữa, sau cuối.

## Gói 2 — Biểu thức Molang (nhánh `codex/app3-bb-molang`)
5. Ô giá trị của keyframe (rotation/position/scale từng trục) nhận **số hoặc biểu thức** (vd `math.sin(q.anim_time*360)*15`).
   Lưu biểu thức dạng chuỗi bên cạnh giá trị số (giá trị số = kết quả tại thời điểm key, dùng khi xuất không hỗ trợ).
6. Hỗ trợ tối thiểu: số, `+ - * /`, ngoặc, so sánh, `?:`, `math.*` (sin, cos theo **độ**, abs, clamp, lerp, min, max,
   random có seed cố định để xem trước ổn định), `query.anim_time` / `q.anim_time`, `query.life_time`,
   biến `variable.*` / `v.*`.
7. **Biến giữ chỗ**: bảng nhỏ khai báo `v.ten = giá trị` (có thanh trượt) để xem trước.
8. Biểu thức lỗi: không crash, ô báo đỏ + thông báo tiếng Việt, dùng giá trị số cũ.
9. **Bake**: lệnh "Chuyển biểu thức thành keyframe" theo fps project (cho xuất Minecraft20/`.bobj`/GLB không hiểu Molang).
- Test: bộ đánh giá (độ ưu tiên toán tử, độ/radian, lỗi cú pháp), key có biểu thức cho đúng giá trị tại 3 thời điểm,
  bake ra số key = `duration*fps+1` và khớp giá trị.

## Gói 3 — Xuất / nhập Bedrock animation JSON (nhánh `codex/app3-bb-bedrock-json`)
10. **Xuất** `*.animation.json` (`format_version` "1.8.0"): một animation gồm `loop` (true / "hold_on_last_frame" / false
    theo gói 1), `animation_length`, `start_delay`/`loop_delay`, `bones.<tên>.rotation/position/scale` với keyframe theo
    giây; biểu thức Molang (gói 2) xuất nguyên chuỗi; nội suy: linear → mặc định, step → giữ giá trị, spline/smooth →
    `lerp_mode: "catmullrom"`, easing không có trong Bedrock → **bake** thành key dày + cảnh báo.
11. Quy đổi trục/đơn vị: Bedrock dùng độ, đơn vị pixel (1/16 block), quy ước xoay Euler riêng; viết hàm quy đổi tập trung
    một chỗ + test hai chiều. Tên xương lấy từ rig (bỏ tiền tố `mixamorig`).
12. **Nhập**: đọc file `*.animation.json`, chọn animation trong file, ghép xương theo tên (không khớp → liệt kê để người
    dùng chọn hoặc bỏ qua), tạo key; giữ biểu thức Molang nếu có.
13. Kiểm khứ hồi: xuất → nhập lại → so key (sai số ≤ 1e-4 độ / 1e-4 đơn vị).
- Fixture: tự tạo file JSON nhỏ trong test (không commit file của bên thứ ba).
- Mở thử file xuất trong Blockbench (bản web) với model khớp tên xương: NOT_RUN được, ghi rõ trong PR.

## Gói 4 — Animation Controller (nhánh `codex/app3-bb-controller`)
14. **Nhiều animation trong một project** (điều kiện cần): danh sách animation (idle, walk, attack…) mỗi cái có
    `duration`/`keys`/`playMode` riêng; project cũ = 1 animation. Nâng `version` + chuyển đổi + test. Đây là thay đổi lớn
    nhất: **đề xuất cấu trúc trong PR mô tả trước khi code nặng** nếu cần đổi cầu nối App 2.
15. **Controller**: danh sách trạng thái; mỗi trạng thái phát 1+ animation (có trọng số), có điều kiện chuyển sang trạng thái
    khác bằng biểu thức Molang (gói 2), thời gian chuyển mềm (`blend_transition`).
16. Giao diện: sơ đồ đơn giản (khối trạng thái + mũi tên) hoặc bảng; ô biến giữ chỗ để thử (vd đổi `v.is_moving` 0 → 1
    thấy chuyển idle → walk trong khung 3D).
17. Xuất `*.animation_controllers.json` (Bedrock, `format_version` "1.10.0") cùng file animation của gói 3.
- Test: chuyển trạng thái đúng theo biến, blend trong khoảng thời gian, xuất JSON đúng cấu trúc.

## Kiểm mỗi PR (ghi kết quả trong mô tả PR)
- `node --test` toàn bộ `src/*.test.mjs` (sau khi build bản HTML), liệt kê pass/fail/skip trước và sau.
- Build `animation-studio` thành công; mở bản HTML trong trình duyệt làm đủ thao tác mới (ảnh chụp hoặc GIF).
- Project cũ mẫu mở được, xuất Minecraft20 không đổi byte (hoặc giải thích chênh lệch).
- Phần không chạy được ghi NOT_RUN.

## Ranh giới
- Repo https://github.com/tuantranmarinainter-ops/3appclaude, dựa trên `main` (hoặc `app3-prettier` nếu chưa merge).
- Chỉ sửa `three-workspace-app/animation-studio/`. Không sửa App 2 (`editor/`), App 4 (`vfx/`), `packages/retarget`.
  Cập nhật bản nhúng trong `editor/apps/studio/public/animation-studio/` là **việc riêng sau khi merge**, không làm trong task này.
- Không chép mã Blockbench (GPL-3.0). Không commit binary, model, hay file của bên thứ ba.
- Báo cáo bằng tiếng Việt.
