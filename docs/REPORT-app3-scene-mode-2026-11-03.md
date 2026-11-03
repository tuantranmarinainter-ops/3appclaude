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

## S3: click chọn nhân vật, bản sửa/Undo từng nhân vật, mờ nhân vật xem (nhánh `claude/app3-scene-s3`)

### Đã làm
- Click vào thân nhân vật khác trong khung 3D (hoặc bấm dòng trong danh sách mới ở cột trái `#sceneCharacterList`) để sửa nhân vật đó.
  Control của rig đang sửa vẫn ưu tiên; kéo xoay khung (> 4 px) không chuyển. Vòng Root lớn nhường cho thân nhân vật xem nằm trong vòng,
  trừ khi bấm đúng nét vòng.
- Bộ nhớ trạng thái từng nhân vật: key, Undo/Redo, lựa chọn; rig parse một lần rồi giữ lại; quay lại rig cũ thì đặt về tư thế nghỉ trước
  khi dựng IK (giống lần đầu); cài rig lỗi giữa chừng thì quay về nhân vật trước.
- Nhân vật đã sửa nhưng không đang sửa chạy theo key mới (nướng thành clip cho actor xem); nhân vật chưa sửa chạy bản nướng F2.
- Nhân vật xem mờ 50%, không rig, không nhãn; nhãn "Đang sửa: <tên>" (`#sceneEditingLabel`); dấu "●" cạnh nhân vật đã sửa; onion chỉ
  cho nhân vật đang sửa. Gói cả cảnh mang tên nhân vật (`name`, tùy chọn; TS/Python/App 3 validator nhận).
- Không cho chuyển khi đang có tư thế chưa ghi key, khi ở "Dựng cảnh" chỉ xem, hoặc ở Animation Lab (thông báo tiếng Việt).
- Phiên cầu nối App 2 (broker) giữ định danh nhân vật mở shot, nên chuyển nhân vật không làm đóng phiên.
  "Chưa lưu" = khác lần lưu gần nhất (`markSaved` khi host báo đã lưu); "●" = khác bản F2.

### Số đo S3 (App 3 build thật, Chromium headless, SwiftShader; dự án tổng hợp)
| Mục | Ngưỡng | Đo | Trạng thái |
| --- | --- | --- | --- |
| A → B → A 10 lần (20 lần chuyển): hash key của A | không đổi | giống nhau cả 20 lần, bằng giá trị ngay sau khi sửa | PASS |
| Actor xem của A hiện đúng tư thế vừa sửa | — | lệch 1,8·10⁻⁷ | PASS |
| B nướng từ GLB so với clip F2 | — | lệch 6·10⁻⁸ | PASS |
| Undo theo từng nhân vật (Ctrl+Z hoàn tác A, B không đổi) | — | đúng | PASS |
| Onion chỉ nhân vật đang sửa | — | rig đang sửa có bóng, actor xem 0 | PASS |
| IK rest sau B→A→B so với lần đầu vào B | — | ≤ 1·10⁻⁶ | PASS |
| Click thật chuyển nhân vật, cảnh 2 nhân vật | — | chuyển được | PASS |
| Click thật chuyển nhân vật, cảnh 5 nhân vật | — | chuyển được khi bấm chỗ không có gizmo (xem mục mở) | PASS có điều kiện |
| Thời gian chuyển nhân vật lần đầu / các lần sau | — | 1,3–1,9 s / trung bình 0,38–0,45 s (tối đa 0,67 s) | đo được (máy không GPU) |

### Điểm mở (cần người dùng chốt)
- Gizmo xoay của đối tượng đang chọn (mặc định Root) có vùng quả cầu xoay tự do lớn, phủ lên các nhân vật đứng sát; bấm vào thân nhân vật
  đó sẽ bắt đầu xoay thay vì chuyển nhân vật. Hiện vẫn chuyển được bằng danh sách cột trái hoặc bấm chỗ ngoài gizmo.
- Redo trong App 3 là Ctrl+Shift+Z (Ctrl+Y không gán), hành vi có sẵn.

### Test đã chạy (S3)
| Bộ test | Kết quả |
| --- | --- |
| App 3 unit: `scene_shot`, `layout_modes`, `shot_package`, `scene_select`, `app3_bridge`, `app3_workflow_steps`, `app3_director` | 85/85 đạt |
| App 3 trình duyệt: `scene_select.browser` (3 ca: §9 bước 3–5 + chuyển 10 lần, các lỗi review, vòng Root nhường) | 3/3 đạt |
| App 3 trình duyệt: `scene_shot.browser` | 1/1 đạt |
| `scene_select_evidence.mjs` (click thật, ảnh từng bước, 2 và 5 nhân vật) | mọi mục đạt |
| `app3Embed.test.ts` / `app3SceneModeS1.test.ts` | 3/3 / 8/8 đạt |
| `python -m unittest agent.test_shot_package` | 66/66 đạt |
| `pnpm typecheck` toàn workspace | đạt |
| Công cụ kiểm id App 3 | 497 → 501 (thêm `sceneEditingLabel`, `sceneCharacterList`), thiếu 0 |

