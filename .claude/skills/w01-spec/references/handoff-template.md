# Mẫu lệnh giao việc (dán cho Claude 2 / Codex)

```text
Bạn làm <tính năng> cho <App n>.

Đặc tả (đọc HẾT trước khi làm):
https://github.com/tuantranmarinainter-ops/3appclaude/blob/main/docs/<FILE>.md
Quy tắc repo: CLAUDE.md, docs/DECISIONS.md, three-workspace-app/editor/AGENTS.md.
Skill dùng chung trong repo: .claude/skills/ (đọc docs/AGENT-SKILLS.md) — dùng w01-test-sandbox, w01-app3-build, w01-pr,
w01-browser-check, w01-backlog thay vì tự viết lại script.
Repo cục bộ: S:\Claude\w01 (main). Mỗi đợt một git worktree riêng tạo từ main mới nhất.

PHẠM VI: làm tuần tự các đợt <S1 → S4> theo mục "Chia đợt". Mỗi đợt một nhánh claude/<chủ-đề>-s<n>, xếp chồng; PR vào nhánh đợt trước
(đợt đầu vào main). KHÔNG tự merge.

ĐIỀU PHỐI SUB-AGENT (bắt buộc):
- Bạn là điều phối viên: huy động MỌI sub-agent phù hợp (khảo sát, code, test, đo số, kiểm trình duyệt, review), chạy song song việc
  độc lập nhưng không để hai agent sửa cùng một file.
- Tự chọn model, LUÔN dưới Opus 5.5: Sonnet cho code/đo/review, Haiku cho tìm kiếm/đọc file. Cấm Opus và Fable.
  (Codex: sub-agent tối đa "terra" high.)
- Tự kiểm lại kết quả sub-agent (diff, test, số) trước khi commit.

RÀNG BUỘC CỨNG:
- <ràng buộc riêng của tính năng, vd App 3 giữ mọi chức năng + chạy check-features>
- Không sửa packages/retarget (trừ test), không đổi golden, không commit binary/kho thật/project thật.
- KHÔNG ghi thư viện thật (S:\Claude\w01-library, C:\w01-library) hay project thật (S:\Claude\w01-samples\tap15v3).
  W01_LIBRARY mặc định là kho THẬT → luôn đặt bản sao (skill w01-test-sandbox). Dữ liệu nguồn để copy: <tall-projects / tall-lib…>.
- Cổng dev server: <dải cổng riêng>. Không đụng <cổng của người dùng/agent khác>.
- Windows: PATH thiếu System32; Bash heredoc mất dấu "\" → sửa code bằng Edit/Write.
- UI tiếng Việt, nền tối. pnpm typecheck toàn workspace trước mỗi lần push.

ĐO SỐ VÀ BÁO CÁO:
- Đo đúng mục "Đo số" của đặc tả, ghi docs/REPORT-<chủ-đề>-<ngày>.md. Trạng thái NOT_RUN/BLOCKED/FAIL/PASS; không PASS chỉ vì UI hiện ra.
- Mỗi đợt kiểm trình duyệt thật trên bản sao + ảnh bằng chứng.
- Báo tiến độ tiếng Việt, thanh progress từng đợt. Cuối đợt: link PR, số đo, test (đạt/lỗi), điều chưa kiểm.
- Gặp điểm chưa rõ ảnh hưởng thứ người dùng nhìn thấy: dừng và hỏi.
```
