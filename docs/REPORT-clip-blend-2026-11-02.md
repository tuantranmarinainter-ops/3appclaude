# Báo cáo trộn clip kiểu iClone — 2026-11-02

## Đợt K2 — nối tiếp chỗ đứng + khóa chân

Mẫu đo: bản sao `S:\Claude\w01-samples\clip-blend-k2-projects`, project `e901aadb-453f-4f69-b6f7-8eceda1f41f3`,
Gỗ Xưa, clip A `user_mc_ma65pzdz` (0–58) và B `user_mc_osedj00q` (bắt đầu 44, `blendIn` 15 khung = 0,5 s = 10 tick 20 Hz,
Êm đầu-cuối). Vùng trộn = khung 44–58, B một mình từ khung 59. Lấy mẫu qua `sampleProjectSkeletonRange` ở 20 Hz
(lưới bắt đầu ở khung 2 để khung 44 và 59 rơi đúng tick). Script: `apps/studio/scripts/measureClipBlendK2.mts`.

Cách chạy (không ghi vào project, chỉ đọc `project.json`):

```powershell
$env:BBS_UNIFIED_PROJECTS_DIR='S:\Claude\w01-samples\clip-blend-k2-projects'
pnpm --filter @topview/3d-builder exec tsx <đường dẫn tuyệt đối>\apps\studio\scripts\measureClipBlendK2.mts --out report.json
```

### Cách làm

- Căn chỗ đứng (§10.2): tại khung bắt đầu trộn, điểm gốc = trung điểm hai xương đùi (chiếu lên sàn) và hướng = yaw của vector đùi
  trái–phải, của A (đã áp phép căn riêng của A nếu A cũng có `blendIn`) và của B. Phép căn cứng T = xoay yaw rồi dời, áp lên các nút
  trên cùng của skeleton B ở mọi khung của B (không chỉ trong vùng trộn). `evaluateRootTrajectory` (policy `trajectory`) neo B theo
  tư thế A tại khung bắt đầu trộn và trộn hai root trong vùng trộn.
- Khóa chân: chân chạm đất = tốc độ ngang < 0,3 m/s và điểm thấp nhất bàn chân < 0,1 m so với sàn rest (tính theo tỉ lệ node),
  theo thời gian đã áp speed/lặp (`motionTimeSeconds`), nguồn trội theo trọng số (< 0,5 là A, còn lại là B). Giữ vị trí cổ chân,
  IK 2 xương đùi–cẳng, giữ hướng bàn chân, nhả smoothstep trong 0,125 s (2,5 tick) sao cho về 0 đúng cuối vùng trộn.
  Không có chân chạm đất thì bỏ khóa, dải X ghi "Không khóa chân: không có chân chạm đất".
- Dải X hiển thị: "Clip sau dời X m, xoay Y°" và "Chân trái khóa a–b" (hover + bảng nhỏ).

### Số đo

| Tiêu chí §8 | Ngưỡng | Kết quả | Trạng thái |
| --- | --- | --- | --- |
| Trượt chân (chân trái khóa 44–55,25; chân phải khóa 52–55,25) | ≤ 1 cm | 1,8e-13 cm (trái), 5e-14 cm (phải). Không khóa thì chân trái trượt 37 cm cùng khoảng đó | PASS |
| Chỗ đứng: gốc B ngay khung 59 so với "nối tiếp" (độc lập: T tính từ biến thể chỉ-A và chỉ-B) | ≤ 1 cm, ≤ 1° | 3,8e-7 cm, 0° (mọi khung 59–134: tối đa 3,8e-7 cm, 0°) | PASS |
| Khớp đầu vùng trộn với A | ≤ 1 cm, ≤ 1° | 1e-6 cm, 1e-13° | PASS |
| Dời/xoay áp lên B | — | dời 0,643 m, xoay 0° (A và B cùng hướng) | thông tin |
| Giật gốc: bước root lớn nhất trong vùng trộn | — | 0,68 cm/tick (A một mình 10,6, B một mình 13,9) | thông tin |
| Giật xương: vận tốc góc lớn nhất trong vùng ≤ 1,5 × max(10 tick trước, 10 tick sau) | ≤ 1,5× | **FAIL**: 14/23 xương (xương có tham chiếu ≥ 0,5 rad/s) vượt. Xấu nhất Foot_L 5,06 rad/s so với 0,64 (7,95×), Lower_Leg_L 4,80×, Hand_L 3,85×, Lower_Leg_R 3,35× | FAIL |
| Không hồi quy: hash 99 mẫu project không `blendIn` (K1 so K2) | bit-giống | `e7fbc14f…945f` trùng K1 (6c81c0f) | PASS |
| Không hồi quy: hash 28 mẫu A trước vùng trộn của project có `blendIn` | bit-giống | `8726f2f1…c86` trùng K1 | PASS |
| Film = App 2 (`.dat` so mẫu App 2) | ≤ 0,5° / 2 mm | chưa đo: thuộc đợt K4 (film chưa nối vào hàm trộn trong đợt này; sampler đã dùng chung đường trộn) | NOT_RUN |

