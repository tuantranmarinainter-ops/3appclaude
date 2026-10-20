# Mục tiêu và phạm vi hiện hành

**Yêu cầu mới 2026-10-19, triển khai được duyệt:** Workspace01 là Universal Animation Retargeting Engine: rig nguồn có số lượng/tên/hierarchy bất kỳ → Mixamo65; giữ animation và tùy chọn chuyển skin/model; Animation Assignment gán lên nhân vật tương thích khác. MVP ít nhất hai rig nguồn khác nhau, không ràng buộc115 xương. Giữ nhóm tương thích V9.12. [Thiết kế và MVP](features/rig-animation-normalization.md) là phạm vi hiện hành; DOC-116 ghi bằng chứng solver/test và giới hạn runtime đang mở. Bảng phạm vi cũ bên dưới là baseline, không giới hạn nguồn chỉ Mixamo/Minecraft.

## Yêu cầu đã chốt

Một app PC local, giao diện browser, TypeScript/React/Three.js và Python CLI; giữ Next.js/pnpm/ranh giới package Topview. Ba workspace Retarget–Scene–Animation cùng một project, asset/character/skeleton/scene/timeline/camera và history. Nguồn Animation1.31.8, RetargetV9.12, TopviewCLI/source0.1.8; khóa ở [SOURCES](SOURCES.yaml).

| Workspace | Input | Chức năng | Output |
| --- | --- | --- | --- |
| Retarget | Rig/model/animation, Metarig/Mixamo65/Minecraft20; format importer hỗ trợ | Mapping/calibration, retarget hai chiều nguồn có sẵn, chuẩn hóa profile; Metarig cần adapter mới | Target rig/motion, derivative model nếu weights map hợp lệ; source giữ nguyên |
| Scene | Characters/props/poses/motions | Topview layout/scene graph/camera/shot/path/check/render | Scene và camera đúng scale/time, cùng IDs |
| Animation | Character/rig/motion trong scene | Pose/IK/keys/layers/graph/library/motion tools/import/export | Native editable motion và scene hoàn chỉnh |

Giữ tất cả chức năng đang hoạt động, ưu tiên JS adapter có kiểu rồi chuyển TS theo module; không viết lại solver/parser/evaluator tùy tiện. Metarig, Mixamo65 và Minecraft20 là mục tiêu; Minecraft25 đã loại khỏi phạm vi hiện hành. Phần trao đổi ban đầu nhắc25 được lưu như lịch sử ở HISTORY, không còn là yêu cầu.

Film BBS FS2.4/MC1.20.1 phải chứa cảnh/assets/characters/motion/camera. Playback và editable keyframe là hai điều kiện riêng. Pin source2.4 bằng commit, không dùng checkout HEAD2.7. Không giả định arbitrary rig/format luôn chuyển lossless. Giữ source project; báo mất mát/unsupported fields rõ.

## Thiết kế cụ thể của đặc tả

11đặc tả [features](features/), [schema dữ liệu](contracts/project-v1.yaml), [API](contracts/commands-v1.yaml), [28đầu việc](inventory/development.yaml), [33ca nghiệm thu](acceptance.yaml), [fixtures](fixtures/manifest.yaml) là bản thiết kế để review/code theo từng phạm vi được duyệt.

Các lựa chọn kỹ thuật đã ghi rõ: shell overlay Topview/tiếng Việt mặc định; Y-up/mét cho scene và native rig basis ở adapter; Topview native document/timeline; Node broker một writer+exact CAS/history; motion native blobs để giữ edits; Film dùng Java17 worker reuse codec đã pin do Python chưa có serializer tương thích. Đây là quyết định thiết kế đề xuất trong hồ sơ, chưa phải bằng chứng triển khai hoặc người dùng nghiệm thu từng chi tiết.

Hậu tố .ani.fbx/.ani.bobj/.moani.bobj chỉ dùng làm tên gợi ý; content option xác định model-motion/skeleton-motion/motion. JSON Blockbench phải nhận diện schema, không hứa đọc mọi JSON. Rig thêm xương/skin weights không map phải báo lỗi, không tự bỏ xương.

## Quyền và nghiệm thu

Người dùng đã duyệt triển khai toàn bộ LISTCODE 1.1–1.7 trong bản sao ứng dụng `three-workspace-app/`; hiện các mục vẫn partial cho tới khi có đủ evidence theo acceptance. Không sửa source Animation/Retarget/Topview gốc, không commit/publish/release và không chạy game. AGENTS đã áp dụng65dòng. Nghiệm thu dùng thresholds/steps trong acceptance, không dựa nút UI hay build/API thành công.

Ca xuyên suốt FX-E2E:2characters,3giây,1camera qua3workspace→Film; sửa key tick30 rồi lưu/mở lại. Spec có expected analytic; chưa tạo/run Film golden. Mỗi bản Animation mới sau triển khai có Site owner-private riêng/version/hash, chỉ public khi được yêu cầu.

Tên thương mại app và thư mục triển khai mới chưa chốt; không cản đặc tả. Trước code chọn workspace đích mới trong phạm vi được duyệt, giữ apps nguồn. Các giới hạn chứng cứ (runtime, source behavior audit sâu, rights assets, fixture recipe chưa tạo) ở STATUS và SPEC_READINESS; không coi chúng là tính năng đã đạt.
