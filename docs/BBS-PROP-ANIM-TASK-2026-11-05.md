# Prop chuyển động + texture động trong film BBS FS: đặc tả 2026-11-05

> Người dùng chốt 2026-11-05 (phần BBS giao Codex). Mục ghi **[Claude chốt]** là quyết định thay người dùng, đổi được.
> Đọc trước: `CLAUDE.md`, `docs/DECISIONS.md`, `docs/APP2-SPLIT-LARGE-FILES-TASK-2026-11-05.md` (đợt tách `unifiedJobs.ts`),
> PR #228 (texture động cho prop trong App 2, nhánh `claude/shot03-rainbow-rod`).

## 1. Vì sao
Tập 15 · Shot 03 (Gỗ Xưa): Hero rơi từ trên cao xuống, tay cầm **gậy cầu vồng Spectrite**; gậy là *prop* được khoá từng khung
(150 khoá vị trí/xoay, khung 60–209) để bám xương tay `low_right_arm_end` của Hero. Đầu và thân gậy **đổi màu cầu vồng**
(texture 36 khung, 1 khung mỗi tick Minecraft, chu kỳ 1,8 giây). Trong App 2 đã đúng (PR #228). Xuất film BBS FS thì gậy
**đứng yên ở vị trí khung đầu và không đổi màu**. Người dùng duyệt film trong BBS FS thật, nên phải chạy đúng ở đó.

## 2. Hiện trạng (đã kiểm code, main 71e5ff4 + PR #228)
- `apps/studio/src/unifiedJobs.ts: appendFilmBackdropActors`: prop vào film thành actor `prop:<nodeId>` với **2 mẫu transform**
  (`tick 0` và `durationTicks`), lấy từ `filmSceneWorldMatrices(project, sourceFrame)` ở **một** khung, `poseTracks: []`. Comment ghi rõ
  "static backdrop actors".
- `unifiedFilmSampling.ts`: `propIds` mô tả là "Static scene backdrops … unanimated model actors".
- `agent/film_worker/blender/convert_model.py`: prop không xương được thêm một xương `root`, xuất BOBJ + **một** `model.png`
  (nhiều ảnh thì báo lỗi). Với gậy Spectrite, `model.png` là cả dải 32×1152 (36 khung), UV của mesh chỉ trỏ khung 0.
- GLB gậy: `apps/studio/scripts/build-mc-animated-prop-glb.py` (PR #228). Vật liệu có
  `extras.w01TextureAnimation = { version:1, layout:'vertical-strip', frameCount:36, frameOrder:[0..35], frametimeTicks:1,
  ticksPerSecond:20, interpolate:false, uvFrame:0 }`. App 2 đọc ở `packages/builder/src/engine/objects/propTextureAnimation.ts`
  (`propTextureFrameAt` = công thức chuẩn chọn khung).
- Khoá prop nằm ở `extensions.topview.fcurves` (`transform.position|rotation`, node của prop). `projectEvaluationScene` đã nạp
  fcurves; việc còn thiếu là lấy mẫu transform prop **mỗi tick** thay vì một khung.
- Lưu ý đo được khi làm Shot 03: `sampleProjectSkeletonRange(...).bones[].worldMatrix` **không cộng** fcurve vị trí của node nhân vật
  (Hero rơi bằng fcurve `transform.position[1]` 60:7 → 93:0 nhưng tay lấy mẫu vẫn ở mặt đất). Cần kiểm actor nhân vật trong film
  (`actorWorldMatrix`/transformSamples) có rơi đúng không — xem G4.

## 3. Người dùng đã chốt
| # | Câu | Chốt |
| --- | --- | --- |
| 1 | Gậy chuyển động thế nào | Bám tay Hero; tạm thời bằng khoá từng khung trên prop (không làm tính năng gắn prop vào xương) |
| 2 | Đổi màu chạy ở đâu | App 2 **và** BBS FS |
| 3 | Phần BBS ai làm | Giao Codex |
| 4 | Cách đổi màu trong BBS | **[Claude chốt]** builder chọn theo kết quả thử trong game: (a) keyframe thuộc tính texture của form theo tick, hoặc (b) PNG động + `.mcmeta` nếu BBS 2.7 đọc được. Chọn cái chạy được trong BBS thật, ít file nhất |

## 4. Mục tiêu / không làm / coi là hỏng
**Mục tiêu**
- G1: Prop có fcurve → actor film có transform **mỗi tick** (vị trí + xoay), khớp App 2.
- G2: Prop không fcurve vẫn xuất như cũ (2 mẫu), không đổi byte của film Shot 01 (trừ thời gian).
- G3: Prop có `extras.w01TextureAnimation` → trong BBS đổi khung texture theo `propTextureFrameAt` (cùng công thức với App 2).
- G4: Kiểm nhân vật có fcurve vị trí (Hero rơi 60→93, Gỗ Xưa bật lùi 98→116) di chuyển đúng trong film. Sai thì sửa trong đợt này.

**Không làm (đợt này)**: gắn prop vào xương (parent bone) như tính năng; nội suy màu (`interpolate:true`); UI mới trong App 2.

**Coi là hỏng dù "chạy được"**
- Gậy trong BBS lệch tay Hero > 5 cm hoặc > 5° ở bất kỳ khung đo nào (mục 8).
- Màu gậy trong BBS đứng yên, hoặc lệch pha > 1 tick so với App 2 ở khung đo.
- Film Shot 01 (không có prop động) đổi nội dung.

## 5. Trải nghiệm người dùng
Không có nút mới. Người dùng mở Shot 03 trong App 2 → **Xuất ▾ → Gói BBS FS** như cũ → cài vào game (khi game tắt) → mở film:
gậy theo tay Hero suốt lúc rơi/đáp/nói, đổi màu cầu vồng liên tục. Bảng Xuất film nếu có cảnh báo thì tiếng Việt.

## 6. Thiết kế kỹ thuật (hướng, builder tự quyết chi tiết)
- `appendFilmBackdropActors`: nếu prop có fcurve trong khoảng xuất → `transformSamples` mỗi tick (dùng lại cách lấy mẫu của nhân vật,
  `filmSceneWorldMatrices` cho từng khung nguồn, đổi khung → tick như camera/nhân vật). Không fcurve → giữ 2 mẫu.
- Texture động: đọc `extras.w01TextureAnimation` khi convert prop (Blender giữ extras ở material custom props, hoặc đọc thẳng GLB
  trong studio). Hướng (a): xuất 36 PNG (hoặc 1 dải + UV từng khung) và keyframe texture của form theo tick (step). Hướng (b):
  `model.png` = dải gốc + `model.png.mcmeta`, UV phủ cả khung (BBS/Minecraft tự cắt khung). Thử (b) trước vì 1 file; BBS không đọc
  `.mcmeta` thì làm (a).
- Dùng lại đọc/ghi film đã có (`filmManifest.ts`, `FilmExportWorker.java`/`DraftEditor.java`, `BbsCodec` để đọc lại `.dat`).
- Đụng độ: đợt P3 của tách file App 2 chuyển `unifiedJobs.ts` → `jobs/*`. Bắt đầu từ main mới nhất; nếu P3 merge trước thì sửa ở
  file mới, nếu chưa thì sửa `unifiedJobs.ts` và báo để P3 rebase.

## 7. Chia đợt
| Đợt | Nội dung | Xong khi |
| --- | --- | --- |
| B1 | G1 + G2 + G4: prop có fcurve xuất transform mỗi tick; kiểm nhân vật có fcurve vị trí | Test studio mới cho prop động + prop tĩnh; đo mục 8.1, 8.2 trên `.dat` |
| B2 | G3: texture động trong BBS (thử b, rồi a) | Đo mục 8.3; người dùng xem trong game |

Mỗi đợt một nhánh `claude/bbs-prop-anim-b<n>`, B1 tạo từ main (cần PR #228 đã merge; chưa merge thì đặt base = `claude/shot03-rainbow-rod`),
B2 xếp chồng lên B1. Không tự merge.

## 8. Đo số (bắt buộc)
Dữ liệu: bản sao project Shot 03 mà Claude đã dựng: `S:\Claude\w01-samples\s3rod-projects\5673640e-bfd9-4a96-8d22-0e8a648ee130`
(rev ≥ 254) + thư viện `S:\Claude\w01-samples\s3rod-lib`. **Chép tiếp ra bản sao của mình** trước khi chạy (skill `w01-test-sandbox`).
Shot 01 đối chứng: `S:/Claude/w01-samples/tall-projects`.
1. **Gậy theo tay (G1)**: giải mã `.dat` (BbsCodec), so vị trí/xoay actor gậy với khoá App 2 ở khung nguồn 60, 75, 93, 100, 130, 170, 209.
   Ngưỡng ≤ 1 cm, ≤ 1° (cùng hệ toạ độ film, sau `FILM_MODEL_FACING_OFFSET`). Ghi bảng 7 dòng.
2. **Nhân vật có fcurve (G4)**: độ cao Hero ở khung 60/75/93 trong `.dat` = 7 / 3,82 / 0 m (± 2 cm) theo đơn vị film; Gỗ Xưa
   x ở 98/110/116 = 2,4 / 3,8 / 4,0 (± 2 cm). **Shot 01**: hash nội dung film (bỏ thời gian) giống trước khi sửa.
3. **Màu (G3)**: khung texture ở tick 0, 1, 2, 35, 36, 100 = 0, 1, 2, 35, 0, 28 (theo `propTextureFrameAt`). Chứng minh bằng `.dat`/file
   xuất (keyframe hoặc mcmeta) + ảnh chụp trong game 2 tick cách nhau thấy màu khác.
Report `docs/REPORT-BBS-PROP-ANIM-2026-11-xx.md`. Trạng thái NOT_RUN / BLOCKED / FAIL / PASS.

## 9. Bài test thủ công (người dùng)
1. Mở Shot 03 trong App 2 (bản sao), Xuất ▾ → Gói BBS FS, cài khi game tắt.
2. Trong BBS FS mở film: khung 60–93 gậy rơi theo tay Hero; 96–130 Hero đáp, gậy vẫn trong tay; 130–209 Hero nói, gậy đổi màu liên tục.
3. Gỗ Xưa bị bật lùi rồi lộn người lơ lửng trên cao tới hết shot; Đen nằm trong vòm.

## 10. Câu hỏi của người đọc kiểm tra: Claude chốt
1. **Thử trong game (B2, ảnh 2 tick)**: [Claude chốt] builder được tự mở game instance Forge của người dùng **khi người dùng không
   chơi**, cài film vào một world thử (không phải "Thế giới mới (1)"), chụp ảnh, tắt game rồi mới cài/gỡ file. Không mở được thì
   B2 = BLOCKED "chờ người dùng xem", vẫn nộp PR với cả hai hướng (a)/(b) được chuẩn bị và đo bằng `.dat`.
2. **Gậy lấy vị trí từ đâu**: từ **fcurve của prop** (đã khoá bám tay trong App 2), không lấy từ xương. G4 chỉ kiểm actor *nhân vật*
   có fcurve vị trí; lỗi "worldMatrix không cộng fcurve" là của bộ lấy mẫu xương, chưa chắc film sai — đo rồi mới sửa.
3. **Hệ toạ độ đo 8.1**: so actor gậy với actor Hero trong cùng `.dat` (vị trí gậy − vị trí Hero) và với App 2 (khoá gậy − vị trí node
   Hero) ở cùng khung; cách này không phụ thuộc offset quay 180°/xương `root`. Ngưỡng ≤ 1 cm, ≤ 1°.
4. **Đơn vị/nội suy 8.2**: số trong mục 8.2 là mét thế giới App 2 (toạ độ thế giới, Gỗ Xưa là x thế giới). Fcurve Hero là `linear`
   (60:7 → 93:0) nên khung 75 = 3,818 m. Film đổi sang đơn vị BBS theo cách nhân vật đang dùng; báo cả hai số.
5. **Khung → tick**: App 2 Shot 03 là 30 fps, film 20 tick/s; lấy mẫu prop đúng như nhân vật (cùng hàm đổi khung → tick). Ngưỡng
   8.1 so tại 7 khung nguồn trùng tick nguyên (60, 75, 93… dùng tick gần nhất, ghi rõ). Pha texture tính từ tick 0 của **shot**
   (khớp App 2: khung timeline 0 = khung texture 0).
6. **Baseline Shot 01**: chụp hash trước khi sửa trên commit base của B1 (main có/không #228 đều được, ghi commit). Hash = sha256 nội
   dung `.dat` giải mã sau khi bỏ trường thời gian/ID job.
7. **Base nhánh/xung đột**: như mục 7; P3 merge giữa chừng thì rebase, không cần hỏi.
8. **UV cho hướng (b)**: chỉ sửa UV **ở bước convert BOBJ** (bản sao trong job); không sửa GLB gốc và không đổi `uvFrame:0`.
9. **Dữ liệu mẫu**: `s3rod-projects`/`s3rod-lib` là thư mục thật (đã gỡ junction khi tạo), Shot 03 ở rev 254. Vẫn chép ra bản sao
   riêng bằng skill `w01-test-sandbox` (dereference).
10. **Người dùng xác nhận**: có, mục 9 là bài người dùng xem cuối cùng; PASS kỹ thuật dựa trên số đo mục 8.

## 11. Builder tự quyết
Chọn hướng (a)/(b) theo thử trong game; cách lưu extras qua Blender; tên file PNG; cấu trúc test.

## 12. Ràng buộc
Không sửa `packages/retarget` (trừ test), không đổi golden, không commit binary/kho thật/project thật. Test trên bản sao, luôn đặt
`W01_LIBRARY` bản sao. Không ghi `S:\Claude\w01-samples\tap15v3` (project thật). Chỉ cài film vào game khi game tắt
(`Get-Process java,javaw`), không xoá phim của người dùng. Không đụng cổng 3016/3002/3131. UI tiếng Việt, nền tối.
`pnpm typecheck` toàn workspace trước push.
