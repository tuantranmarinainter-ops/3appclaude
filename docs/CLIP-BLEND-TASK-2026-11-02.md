# Trộn clip kiểu iClone (App 2 ↔ App 3 ↔ Thư viện) — đặc tả 2026-11-02

> Người dùng duyệt hướng 2026-11-02. Mọi chỗ ghi **[Claude chốt]** là quyết định thay người dùng
> (người dùng nói "bạn chốt ok"); đổi được nếu người dùng yêu cầu.
> Đọc trước: `CLAUDE.md`, `docs/DECISIONS.md`, `docs/RETARGET-LESSONS.md` (khóa chân, đo số).

## 1. Vì sao

Gỗ Xưa ở Tập 15 · Shot 01 có 2 clip liền nhau (0–58, 59–149). Chỗ nối 58→59 bị giật vì tư thế cuối clip A
khác tư thế đầu clip B. Hiện tại:

- Timeline App 2 **không cho clip chồng nhau**: `shiftOverlappingMotionClips`
  (`packages/builder/src/evaluate/studioIntents.ts`) đẩy clip sau ra.
- Mỗi khung chỉ một clip phát cho mỗi nhân vật: `motionClipAt` → `evaluateCharacters`
  (`packages/builder/src/evaluate/clips.ts`, `evaluateSteps.ts`) chỉ phát một playback.
- App 3 chỉ mở shot nằm trọn trong **một** clip (`apps/studio/src/shotExchange.ts`, dòng báo
  "cần đúng một MotionClip phủ hết…"), nên không sửa được chỗ nối.

Người dùng đã quen iClone 8: kéo đầu clip sau đè lên đuôi clip trước → vùng chồng hiện **dải gạch chéo X**
→ tự trộn mượt; rồi vẫn chỉnh tay key ở chỗ chưa mượt.

## 2. Người dùng đã chốt

| # | Câu hỏi | Chốt |
| --- | --- | --- |
| 1 | Kết quả sau khi chỉnh ở App 3 | **Gộp thành 1 clip mới**, có **tên mới + mô tả mới** |
| 2 | Chỗ đứng trong vùng nối | **Nối tiếp chỗ đứng**: clip sau bắt đầu đúng vị trí + hướng clip trước kết thúc |
| 3 | Chân trong vùng nối | **Luôn khóa chân** (foot lock), không trượt |
| 4 | Xuất film BBS | **Nướng thẳng** tư thế đã trộn vào `.dat`; game giống hệt App 2 / "Xem như BBS" |
| 5 | Clip gộp lưu đâu | **Thư viện, trong mục nhân vật hiện tại** (và dùng ngay trong cảnh) |
| 6 | Ngược chân | Cho phép **đảo chân** để hai bước nối khớp |

## 3. Mục tiêu / không làm / thất bại

**Mục tiêu**
- G1. App 2: kéo clip đè nhau trên cùng hàng nhân vật → dải X → xem ngay bản trộn mượt (viewport, "Xem như BBS", xuất film).
- G2. App 3: mở **A + vùng nối + B** thành một shot, chỉnh key, trả về thành **một clip gộp**.
- G3. Clip gộp vào Thư viện của nhân vật hiện tại, có tên/mô tả, dùng lại ở cảnh khác.

**Không làm (đợt này)**
- Trộn nhiều hơn 2 clip chồng cùng lúc tại một khung (3 clip chồng nhau → chặn, báo lỗi).
- Trộn theo từng bộ phận (chỉ thân trên…), layer cộng (additive).
- Dùng blend có sẵn trong BBS (BBS không khóa chân, không chỉnh tay được).
- Sửa `packages/retarget` (trừ test). Khóa chân làm ở `packages/builder` / `apps/studio`.

**Coi là hỏng dù "chạy được"**
- Film trong game khác App 2 ở vùng nối (lệch tư thế > ngưỡng §8).
- Chân trượt trong vùng nối khi cả hai clip đều có chân đứng yên.
- Nhân vật bị kéo về gốc / xoay lại hướng ban đầu khi sang clip sau.
- Cảnh cũ (không có clip chồng) đổi kết quả dù chỉ 1 khung: golden/test cũ phải giữ nguyên, Samba giữ nguyên.
- Mất 2 clip gốc sau khi gộp (Undo một bước phải trả lại đúng).

