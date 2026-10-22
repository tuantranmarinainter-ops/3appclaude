# App 4 VFX — Báo cáo giai đoạn 0 (xác minh)
Ngày: 2026-10-22. Nhánh: `claude/vfx-app4-g0` (worktree `C:\w01-vfx`, chưa merge, chưa push).
Kế hoạch: `docs/VFX-APP4-PLAN.md` (DRAFT). Máy: Windows 10 Pro 10.0.19045.

## Tóm tắt gate
| # | Gate | Trạng thái | Số đo / căn cứ |
| --- | --- | --- | --- |
| G0.1 | Chép mã effekseer-ai vào `three-workspace-app/vfx/` | PASS | Commit gốc `208922e`; 20 file, ~102 KB; 0 binary (không `.dll/.exe/.efk*/.png`); LICENSE MIT giữ nguyên; nguồn ghi ở `vfx/NOTICE.md` |
| G0.2 | 4 test sẵn có (`tests/test_cli.py` ×2, `tests/test_runtime.py` ×2) | BLOCKED | Lệnh `pip install -e ".[dev]"` + `pytest` bị chế độ auto của Claude Code chặn (cài/chạy mã tải từ ngoài). Chưa chạy trên máy này. Audit trước đó báo 4 passed ở môi trường khác — không tính là kiểm chứng ở đây. |
| G0.3 | Runtime: Python 3.11+ | PASS | `python --version` → 3.12.8 |
| G0.3 | Runtime: .NET 9 | BLOCKED (thiếu) | `C:\Program Files\dotnet\shared\Microsoft.NETCore.App`: 2.0.9, 3.1.28, 5.0.17, 6.0.x, 7.0.3, 8.0.10, 8.0.14 — không có 9.x. `ea.runtimeconfig.json` yêu cầu `net9.0`, rollForward `LatestPatch` → 8.0 không dùng được. `dotnet` không có trong PATH của Git Bash. |
| G0.3 | Runtime: Effekseer 1.80.6 (`EffekseerCore.dll`) | BLOCKED (thiếu) | Không tìm thấy `EffekseerCore.dll`/thư mục `*effekseer*` trong Downloads, Desktop, Program Files, Program Files (x86), `C:\Tools`, `D:` (độ sâu ≤5); `C:\w01-samples\effekseer\` chưa có. |
| G0.4 | Mở → sửa → lưu → mở lại một hiệu ứng | NOT_RUN | Cần G0.2 + .NET 9 + Effekseer. |
| G0.5 | Render preview thật tự động (ảnh theo mốc thời gian) | NOT_RUN | Repo gốc không có renderer; xem "Đường render đề xuất". Chưa có ảnh nào → không tuyên bố PASS. |
| G0.6 | **Chạy trong BBS FS** (gate MVP, tách khỏi cấu trúc/hình/hiệu năng) | BLOCKED | BBS FS 2.4 không có đường phát Effekseer trong mã nguồn (xem mục "BBS FS phát Effekseer bằng cách nào"). Cần người dùng chốt đường phát. |

## BBS FS phát Effekseer bằng cách nào (MVP, người dùng chốt 2026-10-22)
Tiêu chí MVP (`docs/DECISIONS.md`): mọi hiệu ứng xuất vào BBS FS phải chạy được trong BBS FS thật. Không đưa vào gói
hiệu ứng chưa kiểm; tính năng vượt khả năng bản BBS/AAA thật thì chặn hoặc cảnh báo khi xuất.

### Đã đọc (chỉ đọc, không build/chạy)
Nguồn BBS FS trên máy: `C:\Users\Administrator\Documents\ChatGPT\BBS MINECRAFT\.build-tools\bbs-fs-1.20.1`
(đích nội bộ commit `0085f77` = `mod_version=2.4`, Minecraft 1.20.1, **Fabric** loader 0.16.14, fabric-api 0.92.1; checkout HEAD `998c9d5` = 2.7).

| Câu hỏi | Kết quả | Căn cứ |
| --- | --- | --- |
| BBS FS có phát Effekseer (`.efk`/`.efkefc`) không? | **Không** ở cả 2.4 và 2.7 | `git grep -i "effekseer\|aaaparticles\|efkefc"` trên `.java` của `0085f77` và `998c9d5`: 0 file. Kết quả duy nhất là chuỗi tiếng Đức/Hungary chứa "Partikeleffekt". |
| BBS FS phát particle bằng gì? | `ParticleForm` (scheme JSON kiểu Bedrock/Snowstorm, `format_version` 1.10.0, MoLang, `user1..6`, `paused`, `texture`) và `VanillaParticleForm` (particle vanilla), thêm `TrailForm` | `forms/forms/ParticleForm.java`, `particles/ParticleParser.java`, `particles/ParticleManager.java` (JSON storage) |
| Gắn vào actor hay xương? | Form gắn vào replay/actor của film; form con gắn vào xương qua `BodyPart` (`forms/forms/BodyPart.java`, `AnchorForm`). Đồng bộ thời gian theo tick film 20 Hz. | Đọc cấu trúc file; chưa kiểm trong game |
| AAA Particles trên máy? | Không thấy jar AAA/Effekseer. `.minecraft/mods` hiện là bộ 1.12.2 (Blockbuster 2.7.1, mclib…). | `find` trong AppData/Roaming, Downloads, Desktop, curseforge (độ sâu ≤6) |

### Hệ quả
Hiện **không có đường nào** để một `.efkefc`/`.efk` chạy trong film BBS FS 2.4. Ba hướng, cần người dùng chọn:

1. **Addon BBS gọi AAA Particles** — thêm một Form mới (ví dụ `EffekseerForm`) trong fork BBS FS, gọi API của AAA
   Particles (bản Fabric 1.20.1) để phát `.efkefc` theo tick film, gắn actor/xương như form khác, hỗ trợ seek/reset.
   Giữ đầy đủ Effekseer; là việc Java mới ở repo BBS FS (ngoài `vfx/`), phụ thuộc AAA có API phát + seek theo thời gian
   hay không (chưa kiểm). Định dạng: `.efkefc` trong `assets/<namespace>/effeks/` (theo tài liệu AAA, chưa kiểm bản thật).
2. **Chuyển Effekseer → particle BBS (Snowstorm JSON)** — chạy native trong BBS 2.4, không cần mod thêm, nhưng chỉ
   chuyển được tập con (sprite billboard, emitter, màu/size curve). Ribbon, track, ring, model, distortion, material
   tùy biến, GPU particle sẽ bị chặn/cảnh báo khi xuất. Effekseer khi đó chỉ là công cụ soạn.
3. **AAA phát độc lập (lệnh/khối)** ngoài film — không đồng bộ seek/render film; không đạt MVP "chạy trong film".

Đề xuất: làm hướng 2 trước cho MVP (kiểm được bằng BBS 2.4 sẵn có, chặn rõ tính năng không hỗ trợ), song song
khảo sát API AAA cho hướng 1. Mọi hướng đều cần đề xuất với người dùng trước khi sửa ngoài `vfx/` (BBS FS, App 2).

### Cần người dùng cung cấp để kiểm gate "chạy trong BBS FS"
- Bản BBS FS đang chơi thật: 2.4 hay 2.7 (hoặc jar build riêng), file jar và hash.
- Instance Minecraft 1.20.1 Fabric đang dùng (đường dẫn thư mục game, danh sách mods). Có AAA Particles không, bản nào, Fabric hay Forge.
- 1–2 hiệu ứng mẫu người dùng muốn thấy chạy (hoặc đồng ý dùng mẫu CC0 do App 4 tạo).
- Cách xác nhận "chạy được": ảnh/video chụp trong game ở các tick cụ thể, do người dùng chụp hay cho phép tự động
  (có `MCP_SCREEN_CAPTURE` trên máy, chưa đọc).

## Cần người dùng đồng ý tải (chưa tải gì)
| File | Nguồn | Dung lượng | Dùng cho |
| --- | --- | --- | --- |
| `dotnet-runtime-9.0.21-win-x64.exe` (hoặc `.zip` 34.3 MB, không cần cài hệ thống) | https://builds.dotnet.microsoft.com/dotnet/Runtime/9.0.21/dotnet-runtime-9.0.21-win-x64.exe (Microsoft, bản 9.0.21 ngày 2026-10-13) | 28.6 MB | Python.NET nạp `EffekseerCore.dll` |
| `Effekseer1.80.6Win.zip` | https://github.com/effekseer/Effekseer/releases/download/1806/Effekseer1.80.6Win.zip (phát hành 2026-07-12) | 92.1 MB | Effekseer Core + Editor; giải nén vào `C:\w01-samples\effekseer\1.80.6\` |
| `EffekseerForWebGL1.80.7.zip` (tuỳ chọn, cho đường render B) | https://github.com/effekseer/Effekseer/releases/download/1807/EffekseerForWebGL1.80.7.zip | 2.8 MB | Runtime WebGL để render `.efk` không cần GUI. Release 1806 không có gói WebGL; dùng 1.80.7 hoặc 1.80.5 phải kiểm đọc `.efk` từ 1.80.6. |
| Gói Python `mcp>=1.0`, `pythonnet>=3.0`, `pytest>=7.4` (PyPI) | PyPI, cài vào `three-workspace-app/vfx/.venv` (gitignored) | vài MB | Chạy 4 test và CLI |

Lưu ý: bản Effekseer mới nhất là 1.80.7 (2026-08-07); effekseer-ai chỉ khai báo kiểm với 1.80.6 → đề xuất giữ 1.80.6.
Cấu trúc `Tool/bin` sau khi giải nén chưa kiểm (sẽ ghi lại khi có file).

## Đường render đề xuất (chưa chạy)
Repo gốc chủ ý không điều khiển GUI Effekseer và không có lệnh render. Hai hướng, thử theo thứ tự:

- **A. Recorder của Effekseer Editor** — có trong GUI; chưa biết có chạy được bằng dòng lệnh/không cửa sổ. Kiểm tra
  `Effekseer.exe --help`/tham số CLI sau khi tải. Nếu chỉ chạy được qua GUI thì loại (không tự động hoá ổn định).
- **B. EffekseerForWebGL + Chromium headless (đề xuất chính)** — `effect_export` → `.efk` → trang HTML cục bộ (three.js +
  `effekseer.min.js`/`.wasm`) → bước runtime đúng số frame (60 fps) → chụp PNG tại các mốc, ví dụ 0 / 0.25 / 0.5 / 1.0 / 2.0 s,
  nền tối và nền sáng. Chạy bằng Playwright/Chromium đã có trong workspace (test App 3). Đầu ra: `artifacts/preview/<effect>/t0250.png`
  + `preview.json` (phiên bản runtime, frame, kích thước, hash ảnh, số pixel khác nền để phát hiện ảnh trống).
  Rủi ro: renderer WebGL có thể khác Editor/AAA Particles (material, distortion) → ghi rõ là preview WebGL, không thay kiểm thử trong Minecraft.

Hiệu ứng mẫu cho G0.4/G0.5: tạo mới bằng CLI (`effekseer-ai new`, `node-add`, đặt màu/lượng sinh), lưu `.efkefc`, mở lại,
so `node-list` + giá trị thuộc tính trước/sau; không dùng asset bên thứ ba ở G0.

## Lệnh chạy lại (sau khi được đồng ý và cài xong)
```powershell
cd C:\w01-vfx\three-workspace-app\vfx
python -m venv .venv
.\.venv\Scripts\python -m pip install -e ".[dev]"
.\.venv\Scripts\python -m pytest -v                      # G0.2: kỳ vọng 4 passed
$env:EFFEKSEER_AI_BIN_DIR = 'C:\w01-samples\effekseer\1.80.6\Tool\bin'
.\.venv\Scripts\effekseer-ai new C:\w01-samples\effekseer\work\g0.efkefc   # G0.4 bắt đầu
```

## Câu cần người dùng chốt
1. Cho phép tải .NET 9.0.21 runtime (28.6 MB), Effekseer 1.80.6 Win (92.1 MB), gói PyPI, và (tuỳ chọn) EffekseerForWebGL (2.8 MB)?
   Cũng cần cho phép Claude Code chạy `pip install`/`pytest` (đang bị chế độ auto chặn).
2. Bản Effekseer đang dùng thật: 1.80.6 hay khác? Bản AAA Particles và Minecraft/loader (kế hoạch giả định Java 1.20.1 Fabric, AAA 2.2.3)?
   Bản BBS (mod) đang dùng?
3. Xem preview bằng cách nào: ảnh PNG theo mốc thời gian (mặc định), bảng ảnh ghép, hay video MP4?
4. Chấp nhận preview qua WebGL (đường B) làm preview tự động chính, biết rằng có thể khác Editor/AAA?
5. License mặc định khi tìm asset: chỉ CC0 (đề xuất) hay cho cả CC-BY có ghi công?
6. Đường phát VFX trong BBS FS: hướng 1 (addon BBS + AAA), 2 (chuyển sang particle BBS) hay cả hai? Xem mục BBS ở trên.
7. Push nhánh `claude/vfx-app4-g0` lên origin để Codex cloud dùng được?
