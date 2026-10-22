# Duyệt toàn bộ trong App 2 như trong Minecraft — giao việc (2026-10-22)

**Mục tiêu (người dùng chốt 2026-10-22):** xem và duyệt **toàn bộ** phim trong App 2, hình ảnh tương tự BBS FS 2.7
(Minecraft): khung hình, góc camera, chuyển động camera, hướng và động tác nhân vật, hậu cảnh, hiệu ứng. **Không vào
Minecraft để duyệt cho đến khi người dùng yêu cầu.** Phim chỉ xuất sang BBS FS ở bước cuối.

Chia việc: **Codex** làm phần code có test tự động, không cần chạy game hay trình duyệt (B1–B9). **Claude** làm phần
phải chạy thật (Chromium, Effekseer, so ảnh, BBS FS khi được yêu cầu), kiểm và merge PR của Codex (C1–C6).

## Cách nộp (Codex)
Repo `tuantranmarinainter-ops/3appclaude`, nhánh `main`. Quy tắc chung như `docs/AI-TASKS-2026-10-21.md`:
- Mỗi việc một nhánh `ai1/<mã>-<tên>` tạo từ `main` mới nhất, một PR vào `main`. **Không tự merge.**
- Mô tả PR: file đã sửa, lệnh test đã chạy, kết quả thật (PASS/FAIL/NOT_RUN), chỗ làm khác đặc tả.
- Trước khi mở PR (từ `three-workspace-app/editor`): `pnpm --filter @topview/3d-builder build`, `pnpm typecheck`,
  `npx vitest run` trong `packages/builder` (hiện 567 PASS), test Studio liên quan bằng
  `pnpm --filter @topview/3d-builder exec tsx --test <đường dẫn tuyệt đối>`.
- Không sửa `packages/retarget`, không sửa/tạo lại golden của builder (`src/evaluate/__tests__/golden*`), không đổi
  luật evaluate của App 2 (`evaluateSteps.ts`), không thêm dependency, không commit binary.
- Chỉ sửa đúng vùng file ghi trong bảng; cần sửa file khác thì ghi lý do trong PR.
- Chuỗi giao diện có cả tiếng Việt và tiếng Anh theo `useStudioLocale` như `components/scene-render`.

## Sự thật đã đo trong BBS FS 2.7 (không được làm sai)
- **Camera:** `apps/studio/src/filmCamera.ts` đổi mẫu camera App 2 sang keyframe BBS: yaw Minecraft (0 nhìn theo +Z)
  cộng 180, pitch, roll, `verticalFovDegrees`. Tỉ lệ khung lấy từ `viewportAspect` (`sceneBbsFilm.ts`, mặc định 16/9).
- **Model:** mọi model BOBJ (nhân vật và hậu cảnh) được cộng `FILM_MODEL_FACING_OFFSET` = 180° yaw khi xuất
  (`filmManifest.ts`, `unifiedJobs.ts`). Gốc toạ độ và độ cao chân khớp game (`C:\w01-samples\calib`).
- **Xoay khi có động tác:** App 2 bỏ qua keyframe xoay của nhân vật đang có động tác (golden Topview khoá, không đổi).
  Film vẫn xoay theo keyframe (`turnFilmSkeletonsByRotationKeys`, `unifiedFilmSampling.ts`). Xem trong App 2 phải giống
  **film**.
- **Diện mạo:** chế độ "Xem như BBS" đã có (`packages/builder/src/engine/objects/bbsLook.ts`, nút Shift+B,
  `Stage.setBbsLook`, `scene.render` có `bbsLook`): ánh sáng thực thể Minecraft, trời, sàn cỏ, texture Nearest.
- **Sàn game:** mặt khối cỏ ở y = 0.
- **Hiệu ứng:** hiện là lịch ngoài repo (`C:\w01-samples\tap15v2\effects.json`: effect, x, y, z, yaw, scale,
  startTick, endTick) do bộ quay thử AAA đọc; chưa nằm trong project App 2.

