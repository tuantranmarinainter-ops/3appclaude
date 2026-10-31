# Mọi phím tắt cũ — trước / sau Gói 6

Mỗi dòng trỏ về vị trí nguồn trước sửa trên main. Handler từng widget được giữ nguyên; phím được phân giải qua registry chung. Mod = Ctrl hoặc Cmd. Các tổ hợp modifier vô ý với Q/K/Space bị bỏ; chỉ nhận đúng modifier đã đăng ký.

| File trước sửa:dòng | Phạm vi / instance | Trước | Sau mặc định |
|---|---|---|---|
| `app.js:2933` | `$(id)` / `app.0` | Escape | Escape |
| `app.js:3127` | `document` / `app.1` | Escape | Escape |
| `app.js:5201` | `handle` / `app.2` | ArrowLeft, ArrowRight, ArrowUp, ArrowDown | ArrowLeft, ArrowRight, ArrowUp, ArrowDown |
| `app.js:5217` | `window` / `app.3` | Escape | Escape |
| `app.js:5301` | `input` / `app.4` | Escape, Enter | Escape, Enter |
| `app.js:5521` | `document` / `app.compare` | Q | Q |
| `app.js:5592` | `compareResize` / `app.6` | ArrowUp, ArrowDown, Home, End, Escape | ArrowUp, ArrowDown, Home, End, Escape |
| `app.js:7383` | `window` / `app.7` | Escape | Escape |
| `app.js:7974` | `$('timelineRuler')` / `app.8` | ArrowLeft, ArrowRight, Home, End | ArrowLeft, ArrowRight, Home, End |
| `app.js:8377` | `window` / `app.main` | Space, K, I, Q, E, N, G, R, Mod+Z, Mod+Shift+Z, ,, ., Delete, Mod+A, Escape | Space, K, I, Q, E, N, G, R, Mod+Z, Mod+Shift+Z, ,, ., Delete, Mod+A, Escape |
| `app.js:9142` | `window` / `app.10` | Escape | Escape |
| `app.js:9277` | `input` / `app.11` | ArrowUp, ArrowDown | ArrowUp, ArrowDown |
| `app.js:9362` | `window` / `app.12` | Escape | Escape |
| `app.js:9459` | `window` / `app.13` | Escape | Escape |
| `app.js:9598` | `window` / `app.14` | Escape | Escape |
| `app.js:9624` | `window` / `app.15` | Shift+S | Shift+S |
| `app.js:9988` | `resize` / `app.16` | ArrowLeft, ArrowRight | ArrowLeft, ArrowRight |
| `app.js:10374` | `splitter` / `app.17` | Escape, ArrowLeft, ArrowRight, Home | Escape, ArrowLeft, ArrowRight, Home |
| `app.js:10395` | `window` / `app.18` | Escape | Escape |
| `easing_panel.js:58` | `this.root` / `easing_panel.0` | Escape | Escape |
| `graph_editor.js:163` | `this.canvas` / `graph_editor.0` | Escape, ArrowLeft, ArrowRight, Mod+A | Escape, ArrowLeft, ArrowRight, Mod+A |
| `graph_editor.js:205` | `splitter` / `graph_editor.1` | ArrowUp, ArrowDown | ArrowUp, ArrowDown |
| `layout_modes.js:411` | `document` / `layout_modes.0` | Ctrl+1, Ctrl+2, Ctrl+3 | Ctrl+1, Ctrl+2, Ctrl+3 |
| `motion_panel.js:168` | `root` / `motion_panel.0` | Enter, Space, ArrowLeft, ArrowRight, Home, End | Enter, Space, ArrowLeft, ArrowRight, Home, End |
| `motion_panel.js:279` | `h` / `motion_panel.1` | Escape, ArrowLeft, ArrowRight, ArrowUp, ArrowDown | Escape, ArrowLeft, ArrowRight, ArrowUp, ArrowDown |
| `motion_panel.js:297` | `window` / `motion_panel.2` | Escape | Escape |
| `motion_panel.js:394` | `window` / `motion_panel.3` | Escape | Escape |
| `motion_panel.js:412` | `this.root` / `motion_panel.4` | ArrowUp, ArrowDown | ArrowUp, ArrowDown |
| `smoothing_panel.js:30` | `this.root` / `smoothing_panel.0` | Escape | Escape |
| `viewport_toolbar.js:145` | `h` / `viewport_toolbar.0` | ArrowLeft, Shift+ArrowLeft, ArrowRight, Shift+ArrowRight, ArrowUp, Shift+ArrowUp, ArrowDown, Shift+ArrowDown | ArrowLeft, Shift+ArrowLeft, ArrowRight, Shift+ArrowRight, ArrowUp, Shift+ArrowUp, ArrowDown, Shift+ArrowDown |
| `viewport_toolbar.js:155` | `window` / `viewport_toolbar.1` | Escape | Escape |
| `workspace_ui.js:71` | `tabs` / `workspace_ui.0` | ArrowLeft, ArrowRight, Home, End | ArrowLeft, ArrowRight, Home, End |
| `workspace_ui.js:328` | `nav` / `workspace_ui.1` | ArrowDown, ArrowUp, Home, End | ArrowDown, ArrowUp, Home, End |
| `workspace_ui.js:424` | `document` / `workspace_ui.2` | Escape | Escape |
| `workspace_ui.js:465` | `panel` / `workspace_ui.3` | Escape | Escape |
| `workspace_ui.js:750` | `handle` / `workspace_ui.4` | ArrowLeft, Shift+ArrowLeft, ArrowRight, Shift+ArrowRight, ArrowUp, Shift+ArrowUp, ArrowDown, Shift+ArrowDown, Home, End, Escape | ArrowLeft, Shift+ArrowLeft, ArrowRight, Shift+ArrowRight, ArrowUp, Shift+ArrowUp, ArrowDown, Shift+ArrowDown, Home, End, Escape |

