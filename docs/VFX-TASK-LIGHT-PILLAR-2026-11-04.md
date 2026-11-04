# Đặt hàng App 4: cột sáng trắng + cyan (Tập 15 · Shot 03) — 2026-11-04

## Vì sao
Storyboard Tập 15, slide 04/24 ("Herobrine xuất hiện từ trên cao", góc thấp hướng lên): **Hero hạ xuống từ trên cao trong một cột
sáng trắng + xanh cyan**, chân chạm đất tạo xung kích đẩy Gỗ Xưa ra xa. Người dùng chọn "đặt hàng App 4 làm mới" (2026-11-04).

Kho VFX hiện có 9 hiệu ứng (`aura01, barrior01, forcefieldtornado, laser01, light, simple_ribbon_sword, simple_ring_shape1,
simple_turbulence_fireworks, toonhit`); không có cột sáng đúng màu. Shot đang **dùng tạm `laser01`** (tia xanh lá) ở cue khung 0–40.

## Project dùng hiệu ứng
- App 2 cổng 3016, project **"Tập 15 · Shot 03 (Gỗ Xưa)"** `5673640e-bfd9-4a96-8d22-0e8a648ee130`
  (`S:\Claude\w01-samples\tap15v3\projects\`), 30 fps, khung 0–149, shot `shot_03`.
- Hero ở (x −0,6, z 1,2), hạ từ y = 9 m xuống đất ở khung 36 (F-Curve). Cue tạm: `laser01` khung 0–40, tâm (−0,6; 5; 1,2), scale 0,16.
- Xung kích lúc chạm đất đã có: `simple_ring_shape1` (36–100) + `barrior01` (36–62) — giữ nguyên.

## Yêu cầu hiệu ứng mới (tên gợi ý `light_pillar_cyan`)
- **Cột trụ tròn** (hình trụ đứng, tiết diện tròn, nhìn từ mọi phía đều thấy là một ống trụ ánh sáng bao quanh Hero), KHÔNG phải tia laser/chùm tia xoè như `laser01` (người dùng 2026-11-04: "nó phải là cột ánh sáng, là cột trụ tròn").
- Cao ~10 m, đường kính ~1,2–1,5 m (đủ bao Hero); thành trụ sáng mờ, **lõi trắng, viền/quầng cyan** (#5FF3FF tham khảo), có hạt sáng bay lên dọc cột.
- Thời lượng ~40 khung (30 fps): mở nhanh (0–6), giữ sáng trong lúc Hero hạ xuống, **chớp sáng mạnh rồi tắt** khi chạm đất (~khung 36).
- Không lặp (loop false); pivot đáy cột (hoặc ghi rõ pivot để đặt `position.y`).
- **Phải chạy được trong BBS FS thật** (quy tắc App 4 MVP) + có preview sheet trong `vfx-previews` để App 2 hiện.

## Đạt khi
- Thay cue `laser01` của Shot 03 bằng hiệu ứng mới (cùng khung, cùng vị trí), ảnh "Xem như BBS" khung 0, 18, 36 thấy cột trắng-cyan bao
  Hero; xuất film Shot 03 vào BBS FS chạy được, ảnh trong game.
- Không đổi các hiệu ứng có sẵn.