## Bảng việc
| Mã | Ai | Việc | Vùng file |
| --- | --- | --- | --- |
| B1 | Codex | Toán camera/actor BBS (thuần + test) | `apps/studio/src/bbsPreview.ts` (mới), `apps/studio/test/bbsPreview.test.ts` (mới); được thêm `export` cho hàm có sẵn trong `filmCamera.ts`/`filmManifest.ts`, không đổi logic |
| B2 | Codex | Lệnh `scene.preview.bbs`: lấy mẫu khung hình như film | `unifiedProjectStore.ts` (một nhánh lệnh), `bbsPreview.ts`, test mới |
| B3 | Codex | Bảng duyệt cảnh: dữ liệu + lệnh + giao diện | `apps/studio/src/sceneReview.ts` (mới), `apps/studio/app/workbench/components/scene-review/` (mới), nối `unifiedProjectStore.ts`, `StudioOverlay.tsx`, test mới |
| B4 | Codex | Xuất film 3 chế độ: chỉ nhân vật / chỉ hậu cảnh / cả hai | `sceneBbsFilm.ts`, `unifiedFilmSampling.ts`, `unifiedJobs.ts`, `components/film-export/`, test |
| B5 | Codex | Khung film: tỉ lệ lưu trong project, viền khung trong khung nhìn | `apps/studio/src/filmFrame.ts` (mới), `packages/builder/src/components/viewport/`, `packages/builder/src/engine/core/Viewport.ts`, test |
| B6 | Codex | Khung nhìn giống film: xoay theo keyframe khi có động tác (chỉ khi "Xem như BBS") | `packages/builder/src/engine/core/Stage.ts`, `packages/builder/src/engine/objects/filmPoseView.ts` (mới), test |
| B7 | Codex | Lệnh `camera.motion.add`: áp chuyển động camera từ thư viện bằng lệnh | `unifiedProjectStore.ts`, `apps/studio/src/cameraMotionCommand.ts` (mới), `agent/unified_*` nếu cần cho CLI, test |
| B8 | Codex | Làn hiệu ứng (VFX cue) trong project App 2 + xuất kèm film | `apps/studio/src/vfxCues.ts` (mới), `unifiedProjectStore.ts`, `unifiedJobs.ts`, `components/vfx-cues/` (mới), test |
| B9 | Codex | Phát hiệu ứng trong khung nhìn App 2 bằng bảng sprite (sprite sheet) | `packages/builder/src/engine/objects/vfxSprites.ts` (mới), `Stage.ts`, test |
| B10 | Codex | Kiểm trước khi xuất (báo cáo lỗi/cảnh báo) | `apps/studio/src/filmPreflight.ts` (mới), `components/film-export/`, `unifiedProjectStore.ts`, test |
| B11 | Codex | Gói cả tập: tự chia đoạn, xuất một gói nhiều film | `apps/studio/src/filmSeries.ts` (mới), `unifiedJobs.ts`, `unifiedProjectStore.ts`, `components/film-export/`, test |
| B12 | Codex | Nút "Cài vào BBS FS" (chép vào thư mục game, không ghi đè) | `apps/studio/src/bbsInstall.ts` (mới), route/API Studio, `components/film-export/`, test |
| B13 | Codex | Nút "Gửi sang App 2" trong Workbench App 1 | `packages/retarget/workbench/` (chỉ thư mục này), `apps/studio/src/` (lệnh nhận nếu cần), test |
| B14 | Codex | Lệnh "Kịch bản → cảnh" (`storyboard.build`) | `apps/studio/src/storyboard.ts` (mới), `unifiedProjectStore.ts`, `docs/STORYBOARD-FORMAT.md` (mới), test |
| B15 | Codex | Nhúng hiệu ứng AAA vào film | **chờ C7** (Claude bổ sung đặc tả) |
| B16 | Codex | Làn thoại và âm thanh trong App 2 | `apps/studio/src/audioCues.ts` (mới), `components/audio-cues/` (mới), `unifiedProjectStore.ts`, `unifiedJobs.ts`, khung nhìn (phát tiếng), test |
| C1 | Claude | Chạy B5+B6 trong Chromium, đo lệch so với ảnh game có sẵn (không vào game) | — |
| C2 | Claude | "Xem như BBS" (đã xong, commit `9197b6f`) | — |
| C3 | Claude | Nướng bảng sprite cho hiệu ứng bằng Effekseer thật (App 4) cho B9 | `three-workspace-app/vfx/` |
| C4 | Claude | Nối bảng duyệt (B3) với renderer, chạy Tập 15 | sau B2, B3 |
| C5 | Claude | Áp chuyển động camera cho Tập 15 bằng B7, duyệt trong App 2 | sau B7 |
| C6 | Claude | Kiểm trong BBS FS **chỉ khi người dùng yêu cầu** (hướng hậu cảnh, B4, B8, B11, B12) | — |
| C7 | Claude | Khảo sát cách addon AAA lưu hiệu ứng trong film BBS, viết đặc tả B15 | fork `BBS-AAAddon` |
| C8 | Claude | Khảo sát nâng giới hạn 255 tick / 3 camera của bộ xuất film | `agent/film_worker/` |

