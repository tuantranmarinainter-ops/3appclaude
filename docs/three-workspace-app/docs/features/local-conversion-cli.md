# 1.6.2 — Chuyển đổi local và ma trận định dạng

## Mục tiêu / nguồn
Reuse exporters/importers Animation1.31.8, RetargetV9.12 và Blender bridge hiện có; Python chỉ điều phối converter, validation và atomic output. Không viết parser/solver mới nếu handler nguồn đã đáp ứng.

## Ma trận Input/Output
| Nguồn/profile | Đích/content | Handler / điều kiện |
| --- | --- | --- |
| Retarget Minecraft20 | BOBJ hoặc BOBJ+JSON; model-motion/skeleton-motion | exportBobj/exportBobjV9; Minecraft30FPS, units/basis theo native. Film phải có model mesh, motion-only không tự thành model. |
| Retarget Mixamo65 | GLB; model-motion/skeleton-motion | buildThreeClipFromBake/exportGLB; Y-up,mét; mesh option giữ native. |
| Retarget Mixamo65 | BVH; skeleton-motion | exportBVH; không mesh/texture, degrees/channels/root và native units ghi report. |
| Retarget Mixamo65 | FBX; model-motion/skeleton-motion | exportFbxBridge+Blender local; importer/exporter roundtrip, không browser-only. |
| Animation rig importer hỗ trợ, gồm Metarig/Mixamo/Minecraft | BOBJ/GLB/FBX/BVH theo capability handler | animation_export/bobj_export; profile phải validate; không suy mọi profile đều export mọi format. |
| Motion tham chiếu existing rig | motion | Native project JSON giữ editable data; derivative không mesh chỉ khi format handler có skeleton/action representation. BOBJ/BVH vẫn cần hierarchy; không gọi đó là file không xương. |
| Topview character/prop/pose | Native project/assets và GLB/GLTF import có sẵn | Reuse asset pipeline; Film dùng mesh/rig derivative qua Animation converter; không đổi tên GLB thành BOBJ. |
| MDX/MDL/League/DDS | Import/render native; export bằng handler Animation nếu tương thích | Giữ materials/texture/alpha; unsupported shader/animation channel xuất report hoặc chặn. |
| JSON Blockbench | .bbs.json/.geo.json chỉ qua đúng loader/profile đích | .bbmodel hoặc JSON lạ chưa có reader thì reject có lý do, giữ source. Không hứa generic JSON import. |

Capability thực tế được trả bởi adapter.describeCapabilities() gồm inputKinds/profileFingerprint/output/content/runtime; UI không hardcode bật mọi tổ hợp. Đây là interface mới lấy điều kiện từ handler nguồn, không đoán bằng extension. Hậu tố .ani.fbx/.ani.bobj/.moani.bobj chỉ là filename, không thay schema.

## Lát cắt local đã triển khai — DOC-043

`python -m agent.unified_cli film convert-model SOURCE.fbx|SOURCE.glb --output-dir EXISTING_FOLDER [--unit-meters N]` reuses the pinned BBSFix BOBJ exporter in Blender. FBX requires a finite positive explicit unit; GLB is meters. The converter accepts one armature with at least one linked mesh, up to 512 bones, no shape keys or vertex-color attributes, and zero or one shared image texture (FBX file-backed or GLB embedded PNG/JPEG). It rejects unlinked meshes, unsupported image sources, missing UVs for textured meshes, and multiple texture files with a clear error. It does not convert motion-only files or arbitrary formats.

The output is a new `model-<source-sha12>` directory with `model.bobj`, `profile.json`, and optional `model.png`. The profile records source SHA-256, model ID, unit, bone-parent hierarchy, action names, file paths/hashes, and each exported BOBJ bind/rest matrix as 16 finite row-major values. These matrices are global BOBJ-space binds copied from the `arm_bone` records; they are not animation tracks. Bone names unsafe for BOBJ identifiers are changed to unique safe IDs throughout BOBJ bone, parent, vertex-weight and action-channel tokens; `sourceName` retains the FBXLoader-normalized name used by the Studio skeleton sampler. Blender writes to a temporary child of the chosen existing directory; the caller validates profile dimensions and hashes before moving the whole folder to its final name, and refuses to overwrite an existing package. Limits are 256 MiB input, 512 MiB per output file and 10 minutes per Blender process. Requires Blender 4.2+ (`BBS_BLENDER_EXE` or PATH); no third-party Python package is added.

DOC-043 verified temporary FBX and GLB files generated in Blender 4.2.3, each with a skinned armature and action; the embedded JPEG texture converted to PNG. The output BOBJ/profile/action/PNG, source hashes and source immutability passed. The converted GLB BOBJ and PNG were then accepted by the Java BBS FS 2.4 Film worker, read back through the native codec, and compared byte-for-byte in the exported package. The GLB import also created an unlinked helper mesh in Blender's `glTF_not_exported` collection; the converter excludes that importer-only helper from BOBJ geometry. DOC-044 verifies every reported rest matrix against the exported BOBJ line and rejects missing, non-finite, or incorrectly sized matrices. This converter is local-only: it does not read a shared project, create conversion jobs, export BVH/Retarget formats, preserve multiple material textures, handle shape keys/vertex colors, or prove parity on arbitrary source files. Pose-track baking, third-party GLB conversion and runtime/game acceptance remain unverified.

## Luồng
asset.convert nhận snapshot revision, asset/motion/profile, range/FPS, output/content→preflight dependencies→dry-run/loss report→temp riêng trong destination→export→read-back native loader→validate hash/reference/time/pose→atomic rename thư mục mới. Có file trùng tên dùng jobID khác, không ghi đè. Output files+checksums+tool versions+sourceHashes+loss report. Không mutate source hoặc project cho tới user import derivative qua command riêng.

Blender dự kiến baseline5.1.2 local theo bridge workspace; preflight executable version và required operators/addon. Chưa có tool trả TOOL_UNAVAILABLE, không tự cài. Java17 chỉ cần Film worker; Node>=20.6 cho Topview renderer. Đường dẫn executable cấu hình host, CLI truyền argv array, không shell interpolation.

## UI / lỗi
Dialog input/content/format/FPS/root policy, capability reason và loss preview. Export material không hỗ trợ/skin weights không map/root conflict/unit unknown/timeout/parse failure đều không công bố artifact hoàn chỉnh. Unsupported skin/mesh trong BVH phải ghi loss, không tự chọn BVH cho yêu cầu model-motion. Job cancel xóa temp của đúng job sau kiểm path, không xóa files người dùng.

## Nghiệm thu / tác động
FORMAT-01..02 trong [acceptance](../acceptance.yaml): mỗi ô hỗ trợ có fixture roundtrip; topology/tracks/count/hash/texture/reference/time/pose đúng ngưỡng; missing tool/cancel/duplicate path không làm hỏng source. Lossless project data khác baked derivative. Shared export API phục vụ cả workspace và BBS; không đưa converter dependency vào browser Site.


## CPU range input cho converter — DOC-036

Host helper `sampleProjectSkeletonRange(project,range,characterIds)` nhận snapshot, range inclusive với sampleFps và danh sách CharacterID tường minh, không rỗng/trùng/lạ. Asset/profile phải decode được trước yield; bất kỳ selected Character thiếu source/capability đều chặn toàn bộ range. Nạp nguồn/evaluator một lần, stream từng mẫu kèm sourceRevision và đóng evaluator trong finally, kể cả caller dừng iterator. Không tạo job/artifact hay mutate project trong helper này. Đây là đầu vào cho asset.convert/film.export sau này, chưa phải converter hoàn chỉnh.
