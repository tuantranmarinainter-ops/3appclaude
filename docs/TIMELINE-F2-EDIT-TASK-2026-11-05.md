# Timeline F2: Lưu, Về danh sách, menu chuột phải keyframe (Sao chép/Dán), kéo chung clip + keyframe: đặc tả 2026-11-05

> Người dùng yêu cầu 2026-11-05 (4 mục). Mục ghi **[Claude chốt]** là quyết định thay người dùng, đổi được.
> Đọc trước: `CLAUDE.md`, `docs/DECISIONS.md`, `three-workspace-app/editor/AGENTS.md`,
> `docs/TIMELINE-FCURVE-KEYS-TASK-2026-11-04.md` (đợt F1/F2: chọn/kéo keyframe fcurve, **làm trước**), PR #219/#220.

## 1. Vì sao
Người dùng dựng Tập 15 trên dòng thời gian F2 của App 2 (Dựng cảnh, cổng 3016):
1. Muốn chủ động **lưu** trước khi thoát và thấy rõ đã lưu hay chưa (hiện chỉ có tự lưu 5 s + chữ nhỏ ở topbar).
2. Muốn **quay về màn hình đầu** (danh sách dự án / tập / shot ở `/`) mà không phải tự xoá `?unified=...` trên thanh địa chỉ.
3. **Chuột phải lên keyframe đang XOÁ keyframe** → hay xoá nhầm. Muốn chuột phải mở menu giống menu clip, có Sao chép / Dán:
   lấy vị trí + xoay + tỉ lệ của một keyframe, dán đè lên một hay nhiều keyframe khác.
4. Đã chọn nhiều clip và keyframe nhưng **phải kéo từng cái**. Muốn kéo một mục là cả nhóm đi cùng một số khung.

## 2. Hiện trạng (đã kiểm code trên main c985f6d, `three-workspace-app/editor/packages/builder/src`)
- `components/timeline/TrackRow.tsx`: 3 loại hình thoi đều gắn `onContextMenu` → XOÁ và `onDoubleClick` → XOÁ:
  - dòng "Biến đổi" (`t3d-timeline-kf-xform`) → `onRemoveTransformKeys(nodeId, frame)`;
  - dòng con fcurve (`t3d-timeline-kf-fcurve`) → `onRemoveFcurveKeyframe(...)`;
  - userKeys (`data-kf-id`) → `onRemoveKeyframe(...)`.
- `components/timeline/ClipBlock.tsx`: menu chuột phải của clip (state `menu`, `clampMenuPosition` trong `utils/clipMenu`,
  mục "Sao chép", "Dán tại đầu phát", "Nhân bản", "Cắt", "Kéo dài", "Trộn với clip trước", "Xoá"). Kéo clip: `moveClip` từng clip
  giữa `beginClipMove`/`endClipMove`; **không** dời các clip/keyframe khác đang chọn.
- `components/timeline/hooks/useKeyframeDrag.ts` + `utils.ts` (`selectedKeyframeDragItems`, `clampKeyframeGroupDelta`):
  kéo nhóm chỉ userKeys (F1/F2 mở rộng cho fcurve), ghi `StudioSession.moveKeyframes`.
- `stores/types.ts`: `Selection` đã có `{kind:'timelineBox'; clips: ClipRef[]; keys: KeyframeRef[]}` (rê khung chọn lẫn clip +
  keyframe), `clipRefsOf`, `keyframeRefsOf`. Phím Delete/Backspace: `components/hooks/useScopedKeyboard.ts` → `deleteSelection`.
- Lưu: `sync/StudioSession.ts` có `save()`, `dirty`, `saveState` (`saving|saved|error`); tự lưu `DEFAULT_AUTO_SAVE_INTERVAL_MS = 5000`
  (`DirectorStudio.tsx`). `components/topbar/index.tsx` hiện "Đã lưu / Chưa lưu / Đang lưu" (`resolveSaveStatus`), **không có nút**.
  Topbar builder bị host thay bằng `wb-unified-topbar` khi mở dự án unified.
- Quay về: host `apps/studio/app/workbench/components/StudioOverlay.tsx` có nút "Đóng" (`wb-unified-close`) gọi `onClose` →
  `WorkbenchClient.closeStudio` → `syncQuery(null)` (bỏ `?unified`). Nút nằm ở topbar host, xa timeline, và **không lưu trước khi đóng**.

