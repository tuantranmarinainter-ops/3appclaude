# Nhập nhiều file animation · thư viện có video · gán cho nhân vật — giao việc (2026-10-24)

Người dùng chốt 2026-10-23/24:
- App 1 nhập **nhiều file cùng lúc** (cả thư mục, hoặc chọn nhiều GLB/FBX/BOBJ). Thư mục Mixamo chỉ là một trường hợp. Chọn
  animation cần lấy, rồi xuất vào **một nhân vật** và/hoặc **kho dùng chung**.
- Mixamo: **người dùng tự tải FBX** trên mixamo.com (Y Bot, FBX, 30 fps, Without Skin, có thể kèm bản In Place) rồi đưa thư mục.
  **App không tự đăng nhập hay cào Mixamo.** Ghi nguồn "Mixamo (Adobe)" vào giấy phép và không phát tán lại file gốc.
- Thư viện (App 5) hiện **video tự chạy lặp như Mixamo**, không dùng ảnh tĩnh.
- "Gán cho nhân vật" **chuyển ngay** sang bản riêng theo loại xương của nhân vật (mặc định).

Đọc trước: `docs/APP1-ACTION-PICKER-TASKS-2026-10-23.md` (bảng chọn A1, tên song ngữ A2, đổi tên),
`docs/ANIM-LIBRARY-TASKS-2026-10-23.md` (L1–L3, trạng thái Nháp/Đã chỉnh/Đã duyệt), `docs/CHARACTER-TASKS-2026-10-23.md` (Verity giữ
bộ xương gốc, Minecraft 20).

## Hiện trạng (main sau #80)
- **Workbench (App 1)** `packages/retarget/workbench/`: 1 file nguồn mỗi lần. Đã có bảng chọn animation ghim được (ô tích, đổi tên Anh/Việt,
  thẻ theo dòng) và nút "Chuyển sang nhân vật đích" (bộ nhân vật Nháp và/hoặc kho dùng chung). Với Verity có kèm `.original.*`;
  với Minecraft 20 có kèm `.bobj`.
- CLI: `cli/normalizeCore.ts` (`runNormalize`), `cli/normalizeBatch.ts`, `cli/toMinecraft20.ts`, `cli/verityOriginal.ts`, `workbench/verity.ts`.
- **Thư viện** `packages/library`: kho dùng chung (không `ownerCharId`), bộ của nhân vật (L1), `nameVi` (A2), `sourceName`; ảnh bìa PNG `covers/`.
- **Studio**: trang `/library` (`apps/studio/app/library/page.tsx`, `ActionPreview.tsx`), API `app/api/library/*`. Bảng động tác theo nhân vật
  (L3) ở App 2. Render headless bằng GPU (W3, `packages/director-cli`).

## M1 — App 1: nhập nhiều file, một bảng chọn chung
Vùng file: `packages/retarget/workbench/` (server, pipeline, public), `packages/retarget/cli/normalizeBatch.ts` (nếu cần),
`test/workbench.test.ts`.
1. **Nguồn nhiều file:** kéo thả nhiều file hoặc cả thư mục, hoặc nhập **đường dẫn thư mục** (đệ quy, lọc `.glb .gltf .fbx .bobj`).
   - Giới hạn ≤ 2000 file mỗi lô, báo rõ khi vượt.
   - Bỏ qua file trùng theo SHA-256: đã có trong kho thì đánh dấu "Đã có trong kho"; vẫn gán được cho nhân vật.
2. **Kiểm tra từng file ở nền** (inspect, tự nhận loại xương):
   - Hàng đợi có tiến độ và nút huỷ.
   - File lỗi hoặc thiếu xương chính chỉ đánh dấu lỗi file đó, không chặn cả lô.
3. **Bảng chọn chung** (mở rộng bảng A1):
   - **Nhóm theo file**, gập/mở được; file có 1 animation hiện một dòng.
   - Tìm trên toàn bộ các file (tên Anh/Việt, tên file).
   - Mọi ô tích, đổi tên, thẻ theo dòng như A1. "Chọn hết/Bỏ hết" theo nhóm và theo toàn bảng; bộ đếm "đã chọn 37/412 (21 file)".
   - Mixamo: tên lấy từ tên file (`Samba Dancing.fbx` → `Samba Dancing | Nhảy samba`). Phát hiện **In Place** (root không đi xa, hoặc tên
     file có `In Place`) → thẻ phụ `in-place`.
   - Bấm vào dòng = xem thử file đó ở khung nguồn (nạp file khi cần, không nạp hết vào bộ nhớ).
