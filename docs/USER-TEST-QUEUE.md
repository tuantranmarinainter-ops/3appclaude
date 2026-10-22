# Việc người dùng cần thử khi về máy (chuẩn bị 2026-10-21)

Mọi file nằm trong `C:\w01-samples\test-queue\` (ngoài repo). Claude đã kiểm bằng số đo trên máy; các mục dưới cần
**mắt người** hoặc **game thật**. Ghi kết quả (đạt/lỗi + ảnh) để Claude sửa tiếp.

## 1. BBS FS trong game (quan trọng nhất)
| File | Cách thử | Đạt khi |
| --- | --- | --- |
| `C2-chuoi-3-app.bbs-film.zip` (H3, cả cảnh) | Giải nén; chép `films/` và `assets/` vào thư mục asset tương ứng của BBS FS; mở Film Editor | Có 2 nhân vật, 1 camera; nhân vật A giơ tay trái lệch B ~60° quanh giây 0,4; không lún/bay |
| `c2-film.zip` (film.export cũ, cùng cảnh) | Như trên | Giống mục trên |
| `bobj/*.minecraft20.bobj` (App 1, code mới nhất có D4 thân trên) | Nạp vào model Steve/Minecraft20 trong BBS FS | Thân trên không xô lệch; cẳng tay không thành hình nêm; chân không đảo |

Đã kiểm trên máy: `.dat` đọc lại bằng codec BBS (nativeReadback), BOBJ đọc lại đủ 20 xương. **Chưa** chạy trong game.

### Tập 15 (thêm 2026-10-22)
| File | Cách thử | Đạt khi |
| --- | --- | --- |
| `tap15-film/Tap15-seg1..10.bbs-film.zip` (10 đoạn, 73 s) | Như trên; mở lần lượt seg1 → seg10 | Nhân vật khối Minecraft (Herobrine, Đen, Gà, Người bí ẩn) và Gỗ Xưa đúng chỗ, đúng động tác; camera cắt đúng shot. Bị chia 10 đoạn vì worker giới hạn 255 tick + 3 camera + ngân sách xương mỗi film |
| `tap15-previz-shorts.mp4` | Xem trên điện thoại | Đối chiếu storyboard; chưa có hiệu ứng |

## 2. File cảnh mở bằng Blender
| File | Đạt khi |
| --- | --- |
| `c2-scene.glb`, `scene.blend`, `scene.fbx` (H1/H2) | Mở được; 2 nhân vật + camera; animation 0–23. **FBX: khi Import đặt Animation Offset = 0** (mặc định 1 làm trễ 1 frame) |

Đã kiểm tự động (test H4): 48 điểm xương khớp `scene.evaluate` < 0.005 mm.

## 3. Xem bằng mắt
| File | Nội dung | Trạng thái |
| --- | --- | --- |
| `samba-footlock-off-vs-on-*.mp4` | Khoá chân tắt / bật | Người dùng đã xem: bật bị giật → giữ **tắt** (DECISIONS) |
| `g4-before.png`, `g4-after.png` | AI dựng cảnh qua MCP: "A trái B 1,5 m, nhìn nhau, trung cảnh góc cao" | Chờ xem; biết trước: "trung cảnh" vẫn lấy cả người (G3b đang giao Codex) |
| `d2-hands-compare.png` | Ngón tay WoW/LoL: nguồn / cũ / mới | Tạm gác; code ở nhánh `claude/d2-fingers`, chưa merge |

## 4. Quyết định còn chờ
- Đã chốt 2026-10-22: vị trí App 3 = `placementKeys` giữ root Action; duyệt 4 điểm thư viện App 5; giữ nhánh
  `claude/d2-fingers` chưa merge; VFX → particle BBS trước; người dùng chơi BBS FS **2.7**.
- Còn hỏi: thư mục Minecraft 1.20.1 Fabric đang chơi, có AAA Particles không.

## Ghi chú kỹ thuật
- Film export lỗi `FileNotFoundError ... .film-m...` nếu thư mục project quá sâu (giới hạn 260 ký tự đường dẫn của Windows).
  Thư mục project mặc định của Studio đủ ngắn.
