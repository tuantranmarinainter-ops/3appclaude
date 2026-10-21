# Tiến độ MVP 3 app

Cập nhật: 2026-10-21 · Kế hoạch: [MVP-PLAN-2026-10-21.md](MVP-PLAN-2026-10-21.md) · Claude cập nhật file này mỗi khi kiểm/merge một việc.

**Toàn bộ MVP: `[████████░░] 8/10 việc đã merge`** (nền đã xong: App 1, TASK-1, 2, 4)

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

## Ráp nối — Claude `[░░░░░░░░░░] 0/2`
| Việc | Trạng thái | Ghi chú |
| --- | --- | --- |
| C1 Đưa App 3 mới vào Studio, nối shot.export ↔ App 3 ↔ shot.result.import | ⏳ | sau A3 + B3 |
| C2 Chạy thử trọn chuỗi (1 cảnh, 2 nhân vật) + xuất film BBS FS | ⏳ | sau C1 |

## Đợt 3 (ngoài MVP, AI-1 / Codex)
| Việc | Trạng thái | Ghi chú |
| --- | --- | --- |
| A5 `.bobj` App 3 bỏ xoắn + khoá tay | ✅ PR #2 | Lux Attack1: xoắn 116.6° → 0°, khớp App 1 |
| D6 sửa 2 lỗi lint Workbench | ✅ PR #4 | `pnpm lint` exit 0, 13/13 test Workbench |
| D5 chọn đoạn Action + huỷ | ⏳ | |
| D4 thân trên Minecraft20 | ⏳ | |
| D1 khoá chân IK | ⏳ | |

## Đang giao (2026-10-21)
| Ai | Việc | Issue |
| --- | --- | --- |
| Codex phiên 1 | D5 Workbench chọn đoạn + huỷ | #5 |
| Codex phiên 2 (đã xong D6) | L3+L4 CI GitHub Actions + `test:all` | #8 |
| Codex tài khoản 2 (đã xong EPIC-B) | EPIC-G: AI xếp nhân vật + camera qua MCP | #9 |
| ChatGPT Plus | Tìm hiểu định dạng film/cảnh BBS FS, `.scene.bobj` | #10 |
| Claude | C1–C2 ráp nối + chạy trọn chuỗi | — |

## Cần người dùng
| Việc | Trạng thái |
| --- | --- |
| Chốt chính sách vị trí khi sửa ở App 3 (đề xuất: `placementKeys`, giữ root Action) | ⏳ |
| Thử `.bobj` / film trong BBS FS thật | ⏳ |