Nhận xét về FAIL giật xương:

- Không có khóa chân (chỉ trộn + căn chỗ đứng) vẫn có 12 xương vượt, tệ nhất Hand_L 3,85×. Hai clip có tư thế tay/chân khác xa
  nhau (cast chuẩn bị so với sẵn sàng) và chỉ có 0,5 s để chuyển, nên 1,5× không đạt được bằng trộn thuần.
- Khóa chân làm tệ hơn ở chân trái: hai chân chạm đất nhưng cách nhau 37 cm giữa A và B (B đã căn gốc nhưng bước chân khác). Giữ
  chân tại chỗ rồi nhả trong 0,125 s dịch 37 cm trong 3,75 khung nên Foot_L đạt 7,95×. Thử nhả 0,35 s: trượt chân vẫn 1e-13 cm,
  xương chân trở về mức không khóa (xấu nhất Hand_L 3,85×, 13 xương vượt) nhưng khóa chỉ còn 44–48,5. Đặc tả ghi nhả 2–3 tick
  nên giữ 0,125 s; cần người dùng/đợt K3 chọn (nhả dài hơn, hoặc cho clip sau dời gốc không cứng).

### Kiểm thử

- `packages/builder` vitest: 127 file, 718 test pass, 1 skipped (gồm `clipBlendK2.test.ts` 10 test: toán căn root, phát hiện chân,
  độ mạnh khóa, IK, căn chỗ đứng cả clip, không cộng dồn khi tua, khóa chân có đối chứng không-khóa, không có chân chạm đất, không
  `blendIn` giữ y hệt, `evaluateRootTrajectory` neo theo A).
- `pnpm typecheck` toàn workspace sạch. Studio `tsx --test`: sceneBbsPreview, filmMinecraftFeet, b10MinecraftFloor, bbsPreview,
  skeletonMappingCommand đều pass.

## Đợt K3 — Đảo chân, Khớp nhịp bước, cảnh báo ngược nhịp, nhả khóa chân êm hơn

Mẫu và script như K2 (`measureClipBlendK2.mts`, bản sao `clip-blend-k2-projects`, chỉ đọc). Script có thêm tùy chọn chỉ-trong-bộ-nhớ
`--zone-frames N` (dời B để vùng trộn dài N khung, vẫn kết thúc khung 59), `--mirror`, `--phase-seconds`; không ghi project.json.

### Cách làm

- **Đảo chân** (`blendIn.mirror: true`, file `engine/objects/clipMirror.ts`): lật cả clip sau trên AnimationClip đã bake theo rig
  đích rồi mọi nơi (viewport, sampler, kế hoạch trộn K2, quỹ đạo root) dùng clip đã lật qua `directAnimationFor`. Xương hoán đổi theo
  tên (`Left/Right`, hậu tố `_L/_R`, `.L/.R`; đọc quy ước tên, không sửa `packages/retarget`). Phép quay: lấy delta thế giới so với rest,
  phản chiếu qua mặt phẳng giữa thân (pháp tuyến = trung bình trái trừ phải của các cặp xương lúc rest), đặt lên rest của xương đối xứng
  rồi tính lại quay cục bộ qua FK. Vị trí (root/hông) phản chiếu trong không gian actor, nên đường đi và hướng root cũng lật (rẽ trái
  thành rẽ phải). Phép căn chỗ đứng K2 chạy sau đó trên clip đã lật.
- **Khớp nhịp bước** (`blendIn.phaseOffsetSeconds`): cộng vào thời gian đọc động tác gốc trong `motionTimeSeconds` (sau tốc độ, tôn
  trọng lặp/kẹp/reverse) và vào quỹ đạo root (`trajectoryState`, neo tại điểm bắt đầu đọc nên root vẫn khởi đầu đúng tại neo). Kế hoạch
  trộn tính độ dời nhỏ nhất trong min(1,5 s, một vòng động tác gốc), bước 0,02 s, để chân trước của B trùng chân trước của A; lưu vào
  trạng thái dải X (`suggestedPhaseSeconds`). Nút "Khớp nhịp bước" đặt giá trị này; "Bỏ khớp nhịp" đặt lại.
- **Ngược nhịp**: chân trước = bàn chân xa hơn về phía trước (hướng mặt suy từ hai đùi) so với trung điểm hai đùi, chênh >= 3 cm mới
  tính. So A tại khung bắt đầu trộn với B (đã lật/dời nhịp/căn). Khác nhau thì dải X vàng + chữ "Ngược nhịp bước: chân trước của clip
  sau ngược clip trước — bấm Đảo chân hoặc Khớp nhịp bước" (hover và bảng). Hết khi sửa. Mỗi nút bảng là một bước Undo.
