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
