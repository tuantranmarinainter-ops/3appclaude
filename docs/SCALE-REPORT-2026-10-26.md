# Báo cáo điều tra tỷ lệ nhân vật S1 — 2026-10-26

Trạng thái hiện tại: đã tiếp tục triển khai `heightBlocks` sau khi có số đo Windows và kiểm tra mã renderer BBS. Giữ nguyên `packages/retarget`; hiệu chỉnh ở thư viện, scene, phần trình bày App 3 và form xuất film. Phần điều tra ban đầu dưới đây được giữ lại để phân biệt nghi vấn với bằng chứng mới. Các phép đo model/project thật còn thiếu và kiểm trong game vẫn `NOT_RUN`.

## Dữ liệu thật còn thiếu

Thư viện nhân vật và các project/bản xuất trên Windows chưa có trong workspace Linux này. Thư mục `/workspace/library-files` trống. Không tìm thấy mesh Đen Emoticons, mesh Gỗ Xưa Verity, project Tập 15 hay `assets/models/unified/<id>/model.bobj` và film `.dat` tương ứng. Các file action/armature V9.12 trong repo không phải mesh của hai nhân vật này nên không dùng thay cho phép đo.

Ảnh cột đo `S:\Claude\w01-samples\ingame-measure-20261026\scale-pillar.png` nằm ngoài repo, chưa đọc được trong phiên này. Những số dưới đây do người dùng cung cấp, **không phải số đo được thực hiện trong workspace**: App hiện Đen **2,03 m**, Gỗ Xưa **1,90 m**; ảnh trong game cho Minecraft20 khoảng **1,8 block**, Chirity khoảng **3,56 block** cạnh cột **5 block**. Chirity chỉ là tham chiếu cùng nhóm Verity; chưa xác nhận chiều cao thật của Gỗ Xưa.

| Phép đo cần thực hiện | Đen (Minecraft20) | Gỗ Xưa (Verity) |
| --- | --- | --- |
| Biên Y mesh nguồn và BBSFix `motion_scale` thực tế | NOT_RUN — thiếu model nguồn | NOT_RUN — thiếu model nguồn |
| Chiều cao App 2 từ `stage.worldAabb` | NOT_RUN — thiếu project/model | NOT_RUN — thiếu project/model |
| Chiều cao mesh `model.bobj` đã xuất | NOT_RUN — thiếu bản xuất | NOT_RUN — thiếu bản xuất |
| Scale actor/form đọc lại từ film `.dat` | NOT_RUN — thiếu film | NOT_RUN — thiếu film |
| Chiều cao sau khi mở film trong game | NOT_RUN | NOT_RUN |

Không suy ra các số đo còn thiếu từ số người dùng báo. Gate kiểm trong game vẫn **NOT_RUN**.

## Điều đã xác nhận từ mã nguồn

1. `packages/retarget/src/bobjModel.ts:42` đặt `unitMeters = 0.4915394` cho armature tên `verity.mdl`, còn armature khác mặc định là **1**. `buildBobjModel` áp hệ số này lên wrapper chung của mesh, xương và action qua `root.scale.setScalar(unit)` (dòng 191); chiều cao báo cáo là `(ceiling - floor) * unit` (dòng 193). Đây là phép thu nhỏ gần một nửa **đã xác nhận trong code**, với nghịch đảo khoảng **2,034425**.
2. `apps/studio/src/libraryModels.ts` chuyển BOBJ bằng `bobjModelToGlb(parseBobjModel(...))`, không truyền giá trị ghi đè preset Verity. `apps/studio/src/libraryCommands.ts:228` thêm nhân vật vào cảnh với scale đều **1** và chưa có hồ sơ `heightBlocks`. Vì vậy preset nói trên đi vào GLB mà App 2 sử dụng.
3. `packages/library/characters.ts:53–59` nhân tọa độ Y của vertex BOBJ với BBSFix `motion_scale` khi ghi `heightMeters` của base model. Trong khi đó `packages/retarget/src/bobjModel.ts:29` ghi rõ `motion_scale` không phải đơn vị mesh và parser giữ nó riêng. **Hai đường tính chiều cao dùng quy tắc khác nhau**; chưa định lượng được chênh lệch cho hai nhân vật vì thiếu file nguồn và giá trị `motion_scale` thực tế.
4. `apps/studio/src/unifiedJobs.ts:400` truyền `model.metersPerUnit` đã nhập cho `convert-model`. Giá trị thực tế của profile trong project, chiều cao model xuất và actor/form scale chưa được đo do thiếu dữ liệu.

## Nghi vấn và giới hạn kết luận

