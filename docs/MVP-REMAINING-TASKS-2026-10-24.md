# MVP Hero / Gỗ Xưa / Đen — việc còn lại cho Codex (2026-10-24)

Quy trình MVP người dùng chốt: chọn animation từ nhiều mô hình → áp cho Hero, Gỗ Xưa, Đen (App 1 Workbench) → kiểm trong
Thư viện (App 5) → dựng cảnh App 2 → sang App 3 chỉnh → trả kết quả về App 2.

## Đã xong và đã merge (#85–#95)
- **App 1:**
  - nhập lô;
  - không còn nhân đôi kho;
  - GLB Minecraft20 khớp BBS theo từng tick;
  - bảng "Hiệu chỉnh (kiểu Mixamo)" ở bước 4;
  - nền tối cố định.
- **Thư viện:**
  - mỗi nhân vật một base model riêng (`ownerCharId`, `createCharacterWithOwnBase`);
  - migrate kho thật đã chạy, có backup zip ở `C:\w01-samples\backups`;
  - một uuid chỉ ở một gói;
  - video 2,5 s chỉ quay khi bấm nút.
- **App 2:**
  - nút Create project;
  - "Thêm vào cảnh App 2" cho nhân vật thư viện;
  - "Lấy từ kho…" chọn được mọi nhân vật;
  - Verity quay +Z;
  - không còn lỗi hydration / trùng key.

## Việc còn lại

Ưu tiên theo thứ tự: **C1 → C2 → C3**, sau đó **C4–C7**.

### C1 — Chạy trọn App 2 → App 3 → trả về App 2 (chặn MVP)
- **Kịch bản:** project có Hero, Gỗ Xưa, Đen, mỗi người 1 clip từ thư viện.
  - Trong App 2 bấm tab Animation (App 3, Animation Studio 1.32.0 nhúng) → "Mở shot từ cảnh" (frame 0–300) → chỉnh một khung → "Lưu vào project" → "Trả kết quả về cảnh".
  - Clip sau chỉnh phải hiện trên timeline App 2 và phát được ("BBS look").
- **Đã biết:**
  - "Mở shot từ cảnh" báo `MVP shot requires one covering MotionClip per Character` nếu có nhân vật chưa có clip phủ đoạn đó. Cần báo rõ nhân vật nào thiếu, hoặc cho mở shot với các nhân vật đã có clip.
  - "Animation đã lưu" không liệt kê clip vừa đặt từ thư viện, nên không mở clip đó để sửa được. Cần cho chọn clip của nhân vật đang chọn.
- **Đạt khi:** test tự động (Playwright/Chromium) đi hết kịch bản trên dữ liệu bản sao, đo revision/binding trước và sau, có ảnh chụp.

### C2 — App 3 dùng model và xương riêng của nhân vật (L4)
- **Hiện tại:** App 3 luôn hiện manơcanh Mixamo 65 xương ("Root · Mixamo · 65 xương"), kể cả với Hero (Minecraft20) hay Gỗ Xưa (Verity gốc).
- **Yêu cầu:** App 3 mở bằng **base model riêng** của nhân vật (`resolveCharacter` → `baseModel`, texture riêng).
  - Minecraft20: khối có skin.
  - Verity: bộ xương gốc, có xương hàm, cánh Chirity.
- Sửa xong lưu thành phiên bản mới của Nháp nhân vật (`saveCharacterActionVersion`, trạng thái Đã chỉnh) và trả về App 2.
- **Giữ nguyên:** mọi chức năng của Animation Studio 1.31.8/1.32.0 (thêm qua bridge, không bỏ chức năng nào; xem memory `app3-keep-animation-studio`).
- **Đạt khi:**
  - mở Hero, Đen, Gỗ Xưa trong App 3 thấy đúng hình;
  - sửa 1 khung, lưu xong file `.bobj` xuất BBS vẫn hợp lệ: phần gốc của file Verity giữ byte-identical, đo round-trip.

### C3 — "Thêm vào cảnh" tự đặt nhân vật cách nhau
- **Hiện tại:** `addLibraryCharacterToProject` (`apps/studio/src/libraryCommands.ts`) đặt mọi nhân vật ở gốc toạ độ, nên 3 nhân vật chồng lên nhau.
- **Yêu cầu:** nhân vật mới đặt cạnh nhân vật đã có, theo +X, cách nhau ≥ 1,2 m hoặc 1,25 × bề rộng bounding box. Nhân vật cũ không bị dời.
- **Đạt khi:** có unit test; ảnh cảnh thấy cả 3 nhân vật đứng cạnh nhau.