4. **Chuyển một lần:**
   - Chọn **một nhân vật đích** và/hoặc **kho dùng chung** (như A1).
   - Chuẩn hoá **lần lượt** chỉ các animation đã tích, nhóm theo file: mỗi file một lượt `runNormalize`, mỗi file có thể chỉnh hướng mặt / root-scale
     riêng nếu người dùng mở "Tuỳ chỉnh file", mặc định tự động.
   - Có tiến độ ("file 12/21, animation 30/37"), huỷ giữa chừng (giữ phần đã xong), "Thử lại các file lỗi".
   - Chạy xong đóng bảng vẫn chạy tiếp; xong báo một dòng tổng.
   - Verity / Minecraft 20 xử lý như A1 (`.original.*` / `.bobj`). Kho dùng chung mỗi file nguồn một gói; giấy phép ghi `source` (vd
     `Mixamo (Adobe)` khi file nhận diện được là Mixamo, hoặc người dùng chọn nguồn cho cả lô).
**Đạt khi:** test workbench với 3 file tổng hợp (2 Mixamo65 khác nhau + 1 file hỏng):
- bảng có 2 nhóm hợp lệ + 1 lỗi;
- tích 3 animation ở 2 file → đúng 3 Nháp cho nhân vật và 2 gói chung;
- nhập lại cùng file → báo "Đã có trong kho", không nhân đôi;
- huỷ giữa lô giữ phần đã xong;
- test cũ PASS.

## M2 — App 5: thư viện hiện video tự chạy (kiểu Mixamo)
Vùng file: `apps/studio/app/library/` (page, components mới), `apps/studio/app/api/library/` (route mới cho video), `apps/studio/src/libraryPreviews.ts`
(mới), `packages/library` (chỉ thêm trường `preview` vào metadata + test), test Studio.
1. **Video xem trước mỗi animation:**
   - Định dạng: `.webm` VP9, **320×320, 15 fps, 2–3 s** (animation ngắn hơn thì lấy trọn, dài hơn thì lấy đoạn giữa), tắt tiếng, CRF ~36. Đã đo
     thật: khoảng **15–20 KB/clip**.
   - Hình: nhân vật mẫu Mixamo65 dựng sẵn (Minecraft 20 thì dùng ma-nơ-canh; bản Nháp của nhân vật thì dùng **chính nhân vật đó**), nền trơn
     tối, lưới sàn, camera chéo 3/4 khung theo bounding của cả clip.
   - Tạo bằng render headless GPU (W3, `packages/director-cli`) + ffmpeg; lưu `packs/<packId>/previews/<uuid>.webm` trong thư viện (ngoài repo);
     ghi `preview: { file, sha256, width, height, fps, seconds }` vào metadata.
   - **Tạo ở nền:** hàng đợi tự chạy cho animation chưa có video (khi mở `/library` hoặc sau khi nhập). Một job một lúc, không chặn UI; có
     nút "Tạo lại video". Không có ffmpeg/GPU → báo rõ, rơi về ảnh bìa PNG.
2. **Lưới thẻ như Mixamo** trên `/library`:
   - Mỗi thẻ là **video tự phát lặp, tắt tiếng**, tên song ngữ bên dưới, thời lượng, thẻ động tác, nhãn nguồn (Mixamo…) và trạng thái
     (Nháp/Đã chỉnh/Đã duyệt nếu là bản của nhân vật).
   - **Chỉ phát thẻ đang hiện** (IntersectionObserver); cuộn ra ngoài thì `pause()` và bỏ `src` để giải phóng bộ giải mã. Tải lười
     (`preload="none"`, chỉ gắn `src` khi gần hiện). Tối đa ~40 video phát cùng lúc.
   - Rê chuột → thẻ phóng to nhẹ. Bấm → khung xem lớn: xoay được, chuột trái xoay / giữa kéo / lăn zoom, thanh thời gian, nút
     **"Gán cho nhân vật…"** (gọi API của M3).
   - Lọc: nguồn (Mixamo/khác), thẻ động tác, In Place, nhân vật, trạng thái; tìm Anh/Việt (có/không dấu); sắp xếp theo tên/mới nhập.
**Đạt khi:**
- test tạo video từ GLB tổng hợp (file webm hợp lệ, đúng cỡ/fps/thời lượng, metadata ghi đúng; thiếu ffmpeg → fallback PNG);
- test logic chỉ phát thẻ hiện (logic thuần);
- ảnh chụp trang `/library` có ≥ 12 thẻ video (đính kèm PR);
- test cũ PASS.