Thứ tự Codex: **B1 → B2 → B6 → B5 → B3 → B7 → B10 → B11 → B12 → B4 → B8 → B9 → B13 → B14 → B16**, B15 khi C7 xong.
B1–B2 là nền cho B3, B5, B6. Lệnh ghi mới phải được thêm vào danh sách lệnh hỗ trợ trong `unifiedProjectStore.ts`
(chỗ kiểm `UNSUPPORTED_CAPABILITY`).

---

## B1 — Toán camera/actor BBS (thuần)
`apps/studio/src/bbsPreview.ts`, chỉ dùng `three`, không DOM:
- `bbsCameraToThree(key: { x, y, z, yaw, pitch, roll, verticalFovDegrees }, aspect)` → `{ position, quaternion, fov,
  aspect, near }`: camera three.js nhìn đúng như BBS hiển thị keyframe đó; phép ngược chính xác của
  `cameraSamplesToFilm`. `near` = 0.05.
- `bbsActorToThree(sample: { x, y, z, yaw, pitch? })` → ma trận world như BBS đặt model, đã trừ
  `FILM_MODEL_FACING_OFFSET` để khớp hướng App 2.
- `filmFrameRect(viewW, viewH, aspect)` → khung film lớn nhất nằm giữa khung nhìn.
**Đạt khi:** (1) khứ hồi ≥ 50 tư thế camera ngẫu nhiên có seed (pitch ±80°, roll ≠ 0, yaw quanh ±180): vị trí ≤ 1e-6 m,
hướng nhìn/hướng lên ≤ 1e-6 rad; (2) `buildFilmExportManifest` → `bbsActorToThree` cho lại ma trận gốc App 2;
(3) `filmFrameRect`: khung vuông trong 1920x1080 = 1080x1080 ở giữa, 16/9 trong 1000x1000 = 1000x562.5 ở giữa;
(4) test film cũ (`filmCamera`, `filmManifest`, `filmRotationKeys`) PASS.

## B2 — Lệnh `scene.preview.bbs`
Một nhánh `if (envelope.command === 'scene.preview.bbs')` trong `unifiedProjectStore.ts` (mẫu `scene.evaluate`). Args
`{ sequenceId, frames: number[] (≤ 60), viewportAspect, characterIds?, propIds? }`. Không ghi file, không chạy
Java/Blender. Mỗi frame trả: `camera` (= `bbsCameraToThree` của keyframe film, cùng đường `sampleProjectCameraSequence`
+ `cameraSamplesToFilm`, khung 20 Hz, cùng cách làm tròn tick); `actors[]` `{ characterId | propId, worldMatrix,
bones: [{ name, worldMatrix }] }` từ `sampleProjectSkeletonRange` + `turnFilmSkeletonsByRotationKeys`; prop là ma trận
tĩnh như `unifiedJobs.ts`; `shot` = id clip editorial chứa frame. Kiểm đầu vào như `scene.render`.
**Đạt khi:** (1) dự án tổng hợp 1 nhân vật có clip + keyframe xoay 0→90: actor ở frame cuối quay 90°, `scene.evaluate`
thì không; (2) camera khớp `bbsCameraToThree(cameraSamplesToFilm(...))` từng frame; (3) frame giữa 2 tick lấy đúng tick
như film; (4) đầu vào sai → `VALIDATION_FAILED`; (5) test `unifiedProjectStore*` cũ PASS.

## B3 — Bảng duyệt cảnh
- Dữ liệu `sceneReview.ts` trong `project.extensions.sceneReview` = `{ version: 1, sequenceId, shots: { [clipId]:
  { status: 'pending' | 'ok' | 'note', note, sourceRevision, updatedAt } } }`. Hàm thuần `reviewStatusFor(project,
  clipId)`: cảnh `ok` tự về `pending` nếu sau đó có thay đổi node/clip/fcurve/VFX cue chạm khoảng frame của clip.