## 3. Đã chốt
| # | Câu | Chốt |
| --- | --- | --- |
| 1 | Nút Lưu ở đâu | **[Claude chốt]** Thanh điều khiển của dòng thời gian F2 (cạnh nút phát/khung), nút "Lưu" + nhãn trạng thái "Đã lưu" / "Chưa lưu" / "Đang lưu…" / "Lưu lỗi" (màu: xám / vàng / xám / đỏ). Phím tắt Ctrl+S cũng lưu (chặn hộp lưu của trình duyệt). |
| 2 | Nút Lưu khi khoá ghi (`writeLocked`) | Tắt (disabled) kèm tooltip lý do. |
| 3 | Nút quay về | **[Claude chốt]** Nút "Về danh sách" trên thanh F2. Bấm: nếu còn chưa lưu → lưu xong (đợi `save()`) rồi về `/`; lưu lỗi → hỏi "Lưu lỗi. Vẫn rời đi?" (Huỷ / Rời đi). Builder không tự điều hướng: nhận callback từ host (vd prop `onExitToList` qua `DirectorStudio`), host gọi lại đúng `closeStudio`. Nút "Đóng" của host cũng lưu trước khi đóng như vậy. |
| 4 | Chuột phải keyframe | Không bao giờ xoá. Mở menu ngữ cảnh (cùng kiểu, cùng hàm định vị với menu clip). Áp cho cả 3 loại hình thoi (userKeys, fcurve, "Biến đổi"). |
| 5 | Nhấp đôi keyframe | **[Claude chốt]** Cũng KHÔNG xoá nữa (cùng lý do xoá nhầm). Nhấp đôi = chọn + nhảy đầu phát. Xoá chỉ bằng phím Delete/Backspace hoặc mục menu "Xoá". |
| 6 | Mục trong menu keyframe | "Sao chép biến đổi", "Dán biến đổi" (+ menu con hoặc 3 mục: "Dán chỉ vị trí", "Dán chỉ xoay", "Dán chỉ tỉ lệ" — **[Claude chốt]** có, rẻ), "Xoá". Mục không dùng được thì mờ (disabled), không ẩn. |
| 7 | Sao chép lấy gì | Giá trị **đã đánh giá** của node tại khung của keyframe nguồn: vị trí (x,y,z), xoay, tỉ lệ (dù khung đó chỉ có khóa của 1 thuộc tính). Lưu vào bộ nhớ tạm trong store (không dùng clipboard hệ điều hành); còn đến khi sao chép lần sau hoặc tải lại trang. |
| 8 | Dán vào đâu | Mọi keyframe đang chọn (một hay nhiều, nhiều node được). Mỗi đích = (node, khung). Ghi đè 3 thuộc tính tại khung đó: thuộc tính đã có khóa (userKey hoặc fcurve) thì sửa giá trị khóa đó (giữ `interp`, tay nắm, id); thuộc tính chưa có khóa thì tạo userKey mới ở khung đó. "Dán chỉ X" chỉ đụng thuộc tính X. |
| 9 | Dán khác loại node | Cho phép (nhân vật ↔ đạo cụ ↔ khối). Camera: chỉ dán vị trí + xoay; tỉ lệ bỏ qua. Bỏ qua node bị khoá (`keyframesLocked`, camera có chuyển động máy) và báo số đích bị bỏ qua bằng `emitTimelineNotice`. |
| 10 | Kéo chung clip + keyframe | Khi chọn lẫn (`timelineBox`, hoặc Shift/Ctrl+bấm thêm clip vào chọn keyframe và ngược lại), kéo BẤT KỲ clip hay keyframe nào trong nhóm → mọi clip + keyframe đã chọn dời cùng ΔN khung nguyên. Một bước Hoàn tác. |
| 11 | Kẹp khi kéo nhóm | **[Claude chốt]** Kẹp Δ chung theo cả nhóm: mục sớm nhất không lùi qua `frameStart`, keyframe muộn nhất không vượt `frameEnd`. Clip được phép vượt `frameEnd` như hiện tại khi kéo 1 clip (giữ quy tắc cũ của `moveClip`). |
| 12 | Kéo một mục không nằm trong vùng chọn | Như hiện tại: chọn lại chỉ mục đó rồi kéo một mình. |
| 13 | Hoàn tác/Làm lại | Mỗi thao tác Dán, Xoá (từ menu hay phím), Kéo nhóm = đúng **một** bước Hoàn tác; Làm lại trả đúng kết quả. Lưu thủ công không tạo bước hoàn tác. |

