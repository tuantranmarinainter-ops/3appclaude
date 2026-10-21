# Toàn bộ việc còn lại — chia thành đầu việc lớn (2026-10-21)

Mỗi EPIC là một đầu việc giao được cho **một** AI, gồm các việc nhỏ nộp từng zip (`<mã>_<tên ngắn>.zip` + `REPORT.md`).
Cột "Vùng file" là chỗ EPIC đó được sửa: **hai EPIC chạy song song không được trùng vùng file.** Claude kiểm/merge,
cập nhật `docs/MVP-PROGRESS.md`. Quy tắc chung: `docs/AI-TASKS-2026-10-21.md`; App 1 đọc thêm `docs/RETARGET-LESSONS.md`.

## Tổng quan
| EPIC | Nội dung | Ưu tiên | Phụ thuộc | Vùng file | Cỡ |
| --- | --- | --- | --- | --- | --- |
| **A** | App 3 nhận/trả gói shot (đang làm, AI-1) | MVP | — | `animation-studio/.../src/` | 4 việc |
| **B** | App 2 nhập App 1, xuất/nhận gói shot (đang làm, AI-2) | MVP | — | `editor/packages/builder`, `editor/apps/studio/{src,app/api,test}`, `agent/unified_*` | 4 việc |
| **C** | Ráp nối + chạy trọn chuỗi (Claude) | MVP | A3, B3 | `apps/studio/public/animation-studio`, `animation-creation/`, `host-bridge.js` | 2 việc |
| **D** | App 1 hoàn thiện chất lượng | Sau MVP | — | `editor/packages/retarget` | 6 việc |
| **E** | App 3: AI điều khiển qua MCP cục bộ | Sau MVP | A, C | `animation-studio/.../src/`, `host-bridge.js`, `agent/app3_mcp*` | 5 việc |
| **F** | App 3: giao diện đợt 2 (Blocking → Tinh chỉnh → Xuất) | Sau MVP | A | `animation-studio/.../src/` | 4 việc |
| **G** | App 2: AI xếp cảnh và camera qua MCP | Sau MVP | B | `editor/apps/studio/src`, `agent/unified_*` | 4 việc |
| **H** | App 2: xuất toàn cảnh GLB / FBX / `.blend` / `.scene.bobj` | Sau MVP | B | `editor/apps/studio/src`, `agent/` (Blender) | 4 việc |
| **I** | App 4: kho animation dùng chung | Sau MVP | D1 (batch đã có) | `editor/packages/library` (mới), `docs/LIBRARY-CONTRACT.md` | 5 việc |
| **J** | Rig mở rộng (Mixamo65 + xương phụ: miệng, cánh…) | Sau MVP | D | `editor/packages/retarget`, hợp đồng GLB | 4 việc |
| **K** | Nghiệm thu BBS FS / game | Song song | A, C | không sửa code (người dùng chạy game) + `docs/` | 3 việc |
| **L** | Hạ tầng: build, lint, test tự động | Song song | — | `editor/` cấu hình, `.github/workflows` | 4 việc |

Chia việc gợi ý: A ∥ B (đang chạy) → C (Claude) → hai AI nhận một trong các cặp không trùng vùng file:
**D ∥ G**, **E ∥ H**, **F ∥ I** (F và E cùng vùng App 3 nên không chạy song song), J sau D. K và L chen vào bất cứ lúc nào.

---

## A — App 3 nhận/trả gói shot (MVP) — chi tiết ở `docs/MVP-PLAN-2026-10-21.md`
A1 sửa UI 1.32.0 · A2 mở gói shot · A3 xuất gói kết quả · A4 kèm `.bobj` trong gói.

## B — App 2 ↔ App 1 / App 3 (MVP) — chi tiết ở `docs/MVP-PLAN-2026-10-21.md`
B1 nhập GLB + manifest App 1 (alias tên xương không prefix) · B2 `shot.export` · B3 `shot.result.import` · B4 CLI + MCP.

## C — Ráp nối (Claude)
C1 đưa App 3 mới vào Studio, nối nút mở/xuất gói với broker · C2 chạy trọn chuỗi 1 cảnh 2 nhân vật + xuất film BBS FS.

## D — App 1 hoàn thiện chất lượng
| Việc | Nội dung | Đạt khi |
| --- | --- | --- |
| D1 | Khoá chân bằng IK (foot lock) ở các khung chạm đất, dùng số đo chạm đất đã có (`cli/quality.ts`) | `FOOT_SLIDE` Samba giảm < 0.3 m, Mixamo không đổi tư thế ngoài khung chạm |
| D2 | Ghép ngón tay LoL và WoW (như đã làm cho WC3) | Số khớp ghép tăng, tay nắm theo nguồn trên mẫu thật |
| D3 | `--mode model` cho rig không phải Mixamo: khớp rig65 theo model nguồn + chuyển skin (`MODEL_NOT_REFIT`) | GLB có mesh mở đúng trên 3 mẫu LoL/WC3/WoW |
| D4 | Minecraft20: giảm xô lệch thân trên (`body→low_body`) | p95 gập ≈ emote gốc (43°) |
| D5 | Workbench: chọn đoạn Action (từ–đến giây), nút huỷ lượt chạy | Có test + ảnh |
| D6 | Sửa 2 lỗi lint có sẵn ở `workbench/public/app.js`, `viewer.js` | `pnpm lint` qua phần retarget |