- `planReviewFrames(project, sequenceId)` → mỗi clip 3 frame ở 15%, 50%, 85%.
- Lệnh `scene.review.get` và `scene.review.set { sequenceId, clipId, status, note }` (có `expectedRevision`, ghi chú
  ≤ 2000 ký tự).
- Giao diện `components/scene-review/` mở từ nút **Duyệt cảnh** cạnh "BBS look" trong `StudioOverlay.tsx`: danh sách cảnh
  theo editorial; mỗi cảnh 3 ô ảnh (prop `images: Record<clipId, string[]>`, chưa có thì "Chưa chụp"), nút **Đạt**, ô
  **Ghi chú**, nút **Phát cảnh này** (callback `onPlay(clipId)`: nhảy timeline tới cảnh và phát), nút **Chụp lại**
  (callback `onCapture(clipId, frames)`), lọc Chưa duyệt / Có ghi chú / Đạt, tiến độ "x/y cảnh đạt".
**Đạt khi:** test `planReviewFrames`, `reviewStatusFor` (đổi trong clip → `pending`, ngoài clip → giữ `ok`), get/set
(revision cũ → `REVISION_CONFLICT`); `pnpm --filter @topview/3d-studio test:locales` không thêm lỗi mới (hiện có 6 lỗi
cũ); typecheck PASS.

## B4 — Xuất film 3 chế độ
`scene.export.bbsFilm` và `film.export` nhận `content: 'characters' | 'backdrops' | 'both'` (mặc định `'characters'`
để không đổi hành vi cũ):
- `'backdrops'`: không cần nhân vật (bỏ điều kiện "ít nhất một nhân vật" chỉ ở chế độ này); film có camera + mỗi hậu
  cảnh là một actor tĩnh riêng, tên = tên node, để người dùng chỉnh trong BBS FS. Ngân sách xương chỉ tính hậu cảnh.
- `'both'`: như hiện nay với `propIds` (mặc định tất cả hậu cảnh khi không truyền).
- Giao diện `components/film-export/`: chọn chế độ, danh sách tích chọn nhân vật và hậu cảnh (ẩn phần không dùng),
  báo lỗi rõ nếu hậu cảnh có scale ≠ 1 hoặc xoay ngoài trục dọc (đã có kiểm trong `sceneBbsFilm.ts`).
**Đạt khi:** test cho cả 3 chế độ (manifest đúng số actor, hậu cảnh có yaw = `FILM_MODEL_FACING_OFFSET - rotation.y`,
`'backdrops'` không có nhân vật vẫn xuất được manifest); test `sceneBbsFilm`, `filmExportJob.integration` PASS.

## B5 — Khung film trong project và trong khung nhìn
- `filmFrame.ts`: `project.extensions.filmFrame = { aspect: '16:9' | '9:16' | '1:1' | number }`; hàm đọc mặc định 16:9.
  `scene.export.bbsFilm`, `film.export` và `scene.render` dùng giá trị này khi không truyền `viewportAspect`. Lệnh
  `film.frame.set { aspect }` có `expectedRevision`.
- Khung nhìn App 2 (builder): khi "Xem như BBS" bật và đang nhìn qua camera, vẽ viền khung film (vùng ngoài khung tối
  70%) theo `filmFrameRect`, camera dùng đúng `aspect` của khung film (không theo tỉ lệ cửa sổ). Builder không biết
  project Studio: nhận aspect qua `Stage.setFilmFrameAspect(aspect | null)`; Studio gọi khi đọc project.
**Đạt khi:** test thuần cho đọc/ghi `filmFrame` và cho phép tính viền (vitest trong builder với kích thước khung nhìn
giả); typecheck PASS. Claude kiểm hình trong Chromium (C1).

## B6 — Khung nhìn giống film: xoay theo keyframe khi có động tác
Chỉ khi "Xem như BBS" bật (`Stage.bbsLook`), sau mỗi lần evaluate, xoay gốc nhân vật đang có động tác theo keyframe
`transform.rotation` giống hệt `turnFilmSkeletonsByRotationKeys` (cùng điều kiện: có motion clip phủ frame, không có
path `path-tangent`; chỉ thêm phần chênh từ xoay tĩnh sang xoay keyframe). Viết hàm thuần trong
`engine/objects/filmPoseView.ts` dùng chung công thức; **không** sửa `evaluateSteps.ts` hay golden. Tắt "Xem như BBS"
thì trả về đúng hành vi App 2 hiện tại.
**Đạt khi:** vitest: cùng dữ liệu, ma trận gốc nhân vật từ `filmPoseView` khớp ma trận actor của
`turnFilmSkeletonsByRotationKeys` (sai số ≤ 1e-9); khi tắt, snapshot khung nhìn không đổi; golden builder PASS nguyên.

