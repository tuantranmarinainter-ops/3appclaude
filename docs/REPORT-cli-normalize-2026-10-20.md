# Báo cáo CLI `normalize` (App 1) — 2026-10-20

CLI headless: `packages/retarget/cli/normalize.ts`, gọi thẳng `packages/retarget`, không cần host/project.

```powershell
# chạy từ three-workspace-app/editor/packages/builder (để tsx resolve)
node --import tsx ../retarget/cli/normalize.ts --src <file> --target <mixamo65.glb> --out <dir> [--preview]
  [--action all|<i>[,<i>...]] [--preview-action <i>] [--unit-meters <n>] [--up y|z] [--root preserve|in-place] [--root-scale <n>]
  [--mapping <preset.json>] [--calibrate limbs|none] [--facing <deg>] [--armature <minecraft20-armature.bobj>]
  [--bobj [--bobj-root inPlace|follow] [--bobj-armature <file>]]   # thêm .bobj Minecraft20 cho BBS FS
```
Exit: 0 PASS, 1 FAIL/lỗi, 2 BLOCKED. Ra: `<stem>.glb`, `<stem>.manifest.json`, `<stem>.report.json`, `<stem>.preview.png`.

**Hợp đồng GLB v1.0.0 (bước 3, đã xong):** mặc định xuất **mọi Action** vào một GLB; tên 65 joint đúng Mixamo65 không
prefix (`Hips`, `LeftUpLeg`…); manifest riêng cạnh GLB, mỗi Action một mục (UUID cố định, tên, duration, FPS,
`sourceActionIndex`, `glbAnimationIndex`). Action rỗng / không hỗ trợ / lỗi bị bỏ qua và ghi `skippedActions`, không
chặn cả file. Trên mọi mẫu PASS: `contract` 5/5 PASS (joints65, noNamePrefix, fps30, multiActionInOneGlb, manifestSidecar).

## Kiểm chứng
- Test retarget: **83/83 PASS** (59 cũ + 24 test CLI). `typecheck` + `typecheck:cli`: PASS.
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
| WoW | SeaGiant.gltf (wow.export) | PASS | wow 28/65 | Walk 4.8 s | −90° / 60° | −1.32–0.24 | 1936 track quaternion chuẩn hoá; cần `--root-scale 0.127` |
| WoW | BloodElf Grand Priest (nam, .gltf) | PASS | wow 28/65 | Walk | −90° / 64° | 0.83–0.90 | rig EXP; 11294 quaternion chuẩn hoá |
| WoW | BloodElf Grand Priestess (nữ, .gltf) | PASS | wow 28/65 | Walk | −90° / 62° | 0.85–0.88 | 10763 quaternion chuẩn hoá |
| Minecraft20 | minecraft-actions.bobj (85 action, trong repo) | PASS | minecraft20 13/65 | running 0.87 s | 0° / 90° | 0.26–1.84 (theo action) | 85/85 action, 4.6 s; Foot giữ rest theo cẳng chân |
| WoW | 6 GLB wow.export cũ | BLOCKED | – | – | – | – | `NO_ACTION` (xuất không kèm animation); đã bị xoá khỏi thư mục |

Tổng: 22 PASS, 9 BLOCKED (đúng lý do), 0 FAIL. Cột "Action"/"Hông đích" ở trên là Action preview.

### Xuất nhiều Action (sau bước 3)

| Mẫu | Action xuất / tổng | Bỏ qua | Thời gian | GLB |
|---|---|---|---|---|
| Xbot / Soldier / Michelle | 7/7, 4/4, 2/2 | – | ≤1 s | |
| Samba, X Bot, Y Bot Hip Hop (Mixamo FBX) | 1/2 | 1 `ACTION_EMPTY` (take rỗng của FBX) | ~1 s | |
| LoL Lux / Garen / Sion | 25/25, 44/44, 47/47 | – | 2–3 s | Sion 10.4 MB |
| WC3 Blademaster / Archer | 18/18, 17/17 | – | 1–4 s | |
| WoW SeaGiant (Blender / .gltf) | 63/66 | 3 `ACTION_EMPTY` | 4–5 s | |
| WoW BloodElf Grand Priest / Priestess | 378/407, 372/398 | 29 / 26 `ACTION_EMPTY` | 43 s | Priestess 66 MB |
| Minecraft20 (BOBJ V9.12) | 85/85 | – | 4.6 s | |

GLB lớn là do hợp đồng yêu cầu key mọi frame ở 30 FPS; elf cần `--max-old-space-size=8192`.

## Xuất `.bobj` Minecraft20 cho BBS FS (`--bobj`)

