# App 2: tách 5 file quá lớn thành module nhỏ, giữ nguyên hành vi: đặc tả 2026-11-05

> Người dùng chốt 2026-11-05: "Giao cho codex tiếp" (sau khi Claude đề xuất tách file lớn để agent đọc ít hơn).
> Mục ghi **[Claude chốt]** là quyết định thay người dùng, đổi được.
> Đọc trước: `CLAUDE.md`, `docs/DECISIONS.md`, `three-workspace-app/editor/AGENTS.md`.

## 1. Vì sao
Mỗi lần Claude/Codex sửa một tính năng App 2 (vd thêm một lệnh camera, sửa hoàn tác timeline) phải đọc cả file khổng lồ:
`unifiedProjectStore.ts` 254 KB (~70.000 token), `StudioSession.ts` 148 KB (~40.000 token). Tốn token, chậm, dễ sửa nhầm chỗ, và
hai agent làm song song hay đụng cùng file → xung đột merge. Mục tiêu là **tách cấu trúc, không đổi hành vi**: người dùng không thấy
gì khác trên giao diện, chỉ có agent đọc ít hơn.

## 2. Hiện trạng (đã kiểm code trên main 63bad8a)
| File | Dung lượng / dòng | Điểm nghẽn |
| --- | --- | --- |
| `apps/studio/src/unifiedProjectStore.ts` | 254 KB, 2.961 dòng (dòng dài tới 1.199 ký tự), 7 export, 49 file import | `executeLockedCommand` (dòng 989) dài **1.968 dòng**: một chuỗi `if (command === …)` cho ~160 lệnh (scene 21, camera 17, vfx 15, audio 15, motion 13, asset 11, film 10, project 9, library 9, history 7, rig 6, shot 5, skeleton/retarget/prop/character/animation 4…). Nhiều biến `let` cục bộ (`sceneReplacement`, `stagedAssetImports`, `libraryPlacement`, `libraryLink`…) được gán trong nhánh lệnh rồi xử lý chung sau khi tính `next`. Ngoài ra `applySceneOperations` 193 dòng. |
| `packages/builder/src/sync/StudioSession.ts` | 148 KB, 3.517 dòng, 1 export (class), 21 file import | Class một khối: camera pilot (`finishCameraPilot`…), xoá node (`deleteNodes`), vùng chọn keyframe (`pruneKeyframeSelection`), clip timeline (`timelineClipsOf`), kéo/thả (`applyDragEdit`), gizmo (`syncGizmoState`), thêm node (`commitAddedNodes`), hoàn tác… |
| `packages/builder/src/sync/libraryActions.ts` | 84 KB, 2.053 dòng, 37 export, 2 file import | Nhiều nhóm hàm thư viện dồn một file. |
| `apps/studio/src/unifiedJobs.ts` | 76 KB, 1.065 dòng, 23 export, 18 file import | Job xuất film, chuyển xương, scene export… chung một file. |
| `packages/builder/src/engine/core/Stage.ts` | 65 KB, 1.725 dòng, 6 export, 5 file import | Khung 3D: dựng cảnh, ánh sáng, chọn, render… |

## 3. Đã chốt
| # | Câu | Chốt |
| --- | --- | --- |
| 1 | Có đổi hành vi / API / định dạng project không? | **Không.** Thuần tái cấu trúc. Mọi export cũ giữ đúng tên và đường dẫn import (file cũ re-export). [Claude chốt] |
| 2 | Có gọn phần 10 file ngôn ngữ (`locale/strings/*.ts`) không? | **Không làm đợt này** (đổi thứ người dùng tiếng khác nhìn thấy, chờ người dùng quyết riêng). |
| 3 | Thứ tự | Phía server (`apps/studio`) trước, phía builder sau khi các đợt timeline F1–F2/E1–E3 của Codex đã merge (chúng sửa `StudioSession.ts`). [Claude chốt] |
| 4 | Kiểu tách lệnh store | Bảng xử lý lệnh theo nhóm (`commands/<nhóm>.ts`), mỗi handler trả về **kế hoạch thay đổi** (next project + các tác vụ hậu kỳ như nhập asset, đặt clip thư viện) thay cho biến `let` dùng chung. [Claude chốt] |