## 4. Trải nghiệm người dùng

### 4.1 App 2 — kéo đè và dải X
1. Trên hàng nhân vật, kéo clip B sang trái đè lên đuôi clip A (hoặc kéo đuôi A sang phải đè lên B).
   Không còn tự đẩy clip ra **khi giữ phím/bật nút "Cho chồng để trộn"** **[Claude chốt: mặc định BẬT cho kéo bằng chuột;
   lệnh thêm clip từ thư viện vẫn nối đuôi như cũ]**.
2. Vùng chồng hiện **dải X** (như iClone). Hover dải: "Trộn 10 khung · Êm đầu-cuối · Khóa chân".
3. Thả clip sát nhau (không chồng) rồi bấm chuột phải → **"Trộn với clip trước"**: tự chồng **10 tick (0,5 s)** **[Claude chốt]**.
4. Bấm vào dải X mở bảng nhỏ:
   - **Số khung trộn** (ô số; kéo mép dải cũng đổi).
   - **Kiểu chuyển**: Êm đầu-cuối (mặc định) / Tuyến tính **[Claude chốt]**.
   - **Khóa chân**: luôn bật (người dùng chốt); hiện trạng thái "Chân trái khóa 52–60".
   - **Đảo chân** (lật trái↔phải toàn bộ clip sau, mirror) và **Khớp nhịp bước** (dời điểm bắt đầu
     trong động tác gốc của clip sau tới khung có cùng chân trước, không lật) **[Claude chốt cả 2 nút]**.
   - Cảnh báo vàng trên dải khi phát hiện **ngược nhịp** (chân trước cuối A ≠ chân trước đầu B).
   - **"Sửa chỗ nối trong App 3"** (mở §4.2).
5. Ctrl+Z hoàn tác mọi thao tác trên (một thao tác = một bước Undo).

### 4.2 App 3 — sửa chỗ nối
1. Từ dải X bấm "Sửa chỗ nối trong App 3", hoặc ở F3 nhập khoảng frame phủ **A ∪ B** (không còn lỗi "cần đúng một MotionClip"
   nếu các clip trong khoảng đều nối với nhau bằng dải trộn).
2. Shot mở ra đã **nướng sẵn** (A + vùng trộn + khóa chân + B) thành key từng tick → người dùng kéo key như shot thường.
3. "Trả kết quả về cảnh" → hộp thoại **Lưu clip gộp**: Tên (mặc định `run + Kid_Run_Wobble_Bump`), Mô tả
   (mặc định "Gộp từ <A> (khung a–b) + <B> (khung c–d), trộn N khung, khóa chân, <đảo chân nếu có>"), nhân vật = nhân vật hiện tại (không đổi được).
4. Kết quả: trên timeline 2 clip A, B được thay bằng **1 clip gộp** phủ `[A.frameStart, B.frameEnd]` *sau khi kéo đè*
   (xem §10.1); Action mới nằm trong Thư viện của nhân vật.
   Một lần Ctrl+Z trả lại A, B và dải trộn như trước.

### 4.3 Xuất film
Không có nút mới. Xuất film/"Xem như BBS" lấy tư thế đã trộn (kể cả khi chưa vào App 3).

## 5. Thiết kế kỹ thuật (hướng, builder được tự quyết chi tiết)

### 5.1 Dữ liệu
- `MotionClip.playback` thêm trường tùy chọn (không bắt buộc, file cũ đọc được):
  `blendIn?: { frames: number; curve: 'smooth' | 'linear'; footLock: true; mirror?: boolean; phaseOffsetSeconds?: number }`
  gắn ở **clip sau** (B). Vùng trộn = `[B.frameStart, B.frameStart + frames - 1]` và phải ⊂ khoảng của A.
- Cập nhật `contract/validate.ts` (zod strict) và schema `@bbs/animation-workspace-shared` nếu có.
- Bất biến: tại một khung, mỗi nhân vật tối đa 2 clip và chỉ khi có `blendIn` hợp lệ; ngoài ra giữ quy tắc không chồng.

### 5.2 Đánh giá khung (một nguồn sự thật cho viewport, preview, film)
- `motionClipAt` → thêm `motionClipsAt(...)` trả `{ from, to, weight }`; `evaluateCharacters` phát **2 playback + trọng số**.
  Ngoài vùng trộn: đường cũ y hệt (kiểm bằng test hiện có + golden không đổi).