## M3 — Gán animation cho nhân vật, tự chuyển theo loại xương
Vùng file: `packages/retarget/cli/assignToCharacter.ts` (mới, headless), test retarget, `apps/studio/app/api/library/assign/route.ts` (mới),
`apps/studio/src/libraryAssign.ts` (mới: hàng đợi job), App 2 bảng động tác theo nhân vật (L3, chỉ thêm nút "Lấy từ kho…" + trạng thái job),
test Studio. **Không** sửa `app/library/page.tsx` (của M2), M2 chỉ gọi API.
1. `assignToCharacter({ actionUuids, charId })` (headless, dùng lại bộ máy App 1):
   - **Nhân vật Mixamo65 thường:** tạo Nháp trỏ GLB gốc (không chuẩn hoá lại).
   - **Minecraft 20:** xuất `.bobj` Minecraft20 (`toMinecraft20`) vào Nháp.
   - **Nhân vật bộ xương gốc** (có `original/model.bbs.bobj` hoặc rig `verity`): áp về bộ xương gốc (`verityOriginal` / `workbench/verity.ts`), kèm
     `anim.original.bbs.bobj` + `anim.original.glb`, giữ `sourceName`, `nameVi`, thẻ.
   - Mỗi action một kết quả (ok/lỗi + lý do), lỗi một cái không chặn cái khác.
   - Đã có Nháp cùng nguồn cho nhân vật đó thì báo "đã có", không tạo trùng (có tuỳ chọn "Tạo bản mới").
2. API `POST /api/library/assign { actionUuids, charId }` → job (tiến độ, huỷ, kết quả); `GET` trạng thái. Chạy nền, một job một lúc.
3. **App 2:** trong bảng động tác theo nhân vật có nút **"Lấy từ kho…"** mở chọn nhiều animation của kho dùng chung (tên song ngữ,
   lọc, tìm), bấm "Gán" → gọi API, hiện tiến độ. Xong thì Nháp hiện trong bảng, đặt lên timeline được ngay.
4. **App 3:** không sửa ở đây (Claude làm L4: mở Nháp bằng đúng mô hình nhân vật, lưu phiên bản mới).
**Đạt khi:** test headless với 3 nhân vật tổng hợp (Mixamo65, Minecraft20, Verity có `original/`):
- gán 2 action → Mixamo65 có Nháp trỏ GLB, Minecraft20 có `.bobj` đúng tên `an`, Verity có `.original.*` và phần đầu `.bobj` gốc
  giữ nguyên từng byte;
- gán lại → "đã có";
- API trả tiến độ/kết quả;
- test cũ PASS.

## Cách làm cho Codex
- Agent điều phối, **M1, M2, M3 chạy song song cùng lúc**, mỗi việc một subagent model **sol 5.6** bản nhẹ.
- Hợp đồng chung để không chờ nhau: M3 export `assignToCharacter` và route `POST /api/library/assign`, M2 chỉ gọi route đó. M1 dùng
  `importPack` / `addDraftToCharacter` có sẵn.
- Không sửa file ngoài vùng của việc mình.
- Không commit video, ảnh hay animation thật. Test dùng dữ liệu tổng hợp tạo trong test.
- Nhánh `ai1/m1-batch-import`, `ai1/m2-library-video`, `ai1/m3-assign-to-character`; mỗi việc một PR. Chạy build, `pnpm typecheck`, test liên quan
  **trên Windows**, ghi kết quả thật vào PR. **Không tự merge.** Xong mỗi PR báo mã việc + số PR.

## Lệnh gửi Codex
> Đọc `docs/BATCH-IMPORT-LIBRARY-TASKS-2026-10-24.md` trên `main` mới nhất. Agent điều phối giao **M1** (App 1 nhập nhiều file /
> cả thư mục, một bảng chọn chung nhóm theo file, chuyển một lần vào một nhân vật và/hoặc kho dùng chung), **M2** (thư viện `/library`
> hiện **video .webm tự chạy lặp như Mixamo**, tạo ở nền bằng render GPU + ffmpeg, chỉ phát thẻ đang hiện) và **M3** ("Gán cho nhân vật"
> tự chuyển theo loại xương: Mixamo65 dùng thẳng, Minecraft 20 ra `.bobj`, Verity áp về bộ xương gốc; API job + nút "Lấy từ kho…" ở
> App 2) cho **ba subagent model sol 5.6 bản nhẹ chạy song song** theo hợp đồng trong đặc tả. Mỗi việc một nhánh `ai1/m1-…`, `ai1/m2-…`,
> `ai1/m3-…` và một PR; build, `pnpm typecheck`, test trên Windows; **không tự merge**; xong báo mã việc + số PR.