## 4. Mục tiêu / không làm / coi là hỏng
**Mục tiêu**
- G1. Không file nào trong phạm vi (5 file + module mới tách ra) vượt **40 KB** hay **800 dòng**; không hàm nào vượt **250 dòng**
  (riêng `applySceneOperations` được tối đa 250 dòng nếu tách tiếp làm khó đọc hơn).
- G2. `executeLockedCommand` còn ≤ 150 dòng: kiểm tra phong bì + replay + tra bảng handler + commit chung.
- G3. Agent sửa một nhóm lệnh (vd camera) chỉ cần đọc `commands/camera.ts` + phần lõi chung (≤ 30 KB tổng).
- G4. Mỗi thư mục mới có `README.md` 5–15 dòng: file nào làm gì, thêm lệnh mới thế nào.

**Không làm**: đổi tên lệnh, đổi thông báo lỗi, đổi thứ tự kiểm tra lỗi, tối ưu hiệu năng, đổi UI, sửa `packages/retarget`, đổi golden,
gọn locale, sửa App 3.

**Coi là hỏng dù "chạy được"**
- Bất kỳ test hiện có nào phải sửa nội dung kiểm tra (chỉ được sửa đường dẫn import).
- Kết quả replay (mục 8) khác byte so với main ở bất kỳ lệnh nào, kể cả mã lỗi / thông báo lỗi / thứ tự `changed`.
- Thêm vòng import (circular import) mới làm thay đổi thứ tự khởi tạo.
- Bản build production App 2 lớn hơn > 3% hoặc thời gian mở Shot 01 bản sao chậm hơn > 10%.

## 5. Trải nghiệm người dùng
Không đổi gì. Người dùng chỉ thấy: agent làm việc App 2 nhanh hơn, ít xung đột PR hơn.

## 6. Thiết kế kỹ thuật (hướng, builder tự quyết chi tiết)
**Store (`apps/studio/src/`)**
- `unifiedProjectStore.ts` giữ vai trò cửa vào: re-export 7 export cũ; lõi đọc/ghi/khoá/lịch sử/commit tách sang
  `store/` (vd `store/io.ts`, `store/history.ts`, `store/commit.ts`, `store/validate.ts`).
- Lệnh tách sang `store/commands/<nhóm>.ts` (scene, camera, vfx, audio, motion, asset, film, project, library, history, rig, shot,
  skeleton, retarget, prop, character, animation, job, episode). Bảng `Record<string, Handler>` tra theo tên lệnh; lệnh không có trong
  bảng → đúng lỗi cũ.
- Handler: `(ctx: { envelope, current, … }) => Promise<CommandPlan>`; `CommandPlan` mang `next`, `changed`, `result` và các tác vụ hậu kỳ
  (thay cho `sceneReplacement`, `stagedAssetImports`, `assignmentPlacement`, `conversionImport`, `libraryPlacement`, `libraryReplaceClipId`,
  `libraryLink`, `shotReplacement`…). Phần hậu kỳ chung chạy đúng thứ tự cũ.
- Bí danh `animation.assignment.commit` → `asset.import` giữ ở cửa vào như cũ.
- `unifiedJobs.ts`: tách theo loại job (`jobs/film.ts`, `jobs/retarget.ts`, `jobs/sceneExport.ts`, `jobs/common.ts`…), file cũ re-export.

**Builder (`packages/builder/src/`)**
- `StudioSession.ts`: giữ class `StudioSession` và API công khai y nguyên; logic từng mảng chuyển sang module hàm thuần hoặc lớp phụ
  nhận session (vd `sync/session/cameraPilot.ts`, `deleteNodes.ts`, `keyframeSelection.ts`, `timelineClips.ts`, `dragEdit.ts`,
  `gizmo.ts`, `addNodes.ts`, `history.ts`). Không đổi tên phương thức công khai, không đổi thứ tự phát sự kiện.
- `libraryActions.ts`: tách theo nhóm hàm, file cũ re-export 37 export.
- `Stage.ts`: tách các phần độc lập (ánh sáng/môi trường, chọn/raycast, render/thumbnail…) thành module; class `Stage` giữ API.

Gợi ý: tách bằng di chuyển code nguyên khối (move), không viết lại logic; commit theo từng bước nhỏ để diff dễ kiểm.

