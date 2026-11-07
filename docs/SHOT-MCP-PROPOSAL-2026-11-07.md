# Đề xuất: biến việc lặp lại khi dựng shot thành API / MCP (2026-11-07)

## Vì sao
Mỗi shot tốn khoảng 15% hạn 5 giờ. Đã rà 9 phiên dựng/sửa shot, khoảng 12.000 lệnh: phần lớn token đi vào việc AI **tự viết lại**
những thao tác giống nhau (gọi API, dò trình duyệt, đo số, bật server, xuất film), mỗi lần vài chục dòng code nội tuyến,
rồi đọc kết quả dài. MCP `agent/unified_mcp.py` có 48 lệnh nhưng **chưa nối vào Claude Code** (không có `.mcp.json`),
mô tả tool dài khoảng 3 nghìn token, và thiếu các lệnh ở mức "shot".

## Việc lặp lại: đã có skill hay chưa

| # | Việc lặp lại | Số lệnh (ước lượng) | Hiện trạng |
|---|---|---|---|
| 1 | Đọc/sửa project App 2 bằng Python/curl/JS nội tuyến (session cookie + Origin, GET project, sửa clip/key/cue, POST) | ~340 (90 Python + 250 JS) | **Chưa có**. `w01api.mjs` chỉ có trong w01-shot-edit, các phiên khác viết lại |
| 2 | Dò trình duyệt bằng JS (`location.reload`, `querySelector`, `__store.setFrame`, cuộn timeline) | ~250 | Có `w01-browser-check/snippets.md` nhưng chỉ dùng ~9 lần |
| 3 | Đo số: sàn, chạm, vào/ra khung, khoảng cách (`python -c` đọc project.json, `zz-foot.mts`) | ~110 | Một phần: `gates.mjs` (5 cổng cố định). Đo câu hỏi tự do vẫn tự viết |
| 4 | Script dựng shot dùng một lần (`zz-shot03-*.mts`, `step1..13.mjs` của Shot 04) | ~55 | **Đã thay** bằng `w01-shot-new` + `build.mjs` (PR #238) |
| 5 | Bản thử: chép project + thư viện, đặt `W01_LIBRARY`, bật server, vòng chờ `health` | ~100 | Một phần: `sandbox.py`, `new-shot.py`. Bật server và chờ vẫn tự viết |
| 6 | Bật/tắt/cập nhật server (3016, 31xx), `taskkill`, vòng `curl health` | ~90 | **Chưa có** (trừ `Cap-nhat-App-W01`, `Mo-App-W01.bat` cho người dùng) |
| 7 | Xuất film → kiểm ZIP → cài vào game → gỡ | ~110 | Có `film/export-install.mjs`, `uninstall.mjs`; biến môi trường và kiểm ZIP vẫn tự gõ |
| 8 | Ảnh duyệt / contact sheet | ~125 | Có `stills.md` + `sheet.py` nhưng phải dán JS vào trình duyệt; ffmpeg `tile` tự gõ |
| 9 | Video + âm thanh: ffmpeg quay, 720p, ghép tiếng, `volumedetect` | ~50 | **Chưa có** |
| 10 | VFX Effekseer: đặt `DOTNET_ROOT`/`EFFEKSEER_AI_BIN_DIR`, render | ~85 | **Chưa có** (việc App 4) |
| 11 | Git/PR, `git credential fill` | ~260 | Có `gh_pr.py`; credential vẫn có lúc gõ tay |
| 12 | Ghi project thật | 9 | Có `apply_to_real.mts` |

Yêu cầu của người dùng lặp lại qua nhiều phiên: "mở lên tôi xem / cho link test", "chụp ảnh / quay cho tôi xem",
"xuất film và cài vào game" ("đã tắt game, cài đi"), "dời clip / sửa nhịp", "merge", "ghi backlog", "giao Codex".

## Đề xuất: MCP `w01-shot` (một server, 10 tool, kết quả ngắn)

Nguyên tắc tiết kiệm token:
- **Ít tool, mô tả ngắn** (mỗi tool ≤ 2 câu). Schema tool nằm trong ngữ cảnh của mọi lượt gọi.
- **Kết quả ≤ 20 dòng**. Dữ liệu lớn (probe, log, ảnh) ghi ra file, chỉ trả về đường dẫn và số tóm tắt.
- **Một tool = một việc người dùng nói**: "mở bản thử", "đo", "chụp", "cài film". Không phải từng API nhỏ.
- **An toàn mặc định**: từ chối 3016/3002 nếu không có `real: true`. Ghi thật luôn có sao lưu, giống `apply_to_real.mts`.

| Tool | Thay cho việc # | Vào → ra |
|---|---|---|
| `shot.open` | 5, 6 | `{from, slug}` → chép project + thư viện, bật server, chờ health, trả link + `shot.json`. Gọi lại thì dùng bản đã có |
| `shot.read` | 1, 2 | `{shot, what: clips\|keys\|cues\|cast, char?, frames?}` → bảng gọn: clip (khung, tốc độ, trộn, root), key, cue. Không trả mesh hay JSON thô |
| `shot.edit` | 1 | `{shot, ops:[{moveClip\|setClip\|removeClip\|setKeys\|addCue\|removeCue …}]}` → một bước hoàn tác, trả rev mới. Bọc `scene.apply` / `*.cue.*` |
| `shot.build` | 4 | `{shot, from?, only?}` → chạy `build.mjs`, trả 1 dòng mỗi bước + tóm tắt cổng đo |
| `shot.measure` | 3 | `{shot, char, bone?, frames, metric: floor\|contact\|distance\|continuity}` → bảng số ngắn (cm, khung). Dùng lại `probe.mts` |
| `shot.stills` | 8 | `{shot, frames:[..]}` → **một** ảnh contact sheet chụp từ khung 3D thật, không cần dán JS. Server tự chụp bằng trình duyệt headless hoặc `scene.render` |
| `shot.video` | 9 | `{shot, from, to, audio: true}` → mp4 1080p + 720p, kèm mức âm lượng đỉnh |
| `shot.applyReal` | 12 | `{shot, realProject}` → sao lưu, ghi project thật, trả rev trước/sau. Phải có `confirm: true` |
| `film.install` | 7 | `{shot\|project, name, world}` → kiểm game đã tắt, xuất, kiểm ZIP, cài; `film.uninstall` gỡ |
| `app.restart` | 6 | `{port}` → tắt, bật lại, chờ health. 3016 chỉ khi có `confirm: true` |

Bổ sung cho `unified_mcp.py`: đưa ra MCP 16 lệnh broker hiện chưa có (vd `film.preflight`, `scene.preview.bbs`,
`scene.review.get/set`, `asset.import`), và rút mô tả tool xuống dưới 500 token. Danh sách đầy đủ: `unifiedProjectStore.ts:941`.

Ngoài phạm vi App 2: VFX Effekseer (#10) làm thành tool `vfx.render` trong App 4, giao cùng đợt VFX.

## Thứ tự làm (ưu tiên theo token tiết kiệm được)
1. **M1** `shot.read` + `shot.edit` + `shot.measure`: bỏ được khoảng 450 lệnh nội tuyến. Nối `.mcp.json` vào repo.
2. **M2** `shot.open` + `app.restart` + `shot.build` (bọc `build.mjs`).
3. **M3** `shot.stills` (chụp không cần dán JS) + `shot.video`.
4. **M4** `film.install` / `film.uninstall` + `shot.applyReal`, cùng 16 lệnh broker còn thiếu.

Mỗi đợt đo lại: số lượt gọi và % hạn 5 giờ cho một shot mẫu (mục tiêu: dưới 4% cho shot mới, dưới 1% cho một lần sửa nhỏ).

## Ràng buộc
- Code MCP nằm ở `three-workspace-app/agent/` (Python, cạnh `unified_mcp.py`) hoặc `.claude/skills/w01-shot-*/mcp/` (Node, dùng lại script).
  [Claude chốt] Node trong skill: script hiện có là `.mjs`, gọi trực tiếp không cần spawn.
- Không fetch trong `packages/builder`. Không ghi kho thật hay project thật khi chưa có `confirm`. `W01_LIBRARY` luôn là bản sao.
- Test cho từng tool bằng server giả, cộng một lần chạy thật trên bản sao Shot 04.
