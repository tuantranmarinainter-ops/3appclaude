# Đợt sửa lớn App 3 (Animation) + xuất BBS — 4 gói việc (2026-10-25)

Người dùng chốt 2026-10-25 sau khi dựng và thử Shot 01 Tập 15 trong game. Đọc trước: `CLAUDE.md`, `docs/DECISIONS.md`,
`docs/RETARGET-LESSONS.md`, `docs/BACKLOG-2026-10-25.md` (mục **Vai trò người dùng**, B9, B15–B17).

**Phân công:** Gói 1, Gói 2 → **Muse AI**. Gói 3, Gói 4 → **GPT (Codex)**. Mỗi bên chia subagent, **subagent dùng model "sol 6.1" bản nhẹ**.
Mỗi mục một nhánh `ai1/<mã>-…` (vd `ai1/a1-clip-stretch`), một PR đích `main`. **Không tự merge.**

## Vai trò người dùng (tóm tắt)
Một người làm phim Minecraft BBS FS: nhân vật là chính; thao tác ít bước, thấy kết quả ngay; giống iClone 8.53 ở chỗ chỉnh clip/tư thế;
xem cảnh không làm hỏng dữ liệu; báo lỗi tiếng Việt ngay chỗ bấm; giao diện mặc định tiếng Việt.

## Mã nguồn liên quan
- App 3 = Animation Studio (giữ **mọi** chức năng cũ; xem memory/quy tắc "app3-keep-animation-studio"): nguồn
  `three-workspace-app/animation-studio/work/material_alpha_v1_31_8/src/` (`app.js`, `control_rig.js`, `dual_editor.js`, `graph_editor.js`,
  `motion_panel.js`, `bobj_loader.js`, `minecraft20_*.js`, `host_bridge.js`, `build.mjs`…) → build ra
  `editor/apps/studio/public/animation-studio/v1.33.0/`. Sau build chạy `tools/check-features.mjs` (giữ 434/434 id) và test `src/*.test.mjs`.
- Phần host trong Studio: `editor/apps/studio/app/workbench/components/AnimationWorkspace.tsx`, `animation-creation/`, `StudioOverlay.tsx`.
- Timeline App 2: `editor/packages/builder/src/components/timeline/`; lệnh `motion.binding.set` đã nhận `clipPatch.playback { speed, loop }`
  (`editor/apps/studio/src/unifiedProjectStore.ts` ~765).
- Xuất film: `editor/apps/studio/src/sceneBbsFilm.ts`, `filmSeries.ts`, `filmPreflight.ts`, `unifiedFilmSampling.ts`, panel `film-export/`.

---

## Gói 1 — Thời lượng & tốc độ clip (Muse) — **ưu tiên cao nhất**
| Mã | Làm gì | Đầu ra / đạt khi |
| --- | --- | --- |
| **A1** | **Kéo giãn clip = đổi tốc độ** (kiểu iClone 8.53): mỗi animation là một thanh trên timeline App 3 (và App 2); kéo đuôi dài ra → chậm lại, thu ngắn → nhanh lên; thanh hiện % tốc độ, có ô nhập số, "Về 100%". | Clip 20 khung kéo thành 40 khung phát 50%, đủ động tác, không khựng; trả về App 2 đúng tốc độ; dùng `playback.speed`. |
| **A2** | **Nút Lặp (Loop)** trên từng clip: bật → kéo dài là **lặp lại** động tác (vd Stun choáng liên tục); tắt → kéo dài là giãn tốc độ (A1). Sửa lỗi hiện tại: kéo dài thì nhân vật **về tư thế đứng không**. Gộp B9. | Stun 2 s bật Lặp kéo 6 s → choáng 3 lần liền mạch, không giật ở mối nối; không còn khung nào bật về tư thế rest. |
| **A3** | **Cắt clip**: tay cầm cắt đầu/đuôi (bỏ phần thừa, giữ tốc độ), **"Tách tại vị trí đang đứng"** (chia đôi), **"Xoá đoạn đã chọn"**. | Cắt 10 khung đầu của động tác mà phần còn lại đúng tốc độ; tách đôi clip đặt hai chỗ khác nhau; Hoàn tác được. |
Áp dụng **cùng một hành vi** ở App 3 và thanh clip App 2 (Dựng cảnh). Test: phát/đánh giá tư thế bằng số trước/sau (pose khác nhau đúng nhịp, không có khung rest), test lưu–mở lại project.

