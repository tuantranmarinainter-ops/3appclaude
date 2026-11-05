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

## F2 — lịch sử kiểm tra trước sửa host

- Project tổng hợp riêng ở `/tmp/f2-projects`, thư viện trống `/tmp/f2-library`, Studio cổng 3142. Rê khung chọn 5 fcurve vị trí tại 38, 44, 50, 52, 56 và một user key xoay tại 36; 12 hình thoi ở dòng nhóm và dòng con sáng. Kéo +10 cho fcurve 48, 54, 60, 62, 66. Ảnh `/tmp/f2-timeline-initial.png` là trước lượt kéo đó. Ảnh `/tmp/f2-before.png`, `/tmp/f2-selected.png`, `/tmp/f2-after.png` ghi lượt sau: 48/54/60/62/66 → 56/62/68/70/74 (+8 khi bật snap).
- Một lần Ctrl+Z và Ctrl+Y sau một lần kéo đã khôi phục rồi làm lại đúng các khung trên khi đợi host đồng bộ; một phép đo undo cập nhật DOM sau 336 ms. Hai lần kéo liên tiếp được xác nhận cùng độ dời (+8 mỗi lần khi bật snap), và vùng chọn còn hiệu lực sau lần thứ nhất.
- **FAIL — một lần Undo cho mỗi thao tác ở host unified:** hai lần kéo liên tiếp 56/62/68/70/74 → 64/70/76/78/82 → 72/78/84/86/90; một Ctrl+Z trở về 56/62/68/70/74 thay vì trạng thái sau lần kéo đầu. Host gộp hai thay đổi chưa lưu vào một snapshot khi flush trước history.undo. Đã thử hàng đợi snapshot và kiểm thành công kịch bản này, nhưng loại thử nghiệm khỏi diff vì chưa xử lý an toàn xung đột revision và chuyển project. F2 bị chặn cho đến khi có giải pháp lịch sử host an toàn. Ảnh `/tmp/f2-selected-twice.png` và `/tmp/f2-after-twice.png` được chụp trong bản thử nghiệm, không đại diện cho diff hiện tại.
- Số liệu Shot 03 và đạo cụ 150 khóa thật vẫn **BLOCKED** do thiếu bản sao; không suy luận PASS từ project tổng hợp. Chưa có ảnh trước/sau của dữ liệu thật.
- Gate trên diff F2 cuối: build builder PASS; typecheck toàn workspace PASS; test builder 780 PASS / 1 SKIP. Test riêng kiểm kẹp biên theo mọi thành phần và xóa sai số 1e-6 không lan sang khóa ngoài nhóm. Các gate này không thay đổi kết quả FAIL Undo host ở trên.

## F2 — sửa lịch sử unified sau khi mở rộng phạm vi host

- **PASS trên project tổng hợp:** hai lần kéo 96/102/108/110/114 → 104/110/116/118/122 → 112/118/124/126/130. Hai lần Ctrl+Z khôi phục lần lượt hai trạng thái trước; lưu khi không có thay đổi phát sinh **0** lệnh `scene.apply`; hai Ctrl+Y làm lại đúng. Ảnh sau làm lại: `/tmp/f2-final-redo.png`.
- **PASS trên project tổng hợp:** mô phỏng một response 409 không có event commit, thay đổi local vẫn hiển thị, giao diện có Xuất bản đang sửa / Thử lưu lại / Tải lại từ dự án. Lần thử lại dùng cùng request ID, hoàn tất và ẩn thông báo. Ảnh: `/tmp/f2-conflict-409.png`. Nút Đóng chờ request lưu chậm hoàn tất trước khi đóng.
- Hàng đợi snapshot theo revision và document ID được kiểm với save đầu bị treo, chỉnh sửa xen kẽ, autosave lỗi rồi retry, đổi project, host reload đồng thời, xung đột trong khi đọc hoặc engine refresh, và thao tác recovery có xác nhận. Không tự ghi đè khi gặp xung đột.
- Gate F2 sau sửa: `pnpm build` và `pnpm typecheck` PASS; builder 790 PASS / 1 SKIP; host revision/history 5/5 PASS.
- Ghép thử E1 #224 trong worktree tạm: 3 conflict tại StudioOverlay, StudioSession và documentSync test đã được giải trong bản thử; build + typecheck PASS, 62/62 test save/exit/Ctrl+S/F2/ripple PASS. Chromium bản ghép: Ctrl+S trong lúc request chậm không phát request trùng; Về danh sách thoát sau khi lưu. Chưa ghép E1 vào nhánh F2 chính.
- Các mục đo trên bản sao Shot 03 và đạo cụ 150 khóa thật vẫn **BLOCKED** vì dữ liệu không có trong môi trường. Các kết quả tổng hợp không thay thế phép đo đó.

## Đo trên Windows, bản sao Shot 03 thật (Claude, 2026-11-05)

Bản thử cổng 3127, project `kfbox-projects/5673640e-…` chép từ `tap15v3` (bản gốc chỉ đọc), thao tác chuột thật, so JSON `extensions.topview.fcurves`.

| Mục 8 | Trạng thái | Kết quả |
| --- | --- | --- |
| 1. Gỗ Xưa 38/44/50/52/56 + userKey 36, kéo +4 | PASS | 42/48/54/56/60 và 40; giá trị/interp/id từng khóa bằng nhau; node khác không đổi |
| 2. Kéo trái quá đà | PASS | khóa nhỏ nhất về 0, cả nhóm giữ khoảng cách (0/2/8/14/16/20); userKey 0 cũ bị khóa dời thay thế như quy tắc trùng khung; Ctrl+Z khớp JSON gốc |
| 3. Một Ctrl+Z | PASS | JSON fcurves + userKeys khớp từng ký tự; 2 lần kéo cần đúng 2 Ctrl+Z, Ctrl+Y làm lại đúng |
| 4. Đạo cụ 150 khóa kéo +10 | PASS (sau sửa) | rê khung chọn 150/150, 900/900 thành phần dời +10 giá trị giữ nguyên, Ctrl+Z khớp JSON. Thời gian < 200 ms: NOT_RUN trên trình duyệt (cách đo pointerup→DOM không tin cậy), test tổng hợp 11,52 ms |
| 5. Ảnh | PASS | `work/fcurve-real/1..3` (không commit) |

**Lỗi tìm thấy và đã sửa (commit f0b357d):** rê khung trên dòng đạo cụ chỉ trúng khóa fcurve → selection `timelineBox` không có userKey/clip → `selectedTimelineNodeId` trả null → dòng đạo cụ biến mất giữa lúc rê, chọn được 0 khóa. Sửa: lấy node từ `fcurves`, và timeline hiện mọi node có mục đang chọn (`timelineSelectionNodeIds`). Test `propFcurveRow.test.ts`.
