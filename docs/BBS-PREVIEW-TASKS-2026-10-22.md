# Xem như BBS trong App 2 — giao việc (2026-10-22)

Mục tiêu: duyệt cảnh ngay trong App 2, không phải xuất film vào BBS FS rồi chụp. Khung nhìn camera trong app phải ra
cùng khung hình, góc nhìn, hướng nhân vật và gần cùng diện mạo với BBS FS 2.7. Bảng duyệt cảnh chụp sẵn 3 khoảnh khắc
mỗi cảnh, người dùng bấm Đạt hoặc ghi chú ngay trong app; chỉ vào game một lần cuối để quay video.

Chia việc (người dùng chốt 2026-10-22): **Codex** làm phần code thuần có test tự động, không cần chạy game hay trình
duyệt. **Claude** làm phần phải chạy thật (BBS FS, Chromium, so ảnh) và kiểm, merge PR của Codex.

Repo `tuantranmarinainter-ops/3appclaude`, nhánh `main`. Quy tắc chung như `docs/AI-TASKS-2026-10-21.md`, cách nộp
như `docs/AI-TASKS-ROUND3-2026-10-21.md`: mỗi việc một nhánh `ai1/<mã>-<tên>` từ `main` mới nhất, mở PR vào `main`,
mô tả PR = file đã sửa, lệnh test, kết quả thật (PASS/FAIL/NOT_RUN). **Không tự merge.** Phải chạy
`pnpm --filter @topview/3d-builder build` rồi `pnpm typecheck` (từ `three-workspace-app/editor`) trước khi mở PR.
Không sửa `packages/retarget`, không sửa golden của builder (`src/evaluate/__tests__/golden*`), không thêm dependency.

## Sự thật đã đo trong BBS FS 2.7 (không được làm sai)
- Camera: `apps/studio/src/filmCamera.ts` đổi mẫu camera App 2 sang keyframe BBS: yaw Minecraft (0 nhìn theo +Z) cộng
  180, pitch, roll, `verticalFovDegrees`. Tỉ lệ khung (`aspect`) lấy từ `viewportAspect` của lệnh xuất
  (`sceneBbsFilm.ts`, mặc định 16/9). Bản quay thử Tập 15 dùng khung vuông 960x960.
- Nhân vật: mọi model BOBJ được cộng 180° yaw khi xuất (`filmManifest.ts`, `facingOffset`), sau đó trong game quay
  đúng như App 2. Gốc toạ độ, độ cao chân khớp (ảnh `C:\w01-samples\calib\bbs-calib-fixed.png`).
- Keyframe xoay của nhân vật **đang có động tác** bị App 2 bỏ qua (golden Topview khoá, không đổi), nhưng bộ xuất film
  vẫn xoay theo keyframe (`turnFilmSkeletonsByRotationKeys` trong `unifiedFilmSampling.ts`). Chế độ xem như BBS phải
  hiển thị giống **film**, tức là có xoay này.
- Sàn game: mặt khối cỏ ở y = 0 (khối cỏ chiếm y −1..0). Prop hậu cảnh xuất thành actor tĩnh (`unifiedJobs.ts`).