Preset Verity **0,4915394** là **ứng viên nguyên nhân** phù hợp với biểu hiện tỷ lệ gần hai lần. Chưa chứng minh đó là lỗi: cần biết đơn vị mesh nguồn, `stage.worldAabb`, kết quả `convert-model`, actor/form scale và quy tắc scale lúc BBS chạy. Không thể kết luận riêng `metersPerUnit`, normalize hay BBS gây lỗi từ dữ liệu hiện có. Sai khác giữa cách tính metadata và cách chuyển GLB cũng cần kiểm bằng model thật.

Chưa sửa `packages/retarget`, chưa đổi golden, chưa ghi binary. Theo yêu cầu S1, khi điều tra chạm nguyên nhân nghi vấn trong `packages/retarget` phải dừng và báo trước; báo cáo này ghi nhận việc dừng, **không phải sự cho phép thay đổi retarget**.

## Trạng thái tại bước điều tra ban đầu

Các phần S1 còn chờ: hồ sơ/API/UI `heightBlocks`, mặc định MC20 1,8 và Verity 3,6 block, cùng hệ số giữa App 2/App 3 và bản xuất, xác nhận rõ trước khi cập nhật nhân vật đã có trong project, lưới block, nhãn chiều cao, film đo cạnh cột 5 block và kiểm sai số trong game. Không có code triển khai trong thay đổi báo cáo này.

Các kết quả kiểm tra baseline của nhánh báo cáo được ghi riêng khi chạy xong; không dùng chúng thay cho các phép đo nhân vật đang thiếu ở bảng trên.

## Kiểm tra baseline trước khi đẩy báo cáo

Nhánh chỉ thêm tài liệu; code giữ nguyên `main` tại `164c4e1`. Các lệnh chạy trên cùng code baseline trong checkout `/workspace/3appclaude`:

| Lệnh / gate | Kết quả |
| --- | --- |
| `pnpm --filter @topview/3d-builder build` | PASS |
| `pnpm typecheck` | PASS |
| `pnpm lint` | PASS, 4 cảnh báo có sẵn |
| `pnpm build` | PASS |
| `pnpm test:evaluate` | 622 PASS, 1 SKIP; một suite lỗi do build song song xóa dist, chạy lại suite `filmPoseView` đạt 5/5 |
| Studio `node --import tsx --test --test-concurrency=1 ../../apps/studio/test/*.test.ts` | Node 22: 254 PASS, 8 SKIP, 4 FAIL ban đầu; 3 lỗi thiếu Chromium chạy lại đạt 9/9 sau khi cài trình duyệt. Còn lỗi baseline `sceneExportRoundtrip.test.ts` khi gọi Blender 4.3.2 (`SCENE_CONVERSION_FAILED`) |
| `pnpm --filter @topview/3d-studio test:offline` | PASS với Chromium đã cài và `W01_LIBRARY` trỏ thư viện tạm ngoài repo; 0 request ngoài |
| `python -m unittest agent.test_unified_cli agent.test_unified_mcp` | PASS, 55 test |
| Đo model thật, film đo, game | NOT_RUN — thiếu dữ liệu ngoài repo và môi trường Minecraft |

Môi trường dùng pnpm 11: thêm `--config.verify-deps-before-run=false` khi chạy script để tránh pnpm tự cài lại vào home chỉ đọc. Test Studio dùng Node 22.23.4 vì Node 24 của môi trường gặp native async assertion. Không sửa code để che lỗi baseline hoặc thay golden.

## Bổ sung của Claude trên máy Windows (2026-10-26, dữ liệu thật)

Đo trực tiếp (Y min/max của mọi `v` trong BOBJ; không đọc `motion_scale`):

| Model | Nơi | Chiều cao thô (đơn vị BOBJ) |
| --- | --- | --- |
| Gỗ Xưa `original/model.bbs.bobj` (thư viện bản sao `lib-a9`) | thư viện | **5,828** (min −1,993) |
| Tiểu Nhị `original/model.bbs.bobj` | thư viện | 5,828 |
| Chirity `original/model.bbs.bobj` | thư viện | **6,947** (min −1,982) |
| Gỗ Xưa đã xuất vào game `config/bbs/assets/models/unified/61ccc9ce…/model.bobj` | game | 5,828 — **cùng hình học với bản gốc** |
| Chirity `config/bbs/assets/models/3 MODEL DUA VAO APP/CHIRITY` (bản người dùng đo) | game | 6,947 |
| Gỗ Xưa trong App 2 (`model.glb` Mixamo65 của thư viện, `stage.worldAabb`) | app | **1,90 m** |
| Đen MC20 Emoticons trong App 2 | app | 2,03 m (game ≈ 1,8 block) |

