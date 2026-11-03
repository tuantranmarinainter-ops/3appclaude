---
name: w01-pr
description: Mở, xem, đổi base và merge pull request của repo W01 (tuantranmarinainter-ops/3appclaude) khi máy KHÔNG có gh CLI, kể cả PR xếp chồng (stacked) phải merge đúng thứ tự. Dùng bất cứ khi nào cần tạo PR, kiểm PR merge được không, hoặc người dùng nói "merge", "merge hết", "mở PR", "Codex không mở được PR".
---

# W01 pull requests (không có `gh`)

Máy này không có `gh`. Script `scripts/gh_pr.py` gọi GitHub REST API với token lấy từ `git credential fill` (không in, không lưu token).

```bash
P=.claude/skills/w01-pr/scripts/gh_pr.py
python $P open --head claude/my-branch --title "Tiêu đề tiếng Việt" --body-file pr.md [--base main]
python $P info 199 200          # trạng thái, mergeable, head -> base
python $P list                  # PR đang mở
python $P base 201 main         # đổi base
python $P merge 199 200         # merge từng PR, dừng ở PR đầu tiên lỗi
python $P stack 194 195 196     # chuỗi xếp chồng: đổi base từng PR về main rồi merge theo thứ tự
```

## Quy tắc của dự án
- **Chỉ merge khi người dùng nói "merge"** (trong lượt hiện tại). Mở PR thì được tự làm sau khi xong việc và đã kiểm.
- Thân PR (tiếng Việt): làm gì, vì sao, đã kiểm gì kèm số (test đạt/lỗi, số đo, trình duyệt), điều **chưa** kiểm được.
  Dòng cuối: `🤖 Generated with [Claude Code](https://claude.com/claude-code)`. Commit kết thúc bằng dòng `Co-Authored-By` mà hệ thống yêu cầu.
- PR xếp chồng: PR sau đặt `--base` = nhánh PR trước. Khi merge dùng `stack` theo đúng thứ tự (nếu merge PR sau khi base còn là
  nhánh PR trước thì nó merge vào nhánh đó, không vào main).
- Hai nhánh cùng sửa `three-workspace-app/editor/apps/studio/public/animation-studio/v1.34.0/README.md` (hash App 3) thì gần như
  chắc xung đột — xem skill `w01-app3-build` mục "Xung đột hash".
- Sau merge: `git pull` ở checkout chính và kiểm bản main khớp bản đã thử (vd `git diff <nhánh thử> origin/main -- three-workspace-app`).
- PR cũ có nội dung đã nằm trong main thì GitHub tự đóng; PR chưa nằm trong main thì giữ mở và báo người dùng.
