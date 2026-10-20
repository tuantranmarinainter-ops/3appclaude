# Workspace 01 — Chuẩn hóa Rig & Animation

**Bản đề xuất để duyệt; chưa triển khai code.**

```mermaid
mindmap
  root((Workspace 01
Chuẩn hóa Rig & Animation))
    Mục tiêu
      FBX model và animation
      Giữ source/action bất biến
      Xuất model + motion rig đích
    Rig đích — cần chốt
      Đầu bài gốc Mixamo65 hoặc Minecraft25
      App hiện preview Minecraft20
      Không coi Minecraft20 tương đương Minecraft25
      Đề xuất profile có version, giữ tương thích Minecraft20
    Nhập và kiểm tra
      FBX, đơn vị, clip
      Skeleton, required bones, rest pose
      Hash và provenance
      Từ chối rig/clip/dữ liệu lỗi
    Mapping và calibration
      Gợi ý semantic, người dùng xác nhận
      Hiện required, unmapped, extra bones
      Ràng buộc source hash + rig fingerprint + unit
      Lưu calibration/reference pose
    Preview
      Source/target cạnh nhau
      Chọn clip, phát, tua
      Root, mirror, proportions
      Preview không đồng nghĩa export PASS
    Bake và tích hợp
      Bake theo FPS/root policy
      Tạo target Motion mới, giữ lineage
      Skin remap nếu đổi rig model
      Lưu, Undo/Redo, reload, phát trong Scene
      Gói đề xuất GLB + manifest JSON
    Nghiệm thu
      Import → mapping → preview → bake → save → reload → Scene
      Hash nguồn không đổi, clip/action được giữ
      Rig, scale, axis, root hợp lệ
      CPU/WebGL parity nhiều frame
      FBX thật; nêu rõ phần chưa chạy
    Hiện trạng
      Có preview Mixamo65 → Minecraft20
      Có lưu FBX nguồn, mapping/session, BOBJ preview
      Có tải Bake JSON 30 FPS
      Thiếu Minecraft25, target Motion persisted, Scene roundtrip
      Thiếu normalized model/skin export
    Cần duyệt
      Rig đích: Minecraft25, Minecraft20, hay cả hai?
      MVP có đổi skin/model rig không?
      GLB + manifest hay BBS trực tiếp?
      Khuyến nghị chốt rig đích trước khi code
```

## Phương án đề xuất

Giữ source bất biến; cho project chọn rig đích theo profile có version. Tái sử dụng importer, solver, mapping/calibration và preview hiện có. Kết quả bake phải được lưu thành Motion đích mới trong project, có provenance, chạy được ở Scene sau reload. Nếu đầu ra yêu cầu model đã đổi skeleton, cần thêm skin-weight remap và kiểm tra bind pose; không được gọi clip JSON tải về là model/animation đã chuẩn hóa.

## Điểm cần duyệt trước khi code

1. Chốt target rig: Minecraft25 theo đầu bài, Minecraft20 tương thích bản hiện tại, hay hỗ trợ cả hai.
2. Chốt MVP có bắt buộc chuyển skin/model sang rig đích hay chỉ cần animation trên rig đích.
3. Chốt gói trao đổi: GLB + manifest JSON hay export trực tiếp sang BBS FS.
