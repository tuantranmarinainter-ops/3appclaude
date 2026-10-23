# Bộ animation riêng cho từng nhân vật + phần còn lại của nhân vật chính — giao việc tổng (2026-10-23)

Người dùng chốt 2026-10-23 (đề xuất trong chat, trả lời "ok"):
- Hai tầng thư viện: **kho thô** (animation App 1 đã chuẩn hoá, dùng chung) và **bộ của nhân vật** (bản đã chỉnh cho đúng
  nhân vật, ghi `parentUuid` về bản thô).
- Bản chỉnh **thuộc một nhân vật**; dùng cho nhân vật khác cùng xương bằng **"Sao chép sang nhân vật khác"** (tạo bản riêng).
- Trạng thái mỗi animation của nhân vật: **Nháp** (từ App 1) → **Đã chỉnh** (lưu từ App 3) → **Đã duyệt** (người dùng chốt).
  Mỗi lần lưu từ App 3 là **một phiên bản mới**, bản cũ giữ lại.
- Mỗi nhân vật có **hồ sơ tính cách** (mô tả + thẻ) và **danh sách động tác cần có**, xem dạng bảng nhân vật × động tác.
- Nhân vật: nhóm Verity (Gỗ Xưa, Tiểu Nhị, Chirity — **giữ bộ xương gốc**, Jaw đứng yên, cánh lặp action gốc) và nhóm
  Minecraft 20 (Gà, Người bí ẩn, Chi Chi, Đen, Hero — cùng xương, khác skin).

