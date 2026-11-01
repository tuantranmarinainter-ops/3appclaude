# Task tổng: sửa toàn bộ backlog mở của App 2 (2026-11-01)

> Người dùng giao 2026-11-01 ("xuất task sửa all backlog"). Giao Codex. Subagent dùng model **"sol 6.1" bản nhẹ**.
> Chi tiết từng mục (số đo, file, đề xuất): `docs/BACKLOG-2026-10-25.md` mục **B<n>**. Đọc mục đó trước khi sửa.
> **Mỗi đợt một nhánh + một PR** (dễ kiểm), theo thứ tự đợt; **không tự merge**. Báo bằng số đo thật, ghi rõ NOT_RUN.

## Nền để bắt đầu (quan trọng)
- Dựa trên nhánh **`claude/hub8-174-176`** (đã đẩy lên GitHub) — bản Claude đã kiểm, test:all 0 FAIL, gồm:
  PR #174 (B34/B19), PR #176 (B35–B40), sửa junction kho, **nút "Khoá khung 3D" + sửa B2**, **nút "Debug"** (ghi thao tác).
  Nhánh này **chưa gộp main mới** (#184 App 3 v1.34, #186, #187): **gộp `main` vào trước** rồi mới làm, giải xung đột,
  chạy lại test:all.
- PR #175 bị #176 thay. PR #177 (B43 của Codex) chưa kiểm: gộp vào đợt 4 nếu còn dùng được.
- Đường camera BBS có task riêng chi tiết: `docs/CAMERA-BBS-TASK-2026-11-01.md` (B59) — làm trong **đợt 1**.

## Vai trò người dùng
Người làm phim Minecraft một mình, hay điều khiển từ điện thoại, UI tiếng Việt, nền tối. Quy trình: chọn động tác từ
thư viện → xếp cảnh App 2 (Đen, Gỗ Xưa…) → chỉnh camera → bấm **"Xuất và cài vào game"** → xem film trong BBS FS 2.7.
Mọi chữ hiển thị phải dễ hiểu (mức học sinh lớp 5), không bắt người dùng làm bước thừa.

## Đợt 1 — Lỗi nặng làm hỏng dữ liệu / chặn xuất (làm trước)
| Mã | Việc |
| --- | --- |
| B46 | Thanh **tiêu cự** camera làm FOV dao động 120 ↔ 78,83 và **tự lưu > 1.000 lần** (rev 251 → 1344 / 25 phút). Sửa vòng lặp; kéo/thả xong không lưu thêm. |
| B44, B58 | **Camera của shot bị xoá** khỏi project (khi chỉnh timeline / lái camera WASDQE, hay bấm E) dù người dùng không xoá. Tái hiện bằng nút Debug, sửa gốc, test 30 s lái camera + thao tác timeline → node camera + shot còn nguyên. |
| B32 | Tách shot → **key camera nướng bị mất** sau vài lần lưu. |
| B1 | Xoay/kéo/lăn khung nhìn làm **đổi camera của shot** (khi đang xem qua camera). Thêm trạng thái rõ "đang lái camera shot" + nút khoá camera. |
| B56 | Xuất bị **huỷ ngầm** khi revision đổi trong lúc chọn thư mục; chỉ huỷ khi nội dung xuất đổi, và báo nổi bật. |
| B59 | **Camera không chạy trong BBS** — làm theo `docs/CAMERA-BBS-TASK-2026-11-01.md` (clip idle "MCP timeline" ở (0,0,0) chồng clip shot, xuất đủ chuyển động, điểm neo, nhiều shot, fov theo 16:9). |

## Đợt 2 — Làm lại bảng "Xuất Film BBS FS" (B47–B57, kèm B29, B33)
Theo **B54**: 3 bước ① *Game* → ② *Nội dung* → ③ *Vị trí trong game* → một nút lớn **"Xuất và cài vào game"**;
phần ít dùng gập trong **"Tuỳ chọn nâng cao"**.
| Mã | Việc |
| --- | --- |
| B47 | "Film hiện tại" → **"Shot hiện tại"** (người dùng chốt); "Cả tập" đổi tên rõ ("Nhiều film theo shot trong project này"), ẩn khi project chỉ có 1 shot. |
| B48 | Mặc định **tick mọi nhân vật trong shot**, nút Chọn tất cả/Bỏ chọn, cảnh báo nhân vật có clip mà không chọn. |
| B49 | Tỉ lệ khung hiện **16:9 / 9:16 / 1:1 / 4:3 / 2.39:1** (danh sách chọn), không hiện 1.7777. |
| B50 | Thư mục game: nút **"Chọn…"**, chọn nhầm thư mục con (`config\bbs\…`, `saves`, `mods`) thì tự lùi về gốc game, **nhớ** + danh sách gần đây. |
| B51 | "Đọc world" → tự đọc khi thư mục hợp lệ, nhãn "Tìm world trong game", hiện "N world · BBS 2.7 ✓ · AAA ✓/✗"; sửa lỗi hiển thị. |
| B29 | **Nhớ world** theo thư mục game. |
| B52 | Ghi chú "Gói ZIP" dễ hiểu (câu gợi ý có sẵn trong B52). |
| B53 | Sửa UI ô "Làm tròn về giữa block" và "Điểm gốc trong cảnh", thêm 1 câu giải thích mỗi ô. |
| B55 | Đã có thư mục game + world → **không hỏi folder**; ZIP lưu trong project, link "Mở thư mục chứa ZIP"; "Lưu ZIP ra chỗ khác…" vào nâng cao. Ghi rõ ZIP có `.dat` bên trong; tuỳ chọn "Chỉ lưu file .dat". |
| B57 | "Chọn nhanh khoảng shot" hiện shot đang khớp, báo "Đã đặt khoảng 0–149 theo shot_01"; ẩn khi thừa. |
| B33 | Cài khi **game đang chạy** (java/javaw dùng thư mục game) → cảnh báo/chặn, gợi ý thoát world. |

## Đợt 3 — Gán animation & timeline
| Mã | Việc |
| --- | --- |
| B45, B11, B5 | Bảng Gán: mặc định **khung theo đầu phát**; khung bị chiếm → gợi ý khoảng trống gần nhất / "Đặt sau clip cuối"; **hiện lỗi server** bằng tiếng Việt ngay dưới nút. |
| B7 | Xoá / thay clip rõ ràng (bảng Gán "Thay clip đang chọn"; timeline Delete + menu chuột phải). |
| B42 | **Nhân bản clip**: đặt vào khoảng trống trong shot hoặc báo không còn chỗ; menu chuột phải tự lật khi sát mép. |
| B9, B20 | Clip dài hơn động tác: lựa chọn rõ **Lặp / Giữ khung cuối / Giãn chậm**; App 3 "Mở shot từ cảnh" không báo lỗi khi clip đã kéo dài. |
| B13 | **Space = phát/dừng** ở mọi timeline (khi không gõ chữ). |
| B14 | Nút **ghim** nhân vật lên đầu timeline. |
| B4 | Hiện cùng lúc 3 thước **giây / frame / tick** (bật tắt từng thước). |
| B12 | Kéo mốc cắt shot tự bắt **lưới 20 tick** / cảnh báo ngay. |
| B3 | Nhóm "Hậu cảnh": nút **ẩn/hiện** rõ cho nhóm và từng mục. |
| B6 | Clip cũ sau "Nối thư viện" (C25) **sửa được** (không còn PROFILE_MISMATCH). |

## Đợt 4 — Tốc độ
| Mã | Việc |
| --- | --- |
| B43 | Mở Shot 01 < 2 s, Thư viện → App 2 < 1,5 s: khử request trùng (`characters=1`, `raw=1`, `charId=` gọi 2 lần), cache `modelCharacter` theo fingerprint, VFX preview tải sau, Thư viện ↔ App 2 không reload trang. Xem/gộp PR #177. |
| B26 | Xác nhận hết polling `characters=1` (đo 60 s). |
| B25 | Hai server dev không dùng chung `.next-dev` (distDir theo cổng). |
| — | Đề xuất người dùng: chạy App 2 bằng bản **production** (`next build` + `next start`) — thêm script/launch và đo so với dev. |

## Đợt 5 — Nhân vật, chiều cao, bám sàn
| Mã | Việc |
| --- | --- |
| B24 | Verity (Gỗ Xưa) **không có clip** lún 0,6 block (Root t.y −0,65) — App 2 và film. |
| B28 | Kiểm bám sàn cho **Minecraft20** dùng đáy khối cẳng chân. |
| B10 | Verity → Minecraft20 cao hơn sàn 15 cm. |
| B31 | "Cập nhật chiều cao" sau link-nodes **nhân chồng tỷ lệ cũ** (0,9 × 0,886). |

## Đợt 6 — Linh tinh
| Mã | Việc |
| --- | --- |
| B8 | Bảng "Phím tắt" hiện lại sau khi tải trang (khoá localStorage theo origin/cổng). |
| B16 | Game sập khi bấm replay VFX lúc **không có AAA** (`FormUtilsClient.getRenderer` null) — kiểm lại sau khi đã có AAA Forge; nếu còn thì preflight chặn/cảnh báo. |
| B15 | Kiểm lại (đã có S2 điểm neo F3+C) — đóng nếu không tái hiện. |

**Không làm:** B41 (chờ người dùng chỉ rõ động tác sai). **Đã xong**, chỉ kiểm không hồi quy: B2, B17, B19, B21–B23, B27, B30, B34–B40.

## Kiểm (mỗi PR)
- Test cho từng mục (đơn vị + Chromium khi là UI), số đo trước/sau cho mục tốc độ và mục B46/B44/B58.
- `pnpm --filter @topview/3d-builder build`, `pnpm typecheck`, `pnpm lint`, **`pnpm test:all` đủ bộ** (cả retarget, App 3), Python.
- UI: tiếng Việt, nền tối, chụp ảnh trước/sau trong PR.
- Không sửa `packages/retarget` (trừ test), không đổi golden, không commit binary/kho thật/project thật. Phần trong game
  BBS thật: **NOT_RUN** (Claude cài film khi game tắt và người dùng xem).

## Ranh giới
Repo https://github.com/tuantranmarinainter-ops/3appclaude. Nhánh gợi ý `codex/backlog-d1-data` … `codex/backlog-d6-misc`,
mỗi nhánh tách từ đợt trước (hoặc từ `claude/hub8-174-176` đã gộp main cho đợt 1).
