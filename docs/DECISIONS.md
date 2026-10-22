# DECISIONS - các quyết định đã chốt (2026-10-20)

## Workflow 3 app
```text
App 1 Chuẩn hóa ──GLB Mixamo65 + manifest──► App 2 Scene: dựng cảnh, cỡ cảnh, camera
                                                │  gói shot (từng nhân vật)
                                                ▼
                                   App 3 Animation: sửa động tác + vị trí nhân vật
                                                │  GLB Action mới + manifest + vị trí
                                                ▼
                                   App 2: ghép film ──► xuất định dạng film BBS/FS
```
- Ba app tách riêng (cùng monorepo được), trao đổi chỉ qua GLB + manifest JSON.
- App 1 là điểm đầu, không nhận dữ liệu quay lại. Hiện chỉ tập trung App 1.
- Chốt lại 2026-10-22: **xuất film BBS FS chỉ từ App 2.** App 3 sửa xong gửi Action về App 2, không tự xuất.

## Đánh số app (2026-10-22)
| Số | App | Vùng code |
| --- | --- | --- |
| 1 | Chuẩn hoá rig/animation | `editor/packages/retarget`, phần normalization của `apps/studio` |
| 2 | Scene: dựng cảnh, camera, ghép + xuất film BBS FS | `editor/packages/builder`, `editor/apps/studio` |
| 3 | Animation Studio (blocking, sửa động tác) | `animation-studio/` |
| **4** | **VFX: Effekseer qua MCP** (nền: effekseer-ai, MIT) | `three-workspace-app/vfx/` |
| **5** | **Thư viện dùng chung** (trước đây gọi App 4) | `editor/packages/library`, `docs/LIBRARY-CONTRACT.md` |
- App 4 VFX: mã `laodeng000/effekseer-ai` (MIT, commit `208922e`) được **chép vào repo chính** tại `three-workspace-app/vfx/`
  (giữ LICENSE gốc + ghi nguồn) để Codex cloud làm được; DLL Effekseer/.NET không commit. Kế hoạch: `docs/VFX-APP4-PLAN.md`
  (DRAFT, bắt đầu từ giai đoạn 0: xác minh runtime + render tự động trên máy Windows).
- **MVP App 4 (người dùng chốt 2026-10-22): mọi hiệu ứng xuất vào BBS FS phải chạy được trong BBS FS thật.**
  BBS nâng từ giai đoạn 5 lên MVP. Hướng chốt 2026-10-22: **chuyển Effekseer → particle BBS FS 2.4 (Snowstorm JSON) trước**
  (chạy native, chặn tính năng không hỗ trợ khi xuất); song song khảo sát addon gọi AAA Particles. Không đưa vào gói BBS FS hiệu ứng chưa kiểm chạy; tính năng ngoài khả năng của
  bản BBS/AAA thật thì chặn hoặc cảnh báo khi xuất. Gate "chạy trong BBS FS" tách riêng khỏi gate cấu trúc/hình/hiệu năng.

## Input/Output
| App | Vào | Ra |
| --- | --- | --- |
| 1 Chuẩn hóa | FBX/GLB/glTF nguồn bất kỳ, `.bobj` Minecraft20; mapping, calibration, Action, chế độ xuất | GLB Mixamo65 (Animation-only hoặc Model+Rig+Animation) + manifest JSON + report JSON; tuỳ chọn `.bobj` action Minecraft20 cho BBS FS |
| 2 Scene | GLB từ App 1; prop/cảnh GLB trực tiếp; Action đã sửa + vị trí từ App 3 | Gói shot cho App 3; film BBS/FS chứa toàn bộ nội dung BBS/FS đọc được + project cảnh |
| 3 Animation | Gói shot (shot JSON: camera, khoảng frame, vị trí, clip + GLB nhân vật + GLB tham chiếu chỉ xem) | GLB Action đã sửa (UUID mới, ghi UUID gốc) + manifest + vị trí mới + project App 3 |
- App 3 sửa được động tác + vị trí nhân vật được chọn; camera/nhân vật khác chỉ xem.
- App 3 = Animation Studio 1.31.8 của người dùng (2026-10-21): giữ mọi chức năng, chức năng mới chỉ thêm qua
  `host-bridge.js`/broker. Ngoại lệ: bỏ phần nhập Warcraft (MDX/MDL/DDS, Reforged) khỏi phạm vi App 3 vì app khác
  của người dùng đã lo; không kiểm/sửa phần đó. Ghép xương Warcraft (`wc3r`) của App 1 vẫn giữ.
