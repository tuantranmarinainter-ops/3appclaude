# Bài học retarget App 1 (đọc trước khi sửa solver/mapping/calibration)

Các lỗi dưới đây đã xảy ra với mẫu thật và đã sửa. Mỗi mục ghi: triệu chứng, nguyên nhân, quy tắc, và chỗ sửa/test.
Đừng sửa lại theo cách đã bị loại.

## Quy tắc chung
1. **Report PASS không có nghĩa là animation đúng.** WC3 Blademaster PASS nhưng nhân vật đích tí hon, bay lơ lửng.
   Với mọi thay đổi, phải đo bằng số trên GLB đã ghi: hông min/max, độ lún, góc bàn chân, độ xoay lớn nhất mỗi khung
   (so với nguồn), rồi chụp/zoom trong Workbench.
2. **Sửa cho rig lạ không được làm đổi kết quả Mixamo.** Chạy lại `Samba Dancing.fbx` → độ trượt chân phải giữ
   nguyên (2.23/2.40 m). Nếu đổi: giới hạn bản sửa theo điều kiện giải phẫu (vd. góc bàn chân rest lệch ≥ 10°).
3. **Khớp không được ghép thì bị loại khỏi rig nguồn** (`pruneToMappedRig`). Pass nào cần khớp nguồn (đầu ngón chân,
   đầu ngón tay) thì phải ghép nó trong alias, nếu không pass đó âm thầm không chạy.
4. **Không dùng yaw của một hướng gần thẳng đứng.** Dùng twist quanh trục đứng của khung khớp: `2·atan2(q.y, q.w)`.
5. Mẫu game (Blizzard/Riot/Mojang) chỉ để test nội bộ, nằm ngoài repo, không commit.

## Từng lỗi
| Triệu chứng | Nguyên nhân | Quy tắc | Code / test |
| --- | --- | --- | --- |
| Nhân vật đích tí hon, bay 127 m hoặc chìm 62 m (WC3) | File ghi đơn vị sai: hông 73 "m"; root travel chép nguyên | Không có `--root-scale` mà hông nguồn ngoài 0.2–3 m → tự dùng hệ số theo tỉ lệ cơ thể (`rootScaleSource: auto-units`) | `cli/normalizeCore.ts` `HUMAN_HIPS_METERS`; `test/groundAdjust.test.ts` |
| Chân lún đất 5–25 cm (LoL Sion) | Hông nguồn thấp hơn so với chân đích | `--ground lift` (mặc định): chỉ nâng root theo trục dọc; sàn = Foot/ToeBase/Toe_End rest của đích; bỏ qua nếu lệch > 50% chiều cao hông | `src/groundAdjust.ts`; `test/groundAdjust.test.ts` |
| Tay đích duỗi thẳng khi nguồn nắm tay (WC3) | Alias wc3r chỉ ghép ngón cái | `finger_L0..L3` = trỏ, giữa, áp út, út (đo khoảng cách gốc ngón tới gốc ngón cái). Kiểm số khớp ghép theo family | `cli/autoMapping.ts` `wc3ReforgedAliases` |
| Nhân vật đích nhón gót 64–78° (WC3) | Calibration A/T chép hướng bàn chân tuyệt đối; cổ chân→khớp đốt ngón WC3 chúi 71°, Mixamo 39° là giải phẫu, không phải tư thế | Bàn chân khác dáng: bỏ swing Foot trong calibration, giữ rest riêng làm tham chiếu, rồi pass `footDirection` lấy thay đổi pitch | `cli/calibration.ts` `DIFFERENT_FOOT_DEGREES`; `src/footDirection.ts` |
| Bàn chân trái giật 59–82°/khung | Lấy yaw từ hướng cổ chân→khớp đốt ngón chúi gần thẳng đứng (nhiễu) | Quy tắc chung 4 | `src/footDirection.ts`; `test/footDirection.test.ts` (wobble) |
| Bàn chân phải lệch hướng (−21..−36° thay vì −42°), ngón chân hếch | Khung cổ chân không xoay theo đế chân; đế chân WC3 là đoạn khớp đốt ngón→đầu ngón; đầu ngón bị prune | Yaw = twist của khớp đốt ngón chân nguồn; ToeBase nhận pitch của đế chân; ghép `Toe_End = foot_*0_1` | `src/footDirection.ts`; `cli/autoMapping.ts` |
| Cẳng tay Steve thành hình nêm (MC20) | Reverse solver dùng swing ngắn nhất → twist tuỳ ý tới 180°; xoay bàn tay Mixamo áp vào `.end` | Bỏ twist cẳng tay/ống chân; Minecraft20 không có cổ tay/ngón: `low_*_arm.end` khoá theo cẳng tay | `cli/toMinecraft20.ts` `untwistLimbs`; `test/cliToMinecraft20.test.ts` |
| Khoá chân (`--foot-lock on`): chân nâng 8 cm, rồi trượt 0.35–0.46 m (Samba) | IK kéo cổ chân lên khi không với tới; sau đó giữ độ cao nhưng kẹp ngang từng khung; không khoá hướng bàn chân | Neo theo cả đoạn chạm (giao vùng với tới, ngân sách cao ≤ 9 mm, tách đoạn + dời neo khi không có neo chung); khoá twist trục đứng Foot/ToeBase. Samba: cổ chân trượt 0.000 m, cao 0 cm, giữ 100% khung chạm. **Ngưỡng trượt điểm thấp nhất ToeBase/Foot phải so với nguồn**, không đặt số tuyệt đối: Samba gốc tự trượt 2.12/2.41 m (bước lướt, lăn gót), sau khoá 1.14/1.18 m | `src/footLock.ts`, `src/footLockAnchors.ts`; `test/footLockSamba.test.ts` |
| Lux quay lưng, đoán sai trái/phải | Rest quay −Z, clip quay +Z; đảo trái/phải theo chuyển động cho kết quả sai ở Samba/Michelle | Xoay tham chiếu rest quanh trục đứng của hông (`restTurnDegrees`); chỉ đảo tên khi ngón chân rest mâu thuẫn tên | `cli/sides.ts`; `test/cliSides.test.ts` |

## Lệnh đo nhanh
- Chạy một mẫu (từ `three-workspace-app/editor/packages/builder`):
  `node --import tsx ../retarget/cli/normalize.ts --src <file> --target ../../../builtin-assets/characters/a3d_char_30ec53c93eae4173946b38639691ebe0.glb --out <dir>`
- Số đo nằm trong `<stem>.report.json`: `proportions` (hệ số root), `ground.perAction`, `roundtrip.perAction[].quality`
  (`penetrationMeters`, `footSlideMeters`, `hipsHeightRangeMeters`), `calibration.corrections`, `mapping.joints`.
- Góc bàn chân và độ xoay mỗi khung: nạp GLB bằng `loadAsset(..., 'glb', { skeletonOnly: true })` + `AnimationMixer`,
  so `Foot→ToeBase` (pitch, yaw) và góc quaternion giữa hai khung liền nhau với nguồn.