- **Nhả khóa chân**: khi chân còn chạm đất tới hết vùng trộn (đứng ở cả hai clip nhưng lệch chỗ), khóa 100% tới 35% vùng trộn (tối
  thiểu 2 khung) rồi nhả smootherstep (6t^5-15t^4+10t^3) suốt phần còn lại của vùng thay vì 0,125 s cuối vùng. Chân nhấc lên giữa vùng
  vẫn nhả ngắn 0,125 s. Trượt chân chỉ tính trong lúc khóa 100%.

### Số đo (trước = K2 `34d4c88`, sau = K3)

| Tiêu chí | Vùng | Trước | Sau | Trạng thái |
| --- | --- | --- | --- | --- |
| Giật xương, tỉ lệ xấu nhất | 15 khung | 7,95x (Foot_L), 14/23 xương vượt | 3,85x (Hand_L), 13/23 xương vượt | FAIL (còn) |
| Giật xương, tỉ lệ xấu nhất | 30 khung | 3,61x, 4/27 xương vượt | 1,37x (Foot_R), 0/27 vượt | PASS |
| Trượt chân khi khóa 100% (<= 1 cm) | 15 / 30 khung | 1,8e-13 / 1,5e-13 cm | 1,1e-13 / 1,5e-13 cm | PASS |
| Cửa sổ khóa 100% (trái / phải) | 15 khung | 44–55,25 / 52–55,25 | 44–49,25 (nhả 9,75 khung) / 52–54 (nhả 5) | thông tin |
| Cửa sổ khóa 100% (trái / phải) | 30 khung | 29–55,25 / 44–55,25 | 29–39,5 (nhả 19,5) / 44–46 (nhả 13) | thông tin |
| Chỗ đứng sau vùng trộn (<= 1 cm, <= 1 độ) | 15 / 30 khung | PASS | PASS (không đổi) | PASS |
| Đảo chân, sai số đối xứng chân/tay/ngón/hông (clip B thật, so rig gốc) | khung 44–100 | — | 0,011 mm | PASS |
| Không hồi quy: hash 99 mẫu project không `blendIn` | — | `e7fbc14f…945f` | trùng | PASS |
| Không hồi quy: hash 28 mẫu A trước vùng trộn | — | `8726f2f1…c86` | trùng | PASS |

Nhận xét:

- Vùng 15 khung (0,5 s) vẫn FAIL: còn lại là Hand_L 3,85x, đúng bằng mức K2 đo khi KHÔNG khóa chân (hai clip có tư thế tay khác xa và
  chỉ có 0,5 s). Nhả khóa chân đã hạ Foot_L từ 7,95x xuống dưới mức đó, nhưng 1,5x không đạt được bằng trộn thuần ở 0,5 s; vùng trộn
  30 khung (1 s) đạt. Cần người dùng chọn: nới ngưỡng cho vùng 0,5 s hoặc mặc định trộn dài hơn.
- Cặp mẫu thật (Gỗ Xưa 58→59): tại khung bắt đầu trộn A chân trái trước, B chân trái trước nên không ngược nhịp. Bật Đảo chân thì B
  thành chân phải trước và dải báo vàng (đã đo `leadA=left, leadB=right, leadMismatch=true`). Với B thật, không có độ dời nào trong 1,5 s
  đầu của B (đã lật) cho chân trái trước (`suggestedPhaseSeconds=null`), nút Khớp nhịp bước bị khóa và có chú thích; Đảo chân là cách
  sửa cho cặp này. Cặp ngược nhịp tổng hợp (chu kỳ bước 1 s): Khớp nhịp tìm ra 0,26 s và Đảo chân đều làm hết cảnh báo (có test).
- Film (K4) vẫn NOT_RUN.

### Kiểm thử

- `clipBlendK3.test.ts` 13 test: cặp xương Mixamo65/Verity/hậu tố, phản chiếu quaternion (đối chiếu M·R·M), smootherstep nhả khóa,
  `motionTimeSeconds` có độ dời (tốc độ/lặp/kẹp), `setBlendOptions`, đảo chân trên clip tổng hợp (hoán đổi xương, đảo quay Z,
  root x và yaw, đảo hai lần về bản gốc, vị trí xương thế giới đối xứng), quỹ đạo root đảo trái-phải, quỹ đạo root có độ dời nhịp,
  phát hiện/xóa ngược nhịp, đứng yên không báo, tìm độ dời nhỏ nhất, nhả khóa giữ trượt < 1e-4 rồi nhả trơn chậm hơn nhả cũ.
  Thêm 1 test session (Undo từng nút). `packages/builder` vitest 128 file, 732 test pass, 1 skipped. `pnpm typecheck` sạch, studio
  `tsx --test` 5 file pass. Golden và `packages/retarget` không đổi.
