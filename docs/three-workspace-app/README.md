# Ứng dụng ba workspace

**Workspace01 hiện tại:** [Kế hoạch và đặc tả phần còn thiếu W01-PLAN-003](docs/features/workspace01-remaining.md), [17 task YAML](docs/inventory/workspace01-remaining.yaml), [LISTCODE](LISTCODE). Chỉ lập tài liệu; baseline code DOC-108, runtime chờ fixture và chưa gate nào được nghiệm thu.

Hồ sơ kiểm kê và kế hoạch hợp nhất Animation Studio, Retarget Lab, Topview 3D Builder và xuất BBS FS. App hợp nhất đã có implementation một phần; bằng chứng runtime và giới hạn hiện hành nằm ở STATUS, chưa hoàn tất workflow MVP.

**Đề xuất đang chờ duyệt:** [tích hợp Animation Creation gốc](docs/features/animation-creation-integration.md), [9 task triển khai và nghiệm thu](ANIMATION_CREATION_TASK_PLAN.md). Workspace 03 hiện có Topview/placement, chưa có native creation; task mới không tự cấp quyền code.

Đọc [quy ước](AGENTS.md) → [trạng thái](docs/STATUS.md) → [nguồn](docs/SOURCES.yaml) → [yêu cầu](docs/PROJECT.md) → [bản đồ code](docs/CODEMAP.md).

## Cấu trúc

- [Kiến trúc](docs/ARCHITECTURE.yaml), [kế hoạch giai đoạn](docs/ROADMAP.md), [bảng tái sử dụng](docs/REUSE_MATRIX.md).
- Inventory: [Animation](docs/inventory/animation.yaml), [Retarget](docs/inventory/retarget.yaml), [Topview](docs/inventory/topview.yaml), [dữ liệu chung](docs/inventory/shared.yaml).
- [LISTCODE](LISTCODE), [đặc tả](docs/features/), [lịch sử](docs/HISTORY.md), [checkpoint](docs/CHECKPOINTS.md).

Animation Studio và Retarget được khóa hash cho source/artifact cục bộ. Toàn bộ Topview v0.1.8 đã được checkout tại `.build-tools/topview-3d-builder-v0.1.8` theo commit `631c08c8fd352b4ff83df33aa9a74a4563f4674b`; inventory bao gồm Studio TypeScript/React, builder Three.js, CLI, tests và assets. Các test và UI/WebGL smoke từng phạm vi được ghi ở [STATUS](docs/STATUS.md) và [CHECKPOINTS](docs/CHECKPOINTS.md), không suy ra full runtime parity. [SOURCES.yaml](docs/SOURCES.yaml) và [CODEMAP](docs/CODEMAP.md) ghi nguồn cùng giới hạn còn lại.

## Bản đặc tả hoàn thiện ngày2026-10-18

[Báo cáo hoàn thiện](docs/SPEC_READINESS.md), [28đầu việc YAML](docs/inventory/development.yaml), [schema dữ liệu](docs/contracts/project-v1.yaml), [API](docs/contracts/commands-v1.yaml), [33ca nghiệm thu](docs/acceptance.yaml), [fixtures](docs/fixtures/manifest.yaml) và [kết quả kiểm docs](docs/evidence/docs-validation.yaml).

AGENTS giữ65dòng. Đặc tả hoàn thiện không có nghĩa app đã được code hoặc kiểm game; phần chưa kiểm và nguồn đúngrevision được ghi riêng.
