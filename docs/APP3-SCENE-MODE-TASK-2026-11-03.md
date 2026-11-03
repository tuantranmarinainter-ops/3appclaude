# App 3: chế độ "1 khung · Cả cảnh": đặc tả 2026-11-03

> Người dùng trả lời 14 câu ngày 2026-11-03 (chọn A cho câu 1–12). Mục ghi **[Claude chốt]** là quyết định thay người dùng,
> người dùng có thể đổi.
> Đọc trước: `CLAUDE.md`, `docs/DECISIONS.md`, memory "App 3 giữ Animation Studio" (không bỏ chức năng nào, thêm qua bridge),
> `docs/CLIP-BLEND-TASK-2026-11-02.md` (chuỗi clip, gộp clip, lưu Thư viện).

## 1. Vì sao

Ở F2 (Dựng cảnh), 2–5 nhân vật đứng đúng chỗ và chạy animation cùng nhau. Sang F3 (App 3) hiện chỉ mở được **một nhân vật mỗi lần**.
Người dùng không thấy nhân vật kia nên khó chỉnh tương tác (nhìn nhau, chạm tay, đánh nhau…).
Người dùng muốn một khung 3D hiện cả cảnh như F2, phát đồng bộ, và **click vào nhân vật nào thì sửa nhân vật đó**.
Theo người dùng, "chỉ app này mới có": không có phần mềm mẫu để bắt chước.

## 2. Hiện trạng (đã kiểm code)

- **Gói shot đã chứa mọi nhân vật.** `apps/studio/src/shotExchange.ts` `createShotPackage`: `shot.characters[]` có tất cả nhân vật được clip phủ,
  mỗi nhân vật có GLB, manifest, clip, `placement` và cờ `editable`. Gói cũng có `references[]` (đạo cụ).
- **Chỉ một nhân vật được sửa.** `apps/studio/src/app3Artifacts.ts` `prepareShot`: `editable.length !== 1` → `CONTRACT_UNSUPPORTED`.
  `shot_controller.js` `openFiles` chỉ đọc `shot.characters.find(c => c.editable)` và bỏ qua nhân vật khác cùng references.
