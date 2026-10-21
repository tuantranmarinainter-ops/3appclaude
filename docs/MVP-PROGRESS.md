# Tiến độ MVP 3 app

Cập nhật: 2026-10-21 · Kế hoạch: [MVP-PLAN-2026-10-21.md](MVP-PLAN-2026-10-21.md) · Claude cập nhật file này mỗi khi kiểm/merge một việc.

**Toàn bộ MVP: `[░░░░░░░░░░] 0/10 việc đã merge`** (nền đã xong: App 1, TASK-1, 2, 4)

Ký hiệu: ✅ đã kiểm và merge · 🔍 Claude đang kiểm · ↩️ trả lại sửa · 🛠️ AI đang làm · ⏳ chờ

## Đã xong trước MVP
| Việc | Trạng thái | Commit |
| --- | --- | --- |
| App 1 MVP (CLI, Workbench, `.bobj` Minecraft20) | ✅ | nhiều commit, mới nhất `a0ba4a2`/`bd9cdca` |
| TASK-1 chuẩn hoá hàng loạt (AI-1) | ✅ 148/148 test, chạy thật 6 file | `9200033` |
| TASK-2 hợp đồng gói shot + bộ kiểm (AI-2) | ✅ 107/107 test, nhận gói thật | `5b190fc` |
| TASK-4 thiết kế MCP cục bộ App 3 (AI-2) | ✅ 26/26 lệnh, tên hàm có thật | `1532dd4` |
| Mã nguồn App 3 vào repo, build khớp từng byte | ✅ | `58afbcc` |

## EPIC-A — App 3 (AI-1) `[░░░░░░░░░░] 0/4`
| Việc | Trạng thái | Ghi chú |
| --- | --- | --- |
| A1 TASK-3b sửa UI 1.32.0 | 🛠️ | Lần 1 trả lại: mất timeline sau "Thoát cảnh", Graph Editor chật |
| A2 Mở gói shot | ⏳ | |
| A3 Xuất gói kết quả | ⏳ | |
| A4 Kèm `.bobj` trong gói | ⏳ | |

## EPIC-B — App 2 (AI-2) `[░░░░░░░░░░] 0/4`
| Việc | Trạng thái | Ghi chú |
| --- | --- | --- |
| B1 Nhập GLB + manifest App 1 | 🛠️ | |
| B2 `shot.export` | ⏳ | |
| B3 `shot.result.import` | ⏳ | |
| B4 CLI + MCP | ⏳ | |

## Ráp nối — Claude `[░░░░░░░░░░] 0/2`
| Việc | Trạng thái | Ghi chú |
| --- | --- | --- |
| C1 Đưa App 3 mới vào Studio, nối shot.export ↔ App 3 ↔ shot.result.import | ⏳ | sau A3 + B3 |
| C2 Chạy thử trọn chuỗi (1 cảnh, 2 nhân vật) + xuất film BBS FS | ⏳ | sau C1 |

## Cần người dùng
| Việc | Trạng thái |
| --- | --- |
| Chốt chính sách vị trí khi sửa ở App 3 (đề xuất: `placementKeys`, giữ root Action) | ⏳ |
| Thử `.bobj` / film trong BBS FS thật | ⏳ |
