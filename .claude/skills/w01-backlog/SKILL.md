---
name: w01-backlog
description: Ghi lỗi / yêu cầu mới vào backlog W01 (docs/BACKLOG-2026-10-25.md) thành một dòng B<n> đúng định dạng, tự lấy số tiếp theo. Dùng ngay khi người dùng nói "ghi backlog", "ghi vào backlog", "chưa code", "ghi lại lỗi này", hoặc khi đang ở chế độ đi hết quy trình (lỗi mới chỉ ghi, không sửa), kể cả khi họ chỉ gửi ảnh chụp lỗi và bảo ghi lại.
---

# W01 backlog

Backlog của dự án là bảng markdown trong `docs/BACKLOG-2026-10-25.md`, mỗi dòng `| B<n> | Lỗi/yêu cầu | Ghi chú cho người làm |`.
Người dùng làm phim một mình, thường điều khiển từ điện thoại; họ cần dòng backlog đọc là hiểu, và người code sau (Codex/Muse/Claude)
làm được mà không phải hỏi lại. Đầu file có mục "Vai trò người dùng" — đọc khi cần viết theo góc nhìn người dùng.

## Cách ghi

1. Viết hai ô:
   - **Lỗi / yêu cầu**: điều người dùng thấy, bằng lời của họ (giữ ý, không diễn giải sai), nơi xảy ra (App/F-số, nút, bản thử nào),
     cách tái hiện nếu có. Đoán nguyên nhân thì ghi rõ là đoán: "(Nghi: …)".
   - **Ghi chú cho người làm**: kết quả mong muốn + cách kiểm (test, số đo, ảnh). Đủ để người khác làm được.
2. Chạy script (đừng tự chọn số, đừng chèn bằng heredoc — dấu `\` bị mất trên máy này):
   ```bash
   python .claude/skills/w01-backlog/scripts/backlog_add.py --source "Người dùng 2026-11-03, test bản 3050." \
     --problem-file p.md --fix-file f.md
   ```
   Viết hai ô vào file tạm (`p.md`, `f.md`) bằng công cụ Write rồi truyền `--problem-file/--fix-file`. Script in ra mã mới (vd `B74`).
   `--dry-run` để xem dòng trước khi ghi; `--list` để xem 5 mã gần nhất.
3. Commit **chỉ file backlog** (`git add docs/BACKLOG-2026-10-25.md`), message `docs: backlog B74 <tóm tắt tiếng Anh ngắn>`,
   rồi push lên main nếu đang ở main. Có phiên khác cùng sửa file thì `git pull` trước, chạy lại script nếu số bị trùng.
4. Báo người dùng: mã B, một câu tóm tắt, commit.

## Lưu ý
- "Ghi backlog" nghĩa là **không sửa code**. Chỉ code khi người dùng bảo.
- Người dùng rút lại một mục → xoá đúng dòng đó (commit "docs: drop B<n> …"), không đánh số lại các mục khác.
- Nhiều lỗi cùng lúc → mỗi lỗi một lần chạy script (mỗi lỗi một mã).