## B7 — Lệnh `camera.motion.add`
Áp một chuyển động trong thư viện (`CAMERA_MOTIONS`, 30 mục) cho camera bằng lệnh, để script/MCP dùng được:
`camera.motion.add { cameraNodeId, presetId, frameStart, durationFrames?, targetNodeId?, config?: { strength?, angleDeg?,
distance?, fovDelta?, height? } }`. Dùng `bakeCameraMotionClip` (thuần) như `applyCameraMotion` trong
`sync/libraryActions.ts`, thêm clip vào `timeline.animation.cameraMotionClips`, kiểm chồng lấn bằng luật có sẵn
(`cameraMotionExclusive`, `cameraMotionRange`). Thêm `camera.motion.remove { clipId }`. Nếu `agent/unified_cli.py`
liệt kê lệnh hợp lệ thì thêm vào đó.
**Đạt khi:** test: dolly_in trên camera tổng hợp làm vị trí camera tiến dọc hướng nhìn ở frame cuối; preset sai, camera
sai, chồng lấn → `VALIDATION_FAILED`; mẫu camera film (`sampleProjectCameraSequence`) đổi theo clip (tức là xuất film
giữ chuyển động); Python `agent.test_unified_cli` PASS nếu có sửa.

## B8 — Làn hiệu ứng (VFX cue) trong project App 2
- `vfxCues.ts`: `project.extensions.vfxCues = { version: 1, cues: [{ id, effect, frameStart, frameEnd, position: {x,y,z},
  yaw, scale, attachNodeId?, attachBone? }] }`. `effect` là tên hiệu ứng trong kho App 4 (chuỗi, ví dụ `aura01`).
  `attachNodeId` thì vị trí tính tương đối gốc node đó (theo frame).
- Lệnh `vfx.cue.add | update | remove | list` có `expectedRevision`.
- Xuất film: thêm `effects.json` vào gói film (cùng định dạng đang dùng: `[{ effect, x, y, z, yaw, scale, startTick,
  endTick }]`, tick 20 Hz tính từ đầu đoạn xuất), chỉ các cue giao với khoảng xuất; ghi trong `README.txt` của gói.
- Giao diện `components/vfx-cues/`: danh sách cue của cảnh đang chọn, thêm/sửa/xoá, nhập frame, vị trí, cỡ.
**Đạt khi:** test: cue gắn node theo node khi node di chuyển; đổi frame sang tick đúng như
`C:\w01-samples\tap15v2\export_v2.mts` (`/1.5` cho 30 fps); cue ngoài khoảng bị bỏ; lệnh sai → `VALIDATION_FAILED`.

## B9 — Phát hiệu ứng trong khung nhìn bằng bảng sprite
Mỗi hiệu ứng có một **bảng sprite** do Claude nướng sẵn bằng Effekseer thật (C3):
`<kho>/vfx-previews/<effect>/sheet.png` + `sheet.json` `{ frames, columns, rows, fps, sizeMeters, pivot: [u, v],
blend: 'add' | 'alpha', loop }`. Builder (`vfxSprites.ts`): với mỗi cue đang hoạt động ở frame hiện tại, vẽ một
billboard quay về camera, chọn ô theo `(frame - frameStart) / 30 * fps`, blend theo `sheet.json`, cỡ `sizeMeters × scale`.
Studio truyền danh sách cue + URL bảng sprite qua `Stage.setVfxCues(...)`. Không có bảng sprite thì vẽ ô vuông viền
màu kèm tên hiệu ứng (để vẫn duyệt được vị trí/thời gian).
**Đạt khi:** vitest thuần cho chọn ô (frame đầu, giữa, cuối, loop/không loop), cỡ, cue ngoài khoảng không vẽ,
không có sheet → placeholder; typecheck PASS. Claude kiểm hình (C3).