- Trộn **xương bằng slerp quaternion**, root bằng nội suy vị trí sau khi **căn root B theo cuối A** (vị trí + hướng yaw:
  dùng sẵn ý tưởng `rootMotion.alignment: 'continue'`).
- Khóa chân: trong vùng trộn, xác định chân đứng yên (tốc độ chân < ngưỡng & gần sàn) ở mỗi clip; giữ vị trí thế giới
  của chân đó, giải **IK 2 xương** (đùi–cẳng) để đặt lại; nhả khóa có độ êm 2–3 tick. Không đụng `packages/retarget`.
- Đảo chân: mirror theo bảng cặp xương Mixamo65 L↔R (đã có trong mapping preset → đọc, không sửa).
- `apps/studio/src/unifiedSkeletonEvaluation.ts` / `unifiedFilmSampling.ts` / `filmPoseBake.ts` phải đi qua cùng hàm trộn
  → film = App 2.

### 5.3 App 3 shot nhiều clip
- `shotExchange.ts`: cho phép khoảng shot phủ chuỗi clip nối bằng `blendIn`; gói shot chứa animation **đã nướng** cho cả khoảng.
- `shotResult.ts`: chế độ "gộp": tạo Motion/Action mới, thay các clip trong khoảng bằng 1 clip (giữ `frameStart` của A,
  `frameEnd` của B), một bước Undo; clip gốc giữ trong project.
- Thư viện: lưu Action gộp vào nhân vật hiện tại qua API thư viện có sẵn (`packages/library`), có tên + mô tả;
  không ghi kho thật khi test (dùng bản sao, `W01_LIBRARY`).

## 6. Chia đợt

| Đợt | Nội dung | Xong khi |
| --- | --- | --- |
| **K1** | Dữ liệu `blendIn` + validate + `motionClipsAt` + trộn slerp (chưa khóa chân, chưa nối chỗ đứng) + dải X trên timeline + kéo đè + Undo | Viewport App 2 thấy trộn; test cũ + golden giữ nguyên |
| **K2** | Nối tiếp chỗ đứng (căn root B theo cuối A) + khóa chân IK | Số đo §8 đạt trên Gỗ Xưa 58→59 |
| **K3** | Đảo chân + Khớp nhịp bước + cảnh báo ngược nhịp | Cặp mẫu ngược nhịp được báo, bấm sửa thì hết ngược |
| **K4** | Film/“Xem như BBS” đi qua hàm trộn; preflight báo vùng trộn | `.dat` khớp App 2 theo §8 |
| **K5** | App 3 mở shot A∪B đã nướng; trả về gộp 1 clip + hộp tên/mô tả + lưu Thư viện nhân vật | Bài test §9 đạt |

Mỗi đợt một nhánh/PR riêng, không tự merge.

## 7. Ràng buộc
- Không sửa `packages/retarget` (trừ test), không đổi golden, không commit binary / kho thật / project thật.
- Test trên bản sao: project `S:\Claude\w01-samples\…` bản copy, thư viện bản copy.
- UI tiếng Việt, nền tối. `pnpm typecheck` toàn workspace trước push.

## 8. Đo số (bắt buộc, không tuyên bố PASS chỉ vì UI)
Trên Gỗ Xưa · Tập 15 · Shot 01 bản sao, vùng nối 58→59 trộn 10 tick:
- **Giật**: vận tốc góc lớn nhất của mỗi xương trong vùng trộn ≤ 1,5 × giá trị lớn nhất ở 10 tick ngay trước vùng (A) và sau vùng (B).
- **Trượt chân**: chân được khóa dịch ngang ≤ 1 cm (thế giới) trong suốt thời gian khóa.
- **Chỗ đứng**: root khung đầu sau vùng trộn cách vị trí "nối tiếp" ≤ 1 cm, yaw ≤ 1°.
- **Film = App 2**: so tư thế từng xương giữa `.dat` và mẫu App 2 trong vùng trộn: ≤ 0,5° / ≤ 2 mm.
- **Không hồi quy**: cảnh không có `blendIn` cho kết quả bit-giống bản trước (so hash mẫu khung); Samba giữ nguyên.
Report số vào `docs/REPORT-clip-blend-<ngày>.md`.

