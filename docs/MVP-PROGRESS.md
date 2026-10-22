# Tiến độ MVP 3 app

Cập nhật: 2026-10-21 · Kế hoạch: [MVP-PLAN-2026-10-21.md](MVP-PLAN-2026-10-21.md) · Claude cập nhật file này mỗi khi kiểm/merge một việc.

**Toàn bộ MVP: `[██████████] 10/10` ✅** — chuỗi App 1 → 2 → 3 → 2 → film BBS FS chạy trên máy (chờ người dùng thử trong game) (nền đã xong: App 1, TASK-1, 2, 4)

Ký hiệu: ✅ đã kiểm và merge · 🔍 Claude đang kiểm · ↩️ trả lại sửa · 🛠️ AI đang làm · ⏳ chờ

## Đã xong trước MVP
| Việc | Trạng thái | Commit |
| --- | --- | --- |
| App 1 MVP (CLI, Workbench, `.bobj` Minecraft20) | ✅ | nhiều commit, mới nhất `a0ba4a2`/`bd9cdca` |
| TASK-1 chuẩn hoá hàng loạt (AI-1) | ✅ 148/148 test, chạy thật 6 file | `9200033` |
| TASK-2 hợp đồng gói shot + bộ kiểm (AI-2) | ✅ 107/107 test, nhận gói thật | `5b190fc` |
| TASK-4 thiết kế MCP cục bộ App 3 (AI-2) | ✅ 26/26 lệnh, tên hàm có thật | `1532dd4` |
| Mã nguồn App 3 vào repo, build khớp từng byte | ✅ | `58afbcc` |

