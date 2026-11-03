# Report: App 3 "1 khung · Cả cảnh" (2026-11-03)

Đặc tả: `docs/APP3-SCENE-MODE-TASK-2026-11-03.md`. Trạng thái: NOT_RUN / BLOCKED / FAIL / PASS (FAIL chỉ khi đã chạy và vi phạm).

## Môi trường đo
- Máy: Linux cloud container (Claude Code on the web), Node 22.23.4, Python 3.13. **Không có ổ `S:\`**: bản sao
  `tall-projects` (Tập 15 · Shot 01, Đen + Gỗ Xưa) và `tall-lib` không có trên máy này.
- Vì vậy số đo dưới đây chạy trên **dự án tổng hợp** dựng trong test từ nhân vật builtin Mixamo65
  (`builtin-assets/characters/a3d_char_30ec…glb`) + 2 Action sinh bằng `packages/retarget/cli/normalize.ts` từ mẫu
  V9.12 trong repo. Project và Thư viện đều ở thư mục tạm (`BBS_UNIFIED_PROJECTS_DIR`, `W01_LIBRARY` = temp).
- Mục đo trên Tập 15 thật: **BLOCKED** (thiếu dữ liệu trên máy này), người dùng chạy lại trên máy Windows.

## S1: hợp đồng gói shot (nhánh `claude/app3-scene-s1`)

### Đã làm
- `shot.export` nhận `sceneMode: true`: `editableCharacterIds[0]` = nhân vật sửa đầu tiên. Khoảng nới tới điểm cố định theo
  **chuỗi** clip (trộn hoặc liền nhau, `blendChains` như #204) của mọi nhân vật chạm khoảng (§10.1); mọi nhân vật có clip trong
  khoảng đều vào gói, `editable: true`, nướng bằng `bakeShotChain` (sampler App 2), nhân vật sửa đầu tiên đứng đầu;
  `shot.json` có `sceneMode: true`. Phản hồi thêm `frameRange`, `sceneMode`, `characterIds`, `widened`.
- `shot.result.import` nhận `merges: {characterId: {name, description}}`; mỗi nhân vật đã sửa: chuỗi clip trong khoảng → **một clip**
  phủ trọn khoảng; nhân vật không sửa không đụng tới; cả lần nhập = một revision = một Undo. Lỗi lưu Thư viện → báo
  "Không lưu được Thư viện cho nhân vật <tên>: …", project không đổi (§10.3). Trả thêm `mergedClipIds`.
- Validator TS (`shotPackage.ts`) và Python (`agent/shot_package.py`): nhận gói nhiều editable khi `sceneMode: true`; `sceneMode`
  không phải boolean → `INVALID_TYPE`. Gói một nhân vật không đổi.
- Broker App 3 (`app3Artifacts.prepareShot`, `app3Bridge`): gói `sceneMode` chấp nhận ≥1 editable, kiểm từng nhân vật với bản ghi
  đã xuất; Action nướng (không nằm trong `project.motions`) không làm phiên bị coi là thay thế.
- Hợp đồng: `docs/SHOT-PACKAGE-CONTRACT.md` mục "sceneMode (2026-11-03)".

### Số đo S1 (dự án tổng hợp, `apps/studio/test/app3SceneModeS1.test.ts`)
| Mục | Ngưỡng | Đo | Trạng thái |
| --- | --- | --- | --- |
| Gói nướng khớp sampler App 2, xương (khung 0/44/87, 2 nhân vật) | ≤ 0,5° | 0,0616° | PASS |
| Gói nướng khớp sampler App 2, root Hips | ≤ 1 cm | 0,0000 cm | PASS |
| Vị trí đặt trong gói so với `scene.evaluate` | ≤ 1 cm / ≤ 1° | 0,0000 cm / 0,0000° | PASS |
| Nhân vật không sửa sau khi trả về: hash clip/binding/motion | giữ nguyên | giữ nguyên | PASS |
| Trả về 2 và 5 nhân vật, một Undo khôi phục scene + extensions | bằng nhau | bằng nhau | PASS |
| Xuất gói 5 nhân vật (frameRange 0–116) | (S2 đo thời gian mở ≤ 15 s) | 531 ms | đo phía server |
| Nhập kết quả 5 nhân vật | — | 149 ms | đo phía server |
| Gói một nhân vật cũ (không `sceneMode`) | 1 editable, không có khóa `sceneMode` | đúng | PASS |
| Khớp F2 trên Tập 15 · Shot 01 thật | §8 | — | BLOCKED (không có dữ liệu trên máy này) |

Giới hạn đã biết (giữ như K5): vị trí đặt nhân vật trong gói lấy tại khung đầu khoảng; nhân vật có key di chuyển node trong khoảng
sẽ hiện đứng yên ở App 3. Mục này sẽ đo ở S2 khi App 3 đặt nhân vật.

### Test đã chạy (S1)
| Bộ test | Kết quả |
| --- | --- |
| `apps/studio/test/app3SceneModeS1.test.ts` (mới) | 8/8 đạt |
| `apps/studio/test/app1Import.test.ts` | 9/9 đạt |
| `apps/studio/src/app3Artifacts.test.ts` | 3/3 đạt |
| `apps/studio/test/app3Embed.test.ts` | 3/3 đạt |
| `apps/studio/test/clipBlendK5.pure.test.ts` | 9/9 đạt |
| `apps/studio/test/exportShotSelection.test.ts` | 6/6 đạt |
| `python -m unittest agent.test_shot_package` | 63/63 đạt (3 test mới) |
| `python -m unittest agent.test_unified_cli agent.test_unified_mcp` | 57/57 đạt |
| `pnpm typecheck` toàn workspace | đạt |
| `clipBlendK5.test.ts`, `nativeCharacterShot.test.ts` | bỏ qua (cần mẫu ở `S:\`/`C:\`, không có trên máy này) |
| Công cụ kiểm id App 3 (S1 không sửa App 3) | 497 id trước = 497 id sau, thiếu 0 |
| Toàn bộ `apps/studio/test/*.test.ts` (S1) | 416 test: 397 đạt, 2 lỗi, 17 bỏ qua |
| Toàn bộ `apps/studio/test/*.test.ts` (main, mốc so sánh) | 408 test: 389 đạt, 2 lỗi, 17 bỏ qua |

Hai lỗi giống hệt nhau trên main và S1, không liên quan shot: "B33 recognises Minecraft launched from the game folder only"
và "navigation hint dismissal is shared across ports through a cookie" (lỗi môi trường Linux, có sẵn từ trước).

## S2: actor xem, bố cục "1 khung · Cả cảnh", phát đồng bộ, camera cảnh (nhánh `claude/app3-scene-s2`)

### Đã làm
- App 3 (`scene_shot.js` mới + `shot_controller.js`): gói `sceneMode` nạp nhân vật sửa đầu tiên như cũ, các nhân vật khác là **actor xem**
  (mesh GLB + `AnimationMixer` phát bản nướng, không Control Rig/IK). Mọi nhân vật đặt theo `placement` của F2: điểm Y-up `(x,y,z)` →
  editor Z-up `(x,−z,y)`, wrapper `B·T(p)·R_y(yaw)·S(heightScale)`; key của nhân vật sửa không đổi (chỉ wrapper). Không nạp đạo cụ.
- Bố cục mới `sceneSingle` "1 khung · Cả cảnh" (sau 4 khung; 4 bố cục cũ không đổi), tự chọn khi mở gói cả cảnh.
- Phát/tua: actor xem theo đúng thời gian editor.
- "Nhìn qua camera cảnh" (`#sceneCameraBtn`): theo key camera từng khung (vị trí, lookAt, FOV), tỉ lệ khung `shot.camera.aspect`
  (`readFilmFrameAspect`, B61) với viền đen; xoay/kéo/zoom chuột thoát về góc tự do.
- **Sửa lỗi có sẵn** (cũng ảnh hưởng shot chuỗi clip K5): gói nướng có track trên node `<TÊN>_Armature` (không phải xương, K2 căn chỗ đứng);
  rig App 3 chỉ ghi key xương nên nhân vật đang sửa lệch tới 2,3 cm theo trục dọc. Nay gộp chuyển động node cha vào key xương gốc.
- Công cụ đo: `apps/studio/scripts/sceneModeFixture.mts` (tạo bản sao 2/5 nhân vật; `--projects … --five` nhân bản trên **bản sao**
  dự án thật theo §10.7; từ chối kho/dự án thật và khi thiếu `W01_LIBRARY`; xuất gói + số mẫu App 2) và
  `animation-studio/…/src/scene_shot_f2.measure.mjs` (mở gói trong App 3 thật bằng Chromium, so từng xương với số mẫu App 2).

### Số đo S2 (App 3 build thật, Chromium headless; dự án tổng hợp, mesh giải nén Draco)
| Mục | Ngưỡng | 2 nhân vật | 5 nhân vật | Trạng thái |
| --- | --- | --- | --- | --- |
| Root mỗi nhân vật so với sampler App 2 (khung đầu/giữa/cuối) | ≤ 1 cm, ≤ 1° | 0 cm, 0° | 0 cm, 0° | PASS |
| Xoay xương, nhân vật đang sửa | ≤ 0,5° | 0,000031° | 0,000067° | PASS |
| Xoay xương, actor xem | ≤ 0,5° | 0,000069° | 0,000050° | PASS |
| Vị trí xương, nhân vật đang sửa (trước sửa lỗi Armature: 2,3345 cm) | — | 0,000035 cm | 0,000073 cm | đo được |
| Số xương so sánh / thiếu | — | 390 / 0 | 975 / 0 | — |
| Thời gian mở gói trong App 3 | ≤ 15 s | 0,79 s | 1,61 s | PASS (máy cloud) |
| FPS khi phát | ≥ 30 | 1,0 | 1,2 | **BLOCKED**: máy chỉ có đồ họa phần mềm SwiftShader; shot 1 nhân vật cũ cũng chỉ 1,5–4,6 FPS. Phần đồng bộ actor xem tốn 0,22 ms/khung với 5 nhân vật. Cần đo trên máy có GPU. |
| Khớp F2 trên Tập 15 · Shot 01 thật | §8 | — | — | BLOCKED (không có dữ liệu trên máy này) |

Ảnh bằng chứng (không commit, binary): bố cục "1 khung · Cả cảnh" với 2 và 5 nhân vật, khung nhìn qua camera cảnh có viền đen, ảnh đang phát.

### Vấn đề có sẵn phát hiện khi đo (chưa sửa, cần người dùng quyết)
- **Draco**: 4 nhân vật builtin (`builtin-assets/characters/*.glb`) nén `KHR_draco_mesh_compression`; App 3 không có bộ giải Draco nên
  shot nướng từ model builtin (kể cả shot một nhân vật K5) không hiện mesh trong App 3. Nhân vật Thư viện (Đen, Gỗ Xưa) đi đường model
  thư viện, có thể không bị. Sửa trong App 3 cần thêm bộ giải (file WASM, binary). Dữ liệu đo ở trên giải nén trước khi nhập (chỉ trong script).

### Test đã chạy (S2)
| Bộ test | Kết quả |
| --- | --- |
| App 3: `scene_shot.test`, `layout_modes.test`, `shot_package.test`, `app3_bridge.test`, `app3_workflow_steps.test` | 70/70 đạt |
| App 3: `scene_shot.browser.test` (Chromium) | 1/1 đạt |
| App 3: `shot_export.test` | bỏ qua (cần `SHOT_TEST_ASSET`), giống main |
| App 3: `layout_modes.browser.test` G5 | quá thời gian 240 s, **giống hệt trên bản build của main** (môi trường) |
| `app3Embed.test.ts` (hash v1.34.0) | 3/3 đạt |
| `app3SceneModeS1.test.ts` | 8/8 đạt |
| `python -m unittest agent.test_shot_package` | 65/65 đạt |
| `pnpm typecheck` toàn workspace | đạt |
| Công cụ kiểm id App 3 | 497 → 499 (thêm `sceneCameraBtn`, `sceneCameraFrame`), thiếu 0 |
