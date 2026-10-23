# Nhân vật chính: mô hình gốc + skin + bộ động tác — giao việc (2026-10-23)

Người dùng chốt 2026-10-23 (đề xuất trong chat, mục 0–4). Repo `tuantranmarinainter-ops/3appclaude`, nhánh `main`.
Cách nộp như `docs/BBS-PREVIEW-TASKS-2026-10-22.md`: mỗi việc một nhánh `ai1/<mã>-<tên>` từ `main` mới nhất, một PR,
mô tả PR có lệnh test và kết quả thật (PASS/FAIL/NOT_RUN). **Không tự merge.** Chạy
`pnpm --filter @topview/3d-builder build`, `pnpm typecheck`, vitest builder, test retarget/Studio/library liên quan trước PR.
Không sửa thuật toán solver trong `packages/retarget/src` ngoài phần ghi trong bảng; không sửa golden builder; không thêm
dependency; **không commit mô hình hay texture của người dùng** (test dùng dữ liệu tổng hợp hoặc file có trong repo).

## Bối cảnh (đã đo trên file thật, chỉ đọc)
- **Nhóm Minecraft20** (Gà, Người bí ẩn, Chi Chi, Đen, Hero): cùng mẫu Minecraft20 20 xương, chỉ khác skin.
- **Nhóm Verity** (Gỗ Xưa, Tiểu Nhị, Chirity) tại `S:\Minecraft\Minecraft Forge-1.20.1\config\bbs\assets\models\3 MODEL DUA VAO APP\`:
  - `model.bbs.bobj` (Blockbuster OBJ của BBS: `arm_name`, `arm_bone <tên> <cha> …`, `o <object>`, `an <action>` …),
    rig `verity.mdl` 84 xương: `Root COG Pelvis Upper_Leg_L Lower_Leg_L Foot_L Toe_L … Spine_01 Spine_02 Chest Clavicle_L
    Upper_Arm_L Lower_Arm_L Hand_L` + 5 ngón × 3 đốt mỗi tay, `Neck Head Jaw` (+ `_end`), `camera`. Cao 5.83 đơn vị
    (BBSFix `motion_scale=0.02`). 8 action có sẵn: crouching, crouching_idle, dead, dying, idle, running, sprinting, swipe.
  - Gỗ Xưa và Tiểu Nhị: `model.bbs.bobj` giống hệt từng byte, khác `textures/verity_body/default.png`.
  - Chirity: thêm 17 xương `Wing_Bone…` (101 xương) và object `BOW`, `EYES`, `Wing_V4_L_Wings_gold_0`,
    `Wing_V4_R_Wings_gold_0`. Trước mắt **chỉ chuẩn hoá xương cơ thể**, xương cánh giữ nguyên, không làm động tác cánh.
- **Quy ước texture BBS FS:** object `o <tên>` dùng `textures/<tên>/default.png` (tên có `/` thành thư mục con,
  vd `verity.mdl/Verity.smd`). Phải giữ quy ước này ở mọi bước nhập/lưu/xem/xuất để không mất texture.
- **Mức chuẩn hoá:** bình thường **Mixamo65**; tối thiểu **Minecraft20**. Xương phụ (Jaw, cánh) theo hợp đồng GLB v1.1
  (xương ngoài 65, đã có trong App 1/2/3).

## Bảng việc
| Mã | Ai | Việc | Vùng file |
| --- | --- | --- | --- |
| K1 | Codex | Thư viện: mô hình gốc + nhân vật (skin, bộ động tác) | `editor/packages/library/` (+ test) |
| K2 | Codex | Nhập BOBJ mô hình (mesh + xương + action + texture theo quy ước) → GLB | `editor/packages/retarget/cli/loadBobj.ts`, `editor/packages/retarget/src/bobjModel.ts` (mới), test |
| K3 | Codex | Preset xương Verity → Mixamo65 (Jaw phụ, cánh giữ nguyên) | `editor/packages/retarget/src/` (preset/mapping), `test/` |
| K4 | Codex | Workbench + App 2 dùng nhân vật thư viện (skin, bộ động tác, lọc thư viện) | `packages/retarget/workbench/`, `apps/studio/src/`, `apps/studio/app/library/`, components liên quan, test |
| K5 | Codex | Xuất film: skin đúng cho nhân vật; dùng lại BOBJ gốc cho nhân vật nhập từ BOBJ | `apps/studio/src/unifiedJobs.ts`, `filmManifest.ts`, `agent/film_worker/`, test |
| K6 | Claude | Chạy K2+K3 trên 3 file thật, đo số; dựng 8 nhân vật vào thư viện (vẽ 5 skin Minecraft) | dữ liệu ngoài repo |
| K7 | Claude | Duyệt trong App 2 ("Xem như BBS"), rồi kiểm trong BBS FS khi người dùng yêu cầu | — |

Thứ tự: **K1 → K2 → K3 → K4 → K5**; Claude làm K6 sau K2+K3, K7 sau K4+K5.

---

## K1 — Thư viện: mô hình gốc + nhân vật
Mở rộng `packages/library` (giữ tương thích bản ghi `characters/<id>/meta.json` cũ):
- **Mô hình gốc** `models/<modelId>/`: `model.glb` hoặc `model.bbs.bobj`, `textures/<object>/default.png` (texture mặc định),
  `meta.json` `{ kind: 'base-model', modelId, name, rig: 'mixamo65' | 'minecraft20' | 'verity', format: 'glb' | 'bobj',
  objects: string[], bones: string[], extraBones: string[], heightMeters, sha256, license }`.
  `registerBaseModel({ name, rig, modelFile, texturesDir? })`: chép file, kiểm mỗi `objects[i]` có `textures/<obj>/default.png`
  (thiếu → cảnh báo trong kết quả, không chặn), id theo SHA-256 (cùng file → dùng lại).
- **Nhân vật** `characters/<charId>/meta.json` thêm `baseModelId`, `skin` (thư mục `skin/textures/<object>/default.png`, chỉ
  những object khác mặc định), `actions: string[]` (UUID action trong kho), `defaultAction?`.
  `createCharacter({ name, baseModelId, skinDir? })`, `setCharacterSkin`, `addCharacterActions`, `removeCharacterActions`,
  `resolveCharacter(charId)` → đường dẫn mô hình gốc + texture đã gộp (skin đè mặc định) + danh sách action đầy đủ metadata.
- Index (`index.json`) liệt kê nhân vật kèm `rig`, `baseModelId`, số action; `searchLibrary({ boundCharacter })` lọc theo
  `characters[].actions`.
- MCP tools: `library.characters` trả thêm `baseModelId`, `actions`; thêm `library.character.actions.add|remove`.
**Đạt khi:** test: 2 nhân vật cùng 1 mô hình gốc không chép mesh hai lần; skin đè đúng object, object không có skin dùng texture
mặc định; thiếu texture → cảnh báo có tên object; action gắn/gỡ được và `searchLibrary({ boundCharacter })` đúng; bản ghi
cũ vẫn đọc được.

## K2 — Nhập BOBJ mô hình → GLB
`bobjModel.ts`: đọc `.bobj` (Blockbuster OBJ của BBS) gồm `arm_*`, các object `o`, đỉnh/UV/pháp tuyến/mặt, trọng số xương,
action `an`; dựng GLB (three.js) có SkinnedMesh mỗi object, material dùng `textures/<object>/default.png` cạnh file (tìm
theo quy ước, tên có `/` thành thư mục), giữ **mọi** xương (kể cả Jaw, cánh, `_end`), xuất action thành animation GLB.
Đơn vị: dùng hệ số từ dòng `BBSFix … motion_scale=…` nếu có, kiểm chiều cao hông ra mét hợp lý (0.5–3 m), báo `unitMeters`.
CLI `normalize.ts --src model.bbs.bobj` dùng được như GLB nguồn (đang chỉ hỗ trợ `.bobj` action Minecraft20 + armature riêng).
Báo cáo: object nào thiếu texture, số xương, số action, chiều cao.
**Đạt khi:** test với `.bobj` tổng hợp nhỏ (2 object, 6 xương có Jaw, 2 action, texture PNG tạo trong test): GLB đọc lại đủ
object/material/texture, đủ xương, đúng trọng số (sai số 1e-6), animation đúng giá trị tại 3 tick; object không texture →
cảnh báo; test Minecraft20 `.bobj` cũ vẫn PASS (`steve.ts`, `toMinecraft20`, `retargetBobj`).

## K3 — Preset Verity → Mixamo65
Preset mapping `verity` (cùng cơ chế preset family hiện có) ánh xạ đủ 65 khớp Mixamo: `COG/Pelvis→Hips`, `Spine_01/02,
Chest→Spine/Spine1/Spine2`, `Neck/Head`, `Clavicle/Upper_Arm/Lower_Arm/Hand`, `Upper_Leg/Lower_Leg/Foot/Toe`, ngón tay
`Thumb_01..03→Thumb1..3`, `Index…`, `Middle…`, `Ring…`, `Pinky…` (đốt `_end` → `…4` nếu Mixamo65 có, còn lại bỏ). `Jaw` là
**xương phụ** theo hợp đồng v1.1 (giữ chuyển động hàm). Xương `Wing_Bone…`, `camera`, `Root` không ánh xạ, đi theo cha (cánh
theo thân). Chiều cao lớn hơn người thường: dùng tỉ lệ hông như các family khác (không cần cấu hình riêng).
Hai mức xuất: GLB Mixamo65 (mặc định) và `--bobj` Minecraft20 (tối thiểu).
**Đạt khi:** test tổng hợp rig Verity 84 xương: mapping 65/65, Jaw xuất thành xương phụ có key, cánh không có key; chạy
retarget idle tổng hợp: hướng hông/đầu khớp nguồn ≤ 2°; test Samba Mixamo giữ nguyên số (quy tắc `docs/RETARGET-LESSONS.md`).

## K4 — Workbench và App 2 dùng nhân vật thư viện
- **Workbench (App 1):** danh sách đích gồm nhân vật thư viện (thẻ có tên, ảnh skin nếu có); đích Minecraft20 chọn được
  từng nhân vật Minecraft (cùng xương, khác skin, khung phải hiện đúng skin). "Gửi sang App 2" gắn các action vừa nhập vào
  **nhân vật đang chọn** (`addCharacterActions`).
- **App 2:** trang/bảng Thư viện có mục **Nhân vật**: thêm nhân vật vào cảnh = nhập mô hình gốc (một lần cho mọi nhân vật dùng
  chung) + áp skin (texture riêng theo object) + đặt `defaultAction` (vd idle). Bảng động tác mặc định lọc theo nhân vật đang
  chọn, có nút "Xem cả kho".
- Node nhân vật trong project lưu `libraryCharacterId` (metadata), để K5 biết skin và mô hình gốc.
**Đạt khi:** test Studio: thêm 2 nhân vật cùng mô hình gốc → project có 1 asset mô hình, 2 node với texture khác nhau;
`library.place` của action gắn với nhân vật dùng được ngay; test workbench gửi action → nhân vật có action đó.

## K5 — Xuất film: skin đúng, dùng lại BOBJ gốc
- Nhân vật có `libraryCharacterId`: gói film chép **texture skin** vào `assets/models/<modelId>/textures/<object>/default.png`
  (theo từng nhân vật nếu skin khác nhau: modelId riêng cho mỗi skin, cùng `model.bobj`).
- Nhân vật mà mô hình gốc là `.bobj` (nhóm Verity): **không chuyển đổi qua Blender**; chép nguyên `model.bbs.bobj` + texture,
  và ghi pose track theo **tên xương gốc** (ánh xạ ngược preset K3: Mixamo65 → Verity; Jaw theo xương phụ; cánh/camera không
  có track).
- Báo cáo xuất liệt kê object thiếu texture (chặn xuất nếu thiếu, trừ object người dùng đánh dấu ẩn).
**Đạt khi:** test: manifest film với nhân vật Verity tổng hợp dùng `model.bbs.bobj` gốc (SHA giống nguồn), pose track tên
xương Verity; 2 nhân vật Minecraft khác skin → 2 modelId, cùng nội dung `.bobj`, texture khác; test film cũ PASS
(`filmManifest`, `filmSeries`, `sceneBbsFilm`, worker Python).

---

## Phần Claude
- **K6:** chạy K2+K3 với 3 file thật (chỉ đọc `S:\…\3 MODEL DUA VAO APP`): đo chiều cao, số xương, động tác idle/swipe trên
  Mixamo65 và Minecraft20 (ảnh so sánh); dựng thư viện: mô hình gốc Verity (Gỗ Xưa/Tiểu Nhị dùng chung), Chirity, mô hình gốc
  Minecraft20 + **5 skin do Claude vẽ** (Gà, Người bí ẩn, Chi Chi, Đen, Hero — dựa trên các nhân vật khối đã dựng trong
  `packages/retarget/cli/minecraftBlockCharacters.ts`), gắn bộ động tác ban đầu cho từng nhân vật.
- **K7:** duyệt trong App 2 "Xem như BBS" (đúng skin, đúng hàm/cánh), rồi kiểm trong BBS FS khi người dùng yêu cầu.
