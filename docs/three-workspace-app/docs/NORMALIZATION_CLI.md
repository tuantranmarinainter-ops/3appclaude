# Normalization CLI

`rig plan` and `rig run` accept optional `--root-translation-scale` in `[0.01, 20]`. `1` preserves source root travel in meters; another value scales only preserved root translation. The value participates in the plan hash and job report, and is ignored by the `in-place` root policy. MCP clients pass the same setting as `args.rootTranslationScale`.

Chạy từ thư mục `three-workspace-app`, với local Studio đang mở và `BBS_APP_URL` trỏ loopback host. Thay các placeholder bằng IDs/hash/revision nhận từ host.

```powershell
python -m agent.unified_cli rig inspect PROJECT_ID SOURCE_ASSET_ID
python -m agent.unified_cli rig plan PROJECT_ID SOURCE_ASSET_ID TARGET_ASSET_ID MAPPING_ID --action-index 0 --fps 30
python -m agent.unified_cli rig run PROJECT_ID SOURCE_ASSET_ID TARGET_ASSET_ID MAPPING_ID --action-index 0 --fps 30 --plan-sha256 PLAN_SHA256 --expected-revision REVISION
```

Run trả jobId; theo dõi qua API chung `job.get`, hủy bằng `job.cancel`. CLI này chưa có lệnh polling/download normalization riêng. Khi job succeeded và project còn nguyên revision nguồn:

```powershell
python -m agent.unified_cli rig save PROJECT_ID JOB_ID --expected-revision REVISION
```

Save gọi `asset.import {normalizationJobId}`, trả Motion/Asset/Profile IDs và revision mới, có history Undo/Redo. Nếu project đã đổi, host từ chối kết quả cũ; lập plan và chạy lại. Đây là animation-only.

Assignment nhận một Motion canonical65 và Character canonical65. `assignment-plan` trả sample budget/hash; `assignment-run` yêu cầu hash và revision, tạo job derivative riêng. Commit kiểm lại snapshot rồi atomically lưu asset/Motion, đặt clip tiếp sau clip cuối của Character và tạo Binding; có thể chỉ định frame start. Undo/Redo áp dụng toàn bộ transaction.

```powershell
python -m agent.unified_cli rig assignment-plan PROJECT_ID MOTION_ID CHARACTER_ID --fps 30
python -m agent.unified_cli rig assignment-run PROJECT_ID MOTION_ID CHARACTER_ID --fps 30 --plan-sha256 PLAN_SHA256 --expected-revision REVISION
python -m agent.unified_cli rig assignment-save PROJECT_ID JOB_ID --expected-revision REVISION
```

Panel Retarget cũng cung cấp plan/run/cancel/commit. CLI/MCP forwarding và host synthetic assignment đã qua test; trình duyệt/WebGL, receiver fixtures bên ngoài, model+skin output và game playback chưa được kiểm.

Kiểm CLI: `python -m unittest agent.test_unified_cli agent.test_unified_mcp` từ `three-workspace-app`. Test forwarding không thay bằng chứng host/runtime.