### C4 — Workbench chọn nhiều nhân vật đích một lượt
- Ô "Nhân vật đích" chỉ chọn được 1, nên 3 nhân vật phải chuyển 3 lần.
- Server `/api/runs/:id/character-library` đã nhận `charIds[]`; chỉ cần giao diện chọn nhiều (checkbox) và chạy một lượt.
- **Đã làm:** Workbench dùng checkbox cho các nhân vật Mixamo65 tương thích, lấy giao của các thẻ Action, rồi gửi một run với toàn bộ `charIds[]`; tóm tắt kết quả liệt kê đủ tên đích và tổng số Nháp.
- **Kiểm chứng:** test Workbench 25 pass; browser E2E trên bản sao thư viện dùng `Samba Dancing.glb`, chọn Tiểu Nhị + Chirity, chuyển 1 Action trong một lượt, nhận `2 Nháp`; mỗi nhân vật tăng Action `0 → 1` và Draft `0 → 1`, `libraryVersion` giữ `1.0.0`. Ảnh và JSON chứng cứ nằm ngoài repo trong `outputs/c4-live-multi-target-transfer.png` và `outputs/c4-live-multi-target-transfer.json`.

### C5 — Nhập lô cho nguồn không tự map được
- `RobotExpressive.glb` (14 animation) bị loại vì `Missing main joints`. Nhập lô không có chỗ sửa mapping tay.
- Thêm nút "Sửa mapping" cho file lỗi: dùng lại MappingEditor kiểu app cũ, lưu preset, chạy lại.

### C6 — Hiệu chỉnh: phần chưa làm
- Mẫu bàn tay (Gốc / Duỗi / Tự nhiên / Nắm đấm + độ áp dụng, Cả hai / Trái / Phải).
- Xoay khớp theo trục World và trục lấy từ node khác (hiện chỉ Local).
- Nút "Xem thử": chạy lại ngay khi đổi thanh trượt.
- Trim/tốc độ cho xương phụ của nguồn Verity.
- Kiểm các thanh tỉ lệ (vai, bắp tay, cẳng tay, chân) có vào file `.bobj` Minecraft/Verity không.
- Tham chiếu: `#sidebarAdjustments` trong
  `C:\Users\Administrator\Documents\Codex\2026-10-08\retarget-anim-65-20-html\outputs\mobile_v9_12.html` (dòng 341–359, JS 68855–69520).

### C7 — Giao diện App 2
- Hai thanh điều hướng chồng nhau: thanh cũ "1 Standardize · 2 Scene · 3 Animation" và thanh 5 workspace. Gộp lại thành một.
- Hộp phím tắt ghi "Look around: Left drag", trong khi chuột trái là xoay quanh (orbit). Sửa nhãn ở cả `en`, `vi`, `zh-CN`.
- "Get from shared library" (App 2) và trang `/library` nên có tìm kiếm tiếng Việt và lọc nhóm.

## Quy tắc chung
- Đọc `docs/DECISIONS.md`, `docs/RETARGET-LESSONS.md` và `CLAUDE.md` trước khi làm.
- Kiểm bằng số trên GLB; giữ nguyên kết quả mẫu Samba: Samba → `a3d_char_30ec…` mặc định có SHA GLB `68fcdb75d373…`.
- Chỉ test trên **bản sao** kho (`cp -r C:/w01-library C:/w01-samples/lib-<việc>`); không ghi vào `C:\w01-library`.
- Không đổi kiểu xuống dòng (`git diff --stat` phải bằng `--ignore-cr-at-eol`). Không regenerate golden. Không commit binary.
- Dữ liệu thử sẵn có:
  - kho `C:\w01-samples\lib-mvp`;
  - project `a67218e8-48cb-443b-a249-9ee131987c84` trong `C:\w01-samples\mvp-projects`;
  - nguồn `C:\w01-samples\mvp-src`.
- Chia subagent model **sol 5.6** bản nhẹ, chạy song song C1/C3/C4/C5/C7. C2 làm sau C1 vì cùng vùng App 3.
- Nhánh `ai1/c1-…` … `ai1/c7-…`. Build, `pnpm typecheck`, test **trên Windows**. **Không tự merge.**

