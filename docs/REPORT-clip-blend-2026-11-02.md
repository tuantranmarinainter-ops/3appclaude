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
