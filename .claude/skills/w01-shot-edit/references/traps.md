# Bẫy đã gặp khi sửa shot (Tập 15 · Shot 03, 2026-11-05)

| Bẫy | Triệu chứng | Cách xử lý |
| --- | --- | --- |
| **userKeys đè fcurves** | Ảnh duyệt đúng, khung 3D sai (Hero "trồi từ dưới đất", Gỗ Xưa lệch trục) | Đọc `extensions.topview.fcurves.userKeys` trước khi sửa. Khoá cũ của người dùng mâu thuẫn với nhịp mới thì gỡ (sau khi người dùng đồng ý đổi nhịp) |
| **Xoay nhân vật bị bỏ khi có clip** | Khoá `transform.rotation` (fcurves) của nhân vật không có tác dụng lúc đang chạy động tác | Đặt hướng/nghiêng nhân vật trong `userKeys[node].rotation` (`{id, frame, value:[x,y,z], interpolation:'linear'}`), lớp này vẫn áp khi có clip |
| **Ẩn bằng đẩy lên cao** | Cất nhân vật ở y=40 thì camera shot không thấy nhưng khung 3D chỉnh sửa vẫn thấy | Ẩn bằng `transform.scale` = 0.001 tới khung trước khi xuất hiện |
| **Bộ lấy mẫu xương bỏ qua fcurve vị trí** | `sampleProjectSkeletonRange().bones[].worldMatrix` không cộng độ cao fcurve của nhân vật | Khi nướng prop theo tay: cộng phần fcurve vị trí của nhân vật vào kết quả |
| **Động tác "Loop" của WoW không có cú lộn** | BackFlipLoop chỉ là tư thế lơ lửng (xương quay ≤10°, hông cao 3,3 m) | Cú lộn thật là **BackFlipStart**. Đo: quay lớn nhất của từng xương trong GLB trước khi tin tên động tác |
| **Root motion trôi lệch** | Nhân vật trôi ngang ~1 m khỏi trục | `motion.binding.set` với `rootPolicy:'in-place'` khi clip chưa chồng clip khác (đặt clip ở khung trống trước, xếp lại bằng `scene.apply`) |
| **Xem trước VFX lặp cả đoạn hiện dần** | Vòm nháy mỗi 91 khung | Nối nhiều cue gối nhau ~8 khung |
| **Rút ngắn shot** | `vfx.cue.update` báo cue không hợp lệ | Sửa cue trước rồi mới rút `timeline.frameEnd` (script `apply_to_real.mts` tự làm) |
| **Euler XYZ ở yaw −90°** | Khoá giữa hai khung bị lật | Khoá dày (mỗi khung ở đoạn chuyển), unwrap ±360 |
| **Prop xuất BBS đứng yên** | Gậy theo tay trong App 2 nhưng không trong film | Chưa hỗ trợ: `docs/BBS-PROP-ANIM-TASK-2026-11-05.md` |
| **library.place đè khung có clip** | "Khung bắt đầu đã có clip khác" | Đặt ở khung trống (sau cuối shot), rồi xếp lại |
| **Nhiều clip trong `document.replace`** | "Project contract validation failed" | `rootMotion.policy` phải khớp `bindings[clip].rootPolicy` và `motion.inPlace`; đổi bằng `motion.binding.set`, không sửa tay |