## E — App 3: AI điều khiển qua MCP cục bộ (theo `docs/APP3-MCP-DESIGN.md`)
| Việc | Nội dung |
| --- | --- |
| E1 | Đường truyền: MCP Python → broker Studio → `host-bridge.js` → `studio_bridge.js`; lệnh chỉ đọc trước (`read_keyframes`, `analyze_motion`, `get_scene_context`) |
| E2 | Blocking: `create_blocking`, `set_pose`, `insert_breakdown`, `set_marker`, `set_idea` (preview → apply theo revision, một bước Undo) |
| E3 | Chỉnh nhịp/mượt: `retime_segment`, `set_hold`, `smooth_motion`, `edit_keyframes`, `edit_curves` |
| E4 | Xuất và gói shot qua MCP: `export_animation`, mở/xuất gói shot (dùng A2/A3) |
| E5 | Kịch bản thử: AI làm blocking một động tác từ mô tả chữ, có ảnh trước/sau |

## F — App 3: giao diện đợt 2
| Việc | Nội dung |
| --- | --- |
| F1 | Ba bước theo luồng: Blocking → Tinh chỉnh → Xuất; mỗi bước chỉ hiện nhóm điều khiển cần dùng |
| F2 | Panel phải gọn: gom Transform/IK/Animation Lab; khối thu gọn nhớ trạng thái |
| F3 | Chế độ "Shot" chỉ xem (khi mở gói từ App 2): khoá phần dựng cảnh, hiện camera shot |
| F4 | Đo lại: số điều khiển hiện cùng lúc ở màn chính giảm ≥ 40% (hiện 160), vẫn đủ 434 id |

## G — App 2: AI xếp cảnh và camera qua MCP
| Việc | Nội dung |
| --- | --- |
| G1 | Lệnh MCP đọc cảnh: nhân vật, vị trí, clip, camera, khoảng frame |
| G2 | Lệnh xếp nhân vật theo mô tả (cỡ cảnh, vị trí tương đối, hướng nhìn), preview → apply, Undo |
| G3 | Lệnh đặt camera theo cỡ cảnh/góc máy (toàn, trung, cận; ngang, cao, thấp) có khung bám nhân vật |
| G4 | Kịch bản thử: một phân cảnh 2 nhân vật từ mô tả chữ, có ảnh render |

## H — App 2: xuất toàn cảnh
| Việc | Nội dung |
| --- | --- |
| H1 | Bake timeline cảnh từng frame (bộ lấy mẫu xương/camera có sẵn) → GLB toàn cảnh (nhân vật, prop, camera) |
| H2 | Blender không giao diện: GLB → `.blend` và FBX |
| H3 | `.scene.bobj` (chờ người dùng chốt định dạng) |
| H4 | Test mở lại file xuất trong three.js/Blender, so số khung và vị trí |

## I — App 4: kho animation dùng chung (theo `docs/LIBRARY-CONTRACT.md`, cần người dùng chốt 4 điểm mở)
| Việc | Nội dung |
| --- | --- |
| I1 | Chốt hợp đồng kho: thư mục ngoài repo, cấu trúc pack/Action/rig, `meta.json` |
| I2 | `packages/library`: nạp từ đầu ra `normalizeBatch` (App 1), chỉ mục, tìm theo tên/tag/rig |
| I3 | UI kho: duyệt, xem thử, gắn tag |
| I4 | App 2 và App 3 đọc kho (thay cho chọn file lẻ) |
| I5 | Lệnh MCP cho kho |

## J — Rig mở rộng
| Việc | Nội dung |
| --- | --- |
| J1 | Hợp đồng GLB v1.1: Mixamo65 + xương phụ có tên chuẩn (miệng dưới đầu, cánh dưới vai…) |
| J2 | App 1 giữ xương phụ khi chuẩn hoá |
| J3 | App 2/App 3 hiện và chỉnh được xương phụ |
| J4 | Minecraft20 bỏ qua xương phụ không ánh xạ được, có báo cáo |

## K — Nghiệm thu BBS FS / game (người dùng chạy, Claude chuẩn bị file và checklist)
K1 `.bobj` App 1 trong BBS FS · K2 film xuất từ cảnh trong Film Editor · K3 ghi lỗi gặp được thành việc sửa.

## L — Hạ tầng
| Việc | Nội dung |
| --- | --- |
| L1 | Sửa build production Studio lỗi EPERM trên Windows (quét `AppData\Local\Application Data`) |
| L2 | `pnpm install --frozen-lockfile` không lỗi `ERR_PNPM_IGNORED_BUILDS` (cấu hình cho phép build script cần thiết) |
| L3 | GitHub Actions: chạy test retarget, Studio, Python cho mỗi lần đẩy |
| L4 | Script `test:all` một lệnh chạy hết test kèm báo cáo số |
