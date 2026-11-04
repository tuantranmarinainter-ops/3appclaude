# Timeline F2: mọi keyframe đều chọn và kéo được (cả lớp fcurve), đặc tả 2026-11-04

> Người dùng chốt 2026-11-04: "Tôi muốn toàn bộ các keyframe phải được chọn được và di chuyển được."
> Mục ghi **[Claude chốt]** là quyết định thay người dùng, đổi được.
> Đọc trước: `CLAUDE.md`, `docs/DECISIONS.md`, `three-workspace-app/editor/AGENTS.md`, PR #219 và #220 (rê khung + kéo nhóm keyframe).

## 1. Vì sao
Timeline App 2 có hai lớp keyframe biến đổi:
- **userKeys** (khóa người dùng): chọn, rê khung, kéo nhóm, Ctrl+Z đều chạy (PR #219, #220).
- **fcurves** (lớp đường cong "chính thức": nhập sẵn, ghi từ kéo trong khung 3D, đạo cụ có animation nướng sẵn): timeline **chỉ vẽ**
  hình thoi (class `t3d-timeline-kf-fcurve`, `t3d-timeline-kf-xform`), không có `data-kf-id` nên rê khung bỏ qua, không kéo được.

Ví dụ thật: Tập 15 Shot 03 (`S:\Claude\w01-samples\tap15v3\projects\5673640e-…`, chỉ ĐỌC):
- Gỗ Xưa (`user_chr_1ud9vgk6`): fcurve vị trí ở khung 38, 44, 50, 52, 56 và xoay ở 38; userKeys vị trí 66, xoay/tỷ lệ 0, 36, 66.
  Người dùng không chọn/kéo được 38–56.
- Đạo cụ `user_prop_6awe79i6`: 150 khóa fcurve vị trí + 150 khóa xoay.

## 2. Hiện trạng (đã kiểm code, `packages/builder/src`)
- `components/timeline/TrackRow.tsx`: dòng `kf` vẽ `fcurveFrames(...)` (bỏ khung trùng userKeys); dòng nhóm "Biến đổi" vẽ
  `transformKeyframeFrames(...)` trừ khung đã có bó userKeys. Bấm chỉ chọn `{kind:'transformKeyframe'}` + seek; double-click/chuột phải xoá.
- `components/timeline/hooks/useTimelineMarquee.ts`: rê khung chỉ nhặt phần tử có `data-kf-id` (userKeys) và `data-clip-id`.
- `components/timeline/hooks/useKeyframeDrag.ts` + `utils.ts` (`selectedKeyframeDragItems`, `nextBundleSelection`,
  `clampKeyframeGroupDelta`): kéo nhóm chỉ cho userKeys, ghi qua `StudioSession.moveKeyframes` (một bước hoàn tác, mergeKey 1 s).
- `evaluate/curves/FCurveSet.ts`: có `upsertKey`, `getKeyAt`, `removeKeysAtFrame`; **chưa có hàm dời khóa**. Mỗi thuộc tính
  (`transform.position|rotation|scale`, camera `lookAt`/`fov`) có 3 (hoặc 1) đường cong theo `index`; khóa có `id`, `interp`, `inHandle`/`outHandle`.
- `sync/StudioSession.ts`: `removeFcurveKeyframe` là mẫu sửa fcurves có hoàn tác (`snapshotDocState` → sửa → `rederiveWalkPaths` khi là
  position → `setFcurves` → `touch` → đẩy lịch sử). `moveKeyframes` là mẫu dời nhóm (kẹp `[frameStart, frameEnd]`, khóa bị kéo thắng khi trùng khung).
- `evaluate/evaluateSteps.ts`: userKeys được áp **sau** fcurves theo từng thuộc tính → trên Gỗ Xưa, userKey vị trí ở 66 đang đè lớp fcurve vị trí.
- `stores/types.ts`: `Selection` có `keyframe` / `timelineBox` (danh sách `KeyframeRef {nodeId, prop, keyId}`), `transformKeyframe {nodeId, frame}`.

## 3. Đã chốt
| # | Câu | Chốt |
| --- | --- | --- |
| 1 | Phạm vi | Mọi hình thoi keyframe biến đổi trên timeline F2 (nhân vật, đạo cụ, khối, camera) chọn được, rê khung được, kéo được, Ctrl+Z một bước. (người dùng) |
| 2 | Cách làm với fcurve | **[Claude chốt]** Giữ fcurve là fcurve: dời khóa thật trong `FCurveSet` (giữ `interp`, tay nắm, giá trị, id). KHÔNG đổi fcurve thành userKeys (sẽ mất dạng đường cong). |
| 3 | Đơn vị chọn của fcurve | **[Claude chốt]** Một "khóa fcurve" = (nodeId, propPath, frame): mọi `index` (x/y/z) cùng khung đi cùng nhau, như `removeKeysAtFrame`. |
| 4 | Nhóm lẫn userKeys + fcurve | **[Claude chốt]** Kéo cùng một độ dời, một bước hoàn tác, kẹp chung `[frameStart, frameEnd]` theo khung nhỏ/lớn nhất của cả nhóm. |
| 5 | Trùng khung khi thả | **[Claude chốt]** Như userKeys hiện tại: khóa được kéo thắng khóa đứng yên cùng đường cong cùng khung. |
| 6 | Khóa fcurve đang bị userKeys đè (vd Gỗ Xưa vị trí) | **[Claude chốt]** Vẫn chọn/kéo được; không đổi cách tính. Builder thêm title tooltip "Đang bị khóa người dùng đè" nếu dễ, không bắt buộc. |
| 7 | Camera có clip chuyển động máy đang sở hữu keyframe | Giữ như hiện tại (`cameraMotionOwnsKeyframes`: bị khóa, không kéo). |

## 4. Mục tiêu / không làm / coi là hỏng
**Mục tiêu**
- G1. Bấm hình thoi fcurve (dòng con và dòng "Biến đổi") → nó được chọn (tô sáng như userKeys); Shift/Ctrl+bấm thêm/bỏ.
- G2. Rê khung nhặt cả hình thoi fcurve, trên nhiều dòng, nhiều node.
- G3. Kéo nhóm (fcurve, userKeys hoặc lẫn) dời đúng số khung nguyên, bám lưới/snap như userKeys, không lùi qua frameStart, không vượt frameEnd; xem trước khi kéo khớp kết quả.
- G4. Ctrl+Z hoàn tác cả lần kéo trong một bước, Ctrl+Y/Làm lại làm lại đúng.
- G5. Dời fcurve vị trí của nhân vật thì đường đi dẫn xuất (`rederiveWalkPaths`) cập nhật như khi xoá khóa fcurve.
- G6. Lưu project rồi mở lại: khóa ở khung mới, giá trị/interp/tay nắm không đổi.

**Không làm (đợt này)**: sửa giá trị khóa fcurve trong Inspector; sửa tay nắm bezier; dời clip chung với keyframe; khóa không phải biến đổi.

**Coi là hỏng dù "chạy được"**
- Sau khi kéo +N khung, có khóa nào trong nhóm dời khác N, hoặc khóa ngoài nhóm bị đổi khung/giá trị.
- Đường cong đổi hình: giá trị đánh giá tại (khung cũ + N) sau khi kéo khác giá trị tại khung cũ trước khi kéo quá 1e-6 (với khóa trong nhóm, khi cả đường cong được dời).
- Cần hơn 1 lần Ctrl+Z để về trạng thái trước lần kéo; hoặc 1 lần Ctrl+Z hoàn tác luôn lần kéo trước đó cách hơn 1 giây.
- Hành vi userKeys hiện có (PR #219/#220) thay đổi: toàn bộ test `components/timeline/__tests__` phải giữ xanh.

## 5. Trải nghiệm người dùng
Giống hệt khóa người dùng: bấm chọn, Shift/Ctrl+bấm thêm, rê khung vùng trống để chọn nhiều, kéo một hình thoi trong nhóm thì cả nhóm đi,
thả ra là xong; Ctrl+Z một lần là về. Không thêm nút mới.

## 6. Thiết kế kỹ thuật (hướng, builder tự quyết chi tiết)
- Dữ liệu chọn: thêm ref fcurve, ví dụ mở rộng `KeyframeRef` hoặc thêm `FcurveKeyRef {nodeId, propPath, frame}` vào `keyframe`/`timelineBox`.
  Giữ tương thích mọi chỗ đang đọc `keyframeRefsOf` (Inspector, xoá, toolbar).
- DOM: hình thoi fcurve có `data-kf-*` riêng để `useTimelineMarquee` nhặt được; hình thoi "Biến đổi" gộp cả userKeys và fcurve cùng khung.
- `FCurveSet`: thêm hàm dời các khóa (nodeId, propPath, frame) → frame + delta cho mọi index, giữ thứ tự, khóa được dời thắng khi trùng.
- `StudioSession`: một hàm ghi cho nhóm lẫn (vd mở rộng `moveKeyframes` hoặc `moveTimelineKeys`), một `snapshotDocState`, một mục lịch sử
  với mergeKey ổn định theo tập khóa; `rederiveWalkPaths` khi đụng `transform.position`; `engine.setFcurves`.
- `useKeyframeDrag`: item kéo mang loại khóa; `clampKeyframeGroupDelta` dùng chung.

## 7. Chia đợt
| Đợt | Nội dung | Xong khi |
| --- | --- | --- |
| F1 | `FCurveSet` dời khóa + `StudioSession` ghi nhóm (fcurve + userKeys) có hoàn tác + test session | Test mục 8 (1)–(4) xanh |
| F2 | Chọn/Shift/rê khung/kéo trên timeline cho hình thoi fcurve + test utils | Mục 8 (5) xanh, kiểm trình duyệt có ảnh |
Mỗi đợt một nhánh `claude/timeline-fcurve-f<n>`, PR F2 có base là nhánh F1. Không tự merge.

## 8. Đo số (bắt buộc)
Dữ liệu: bản sao Shot 03 (copy `5673640e-…` vào bản sao project bằng skill `w01-test-sandbox`, không ghi bản gốc).
1. Gỗ Xưa: chọn 5 khóa fcurve (38, 44, 50, 52, 56) + userKeys 36 → kéo +4: khung mới 42, 48, 54, 56, 60 và 40 (56 cũ đã dời nên không đụng);
   giá trị/interp từng khóa bằng nhau trước/sau (sai số 0).
2. Kéo trái −100 từ nhóm đó: khung nhỏ nhất về đúng frameStart (0), cả nhóm giữ khoảng cách.
3. 1 lần Ctrl+Z về đúng JSON fcurves + userKeys trước kéo (so chuỗi).
4. Đạo cụ 150 khóa: rê khung chọn hết, kéo +10: 150/150 khóa dời 10, thời gian ghi < 200 ms (đo `performance.now()` quanh lời gọi session).
5. Trình duyệt: ảnh trước/sau cho (1) và (4).
Report: `docs/REPORT-timeline-fcurve-keys-<ngày>.md`, trạng thái NOT_RUN / BLOCKED / FAIL / PASS từng mục.

## 9. Bài test thủ công (người dùng)
1. Mở Shot 03 trong App 2, mở Dòng thời gian, mở dòng Gỗ Xưa › Biến đổi.
2. Rê khung qua các hình thoi 38–56 → chúng sáng lên.
3. Kéo một hình thoi sang phải vài khung → cả nhóm đi theo, nhân vật đi đúng đường cũ nhưng muộn hơn.
4. Ctrl+Z một lần → về như cũ.

## 10. Câu hỏi của người đọc kiểm tra: Claude chốt
Đọc kiểm bằng sub-agent Sonnet; tất cả do Claude chốt, đổi được:
1. **Kéo vượt qua khóa đứng yên** cùng đường cong: cho phép; sau khi dời sắp lại mảng khóa theo khung. Chỉ xoá khóa đứng yên khi trùng đúng khung (mục 3.5).
2. **Tay nắm bezier**: `inHandle.x`/`outHandle.x` là khung TUYỆT ĐỐI (xem `evalBezierSegment` dùng thẳng `outHandle.x` làm p1x),
   nên khi dời khóa phải cộng cùng delta vào `.x` của cả hai tay nắm; `.y` giữ nguyên. Test: so giá trị đánh giá giữa hai khóa trước/sau.
3. **Áp nguyên tử**: tính bản đồ khung cũ → khung mới cho cả nhóm trước, rồi mới ghi. Khóa thuộc nhóm không bao giờ bị coi là "đứng yên"
   (ví dụ 8.1: 52→56 không xoá 56 cũ vì 56 cũ cũng đang dời →60).
4. **Hình thoi "Biến đổi" có cả userKeys và fcurve cùng khung**: bấm chọn cả hai loại; kéo thì cả hai cùng đi.
5. **Lựa chọn sau khi kéo**: cập nhật ref fcurve sang khung mới để kéo tiếp được; `mergeKey` tính từ id ổn định (id khóa fcurve trong `FCurveKey.id` nếu có, không thì từ tập khung TRƯỚC khi kéo).
6. **Khung không nguyên** (khóa nhập/nướng): so khung với sai số 1e-6, chỉ cộng delta nguyên, giữ phần lẻ. Khóa nằm ngoài [frameStart, frameEnd] sẵn: kẹp theo cả nhóm như userKeys.
7. **Phím Xoá** khi chọn có ref fcurve: xoá các khóa đó (`removeKeysAtFrame` theo từng ref) cùng userKeys trong MỘT bước hoàn tác. Inspector bỏ qua ref fcurve (không lỗi).
8. **Đường đi dẫn xuất**: gọi `rederiveWalkPaths` một lần sau khi ghi (như `removeFcurveKeyframe`), thêm test lấy mẫu vị trí trước/sau.
9. **Nhóm lẫn có khóa bị khoá** (camera có chuyển động máy, node bị khoá): bỏ riêng khóa đó khỏi nhóm, vẫn kéo phần còn lại.
10. **Hiệu năng**: `rederiveWalkPaths`/`setFcurves` chạy một lần cho cả nhóm khi thả; khi đang kéo chỉ xem trước bằng độ dời (không ghi).

## 11. Builder tự quyết
Tên kiểu/hàm, cách gộp DOM, tooltip mục 3.6, chia file test.

## 12. Ràng buộc
Chỉ sửa `packages/builder` (và test). Không sửa `packages/retarget`, không đổi golden, không commit binary/kho thật/project thật.
Test trên bản sao, luôn đặt `W01_LIBRARY` bản sao. UI tiếng Việt, nền tối. `pnpm typecheck` toàn workspace trước push.
Không dừng/đụng server cổng 3016 (App 2 thật) và 3101 (App 1).
