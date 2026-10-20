# Báo cáo CLI `normalize` (App 1) — 2026-10-20

CLI headless: `packages/retarget/cli/normalize.ts`, gọi thẳng `packages/retarget`, không cần host/project.

```powershell
# chạy từ three-workspace-app/editor/packages/builder (để tsx resolve)
node --import tsx ../retarget/cli/normalize.ts --src <file> --target <mixamo65.glb> --out <dir> [--preview]
  [--action <i>] [--unit-meters <n>] [--up y|z] [--root preserve|in-place] [--root-scale <n>]
  [--mapping <preset.json>] [--calibrate limbs|none] [--facing <deg>]
```
Exit: 0 PASS, 1 FAIL/lỗi, 2 BLOCKED. Ra: `<stem>.glb`, `<stem>.manifest.json`, `<stem>.report.json`, `<stem>.preview.png`.

## Kiểm chứng
- Test retarget: **73/73 PASS** (59 cũ + 14 test CLI). `typecheck` + `typecheck:cli`: PASS.
- Target cho mọi lần chạy: `builtin-assets/characters/a3d_char_30ec53c93eae4173946b38639691ebe0.glb` (hông 0.92 m).
- File mẫu nằm ngoài repo (`C:\w01-samples`, thư mục Downloads của người dùng); không commit.
- "PASS" = gate mapping + roundtrip (đọc lại GLB đã ghi). Chất lượng chuyển động được xem qua preview.png, không
  chỉ dựa vào status.

## Kết quả theo mẫu (lần chạy cuối)

| Nhóm | Mẫu | Status | Mapping | Action | Facing / calib max | Hông đích (m) | Ghi chú |
|---|---|---|---|---|---|---|---|
| three.js | Samba Dancing.fbx | PASS | mixamo 65/65 | 18.2 s | 0° / 2° | 0.72–0.99 | FBX, đơn vị cm |
| three.js | Michelle.glb | PASS | mixamo 65/65 | 18.2 s | 0° / 19° | 0.74–0.99 | |
| three.js | Soldier.glb | PASS | mixamo 52/65 | Idle 2.0 s | **180°** / 16° | 0.84–0.85 | thiếu đốt ngón |
| three.js | Xbot.glb | PASS | mixamo 65/65 | 1.8 s | 0° / 1° | 0.91–0.92 | |
| three.js | CesiumMan / Fox / RobotExpressive | BLOCKED | unknown | – | – | – | không phải humanoid chuẩn / tên lạ (đúng kỳ vọng) |
| Mixamo | X Bot / Y Bot Hip Hop | PASS | 65/65 | 7.1 / 13.8 s | 0° / 0–11° | 0.31–0.95 | |
| Mixamo | Mutant Walking (lớn) | PASS | 37/65 | 1.4 s | 0° / 15° | 0.76–0.91 | đi 1.74 m |
| CC/iClone | Female | PASS | cc 46/65 | 5.1 s | 0° / 24° | 0.88–0.91 | |
| CC/iClone | Monster (lớn) | PASS | ue 52/65 | 30 s | 0° / 20° | 0.71–0.76 | rig kiểu UE |
| CC/iClone | male | BLOCKED | – | 0 s | – | – | `ACTION_EMPTY`: chỉ 1 keyframe, cần xuất lại |
| LoL | Lux | PASS | lol 42/65 | Attack1 | **180°** / 58° | 0.81–0.89 | A-pose |
| LoL | Garen | PASS | lol 42/65 | Attack1 | 0° / 67° | 0.33–0.92 | thủ thế thấp |
| LoL | Sion (lớn) | PASS | lol 41/65 | Crit | 0° / 61° | 0.38–**2.01** | cú nhảy chép theo mét; gợi ý `--root-scale 0.77` |
| WC3 | Fel Orc Blademaster | PASS | wc3r 27/65 | Walk 1 | 0° / 55° | 0.82–0.91 | `--unit-meters 0.01` |
| WC3 | Archer | PASS | wc3r 27/65 | Walk 1 | 0° **(ambiguous, đo 45°)** / 100° | 0.95–1.12 | cần người dùng chọn `--facing` |
| WC3 | Mountain Giant (lớn) | BLOCKED | unknown | – | – | – | xương Classic vô danh `bone_b0..59` → cần preset |
| WoW | SeaGiant (Blender GLB) | PASS | wow 28/65 | Walk 4.8 s | **−90°** / 60° | 0.64–0.84 | cần `--root-scale 0.127` (hông nguồn 7.28) |
| WoW | SeaGiant.gltf (wow.export) | FAIL | – | Walk | – | – | shear ở chuỗi tay trái; nghi quaternion chưa chuẩn hoá — chưa kiểm chứng |
| WoW | 6 GLB wow.export cũ | BLOCKED | – | – | – | – | `NO_ACTION` (xuất không kèm animation); đã bị xoá khỏi thư mục |

Tổng: 18 PASS, 9 BLOCKED (đúng lý do), 1 FAIL (wow.export .gltf).

## Thay đổi kèm theo (so với commit 16652ad)
1. **Calibration A/T** (`cli/calibration.ts`, mặc định `--calibrate limbs`): xoay chi của pose tham chiếu nguồn cho
   trùng hướng rest đích, qua `UniversalCalibrationRuntime` có sẵn — không sửa solver. Trước đó nguồn A-pose
   (WC3/LoL/CC) ra tay giang ngang suốt clip dù status PASS.
2. **Căn hướng mặt**: đo yaw từ trục hông, chỉ áp bội số 90°; lệch >15° → `facingAmbiguous`, `--facing` ghi đè.
   Trước đó nguồn quay −Z (Soldier, Lux) bị đánh tay ngược và root đi lùi.
3. **Scale động bị bỏ và ghi report** (`loss.scaleTracks`: số track, độ lệch lớn nhất, xương) theo DECISIONS "mất dữ
   liệu vẫn xuất, ghi rõ" — WC3 thở 1–4 %, nhiễu float32 iClone.
4. **Auto-mapping** thêm family `lol`, `wc3r`, `wow` (gối/Spine1 vô danh của WoW suy theo cấu trúc).
5. **Đọc file**: `.gltf` có `.bin` ngoài (ghép GLB trong bộ nhớ, chỉ đọc cùng thư mục); FBX có texture (stub DOM khi
   parse); bỏ track ngoài rig (vũ khí/mesh/morph) và đếm vào report.
6. Report thêm `proportions` (chiều cao hông nguồn/đích, `--root-scale` gợi ý), `calibration`, `loss`.
7. Sửa line ending: `loadAsset.ts`, `normalizeCore.ts` bị commit CRLF ở 16652ad → LF theo quy ước repo.

## Còn mở
- Hợp đồng GLB v1.0.0 (bước 3): output vẫn prefix `mixamorig`, mỗi GLB một Action (report ghi `contract` FAIL).
- Chưa tự cảnh báo hông đích dưới mặt đất / bay quá cao (Sion, SeaGiant khi không đặt `--root-scale`).
- Archer: chọn `--facing 0` (giữ thế đứng) hay `45`. Mountain Giant: cần preset mapping (hợp UI xác nhận ở Studio).
- SeaGiant.gltf từ wow.export: lỗi shear chưa xử lý.
- Bảng alias UE (ngoài Monster), CC male, WoW còn lại: cần thêm file thật để kiểm.