## B10 — Kiểm trước khi xuất
`filmPreflight.ts`: hàm thuần `filmPreflight(project, args)` → `{ errors: Issue[], warnings: Issue[] }`, mỗi `Issue`
`{ code, message (vi + en), nodeId?, clipId?, frame? }`. Lỗi (chặn xuất): hậu cảnh scale ≠ 1 hoặc xoay ngoài trục dọc,
nhân vật có shear/scale ≠ 1, đoạn > 255 tick, > 3 camera, vượt ngân sách xương `bones × (ticks + 1) ≤ 32768`, asset
thiếu file. Cảnh báo: cảnh chưa Đạt trong bảng duyệt (B3), VFX cue không có bản BBS (B8), nhân vật dưới sàn
(y < -0.05) hoặc lơ lửng (chân > 0.3 m khi không có động tác nhảy/rơi). Lệnh `film.preflight` (chỉ đọc). Khung xuất hiện
danh sách, nút Xuất bị khoá khi có lỗi. Dùng lại các kiểm có sẵn trong `sceneBbsFilm.ts`, `filmManifest.ts`,
`unifiedFilmSampling.ts` (tách thành hàm dùng chung, không chép hai nơi).
**Đạt khi:** test cho từng mã lỗi/cảnh báo trên dự án tổng hợp; dự án sạch → không lỗi; test film cũ PASS.

## B11 — Gói cả tập (tự chia đoạn)
`filmSeries.ts`: chia một sequence editorial thành các đoạn vừa giới hạn worker, theo đúng logic
`C:\w01-samples\tap15v2\export_v2.mts` (`fits`: ≤ 3 clip, ≤ 255 tick, ngân sách xương), không cắt giữa clip; clip đơn
vượt giới hạn → lỗi rõ ràng (gợi ý cắt cảnh). Lệnh `scene.export.bbsFilmSeries { sequenceId, name, content?, ... }`
chạy lần lượt từng đoạn bằng job hiện có, rồi đóng **một zip**: `films/<name>-01.dat …`, `assets/` (gộp, không trùng),
`series.json` `[{ order, film, shots, startFrame, endFrame, ticks }]`, `effects.json` theo từng film (B8), `README.txt`
(sửa chữ "BBS FS 2.4" thành 2.7, ghi cách cài). Khung xuất có lựa chọn "Cả tập".
**Đạt khi:** test chia đoạn (biên đúng, không cắt clip, ra 7 đoạn như Tập 15 khi đưa cùng thông số), zip đủ file và
`series.json` đúng thứ tự; job lỗi giữa chừng → không để lại zip dở.

## B12 — Cài vào BBS FS
`bbsInstall.ts` (host Studio, Node): `planInstall(packageZip, gameDir, worldName)` → danh sách file sẽ chép
(`assets/**` → `<gameDir>/config/bbs/assets/**`, `films/*.dat` → `<gameDir>/saves/<world>/bbs/films/`), đánh dấu file
đã tồn tại (khác nội dung → **không ghi đè**, báo xung đột; giống hệt → bỏ qua). `applyInstall(plan)` chép và ghi nhật
ký `<gameDir>/config/bbs/w01-install-log.json` (thời gian, gói, danh sách file) để gỡ theo nhật ký. Giao diện: nhập thư
mục game (nhớ trong localStorage), chọn world (liệt kê `saves/*` có `level.dat`), xem trước danh sách, bấm **Cài**.
Không xoá file ngoài nhật ký; không chép khi chưa bấm xác nhận.
**Đạt khi:** test trên thư mục tạm: cài, cài lại (bỏ qua), xung đột (không ghi đè), gỡ theo nhật ký; đường dẫn thoát
khỏi `gameDir` (zip slip) bị chặn.

## B13 — "Gửi sang App 2" từ Workbench App 1
Workbench (`packages/retarget/workbench/`) sau khi chạy xong có nút **Gửi sang App 2**: gọi API Studio (địa chỉ cấu
hình, mặc định `http://127.0.0.1:3002`) để nhập GLB + manifest vào kho App 5 và (tuỳ chọn) vào project đang mở bằng
`asset.import` có `manifest` / `library.place`. Báo kết quả (số Action, id). Không sửa thuật toán retarget.
**Đạt khi:** test workbench với Studio giả (HTTP mock): gửi đúng file, đúng manifest; Studio lỗi → báo lỗi, không mất
kết quả; `test/workbench.test.ts` cũ PASS.