## 4. Mục tiêu / không làm / coi là hỏng
**Mục tiêu**
- G1. Nút "Lưu" + trạng thái trên F2, Ctrl+S; trạng thái đổi đúng khi sửa / đang lưu / lưu xong / lỗi.
- G2. Nút "Về danh sách": lưu rồi về `/` (danh sách dự án/tập/shot), URL không còn `?unified=`; không mất sửa đổi.
- G3. Chuột phải / nhấp đôi keyframe không xoá; chuột phải mở menu tiếng Việt.
- G4. Sao chép / Dán biến đổi (đủ và từng phần) lên nhiều keyframe, nhiều node; một bước hoàn tác.
- G5. Kéo nhóm lẫn clip + keyframe (userKeys và fcurve) cùng Δ; xem trước khi kéo khớp kết quả khi thả; một bước hoàn tác.

**Không làm (đợt này)**: dán sang khung chưa có keyframe nào (dán tại đầu phát); sao chép nhiều keyframe kèm khoảng cách; dán vào
clip; đổi menu clip hiện có; đổi cách tự lưu; sửa `packages/retarget`.

**Coi là hỏng dù "chạy được"**
- Chuột phải hoặc nhấp đôi lên bất kỳ hình thoi nào làm số khóa (userKeys + fcurve) đổi.
- Sau Dán: giá trị đánh giá tại khung đích lệch nguồn > 1e-6 (đơn vị gốc) ở thuộc tính được dán; hoặc khóa ở khung KHÁC đổi giá trị;
  hoặc `interp`/tay nắm của khóa bị dán thay đổi.
- Sau kéo nhóm +N: có clip/keyframe trong nhóm dời khác N; mục ngoài nhóm đổi khung; cần > 1 lần Ctrl+Z để về.
- Bấm "Về danh sách" khi đang "Chưa lưu" mà mở lại dự án mất sửa đổi.
- Test có sẵn trong `components/timeline/__tests__` và `sync/__tests__` đỏ.

## 5. Trải nghiệm người dùng
1. Sửa gì đó → nhãn F2 chuyển "Chưa lưu" (vàng). Bấm **Lưu** (hoặc Ctrl+S) → "Đang lưu…" → "Đã lưu".
2. Bấm **Về danh sách** → (tự lưu nếu cần) → màn hình danh sách dự án/tập/shot.
3. Chuột phải hình thoi Gỗ Xưa khung 36 → menu: Sao chép biến đổi · Dán biến đổi · Dán chỉ vị trí · Dán chỉ xoay · Dán chỉ tỉ lệ · Xoá.
   Chọn **Sao chép biến đổi**. Rê khung chọn khóa 40, 66 → chuột phải một khóa trong đó → **Dán biến đổi** → nhân vật ở 40, 66
   đứng đúng vị trí/xoay/tỉ lệ như 36. Ctrl+Z một lần → về như cũ.
4. Rê khung chọn clip chuyển động + vài keyframe → kéo clip sang phải 10 khung → các keyframe đi theo 10 khung. Ctrl+Z một lần là về.

## 6. Thiết kế kỹ thuật (hướng, builder tự quyết chi tiết)
- **Lưu/Về**: `TimelineControls`/`index.tsx` đọc `dirty`, `saveState` từ store (dùng lại logic `resolveSaveStatus`, tách ra util dùng
  chung có test). Gọi `session.save()`. Ctrl+S trong `useScopedKeyboard`. Thêm prop host → builder (`onExitToList?: () => void`);
  không có prop thì ẩn nút. Host (`apps/studio` StudioOverlay) truyền hàm: `await save` qua API sẵn có của builder (vd ref/handle hoặc
  sự kiện) rồi `onClose()`. Không `fetch` trong `packages/builder`.
- **Menu keyframe**: một component `KeyframeContextMenu` dùng chung `clampMenuPosition`; `TrackRow` thay 3 chỗ `onContextMenu`/
  `onDoubleClick`. Chuột phải lên khóa chưa chọn → chọn nó (thay vùng chọn) rồi mở menu; lên khóa đã chọn → giữ vùng chọn.
- **Sao chép/Dán**: hàm thuần `buildTransformPastePlan(source, targets, mask)` → danh sách ghi (sửa khóa fcurve / sửa userKey / tạo userKey)
  — có test. `StudioSession.pasteTransformKeys(...)`: một `snapshotDocState`, áp kế hoạch, `rederiveWalkPaths` khi đụng position,
  `setFcurves`, một mục lịch sử. Dùng mẫu `removeFcurveKeyframe`/`moveKeyframes`.
