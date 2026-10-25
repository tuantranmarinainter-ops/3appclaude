# Bàn giao cho phiên Claude mới (2026-10-25)

Đọc file này trước, rồi `CLAUDE.md`, `docs/DECISIONS.md`, `docs/RETARGET-LESSONS.md`, và `docs/claude-memory/*.md`
(ghi nhớ quy tắc người dùng — chép từ `C:\Users\Administrator\.claude\projects\S--Claude-w01\memory\`). Nếu thư mục memory của
phiên mới trống, chép các file `docs/claude-memory/*.md` (trừ `launch.json.example`) vào thư mục memory của phiên.

## Người dùng & cách làm
- Trả lời **tiếng Việt**, ngắn; thường điều khiển từ điện thoại (Remote Control).
- Codex viết code qua PR (`ai1/...`, đích `main`); Claude soạn đặc tả, **kiểm thật** (gộp thử, build, `pnpm typecheck`, test, đo số,
  ảnh), rồi **chỉ merge khi người dùng nói rõ "merge"**. Khi có lỗi được dùng subagent **Sonnet (medium) hoặc Haiku**, không Opus/Fable.
- "check hub" = fetch GitHub, liệt kê PR mở, kiểm từng PR, báo và hỏi merge. "giao lệnh" = soạn lệnh dán cho Codex (kèm link GitHub).
- Khi người dùng nói "khoan code / code sau" → chỉ ghi vào `docs/MVP-REMAINING-TASKS-2026-10-24.md`, không code.
- Luôn giữ SHA GLB Samba mặc định `68fcdb75d373b733…` (Samba → `builtin-assets/characters/a3d_char_30ec…glb`).

## Vị trí (đã chuyển khỏi ổ C ngày 2026-10-24)
| Gì | Ở đâu |
|---|---|
| Repo (git, GitHub `tuantranmarinainter-ops/3appclaude`) | `S:\Claude\w01` (`C:\w01` là liên kết) |
| Kho thư viện thật (App 5) | `S:\Claude\w01-library` (`C:\w01-library` liên kết) — **không ghi khi test**, dùng bản sao |
| Mẫu, Tập 15, backups, công cụ, script GitHub | `S:\Claude\w01-samples` (`C:\w01-samples\*` liên kết) |
| App 4 VFX worktree | `S:\Claude\w01-vfx` |
| Gọi GitHub API (token từ git credential manager) | `python -I S:\Claude\w01-samples\gh\gh_api.py GET|POST|PUT|PATCH "/repos/{repo}/..." [body.json]` |
| Cấu hình chạy app (preview_start) | `S:\Claude\w01\.claude\launch.json` (mẫu: `docs/claude-memory/launch.json.example`) |
| Kho thử có sẵn Nháp | `S:\Claude\w01-samples\lib-mvp` (đã migrate base model) |

## Chạy & kiểm các app
Từ `S:\Claude\w01\three-workspace-app\editor`: `pnpm install --frozen-lockfile` → `pnpm --filter @topview/3d-builder build` → `pnpm typecheck`.
- **App 1 Workbench** cổng **3101**: cấu hình `app1-workbench` (node `--max-old-space-size=16384`, thiếu là sập khi nguồn ~400 anim).
- **App 2 Studio (Topview)** cổng **3016**: cấu hình `app2-tap15v3` (project Tập 15 ở `w01-samples\tap15v3\projects`). App 3 (Animation
  Studio 1.33) và App 5 (Thư viện, `/library`) nằm trong Studio. Mặc định tiếng Việt.
- Test riêng dùng cổng khác (3017+, 3102+), bản sao kho, `BBS_UNIFIED_PROJECTS_DIR` riêng; **không tắt 3101/3016** của người dùng.
- QA có sẵn: `apps/studio/scripts/c2-native-browser.mjs` (App 3 với Hero/Đen/Gỗ Xưa) và `c1-roundtrip-qa.mjs` (App 3 → trả về cảnh);
  cả hai PASS ngày 2026-10-24 trên bản sao `lib-mvp`.
- PATH máy thiếu `System32` (gọi `cmd`/`powershell` bằng đường dẫn đầy đủ). Script `.ps1` có tiếng Việt phải lưu **UTF-8 có BOM**.
- Xoá thư mục bằng `rm -rf` bị chặn an toàn → để người dùng tự chạy (vd `S:\Claude\don-o-C.ps1`).

## Trạng thái
- MVP Hero / Gỗ Xưa / Đen (App 1 → Thư viện → App 2 → App 3 → trả về cảnh): **đạt** trên dữ liệu bản sao.
- Đã merge tới #116. Kho thật: mỗi nhân vật có base model riêng; Gỗ Xưa đã có ~76 Nháp.
- **Còn chờ Codex: C16** (Hiệu chỉnh riêng từng animation) — lệnh trong lịch sử; đặc tả ở `docs/MVP-REMAINING-TASKS-2026-10-24.md`.
- PR **#84** (F1 App 3 three-step) còn mở, chưa kiểm (có thể trùng C1/C2 đã merge).
- `C:\Users\Administrator\Documents\Codex` ~46 GB kết quả chạy thử của Codex trên ổ C — đề xuất chuyển sang `S:\Claude\Codex` khi Codex rảnh.
