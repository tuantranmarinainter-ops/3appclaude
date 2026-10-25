---
name: main-characters
description: Nhân vật chính của phim (2 nhóm rig) và quy ước thư mục BOBJ/texture của BBS FS người dùng đưa (2026-10-23)
metadata:
  node_type: memory
  type: project
  originSessionId: 11be8693-7072-4bca-96c4-df2b88ac30aa
  modified: 2026-10-23T20:05:08.869Z
---

Người dùng chốt 2026-10-23 (đang ghi nhận, chưa làm):
- **Nhóm Minecraft 20 xương**: Gà, Người bí ẩn, Chi Chi, Đen, Hero dùng chung mẫu Minecraft20, chỉ khác skin. Muốn mỗi nhân vật có skin riêng + bộ animation riêng để sang App 2 bấm nhân vật là có sẵn animation; hoặc App 2 tách 1 mô hình thành nhiều nhân vật và chọn animation từ thư viện. Cần Claude đề xuất.
- **Nhóm Verity (giống Mixamo, có Jaw)**: Gỗ Xưa, Tiểu Nhị, Chirity tại `S:\Minecraft\Minecraft Forge-1.20.1\config\bbs\assets\models\3 MODEL DUA VAO APP\` (chỉ đọc).
  - Rig `verity.mdl` 84 xương tên riêng (Root, COG, Pelvis, Upper_Leg_L…, ngón tay, Neck, Head, Jaw, camera), không phải tên mixamorig. Cao 5.83 đơn vị (motion_scale 0.02), cao hơn người thường.
  - Gỗ Xưa và Tiểu Nhị: `model.bbs.bobj` giống hệt từng byte, chỉ khác `textures/verity_body/default.png`.
  - Chirity: thêm 17 xương cánh `Wing_Bone…` (101 xương) + mesh BOW, EYES, Wing_V4_L/R_Wings_gold_0.
  - Chirity: trước mắt chỉ chuẩn hoá xương cơ thể người; xương cánh giữ nguyên (không làm animation cánh) để giảm độ phức tạp.
  - Mỗi file có sẵn 8 action (crouching, crouching_idle, dead, dying, idle, running, sprinting, swipe).
- **Skin MC20 (2026-10-23)**: Codex vẽ (Claude KHÔNG tự vẽ). File gốc dạng lưới mở 1254 px trong
  `C:\Users\Administrator\Downloads\` (`HERO.png`, `Gà.png`, `Dana_Người Bí Ẩn.png`, `Chi Chi.png`, `Đen.png`); Claude cắt mặt
  ghép thành skin 64×64 chuẩn (`C:\w01-samples\mc20-skins-codex\`, script `netskins.py` trong scratchpad) và đặt vào
  `C:\w01-library\characters\<id>\skin.png`. Ngoại hình theo tên file: **Hero** = da xám tóc đen má hồng mắt trắng;
  **Người bí ẩn (Dana)** = cô gái tóc vàng áo trắng-vàng, một chân tất xanh; **Đen** = áo choàng đen-đỏ viền vàng, mặt xám
  đậm; **Gà** = da xanh-vàng, băng đô đỏ, quần nâu; **Chi Chi** = cô gái tím nhạt, nơ đỏ, hoa hồng trên tay.
- **Giữ bộ xương gốc Verity (2026-10-23)**: người dùng KHÔNG muốn mất bộ xương cũ. Animation mới phải chạy trên đúng 85/101 xương gốc;
  cánh Chirity lặp animation cánh có sẵn (từ action gốc); đầu ra cả BOBJ gốc + action mới và GLB cùng bộ xương gốc.
- **Bộ animation riêng từng nhân vật (chốt 2026-10-23)**: kho thô (App 1) → bộ của nhân vật: Nháp → Đã chỉnh (App 3, mỗi lần
  lưu một phiên bản) → Đã duyệt; bản chỉnh thuộc 1 nhân vật, dùng cho nhân vật khác bằng sao chép; hồ sơ tính cách + danh sách
  động tác cần có. Việc giao Codex: `docs/ANIM-LIBRARY-TASKS-2026-10-23.md` (đợt 1 K2b/K3/L1 song song, đợt 2 L2/L3/K5);
  Claude làm L4 (App 3 ↔ thư viện, mở đúng mô hình nhân vật). Codex phải chia subagent, subagent dùng model "sol 5.6" nhẹ.
- **Thư viện Mixamo (đề xuất 2026-10-23, chờ chốt)**: người dùng tự tải FBX từ mixamo.com (Y Bot, FBX 30 fps, Without Skin) vào
  một thư mục và **sẽ đưa thư mục đó** (hẹn 2026-10-24); app không tự đăng nhập/cào Mixamo. Kế hoạch: M1 nhập cả thư mục ở App 1
  (tích chọn → kho dùng chung, có thể gán luôn), M2 lọc/xem thử ở App 5, M3 "Gán cho nhân vật" tự chuyển theo xương (Mixamo65 dùng
  thẳng, Minecraft 20 → .bobj, Verity → bộ xương gốc); App 3 qua L4. Chưa chốt: gán thì chuyển ngay hay chỉ gán link.
  **Xem trước trong thư viện như Mixamo (chốt 2026-10-24):** thẻ animation hiện **video tự chạy lặp** (không phải ảnh tĩnh):
  .webm VP9 ~320×320, 15 fps, 2–3 s, không tiếng (~15–20 KB/clip, đo thật). Chỉ phát khi thẻ hiện trên màn hình.
  **M1 mở rộng (người dùng đồng ý 2026-10-24, chờ giao việc):** App 1 nhập **nhiều file cùng lúc** (thư mục hoặc chọn nhiều
  GLB/FBX/BOBJ, Mixamo chỉ là một trường hợp) → một bảng chung (nhóm theo file, dùng lại bảng chọn A1: tích, đổi tên, thẻ) → chọn
  xuất vào **một nhân vật** và/hoặc **kho dùng chung**. Giao cùng M2/M3 khi người dùng đưa thư mục Mixamo.
- **Mức chuẩn hoá xương**: mức bình thường = Mixamo65; mức đơn giản tối thiểu = Minecraft20.
- **Quy ước texture BBS FS**: mỗi object `o <tên>` trong `.bobj` lấy `textures/<tên>/default.png` (tên có `/` thành thư mục con, vd `verity.mdl/Verity.smd`). Nhập BOBJ vào các app phải giữ quy ước này để không mất texture.
- **Workbench App 1 (ghi nhận)**: khung so sánh, ma-nơ-canh Minecraft 20 (nhân vật + xương) hiện quá to; muốn hiện cùng cỡ với nhân vật Mixamo.
- Người dùng nói bằng giọng đọc: "F2" nghĩa là App 2.

Liên quan [[three-app-pipeline]], [[review-in-app2]].