- **Kéo nhóm**: hàm thuần `planTimelineGroupShift(selection, delta, bounds)` → Δ đã kẹp + danh sách clip/keyframe đích (test).
  `StudioSession` (hoặc store) một lệnh `moveTimelineSelection` gộp `moveClip` nhiều clip + dời keyframe (lớp F1) trong MỘT bước lịch sử.
  `ClipBlock` và `useKeyframeDrag` đều gọi chung một hook kéo nhóm; xem trước bằng offset (không ghi khi đang kéo).
- Chuỗi tiếng Việt: thêm khoá vào `locale/strings/vi.ts` (và `en.ts`), không viết cứng nếu file đã dùng `t()`.

## 7. Chia đợt
| Đợt | Nội dung | Xong khi |
| --- | --- | --- |
| E1 | Nút Lưu + trạng thái + Ctrl+S; nút Về danh sách (builder + host) | Test util trạng thái xanh; kiểm trình duyệt có ảnh (mục 8.1–8.2) |
| E2 | Bỏ xoá bằng chuột phải/nhấp đôi; menu keyframe; Sao chép/Dán (đủ + từng phần); Xoá từ menu | Test kế hoạch dán + session dán/hoàn tác xanh; mục 8.3–8.4 |
| E3 | Kéo nhóm lẫn clip + keyframe, một bước hoàn tác | Test `planTimelineGroupShift` + session xanh; mục 8.5 |

Thứ tự nhánh: E1 từ `main` (độc lập, không đụng file keyframe). E2 xếp trên nhánh F2 (`claude/timeline-fcurve-f2`) nếu F2 chưa merge,
không thì từ main. E3 xếp trên E2. Nhánh `claude/timeline-f2-e<n>`. Không tự merge.

## 8. Đo số (bắt buộc)
Dữ liệu: bản sao Shot 03 Tập 15 (`5673640e-…` từ `S:\Claude\w01-samples\tap15v3\projects`, copy bằng skill `w01-test-sandbox`;
KHÔNG ghi bản gốc), `W01_LIBRARY` bản sao, cổng thử 3140–3149.
1. Lưu: sửa 1 khóa → nhãn "Chưa lưu"; bấm Lưu → "Đã lưu" trong < 3 s; đọc file project trên đĩa (bản sao) thấy giá trị mới.
2. Về danh sách: sửa 1 khóa rồi bấm ngay (trong < 1 s, trước tự lưu) → URL `/` không có `unified`; mở lại dự án thấy giá trị mới.
3. Chuột phải + nhấp đôi lên 10 hình thoi (đủ 3 loại): tổng số khóa trước = sau (đếm userKeys + khóa fcurve trong JSON).
4. Gỗ Xưa (`user_chr_1ud9vgk6`): sao chép khung 36, dán đủ lên khóa fcurve 38 và userKey 66 (chọn chung) → giá trị đánh giá vị trí/xoay/tỉ lệ
   tại các khung đích = nguồn (sai số ≤ 1e-6); khóa ở mọi khung khác giữ nguyên (so JSON); 1 Ctrl+Z → JSON fcurves + userKeys trùng
   trước dán (so chuỗi); Ctrl+Y → trùng sau dán. Lặp với "Dán chỉ xoay": vị trí/tỉ lệ không đổi.
5. Chọn 1 clip chuyển động + 3 keyframe (≥ 1 fcurve) → kéo +10: 4/4 mục dời đúng 10; kéo −1000 → mục sớm nhất về `frameStart`, khoảng
   cách giữ nguyên; 1 Ctrl+Z về JSON trước kéo.
6. `pnpm typecheck` toàn workspace xanh; test builder liên quan xanh.
Report: `docs/REPORT-timeline-f2-edit-<ngày>.md`, NOT_RUN / BLOCKED / FAIL / PASS từng mục, ảnh trình duyệt cho 1, 2, 4, 5.

## 9. Bài test thủ công (người dùng)
1. Mở Shot 03 → Dòng thời gian. Sửa vị trí một nhân vật → thấy "Chưa lưu" → bấm Lưu → "Đã lưu".
2. Chuột phải một hình thoi → menu hiện, hình thoi còn nguyên. Sao chép → chọn 2 hình thoi khác → Dán biến đổi → nhân vật đúng tư thế. Ctrl+Z.
3. Rê khung chọn một clip và vài hình thoi → kéo → cả nhóm đi. Ctrl+Z.
4. Bấm Về danh sách → về màn hình danh sách dự án.

