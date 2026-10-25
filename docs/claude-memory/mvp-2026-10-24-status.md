---
name: mvp-2026-10-24-status
description: "Tiến độ MVP quy trình Hero/Gỗ Xưa/Đen (App1→App5→App2→App3) ngày 2026-10-24 và việc còn lại khi người dùng nói \"làm tiếp MVP\""
metadata:
  node_type: memory
  type: project
  originSessionId: 11be8693-7072-4bca-96c4-df2b88ac30aa
  modified: 2026-10-24T06:31:19.532Z
---

MVP người dùng đặt 2026-10-24: chọn anim từ nhiều mô hình → áp cho Hero, Gỗ Xưa, Đen (App 1) → dựng cảnh App 2 → sang App 3 → trả về App 2, báo sớm điểm vướng.

Đã đạt (PR #85–#95 đã merge): App1 nhập lô + Hiệu chỉnh kiểu Mixamo (bước 4) + nền tối; base model riêng từng nhân vật (kho thật C:\w01-library đã migrate, backup zip ở C:\w01-samples\backups); App2 Create project, add-to-scene, "Lấy từ kho" cho mọi nhân vật, Verity quay +Z, không trùng uuid, không hydration error.

Cập nhật cuối ngày: C1–C7 (#96–#101, #103 = C2) đã merge; QA `apps/studio/scripts/c2-native-browser.mjs` PASS Hero/Đen/Gỗ Xưa trong App 3 (cần kho có Nháp, vd bản sao lib-mvp đã migrate). QA `scripts/c1-roundtrip-qa.mjs` cũng PASS (Claude tự chạy): sửa Spine_01 Gỗ Xưa trong App 3 → lưu → "Trả kết quả về cảnh", revision 11→12, phát 0→14, 0 lỗi. MVP ĐẠT trên dữ liệu bản sao; kho thật chưa có Nháp động tác.
Danh sách cũ (đã xử lý): (1) chạy trọn App2→App3 "Mở shot từ cảnh" → chỉnh → "Trả kết quả về cảnh"; (2) L4: App 3 mở bằng model/xương riêng của nhân vật thay vì manơcanh Mixamo; (3) add-to-scene tự đặt nhân vật cách nhau. Chưa sửa: RobotExpressive không tự map, Workbench chỉ chọn 1 nhân vật đích/lượt, mẫu bàn tay + nút Xem thử trong Hiệu chỉnh.

Dữ liệu thử: kho C:\w01-samples\lib-mvp, project a67218e8-48cb-443b-a249-9ee131987c84 trong C:\w01-samples\mvp-projects (Studio thử cổng 3017, Workbench thử 3102 từ worktree C:\w01-review-m123). Liên quan [[subagents-sonnet-haiku]], [[per-character-base-model]].
