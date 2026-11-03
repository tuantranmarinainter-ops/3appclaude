# AGENTS.md (W01)

Hướng dẫn cho mọi agent (Codex, Muse, Claude…) làm việc trong repo này.

1. Đọc `CLAUDE.md` (phạm vi App 1–5, lệnh build/test, cách làm việc) và `docs/DECISIONS.md`.
2. Dùng bộ skill chung trong `.claude/skills/`: mục lục và lệnh ở `docs/AGENT-SKILLS.md`. Trước việc thuộc loại nào thì đọc
   `SKILL.md` của skill đó và chạy script của nó (Python 3 / Node), không tự viết lại.
3. Luật dữ liệu: không ghi thư viện thật `S:\Claude\w01-library` (đây là giá trị MẶC ĐỊNH của `W01_LIBRARY`, nên luôn đặt bản sao),
   project thật `S:\Claude\w01-samples\tap15v3`, thư mục game Minecraft. Thử trên bản sao (`w01-test-sandbox`).
4. Không tự merge PR. Báo cáo bằng tiếng Việt, trạng thái NOT_RUN/BLOCKED/FAIL/PASS kèm số đo.
5. Quy tắc riêng của editor Topview: `three-workspace-app/editor/AGENTS.md`.
