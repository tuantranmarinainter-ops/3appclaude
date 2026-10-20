# Ma trận tái sử dụng

Phân loại theo workspace đích và cách xử lý code. “Đã có” có nghĩa tìm thấy trong source; không khẳng định đã tương thích app mới.

| Nhóm chức năng | Retarget | Scene/Topview | Animation | Dùng chung / xử lý |
|---|---|---|---|---|
| Nhập model/rig | Import FBX/BOBJ, profile 65/20, fingerprint | Catalog/import asset và node character | FBX/GLB/BOBJ, MDX/MDL, textures | Giữ parser/exporter; adapter chung asset identity, unit/axis, texture warnings |
| Chuyển động | Đã trích 85 BOBJ action data và port evaluator/parser; còn retarget hai chiều, mapping/calibration, foot IK, timeline đích, root policy | Pose library và fcurves/node state | Rig/IK, pose, evaluator, graph, easing, layers | Tái dùng engine khác nhau; không hợp nhất evaluator trước golden tests |
| Tạo scene | Chỉ preview Source/Target | Scene graph, transform, props, camera, shots, numerical checks/render | Scene package, actor/clip/marker/contact, camera | Giữ Topview DirectorDocument; Animation scene motion/contacts/library qua adapters, không tạo scene store thứ hai |
| Camera | Hai view chỉnh sửa, không phải shot story | Camera presets, subject view, nhiều góc và camera curves | Scene camera/shot/timeline | Adapter camera/shot chung, nghiệm thu BBS FOV/trục/nội suy |
| Lưu/Undo | Versioned project JSON, validation, Undo/Redo | Entity store, atomic ops, scene sequence/CAS | Project/history/draft và scene schema | Một writer/command boundary; chuyển dữ liệu từ 3 schema qua adapters |
| Xuất | BOBJ, BOBJ+JSON, BVH, GLB; FBX qua Blender bridge | Render PNG/contact sheet; không thấy native scene FBX export | BOBJ, animation FBX/BVH, scene package | Giữ handlers; tái dùng Film/replay/camera và luồng Animation-to-Pose BBS khi tương thích; worker Java17 reuse codec/FilmEditor2.4 đã pin; bổ sung asset/pose export mapping |
| UI | HTML bundled, Retarget-specific panels | Next.js/React Studio 75 file và `@topview/3d-builder` 434 file đã khóa theo v0.1.8 | HTML/CSS/JS mô-đun, workspace UI | Dùng Topview shell/editor làm nền; ánh xạ function/file và kiểm parity trước khi mở rộng UI |
| Agent/CLI | Không thấy CLI riêng ngoài browser project | Python CLI với JSON schemas, dry-run, atomic batch | StudioBridge HTTP mailbox và JS tools | Map vào cùng commands; bảo toàn validation, revisions, timeout/error |

## Hành động theo loại

- **Giữ và wrap:** evaluator, retarget math, mapping/calibration, curve/sample/export logic, BOBJ/FBX/GLB handlers, Topview schema/operation engine và Python CLI.
- **Chức năng chung mới:** ID/refs, SkeletonProfile, scene-project migration, command/revision/undo boundary, unit-axis adapters, shared feature navigation.
- **Riêng Retarget:** profile 65↔20, 85-action test library, source lock, calibration/mapping, timeline/bake theo target profile.
- **Riêng Animation:** rig/controller/IK, pose/layers, onion skin, graph/easing/smoothing, animation import/export, scene motion editing.
- **Riêng Topview:** scene layout, props, poses, cameras/shots, framing/ground/overlap checks, multi-camera rendering và scene CLI.
- **Viết mới/sửa sau audit:** three-workspace navigation, format adapters, shared history/project boundary, migration UI và adapter Film/package/import còn thiếu. Dùng luồng BBS Animation-to-Pose/limb-track đã có cho model tương thích; chưa khẳng định luồng đó dùng được từ app ngoài.

## Không được làm mất

Retarget: 85 animation, hai chiều, mapping/calibration, chỉnh khớp/hand/foot, root motion, target timeline, project JSON, Undo/Redo, các format xuất. Animation: rig/pose/controller, IK, timeline/graph/layer, motion editing, importer và exporter; không giả định mọi test lịch sử áp dụng 1.31.8. Topview: mọi chức năng scene/asset/camera/CLI/render hiện hành; source tag và tests đã có trong checkout nhưng UI/runtime chưa chạy và file/symbol index đã có; behavioral/runtime coverage còn phải kiểm.

## Hạn chế tái sử dụng

- Giữ nguyên khối HTML 11 MB làm module React sẽ khóa giao diện và trộn UI với logic; chỉ dùng artifact ấy làm golden behavior/reference, trích engine thành modules.
- Scene package Animation Studio hiện không phải Film native BBS FS; không đổi tên manifest thành Film.
- Topview code khai báo Apache-2.0; built-in characters/poses/covers có điều khoản CC-BY-4.0 và package còn liệt kê OFL-1.1. Kiểm các license/NOTICE theo revision và từng asset/font/vendor trước khi sao chép.

## Quyết định xử lý mới và lý do không giữ nguyên

| Workspace/phạm vi | Xử lý | Lý do / đặc tả |
| --- | --- | --- |
| Shared | Thêm IDs/native motion bindings/broker/global history | Ba project/history độc lập; [contract](features/shared-project-contract.md) |
| Shared UI | Thêm selector/search/transitions trong Topview overlay | Không app nguồn nào có ba workspace hợp nhất; [shell](features/workspace-integration.md) |
| Retarget | TríchJS,typed adapter; Metarig mapping/skin derivative mới | Bundle DOM/global không mount nguyên làm React;65↔20không chứng minh Metarig/rebind; [retarget](features/retarget-workspace.md) |
| Scene | Giữ builder/evaluator/HostAdapter, thêm Character/Motion bindings | Tránh rewrite; native IDs chưa biết shared profile/native motion; [scene](features/scene-workspace.md) |
| Animation | Giữ41JSruntime files, adapters cho UI/state/history | Không mất rig/layer/graph/importers; [animation](features/animation-workspace.md) |
| CLI | Giữ legacy commands, unified client+job manager mới | Python/React không được hai writer; [API](features/local-agent-api.md) |
| BBS | Reuse BbsCodec/FilmEditor binary+DraftEditor; worker/pose mapping mới | Scene manifest không native, importer cũ bỏscale và thiếu editable pose; [Film](features/bbs-film-export.md) |

Mỗi source module có source_module_key/target_ids và mỗi development item có merge_action/reuse_rationale. Status code presence, historical evidence, runtime và user acceptance được tách; không gán complete chỉ vì source có hàm.