## Gói 2 — Keyframe & tư thế (Muse) — làm sau/song song Gói 1, cùng file `app.js` thì làm nối tiếp
| Mã | Làm gì | Đầu ra / đạt khi |
| --- | --- | --- |
| **A4** | **Chọn nhiều keyframe**: kéo chuột khoanh vùng trên timeline; Shift/Ctrl + click để thêm/bớt. | Khoanh vùng → keyframe trong vùng sáng lên, đếm đúng số chọn. |
| **A5** | **Xoá keyframe**: phím Delete + menu chuột phải "Xoá", một hoặc nhiều; Hoàn tác. | Xoá 10 keyframe thừa một lần, động tác nội suy lại giữa các key còn lại. |
| **A6** | **Co giãn nhóm keyframe**: kéo để dời; kéo mép vùng chọn để nén/giãn (chỉnh tốc độ một đoạn); tuỳ chọn đẩy lùi phần sau (ripple). | Chọn khung 30–60 nén còn 30–45 → đoạn đó nhanh gấp đôi, phần sau dời lên. |
| **A7** | Menu chuột phải trên keyframe: **"Sao chép pose"** (Toàn thân / phần đang chọn) đang **ẩn/mờ** → sửa cho dùng được, kèm **"Dán pose"**. | Chuột phải key → Sao chép pose (Toàn thân) → sang khung khác → Dán → đúng tư thế. |
| **A8** | **Copy/Paste Pose kiểu iClone 8.53 cho Blocking**: bộ nhớ tạm giữ tư thế lấy từ **bất kỳ animation** nào đang mở (kể cả clip thư viện cùng/ghép được xương), giữ được khi đổi animation; dán vào khung A, C (thêm B nếu cần) → tự nội suy A→B→C; tuỳ chọn **"Giữ cao độ"** (bật: lấy cả vị trí/độ cao root của tư thế gốc; tắt — mặc định: chỉ lấy dáng người, giữ chỗ đứng). Đặt trong bước **1 · Blocking**. | Dán "ngồi" vào A, "bay cao" vào C → chuyển động mượt từ ngồi sang bay; bật/tắt Giữ cao độ đúng mô tả; Hoàn tác từng lần dán. |

