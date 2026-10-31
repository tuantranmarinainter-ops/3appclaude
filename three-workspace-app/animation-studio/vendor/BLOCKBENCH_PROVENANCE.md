# Blockbench provenance — Gói 1

| File App 3 | Nguồn Blockbench | Commit | Phần chuyển thể |
|---|---|---|---|
| `work/material_alpha_v1_31_8/src/timeline_tools.js` (`previewAt`) | `js/animations/timeline.js`, `Timeline.loop` | `ec0b2827104d0799c153bfb5f867579c0c44652f` | Chính sách kết thúc once/loop/hold; viết lại thành hàm thuần theo elapsed, bổ sung delay và vùng A–B |

Upstream: https://github.com/JannisX11/blockbench/blob/ec0b2827104d0799c153bfb5f867579c0c44652f/js/animations/timeline.js
Copyright © JannisX11 và các cộng sự Blockbench. SPDX: GPL-3.0-or-later.
Không chép Vue/jQuery, giao diện, âm thanh hoặc Molang của upstream.
Các hàm nhảy key, màu key và giao diện App 3 là phần triển khai mới cho dự án này.
Chỉ App 3 mang mã GPL; không import vào editor/packages hoặc App 4.

## Gói 5 — bố cục theo chế độ

`src/layout_modes.js` và `src/layout_modes.css` là mã mới của App 3, chỉ học cách chia vùng giao diện. Không chuyển thể mã nguồn/CSS Blockbench, không dùng logo, icon, ảnh chụp hoặc tài sản Blockbench. Dùng lại đúng các phần tử DOM, công cụ và cơ chế resize của App 3.
# Gói phím được trích từ Blockbench

`tools/extract-blockbench-keymaps.py` trích `keybind: new Keybind(...)` từ
`js/animations/timeline.js`, `js/animations/keyframe.js`, `js/animations/animation.js`,
`js/interface/main_tools.ts`, `js/interface/shared_actions.ts`, `js/undo.js`, `js/copy_paste.js`,
`js/preview/preview.ts`, `js/io/io.js`, và đọc
`keymaps/{blender,maya,cinema4d}.bbkeymap` tại commit Blockbench `ec0b282`
(© JannisX11 và cộng sự, GPL-3.0-or-later). Đầu ra là
`work/material_alpha_v1_31_8/src/keymaps/blockbench-*.json` và `keymaps/generated.js`;
script ánh xạ một tập con các ID tương đương với hành động App 3 và chuyển mã keyCode.
Không sao chép logic hay giao diện Blockbench. Các action UV, vẽ texture, mesh,
plugin, mô hình và mọi ID không có trong bảng `mapping` của script được bỏ qua.
Đây mới là tập con: nhiều hành động trong bảng tối thiểu của đặc tả chưa được nối
với App 3 và không được coi là đã hoàn thành.

| File App 3 | Nguồn Blockbench, commit `ec0b282` |
| --- | --- |
| `src/keymaps/blockbench-blockbench.json` | `js/animations/timeline.js`, `keyframe.js`, `animation.js`; `js/interface/main_tools.ts`, `shared_actions.ts`; `js/undo.js`, `js/copy_paste.js`, `js/preview/preview.ts`, `js/io/io.js` |
| `src/keymaps/blockbench-blender.json` | `keymaps/blender.bbkeymap` |
| `src/keymaps/blockbench-maya.json` | `keymaps/maya.bbkeymap` |
| `src/keymaps/blockbench-cinema4d.json` | `keymaps/cinema4d.bbkeymap` |
| `src/keymaps/generated.js` | Tổng hợp từ bốn nguồn trên, sinh bởi script |
| `src/mouse_presets.js` | Ánh xạ thao tác chuột theo ba file `.bbkeymap` trên |

Ánh xạ `copy`/`paste` là thao tác pose của App 3, có phạm vi khác hệ clipboard
chung của Blockbench. Chưa ánh xạ cắt, nhân bản, đảo chọn, đổi tên, pivot, ẩn thanh bên,
chụp ảnh, đóng project và toàn màn hình; cần triển khai và
kiểm thử hành vi tương đương trước khi đưa vào bảng phím. `open_model` ánh xạ vào mở
project App 3: hai ứng dụng hỗ trợ định dạng khác nhau, không phải trình nhập mô hình
Blockbench. `swap_tools` chỉ đổi giữa hai công cụ di chuyển / xoay trong viewport Pose,
phạm vi và cặp công cụ khác với upstream. Các góc nhìn cố định ánh xạ theo vị trí camera cùng trục; `camera_initial`
ánh xạ góc nhìn ba phần tư của App 3, không bảo đảm cùng bố cục hay framing.

