---
name: app4-vfx-runtime
description: App 4 VFX — code giao Codex; Claude trên Windows chỉ chạy phần cần máy thật; đường dẫn Effekseer/.NET và cách render
metadata:
  node_type: memory
  type: project
  originSessionId: 25423a2b-785b-4be3-88e5-05f76e8b870c
  modified: 2026-10-22T02:10:17.149Z
---

App 4 VFX (Effekseer, `three-workspace-app/vfx/`): người dùng chốt 2026-10-22 rằng **toàn bộ code mới giao Codex**.
Session Claude trên máy Windows chỉ chạy phần cần máy thật (DLL Effekseer, render, thử trong BBS FS 2.7) và review PR Codex khi được nhờ.
Đưa VFX vào BBS FS = chuyển sang particle Snowstorm của **BBS FS 2.7** (chốt lại 2026-10-22 vì 2.4 vẽ particle không blend; 2.4 chỉ đối chiếu). Blend Add: phương án 2 (alpha theo độ sáng + lõi trắng + emitter quầng ~1.9x size, ~0.55x alpha), kèm cảnh báo, không sửa mod. Instance người dùng S:\Minecraft\Minecraft Forge-1.20.1 chỉ đọc, chưa có jar 2.7.

**Why:** Codex cloud chạy Linux không có Effekseer, nên phần render/DLL/game phải chạy trên máy này.

**How to apply:** runtime ngoài repo: `EFFEKSEER_AI_BIN_DIR=C:\w01-samples\effekseer\1.80.6\Effekseer1.80.6Win\Tool\bin`,
`DOTNET_ROOT=C:\w01-samples\effekseer\dotnet-9.0.21` (bắt buộc, máy không có .NET 9 hệ thống). Render: `vfx/tools/render_preview.py`
(Viewer.dll EffectRecorder, cửa sổ ẩn; cần `swig.IO.Initialize()` + SoundDevice). pytest cần `--basetemp` trong scratchpad (sandbox chặn %TEMP%).
Báo cáo: `docs/VFX-G0-REPORT.md`, đặc tả: `docs/VFX-BBS-PARTICLE-MAPPING.md`. Xem thêm [[three-app-pipeline]].