Kết luận:
1. Trong game Chirity đo được ≈ 3,56 block; 3,56 / 6,947 = **0,512**, khớp preset `unitMeters = 0,4915394` của
   `verity.mdl` trong vòng ~4% (sai số đo ảnh). **Preset retarget không phải lỗi** — nó đúng với cách BBS hiển thị.
2. Lỗi nằm ở **model hiển thị trong app**: nhân vật nhóm Verity trong thư viện dùng `model.glb` Mixamo65 đã chuẩn hoá
   về ~1,9 m (đường App 1 `--mode model`), không theo kích thước BOBJ gốc mà game dùng. Đáng lẽ Gỗ Xưa ≈ 5,828 × 0,4915
   = **2,86 m** (≈ 2,9–3,0 block trong game), Chirity ≈ 3,41–3,56.
3. Vì vậy **Gỗ Xưa không cao 3,6 block như Chirity**: hình học nhỏ hơn Chirity 16%. Mặc định `heightBlocks` cho nhóm
   Verity không nên là một hằng 3,6 mà tính từ BOBJ gốc: `heightBlocks = chiều cao thô BOBJ gốc × 0,4915394`
   (Gỗ Xưa/Tiểu Nhị 2,86; Chirity 3,41), người dùng chỉnh được.
4. Sửa được ở `packages/library` + `apps/studio` (scale đều GLB khi đưa vào cảnh/App 3 và khớp lúc xuất), **không cần sửa
   `packages/retarget`**. Chỉ còn câu hỏi phụ: MC20 Emoticons app 2,03 vs game ≈ 1,8 (nghi BBS/scale form người chơi 0,9375
   hoặc mesh lớp ngoài) — đo lại bằng film đo khi có S1.

## Hiệu chỉnh sau số đo Windows và kiểm tra renderer BBS

Appendix Windows xác định GLB chuẩn hóa trong app khác kích thước BOBJ gốc. Tuy nhiên không dùng preset nhập BOBJ `0.4915394` làm hệ số hiển thị mặc định của mọi model BBS. Kiểm mã FS 2.7 tại commit `998c9d585427b4cf0061940496ae1f6a7df1bb03` cho thấy:

