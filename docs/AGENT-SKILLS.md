# Skill dùng chung cho mọi agent (Claude, Codex, Muse)

Bộ skill nằm trong `.claude/skills/<tên>/`. Mỗi thư mục có `SKILL.md` (khi nào dùng, các bước, luật an toàn) và `scripts/` chạy được
bằng Python 3 / Node, không cần công cụ riêng của Claude. Claude Code tự nạp skill. Agent khác (Codex, Muse) đọc `SKILL.md` tương ứng
trước khi làm việc thuộc loại đó và chạy script bằng đường dẫn bên dưới.

| Skill | Dùng khi | Lệnh chính |
| --- | --- | --- |
| [`w01-backlog`](../.claude/skills/w01-backlog/SKILL.md) | "ghi backlog", lỗi mới khi đi hết quy trình | `python .claude/skills/w01-backlog/scripts/backlog_add.py --problem-file p.md --fix-file f.md --source "…"` |
| [`w01-pr`](../.claude/skills/w01-pr/SKILL.md) | mở/xem/merge PR (máy không có `gh`), PR xếp chồng | `python .claude/skills/w01-pr/scripts/gh_pr.py open\|info\|list\|base\|merge\|stack …` |
| [`w01-app3-build`](../.claude/skills/w01-app3-build/SKILL.md) | sau mọi lần sửa nguồn App 3; xung đột hash v1.34.0 | `python .claude/skills/w01-app3-build/scripts/app3_build.py [--allow-dirty]` |
| [`w01-test-sandbox`](../.claude/skills/w01-test-sandbox/SKILL.md) | trước khi chạy server/test có ghi dữ liệu; "link test" | `python .claude/skills/w01-test-sandbox/scripts/sandbox.py all --name X --branch B --from-projects … --port 31xx` |
| [`w01-browser-check`](../.claude/skills/w01-browser-check/SKILL.md) | kiểm UI App 2/App 3, "chụp ảnh test" | đoạn JS trong `references/snippets.md` |
| [`w01-spec`](../.claude/skills/w01-spec/SKILL.md) | tính năng lớn: hỏi → đặc tả → người đọc kiểm tra → lệnh giao việc | mẫu trong `references/` |
| [`w01-shot-edit`](../.claude/skills/w01-shot-edit/SKILL.md) | sửa nhịp/nhân vật/prop/VFX của một shot App 2; "ghi thật" từ bản thử | `stills.py` (ảnh duyệt), `references/viewport-probe.md` (đo khung 3D), `apply_to_real.mts --dry-run` (ghi thật ~5 s) |
| [`w01-shot-new`](../.claude/skills/w01-shot-new/SKILL.md) | dựng shot MỚI nối tiếp shot trước: nhịp chậm/nhanh, prop bám tay, cú chạm, rơi/nằm sát đất, camera, VFX, thoại CapCut, SFX | `new-shot.py`, `continue-from.mjs`, `gates.mjs` (CONTINUITY/SEAM_JUMP/FLOOR/CONTACT), `ground.mjs`, `flat.mjs`, `vfx.mjs`, `audio.mjs` |

Luật chung, các skill đều nhắc lại:
- Không ghi thư viện thật `S:\Claude\w01-library` (mặc định của `W01_LIBRARY`!), project thật `tap15v3`, thư mục game.
- Chỉ merge khi người dùng nói "merge".
- App 3 giữ mọi chức năng.
- Trả lời người dùng bằng tiếng Việt.