## 10. Câu hỏi của người đọc kiểm tra: Claude chốt
1. Dán lên khóa fcurve (sau F2): sửa `value` của khóa fcurve từng `index`, KHÔNG chuyển thành userKey; nếu khung đó còn có userKey cùng thuộc
   tính thì sửa cả userKey (vì userKey đè fcurve khi đánh giá).
2. Xoay: sao chép/dán theo đúng dạng lưu trong dữ liệu (Euler của `transform.rotation`), không đổi qua quaternion.
3. Nguồn không còn tồn tại khi dán (đã xoá/đổi dự án): vẫn dán giá trị đã lưu trong bộ nhớ tạm (giá trị, không phải tham chiếu).
4. Clip trong nhóm kéo bị khoá (`writeLocked`, clip ghost): bỏ riêng mục đó, kéo phần còn lại; báo bằng `emitTimelineNotice`.
5. Ctrl+S khi trang đang lưu: không gọi lưu chồng (dùng `saveInFlight` sẵn có).
6. **F1/F2 chưa có trên main**: F1/F2 đã giao Codex 2026-11-04 (chưa push). Codex làm F1 → F2 xong rồi mới làm E2/E3. E1 không phụ thuộc,
   làm song song được. Không làm E2/E3 trên nền thiếu F1/F2 (tránh hai bản dời khóa fcurve).
7. **Một bước hoàn tác cho clip + keyframe**: được refactor `moveClip`/`beginClipMove`/`endClipMove` trong `StudioSession`. Yêu cầu: một
   mục lịch sử chứa cả clip lẫn fcurves/userKeys (snapshot trước, áp hết, đẩy một mục). Kéo 1 clip đơn lẻ giữ nguyên hành vi cũ (test cũ xanh).
8. **Kẹp Δ chung**: Δ ≥ `frameStart − min(khung đầu mọi mục)`; Δ ≤ `frameEnd − max(khung keyframe)` (clip không có cận trên). Một Δ cho cả nhóm.
9. **Hợp đồng host ↔ builder khi rời**: nút "Về danh sách" nằm trong builder, tự `await session.save()` rồi gọi prop `onExitToList()`
   (host truyền `closeStudio`). Nút "Đóng" của host: builder đưa host một hàm `saveNow(): Promise<string|null>` qua prop callback
   (vd `onSaveApiReady(api)`), host gọi và chờ trước khi `onClose()`. Sửa `StudioOverlay`/`WorkbenchClient` nằm trong phạm vi App 2 (`apps/studio`).
10. **Dán lên khóa fcurve nướng sẵn (đạo cụ)**: chấp nhận sửa — người dùng đã chọn đúng khóa đó làm đích.
11. **Đo sai số khi dán**: so giá trị lưu trong khóa đích (fcurve `value` từng index / userKey `value`) với giá trị nguồn, ≤ 1e-6. Với node
   không có đường đi dẫn xuất, thêm so giá trị đánh giá tại khung đích. Kiểm sau `rederiveWalkPaths`.
12. **Ctrl+S** hoạt động ở mọi nơi trong trang App 2, kể cả khi đang gõ ô nhập (commit ô nhập trước bằng blur rồi lưu), luôn `preventDefault`.
13. **Nhấp đôi** nhảy đầu phát tới đúng khung của hình thoi được nhấp.
14. **Cổng thử**: 3140–3149 dành riêng cho việc này.

## 11. Builder tự quyết
Tên hàm/kiểu, vị trí nút trên thanh F2 (miễn thấy ngay, không che nút cũ), cách truyền hàm lưu từ builder sang host, chia file test.

## 12. Ràng buộc
Sửa `packages/builder` và phần host `apps/studio` (StudioOverlay/WorkbenchClient) + test. Không sửa `packages/retarget`, không đổi golden,
không commit binary/kho thật/project thật. Không `fetch` trong `packages/builder`. Test trên bản sao, luôn đặt `W01_LIBRARY` bản sao.
UI tiếng Việt, nền tối. `pnpm typecheck` toàn workspace trước push. Không dừng/đụng server cổng 3016 (App 2 thật, worktree
`S:\Claude\w01-app`) và 3101 (App 1). Không đè việc F1/F2 của đặc tả fcurve 2026-11-04.