## B14 — "Kịch bản → cảnh"
`docs/STORYBOARD-FORMAT.md` + `storyboard.ts`: định dạng JSON `storyboard.v1` theo các trường đã dùng trong
`C:\w01-samples\tap15v2\episode_v2.mts` (mảng `SHOTS`): mỗi cảnh `{ id, sec, camera: { target, az, el, dist, fov?,
motion?: { presetId, config? } }, actors: [{ who, at, yaw, acts: [[action, t0, t1]], moves?: [[t, x, y, z, yaw?]] }],
props?: [{ asset, at, yaw }], fx?: [như VFX cue], lines?: [[speaker, text, t]] }` và bảng `cast` ánh xạ `who` → asset
nhân vật + bộ Action. Lệnh `storyboard.build { storyboard }` dựng vào project: nhân vật, động tác (lặp clip như script),
keyframe vị trí/xoay, camera mỗi cảnh + chuyển động (B7), hậu cảnh, VFX cue (B8), thoại (B16), editorial sequence.
Mỗi cảnh ở một vùng riêng (`area` mặc định 40 m theo trục x) như script.
**Đạt khi:** test dựng storyboard tổng hợp 3 cảnh: đúng số node, clip, keyframe, camera, sequence; dựng lại cùng file ra
cùng kết quả (id ổn định theo `id` cảnh); tham chiếu sai (`who`, action, preset) → `VALIDATION_FAILED` kèm vị trí.

## B16 — Làn thoại và âm thanh
`audioCues.ts`: `project.extensions.audioCues = { version: 1, cues: [{ id, kind: 'voice' | 'sfx' | 'music', assetId,
frameStart, gainDb, speaker?, text? }] }`; âm thanh là asset của project (nhập WAV/MP3 qua `asset.import`). Lệnh
`audio.cue.add | update | remove | list`. Khung nhìn App 2 phát tiếng theo timeline khi Play (Web Audio, đồng bộ frame,
dừng khi Pause/Seek), phụ đề thoại hiện dưới khung film. Xuất: thêm `audio/` + `audio.json` vào gói film/gói cả tập,
và lệnh `audio.mixdown` trả một WAV trộn (giảm nhạc khi có thoại như `C:\w01-samples\tap15v2\build_v2.py`).
**Đạt khi:** test thuần cho lịch phát (cue nào kêu ở frame nào), mixdown (độ dài đúng, nhạc giảm ≥ 6 dB khi có thoại),
lệnh sai → `VALIDATION_FAILED`; phần Web Audio test với AudioContext giả.

## B15 — Nhúng hiệu ứng AAA vào film
Chờ Claude làm C7 (đọc fork `BBS-AAAddon` nhánh `fs-2.7`: hiệu ứng được lưu thế nào trong film/replay) rồi bổ sung đặc
tả vào đây. Không bắt đầu trước khi mục này có nội dung.

---

## Phần Claude (có runtime)
- **C1:** chạy B5 + B6 trong Chromium; so với ảnh game **đã có** (hiệu chuẩn, cảnh 04/09/13 Tập 15): lệch tâm nhân
  vật ≤ 4 px, lệch cỡ ≤ 2% ở khung 960x960.
- **C2:** "Xem như BBS" — xong (`9197b6f`).
- **C3:** nướng bảng sprite từ Effekseer thật cho 9 hiệu ứng đang dùng (aura01, barrior01, forcefieldtornado, toonhit,
  light, simple_turbulence_fireworks, simple_ring_shape1, simple_ribbon_sword, laser01); so với ảnh game đã có.
- **C4:** nối bảng duyệt (B3) với `scene.render` + `bbsLook`, chạy Tập 15, gửi người dùng duyệt trong app.
- **C5:** áp chuyển động camera cho 20 cảnh Tập 15 bằng B7 theo bảng người dùng duyệt; chuyển lịch hiệu ứng ngoài repo
  vào làn VFX (B8); duyệt trong App 2.
- **C6:** chỉ khi người dùng yêu cầu: quay trong BBS FS để kiểm hướng hậu cảnh, B4, B8, B11, B12.
- **C7:** đọc fork AAA (`fs-2.7`), xác định cách lưu hiệu ứng trong film BBS, viết đặc tả B15.
- **C8:** khảo sát nâng giới hạn 255 tick / 3 camera của bộ xuất (`agent/film_worker/`, bản BBS FS 2.7); nâng được thì
  B11 dùng giới hạn mới.
