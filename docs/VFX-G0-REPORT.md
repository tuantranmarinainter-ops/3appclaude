# App 4 VFX — Báo cáo giai đoạn 0 (xác minh)
Ngày: 2026-10-22. Nhánh: `claude/vfx-app4-g0` (worktree `C:\w01-vfx`, chưa merge, chưa push).
Kế hoạch: `docs/VFX-APP4-PLAN.md` (DRAFT). Máy: Windows 10 Pro 10.0.19045.
Tải và cài theo đồng ý của người dùng ("Ok đồng ý", 2026-10-22), chỉ từ nguồn chính thức, cài ngoài repo.

## Tóm tắt gate
| # | Gate | Trạng thái | Số đo / căn cứ |
| --- | --- | --- | --- |
| G0.1 | Chép mã effekseer-ai vào `three-workspace-app/vfx/` | PASS | Commit gốc `208922e`; 20 file, ~102 KB; 0 binary; LICENSE MIT giữ nguyên; nguồn ghi ở `vfx/NOTICE.md` |
| G0.2 | 4 test sẵn có | PASS | `pytest -v`: **4 passed** in 0.03 s (mcp 2.3.0, pythonnet 3.2.1, pytest 9.1.1, Python 3.12.8). Lần chạy đầu 3 passed + 1 error do sandbox chặn `%TEMP%\pytest-of-Administrator`; chạy lại với `--basetemp` trong scratchpad → 4 passed. Test này chỉ kiểm CLI/cấu hình, không chạm Effekseer. |
| G0.3 | Runtime: Python 3.11+ | PASS | 3.12.8 |
| G0.3 | Runtime: .NET 9 | PASS | Máy chỉ có 2.0–8.0.14. Đã tải `dotnet-runtime-9.0.21-win-x64.zip` (SHA-512 khớp `releases.json` Microsoft), giải nén `C:\w01-samples\effekseer\dotnet-9.0.21` (76 MB), dùng qua `DOTNET_ROOT`. Thiếu `DOTNET_ROOT` → pythonnet báo "Failed to create a .NET runtime (coreclr)" (đã thử). Effekseer kèm runtime riêng 9.0.17 cho `Effekseer.exe`, nhưng pythonnet không dùng được bản đó. |
| G0.3 | Runtime: Effekseer 1.80.6 | PASS | `Effekseer1.80.6Win.zip` 96 564 040 byte, SHA-256 `faf73b3e…a2092a8c02` khớp digest GitHub release 1806; giải nén `C:\w01-samples\effekseer\1.80.6\Effekseer1.80.6Win\` (169 MB). `Tool\bin\EffekseerCore.dll` nạp được: mở `Sample\00_Basic\Laser01.efkefc` → 5 node, 0.74 s. |
| G0.4 | Mở → sửa → lưu → mở lại | PASS | `tools/g0_roundtrip.py`, mỗi bước một process mới. Bản sao của `Laser01.efkefc`: `node/root/4/CommonValues/MaxGeneration` 60 → 67, đổi tên `node/root/0` "Laser" → "G0Renamed"; mở lại: giá trị 67, tên mới, 5/5 node, các node khác không đổi, file nguồn giữ nguyên hash; `.efkefc` 5 993 byte, export `.efk` 4 360 byte. 4.1 s. |
| G0.5 | Render preview thật tự động | PASS | `tools/render_preview.py` (mục "Đường render"). 5 ảnh PNG 512×512 tại frame 0/15/30/60/120 (60 fps), 2.5 s cho 5 ảnh. Ảnh đã được mở xem: có laser, hạt, glow đúng texture mẫu. Render 2 lần cho **cùng SHA-256** ở cả 5 frame (tất định). Bản sửa khác bản gốc đúng chỗ kỳ vọng (bảng dưới). |
| G0.6 | **Chạy trong BBS FS 2.7** (gate MVP, tách khỏi cấu trúc/hình/hiệu năng) | BLOCKED | Người dùng chốt hướng 2 (chuyển sang particle BBS) và đích BBS FS **2.7**. Đặc tả ánh xạ + gate xuất: `docs/VFX-BBS-PARTICLE-MAPPING.md`. Converter chưa viết; chưa có thư mục instance Minecraft của người dùng để kiểm trong game. |

Phân biệt: G0.4/G0.5 là kiểm **cấu trúc** và **hình ảnh trong renderer của Effekseer**. Chưa có số đo hiệu năng
trong game và chưa chạy trong Minecraft/BBS; các gate đó vẫn mở.

## Đường render (G0.5)
`.efkefc` → EffekseerCore (`Effekseer.Binary.Exporter`) xuất byte `.efk` trong bộ nhớ → `EffekseerCoreGUI.dll`
(binding `Effekseer.swig`) → `Viewer.dll` native của editor 1.80.6: `IO.Initialize()`, `GraphicsDevice.Create`
(DirectX 11 trên một cửa sổ Win32 **ẩn**, không hiện gì lên màn hình), `EffectSetting` + `SoundDevice`, `EffectFactory.LoadEffect`
(đường dẫn gốc để tìm texture tương đối), camera `ViewPointController` (khoảng cách 15, góc X 20°, Y 30°, phối cảnh, RH)
→ `EffectRecorder` chế độ **Sprite**, 1 ảnh mỗi lần ghi, `OffsetFrame` = frame cần chụp. Đây là cùng bộ ghi mà
menu Recorder của GUI dùng, gọi trực tiếp không qua GUI.

- `Effekseer.exe -cui` chỉ có `-in -o -f -e -m` (xuất), không render; đã đọc chuỗi trong `Effekseer.dll`.
- Không cần EffekseerForWebGL; không tải.
- Thiếu `IO.Initialize()` hoặc truyền `SoundDevice` null → `LoadEffect` crash (0xC0000005 / 0xC0000374). Đã ghi trong code.
- Đầu ra: `<out>/tNNNN.png` + `preview.json` (frame, giây, byte, SHA-256, số pixel khác nền với ngưỡng 8/255).
- Ảnh sinh ra để ngoài repo: `C:\w01-samples\effekseer\work\preview\` (không commit).

### Số đo render `Laser01` gốc và bản sửa (nền 20,20,24)
| Frame (s) | Gốc: pixel sáng | Gốc lặp lại cùng hash | Bản sửa: pixel sáng | Bản sửa lặp lại cùng hash | Bản sửa = gốc | Nền sáng 225,225,230 |
| --- | --- | --- | --- | --- | --- | --- |
| 0 (0.00) | 5 333 | có | 5 333 | có | có | 5 333 |
| 15 (0.25) | 51 704 | có | 51 704 | có | có | 51 688 |
| 30 (0.50) | 84 761 | có | 84 761 | có | có | 84 723 |
| 60 (1.00) | 15 015 | có | 16 021 | có | **không** | 16 016 |
| 120 (2.00) | 0 | có | 0 | có | có | 0 |

Đọc số: tăng `MaxGeneration` của node Particle (60 → 67) chỉ đổi hình khi các hạt sinh thêm xuất hiện, nên frame 60 khác
(+1 006 pixel), các frame trước giống hệt. Frame 120 trống vì hiệu ứng mẫu đã kết thúc trước 2 s (không phải lỗi render;
ảnh vẫn có nền). Trên nền sáng, glow cộng sáng (additive) bị loá trắng — đúng bản chất blend, cần nhớ khi đánh giá hình.

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

## Lệnh chạy lại
```powershell
cd C:\w01-vfx\three-workspace-app\vfx
python -m venv .venv
.\.venv\Scripts\python -m pip install -e ".[dev]"
.\.venv\Scripts\python -m pytest -v                                  # G0.2: 4 passed
$env:EFFEKSEER_AI_BIN_DIR = 'C:\w01-samples\effekseer\1.80.6\Effekseer1.80.6Win\Tool\bin'
$env:DOTNET_ROOT = 'C:\w01-samples\effekseer\dotnet-9.0.21'
$W = 'C:\w01-samples\effekseer\work'                                  # bản sao Sample\00_Basic ở $W\00_Basic
.\.venv\Scripts\python tools\g0_roundtrip.py "$W\00_Basic\Laser01.efkefc" "$W\00_Basic"         # G0.4
.\.venv\Scripts\python tools\render_preview.py "$W\00_Basic\g0_edit.efkefc" "$W\preview\edit"   # G0.5
.\.venv\Scripts\python tools\render_preview.py "$W\00_Basic\g0_edit.efkefc" "$W\preview\light" --background 225,225,230
```
Ghi chú: thư mục làm việc phải nằm cạnh texture của hiệu ứng (đường dẫn tương đối). Sample của Effekseer chỉ dùng để
kiểm, không commit, không đưa vào gói phân phối (license từng sample khác nhau).

## Câu cần người dùng chốt
1. ~~Đường phát VFX trong BBS FS~~ — đã chốt 2026-10-22: hướng 2 trước, khảo sát AAA song song (kết quả khảo sát ở `docs/VFX-BBS-PARTICLE-MAPPING.md` §7). BBS FS đang chơi: 2.7.
2. Bản Effekseer đang dùng thật: 1.80.6 hay khác? Có cài AAA Particles không, bản nào? Thư mục instance Minecraft 1.20.1 Fabric chạy BBS FS 2.7?
2b. Hiệu ứng dùng blend Add (đa số mẫu) chỉ xấp xỉ được trong BBS (không có additive): chấp nhận xuất kèm cảnh báo, hay chặn?
3. Xem preview bằng cách nào: ảnh PNG theo mốc thời gian (đang có), bảng ảnh ghép (Recorder có SpriteSheet), hay GIF/video (Recorder có Gif/AVI/H264, chưa thử)?
4. License mặc định khi tìm asset: chỉ CC0 (đề xuất) hay cho cả CC-BY có ghi công?
5. Push nhánh `claude/vfx-app4-g0` lên origin để Codex cloud dùng được? (Codex cloud chạy Linux, không có Effekseer Windows: chỉ chạy được 4 test, không render.)
