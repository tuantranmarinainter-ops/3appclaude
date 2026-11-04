# Báo cáo E1 — lưu và về danh sách

Nhánh `claude/timeline-f2-e1`, gốc `origin/main` 92eb4a0. Chỉ triển khai E1; E2/E3 chưa làm.

| Kiểm tra | Trạng thái | Bằng chứng / giới hạn |
| --- | --- | --- |
| 8.1 Lưu Shot 03, trạng thái và thời gian dưới 3 giây, đọc file, ảnh | BLOCKED | Bản sao Shot 03 và W01_LIBRARY trên ổ S: không có trong môi trường Linux này. Không chạy trên dữ liệu thật. |
| 8.2 Sửa rồi về trước 5 giây, mở lại và ảnh | BLOCKED | Thiếu dữ liệu bản sao như trên. |
| Test trạng thái, thoát và phím tắt | PASS | 19 test Vitest gồm session: trạng thái, đợi lưu, lỗi/hủy, tài liệu sạch, khóa ghi, phạm vi Ctrl+S và reload. |
| Test timeline | PASS | 11 file, 58 test Vitest. |
| Typecheck workspace | PASS | `pnpm typecheck`. |
| Test builder | PASS | `pnpm test:evaluate`: 132 file, 758 test đạt, 1 bỏ qua. |
| Kiểm ngôn ngữ | PASS | `pnpm check:locales`: 15 ngôn ngữ. |
| Lint toàn workspace | FAIL | 6 lỗi `no-restricted-imports` trong các file không sửa: ClipBlendBands, keyframeGroupDrag.test, clipBlendK3.test, evaluate/index. |
| Build builder + Studio | PASS | Build lần cuối sau sửa; có các warning có sẵn của Studio. |
| Studio offline | PASS | Chromium trong /tmp, dự án và thư viện /tmp, cổng 3140; 28 pose, không có request ngoài. Đây là smoke trên project mới, không thay cho kiểm Shot 03. |
| 8.3–8.5 (E2/E3) | NOT_RUN | Ngoài E1. |

Khi khóa ghi bật giữa lúc đang lưu, session trả promise lưu đang chạy; test kiểm đợi và không ghi hai lần. Chưa xác nhận luồng giao diện và độ bền lưu bằng trình duyệt. Không push, tạo PR hoặc merge.