## 7. Chia đợt
| Đợt | Nội dung | Xong khi |
| --- | --- | --- |
| P1 | Harness replay (mục 8.1) + chụp kết quả chuẩn trên main | Harness chạy 2 lần trên main cho kết quả byte giống nhau |
| P2 | `unifiedProjectStore.ts` → `store/` + `store/commands/*` | G1–G2 cho store; replay khớp 100%; test studio xanh |
| P3 | `unifiedJobs.ts` → `jobs/*` | G1; replay + test studio xanh; xuất film bản sao Shot 01 ra ZIP giống hash nội dung (trừ thời gian) |
| P4 | `StudioSession.ts` → `sync/session/*` (**chỉ bắt đầu sau khi F1–F2, E1–E3 timeline đã merge**; nếu chưa merge thì dừng và báo) | G1; test builder xanh; kiểm trình duyệt mục 8.3 |
| P5 | `libraryActions.ts` + `Stage.ts` | G1; test builder xanh; mục 8.3 |
Nhánh `claude/app2-split-p<n>`, mỗi đợt một PR. P2 base main; P3 base nhánh P2 nếu P2 chưa merge; P4/P5 base main mới nhất
(sau timeline). Không tự merge.

## 8. Đo số (bắt buộc)
1. **Replay lệnh** (`apps/studio/scripts/storeReplay.mts`, mới): trên **bản sao** project (Shot 01 `e901aadb…`, Shot 03 `5673640e…`
   copy từ `tap15v3` chỉ để đọc + một project tổng hợp), chạy một kịch bản cố định phủ **100%** tên lệnh trong `store/command-names.json` (mục 10.6)
   (gồm lệnh lỗi cố ý: sai revision, sai tham số, dryRun, undo/redo hai đường, lặp requestId, bí danh; xem mục 10.2–10.7). Ghi cho mỗi lệnh: kết quả JSON, mã lỗi + thông báo,
   sha256 của `project.json` sau lệnh (chuẩn hoá trường thời gian/uuid sinh mới bằng cách cố định nguồn sinh trong harness).
   So main vs nhánh: **100% khớp**. Ghi số lệnh đã phủ / tổng số tên lệnh.
2. **Kích thước**: bảng dung lượng + số dòng mọi file trong phạm vi trước/sau; dòng dài nhất; hàm dài nhất. Đạt G1–G2.
3. **Builder (P4/P5)**: toàn bộ test builder xanh (hiện ~770); kiểm trình duyệt trên bản sao Shot 03: chọn/kéo keyframe, Ctrl+B cắt clip,
   Ctrl+Z/Ctrl+Y, camera pilot vào/ra, xoá node, thêm nhân vật từ thư viện; ảnh trước/sau giống nhau.
4. **Hiệu năng**: build production App 2 (`pnpm --filter studio build`), so tổng dung lượng `.next/static` (≤ +3%) và thời gian mở
   Shot 01 bản sao (trung bình 3 lần, ≤ +10%).
5. `pnpm typecheck` toàn workspace, test studio, test builder, `python -m unittest agent.test_unified_cli agent.test_unified_mcp`.
Report: `docs/REPORT-app2-split-<ngày>.md`. Trạng thái NOT_RUN / BLOCKED / FAIL / PASS.

## 9. Bài test thủ công (người dùng)
1. Mở App 2 bản thử, mở bản sao Shot 03, kéo vài keyframe, Ctrl+B cắt một clip, Ctrl+Z → giống bản thật.
2. Xuất film bản sao Shot 01 → cài bằng "Import ZIP to BBS FS Tool" vào game giả → tool báo "đã cài sẵn" khi so với bản xuất từ main.

## 10. Câu hỏi của người đọc kiểm tra: Claude chốt
Người đọc kiểm tra (Sonnet) đối chiếu main 63bad8a; mọi mục dưới là **[Claude chốt]**.
1. **Hai kiểu handler.** `executeLockedCommand` có 3 pha: (a) lệnh *thoát sớm* tự `saveRequest`/ghi file và trả kết quả riêng
   (project.create/import ~1012–1033, `app3.*` ~1038, episode.export ~1050, project.splitShots ~1083 có `atomicJson` + `rm` khi lỗi,
   project.inspect/save, rig.inspect, assignment.plan/run, rig.normalization.*); (b) pha kiểm tra/chuẩn bị gán các biến `let` (~993–1010)
   kể cả nhánh dryRun trả `{valid,…}` (~2447); (c) `withWriter` (~2453) khoá, đọc lại, kiểm revision, apply, `commit`.
   → Bảng có **2 kiểu**: `EarlyHandler` (giữ nguyên đường thoát sớm, tự trả `CommandSuccess`) và `PlannedHandler` (pha b trả
   `CommandPlan` gồm cả dữ liệu cho dryRun; pha c dùng chung). Không ép lệnh thoát sớm đi qua commit chung.
