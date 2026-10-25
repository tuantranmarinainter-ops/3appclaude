# App 2 gán animation, timeline, khung nhìn nhân vật + Thư viện (2026-10-25)

Người dùng chốt 2026-10-25 sau khi test Tập 15 (project `7090a526-e0a1-4043-be34-18426b8cf03f` trong
`S:\Claude\w01-samples\tap15v3\projects`, kho thật `S:\Claude\w01-library`). Làm **sau hoặc song song** đợt
[`E2E-FIX-TASKS-2026-10-25.md`](E2E-FIX-TASKS-2026-10-25.md) (E1–E11); chỗ phụ thuộc ghi rõ ở từng việc.

Nguyên tắc người dùng chốt: phần mềm **tập trung vào nhân vật**, hậu cảnh là phụ. Một **vai** (Gỗ Xưa, Hero, Đen, Gà, Người bí ẩn…) chỉ
có một nhân vật trong Thư viện; trong cảnh **mỗi shot một node** cho vai đó (giữ như storyboard), mọi node đều trỏ về cùng vai.

## Nhóm A — Gán animation cho nhân vật (ưu tiên 1)

### C25 — Nối node storyboard với nhân vật thư viện (làm trước N1)
- **Hiện tại:** Tập 15 có node theo shot (`go 01_1`, `go 04_1`… đều là Gỗ Xưa; tương tự `hero xx`, `den xx`, `ga xx`, `mystery xx`) không có
  `metadata.libraryCharacterId`, dùng model tạm (Gỗ Xưa storyboard = Man builtin tô xanh, Mixamo65 66 xương; Gỗ Xưa thư viện = bộ xương
  gốc Verity 85 xương có Jaw). "Lấy từ kho…" thêm một nhân vật mới (`Gỗ Xưa_1`) không có trong khung hình → người dùng gán nhầm chỗ.
- **Yêu cầu:** lệnh "Nối với nhân vật thư viện…" (chọn một hoặc nhiều node, hoặc "tất cả node tên `go *`"): thay model bằng base model riêng
  của nhân vật thư viện, giữ vị trí/hướng/khung shot từng node, gắn `libraryCharacterId`; clip cũ chuyển sang xương mới (dùng chuyển đổi
  N1b) hoặc thay bằng Nháp cùng tên trong bộ của nhân vật, báo rõ clip không chuyển được; một bước Hoàn tác. Tên hiển thị
  **"Gỗ Xưa · Shot 01"** ở timeline, cây Đối tượng và mọi ô chọn nhân vật. "Thêm vào cảnh App 2" khi project đã có node của vai đó thì hỏi
  "Dùng node có sẵn" / "Thêm lần xuất hiện mới", không tự tạo trùng.
- **Đạt khi:** trên **bản sao** Tập 15, nối toàn bộ `go *` → Gỗ Xưa, `hero *` → Hero, `den *` → Đen, `ga *` → Gà, `mystery *` → Người bí ẩn;
  `scene.evaluate` không có `SKELETON_EVALUATION_UNAVAILABLE`; ảnh trước/sau cùng khung từng shot; Hoàn tác trả nguyên project (so JSON).

### N1 — Nút "Gán animation" trong cột trái App 2
- Nút mới ở cột trái Dựng cảnh, **ngay dưới "Chuyển động máy"**, viền màu nổi bật (theo C23).
- Chọn một nhân vật trong cảnh (hoặc trong cây Đối tượng) → bấm "Gán animation" → bảng chọn có 3 tab:
  **Của nhân vật này** (bộ Nháp/Đã chỉnh/Đã duyệt của vai), **Của nhân vật khác** (bộ của vai khác), **Tự do** (kho dùng chung).
  Tìm tiếng Việt/Anh, lọc nhóm, ★ Yêu thích lên đầu (C24), xem thử video/3D 1:1 (C22).
- Chọn động tác → gán **thẳng vào node đang chọn**, đặt tại chặn đầu của shot (N4) hoặc khung hiện tại (tuỳ chọn), không tạo nhân vật mới.
  Node chưa nối thư viện → mở C25 cho node đó trước.
- Nút phụ **"Mở trong Thư viện"**: mở `/library?unified=<project>&assignTo=<nodeId>` với vai đã chọn sẵn; mỗi động tác có nút
  "Gán cho Gỗ Xưa · Shot 01" rồi quay lại cảnh, timeline cuộn tới clip mới (C27).
- **N1b — tự chuyển xương:** người dùng chốt: **mọi nhân vật đã chuẩn hoá dùng được animation của nhau, tự chuyển qua lại giữa Mixamo65 và
  Minecraft20** (kể cả nhân vật Verity giữ bộ xương gốc — đi qua ánh xạ Mixamo65 của App 1). Dùng lại solver App 1
  (`packages/retarget`: Mixamo65 → Minecraft20 V9.12 ngược, `.bobj` Minecraft20 → Mixamo65, ánh xạ Verity), kết quả lưu thành Nháp mới trong
  bộ của vai nhận (giữ uuid gốc làm `parentUuid`), cảnh báo chất lượng ngắn gọn; không được làm đổi SHA Samba.