## 9. Bài test thủ công (người dùng)
1. F2: Gỗ Xưa có 2 clip 0–58 và 59–149. Kéo clip 2 sang trái chồng ~10 khung → thấy dải X.
2. Play qua chỗ nối: không giật, chân không trượt, không bị kéo về chỗ cũ.
3. Bấm dải X → đổi 10 → 20 khung, đổi Tuyến tính ↔ Êm; bấm Đảo chân rồi Ctrl+Z.
4. "Sửa chỗ nối trong App 3" → kéo một key ở giữa vùng nối → "Trả kết quả về cảnh" → đặt tên + mô tả.
5. F2: còn 1 clip gộp từ đầu clip 1 tới cuối clip 2 (vd 0–139 nếu đã kéo đè 10 khung); Ctrl+Z một lần → về 2 clip + dải X.
6. Thư viện (F5): mục Gỗ Xưa có clip gộp với đúng tên/mô tả; thêm nó vào cảnh khác chạy đúng.
7. "Xem như BBS" và xuất film: vùng nối giống F2.

## 10. Câu hỏi của người đọc kiểm tra — Claude chốt

1. **Độ dài sau khi kéo đè** — như iClone: kéo B sang trái là B **thật sự dời sớm hơn**, tổng ngắn lại
   (0–58 + 59–149 chồng 10 khung → B thành 49–139). Clip khác trên hàng đó **không tự dời**; camera/âm thanh/nhân vật khác
   không đổi. Lệnh "Trộn với clip trước" (clip sát nhau) cũng dời B sớm hơn đúng số khung trộn. Clip gộp phủ `[A.start, B.end]`.
2. **Nối tiếp chỗ đứng** — dời + xoay yaw **toàn bộ** B một lần (cứng), không mờ dần. Đây là ý người dùng (câu 2).
   Hệ quả (B kết thúc chỗ khác so với trước) được báo trên dải X: "Clip sau dời 1,2 m, xoay 15°".
   **Đảo chân** lật cả xương **và** đường đi/hướng root của B (rẽ trái thành rẽ phải).
3. **Root của Action gộp** — lưu **tương đối từ khung đầu** (như Action thư viện khác), để thêm vào cảnh khác không bị kéo về
   chỗ cũ; vị trí trong cảnh này vẫn do node nhân vật + clip quyết định. Root nằm ở xương root/hips theo quy ước
   Mixamo65 hiện có của Action thư viện (builder đọc `packages/library` để theo đúng).
4. **Đơn vị** — `blendIn.frames` tính theo **frame của timeline** (`timeline.fps`). Film nướng **mỗi tick 20 Hz**
   (`unifiedFilmSampling.ts` đã lấy mẫu `sourceFrame = start + tick·fps/20`, `filmPoseBake` ghi key từng tick liên tiếp) → đủ dày,
   không cần đổi. Mặc định trộn = **0,5 giây** quy ra frame của timeline. Ngưỡng §8 đo trên mẫu 20 Hz.
5. **Khóa chân** — sàn = sàn rest của nhân vật trong cảnh (cùng nguồn với B10 `fitMinecraftFloor` / `measureFilmFeet`),
   theo tỉ lệ node nhân vật. Clip có speed ≠ 1 hoặc lặp: đánh giá trên **thời gian đã áp speed/lặp** (dùng `motionTimeSeconds`);
   "vùng trộn ⊂ A" tính theo khoảng timeline của A. Không có chân đứng yên (nhảy, chạy trên không) → **bỏ khóa**, không lỗi;
   dải X ghi "Không khóa chân: không có chân chạm đất".
6. **Film** — xem mục 4: key từng tick, đủ cho ngưỡng 0,5°.
7. **Bật/tắt "Cho chồng để trộn"** — nút trên thanh timeline, nhớ theo **người dùng** (localStorage, như các tùy chọn timeline khác),
   mặc định bật. Tắt → kéo đè đẩy clip như cũ.

## 11. Builder tự quyết
Thuật toán phát hiện chân đứng yên, IK solver cụ thể, giao diện chi tiết của bảng dải X, tên hàm/file mới, cách vẽ dải X,
cách lưu cache nướng — miễn đạt §8 và không vi phạm §7.