Từ chính GLB Mixamo65 vừa xuất (thứ App 2 nhận) → solver ngược V9.12 → `<stem>.minecraft20.bobj` (định dạng BBSFix:
tick nguyên 20 Hz, Euler XYZ liên tục, `LINEAR`) + `<stem>.minecraft20.preview.png`. File ghi ra được parse và đánh giá
lại bằng `evaluateBobjAction`; sai số vị trí khớp so với solver ghi ở `report.minecraft20.roundtripMaxErrorBlocks`.

| Nhóm | Mẫu | Action .bobj | Sai số đọc lại (block) | Kích thước |
|---|---|---|---|---|
| Mixamo | X Bot / Y Bot Hip Hop / Mutant | 1 / 1 / 1 | ≤1.5e-6 | 0.1–0.5 MB |
| CC | Female / Monster | 1 / 1 | ≤1.1e-6 | 0.2 / 1.2 MB |
| LoL | Garen / Lux / Sion | 44 / 25 / 47 | ≤1.7e-6 | 3.7–4.6 MB |
| WC3 | Blademaster / Archer | 18 / 17 | ≤1.5e-6 | 6.4 MB (Archer) |
| WoW | Grand Priest / Priestess / SeaGiant | 378 / 372 / 63 | ≤1.5e-6 | 21–22 MB / 6.6 MB |

Kiểm chứng: khứ hồi Minecraft20 → GLB Mixamo65 → Minecraft20 trên `emote_t_pose`, `idle`, `running`, `emote_floss`:
hướng tay/chân lệch < 15° so với action gốc. Tên action trùng trong GLB (WC3 Blademaster có hai `Stand 2`) được đổi
kiểu Blender (`Stand 2.001`) vì BOBJ dùng tên làm khoá; tên gốc ghi ở `report.minecraft20.actions[].glbName`.
**Chưa kiểm:** mở file .bobj trong BBS FS thật (cần người dùng thử trong game).

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
6. **Quaternion không đơn vị** (wow.export ghi int16 của WoW nguyên trạng, |q| ≈ 0.99997) được chuẩn hoá và đếm vào
   `loss.quaternionTracks` — đây là nguyên nhân lỗi shear của mọi file .gltf wow.export.
7. Family `wow` hỗ trợ rig nhân vật hiện đại (`EXP_L1_Leg1Twist1`, `EXP_C1_Neck1`), Spine2 = cha chung của hai vai.
8. Report thêm `proportions` (chiều cao hông nguồn/đích, `--root-scale` gợi ý), `calibration`, `loss`.
9. Sửa line ending: `loadAsset.ts`, `normalizeCore.ts` bị commit CRLF ở 16652ad → LF theo quy ước repo.
10. **Bước 3 — hợp đồng GLB v1.0.0** (`cli/glbContract.ts`, `cli/glb.ts`): gộp các GLB một-Action do `normalizeAnimation`
   (dùng chung với Studio, không sửa) bake trên cùng rig đích thành một file, đổi tên skin joint về Mixamo65; manifest
   nhiều Action; report thêm `exportedActions`, `skippedActions`, gate `actions`, `roundtrip.perAction`.
11. **Nguồn Minecraft20 `.bobj`** (DECISIONS bổ sung 2026-10-20; `cli/loadBobj.ts`, `--armature`): dựng rig 20 xương và
   bake mọi action ở 30 FPS bằng `evaluateBobjAction` V9.12 (vị trí khớp evaluator tham chiếu < 1e-5). Rest của
   `body`/`low_body` bị phản chiếu (định thức −1) → mỗi xương dùng hệ trục chỉ-tịnh-tiến, pose đổi W·R⁻¹·C (delta và
   vị trí giữ nguyên). Family `minecraft20`; Foot không có trong rig nguồn → `notInSourceRig`, không chặn.
   Kiểm chứng ngữ nghĩa: `emote_t_pose` → tay đích ngang (<15°), `idle` → tay buông (>60°).
12. **Đầu ra `.bobj` Minecraft20 cho BBS FS** (DECISIONS bổ sung 2026-10-20; `cli/toMinecraft20.ts`, `--bobj`).

## Còn mở
- Chưa tự cảnh báo hông đích dưới mặt đất / bay quá cao (Sion, SeaGiant khi không đặt `--root-scale`).
- Archer: chọn `--facing 0` (giữ thế đứng) hay `45`. Mountain Giant: cần preset mapping (hợp UI xác nhận ở Studio).
- Bảng alias UE (ngoài Monster), CC male, WoW còn lại: cần thêm file thật để kiểm.
