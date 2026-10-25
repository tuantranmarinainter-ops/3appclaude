---
name: retarget-verify-rules
description: "Khi sửa retarget App 1, report PASS không đủ; đo số trên GLB, giữ nguyên mẫu Mixamo, đọc docs/RETARGET-LESSONS.md"
metadata:
  node_type: memory
  type: feedback
  originSessionId: 11be8693-7072-4bca-96c4-df2b88ac30aa
  modified: 2026-10-21T13:21:09.334Z
---

Người dùng (2026-10-21) liên tục bắt lỗi nhìn thấy được mà report vẫn PASS: Warcraft tí hon/bay lơ lửng (sai đơn vị), tay không nắm (thiếu ghép ngón), nhón gót, bàn chân trái giật, bàn chân phải lệch hướng. Họ yêu cầu ghi lại để các model sau không lặp lại.

**Why:** gate PASS chỉ kiểm hợp đồng GLB, không kiểm chất lượng động tác; mỗi bản sửa cho rig lạ từng làm đổi kết quả rig khác.

**How to apply:**
- Đọc `C:\w01\docs\RETARGET-LESSONS.md` trước khi sửa solver/mapping/calibration/chân/tay.
- Sau mỗi sửa: đo trên GLB đã ghi (hông min/max, lún, pitch/yaw bàn chân, độ xoay lớn nhất mỗi khung so với nguồn), xem/zoom trong Workbench (khung trình duyệt, config `app1-workbench` trong `.claude/launch.json`).
- Chạy lại `C:/w01-samples/Samba Dancing.fbx`: độ trượt chân phải giữ 2.23/2.40 m; nếu đổi thì giới hạn bản sửa theo điều kiện giải phẫu.
- Số đo đạt vẫn có thể xấu khi nhìn: khoá chân D1b đạt mọi ngưỡng trượt/cao nhưng người dùng xem video thấy giật → giữ `off`. Trước khi đề xuất bật một bản sửa chuyển động: render video so sánh trước/sau (Blender workbench, mesh nhân vật đích, sàn caro; mẫu script ở scratch D1b) và đo gia tốc xoay mỗi khung của chân/tay (spike > 3× bản gốc là giật). Ngưỡng trượt phải so với nguồn, không đặt số tuyệt đối.
- Người dùng làm việc qua điện thoại (Remote Control) thì không mở được Workbench cục bộ: gửi video/ảnh bằng SendUserFile.
- Người dùng muốn debug trực tiếp qua Workbench trong khung trình duyệt; tự chạy lại file bằng ô đường dẫn, không bắt họ chụp ảnh.

Liên quan: [[three-app-pipeline]]