## S4: "Mở cả cảnh", "Lưu clip gộp" nhiều dòng, trả về (nhánh `claude/app3-scene-s4`) — DỪNG GIỮA CHỪNG, BÀN GIAO

### Đã làm
- Host F3 (`animation-creation/index.tsx`, `src/sceneShotHost.ts`): nút **"Mở cả cảnh"** (`shot.export` `sceneMode`), trạng thái
  "Đã nới khoảng a–b → c–d…", chọn nhân vật khác không hỏi kiểu B66; **"Trả kết quả về cảnh"** đọc `result.json`, mở hộp
  **"Lưu clip gộp"** một dòng cho mỗi nhân vật đã sửa (mặc định như K5), gửi `merges`; **"Bỏ sửa"** hỏi lại khi đang mở cả cảnh.
- App 3 (`shot_controller.js` `sceneExportFiles`, `shot_export.js` `sceneResultFiles`): một gói kết quả `sceneMode: true` có edit cho mọi
  nhân vật khác bản F2 (GLB + manifest + placementKeys riêng), nhân vật không sửa không có edit; không sửa gì → `edits: []`.
- Test trình duyệt `scene_export.browser.test.mjs`; script trọn luồng `apps/studio/scripts/sceneModeE2E.mjs` (Studio thật, cổng 3120,
  bản sao project + `W01_LIBRARY` tạm).

### Kết quả test trọn luồng §9 (Studio thật, dự án tổng hợp 2 nhân vật, embed `e71dcd20…`, trước khi ghép S3 gizmo)
| Bước | Trạng thái | Ghi chú |
| --- | --- | --- |
| Mở F3 → "Mở cả cảnh": thấy 2 nhân vật đúng chỗ | PASS | root lệch 0 m so với sampler App 2 ở 3 khung; trạng thái báo đã nới 0–76 → 0–87 |
| Phát: cả hai cùng chạy | PASS | |
| Sửa A, click thật vào B: sang B, A mờ 0,5, ● cạnh A | PASS | chuyển 0,63 s (App 3) |
| Sửa B, click lại A: bản sửa A còn; Ctrl+Z (bàn phím) chỉ hoàn tác A | PASS | hash A không đổi sau 10 vòng |
| Onion chỉ nhân vật đang sửa | PASS | 0 bóng trên actor xem |
| "Nhìn qua camera cảnh" | PASS | |
| "Trả kết quả": hộp 2 dòng; xác nhận → mỗi nhân vật 1 clip gộp phủ khoảng, đúng tên | PASS | một revision |
| Ctrl+Z một lần ở App 2 → project về như trước | PASS | hash scene/extensions/motions/bindings bằng trước |
| Lần 2 chỉ sửa A: hộp 1 dòng, B giữ nguyên | **FAIL** | xem lỗi 2–3 dưới |
| Thư viện (F5) có clip gộp | BLOCKED | nhân vật tổng hợp không phải nhân vật Thư viện → `libraryActionUuids: []` |
| Thời gian từ bấm "Mở cả cảnh" tới thấy đủ nhân vật | **FAIL?** | 24,2 s trên máy cloud (App 3 tự mở 0,98 s; phần còn lại là xuất gói + tải phía Studio dev). Ngưỡng 15 s; cần đo trên máy người dùng |

### Lỗi đã tìm, chưa sửa (việc tiếp theo cho Codex)
1. Hộp "Lưu clip gộp" bị **danh sách animation nổi `#floatingAnimationList` che** (S3 mở danh sách này để hiện `#sceneCharacterList`).
2. Sau khi trả kết quả thành công, App 3 **vẫn báo chưa lưu** (dirty) — host phải báo App 3 đóng/reset shot (hoặc `markSaved`) sau import.
3. Trả lần 2 trong cùng phiên: App 3 vẫn giữ bản sửa cũ (so với bản F2 của shot cũ) nên hộp hiện cả nhân vật đã trả rồi. Sau import
   thành công phải đóng shot cả cảnh (host đã xóa `sceneShot`; App 3 cần được reset hoặc mở lại shot mới).
4. Mở cả cảnh qua Studio 24 s trên máy cloud: cần tách thời gian (shot.export phía server, tải job, postMessage, App 3) để biết chỗ chậm.
