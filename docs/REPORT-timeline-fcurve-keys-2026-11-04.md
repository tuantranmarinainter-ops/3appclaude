# Báo cáo F1 — timeline fcurve (2026-11-04)

Nền: `92eb4a0`. F1 cung cấp dời khóa ở tầng dữ liệu và giao dịch session; chọn và kéo trong timeline thuộc F2.

| Phép đo đặc tả mục 8 | Trạng thái | Kết quả |
| --- | --- | --- |
| 1. Gỗ Xưa: 5 fcurve + userKey, dời +4 | BLOCKED | Không có bản sao Shot 03 trong môi trường. Test tổng hợp với đúng các khung 38, 44, 50, 52, 56 và userKey 36 đạt các khung yêu cầu; kiểm giá trị đường cong và tay nắm Bézier. |
| 2. Kéo trái −100, kẹp frameStart | BLOCKED | Chưa đo trên Shot 03. Test tổng hợp kẹp delta −40, userKey về 0, các fcurve giữ khoảng cách. |
| 3. Một lần hoàn tác khôi phục JSON | BLOCKED | Chưa đo trên Shot 03. Test tổng hợp so chuỗi JSON fcurves + userKeys trước và sau undo, và kiểm redo. |
| 4. Đạo cụ 150 khóa, +10 dưới 200 ms | BLOCKED | Không có đạo cụ Shot 03. Test tổng hợp 150 khung × 3 thành phần đạt 150/150, thời gian gọi session 11,52 ms (một lượt chạy riêng, ngưỡng 200 ms); chưa đo dữ liệu thật. |
| 5. Ảnh trình duyệt trước/sau | NOT_RUN | Tương tác timeline thuộc F2; không có bản sao Shot 03. |

Test bổ sung kiểm vị trí lấy mẫu của đường đi dẫn xuất, frame lẻ, nút bị khóa, va chạm, và reaction chỉ nhận trạng thái hoàn chỉnh. Không thay golden hay dữ liệu thật.

Kiểm tra khởi động riêng: Chromium hệ thống mở Studio ở cổng 3141 với `W01_LIBRARY` và `BBS_UNIFIED_PROJECTS_DIR` trỏ thư mục trống trong `/tmp`; trang hiển thị 0 dự án. Ảnh `/tmp/f1-studio-synthetic.png` chỉ chứng minh trang mở được, không chứng minh thao tác F1.
