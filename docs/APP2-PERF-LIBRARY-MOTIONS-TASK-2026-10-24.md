# P1 — App 2 nhẹ khi mở: động tác lấy từ thư viện theo từng clip (2026-10-24)

Người dùng: "File động tác cho qua thư viện". Mở project lớn trong App 2 phải nhẹ; động tác nằm ở thư viện App 5, project chỉ tải
đúng động tác đang dùng.

## Đo thật (Claude, 2026-10-24, Tập 15, RTX 3060)
- Mở App 2 tải **70 MB**:
  - **26 MB** là một GLB chứa cả 85 động tác (`minecraft-actions.glb`), trong khi tập chỉ dùng vài cái;
  - **10 MB** một WAV âm thanh;
  - 6 MB một GLB động tác Minecraft20;
  - 5 MB Gỗ Xưa;
  - 7 MB code (dev);
  - **`GET /api/unified/projects/<id>` (543 KB) bị gọi ≥ 6 lần** mỗi lần mở.
- Sau khi tải xong: 57 FPS cả khi phát "Xem như BBS"; lúc mở có lần khựng 0,7 s; heap trang ~950 MB.
- Claude đã nhập bộ 85 động tác vào **kho dùng chung**: pack `267f6b19dd7e21ca` trong `C:\w01-library`, có `anim.glb` (Mixamo65) +
  `anim.bobj` (Minecraft20), tên Việt, nhóm. Đây **cùng SHA** với asset động tác 26 MB trong project Tập 15.
- `GET /api/library/animation/[uuid]` hiện trả **nguyên GLB của gói** (26 MB cho một động tác).

## Yêu cầu
1. **Clip từng động tác:**
   - `GET /api/library/animation/[uuid]` (thêm `?clip=1`, hoặc mặc định) trả GLB **chỉ có xương + đúng 1 animation** của action đó.
   - Tách ở server, **cache ra đĩa** `packs/<packId>/clips/<uuid>.glb` (tạo lần đầu, dùng lại sau), header `Cache-Control: public,
     max-age=31536000, immutable` + `ETag` theo SHA.
   - Tương tự `.../animation/[uuid]/bobj` trả `.bobj` chỉ action đó (`selectBobjActions` có sẵn).
2. **App 2 tham chiếu thư viện thay vì nhúng:**
   - `library.place` và các motion lấy từ thư viện lưu **tham chiếu action thư viện** (`libraryActionUuid` + SHA clip), không chép cả gói
     vào `assets` của project.
   - Evaluator tải clip **lười**: clip của nhân vật trong cảnh đang xem / gần đầu phát trước, phần còn lại tải dần ở nền.
   - Hỏng / thiếu clip → báo rõ trên clip, không chặn cả project.
   - Xuất film (K5) và render headless dùng cùng đường lấy clip.
3. **Chuyển project cũ sang tham chiếu thư viện:**
   - Lệnh `project.motions.linkLibrary` (có dry-run): motion nào có asset nguồn trùng SHA với một gói thư viện thì trỏ sang action thư viện
     tương ứng (theo `glbAnimationIndex` / tên).
   - Asset nhúng không còn ai dùng thì gỡ khỏi project. Giữ được Hoàn tác: một bản ghi lịch sử, file asset chưa xoá cho tới khi người
     dùng "Dọn asset không dùng".
   - Báo cáo số MB giảm.
   - **Claude sẽ chạy trên Tập 15 và đo lại.**
4. **Âm thanh:**
   - Khi nhập WAV, tạo **bản nghe nhẹ Opus (`.webm`/`.ogg`, ~96 kbps)** để phát trong App 2; WAV gốc giữ cho trộn tiếng / xuất film.
   - Asset cũ chưa có bản nhẹ thì tạo ở nền khi mở project.
5. **Không tải project nhiều lần:**
   - Một lần `GET` khi mở; các thành phần dùng chung một store/cache theo `revision`.
   - Thêm `ETag` / `If-None-Match` cho route project.
   - Có test đếm số lần gọi.
6. **Chạy bản build chính thức:**
   - Script `pnpm --filter @topview/3d-studio run start:prod` (build nếu chưa có rồi `next start`), nhận cùng biến môi trường như dev
     (`BBS_UNIFIED_PROJECTS_DIR`, `W01_VFX_PREVIEWS`, `BBS_JAVA_HOME`, `W01_LIBRARY`).
   - Ghi cách chạy vào `apps/studio/README.md`.

**Đạt khi:**
- test: clip 1 action từ gói 85 action nhỏ hơn hẳn và đọc lại đúng 1 animation, đúng giá trị 3 khung; cache lần 2 không tách lại;
- `library.place` không thêm asset gói vào project;
- `linkLibrary` dry-run / áp dụng / hoàn tác đúng;
- route project trả 304 khi không đổi;
- test đếm fetch: mở project chỉ 1 lần `GET`;
- test cũ PASS (film, series, bbsFilm, library, golden builder không regenerate).

## Phân chia
- Vùng file:
  - `apps/studio/app/api/library/animation/**`
  - `apps/studio/src/` (store, motions, audio, film dùng clip)
  - `packages/library` (tách clip + cache, + test)
  - `packages/builder` chỉ phần nạp clip lười nếu bắt buộc (không đụng `evaluateSteps.ts`, không regenerate golden)
  - `apps/studio/package.json` (script)
  - README
- Có thể chia **2 subagent song song** (model **sol 5.6** bản nhẹ):
  - **P1a**: mục 1 + 3 + 6 (thư viện, route, lệnh chuyển, script build);
  - **P1b**: mục 2 + 4 + 5 (App 2 nạp lười, âm thanh nhẹ, một lần tải project).

  Hợp đồng chung: URL `GET /api/library/animation/[uuid]` (clip) và trường `libraryActionUuid` trên motion.
- Nhánh `ai1/p1a-library-clips`, `ai1/p1b-app2-lazy-load`. Build, `pnpm typecheck`, test **trên Windows**. **Không tự merge.**
- Tránh xung đột với M2/M3/F1 đang làm: M2 sở hữu `app/library/page.tsx`; P1 chỉ sửa route `animation/**` và phía App 2.

## Lệnh gửi Codex
> Thêm việc **P1** theo `docs/APP2-PERF-LIBRARY-MOTIONS-TASK-2026-10-24.md` (`main` mới nhất): App 2 lấy động tác **từ thư viện theo từng clip**
> (route trả GLB chỉ 1 animation, cache ra đĩa), project **tham chiếu** action thư viện thay vì nhúng cả gói 26 MB, lệnh chuyển project cũ
> sang tham chiếu (có dry-run, hoàn tác), bản nghe Opus nhẹ cho WAV, chỉ tải project 1 lần (ETag), script chạy bản build chính thức. Chia
> **P1a** và **P1b** cho hai subagent model sol 5.6 bản nhẹ chạy song song với M1–M3/F1, không đụng `app/library/page.tsx` (của M2). Nhánh
> `ai1/p1a-…`, `ai1/p1b-…`; build, typecheck, test trên Windows; **không tự merge**; xong báo mã việc + số PR.