- **Chuỗi clip (#204).** Chọn nhân vật thì lấy cả chuỗi clip (trộn hoặc liền nhau), nướng sẵn qua `shotBake.ts`; trả về gộp một clip,
  lưu Thư viện (`shotResult.ts`, `addCharacterActionFromGlb`).
- **App 3 có sẵn chế độ cảnh riêng** ("Dựng cảnh" trong menu "…", file `scene_studio.js`, `scene_controller.js`, `scene_evaluator.js`:
  actor, clip, placement mét, Z-up). Có thể dùng lại cách đặt nhiều actor, nhưng **không** thay thế chế độ đó.
- **B66 (#202).** Đang mở shot nhân vật A mà chọn B thì phải trả hoặc bỏ A. Chế độ mới thay luồng này bằng chuyển qua lại tự do (câu 6A).

## 3. Người dùng đã chốt

| # | Câu | Chốt |
| --- | --- | --- |
| 1 | Cái gì hiện trong khung | **Chỉ nhân vật + nền đất phẳng** (không đạo cụ, phông nền, hiệu ứng) |
| 2 | Góc nhìn mặc định | **Góc tự do** của App 3 + nút **"Nhìn qua camera cảnh"** |
| 3 | Bố cục | Thêm lựa chọn **"1 khung · Cả cảnh"** vào ô bố cục (cạnh 1/2/3/4 khung) |
| 4 | Nhân vật không chọn | **Chỉ để xem**: chạy animation, mờ nhẹ, không rig điều khiển |
| 5 | Cách chọn | **Click trực tiếp** vào nhân vật trong khung 3D |
| 6 | Chuyển từ A sang B | **Giữ bản sửa A trong bộ nhớ**, chuyển sang B; "Trả kết quả" trả **tất cả nhân vật đã sửa** cùng lúc |
| 7 | Khoảng frame | **Toàn bộ shot đang chọn ở F2** (hoặc In/Out timeline) |
| 8 | Phát | **Tất cả cùng chạy**; nhân vật đang sửa chạy theo key vừa chỉnh |
| 9 | Bóng onion | **Chỉ nhân vật đang sửa** |
| 10 | Vị trí khi sửa | **Giữ vị trí như F2**, chỉ đổi tư thế; muốn dời thì kéo Root như hiện nay |
| 11 | Trả về | Mỗi nhân vật đã sửa: chuỗi clip → **một clip mới**, lưu Thư viện nhân vật, **hỏi tên + mô tả từng nhân vật** |
| 12 | Nhân vật không sửa | **Không đụng tới**, giữ clip cũ |
| 13 | Mẫu | Không có (tính năng riêng của app này) |
| 14 | Số nhân vật | Thường **2–3**, khó nhất **5** |

## 4. Mục tiêu / không làm / coi là hỏng

**Mục tiêu**
- G1. Từ F2 mở F3 ở chế độ "Cả cảnh": thấy 2–5 nhân vật đúng vị trí, hướng, tỉ lệ và cùng thời điểm như F2.
- G2. Click nhân vật nào thì nhân vật đó thành **nhân vật đang sửa**: rig, timeline, key, onion đều của nhân vật đó. Các nhân vật khác chỉ xem.
- G3. Sửa nhiều nhân vật trong một lần mở, trả về một lần. Mỗi nhân vật đã sửa thành một clip gộp có tên và mô tả, lưu Thư viện.

**Không làm (đợt này)**
- Đạo cụ, phông nền, hiệu ứng, âm thanh trong khung "Cả cảnh" (câu 1A).
- Sửa vị trí cảnh của nhân vật từ F3 sang F2 (câu 10A). Root vẫn kéo được như hiện nay, nhưng vị trí đặt nhân vật trong F2 không đổi.
- Hai rig điều khiển cùng lúc (câu 4A).
- Bỏ hay đổi chế độ 1/2/3/4 khung, chế độ "Hai nhân vật", chế độ "Dựng cảnh" sẵn có của App 3.

**Coi là hỏng dù "chạy được"**
- Nhân vật trong F3 lệch vị trí, hướng, tỉ lệ hoặc thời điểm so với F2 ở cùng khung (ngưỡng ở §8).
- Chuyển nhân vật làm mất key vừa sửa của nhân vật trước.
- Trả về làm thay đổi nhân vật không sửa (khác hash clip).
- Mở shot có 5 nhân vật mà khung hình giật dưới 30 FPS khi phát trên máy này.
- Mất chức năng sẵn có của App 3 (công cụ kiểm id trước/sau như #201 phải không thiếu).

## 5. Trải nghiệm người dùng

### 5.1 Mở
1. Ở F3, khung "Dự án & trao đổi với cảnh" có nút mới **"Mở cả cảnh"**, cạnh "Mở shot từ cảnh".
   Khoảng frame = shot đang chọn ở F2, hoặc In/Out (câu 7A). Ô Nhân vật dùng để chọn **nhân vật sửa đầu tiên** **[Claude chốt]**.
2. App 3 tự chuyển bố cục sang **"1 khung · Cả cảnh"**. Lựa chọn này cũng có trong ô bố cục để quay lại khi đã mở.
3. Khung hiện mọi nhân vật đang có clip trong khoảng frame, đặt như F2, trên nền đất phẳng. Camera là góc tự do, có nút **"Nhìn qua camera cảnh"**
   dùng camera của shot. Đang nhìn qua camera thì xoay chuột sẽ thoát về góc tự do **[Claude chốt]**.

### 5.2 Chọn và sửa
4. Nhân vật đang sửa hiện bình thường, có Control Rig. Nhân vật khác **mờ ~50%**, không có rig và nhãn, nhưng vẫn chạy animation **[Claude chốt độ mờ]**.
5. **Click** vào thân nhân vật khác (không phải vào control) để chuyển sang sửa nhân vật đó. Timeline, Dope Sheet, Graph và onion chuyển theo.
   Tên nhân vật đang sửa hiện ở góc khung, ví dụ "Đang sửa: Đen" **[Claude chốt]**.
6. Bản sửa của nhân vật trước được **giữ trong bộ nhớ**, kể cả Undo riêng của nhân vật đó **[Claude chốt: Undo theo từng nhân vật]**.
   Nhân vật đã sửa có dấu "●" cạnh tên trong danh sách ở cột trái **[Claude chốt: thêm danh sách nhỏ chỉ để nhìn và bấm,
   phụ cho click 3D]**.

### 5.3 Phát
7. Phát/tua: **tất cả nhân vật cùng thời điểm**. Nhân vật đã sửa chạy theo key mới, nhân vật chưa sửa chạy theo bản nướng từ F2.
8. Onion chỉ cho nhân vật đang sửa (câu 9A).

### 5.4 Trả về
9. **"Trả kết quả về cảnh"** mở hộp **"Lưu clip gộp"** có **một dòng cho mỗi nhân vật đã sửa**: Tên và Mô tả (mặc định như K5).
   Nhân vật không sửa không có dòng (câu 12A).
10. Xác nhận: với mỗi nhân vật đã sửa, chuỗi clip trong khoảng đó thành **một clip** và lưu Thư viện của nhân vật như #202/#204.
    Toàn bộ là **một bước Undo** ở F2 **[Claude chốt]**.
11. "Bỏ sửa" bỏ hết bản sửa trong bộ nhớ (có hỏi lại nếu có ≥1 nhân vật đã sửa).

## 6. Thiết kế kỹ thuật (hướng, builder tự quyết chi tiết)

### 6.1 Hợp đồng gói shot
- `shot.export` thêm chế độ cả cảnh: `editableCharacterIds` = **mọi** nhân vật có clip trong khoảng.
  Mỗi nhân vật được phủ theo `planShotCoverage` (một clip hoặc chuỗi, kể cả liền nhau) và nướng như K5.
  Khoảng frame **không** tự nới theo chuỗi của từng nhân vật. Chuỗi bị cắt ở biên khoảng thì nướng phần trong khoảng, và khi trả về
  chỉ gộp phần trong khoảng (xem §10.1: nới khoảng, không cắt).
- `app3Artifacts.prepareShot` / `validateShot` (TS + Python `agent/shot_package.py`) chấp nhận **≥1** nhân vật editable khi gói có cờ
  `sceneMode: true`. Gói một nhân vật giữ nguyên như cũ (golden và test cũ không đổi).
- Kết quả trả về: gói chứa **danh sách nhân vật đã sửa** (GLB + native edit cho từng nhân vật). `shot.result.import` gộp từng nhân vật
  (dùng lại đường merge K5), lưu Thư viện từng nhân vật, tất cả trong **một revision / một Undo**.

### 6.2 App 3 (thêm qua bridge, giữ mọi chức năng)
- `host_bridge.js` + `shot_controller.js`: lệnh `shotOpen` với `sceneMode` nạp **mọi** nhân vật: một rig sửa (như hiện nay) và các
  "actor xem" (mesh + mixer chạy bản nướng, không Control Rig).
- Bố cục mới `sceneSingle` ("1 khung · Cả cảnh") trong `layout_modes`, không đổi 4 bố cục cũ.
- Chuyển nhân vật: lưu trạng thái editor (project key, undo stack, lựa chọn) của nhân vật cũ vào bộ nhớ, nạp của nhân vật mới.
  Rig/mesh của mọi nhân vật nạp sẵn để chuyển không phải parse lại GLB.
- Click chọn: raycast vào mesh của actor xem; click trúng control của rig đang sửa thì giữ hành vi cũ.
- Hiển thị thống nhất hệ trục Blender Z-up như App 3 hiện tại (#203).

### 6.3 Hiệu năng
- 5 nhân vật: phát ≥ 30 FPS trên máy này ở bố cục "Cả cảnh". Actor xem dùng mixer phát clip nướng, không tính IK/rig.
- Mở shot 5 nhân vật ≤ 15 giây (đo, báo số).

## 7. Chia đợt

| Đợt | Nội dung | Xong khi |
| --- | --- | --- |
| **S1** | Hợp đồng: `sceneMode`, nhiều editable, validate TS + Python, nướng mọi nhân vật; kết quả nhiều nhân vật + import gộp từng nhân vật, một Undo | Test hợp đồng + import 2 và 5 nhân vật đạt; gói 1 nhân vật cũ không đổi |
| **S2** | App 3 nạp actor xem + bố cục "1 khung · Cả cảnh" + phát đồng bộ + "Nhìn qua camera cảnh" | Số đo khớp F2 §8 đạt; 5 nhân vật ≥ 30 FPS |
| **S3** | Click chọn nhân vật, giữ bản sửa/Undo từng nhân vật, mờ nhân vật xem, onion theo nhân vật sửa, danh sách cột trái | Bài test §9 bước 3–6 đạt |
| **S4** | Nút "Mở cả cảnh" ở host; hộp "Lưu clip gộp" nhiều dòng; trả về; "Bỏ sửa" | Bài test §9 đủ; Thư viện bản sao có clip gộp từng nhân vật |

Mỗi đợt một nhánh/PR, xếp chồng, không tự merge.

## 8. Đo số (bắt buộc)
Trên bản sao Tập 15 · Shot 01 (Đen + Gỗ Xưa) và một bản sao ghép **5 nhân vật**:
- **Khớp F2**: root mỗi nhân vật trong F3 so với sampler App 2 tại khung 0, giữa, cuối: ≤ 1 cm, ≤ 1°. Xương: ≤ 0,5°.
- **Nhân vật không sửa** sau khi trả về: clip/binding hash giữ nguyên.
- **Chuyển qua lại** A → B → A 10 lần: key của A không đổi (hash project key).
- **Hiệu năng**: FPS khi phát (5 nhân vật) và thời gian mở; báo số.
- **Không hồi quy**: test App 3 (bridge, layout, workflow), test K5, công cụ kiểm id App 3 trước/sau.
Report: `docs/REPORT-app3-scene-mode-<ngày>.md`.

## 9. Bài test thủ công (người dùng)
1. F2 Tập 15 · Shot 01 → F3 → chọn Gỗ Xưa → **"Mở cả cảnh"**: thấy cả Gỗ Xưa và Đen đúng chỗ như F2.
2. Bấm phát: cả hai chạy cùng lúc, khớp F2.
3. Sửa tay Gỗ Xưa ở một khung. Click vào **Đen** thì timeline sang Đen, Gỗ Xưa mờ đi và vẫn chạy theo bản vừa sửa.
4. Sửa Đen. Click lại Gỗ Xưa: bản sửa Gỗ Xưa còn nguyên, Undo của Gỗ Xưa vẫn dùng được.
5. Bật onion: chỉ nhân vật đang sửa có bóng.
6. Bấm "Nhìn qua camera cảnh": khung nhìn giống camera ở F2.
7. "Trả kết quả về cảnh": hộp có 2 dòng (Gỗ Xưa, Đen), đặt tên. F2 có 2 clip gộp. Ctrl+Z một lần thì về như trước.
8. Thư viện (F5): mỗi nhân vật có clip gộp mới đúng tên.

## 10. Câu hỏi của người đọc kiểm tra: Claude chốt

1. **Khoảng frame và chuỗi clip.** Lấy khoảng của câu 7A (shot đang chọn ở F2 hoặc In/Out), rồi **nới ra** cho tới khi phủ trọn mọi chuỗi
   clip của mọi nhân vật chạm vào khoảng (như #204 khi chọn một nhân vật), kẹp trong timeline. Như vậy không phải cắt clip ở biên.
   Chuỗi của nhân vật đã sửa được thay trọn bằng một clip gộp; nhân vật không sửa giữ nguyên. Thay cho câu "[Claude chốt, cần builder kiểm
   cách cắt clip ở biên]" ở §6.1. Status ghi rõ khi khoảng đã được nới, ví dụ "Đã nới khoảng 30–90 → 0–149 để phủ trọn clip".
   Nhân vật chỉ có clip ở một phần khoảng vẫn hiện. Khung không có clip thì hiện đúng như F2 ở khung đó (sampler App 2).
2. **Cờ editable.** Mọi nhân vật trong gói đều `editable: true`. Ô Nhân vật chỉ chọn nhân vật **sửa đầu tiên**. Chuỗi của mọi nhân vật
   dùng luật `adjacent: true` (#204).
3. **Undo và Thư viện khi trả về.** Kiểm hết các nhân vật trước (validate gói, tên/mô tả). Lưu Thư viện từng nhân vật. Chỉ khi **tất cả** lưu
   được mới đổi project trong **một revision = một Undo**. Có một nhân vật lưu lỗi thì không đổi project, báo lỗi nêu tên nhân vật.
   Những bản đã lưu vào Thư viện trước đó vẫn ở Thư viện, như K5: Thư viện không nằm trong Undo của F2.
4. **Nền và camera.** Nền là mặt phẳng ở sàn của nhân vật như App 3 hiện nay. "Nhìn qua camera cảnh" **chạy theo key camera từng khung**
   (`shot.camera.keys`, có FOV), tỉ lệ khung theo khung xuất của cảnh (B61, `readFilmFrameAspect`), có viền đen trong khung App 3.
5. **Đo khớp F2.** "Root" là transform thế giới của node nhân vật sau khi đặt. Dùng sampler App 2 có sẵn
   (`sampleProjectSkeletonRange` trong `apps/studio/src/unifiedSkeletonEvaluation.ts`, như script đo K2/K4) làm chuẩn.
6. **Định dạng gói.** Thêm vào, không đổi phiên bản: có `sceneMode: true` thì cho nhiều nhân vật editable. Gói một nhân vật cũ và golden
   giữ nguyên. Validator Python (`agent/shot_package.py`) phải nhận **cả** gói shot lẫn gói kết quả nhiều nhân vật.
7. **Dữ liệu đo 5 nhân vật.** Builder tự tạo bản sao: copy Tập 15 · Shot 01 và thêm 3 nhân vật bằng cách nhân bản nhân vật có sẵn
   (Gỗ Xưa/Đen), đặt lệch chỗ, gán clip có sẵn. Không ghi vào project thật hay Thư viện thật. FPS và thời gian mở đo trên bản sao này.

## 11. Builder tự quyết
Cách lưu trạng thái editor theo nhân vật, raycast, cấu trúc gói kết quả nhiều nhân vật (miễn validate được TS + Python), tên lệnh bridge,
giao diện chi tiết của danh sách nhân vật và nhãn "Đang sửa", cách cắt chuỗi ở biên khoảng (miễn trả về đúng §8).

## 12. Ràng buộc
Không sửa `packages/retarget` (trừ test), không đổi golden, không commit binary, kho thật hay project thật. Test trên bản sao, luôn đặt
`W01_LIBRARY` bản sao. UI tiếng Việt, nền tối. `pnpm typecheck` toàn workspace trước push.