## Lệnh gửi Codex
> Làm các việc **C1–C7** theo `docs/MVP-REMAINING-TASKS-2026-10-24.md` (`main` mới nhất, đã có #85–#95). Ưu tiên C1 (App 2 → App 3 → trả về cảnh
> chạy trọn), C2 (App 3 mở bằng model/xương riêng của nhân vật), C3 (thêm nhân vật vào cảnh không chồng lên nhau). Chia subagent model sol 5.6 bản nhẹ,
> chạy song song C1/C3/C4/C5/C7, C2 sau C1. Kiểm bằng số và ảnh trên bản sao dữ liệu, giữ nguyên SHA Samba, không ghi vào `C:\w01-library`.
> Mỗi việc một nhánh `ai1/c<n>-…`, một PR; build, typecheck, test trên Windows; **không tự merge**; xong báo mã việc + số PR.
> Ngoài ra kiểm lại PR #84 (F1: App 3 three-step workflow) xem có trùng với C1/C2 không và gộp hợp lý.

## Việc chờ (chưa giao, người dùng ghi chú)
- **C8 — Khung "Duyệt animation" của App 1 co giãn được** (ghi 2026-10-24, *chưa code*): cột danh sách chọn animation (từ #105) kéo
  được độ rộng bằng thanh chia, kéo cao/thấp nếu đặt dưới; nhớ kích thước đã kéo (localStorage). Dùng lại kiểu thanh chia của W2
  (khung dọc/ngang kéo được) cho đồng bộ.
- **C9 — App 1: chuyển animation trong "Duyệt animation" chậm > 1 s** (ghi 2026-10-24, *chưa code, chờ lệnh*). Đo: server chỉ
  0,11 s (Xbot) – 0,35 s (wc3)/lượt; phần còn lại do: chờ 250 ms trước khi chạy (`schedulePreview(250)`), hỏi trạng thái mỗi 300 ms
  (`runNow` dùng `wait:false`), không lưu kết quả đã xem, và `pipeline.ts` đọc + parse lại **toàn bộ** file nguồn mỗi lượt (nghi là
  nguyên nhân App 1 hết bộ nhớ 4 GB với nguồn ~400 animation). Hướng sửa: cache asset đã parse (LRU), `wait:true` cho xem thử,
  debounce ~70 ms khi đổi dòng, cache kết quả theo (dòng + tuỳ chọn), tải trước dòng kế. Mục tiêu < 0,3 s; giữ SHA Samba.
- **C10 — App 1: điểm khớp hình tròn + tên xương để so và mapping tay** (ghi 2026-10-24). Trong cả hai khung xem của Workbench
  (Nguồn gốc / Kết quả trên nhân vật đích) và trong bảng "Sửa mapping":
  - mỗi khớp hiện một **điểm tròn**; tuỳ chọn **màu** và **kích thước** (thanh trượt), bật/tắt; khớp đang chọn/đang map đổi màu nổi bật;
  - **ghi tên xương** cạnh điểm (bật/tắt, cỡ chữ, phạm vi: khớp đang chọn / tất cả khớp / chỉ khớp chưa map), để nhìn tên hai bên
    mà ghép đúng vị trí; bấm vào điểm trong khung nguồn = chọn xương nguồn cho ô mapping đang sửa; rê chuột vào ô mapping thì
    sáng điểm tương ứng ở cả hai khung;
  - nhớ tuỳ chọn hiển thị (localStorage).
  - **Tham khảo App 3** (người dùng làm rất kỹ): chế độ "Chỉ đối chiếu" trong
    `apps/studio/public/animation-studio/v1.33.0/index.html` — dòng ~775 (tuỳ chọn Tên xương / trục XYZ / góc / phạm vi / Local-World,
    báo cáo JSON/CSV), CSS `.bone-label` (dòng 3, 195), tạo nhãn `bone-label` (~981, ~1034), `report()` so cặp xương A/B (~2108).
- **C11 — App 1: danh sách xương nguồn trong mapping tay không cuộn được** (người dùng báo 2026-10-24). Trong "Sửa mapping", bấm nút
  mũi tên ở một ô thì danh sách node của model nguồn hiện ra nhưng **không có thanh cuộn**, danh sách dài (vd LoL `zyra.glb` 84 xương)
  bị cắt mất phần dưới, không chọn được. Yêu cầu: danh sách có chiều cao tối đa theo khoảng trống màn hình, cuộn bằng chuột/bánh
  xe/bàn phím, không tràn ra ngoài cửa sổ; thêm ô gõ để lọc theo tên; phím ↑/↓/Enter/Esc. Gộp làm cùng C10 (cùng bảng mapping).
