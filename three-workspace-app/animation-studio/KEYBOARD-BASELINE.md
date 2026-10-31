# Đối chiếu phím nền PR #180 (`f86f3b4`)

Bảng ghi nhận từ mã nguồn; chưa xác nhận bằng trình duyệt. Các điều kiện, ví dụ chế độ so sánh, focus và trạng thái kéo, là một phần của hành vi mặc định cần giữ khi chuyển sang sổ đăng ký.

| Ngữ cảnh | Phím | Hành vi nền | Nguồn |
| --- | --- | --- | --- |
| Chỉnh sửa / xem nguồn | Space | Phát / dừng; không chiếm phím khi focus nút hoặc summary | app.js:8377 |
| Chỉnh sửa | , / . | Nhảy key trước / sau | app.js:8431 |
| Chỉnh sửa | Delete | Xoá các key đã chọn | app.js:8436 |
| Timeline focus | Ctrl/Cmd+A | Chọn tất cả key của cơ thể | app.js:8398 |
| Chỉnh sửa | Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z | Hoàn tác / làm lại | app.js:8465 |
| Chỉnh sửa, xem nguồn, so sánh | Q | Đặt góc nhìn ba phần tư | app.js:8389, 8470, 5522 |
| Chỉnh sửa / xem nguồn | E | Focus khớp đã chọn | app.js:8389, 8443 |
| Chỉnh sửa | N | Bật Edit Motion Layer khi ở Animation Lab | app.js:8443 |
| Chỉnh sửa | G / R | Công cụ di chuyển / xoay, có kiểm tra IK và kéo | app.js:8488 |
| Chỉnh sửa | I / K | Thêm key; I dùng mask Motion Panel nếu panel mở | app.js:8488, 8521 |
| Chỉnh sửa | Shift+S | Bật / tắt silhouette | app.js:9624 |
| Bố cục theo chế độ | Ctrl+1 / 2 / 3 | Chọn Pose / Animate / Xuất | layout_modes.js:411 |
| Thước timeline focus | Trái / phải / Home / End | Lùi / tiến một frame; đầu / cuối | app.js:7974 |
| Canvas Graph focus | Ctrl/Cmd+A; trái / phải; Escape | Chọn toàn bộ key; lùi / tiến frame; huỷ | graph_editor.js:163 |
| Đang kéo / mở menu hoặc panel | Escape | Huỷ kéo, đóng menu/panel theo ngữ cảnh; có nhiều handler ưu tiên focus | app.js, motion_panel.js, viewport_toolbar.js, graph_editor.js, easing_panel.js, smoothing_panel.js, workspace_ui.js |
| Widget có focus | Mũi tên, Home, End, Enter, Space | Điều hướng tab, điều chỉnh splitter, thanh giá trị, tay, khớp; giữ quy tắc truy cập bàn phím của widget | workspace_ui.js, motion_panel.js, viewport_toolbar.js, graph_editor.js, app.js |
| Ô số / transform focus | Mũi tên lên/xuống, Enter, Escape | Điều chỉnh / xác nhận / khôi phục giá trị theo ô | app.js:5301, 9277 |

Chế độ so sánh chặn G/R/I/N/K/Q/Space và Ctrl/Cmd+Z/A/S khỏi xử lý chỉnh sửa; Q vẫn đặt góc nhìn. Nguồn preview chặn G/R/I/K/N và Ctrl/Cmd+Z/A. Không coi danh sách này là kiểm thử sau thay đổi.

Chi tiết modifier: nhánh Q cũ không loại Shift; nhánh K cũ không kiểm tra Ctrl,
Meta, Alt hoặc Shift. Sổ đăng ký hiện chuẩn hoá tổ hợp chính xác nên các tổ hợp
này cần được xác minh hoặc khôi phục trước khi kết luận tương thích hoàn toàn.
