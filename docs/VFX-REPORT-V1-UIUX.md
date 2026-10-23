# App 4 VFX — báo cáo UI/UX V1

Ngày: 2026-10-23. Nhánh: `ai1/v1-vfx-uiux`.

## Kết quả

- Đặc tả UI/UX tiếng Việt ở `docs/VFX-APP4-UIUX.md`: bố cục DaVinci 5 workspace, 4 panel, năm luồng, trạng thái, keyboard/accessibility và bảng ánh xạ backend thật/đề xuất.
- Prototype tĩnh ở `three-workspace-app/vfx/ui-prototype/`; mở `index.html` trực tiếp, không build và không dependency. Có dữ liệu dự phòng nhúng để `file://` vẫn dùng được.
- Đủ luồng Thư viện, Xem trước, Tạo từ mô tả, Chỉnh thông số, Kiểm tra & đóng gói. Kết quả mô phỏng được ghi nhãn; xuất và gửi App 2 bị khoá vì V1 chưa nối backend.
- Separator trái/phải/dưới kéo được, điều khiển bằng bàn phím, nhấp đúp để đặt lại và lưu kích thước trong `localStorage`.
- `?previews=<origin>` đọc đúng `{ sheets: Record<effect, VfxSheetMeta> }` từ `/api/unified/vfx-previews`, lấy PNG từ route con, và chọn cell theo `frames/columns/rows/fps`. Không có query thì dùng dữ liệu mẫu.

## Kiểm tra

| Gate | Kết quả | Bằng chứng |
| --- | --- | --- |
| Logic prototype | PASS | `node --test three-workspace-app/vfx/ui-prototype/app.test.js`: 7 pass, 0 fail. |
| JavaScript syntax | PASS | `node --check .../app.js`. |
| Browser 5 luồng | PASS | Chromium headless mở và tương tác 5 màn; tìm không dấu, tạo phiên bản, chọn node, Advanced, slider và scrub đều đổi state. Console/page error: 0. |
| 1366×768 | PASS | `body.scrollWidth = innerWidth = 1366`; timeline `scrollWidth = clientWidth = 766`. |
| 1920×1080 | PASS | Đã render ảnh từng màn và kiểm trực quan. |
| Builder prerequisite | PASS | `pnpm --filter @topview/3d-builder build`. |
| Workspace typecheck | PASS | `pnpm typecheck`. |
| Whitespace | PASS | `git diff --check`. |

## Ảnh duyệt

Ảnh PNG không được commit theo phạm vi task. Sáu artifact cục bộ đã tạo tại `/tmp/vfx-uiux-screens/`: `library.png`, `preview.png`, `generate.png`, `edit.png`, `package.png`, `library-1366.png`.

Môi trường Codex không có connector/browser upload hay GitHub user-attachment API có thể gọi bằng `gh`; GitHub không cung cấp endpoint công khai để tải tệp vào vùng `user-attachments` của PR. Vì vậy ảnh chưa thể đính kèm/host trong PR từ môi trường này. Không dùng dịch vụ công khai bên thứ ba và không tạo Release ngoài phạm vi để lách giới hạn.

## Giới hạn đúng với V1

- Chưa nối tài liệu Effekseer/MCP, validator, package runner, gate trong game hoặc bridge App 2.
- Nhãn GPU, gate và trạng thái chạy game trong dữ liệu mẫu chỉ là minh hoạ, được đánh dấu rõ trong UI; không phải đo thực.
- Route preview thật chỉ hoạt động khi Studio được phục vụ và origin cho phép request; mở `file://` không thể tự vượt chính sách CORS của trình duyệt.
