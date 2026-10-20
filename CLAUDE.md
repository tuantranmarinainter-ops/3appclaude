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

## Việc tiếp theo (theo thứ tự)
1. Đọc `setup-report.txt`, sửa test đang FAIL (nếu có).
2. Thêm CLI headless `normalize` gọi thẳng `packages/retarget`, không cần host/project:
   `normalize --src <file> --target <mixamo65.glb> --out <dir> [--preview]`
   → GLB + manifest JSON + report JSON (+ preview.png contact sheet).
3. Sửa 3 điểm lệch hợp đồng GLB v1.0.0: bỏ prefix `mixamorig:` ở output; nhiều Action trong
   một GLB; xuất manifest JSON riêng cạnh GLB.
4. Chạy với file nguồn thật đầu tiên người dùng cung cấp.