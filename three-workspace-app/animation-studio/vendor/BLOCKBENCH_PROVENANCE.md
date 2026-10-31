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

## Gói 6 — preset phím

Nguồn: Blockbench ec0b2827104d0799c153bfb5f867579c0c44652f, các Action/Tool/Toggle/KeybindItem trong js/ và keymaps/{blender,maya,cinema4d}.bbkeymap. SPDX GPL-3.0-or-later. Copyright JannisX11 và các cộng sự.
Trích bằng `python tools/extract-keymaps.py <checkout-hoặc-archive-ec0b282>`; không thực thi mã nguồn upstream. Kết quả tại work/material_alpha_v1_31_8/src/keymaps/presets.js; danh sách ánh xạ, mọi mục bỏ qua và hash SHA-256 nguồn ở PROVENANCE.json cùng thư mục. Router, adapter widget và giao diện cài đặt tự viết, không sao chép UI/ảnh/logo upstream.
Không có tương đương ở App3 hiện tại: UV/mesh/paint, công cụ pivot chỉnh được, sao chép/cắt/dán/nhân bản key (Gói2), đóng project. Không đăng ký lệnh giả; các gói sau dùng Keymap.register để thêm tương đương thật.

## Gói 2 — Molang

`src/molang.js` là parser và bộ đánh giá Molang viết độc lập cho tập con trong đặc tả, không chép mã Blockbench hoặc thư viện bên thứ ba. SPDX: GPL-3.0-or-later (giấy phép App 3). `src/molang_panel.js` và các tích hợp là mã mới của App 3.