- App 2 nhận Action mới thì thay clip bằng UUID mới, giữ Action gốc.
- Chốt 2026-10-22: vị trí sửa ở App 3 lưu thành key vị trí riêng trong cảnh (`placementKeys`), **giữ nguyên root
  của Action** (tránh cộng root hai lần; Action dùng lại được). G2b đã làm theo cách này.
- Chốt 2026-10-22 (người dùng xác nhận lại): đích là **BBS FS 2.4** ("chính là 2.4 bbs fs") — đúng worker film hiện tại.
  Instance của người dùng: `S:\Minecraft\Minecraft Forge-1.20.1` (Forge 47.4.10 + Sinytra Connector chạy mod Fabric),
  jar `bbs fs-2.4-1.20.1.jar`, thư mục `config/bbs/assets/particles`. Không có AAA Particles. Mã nguồn 2.4 = `0085f77`.
  (Nhắc "2.7" trước đó là nhầm; 2.7 có sẵn bộ đọc film 2.4 nếu sau này nâng cấp.)

## Hợp đồng GLB trao đổi v1.0.0
File GLB:
- Y-up, mét (chuẩn glTF).
- Đúng 65 joint Mixamo, tên KHÔNG prefix (`Hips`, `Spine`...).
- Rest pose: T-pose chuẩn cố định. Nhánh có mesh: giữ mesh ở tư thế gốc (vd A-pose), bind theo
  tư thế đó; T-pose chỉ là tham chiếu animation.
- Bake 30 FPS cố định, key mọi frame, giữ duration.
- Root dạng skeletal; app nhận chọn in-place/trajectory.
- Nhiều Action trong một file.
- Skin tối đa 4 influence/vertex, tổng weight = 1.
- Texture nhúng trong GLB.
Manifest JSON (file riêng cạnh GLB):
- Version semver, bắt đầu `1.0.0`.
- Mỗi Action: UUID cố định + tên hiển thị, duration, FPS.
- Root policy, nguồn gốc, SHA-256 của GLB.
- Chiều dài xương + chiều cao hông (fingerprint để biết khi nào retarget lại).
Mất dữ liệu: vẫn xuất, ghi rõ trong report; chỉ chặn khi vertex mất toàn bộ influence hoặc
thiếu role chính.

## App 1 - đầu vào/đầu ra chi tiết
- Vào: FBX/GLB/glTF có skeleton + rest + ≥1 Action (mesh/skin nếu xuất model). MVP: humanoid,
  một armature, animation đã bake. Không mở .uasset/.ma/.mb/.iMotion/file game gốc.
- Bổ sung 2026-10-20: nhận thêm `.bobj` Minecraft20 (BBS/Blockbuster V9.12: armature `arm_bone` + action `an`)
  làm nguồn animation, để áp animation Minecraft20 ngược lại cho Mixamo65. Dữ liệu mẫu có sẵn trong repo
  (`apps/studio/public/retarget/v9.12`, 85 action, GPL-3.0). Rig không có bàn chân/ngón: Foot đích giữ rest
  theo cẳng chân, không tính là thiếu role chính.
- Lựa chọn: skeleton/Action/range/FPS; mapping (gợi ý + xác nhận); reference pose + A/T
  calibration; root giữ mét (mặc định) hoặc scale; xương loại trừ + xử lý skin; chế độ xuất.
- Không thuộc App 1: dựng cảnh, sửa keyframe, xuất FBX (sau MVP), xuất Film/BBS.
- Bổ sung 2026-10-20: App 1 xuất thêm (tuỳ chọn) `.bobj` **action** Minecraft20 cho BBS FS, đi từ chính GLB Mixamo65
  đã xuất qua solver ngược V9.12 (Mixamo65→Minecraft20). Đây là action/animation, không phải film BBS — film vẫn
  thuộc App 2. Định dạng theo exporter BBSFix: tick nguyên 20 Hz, Euler XYZ, `LINEAR`.