## Gói 3 — Nhân vật Minecraft20 chuẩn game + control rig (GPT)
| Mã | Làm gì | Đầu ra / đạt khi |
| --- | --- | --- |
| **A9** | **Base model Minecraft20 chuẩn game**: thay mesh khối tự dựng của các nhân vật Minecraft20 trong Thư viện (Hero, Đen, Gà, Chi Chi, Người bí ẩn) bằng mesh mẫu của mod **Emoticons** (mchorse) trong `S:\Minecraft\Minecraft Forge 1.12.2\mods\emoticons-1.1.2-1.12.2.jar` → `assets/emoticons/models/entity/`: `default.bobj` (tay 4 px), `slim.bobj` (tay 3 px), `*_3d.bobj` (lớp ngoài skin), `*_simple*.bobj` (nhẹ), `ragdoll.bobj` (xương `low_*_arm.item` cầm đồ). Các model này có **đúng 20 xương Minecraft20** của dự án (`anchor, body, low_body, head, left_arm, low_left_arm, low_left_arm.end, right_arm, low_right_arm, low_right_arm.end, right_leg, low_leg_right, left_leg, low_left_leg, misc_bone_1..3, misc_gbone_1..3`) → 85 động tác chạy thẳng. Skin 64×64 riêng từng nhân vật (`characters/<id>/skin.png`), quy ước texture `textures/<object>/default.png`. Mỗi nhân vật vẫn có **base model riêng** (không dùng chung). **Control rig cho Minecraft20 trong App 3**: khớp/tay cầm cho đủ xương, IK tay/chân, danh sách xương — chỉnh được như Mixamo65. | Đen/Hero hiện đúng khối + skin ở App 2, App 3 và **trong game BBS FS 2.7** (giải B17); đứng cạnh người chơi thật cùng chiều cao; App 3 xoay được từng khớp, IK kéo tay/chân; lưu → trả về App 2 → xuất BBS vẫn đúng. Có lệnh migrate kho (chạy trên **bản sao**). |
**Bản quyền:** jar Emoticons không kèm license → model chỉ chép ra ngoài repo (`S:\Claude\w01-samples\mc20-emoticons\`), **không commit** mesh vào GitHub; code chỉ đọc từ đường dẫn cấu hình (vd biến `W01_MC20_BASE_DIR`). Muốn đưa vào repo phải kiểm license của mchorse trước.

## Gói 4 — Bố cục App 3 + xuất BBS (GPT)
| Mã | Làm gì | Đầu ra / đạt khi |
| --- | --- | --- |
| **A10** | Dải nút đen/tím dưới tiêu đề App 3 (Nhân vật, Animation đã lưu, Tạo animation, Lưu vào project, Camera, Từ/Đến frame, Mở shot từ cảnh, Trả kết quả về cảnh…) **chuyển sang cột phải**, thành một mục chung với Thuộc tính / Cây đối tượng / Thư viện. | Khung 3D App 3 cao hơn rõ rệt; mọi nút cũ còn đủ; nút chuyển app giữ viền cam (C23). |
| **A11** | **Mọi khung kéo co giãn được** (cột trái, cột phải, timeline, khung 3D), nhớ kích thước (localStorage). | Kéo thanh chia, tải lại trang vẫn giữ. |
| **A12** | Panel xuất **tự chọn đúng đoạn**: chỉ shot nằm trong khoảng xuất (≤ 3 camera), tự kiểm các shot nối liền & phủ kín khoảng, nút một chạm để sửa; hết các lỗi "BBS Film hỗ trợ tối đa 3 camera", "các cảnh phải nối tiếp", "phải phủ chính xác khoảng xuất". | Chọn Shot 01 → Xuất là ra film ngay, không sửa chuỗi camera tay. |
| **A13** | Hiệu ứng chưa xác nhận chạy trong BBS (vd `aura01`): tuỳ chọn **"Không kèm hiệu ứng"**; game không có addon thì mặc định bỏ (tránh sập B16: `FormUtilsClient.getRenderer(Form)` null). Gói ghi danh sách mod cần. | Xuất film không kèm VFX, mở trong game không sập. |
| **A14** | Cảnh báo "không đủ dữ liệu skeleton đo chân" cho Minecraft20 (Đen): đo bằng đầu cẳng chân (rig không có xương bàn chân). | Film có Đen không còn cảnh báo này; vị trí sàn đúng. |
| **B15** | Trong game nhân vật/bối cảnh **ở rất xa, lơ lửng**, BBS báo "quá xa"; nhân vật **sai vị trí + rotation** (camera chạy được). | Film đặt cảnh quanh điểm neo chọn được (mặc định gần người chơi/toạ độ chọn), đúng m→block, trục Y, hướng +Z; số đọc lại từ `.dat` khớp `scene.evaluate` ở khung 0/70/149 của Shot 01 Tập 15. |

---

## Quy tắc chung
- Thứ tự người dùng chốt: **A1, A2** → **A9** → A4–A7 → A10–A11 → A12–A14 + B15 → A3, A8.
- App 3: **không bỏ chức năng nào** của Animation Studio; build khớp quy trình `build.mjs`; `check-features` giữ 434/434 id; thêm qua bridge khi cần.
- Giữ SHA GLB Samba mặc định `68fcdb75d373…`. Đo bằng số trên GLB/`.dat`, có ảnh chụp.
- Test trên **bản sao**: kho `S:\Claude\w01-samples\lib-<việc>` (chép từ `S:\Claude\w01-library`), project Tập 15 chép sang thư mục riêng;
  **không ghi** vào `S:\Claude\w01-library`, `S:\Claude\w01-samples\tap15v3` hay thư mục game `S:\Minecraft\…`.
  `C:\w01-samples\*` là junction sang ổ S: chép thư mục mẫu phải dereference (`realpathSync` + `dereference: true`).
- Build, `pnpm typecheck` toàn workspace, `pnpm test:all` trên Windows. Không regenerate golden, không commit binary, không đổi kiểu xuống dòng.
- Xong mỗi việc báo mã việc + số PR.