- **Đạt khi:** gán được cho Gỗ Xưa · Shot 01: (a) động tác của chính Gỗ Xưa, (b) động tác của Hero (Minecraft20 → Verity), (c) động tác kho
  chung; Hero nhận động tác của Gỗ Xưa (Verity → Minecraft20); mỗi ca có clip đúng node, phát được, ảnh chụp; test store + test chuyển xương.

### C27 — Thấy ngay clip vừa gán
Sau khi gán: timeline tự cuộn tới dòng nhân vật, phóng tới khoảng clip, nháy sáng clip mới; có bộ lọc "Chỉ nhân vật đang chọn".

## Nhóm B — Timeline App 2 (ưu tiên 2)
- **N2 — Phóng to/thu nhỏ:** Ctrl + lăn chuột quanh con trỏ, thanh zoom, nút "Vừa shot" và "Vừa toàn bộ"; nhìn rõ clip 18 khung.
- **N3 — Đơn vị:** chọn **giây / frame (theo fps project, 30) / tick (20 Hz, đơn vị BBS)** cho thước, ô nhập khung và nhãn clip; nhớ lựa chọn.
- **N4 — Chặn đầu / chặn đuôi kiểu DaVinci:** hai mốc In/Out kéo được (phím I/O). Chọn một shot → tự đặt In = đầu shot, Out = cuối shot (shot
  4 s → 0–4 s tương đối shot). Phát lặp trong khoảng; "Mở shot từ cảnh" (App 3) và Xuất film BBS mặc định dùng khoảng này, tự làm tròn về lưới
  20 tick (khớp E2/E10).
- **Đạt khi:** test đơn vị/zoom; trên Tập 15 chọn Shot 01 → In/Out đúng độ dài shot, xuất film và mở App 3 dùng đúng khoảng.

## Nhóm C — Khung nhìn tập trung nhân vật (ưu tiên 3)
- **N5 — Gom hậu cảnh:** gom mọi prop/hậu cảnh (`set_*`…) thành nhóm **"Hậu cảnh"** trong cây Đối tượng, một nút ẩn/hiện cả nhóm; kèm nút
  **"Chỉ hiện nhân vật"** trên khung 3D (phím tắt) — chỉ đổi cách xem, **không ghi project**, không ảnh hưởng render/xuất (thay C26).
- **N6 — Sàn UV checker:** sàn có thể hiển thị dạng **UV checker board**, nhiều tuỳ chọn: ô cờ đen/trắng, ô màu, lưới có số toạ độ, cỡ ô
  (0,5 / 1 block…), độ mờ; trục X đỏ, Z xanh; bật/tắt; nhớ lựa chọn. Chỉ là hiển thị, không ghi vào project/film.

## Nhóm D — Thư viện (App 5) và nút chuyển app (ưu tiên 4)
| Mã | Việc |
| --- | --- |
| C20 | Danh sách động tác có thanh cuộn; các khung (danh sách / chi tiết) cuộn riêng, thanh chia kéo co giãn, nhớ kích thước |
| C21 | Bấm vào bất kỳ chỗ nào của thẻ động tác là chọn và hiện chi tiết (trừ nút con) |
| C22 | Khung xem 3D động tác/nhân vật tỉ lệ 1:1 |
| C23 | Mọi nút chuyển sang app khác (thanh 5 workspace, "Thêm vào cảnh App 2", "Gán animation", "Mở Chuẩn hoá", mở App 3, "Trả kết quả về cảnh"…) có **viền màu riêng thật dễ thấy**, thống nhất 5 app; "Thêm vào cảnh App 2" có cả ở danh sách động tác / "Bộ của nhân vật" |
| C24 | Nút ☆/★ từng động tác + tab **Yêu thích**, dùng trường `favorite` (F1/C18), thống nhất với dấu sao App 1 |

## Quy tắc chung
- Đọc `docs/DECISIONS.md`, `docs/RETARGET-LESSONS.md`, `CLAUDE.md` trước. Giao diện mặc định tiếng Việt, App 1 nền tối.
- Giữ SHA GLB Samba mặc định `68fcdb75d373…`; mọi sửa chuyển xương phải đo số trên GLB (RETARGET-LESSONS).
- Chỉ test trên **bản sao**: kho `S:\Claude\w01-samples\lib-<việc>` (chép từ `S:\Claude\w01-library`), project Tập 15 chép sang thư mục riêng;
  **không ghi** vào `S:\Claude\w01-library` hay `S:\Claude\w01-samples\tap15v3`.
- Không regenerate golden, không commit binary, không đổi kiểu xuống dòng. Mỗi việc một nhánh `ai1/<mã>-…`, một PR đích `main`; build,
  `pnpm typecheck` toàn workspace, test trên Windows; **không tự merge**.
