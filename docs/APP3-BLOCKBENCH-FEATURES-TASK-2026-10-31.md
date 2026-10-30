# Task App 3: bổ sung tính năng kiểu Blockbench (2026-10-31)

> Người dùng giao 2026-10-31, **cho phép sửa App 3** (Animation Studio). Giao Codex.
> **6 gói = 6 nhánh + 6 PR** vào `main`, thứ tự **1 → 5 → 6 → 2 → 3 → 4**, **không tự merge**.
> Phần hiệu ứng (particle/sound) **không** thuộc task này: hiệu ứng đi qua App 4 + làn VFX của App 2.

## Bối cảnh
So sánh App 3 với chế độ Animate của Blockbench (Claude, 2026-10-31): App 3 đã hơn Blockbench ở IK, easing, onion skin,
làm mượt, copy pose, co giãn nhóm key. App 3 còn thiếu: tiện ích timeline, biểu thức Molang, xuất/nhập animation
Bedrock JSON, Animation Controller.

## Bản quyền (bắt buộc đọc)
Người dùng chốt 2026-10-31 (`docs/DECISIONS.md`): **được chép / chuyển thể mã Blockbench** (GPL-3.0,
https://github.com/JannisX11/blockbench) vào App 3. Hệ quả: **App 3 (`three-workspace-app/animation-studio/`) chuyển sang
GPL-3.0**. Phần còn lại của repo (App 1, App 2, App 4, thư viện) **giữ Apache-2.0**. Bắt buộc:
- Gói 1 (PR đầu tiên) làm luôn việc đổi giấy phép App 3: thêm `animation-studio/LICENSE` (toàn văn GPL-3.0),
  `animation-studio/NOTICE` ghi "App 3 phân phối theo GPL-3.0; gồm mã chuyển thể từ Blockbench © JannisX11 và cộng sự,
  GPL-3.0"; sửa `animation-studio/README.md`; thêm một dòng vào `three-workspace-app/NOTICE` rằng thư mục
  `animation-studio/` theo GPL-3.0, không theo Apache-2.0.
- Mã chép/chuyển thể đặt trong file riêng, đầu file ghi: nguồn (đường dẫn file + commit Blockbench), bản quyền gốc,
  `SPDX-License-Identifier: GPL-3.0-or-later` (đúng theo giấy phép của Blockbench tại commit đó), và mô tả đã sửa gì.
  Giữ nguyên mọi thông báo bản quyền có sẵn trong đoạn mã gốc.
- Lập `animation-studio/vendor/BLOCKBENCH_PROVENANCE.md`: bảng file App 3 ↔ file/commit Blockbench nguồn.
- **Không** chép mã Blockbench sang App 2 (`editor/`), App 4, `packages/*` — các phần đó vẫn Apache-2.0.
- App 2 chỉ nhúng bản build App 3 qua iframe (`public/animation-studio/`), giao tiếp qua `postMessage`; giữ đúng kiểu tách
  rời này, **không** import mã App 3 vào bundle App 2. Bản nhúng phải kèm `LICENSE` GPL-3.0 bên cạnh `index.html`
  (việc cập nhật bản nhúng vẫn làm riêng sau khi merge).
- Blockbench dùng Vue 2, jQuery và biến toàn cục: chỉ lấy phần logic (Molang, codec Bedrock, controller, nội suy),
  viết lại phần giao diện theo App 3; không kéo Vue/jQuery vào App 3.
- Thư viện Molang riêng (vd MolangJS) vẫn ưu tiên nếu giấy phép MIT/Apache/BSD; chép vào `vendor/` kèm LICENSE +
  PROVENANCE như các vendor hiện có.

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

## Quy tắc chung cho cả 6 gói
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

## Gói 5 — Bố cục giao diện kiểu Blockbench, giữ bố cục cũ trong ⚙ (nhánh `codex/app3-bb-layout`)
> Người dùng thêm 2026-10-31: "Mức 1" = học **phong cách bố cục** của Blockbench, vẫn dùng HTML/JS hiện có của App 3,
> **không** chuyển sang Vue/jQuery. Làm **ngay sau Gói 1** (trước Gói 2–4) để các gói sau đặt panel mới vào bố cục mới.

Mục tiêu: người quen Blockbench dùng App 3 ngay; màn hình bớt rối (hiện ~120 nút, ~140 ô nhập, 30+ panel cùng lúc);
**giữ nguyên mọi công cụ riêng** của App 3 (thanh quy trình, IK, thư viện pose, onion skin, so sánh, silhouette…).

18. **Tuỳ chọn trong ⚙ Cài đặt** (`#settingsBtn` → `dialog#settings`): mục mới **"Giao diện"** với lựa chọn
    - `Bố cục theo chế độ` (mới, mặc định cho người dùng mới),
    - `Bố cục cổ điển` (giao diện hiện tại, **giữ nguyên 100%** như trước Gói 5).
    Lưu trong `localStorage['animation-studio-settings']` (cùng chỗ cài đặt khác, đọc/ghi trong try/catch). Đổi lựa chọn
    **áp dụng ngay, không mất dữ liệu đang sửa, không tải lại trang**; người dùng cũ đã có bố cục lưu
    (`animation-studio-layout-v2`) thì mặc định vẫn là `Bố cục cổ điển`. Lưu preset cài đặt (`#saveSettingsPreset`) mang theo lựa chọn này.
19. **Bố cục theo chế độ**:
    - Hàng **tab chế độ** trên cùng: `Pose` · `Animate` · `Xuất` (thêm `So sánh` nếu đang dùng `#compareWorkspace`).
      Mỗi tab chỉ hiện panel liên quan; thanh quy trình hiện có (`#workflowSteps`) nối với tab (chọn bước → sang tab tương ứng).
    - **Panel hai bên** kiểu thanh bên: trái = cây xương/điều khiển (`#controlTree`), thư viện pose, thông tin project;
      phải = transform, IK, tuỳ chọn tay/chân; dưới = timeline + Graph Editor. Panel thu gọn/mở được, kéo rộng hẹp được
      (dùng lại cơ chế kéo giãn hiện có), nhớ trạng thái theo từng tab.
    - **Thanh công cụ chính** trên khung 3D: chỉ các công cụ của tab hiện tại (vd Animate: chọn, xoay, dời, pivot, nhảy key,
      play), menu "…" chứa phần còn lại.
    - **Theme tối** mặc định cho bố cục mới, màu định nghĩa bằng biến CSS (một chỗ), đủ tương phản; bố cục cổ điển giữ màu cũ.
20. **Phím tắt chế độ**: `Ctrl+1/2/3` đổi tab; hiện phím tắt trong tooltip. Không đổi phím tắt đang có.
21. **Màn hình nhỏ** (≤ 1024 px, máy tính bảng): bố cục mới thu panel thành ngăn kéo; nếu đủ dùng cho xem + chỉnh keyframe
    cơ bản thì chỉ hiện `#pcOnlyNotice` khi màn hình quá nhỏ cho thao tác đó, kèm nút "Vẫn mở". Bố cục cổ điển giữ như cũ.
22. **Không** dùng tên, logo, biểu tượng thương hiệu hay ảnh chụp giao diện của Blockbench trong App 3. Có thể chuyển thể
    CSS/bố cục từ mã Blockbench theo mục **Bản quyền** (ghi nguồn, SPDX, PROVENANCE). Icon: dùng bộ icon App 3 đang có hoặc
    bộ có giấy phép MIT/Apache (ghi vào `vendor/`).
23. Cấu trúc mã: phần bố cục mới đặt trong file riêng (vd `src/layout_modes.js` + `src/layout_modes.css`), bật/tắt bằng
    một lớp CSS trên `<body>` (vd `layout-modes` / `layout-classic`); **không nhân đôi** panel — cùng một phần tử DOM được
    sắp xếp lại theo bố cục, để mọi tính năng chạy giống nhau ở cả hai bố cục.
- Test: đổi qua lại 2 bố cục 10 lần giữa lúc đang sửa (project không đổi, undo/redo còn nguyên); lựa chọn được nhớ sau
  tải lại; người dùng cũ mặc định cổ điển; mỗi tab chỉ hiện đúng panel; `Ctrl+1/2/3`; bố cục cổ điển so ảnh chụp trước/sau
  Gói 5 không khác (ảnh chụp ở cùng kích thước cửa sổ).
- Ảnh chụp hoặc GIF cả hai bố cục ở 1920×1080 và 1024×768 đưa vào mô tả PR.

## Gói 6 — Hệ thống phím tắt tuỳ chỉnh (nhánh `codex/app3-bb-keymap`)
> Người dùng thêm 2026-10-31. Làm **ngay sau Gói 5** (trước Gói 2–4) để các gói sau đăng ký hành động vào hệ thống này.

Hiện trạng: phím tắt viết cứng, rải trong ~9 file (`app.js`, `workspace_ui.js`, `motion_panel.js`, `graph_editor.js`,
`viewport_toolbar.js`, `easing_panel.js`, `smoothing_panel.js`…, kiểm `e.key === 'Escape' | 'Home' | 'End' | 'Delete' |`
mũi tên, `e.code === 'Space'`…), không xem hay đổi được; bảng `#mouseSettings` chỉ có khoảng cách focus, lưới, trục.

24. **Sổ đăng ký hành động** (file mới vd `src/keymap.js`): mỗi hành động có `id` cố định (vd `timeline.play`,
    `key.delete`, `key.next`, `mode.animate`), tên tiếng Việt, nhóm (Timeline, Keyframe, Pose, Khung 3D, Chế độ, Tệp…),
    phím mặc định, phạm vi (toàn cục / timeline / khung 3D / Graph Editor). **Chuyển toàn bộ phím tắt hiện có** vào đây;
    hành vi mặc định giữ nguyên như trước Gói 6. Gói 1, 5 và các gói sau đăng ký hành động mới qua sổ này.
25. **Xử lý phím tập trung**: một bộ lắng nghe duy nhất định tuyến theo phạm vi đang focus; **không** kích hoạt khi đang gõ
    trong ô nhập/ô biểu thức (trừ `Escape`/`Enter` theo ngữ cảnh); hỗ trợ tổ hợp `Ctrl/Alt/Shift/Meta` (Mac: `Cmd`).
26. **Bảng "Phím tắt" trong ⚙ Cài đặt**: liệt kê theo nhóm, có ô tìm kiếm (theo tên hành động hoặc theo phím); bấm một dòng
    → "Nhấn tổ hợp phím mới" → gán; mỗi hành động tối đa 2 phím; nút "Xoá phím", "Về mặc định" (từng dòng và toàn bộ).
27. **Báo trùng**: gán phím đã dùng trong cùng phạm vi → cảnh báo, cho chọn "Thay thế" (bỏ phím ở hành động cũ) hoặc "Huỷ".
28. **Bộ phím có sẵn (preset)**: `App 3 (mặc định)`, `Kiểu Blockbench`, `Kiểu Blender`, `Kiểu Maya`, `Kiểu Cinema 4D`;
    chọn preset rồi vẫn sửa được từng phím (lưu thành "Tuỳ chỉnh").
    - **Nguồn preset Blockbench** (GPL-3.0, theo mục **Bản quyền**): commit `ec0b282` của Blockbench — phím mặc định khai báo
      trong `keybind: new Keybind({...})` của từng `Action`/`Tool` (`js/animations/*.js`, `js/interface/*.ts`, `js/undo.js`,
      `js/copy_paste.js`, `js/preview/preview.ts`…) và 3 bộ `keymaps/blender.bbkeymap`, `maya.bbkeymap`, `cinema4d.bbkeymap`.
      Viết script nhỏ trích tự động từ mã nguồn ra `src/keymaps/blockbench*.json` (ghi commit, SPDX, PROVENANCE) thay vì gõ tay.
    - Chỉ ánh xạ hành động **App 3 có tương đương**; hành động Blockbench không có (UV, vẽ texture, lưới mesh…) bỏ qua và liệt
      kê trong PROVENANCE.
    - **Trùng phím (người dùng chốt 2026-10-31): mặc định ưu tiên App 3.** Khi chọn `Kiểu Blockbench` (hoặc Blender/Maya/
      Cinema 4D) mà phím của preset đang được một hành động App 3 dùng (kể cả hành động riêng của App 3 không có trong
      Blockbench), **hành động App 3 giữ phím đó**; hành động bên preset bị trùng chuyển sang phím trống gần nhất hoặc để
      trống, và được đánh dấu "trùng" trong bảng Phím tắt.
    - **Tuỳ chọn trong ⚙ Cài đặt → Phím tắt**: "Khi trùng phím, ưu tiên: `App 3` (mặc định) / `Bộ phím đã chọn`". Đổi lựa
      chọn áp dụng ngay và tính lại toàn bộ bảng; người dùng vẫn gán tay từng phím được, phím gán tay luôn thắng cả hai.
      Lưu cùng bộ phím (localStorage + xuất/nhập `.json`).
    - Bảng Phím tắt có bộ lọc "Chỉ hiện phím trùng" và cột ghi rõ phím này đang theo App 3 hay theo preset.
    - Test: chọn `Kiểu Blockbench` → mọi phím App 3 cũ vẫn chạy như trước; đổi sang "ưu tiên bộ phím đã chọn" → phím trùng
      theo bảng Blockbench bên dưới; phím gán tay không bị ghi đè khi đổi lựa chọn.
    - Bảng tối thiểu phải khớp khi chọn `Kiểu Blockbench` + "ưu tiên bộ phím đã chọn" (khi "ưu tiên App 3", các dòng
      trùng với phím App 3 giữ phím App 3) — đã đọc từ mã Blockbench `ec0b282`:

      | Hành động App 3 | Blockbench (id) | Phím |
      | --- | --- | --- |
      | Phát / dừng | `play_animation` | Space |
      | Thêm keyframe tại đầu phát | `add_keyframe` | Q |
      | Khung trước / khung sau | `timeline_frame_back` / `_forth` | `,` / `.` |
      | Về đầu / cuối timeline | `jump_to_timeline_start` / `_end` | Home / End |
      | Dời keyframe đang chọn sớm / muộn 1 khung | `move_keyframe_back` / `_forth` | ← / → |
      | Đặt điểm cuối animation tại đầu phát | `set_animation_end` | Ctrl+End |
      | Thêm marker | `add_marker` | Ctrl+M |
      | Bật/tắt Graph Editor | `timeline_graph_editor` | F3 |
      | Công cụ dời / xoay / pivot | `move_tool` / `rotate_tool` / `pivot_tool` | V / R / P |
      | Hoàn tác / Làm lại | `undo` / `redo` | Ctrl+Z / Ctrl+Y |
      | Sao chép / Cắt / Dán | `copy` / `cut` / `paste` | Ctrl+C / Ctrl+X / Ctrl+V |
      | Nhân bản / Xoá | `duplicate` / `delete` | Ctrl+D / Delete |
      | Chọn tất cả / Đảo chọn | `select_all` / `invert_selection` | Ctrl+A / Ctrl+I |
      | Đổi tên | `rename` | F2 |
      | Ẩn/hiện thanh bên | `toggle_sidebars` | Ctrl+B |
      | Chụp ảnh khung 3D | `screenshot_model` | Ctrl+P |
      | Mở / đóng project | `open_model` / `close_project` | Ctrl+O / Ctrl+W |
      | Góc nhìn: ban đầu / dưới / nam / đông / bắc / tây / trên | `camera_*` | Numpad 1 / 2 / 4 / 5(chiếu) / 6 / 7 / 8 / 9 |
      | Toàn màn hình | `fullscreen` | F11 |

      Lưu ý trùng: Space trong Blockbench vừa phát animation (chế độ Animate) vừa đổi công cụ cặp (`swap_tools`) — App 3 làm
      theo phạm vi: timeline/Animate → phát; khung 3D ở chế độ Pose → đổi công cụ. Các preset Blender/Maya/Cinema 4D lấy theo
      `.bbkeymap` tương ứng (vd Blender: dời G, thêm keyframe I, nhân bản Shift+D, làm lại Ctrl+Shift+Z).
29. **Điều khiển chuột khung 3D** (học theo Blockbench): chọn kiểu xoay / kéo / zoom — `Mặc định (chuột)`,
    `Mặc định (trackpad)`, `Blender`, `Maya`, `Cinema 4D` — trong cùng bảng; áp dụng ngay cho khung 3D.
30. **Lưu và mang theo**: lưu trong `localStorage['animation-studio-settings']` (try/catch); **Xuất / Nhập** file `.json`
    bộ phím; đi kèm "Lưu preset" cài đặt hiện có (`#saveSettingsPreset`).
31. **Hiện phím tắt** trong tooltip của nút và trong menu chuột phải, tự cập nhật khi người dùng đổi phím.
32. Hoạt động ở **cả hai bố cục** (Gói 5). Không dùng tên/logo Blockbench trong giao diện ngoài tên preset mô tả "Kiểu Blockbench".
- Test: mọi phím cũ vẫn chạy như trước (bảng đối chiếu trước/sau); đổi phím → phím mới chạy, phím cũ không; báo trùng;
  không kích hoạt khi gõ trong ô nhập; xuất → nhập lại bộ phím giống hệt; preset Blender/Maya đổi điều khiển chuột khung 3D;
  về mặc định.

## Kiểm mỗi PR (ghi kết quả trong mô tả PR)
- `node --test` toàn bộ `src/*.test.mjs` (sau khi build bản HTML), liệt kê pass/fail/skip trước và sau.
- Build `animation-studio` thành công; mở bản HTML trong trình duyệt làm đủ thao tác mới (ảnh chụp hoặc GIF).
- Project cũ mẫu mở được, xuất Minecraft20 không đổi byte (hoặc giải thích chênh lệch).
- Phần không chạy được ghi NOT_RUN.

## Ranh giới
- Repo https://github.com/tuantranmarinainter-ops/3appclaude, dựa trên `main` (hoặc `app3-prettier` nếu chưa merge).
- Chỉ sửa `three-workspace-app/animation-studio/`. Không sửa App 2 (`editor/`), App 4 (`vfx/`), `packages/retarget`.
  Cập nhật bản nhúng trong `editor/apps/studio/public/animation-studio/` là **việc riêng sau khi merge**, không làm trong task này.
- Mã Blockbench chỉ vào `animation-studio/`, theo đúng mục **Bản quyền** (ghi nguồn, SPDX, PROVENANCE). Không commit binary, model, hay file của bên thứ ba.
- Báo cáo bằng tiếng Việt.