2. **Thứ tự lỗi gốc.** Trước khi tách (đầu P2) phải viết `store/COMMAND-ORDER.md`: với mỗi lệnh, thứ tự các bước kiểm tra/side-effect
   trong code cũ (vd danh sách lệnh hardcode ~1711, kiểm history args ~2443, `findRootMotionConflict` ~2447, dryRun, rồi
   `expectedRevision` ~2450). Code mới giữ đúng thứ tự đó; replay có ca lỗi cho từng bước kiểm tra chung.
3. **Tất định cho replay.** Harness chạy main và nhánh trong tiến trình riêng, stub `crypto.randomUUID` (và mọi nguồn uuid khác) bằng
   bộ đếm toàn cục bắt đầu từ cùng giá trị; cố định `Date.now`/`new Date` bằng đồng hồ giả tăng đều; trường lấy từ mtime (`updatedAt` ~267)
   và lock (~898) chuẩn hoá trước khi băm. Cùng danh sách lệnh, cùng requestId, cùng thứ tự ở hai bên.
4. **Idempotency.** Kịch bản có: lặp lại cùng requestId + cùng payload (phải trả kết quả cache), cùng requestId + khác payload
   (`REQUEST_ID_CONFLICT`), và ca recover từ history trong `previousRequest` (~274).
5. **Bí danh** `animation.assignment.commit` → `asset.import` (~944): đổi tên **trước** khi tính `requestHash`, giữ nguyên ở cửa vào;
   replay có một ca dùng tên bí danh.
6. **Danh sách tên lệnh chuẩn.** Bước đầu P1 sinh `store/command-names.json` từ code main (gồm `command === '…'`, các mảng `includes`,
   tiền tố `startsWith('app3.')`…) và review tay; "đã phủ / tổng" tính theo danh sách này (bỏ con số ~160/≥150 ước lượng: mục tiêu là
   **phủ 100% tên lệnh trong danh sách**, mỗi tên ≥ 1 ca thành công hoặc ca lỗi có chủ đích nếu không dựng được dữ liệu).
7. **history.undo/redo** phủ cả hai đường: không dryRun (`executeHistoryCommand` ~959–987) và dryRun (đường chung).
8. **Ngưỡng kích thước.** Ngoại lệ 250 dòng áp cho mọi hàm *được di chuyển nguyên khối* mà tách tiếp sẽ phải viết lại logic; mỗi
   ngoại lệ liệt kê trong report kèm lý do. Đếm dòng sau khi chạy formatter hiện có của repo (không tự xuống dòng thủ công thêm chỉ để
   đạt số; dòng dài giữ nguyên nếu move nguyên khối). Giới hạn 40 KB vẫn bắt buộc.
9. **Đụng độ với đợt timeline.** Nếu F1–F2/E1–E3 sửa `unifiedProjectStore.ts` hay `unifiedJobs.ts`: đợt nào merge trước thì đợt sau
   rebase và chạy lại replay; không bao giờ giải xung đột bằng cách bỏ thay đổi của đợt kia.

## 11. Builder tự quyết
Tên file/thư mục cụ thể, cách chia nhóm nhỏ hơn trong một nhóm lệnh lớn, kiểu `ctx`/`CommandPlan`, cách cố định nguồn uuid/thời gian
trong harness, có tách tiếp file test lớn hay không (không bắt buộc).

## 12. Ràng buộc
Không sửa `packages/retarget`, không đổi golden, không commit binary/kho thật/project thật. Test trên bản sao, luôn đặt
`W01_LIBRARY` bản sao. App 3 giữ mọi chức năng (không sửa `animation-studio`). Không fetch trong `packages/builder`.
`pnpm typecheck` toàn workspace trước push. Không đụng server 3016 (App 2 thật, worktree `S:\Claude\w01-app`) và 3101 (App 1).