| Mã | Ai | Việc | Vùng file |
| --- | --- | --- | --- |
| B1 | Codex | Mô hình camera/actor BBS thuần (toán + test) | `apps/studio/src/bbsPreview.ts` (mới), `apps/studio/test/bbsPreview.test.ts` (mới); được thêm `export` cho hàm có sẵn trong `filmCamera.ts`/`filmManifest.ts`, không đổi logic |
| B2 | Codex | Lệnh xem trước: lấy mẫu khung hình như film | `apps/studio/src/unifiedProjectStore.ts` (chỉ thêm nhánh lệnh), `apps/studio/src/bbsPreview.ts`, test mới |
| B3 | Codex | Bảng duyệt cảnh: dữ liệu + lệnh + giao diện | `apps/studio/src/sceneReview.ts` (mới), `apps/studio/app/workbench/components/scene-review/` (mới), nối vào `unifiedProjectStore.ts`, locale, test mới |
| C1 | Claude | Chế độ "Xem như BBS" trong khung nhìn App 2 (khung film, camera B1) | `packages/builder/src/components/viewport/`, `packages/builder/src/engine/core/` |
| C2 | Claude | Diện mạo Minecraft (trời, sàn cỏ, đổ bóng mặt khối, texture không lọc) | như C1 |
| C3 | Claude | Đo lệch so với ảnh game (hiệu chuẩn + 3 cảnh Tập 15), báo số pixel | script ngoài repo + `docs/` |
| C4 | Claude | Nối B3 với renderer thật, chạy trên Tập 15 | sau khi B2, B3, C1 merge |

Thứ tự Codex: B1 → B2 → B3. Hiệu ứng Effekseer trong App 2 (nối App 4 vào App 2) **chưa giao**: chờ người dùng duyệt
riêng.

---

## B1 — Mô hình camera/actor BBS (thuần)
Viết `apps/studio/src/bbsPreview.ts`, chỉ dùng `three` (đã có), không DOM:
- `bbsCameraToThree(key: { x, y, z, yaw, pitch, roll, verticalFovDegrees }, aspect)` → `{ position, quaternion, fov,
  aspect, near }`: camera three.js nhìn đúng như BBS hiển thị keyframe đó. Phải là phép ngược chính xác của
  `cameraSamplesToFilm` (`filmCamera.ts`): trừ lại 180 ở yaw, cùng quy ước pitch/roll. `near` = 0.05 (Minecraft).
- `bbsActorToThree(sample: { x, y, z, yaw, pitch? })` → ma trận world của actor như BBS đặt model, đã trừ
  `facingOffset` 180 để khớp hướng App 2.
- `filmFrameRect(viewW, viewH, aspect)` → hình chữ nhật khung film lớn nhất nằm giữa khung nhìn (letterbox/pillarbox).

**Đạt khi** `bbsPreview.test.ts`:
1. Khứ hồi: camera App 2 bất kỳ (≥ 50 tư thế ngẫu nhiên có seed, gồm pitch ±80°, roll ≠ 0, yaw quanh ±180) →
   `cameraSamplesToFilm` → `bbsCameraToThree` cho lại vị trí (sai số ≤ 1e-6 m) và hướng nhìn/hướng lên (≤ 1e-6 rad).
2. Actor: `buildFilmExportManifest` (yaw đã +180; được export thêm `actorTransform` nội bộ nếu cần test) → `bbsActorToThree` cho lại ma trận gốc của App 2.
3. `filmFrameRect` cho khung vuông trong 1920x1080 = 1080x1080 ở giữa; 16/9 trong 1000x1000 = 1000x562.5 ở giữa.
4. Test film cũ (`filmCamera`, `filmManifest`, `filmRotationKeys`) vẫn PASS.

## B2 — Lệnh `scene.preview.bbs`: lấy mẫu khung hình như film
Thêm lệnh vào `unifiedProjectStore.ts` (chỉ một nhánh `if (envelope.command === 'scene.preview.bbs')`, theo mẫu
`scene.evaluate`): args `{ sequenceId, frames: number[] (≤ 60), viewportAspect, characterIds?, propIds? }`. Không ghi
file, không chạy Java/Blender. Trả cho mỗi frame:
- `camera`: kết quả `bbsCameraToThree` của keyframe film tại frame đó (dùng chính đường lấy mẫu của film:
  `sampleProjectCameraSequence` + `cameraSamplesToFilm`, khung 20 Hz, cùng cách làm tròn tick);
- `actors[]`: `{ characterId | propId, worldMatrix, bones: [{ name, worldMatrix }] }` lấy từ cùng đường lấy mẫu của film
  (`sampleProjectSkeletonRange` + `turnFilmSkeletonsByRotationKeys`), tức là **có** xoay theo keyframe khi đang có động
  tác; prop là ma trận tĩnh như `unifiedJobs.ts` đang xuất;
