# Bàn giao: App 3 "1 khung · Cả cảnh" (2026-11-03, Claude → Codex)

Đặc tả: `docs/APP3-SCENE-MODE-TASK-2026-11-03.md`. Report số đo: `docs/REPORT-app3-scene-mode-2026-11-03.md`.
Quy tắc: `CLAUDE.md`, `docs/DECISIONS.md`, `three-workspace-app/editor/AGENTS.md`. Không tự merge PR.

## Trạng thái nhánh (xếp chồng)
| Đợt | Nhánh | PR | Trạng thái |
| --- | --- | --- | --- |
| S1 hợp đồng `sceneMode` | `claude/app3-scene-s1` | #207 → `main` | xong |
| S2 actor xem, bố cục, camera cảnh | `claude/app3-scene-s2` | #209 → S1 | xong (kèm sửa lỗi Armature 2,3 cm) |
| S3 click chọn, sửa/Undo từng nhân vật | `claude/app3-scene-s3` | #214 → S2 | xong (kèm 7 lỗi review + vòng Root/gizmo nhường click) |
| S4 host + trả về | `claude/app3-scene-s4` | #215 → S3 | xong (§9 trọn luồng 13 PASS, 1 BLOCKED Thư viện) |

Người dùng đã chốt thêm (2026-11-03): ở chế độ Cả cảnh, click (không kéo) vào thân nhân vật khác **luôn chuyển**, kể cả trong vùng
quả cầu gizmo; vòng trục X/Y/Z, nét vòng E, tay cầm di chuyển vẫn như cũ.

## Việc còn lại (cần máy người dùng)
1. Chạy §8/§9 trên bản sao Tập 15 · Shot 01 (Đen + Gỗ Xưa) và `tall-lib`, gồm bước 8 (Thư viện F5 có clip gộp).
2. Đo 5 nhân vật ≥ 30 FPS trên máy có GPU.
3. Quyết định về bộ giải Draco cho App 3 (nhân vật builtin).

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