- Quyết định 2026-10-21 (người dùng xem video Samba tắt/bật): **khoá chân `--foot-lock` giữ mặc định `off`**, không bật
  mặc định, không thêm vào Workbench. Bản bật (D1/D1b) hết trượt cổ chân nhưng giật, không tự nhiên. Chỉ mở lại khi có
  cách chuyển mượt cho khe ngắn giữa hai lần chạm, và phải qua so sánh video + đo gia tốc xoay chân (xem
  `docs/RETARGET-LESSONS.md`).
- Quyết định 2026-10-21 (người dùng): **App 1 ưu tiên cổ tay chính xác, không cần ngón tay chính xác.** Thế tay (cuộn/thả lỏng)
  chỉnh ở App 3 bằng Edit Motion Layer; sau này có **thư viện thế tay** (chọn thế tay có sẵn, thay vào keyframe, chỉnh nhẹ).
  Bản ghép ngón WoW/LoL (D2: thêm ngón út + đốt Tip WoW, đốt đầu ngón gập 2/3 đốt giữa) để riêng ở nhánh
  `claude/d2-fingers`, chưa merge, chờ người dùng thử.
- Quyết định 2026-10-21 (người dùng, dựng storyboard): **nhân vật Minecraft (Steve/Herobrine, Enderman, Gà) dùng khung
  Minecraft20 20 xương**, lưới khối hộp theo tỉ lệ Steve, tô màu (không dùng skin Mojang); chạy thẳng 85 Action V9.12 theo
  tên xương, không retarget (`packages/retarget/cli/minecraftBlockCharacters.ts`). **Gỗ Xưa dùng Mixamo65, màu xanh lá**
  (nhân vật Man builtin tô lại, `apps/studio/scripts/recolorCharacter.mts`). **121 pose Topview** chuyển thành Action
  Mixamo65 một khung giữ 1 s (`apps/studio/scripts/topviewPosesToActions.mts`) để dùng được ở Studio, render, film, App 3.
- Quyết định 2026-10-22 (người dùng): **rig mở rộng (EPIC-J)** = lõi Mixamo65 giữ nguyên + xương phụ tên
  `X_<xươngCha>_<tên>` (hàm, đuôi, cánh, áo choàng, vũ khí đợt đầu); GLB hợp đồng v1.1 có `rig: "mixamo65+<tên>"` và
  `extraBones`; v1.0 vẫn hợp lệ. Giao Codex 3 task: J-A (#37, retarget, sau D #36), J-B (#38, App 2), J-C (#39, App 3,
  sau silhouette App 3). Nhân vật Minecraft20 chưa có xương phụ; gậy/áo choàng gắn dạng prop theo tay.

## Kết quả rà soát bàn giao Codex (DOC-116)
- Quy mô W01: retarget/src 18 file (~137 KB), host+UI ~7k dòng, ~28 file test.
- DOC-116 ghi: retarget 59 PASS, studio 33 PASS/1 SKIP, Python 47 PASS, builder 557 PASS.
  Production build Studio lỗi EPERM (Windows AppData). 0/17 task, 0/8 gate nghiệm thu.
- Solver `universal.ts` hợp lý: world-delta rotation, giữ chiều dài xương đích, root theo mét ×
  scale, chặn shear/scale động, chain trọng số, local-compose.
- Không có pipeline headless: mọi luồng đi qua host Next.js + project (rig plan/run/save).
- Lệch hợp đồng: (1) output giữ tên `mixamorig:Hips`; (2) `normalizeAnimation` xuất 1 Action/GLB;
  (3) chưa có manifest JSON riêng.
- Đạt: Y-up mét; 4 nhân vật builtin đều T-pose (tay ngang 0°), cao 1.03-1.79 m.
- Chưa có nguồn non-Mixamo thật (CC/UE) - người dùng sẽ cung cấp.

## Ước lượng
- Demo hẹp (1 nguồn → Mixamo65 → GLB mở được): vài giờ khi có file mẫu.
- MVP test được (2 nguồn, calibration A/T, report): 2-5 ngày.
- Đủ W01: 2-6 tuần, chủ yếu thời gian kiểm tra và sửa với dữ liệu thật.