- `shot`: id clip của editorial chứa frame.
Kiểm đầu vào như `scene.render` (frame trong timeline, sequence tồn tại, ≤ 60 frame).

**Đạt khi** test mới: (1) dự án tổng hợp 1 nhân vật có clip + keyframe xoay 0→90: ma trận actor ở frame cuối quay 90°
còn `scene.evaluate` thì không (đúng luật App 2); (2) camera trả về khớp `bbsCameraToThree(cameraSamplesToFilm(...))`
từng frame; (3) frame nằm giữa 2 tick 20 Hz lấy đúng tick gần nhất như film; (4) đầu vào sai → `VALIDATION_FAILED`;
(5) `test/unifiedProjectStore*` cũ PASS.

## B3 — Bảng duyệt cảnh
**Dữ liệu** (`sceneReview.ts`): lưu trong `project.extensions.sceneReview` =
`{ version: 1, sequenceId, shots: { [clipId]: { status: 'pending' | 'ok' | 'note', note: string, sourceRevision: number,
updatedAt } } }`. Khi dự án đổi revision mà cảnh đó có thay đổi (node/clip/fcurve liên quan tới khoảng frame của
clip), trạng thái `ok` tự về `pending` khi đọc (hàm thuần `reviewStatusFor(project, clipId)`).
- `planReviewFrames(project, sequenceId)` → mỗi clip 3 frame ở 15%, 50%, 85% độ dài (làm tròn, nằm trong clip).
- Lệnh `scene.review.get` (đọc) và `scene.review.set` `{ sequenceId, clipId, status, note }` (ghi, có
  `expectedRevision`, ghi chú ≤ 2000 ký tự).
**Giao diện** `components/scene-review/`: danh sách cảnh theo editorial; mỗi cảnh 3 ô ảnh (nhận ảnh qua prop
`images: Record<clipId, string[]>` dạng URL; chưa có ảnh thì ô trống ghi "Chưa chụp"), nút **Đạt**, ô **Ghi chú**,
bộ lọc Chưa duyệt / Có ghi chú / Đạt, đếm tiến độ "x/y cảnh đạt". Nút **Chụp lại cảnh này** gọi callback prop
`onCapture(clipId, frames)` (Claude nối renderer ở C4). Chuỗi giao diện có cả tiếng Việt và tiếng Anh theo
`useStudioLocale` như `scene-render`.
**Đạt khi** test thuần cho `planReviewFrames`, `reviewStatusFor` (đổi keyframe trong clip → về `pending`; đổi ngoài
clip → giữ `ok`), lệnh get/set (revision cũ → `REVISION_CONFLICT`); test locale của Studio
(`pnpm --filter @topview/3d-studio test:locales`) PASS; typecheck PASS.

---

## Phần Claude (có runtime)
- **C1**: nút "Xem như BBS" trong khung nhìn camera của App 2: khung film theo `filmFrameRect`, camera theo B1/B2,
  nhân vật theo ma trận film. Kiểm trong Chromium.
- **C2**: trời màu Minecraft, mặt cỏ ở y = 0, đổ bóng theo mặt (trên 1.0, Bắc/Nam 0.8, Đông/Tây 0.6, dưới 0.5),
  texture lọc `Nearest`. Chỉnh theo ảnh game.
- **C3**: chụp cùng frame trong app và trong BBS FS (6 nhân vật hiệu chuẩn, cảnh 04, 09, 17 Tập 15), so viền nhân vật,
  báo lệch tâm (px) và lệch cỡ (%) ở khung 960x960. Mục tiêu: lệch tâm ≤ 4 px, lệch cỡ ≤ 2%.
- **C4**: nối bảng duyệt với renderer, chạy Tập 15, gửi người dùng duyệt thử.