## EPIC-A — App 3 (AI-1) `[██████████] 4/4` ✅
| Việc | Trạng thái | Ghi chú |
| --- | --- | --- |
| A1 TASK-3b sửa UI 1.32.0 | ✅ | Chromium: timeline còn sau Thoát cảnh + tải lại; khung 3D 45%, đồ thị thấy 199 px |
| A2 Mở gói shot | ✅ | 30/30 test; mở gói Xbot thật, Shot panel đúng |
| A3 Xuất gói kết quả | ✅ | Xuất từ Chromium → `validate-result` exit 0; GLB 65 joint không prefix |
| A4 Kèm `.bobj` trong gói | ✅ | BOBJ đọc lại 20 xương; sửa tay đã bổ sung ở A5 (PR #2) |

## EPIC-B — App 2 (Codex tài khoản 2) `[██████████] 4/4` ✅
| Việc | Trạng thái | Ghi chú |
| --- | --- | --- |
| B1 Nhập GLB + manifest App 1 | ✅ | UUID v8 cho Motion, dùng lại khi cùng hash, alias tên xương |
| B2 `shot.export` | ✅ | Gói 2 nhân vật qua bộ kiểm TS + Python |
| B3 `shot.result.import` | ✅ | Motion mới, một bước Undo, REVISION_CONFLICT |
| B4 CLI + MCP | ✅ | Python 113/113 |

## Ráp nối — Claude `[██████████] 2/2` ✅
| Việc | Trạng thái | Ghi chú |
| --- | --- | --- |
| C1 Đưa App 3 mới vào Studio, nối shot.export ↔ App 3 ↔ shot.result.import | ✅ | App 3 1.32.0 trong Studio; nút Mở shot / Trả kết quả (`7aa1602`) |
| C2 Chạy thử trọn chuỗi (1 cảnh, 2 nhân vật) + xuất film BBS FS | ✅ | Sửa tay 60° về cảnh đúng 60.0°, Undo/Redo đúng; film.export ZIP 750 KB, nativeReadback, 2 actor, 130 pose track |

## Đợt 3 (ngoài MVP, AI-1 / Codex)
| Việc | Trạng thái | Ghi chú |
| --- | --- | --- |
| A5 `.bobj` App 3 bỏ xoắn + khoá tay | ✅ PR #2 | Lux Attack1: xoắn 116.6° → 0°, khớp App 1 |
| D6 sửa 2 lỗi lint Workbench | ✅ PR #4 | `pnpm lint` exit 0, 13/13 test Workbench |
| D5 chọn đoạn Action + huỷ | ✅ PR #15 | 152/152; Samba `--range 2:5` → 3.000 s |
| D4 thân trên Minecraft20 | ✅ PR #16 | gập p95 76° → 45° (gốc 43°), xoắn 33° → 27° |
| D1 khoá chân IK | ✅ PR #17 (thử nghiệm, mặc định tắt) | trượt Samba 3.26 → 0.09 m; còn nâng chân 8 cm → việc D1b |
| L3+L4 CI GitHub Actions + `pnpm test:all` | ✅ PR #18 | CI xanh trên GitHub; test cần mẫu ngoài tự bỏ qua |
| H3 `scene.export.bbsFilm` → `<cảnh>.bbs-film.zip` | ✅ Claude | Mặc định toàn cảnh; chạy thật Java 17 + Blender 4.2: 2 actor, 2 camera, 130 pose track, đọc lại native |
| H1 `scene.export.glb` GLB toàn cảnh | ✅ PR #19 | C2 mở trong Blender 4.2: 2 armature, 1 camera; tay A lệch B 60.0° ở frame 12 như `scene.evaluate` |
| H2 `scene.export.blend-fbx` (.blend + FBX) | ✅ PR #21 | C2: .blend và FBX mở lại đúng 60.0° ở frame 12 (FBX nhập với Animation Offset = 0) |
| G1 `scene.layout.read` (AI đọc cảnh) | ✅ PR #22 | C2 frame 12: A trỏ Motion App 3, B Action gốc, t=0.4 s; không đổi revision |
| G2 `scene.layout.preview/apply` (AI xếp nhân vật) | ✅ PR #24 (lấy riêng G2) | C2: A trái B 1.5000 m, nhìn nhau 0.000°, Undo/Redo đúng; còn chặn nhân vật có key App 3 → G2b |
| G2b xếp lại nhân vật đã qua App 3 | ✅ PR #28 | C2 giữ key App 3: A trái B 1.5000 m, nhìn nhau 0.000° ở frame 0/12/23; key placement cập nhật; Undo trả cả node lẫn key |
| G3 `camera.framing.preview/apply` (AI đặt camera) | ✅ PR #25 (lấy riêng G3) | C2: 130 xương trong khung (max 0.74) frame 0/12/23; toàn > trung > cận; còn camera thấp dưới đất, cận chưa phải cận mặt → G3b |
| G3b camera đúng cỡ cảnh, không dưới sàn | ✅ PR #29 | Thử với Herobrine (Minecraft20) + Gỗ Xưa (Mixamo65): camera thấp y ≥ 0.30 m; toàn > trung > cận; trung cắt đùi, cận cắt bụng |
| E1 App 3 đọc qua MCP (read_keyframes, analyze_motion, get_scene_context) | ✅ PR #30 | Studio 107/0, App 3 test 51/0 (sửa test gọi python trên Windows), Python OK, 434/434 id giữ nguyên |
| E2 App 3 blocking qua MCP (preview → apply, một bước Undo) | ✅ PR #31 | Chạy thật Chromium: Python MCP → broker → App 3 Director qua (78 s); sửa MCP ghi UTF-8 trên Windows; build App 3 khớp từng byte; 434/434 id |
| E3 App 3 chỉnh nhịp/đường cong qua MCP | ✅ PR #32 | App 3 test 81/81, Chromium MCP thật qua (84 s), build khớp từng byte, typecheck toàn workspace sạch |
| E4 App 3 xuất BOBJ/FBX + mở/xuất gói shot qua MCP | ✅ PR #33 | Chromium MCP thật qua; App 3 92/92; build khớp từng byte |
| E5 kịch bản "vẫy tay phải 2 lần rồi chống nạnh" qua MCP thật | ✅ PR #34 | Chạy thật: 2 chu kỳ, biên độ 50°, tay cao hơn đầu 0.34 m, cuối tay phải chống hông (cách hông 0.15 m); tay trái giữ nguyên |
| Silhouette App 2 (nút + Shift+S + scene.render) | ✅ Claude | Bật/tắt trong Studio thật; tắt trả nguyên vật liệu; builder 559/0, Studio 107/0 |
| Silhouette App 3 + đồng bộ App 2 → App 3 | ✅ PR #41 | Chromium thật: pixel ngoài 2 màu 0.57%, tắt trả ảnh y hệt (0 kênh khác), 12 lần bật/tắt không đổi project, App 2 bật → App 3 bật; 434/434 id |
| J1 hợp đồng GLB v1.1 (xương phụ `X_*`) + bộ kiểm TS/Python | ✅ PR #42 | retarget 165/165; GLB v1.0 thật (Samba, BloodElf, 85 action MC) vẫn hợp lệ với bộ kiểm mới |
| J3a App 2 hiện/chỉnh xương phụ | ✅ PR #43 | builder 563, Studio 109/0; đuôi 30° sai 0.019°, hàm pose 20° + Undo; A/B 120 khung Tập 15: 0 pixel khác |
| Tập 15 một cảnh liền + film BBS FS | ✅ Claude | 20 shot 73 s, previz Shorts 9:16; 10 gói film nativeReadback (chia theo giới hạn worker); chưa thử trong game |
| G4 kịch bản AI dựng cảnh qua MCP | ✅ PR #26 | Chạy thật trên máy: MCP G1→G2→G3 + 2 ảnh render; sai số vị trí 0 m, hướng ~0°, khung 0.777 |
| H4 test mở lại GLB → .blend/FBX trong Blender | ✅ Claude | 2 nhân vật + emote_floss + G2: 48 điểm xương khớp `scene.evaluate` (sai số < 0.005 mm); lệch FBX 1 frame bị bắt (19 cm) |
| L1 build Studio EPERM trên Windows | ✅ không tái hiện | `pnpm --filter @topview/3d-studio build` thành công 2026-10-21 |
| D1b khoá chân không nâng chân | ✅ PR #23 (thử nghiệm, mặc định tắt) | Samba: cổ chân trượt 3.26/3.05 → 0.000 m, cao 0 cm, giữ 100% khung chạm; điểm thấp nhất 2.23/2.40 → 1.14/1.18 m (nguồn tự trượt 2.12/2.41) |
| D7 cổ tay (dịch chuyển cục bộ của cổ tay) | ✅ PR #47 | 6 mẫu thật GLB giống hệt từng byte so với trước (Samba giữ nguyên); chỉ tác động khi cổ tay nguồn có dịch chuyển — **độ lệch xoay cổ tay chưa được đo/sửa** |
| D3 `--mode model` cho rig không phải Mixamo | ✅ PR #47 | Lux/Garen (LoL), SeaGiant (WoW), Female (CC), Sion: PASS, sai số rest ≤ 1e-6 m, ảnh Blender biến dạng đúng; WC3 không có skin → BLOCKED đúng |
| J2/J4 App 1 giữ xương phụ, Minecraft20 báo bỏ | ✅ PR #44 | retarget 169/169; 10 đầu ra thật giống hệt từng byte; giữ validator J1 khi gộp |
| J3b App 3 xương phụ | ✅ PR #45 | Chromium thật: hiện cây xương "· phụ", key qua broker, xuất/tải lại giữ; 434/434 id; đã nhúng bản build vào Studio |
| I2 thư viện App 5 (lõi) | ✅ PR #46 | Nhập thật Samba/Michelle/Minecraft; sửa giữ `.minecraft20.bobj`; I3–I5 (UI, nối App 2/3, MCP) còn mở |

## Đang giao (2026-10-21)
| Ai | Việc | Issue |
| --- | --- | --- |
| Codex phiên 1 | D5 Workbench chọn đoạn + huỷ | #5 |
| Codex cloud | D1b độ nâng chân ≤ 1 cm | PR #17 |
| Codex cloud | EPIC-G G2–G4: AI xếp nhân vật + camera qua MCP | #9 |
| ChatGPT Plus | Tìm hiểu định dạng film/cảnh BBS FS, `.scene.bobj` | #10 |
| Claude | C1–C2 ráp nối + chạy trọn chuỗi | — |

## Cần người dùng
| Việc | Trạng thái |
| --- | --- |
| Chốt chính sách vị trí khi sửa ở App 3 | ✅ `placementKeys`, giữ root Action (2026-10-22) |
| Thử `.bobj` / film trong BBS FS thật | ⏳ |
