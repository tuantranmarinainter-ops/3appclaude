# Báo cáo Timeline App 2 — E2, 2026-11-05

Nhánh `claude/timeline-f2-e2`, dựa trên F2 PR #226. E2 bổ sung menu chuột phải cho keyframe, sao chép/dán biến đổi và bỏ hành vi xoá bằng chuột phải hoặc nhấp đôi. Báo cáo này ghi kết quả E2; E1 và E3 có kiểm thử riêng.

## Số đo theo mục 8 đặc tả

| Mục | Trạng thái | Kết quả |
| --- | --- | --- |
| 8.1 Lưu | NOT_RUN | Thuộc E1, không đo trong E2. |
| 8.2 Về danh sách | NOT_RUN | Thuộc E1, không đo trong E2. |
| 8.3 Chuột phải và nhấp đôi 10 hình thoi, đủ ba loại, trên Shot 03 | BLOCKED | Không có bản sao Shot 03 trong môi trường này. Trên dự án tổng hợp, kiểm một hình thoi: số hình thoi trước/sau chuột phải và nhấp đôi là 12/12. Số hình thoi DOM không thay thế phép đếm khóa trong JSON theo đặc tả. |
| 8.4 Sao chép/dán Gỗ Xưa và so JSON/Undo/Redo | BLOCKED | Không có bản sao Shot 03. Phép kiểm tổng hợp nhiều đích dưới đây đạt, nhưng không thay thế phép đo Gỗ Xưa hoặc phép đo sau `rederiveWalkPaths` trên dữ liệu thật. |
| 8.5 Kéo chung clip và keyframe | NOT_RUN | Thuộc E3, không đo trong E2. |
| 8.6 Typecheck toàn workspace và test builder | PASS | `pnpm typecheck`: đạt; Vitest builder: 133 tệp đạt, 794 test đạt, 1 test bỏ qua. |

## Phép kiểm browser trên dự án tổng hợp

Chạy Chromium với server cổng 3141, `W01_LIBRARY=/tmp/e2-library` và bản sao project riêng `/tmp/e2-projects-values2`. Dữ liệu nguồn là dự án tổng hợp, được chỉnh trên bản sao để có khung nguồn 20 và hai khung đích 60, 100; không ghi project hoặc thư viện thật.

- Chuột phải khung nguồn, chọn **Sao chép biến đổi**, chọn hai hình thoi đích và chuột phải một hình đang chọn: selection giữ 2 userKey và 2 ref fcurve.
- Dán đủ: tại cả hai đích, userKey vị trí bằng `[1, 2, 3]`, xoay bằng `[10, 20, 30]`, tỉ lệ bằng `[2, 3, 4]`; 6 giá trị fcurve vị trí theo ba trục đều bằng giá trị nguồn. Sai số so sánh các giá trị này: **0**.
- JSON các khóa fcurve và userKey ngoài hai khung đích không đổi. Một Ctrl+Z đưa JSON fcurve + userKeys về đúng chuỗi trước dán; Ctrl+Y đưa về đúng chuỗi sau dán.
- Test đơn vị xác nhận chọn nhóm qua userKey rồi mở menu trên bundle đồng khung giữ nhóm và thêm fcurve; khi hình tổng hợp chưa sáng, mở menu chọn lại bundle đó. Chưa kiểm đường đi ghost này bằng thao tác chuột thật.

Ảnh browser không commit: [trước dán](/tmp/e2-values-before.png), [menu và nhóm chọn](/tmp/e2-values-menu.png), [sau dán/Làm lại](/tmp/e2-values-after.png). Ảnh khác trên bản tổng hợp trước đó: [menu](/tmp/e2-menu.png). Các ảnh và thư mục `/tmp` là tạm thời.

## Điều còn chặn

- **BLOCKED — userKeys/toggle và đường đi dẫn xuất:** khi thay đổi trạng thái lớp userKeys, đường đi dẫn xuất được lưu trong document có thể không phản ánh lớp hiện đang đánh giá. Cần quyết định cách xử lý trước khi coi E2 hoàn tất; chưa chọn giải pháp thay đổi semantics toggle.
- **BLOCKED — Shot 03:** chưa có bản sao dữ liệu được yêu cầu để chạy các phép đo 8.3–8.4. Không suy rộng kết quả tổng hợp thành PASS cho các mục đó.
- **NOT_RUN:** kiểm chuột phải/nhấp đôi đủ 10 hình thoi thuộc ba loại trên Shot 03; đo Dán chỉ xoay trên Shot 03; browser chọn nhóm qua ghost; các mục E1/E3 nêu ở bảng trên.

Chưa commit, push, mở PR hoặc merge trong đợt kiểm này.

## Gỡ chặn E2 và đo trên Windows (Claude, 2026-11-05)

**Quyết định người dùng:** chặn dán vị trí khi lớp khóa người dùng đang tắt; không đổi cơ chế đường đi dẫn xuất.
`canPasteWithoutUserKeys` trả false khi mask có `position` (node sửa được) → mục "Dán biến đổi"/"Dán chỉ vị trí" bị tắt,
title "Bật lại keyframe tay (khóa người dùng) để dán"; session cũng từ chối. Test cập nhật trong `fcurveKeyframe.test.ts`.

Bản sao Shot 03 thật, cổng 3127, chuột thật, so JSON `extensions.topview.fcurves`:

| Mục | Trạng thái | Kết quả |
| --- | --- | --- |
| 8.3 Chuột phải / nhấp đôi | PASS | 4 chuột phải + 4 nhấp đôi trên 8 hình thoi Gỗ Xưa (userKey + fcurve): 8/8 còn nguyên, JSON không đổi; nhấp đôi đưa đầu phát tới khung 67 (2,23 s) |
| 8.4 Sao chép 53 → Dán biến đổi 65 | PASS | fcurve vị trí x tại 65 = 2,4 (giá trị tại 53); thêm userKey vị trí [2,4, 0, 1,2], xoay/tỉ lệ = tư thế đánh giá tại 53; node khác không đổi; Ctrl+Z khớp JSON gốc, Ctrl+Y khớp JSON sau dán |
| Tắt khóa người dùng | PASS | menu: 4 mục dán tắt kèm title nhắc bật lại; Sao chép, Xóa vẫn bật |
| Typecheck + builder | PASS | 797 PASS / 1 SKIP |

Ghi chú: ô "Ghi đè khung khóa người dùng" trên thanh timeline có kích thước 0 ở khung 1600×900 trong pane (không bấm chuột được), phải bật/tắt bằng JS khi đo. Chưa sửa, ngoài phạm vi E2.