Repo `tuantranmarinainter-ops/3appclaude`, nhánh `main` mới nhất. Đặc tả nền: `docs/CHARACTER-TASKS-2026-10-23.md`
(K1 đã merge #67; K2 = PR #68).

---

## Cách làm cho Codex (bắt buộc)
- **Agent chính điều phối, chia việc cho subagent.** Mỗi mã việc dưới đây giao cho **một subagent riêng**; subagent dùng
  **model `sol 5.6` bản nhẹ** (giới hạn cho subagent; agent chính giữ model của mình để review/tích hợp).
- **Việc cùng một đợt chạy song song**: gọi nhiều subagent cùng lúc, mỗi subagent một nhánh `ai1/<mã>-<tên>` từ `main` mới
  nhất, một PR. Không cho hai subagent sửa chung một file (bảng "Vùng file" là ranh giới; cần sửa ngoài vùng → báo agent chính).
- Đợt sau chỉ bắt đầu khi PR đợt trước mà nó phụ thuộc **đã được Claude merge** (Claude tự kiểm GitHub mỗi 15 phút).
- Mỗi PR: mô tả có lệnh test + kết quả thật (PASS/FAIL/NOT_RUN). Trước PR chạy `pnpm --filter @topview/3d-builder build`,
  `pnpm typecheck` (toàn workspace), test của package liên quan. **Không tự merge.** Không sửa golden builder, không thêm
  dependency, không commit mô hình/texture/skin của người dùng (test dùng dữ liệu tổng hợp).
- Giữ nguyên: kết quả Samba Mixamo (`docs/RETARGET-LESSONS.md`), 434/434 chức năng App 3, phần Workbench Claude vừa làm
  (`packages/retarget/workbench/verity.ts`, thẻ Minecraft 20 có skin, chuột trái xoay / giữa kéo / lăn zoom).

## Đợt 1 — chạy song song (3 subagent)
| Mã | Việc | Vùng file |
| --- | --- | --- |
| K2b | Sửa PR #68 theo mục K2b trong `CHARACTER-TASKS` (đơn vị, sàn bỏ khung camera, hướng Root) — commit thêm vào PR #68 | `packages/retarget/src/bobjModel.ts`, `cli/loadBobj.ts`, `test/bobjModel.test.ts` |
| K3 | Preset Verity → Mixamo65 theo mục K3 + "K3/K5 — bổ sung"; **chuyển** logic áp ngược của `workbench/verity.ts` vào `src/` (hàm thuần, có test), Workbench gọi lại hàm đó, hành vi không đổi | `packages/retarget/src/` (file mới `verityRig.ts` hoặc tương đương, preset/mapping), `test/`, `workbench/verity.ts` (chỉ đổi import) |
| L1 | Thư viện: bộ animation của nhân vật (mục L1 dưới) | `packages/library/` (+ test, `mcp.ts`, README) |

## Đợt 2 — sau khi L1 (và K3 cho L2) được merge, chạy song song (3 subagent)
| Mã | Việc | Vùng file |
| --- | --- | --- |
| L2 | App 1 Workbench: "Gửi vào bộ của…" (mục L2) | `packages/retarget/workbench/` (server, pipeline, public), `test/workbench.test.ts` |
| L3 | App 2: bảng động tác theo nhân vật, bảng nhân vật × động tác, duyệt, sao chép (mục L3) — gộp phần App 2 của K4 | `apps/studio/app/library/`, `apps/studio/src/` (route/command thư viện mới, **không** `unifiedJobs.ts`, `film*.ts`, `app3*.ts`), components liên quan, test |
| K5 | Xuất film: skin đúng, Verity dùng `.bobj` gốc + action của nhân vật (mục K5 trong `CHARACTER-TASKS`) | `apps/studio/src/unifiedJobs.ts`, `filmManifest.ts`, `filmSeries.ts`, `agent/film_worker/`, test |

## Phần Claude (song song với đợt 2)
- **L4:** App 3 ↔ thư viện: mở action "Sửa cho <nhân vật>" với **đúng mô hình nhân vật** (Verity gốc đủ hàm/cánh; Minecraft 20
  có skin), Lưu → phiên bản mới trong bộ của nhân vật (trạng thái Đã chỉnh). Vùng: `apps/studio/src/app3*.ts`,
  `animation-studio/`.
- **K6/K7:** đo trên file thật, dựng 8 nhân vật đủ dữ liệu, duyệt App 2.

---

## L1 — Thư viện: bộ animation của nhân vật
Mở rộng `packages/library` (tương thích bản ghi cũ; `LIBRARY_VERSION` tăng minor nếu cần):
- **Action thuộc nhân vật**: thêm vào `ActionMetadata` các trường tuỳ chọn `ownerCharId`, `status: 'draft' | 'edited' |
  'approved'`, `version` (1, 2, …), `variantOf` (uuid bản v1 của chuỗi phiên bản; `parentUuid` vẫn trỏ bản thô gốc),
  `notes`, `tags` (đã có). Action không có `ownerCharId` = kho thô.
- Hàm mới (xuất qua `index.ts`, có MCP tương ứng trong `mcp.ts`):
  - `addDraftToCharacter({ charId, actionUuid })`: tạo bản Nháp thuộc nhân vật từ action thô (chép GLB, `parentUuid` = thô);
    kiểm rig nhân vật khớp rig action (mixamo65 / minecraft20 / `verity` qua Mixamo65 view).
  - `saveCharacterActionVersion({ charId, baseUuid, glbFile, status: 'edited', notes })`: phiên bản mới cùng chuỗi, giữ bản cũ.
  - `setCharacterActionStatus({ charId, actionUuid, status })`, `copyActionToCharacter({ actionUuid, toCharId })`
    (cùng rig; bản sao `status: 'draft'`, `parentUuid` = action nguồn).
  - `listCharacterActions({ charId, status?, latestOnly? })`, `removeCharacterAction` (chỉ gỡ khỏi bộ, không xoá file kho).
- **Hồ sơ nhân vật**: `characters/<charId>/meta.json` thêm `personality: { summary: string, traits: string[] }` và
  `requiredActions: Array<{ key: string, label: string }>` (mặc định: idle, walk, run, talk, happy, sad, surprised, angry,
  attack, hit, fall, jump). Hàm `setCharacterProfile`, `coverageMatrix(charIds?)` → mỗi nhân vật × mỗi `key`: action
  mới nhất khớp thẻ `key` và trạng thái của nó (hoặc thiếu).
- `searchLibrary` lọc thêm `ownerCharId`, `status`.
**Đạt khi:** test tổng hợp: thô → Nháp → 2 phiên bản Đã chỉnh → Đã duyệt (bản cũ còn, `latestOnly` trả v2); sao chép sang
nhân vật cùng rig được, khác rig bị từ chối; `coverageMatrix` đúng ô thiếu/đủ; bản ghi K1 cũ đọc được; test cũ PASS.

## L2 — App 1 Workbench: "Gửi vào bộ của…"
- Tab Tải về: thay/thêm nút "Gửi sang App 2" bằng **"Gửi vào bộ của…"**: chọn một hoặc nhiều nhân vật thư viện (danh sách
  theo rig phù hợp: nhân vật Mixamo65, Verity, Minecraft 20 — nhóm Minecraft dùng `.bobj` Minecraft20 của lượt chạy), chọn
  action nào trong lượt chạy, gắn thẻ động tác (`requiredActions.key`, vd `walk`). Gọi `importPack` + `addDraftToCharacter`.
- Nhân vật Verity: lưu kèm bản áp về bộ xương gốc (`.original.bbs.bobj` / `.original.glb` Workbench đang xuất) vào bản Nháp
  để App 2/3/xuất film dùng đúng xương gốc.
- Thẻ nhân vật trong danh sách đích hiện số action theo trạng thái (vd "3 nháp · 1 đã duyệt").
**Đạt khi:** test workbench: chạy → gửi vào 2 nhân vật → mỗi nhân vật có bản Nháp đúng thẻ; nhân vật Verity có file áp về
xương gốc; test cũ PASS.

## L3 — App 2: animation theo nhân vật
- Chọn nhân vật trong cảnh → bảng động tác **chỉ hiện bộ của nhân vật đó** (mặc định bản mới nhất; lọc Nháp / Đã chỉnh / Đã
  duyệt), nút **"Xem cả kho"**; mỗi dòng: tên, thẻ, trạng thái, phiên bản, nút **Duyệt**, **Sao chép sang…**, **Sửa ở App 3**
  (gọi lệnh App 3 sẵn có `libraryActionOpen` — phần lưu ngược Claude làm ở L4).
- Trang Thư viện: tab **Nhân vật** (hồ sơ tính cách sửa được) và **Bảng động tác** (nhân vật × `requiredActions`, ô màu theo
  trạng thái, ô thiếu bấm để tìm trong kho thô).
- Thêm nhân vật vào cảnh (phần App 2 của K4): mô hình gốc một lần + skin + `defaultAction`.
**Đạt khi:** test Studio: lọc theo nhân vật đúng; Duyệt đổi trạng thái; sao chép tạo bản mới; bảng động tác đúng ô;
test cũ PASS (`filmManifest`, `filmSeries`, `sceneBbsFilm`, library).

---

## Lệnh tổng gửi Codex (người dùng dán)
> Đọc `docs/ANIM-LIBRARY-TASKS-2026-10-23.md` và `docs/CHARACTER-TASKS-2026-10-23.md` trên `main` mới nhất. Bạn là agent
> điều phối: **mỗi mã việc giao một subagent**, subagent dùng **model sol 5.6 bản nhẹ**. **Đợt 1 chạy song song 3 subagent:
> K2b (đẩy thêm vào PR #68), K3, L1.** Đợt 2 (L2, L3, K5 song song) chỉ bắt đầu khi PR đợt 1 mà nó cần đã được merge. Mỗi
> việc một nhánh `ai1/<mã>-…` + một PR, không sửa file ngoài vùng của việc, chạy build/typecheck/test trước PR, ghi kết quả
> thật vào mô tả PR, **không tự merge**. Xong mỗi PR báo mã việc + số PR.
