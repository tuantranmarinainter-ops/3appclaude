# Bàn giao: App 3 "1 khung · Cả cảnh" (2026-11-03, Claude → Codex)

Đặc tả: `docs/APP3-SCENE-MODE-TASK-2026-11-03.md`. Report số đo: `docs/REPORT-app3-scene-mode-2026-11-03.md`.
Quy tắc: `CLAUDE.md`, `docs/DECISIONS.md`, `three-workspace-app/editor/AGENTS.md`. Không tự merge PR.

## Trạng thái nhánh (xếp chồng)
| Đợt | Nhánh | PR | Trạng thái |
| --- | --- | --- | --- |
| S1 hợp đồng `sceneMode` | `claude/app3-scene-s1` | #207 → `main` | xong |
| S2 actor xem, bố cục, camera cảnh | `claude/app3-scene-s2` | #209 → S1 | xong (kèm sửa lỗi Armature 2,3 cm) |
| S3 click chọn, sửa/Undo từng nhân vật | `claude/app3-scene-s3` | #214 → S2 | xong (kèm 7 lỗi review + vòng Root/gizmo nhường click) |
| S4 host + trả về | `claude/app3-scene-s4` | PR → S3 | **đang làm**: code chính xong, còn 4 lỗi ở report mục S4 |

Người dùng đã chốt thêm (2026-11-03): ở chế độ Cả cảnh, click (không kéo) vào thân nhân vật khác **luôn chuyển**, kể cả trong vùng
quả cầu gizmo; vòng trục X/Y/Z, nét vòng E, tay cầm di chuyển vẫn như cũ.

## Việc tiếp theo cho S4 (theo thứ tự)
1. Hộp "Lưu clip gộp" không bị `#floatingAnimationList` che (z-index/đặt hộp ngoài iframe dock, hoặc đóng danh sách nổi khi mở hộp).
2. Sau `shot.result.import` thành công ở chế độ cả cảnh: host báo App 3 đóng shot cả cảnh (lệnh bridge mới hoặc `saved` + clear),
   để App 3 hết dirty và lần mở sau không còn bản sửa cũ. Thêm test (`scene_export.browser.test.mjs` hoặc `sceneModeE2E.mjs`).
3. Đo và giảm thời gian "Mở cả cảnh" qua Studio (24 s trên máy cloud; ngưỡng 15 s): ghi thời gian từng chặng.
4. Chạy lại `sceneModeE2E.mjs` đủ §9; bước 8 (Thư viện) cần nhân vật Thư viện thật → chạy trên bản sao `tall-projects` + `tall-lib`.
5. Ghi số vào report, mở/ cập nhật PR S4.

## Chưa kiểm được (máy cloud không có ổ `S:\`, không GPU)
- §8 trên Tập 15 · Shot 01 thật và bản 5 nhân vật từ Tập 15: dùng
  `node --import tsx ../../apps/studio/scripts/sceneModeFixture.mts --projects <BẢN SAO> --project <id> --five --out <thư mục>`
  (từ `editor/packages/builder`; script từ chối kho/dự án thật và khi thiếu `W01_LIBRARY`), rồi
  `node src/scene_shot_f2.measure.mjs <zip> <reference.json> <outdir>` (từ `animation-studio/work/material_alpha_v1_31_8`).
- 5 nhân vật ≥ 30 FPS: đo trên máy có GPU (`window.__studio.sceneShot.stats().fps` khi phát).
- Lỗi có sẵn chờ người dùng quyết: nhân vật builtin nén Draco, App 3 không giải được (cần file WASM).

## Lệnh kiểm nhanh
- App 3 (từ `animation-studio/work/material_alpha_v1_31_8`): `node src/build.mjs`; unit
  `node --test src/scene_shot.test.mjs src/layout_modes.test.mjs src/shot_package.test.mjs src/scene_select.test.mjs src/app3_bridge.test.mjs src/app3_workflow_steps.test.mjs src/app3_director.test.mjs`;
  trình duyệt `node --test src/scene_select.browser.test.mjs`, `src/scene_shot.browser.test.mjs`, `src/scene_export.browser.test.mjs` (từng file một).
- Sau build: chép `outputs/Animation_Studio_v1_33_0.html` → `editor/apps/studio/public/animation-studio/v1.34.0/index.html`,
  `src/host_bridge.js` → `v1.34.0/host-bridge.js`, cập nhật 2 SHA-256 trong `v1.34.0/README.md` (test `app3Embed` kiểm).
- Studio (từ `editor/packages/builder`): `node --import tsx --test <abs>/apps/studio/test/{app3Embed,app3SceneModeS1,sceneShotHost}.test.ts`.
- Python (từ `three-workspace-app`): `python -m unittest agent.test_shot_package`. `pnpm typecheck` (từ `editor`) trước khi push.
- Kiểm id App 3: so mọi `id="…"` của `v1.34.0/index.html` với bản trên `main` (497 id); hiện 501, không thiếu.
- Mốc so sánh: toàn bộ `apps/studio/test` trên main có sẵn 2 lỗi môi trường (B33 Minecraft, cookie gợi ý điều hướng);
  `layout_modes.browser` G5 quá thời gian cả trên main.
