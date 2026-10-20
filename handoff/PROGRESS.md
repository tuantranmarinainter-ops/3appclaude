# Workspace 1 — Progress bàn giao

## Mốc mới nhất được đối chiếu

DOC-116 ngày 2026-10-20 ghi nhận sửa lỗi quaternion trong local-compose, thêm kiểm thử hai topology nguồn về canonical Mixamo65 và kiểm tra Assignment chỉ tác động Character C. Các thay đổi này có trên source đang đóng gói. Thông báo FAIL ở lần dừng trước đã được thay thế bằng bằng chứng mới này.

Lượt đóng gói chỉ chạy lại một test tập trung:

`node --experimental-strip-types --test --test-name-pattern='local chain composition' packages/retarget/test/universal.test.ts`

Kết quả: **1 PASS, 0 FAIL**. Không chạy lại toàn bộ suite, production build, browser hoặc game trong lượt đóng gói.

## Bằng chứng trong DOC-116 — không phải tất cả được chạy lại lúc đóng gói

| Nhóm | Kết quả đã ghi |
| --- | --- |
| Retarget package | 59 PASS |
| Studio normalization/import tập trung | 33 PASS, 1 SKIP |
| Python CLI/MCP | 47 PASS |
| Builder evaluate | 557 PASS, 1 SKIP |
| Workspace typecheck | PASS khi chạy tuần tự sau Builder build |
| Lint và locale | PASS |
| Production build | Builder đạt; Studio Next bị EPERM scandir AppData/Local/Application Data |
| Offline smoke | Chưa có lượt hợp lệ sau production build thành công |
| Rig thật CC/UE, browser/WebGL và game của W01 | Chưa xác minh |

## Cách đọc tiến độ

Inventory phần bổ sung vẫn ghi **0/17 task hoàn tất**, gồm 15 task code/kiểm tra và 2 task fixture/runtime. **0/8 gate nghiệm thu** được chấp nhận. Những con số này đo việc đóng trọn task/gate, không phải tỷ lệ số dòng code đã viết. Nhiều phần có code và bằng chứng tự động nhưng chưa đạt toàn bộ điều kiện đóng mục.

Code gồm import/inspect nhiều skeleton, identity, diagnostics Action, budget, mapping 65 joint, chain weighting, reference/calibration, plan/job/report, GLB derivative, skin transfer/rebind, Assignment và history. Local-compose có sửa solver và regression PASS; không suy ra toàn bộ schema, UI, preset, metrics và runtime của task đó đã đồng bộ hoàn chỉnh. Có thể còn khác biệt giữa các lớp; giữ nguyên source để người nhận kiểm tra theo đặc tả.

## Danh sách bàn giao theo inventory

| ID | Nội dung | Trạng thái implementation trong inventory |
| --- | --- | --- |
| 1.3.4.1.1 | Khóa fixture thật và reference | remaining_scope_not_completed |
| 1.3.4.2.1 | Identity và chọn skeleton | partial_identity_and_multi_skeleton_import_selection |
| 1.3.4.2.2 | Capability, losses và budget | partial_action_import_diagnostics_and_bake_budget |
| 1.3.4.2.3 | Preview mesh và review sai lệch | remaining_scope_not_completed |
| 1.3.4.3.1 | Calibration reference pose và persistence | partial_universal_reference_calibration_persistence_preview |
| 1.3.4.3.2 | Chain local composition | partial_solver_regression_fixed |
| 1.3.4.3.3 | Proportion và end-effector constraints | remaining_scope_not_completed |
| 1.3.4.3.4 | Gợi ý mapping hierarchy và geometry | remaining_scope_not_completed |
| 1.3.4.4.1 | Fit rig65 theo model nguồn | remaining_scope_not_completed |
| 1.3.4.4.2 | Exclusion policy và animated skin loss | remaining_scope_not_completed |
| 1.3.4.5.1 | Action range batch và channel policy | remaining_scope_not_completed |
| 1.3.4.5.2 | Quality report độc lập và roundtrip | remaining_scope_not_completed |
| 1.3.4.6.1 | Assignment add/replace và isolation | remaining_scope_not_completed |
| 1.3.4.7.1 | Model gửi Scene atomic | remaining_scope_not_completed |
| 1.3.4.7.2 | Export reimport và material fidelity | remaining_scope_not_completed |
| 1.3.4.8.1 | Khôi phục gate kiểm tra code | partial_builder_layer_and_test_runner_fixed_next_build_blocked |
| 1.3.4.8.2 | Runtime đa nguồn và nghiệm thu | remaining_scope_not_completed |

## Điểm cần biết khi tiếp nhận

- RigGraph nguồn linh hoạt không đồng nghĩa tất cả native format hoặc topology đều được chuyển lossless.
- Chưa có kết luận runtime đa nguồn thực và chưa nghiệm thu toàn bộ Workspace 1.
- Production build đang có lỗi môi trường/tracing đã ghi; gói source không phải executable chạy ngay.
- Đối chiếu `workspace01-remaining.md` và LISTCODE trước khi tiếp tục; không lấy các bằng chứng Animation Creation/Film của workspace khác làm bằng chứng W01.
- Lượt bàn giao không cấp phép khởi động lại việc code, game, commit hoặc phát hành. Phạm vi lượt này là đóng gói code và tiến độ hiện có.
