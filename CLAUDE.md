# CLAUDE.md - App 1: Chuẩn hóa Rig & Animation (Workspace 01)

## Phạm vi hiện tại
- CHỈ làm App 1 (Workspace 01). KHÔNG sửa Topview (`packages/builder`) hay Animation Studio,
  trừ khi người dùng yêu cầu rõ.
- Mọi quyết định đã chốt nằm trong `docs/DECISIONS.md`. Đọc file đó trước khi làm.
- Hồ sơ Codex để lại: `handoff/PROGRESS.md`, `handoff/CHECKPOINT.json`,
  `docs/three-workspace-app/docs/features/rig-animation-normalization.md`,
  `docs/three-workspace-app/docs/features/workspace01-remaining.md`.
- Quy tắc gốc của Topview: `three-workspace-app/editor/AGENTS.md` (tiếng Trung). Vẫn tuân theo
  phần ranh giới package/host, không fetch trong `packages/builder`, không commit binary ngoài
  `builtin-assets/`, không regenerate golden.

## Bản đồ code W01
| Vị trí | Vai trò |
| --- | --- |
| `three-workspace-app/editor/packages/retarget/src/` | Solver universal, mapping/preset, calibration, bake, GLB export, skin, Assignment |
| `three-workspace-app/editor/packages/retarget/test/` | Test thuật toán |
| `three-workspace-app/editor/apps/studio/src/` | Host/broker, project store, normalization plan/job |
| `three-workspace-app/editor/apps/studio/app/workbench/components/normalization/` | UI W01 |
| `three-workspace-app/editor/apps/studio/test/` | Integration test |
| `three-workspace-app/agent/` | Python CLI/MCP |
| `three-workspace-app/builtin-assets/characters/` | 4 nhân vật Mixamo65 T-pose (đích + nhân vật C) |

## Lệnh (chạy từ `three-workspace-app/editor`)
```powershell
pnpm install --frozen-lockfile
pnpm --filter @topview/3d-builder build          # cần trước typecheck/test Studio
pnpm typecheck
pnpm --filter @topview/3d-builder exec tsx --test <đường dẫn tuyệt đối tới *.test.ts>
pnpm dev                                          # Studio tại http://127.0.0.1:3002
```
Python (từ `three-workspace-app`): `python -m unittest agent.test_unified_cli agent.test_unified_mcp`

## Cách làm việc
- Ưu tiên debug nhanh: mỗi thay đổi phải chạy được bằng lệnh, có report số đo; không tuyên bố
  PASS chỉ vì UI render.
- Trạng thái gate: NOT_RUN / BLOCKED / FAIL / PASS (FAIL chỉ khi đã chạy và vi phạm).
- Không sửa file nguồn của người dùng; kết quả là derivative mới.
- Trả lời người dùng bằng tiếng Việt, ngắn gọn.

## Trạng thái (2026-10-20)
- Xong: CLI headless `packages/retarget/cli/normalize.ts` (GLB hợp đồng v1.0.0 nhiều Action + manifest + report +
  preview), calibration A/T + facing, family mixamo/ue/cc/lol/wc3r/wow/minecraft20, nguồn và đầu ra `.bobj`
  Minecraft20 (`--bobj`). Kết quả 28 mẫu thật: `docs/REPORT-cli-normalize-2026-10-20.md`.
- Mẫu thật nằm ngoài repo (chỉ đọc, không commit): `C:\w01-samples`,
  `C:\Users\Administrator\Downloads\MODEL WARCRAFT\NAP MODEL CHO CLAUDE`, `C:\Users\Administrator\wow.export\creatures`.

- Xong đợt điều phối 2026-10-20 (đặc tả `docs/W01-TASKS-2026-10-20.md`): T1 đo chân/root, T2 `--mode model`
  (nguồn Mixamo), T3 gate test Studio, T4 mapping theo geometry, T5 **App 1 Workbench** (UI web cục bộ).
- Chạy Workbench: từ `packages/builder`: `node --import tsx ../retarget/workbench/server.ts --port 3101`
  → `http://127.0.0.1:3101` (hướng dẫn: `packages/retarget/workbench/README.md`).

## Việc tiếp theo
1. Fit rig65 theo model nguồn cho `--mode model` non-Mixamo (PLAN .4.1), refit mesh (`MODEL_NOT_REFIT`).
2. Foot lock/IK dựa trên số đo T1; xử lý `FOOT_SLIDE` cho chu kỳ tại chỗ.
3. Chọn range Action; preview mesh trong Workbench cho nguồn `.bobj`; huỷ lượt chạy.
4. Người dùng kiểm `.bobj` trong BBS FS thật và dùng thử Workbench.