- [ModelConfig.java dòng 49](https://github.com/Wemppy4/bbs-fs/blob/998c9d585427b4cf0061940496ae1f6a7df1bb03/src/client/java/mchorse/bbs_mod/cubic/model/config/ModelConfig.java#L49): config scale mặc định là `[1,1,1]`.
- [BOBJLoader.java dòng 264](https://github.com/Wemppy4/bbs-fs/blob/998c9d585427b4cf0061940496ae1f6a7df1bb03/src/main/java/mchorse/bbs_mod/bobj/BOBJLoader.java#L264): tọa độ vertex được đưa trực tiếp vào buffer, không tự nhân preset nhập của app.
- [ModelFormRenderer.java dòng 113](https://github.com/Wemppy4/bbs-fs/blob/998c9d585427b4cf0061940496ae1f6a7df1bb03/src/client/java/mchorse/bbs_mod/forms/renderers/ModelFormRenderer.java#L113): áp transform form rồi scale config model.
- [Form.java dòng 75](https://github.com/Wemppy4/bbs-fs/blob/998c9d585427b4cf0061940496ae1f6a7df1bb03/src/main/java/mchorse/bbs_mod/forms/forms/Form.java#L75) và [Transform.java dòng 485](https://github.com/Wemppy4/bbs-fs/blob/998c9d585427b4cf0061940496ae1f6a7df1bb03/src/main/java/mchorse/bbs_mod/utils/pose/Transform.java#L485) xác nhận wire `form.transform.s` và `.t` là float3.

Gói original unified hiện không xuất config scale riêng. Vì vậy tính hệ số form từ chiều cao mesh **thô**, độc lập với preset nhập app: `formScale = heightBlocks / rawHeight`, `formOffsetY = -rawMinY * formScale`. Không suy ngược config của model Chirity đang có trong game từ ảnh; model đó ở thư mục khác và có thể có config riêng.

Theo yêu cầu trực tiếp của người dùng, mặc định vẫn là Minecraft20 **1,8 block**, nhóm Verity **3,6 block**, thay vì tự áp đề xuất 2,86/3,41 ở appendix. Hồ sơ sửa được. Scene lưu snapshot `libraryHeightBlocks`, `librarySourceHeightMeters`, `libraryHeightScale`; hệ số đều của node là đích / chiều cao GLB thực tế. Đổi hồ sơ không tự sửa project; thao tác đồng ý mới cập nhật node và các scale key, trong một bước Undo. Liên kết thư viện vào node cũ giữ transform đã dựng và yêu cầu đồng ý riêng khi chiều cao khác.

App 3 giữ GLB, action và fingerprint chuẩn; chỉ đổi wrapper hiển thị và quy đổi delta vị trí trả về đúng một lần. Film giữ mesh/xương BOBJ nguyên vẹn, áp scale form đã xác minh và bù sàn; root motion được quy đổi độc lập để không nhân hai lần. Thay đổi worker Java chỉ thêm trường form scale/offset tùy chọn, không sửa solver retarget.

Kiểm số tổng hợp dùng biên Y có sàn khác 0: fixture 2,03 → 1,8 block; fixture Verity có raw height 5,828, raw min Y −1,993, GLB height 1,90 → 3,6 block. Với fixture Verity, `formScale = 3.6/5.828`, `formOffsetY = 1.993 * formScale`; kiểm ma trận cho chân Y=0 và chiều cao đúng đích. Số 5,828/−1,993 lấy từ báo cáo Windows; đây vẫn là test dựng lại bằng dữ liệu tổng hợp, không phải đo lại model Gỗ Xưa thật trong Linux. Riêng raw height 2,03 trong fixture Minecraft chỉ là dữ liệu test, không khẳng định raw BOBJ Đen có chiều cao đó.

Test Java xuất hai actor dùng chung một BOBJ rồi đọc lại `.dat` bằng BbsCodec, kiểm `s`/`t` và byte/hash model giữ nguyên. Đây là kiểm cấu trúc/số học; chưa phải nghiệm thu renderer trong game. Model Đen/Gỗ Xưa thật, film cột 5 block, SHA Samba `68fcdb75d373…` và ảnh game chưa có trong workspace: các gate này vẫn **NOT_RUN**; không đổi golden hay ghi đè dữ liệu mẫu Windows.

## Bàn giao khi dừng theo quota

Code hiện có được mở PR nháp, chưa tự merge. Chi tiết file, quyết định, kết quả kiểm tra và việc còn dở: [S1-HANDOFF-2026-10-26.md](S1-HANDOFF-2026-10-26.md). Studio282PASS/7SKIP/1FAIL baseline Blender;31 test tập trung PASS; builder627PASS/1SKIP; Python CLI/MCP + native Java56PASS; build/typecheck/lint/offline PASS. Gate model thật, film đo, Samba và game còn NOT_RUN.

## Đính chính và nghiệm thu S1 trên Windows (Claude, 2026-10-26, sau merge #166)

**Đính chính:** mục "Bổ sung của Claude" ở trên đo Y min/max của đỉnh BOBJ **thô** (chưa áp armature rest), nên kết luận
"Gỗ Xưa ≈ 2,86 block" là **sai**. Đo bằng `buildBobjModel(...).report` (chiều cao sau khi áp rest pose, cách BBS hiển thị):

| Model | unitMeters | floor | Cao trong BBS ở form scale 1 |
| --- | --- | --- | --- |
| Gỗ Xưa (thư viện) | 0,4915394 | −0,030 | **3,865 block** |
| Chirity (thư viện = bản trong game) | 0,4915394 | −0,020 | 4,985 block |
| Đen MC20 Emoticons | 1 | −0,016 | 2,032 block |

Con Verity tím trong ảnh đo của người dùng (≈ 3,56 block, dáng khom) cùng hình học với Gỗ Xưa (3,865 khi đứng thẳng) — khớp.
Vì vậy mặc định Verity **3,6** ≈ cỡ gốc Gỗ Xưa, công thức `formScale = heightBlocks / (heightMeters/unitMeters)` của S1 đúng.

**Nghiệm thu (bản sao Tập 15 + thư viện `lib-a9`, code main `13f031e`):**
- `update-scene-heights`: Đen scale ×0,886 (2,0315 → 1,8), Gỗ Xưa ×1,895 (1,90 → 3,6).
- `stage.worldAabb` trong App 2: Đen **1,800** (chân 0,000), Gỗ Xưa **3,600** — PASS. Gỗ Xưa không có clip (tư thế gốc) có minY −0,607 trong app (backlog B24).
- Film đo `S1-do-chieu-cao` (T-pose, không động tác, đặt bằng F3+C 107.08 −60 207.13 yaw −64.47, hai nhân vật trước mặt 4 block),
  đọc lại `.dat` bằng BbsCodec: Đen `form.transform.s=0,8860448`, `t.y=0,01396` → 1,800 block; Gỗ Xưa `s=0,9313379`,
  `t.y=0,02799` → 3,600 block; cả hai Y = −60 (mặt đất). Đã cài vào world "Thế giới mới (1)" (install `2afa6e8b…`).
- Gate trong game: **NOT_RUN** (chờ người dùng mở film `S1-do-chieu-cao`).