Ngoại lệ sửa lỗi: Q chỉ nhận Q (kể cả So sánh/xem nguồn); K chỉ nhận K; Space chỉ nhận Space. Không còn Shift/Alt/Ctrl/Cmd tự kích hoạt ba lệnh này. Escape/Enter theo widget vẫn dùng được trong ô nhập. Lệnh ghi key/Undo/Delete không chạy khi chỉ xem; điều hướng timeline vẫn được phép.

## Đối chiếu từng tổ hợp trên Chromium thật

106 tổ hợp × 2 instance; mỗi instance nhận đúng một callback, không gọi nhầm widget, modifier và currentTarget đúng. Shift+Delete cũ cũng được giữ. Các tên tổ hợp Mod nghĩa là Ctrl hoặc Cmd; kiểm native trong phiên này trên Linux dùng Ctrl.

| ID cố định | Widget | Trước | Sau App 3 mặc định | Kết quả 2 instance |
|---|---|---|---|---|
| `app.0.escape` | `app.0` | `Escape` | `Escape` | PASS |
| `app.1.escape` | `app.1` | `Escape` | `Escape` | PASS |
| `app.2.arrowleft` | `app.2` | `ArrowLeft` | `ArrowLeft` | PASS |
| `app.2.arrowright` | `app.2` | `ArrowRight` | `ArrowRight` | PASS |
| `app.2.arrowup` | `app.2` | `ArrowUp` | `ArrowUp` | PASS |
| `app.2.arrowdown` | `app.2` | `ArrowDown` | `ArrowDown` | PASS |
| `app.3.escape` | `app.3` | `Escape` | `Escape` | PASS |
| `app.4.escape` | `app.4` | `Escape` | `Escape` | PASS |
| `app.4.enter` | `app.4` | `Enter` | `Enter` | PASS |
| `view.compareReset` | `app.compare` | `Q` | `Q` | PASS |
| `app.6.arrowup` | `app.6` | `ArrowUp` | `ArrowUp` | PASS |
| `app.6.arrowdown` | `app.6` | `ArrowDown` | `ArrowDown` | PASS |
| `app.6.home` | `app.6` | `Home` | `Home` | PASS |
| `app.6.end` | `app.6` | `End` | `End` | PASS |
| `app.6.escape` | `app.6` | `Escape` | `Escape` | PASS |
| `app.7.escape` | `app.7` | `Escape` | `Escape` | PASS |
| `app.8.arrowleft` | `app.8` | `ArrowLeft` | `ArrowLeft` | PASS |
| `app.8.arrowright` | `app.8` | `ArrowRight` | `ArrowRight` | PASS |
| `app.8.home` | `app.8` | `Home` | `Home` | PASS |
| `app.8.end` | `app.8` | `End` | `End` | PASS |
| `timeline.play` | `app.main` | `Space` | `Space` | PASS |
| `key.add` | `app.main` | `K` | `K` | PASS |
| `pose.keyContext` | `app.main` | `I` | `I` | PASS |
| `view.reset` | `app.main` | `Q` | `Q` | PASS |
| `view.focus` | `app.main` | `E` | `E` | PASS |
| `motion.toggle` | `app.main` | `N` | `N` | PASS |
| `tool.translate` | `app.main` | `G` | `G` | PASS |
| `tool.rotate` | `app.main` | `R` | `R` | PASS |
| `history.undo` | `app.main` | `Mod+Z` | `Mod+Z` | PASS |
| `history.redo` | `app.main` | `Mod+Shift+Z` | `Mod+Shift+Z` | PASS |
| `key.previous` | `app.main` | `,` | `,` | PASS |
| `key.next` | `app.main` | `.` | `.` | PASS |
| `key.delete` | `app.main` | `Delete` | `Delete` | PASS |
| `key.selectAll` | `app.main` | `Mod+A` | `Mod+A` | PASS |
| `edit.cancel` | `app.main` | `Escape` | `Escape` | PASS |
| `key.delete` | `app.main` | `Shift+Delete` | `Shift+Delete` | PASS |
| `app.10.escape` | `app.10` | `Escape` | `Escape` | PASS |
| `app.11.arrowup` | `app.11` | `ArrowUp` | `ArrowUp` | PASS |
| `app.11.arrowdown` | `app.11` | `ArrowDown` | `ArrowDown` | PASS |
| `app.12.escape` | `app.12` | `Escape` | `Escape` | PASS |
| `app.13.escape` | `app.13` | `Escape` | `Escape` | PASS |
| `app.14.escape` | `app.14` | `Escape` | `Escape` | PASS |
| `view.silhouette` | `app.15` | `Shift+S` | `Shift+S` | PASS |
| `app.16.arrowleft` | `app.16` | `ArrowLeft` | `ArrowLeft` | PASS |
| `app.16.arrowright` | `app.16` | `ArrowRight` | `ArrowRight` | PASS |
| `app.17.escape` | `app.17` | `Escape` | `Escape` | PASS |
| `app.17.arrowleft` | `app.17` | `ArrowLeft` | `ArrowLeft` | PASS |
| `app.17.arrowright` | `app.17` | `ArrowRight` | `ArrowRight` | PASS |
| `app.17.home` | `app.17` | `Home` | `Home` | PASS |
| `app.18.escape` | `app.18` | `Escape` | `Escape` | PASS |
| `easing_panel.0.escape` | `easing_panel.0` | `Escape` | `Escape` | PASS |
| `graph_editor.0.escape` | `graph_editor.0` | `Escape` | `Escape` | PASS |
| `graph_editor.0.arrowleft` | `graph_editor.0` | `ArrowLeft` | `ArrowLeft` | PASS |
| `graph_editor.0.arrowright` | `graph_editor.0` | `ArrowRight` | `ArrowRight` | PASS |
| `graph_editor.0.mod-a` | `graph_editor.0` | `Mod+A` | `Mod+A` | PASS |
| `graph_editor.1.arrowup` | `graph_editor.1` | `ArrowUp` | `ArrowUp` | PASS |
| `graph_editor.1.arrowdown` | `graph_editor.1` | `ArrowDown` | `ArrowDown` | PASS |
| `mode.pose` | `layout_modes.0` | `Ctrl+1` | `Ctrl+1` | PASS |
| `mode.animate` | `layout_modes.0` | `Ctrl+2` | `Ctrl+2` | PASS |
| `mode.export` | `layout_modes.0` | `Ctrl+3` | `Ctrl+3` | PASS |
| `motion_panel.0.enter` | `motion_panel.0` | `Enter` | `Enter` | PASS |
| `motion_panel.0.space` | `motion_panel.0` | `Space` | `Space` | PASS |
| `motion_panel.0.arrowleft` | `motion_panel.0` | `ArrowLeft` | `ArrowLeft` | PASS |
| `motion_panel.0.arrowright` | `motion_panel.0` | `ArrowRight` | `ArrowRight` | PASS |
| `motion_panel.0.home` | `motion_panel.0` | `Home` | `Home` | PASS |
| `motion_panel.0.end` | `motion_panel.0` | `End` | `End` | PASS |
| `motion_panel.1.escape` | `motion_panel.1` | `Escape` | `Escape` | PASS |
| `motion_panel.1.arrowleft` | `motion_panel.1` | `ArrowLeft` | `ArrowLeft` | PASS |
| `motion_panel.1.arrowright` | `motion_panel.1` | `ArrowRight` | `ArrowRight` | PASS |
| `motion_panel.1.arrowup` | `motion_panel.1` | `ArrowUp` | `ArrowUp` | PASS |
| `motion_panel.1.arrowdown` | `motion_panel.1` | `ArrowDown` | `ArrowDown` | PASS |
| `motion_panel.2.escape` | `motion_panel.2` | `Escape` | `Escape` | PASS |
| `motion_panel.3.escape` | `motion_panel.3` | `Escape` | `Escape` | PASS |
| `motion_panel.4.arrowup` | `motion_panel.4` | `ArrowUp` | `ArrowUp` | PASS |
| `motion_panel.4.arrowdown` | `motion_panel.4` | `ArrowDown` | `ArrowDown` | PASS |
| `smoothing_panel.0.escape` | `smoothing_panel.0` | `Escape` | `Escape` | PASS |
| `viewport_toolbar.0.arrowleft` | `viewport_toolbar.0` | `ArrowLeft` | `ArrowLeft` | PASS |
| `viewport_toolbar.0.arrowleft` | `viewport_toolbar.0` | `Shift+ArrowLeft` | `Shift+ArrowLeft` | PASS |
| `viewport_toolbar.0.arrowright` | `viewport_toolbar.0` | `ArrowRight` | `ArrowRight` | PASS |
| `viewport_toolbar.0.arrowright` | `viewport_toolbar.0` | `Shift+ArrowRight` | `Shift+ArrowRight` | PASS |
| `viewport_toolbar.0.arrowup` | `viewport_toolbar.0` | `ArrowUp` | `ArrowUp` | PASS |
| `viewport_toolbar.0.arrowup` | `viewport_toolbar.0` | `Shift+ArrowUp` | `Shift+ArrowUp` | PASS |
| `viewport_toolbar.0.arrowdown` | `viewport_toolbar.0` | `ArrowDown` | `ArrowDown` | PASS |
| `viewport_toolbar.0.arrowdown` | `viewport_toolbar.0` | `Shift+ArrowDown` | `Shift+ArrowDown` | PASS |
| `viewport_toolbar.1.escape` | `viewport_toolbar.1` | `Escape` | `Escape` | PASS |
| `workspace_ui.0.arrowleft` | `workspace_ui.0` | `ArrowLeft` | `ArrowLeft` | PASS |
| `workspace_ui.0.arrowright` | `workspace_ui.0` | `ArrowRight` | `ArrowRight` | PASS |
| `workspace_ui.0.home` | `workspace_ui.0` | `Home` | `Home` | PASS |
| `workspace_ui.0.end` | `workspace_ui.0` | `End` | `End` | PASS |
| `workspace_ui.1.arrowdown` | `workspace_ui.1` | `ArrowDown` | `ArrowDown` | PASS |
| `workspace_ui.1.arrowup` | `workspace_ui.1` | `ArrowUp` | `ArrowUp` | PASS |
| `workspace_ui.1.home` | `workspace_ui.1` | `Home` | `Home` | PASS |
| `workspace_ui.1.end` | `workspace_ui.1` | `End` | `End` | PASS |
| `workspace_ui.2.escape` | `workspace_ui.2` | `Escape` | `Escape` | PASS |
| `workspace_ui.3.escape` | `workspace_ui.3` | `Escape` | `Escape` | PASS |
| `workspace_ui.4.arrowleft` | `workspace_ui.4` | `ArrowLeft` | `ArrowLeft` | PASS |
| `workspace_ui.4.arrowleft` | `workspace_ui.4` | `Shift+ArrowLeft` | `Shift+ArrowLeft` | PASS |
| `workspace_ui.4.arrowright` | `workspace_ui.4` | `ArrowRight` | `ArrowRight` | PASS |
| `workspace_ui.4.arrowright` | `workspace_ui.4` | `Shift+ArrowRight` | `Shift+ArrowRight` | PASS |
| `workspace_ui.4.arrowup` | `workspace_ui.4` | `ArrowUp` | `ArrowUp` | PASS |
| `workspace_ui.4.arrowup` | `workspace_ui.4` | `Shift+ArrowUp` | `Shift+ArrowUp` | PASS |
| `workspace_ui.4.arrowdown` | `workspace_ui.4` | `ArrowDown` | `ArrowDown` | PASS |
| `workspace_ui.4.arrowdown` | `workspace_ui.4` | `Shift+ArrowDown` | `Shift+ArrowDown` | PASS |
| `workspace_ui.4.home` | `workspace_ui.4` | `Home` | `Home` | PASS |
| `workspace_ui.4.end` | `workspace_ui.4` | `End` | `End` | PASS |
| `workspace_ui.4.escape` | `workspace_ui.4` | `Escape` | `Escape` | PASS |

### So sánh trực tiếp HTML main trước/sau

Chạy trên cả cổ điển và theo chế độ: K/I, nhảy key ,/., Ctrl+Z/Ctrl+Shift+Z, G/R, Shift+S; Graph Ctrl+A và mũi tên trái. Snapshot project/time/history/tool/Silhouette/Graph selection trùng. Chi tiết ở keymap-evidence/before-after-real-app.json. Không coi một số PASS wrapper theo tên file là đã chạy assertion; suite dùng Node22 + resolver và giữ nguyên tên/kết quả từng test.
