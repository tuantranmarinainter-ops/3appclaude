# 1.2.1–1.2.5 — Dữ liệu và giao dịch chung

## Mục tiêu / nguồn tái dùng
Một project, một scene, một lịch sử cho ba workspace. Giữ DirectorDocument/HostAdapter Topview0.1.8, native motion projects Animation1.31.8 và RetargetV9.12; không flatten curves khi lưu vì sẽ mất easing/IK/layers.

Hợp đồng chuẩn: [project-v1.yaml](../contracts/project-v1.yaml) có field/type/default/validation, storage, axes/time/root motion; [commands-v1.yaml](../contracts/commands-v1.yaml) có arguments/result/errors, transport, transaction và ví dụ. Giai đoạn C dùng lại Zod schema công khai của Topview cho DirectorDocument và compact fcurves, giữ kiểm tra ID node duy nhất, project v1 và JSON boundary; shared validator kiểm tra group parent/children tham chiếu đúng và không có chu trình. Kiểm tra các tham chiếu timeline/camera và adapter trục/đơn vị còn thiếu. Store đã có local binary staging và immutable GLB v2/embedded-resource glTF/PNG/JPEG import; glTF skin hierarchy tạo profile `custom-preserved` có fingerprint riêng, còn `character.add` tạo shared CharacterID cùng Topview node trong một revision. FBX source/model/clip import và fingerprint đã có subset kiểm chứng; BOBJ/MDX import, full native fingerprint/mapping/root parity và migration copy blob vẫn chưa hoàn tất.

## Chức năng và Input/Output
| ID | Input → xử lý → Output | Tái dùng / phần mới |
| --- | --- | --- |
| 1.2.1 | Asset bytes + metadata → hash/importer/fingerprint → Asset/Profile; đặt vào scene → CharacterID riêng | Giữ core.makeRig/fingerprint, sourceFingerprintForFbxV99; thêm shared identity. Không thay native fingerprint trong validator cũ. |
| 1.2.2 | Native transform + basis/unit → adapter → Topview nodes; inverse khi đọc về | Giữ scene graph upstream và scene_studio.placement/minecraftRotation; thêm conversion boundary. |
| 1.2.3 | Source motion + native edit + placement → evaluator → pose/root tại source time | Giữ core.evaluate, scene_evaluator, Retarget evaluator, Topview evaluator; binding mới nối các bên. `motion.place` hỗ trợ FBX clip cùng skeleton fingerprint/đơn vị, source range, reverse, tốc độ và loop; root-motion/alignment và khác-rig retarget chưa được thực thi. |
| 1.2.4 | Camera curves + editorial sequence → Shot → render/export | Giữ camera/path/subject/fcurve semantics upstream, không thêm camera store. |
| 1.2.5 | Gesture/CLI request + revision → validate/journal/commit → revision và undo record | Reuse native operations trong shared transaction; broker/history mới vì ba history cũ độc lập. |

DOC-051 verifies one representable transform case for `node.reparent`: static primitive world space remains stable when moved between equally rotated groups with different nonuniform scales, while Undo and keyed-node rejection remain covered. DOC-052 adds the import-side source-to-scene orthonormal basis: `asset.import.basis` is saved with the source profile/model metadata and applied once around Character, Prop and CPU-evaluation source objects; project validation rejects invalid metadata and Character/profile mismatches. DOC-053 carries the same basis through BOBJ model conversion and rest-relative pose baking; browser root-trajectory playback with nonidentity basis remains unverified. Cross-version Three.js object/skin/material parity and full DATA-02 acceptance remain open. [Evidence](../evidence/scene-parent-transform.yaml), [basis adapter](../evidence/scene-basis-adapter.yaml) and [Film basis bake](../evidence/film-basis-bake.yaml).

## Luồng và quy tắc
Source asset bất biến. Hai CharacterID chung asset vẫn có node/edits riêng; sửa motion mặc định clone-on-edit. `motion.place` lưu clip index FBX, source in/length, reverse, thêm clip và MotionBinding trong một revision; tốc độ 0.01–16x điều chỉnh độ dài timeline, loop ghi vào Topview playback fields, clip chồng lấn được đẩy theo quy tắc sẵn có. Chỉ cho phép cùng skeleton fingerprint và đơn vị, chưa áp dụng Retarget mapping. Xóa node/clip có references mặc định bị chặn; UI liệt kê phụ thuộc để chọn xóa trọn nhóm trong một transaction.

Topview sở hữu scene/timeline/camera; shared giữ profiles/native motion/bindings. Z-up Animation scene đổi thành Y-up (x,z,-y); rig thiếu unit phải chọn và lưu. Không nhân actor placement với model unit lần nữa. Root policy loại trừ nhau đối với cùng delta; trajectory lấy delta ra khỏi skeleton trước khi đưa vào node.

`motion.binding.set` đã nối vào broker/UI/CLI/MCP cho FBX cùng fingerprint/đơn vị. Lệnh giữ ClipID, sửa native clip và shared binding trong cùng revision; clipPatch chứa frameStart/frameEnd inclusive và speed/loop. Không có frameEnd thì bảo toàn span cũ, source range không tự đổi span. Lệnh kiểm clip chồng lấn, Character bị khóa, dữ liệu nguồn, stale revision và unknown fields. Root-motion/alignment/fade chưa được evaluator thực thi phải trả capability error thay vì lưu cấu hình không có hiệu lực.

Frame end Topview inclusive; 3s@30 là0..89. Camera curves tính ms. Film20Hz thêm boundary sample tick60 nhưng shot vẫn60tick. Bone quaternions giữ native interpolation; scene Euler độ giữ winding, không reset góc ±180 âm thầm.

Một gesture/Apply là một command. Cancel, Undo, failed CAS phục hồi native preview từ committed snapshot. Job bake kết thúc khi revision thay đổi phải revalidate trước attach, không ghi đè edits mới.

## UI / API
Inspector hiển thị asset/character/profile/unit/root policy/source-edit; missing assets/mapping có đường dẫn field. History global có nhãn hành động/nguồn UI hoặc CLI. Save indicator hiển thị revision durable/job đang chạy. Mutation bắt buộc expectedRevision; đổi selection/playhead/workspace không tạo revision.

## Lỗi
Reject ID/cycle/hash/profile/root conflict/unknown version; lỗi IO giữ manifest trước. Writer thứ hai read-only. Timeout query requestId, không tạo nhân vật lần2. Unknown fields được giữ nhưng không đồng nghĩa editor/evaluator hỗ trợ.

## Nghiệm thu / tác động
[acceptance](../acceptance.yaml): DATA-01..04, HISTORY-01..02, E2E-01. ID bền, coordinate roundtrip đúng ngưỡng, root chạy1 lần, stale/duplicate không ghi lần2, Undo xuyên workspace và save/reopen đúng. Mọi workspace/CLI/export phụ thuộc contract; thay version cần migration.

## Tương thích Three.js

FBX có mesh là Asset kind=model và vẫn được Motion tham chiếu; motion-only FBX giữ kind=motion. `extensions.assetImportModels[AssetID]` giữ format/metersPerUnit. Character node có modelFormat/modelUnitMeters/preserveMaterials và rig=direct; profile phải thuộc source model, unit phải khớp profile. Prop dùng unit đã lưu khi import. Các trường bổ sung không đổi manifest version; runtime wrapper giữ model transform và chuyển unit tách khỏi actor placement. Reimport nâng source-only kind phải qua transaction/history.


Topview dùng0.184; Retarget HTML pin0.186.1; Animation embedded core ghiREVISION186 (không suy patch). Native evaluators giữ objects riêng và trả numeric arrays/asset descriptors; host dựng Object3D/Skeleton/Material của phiên bản host. Không truyền object qua hai bản Three hoặc ép đồng loạt import version để build qua. Dùng cùng fixture kiểm pose/skin/materials trước khi bỏ isolation. Đây là phần adapter trong1.2.2/1.5.3, không tạo renderer active thứ hai.


## Incremental implementation — DOC-033

DOC-033: in-place cho FBX direct rig qua motion.binding.set và form Sửa clip; root translation/quaternion về rest theo SkeletonProfile, giữ limb animation, unit và actor placement. Native rootMotion/inPlace và shared binding được ghi cùng transaction; validation chặn sai bone/policy/rig và document.replace xóa policy. Builder 93 files/539 tests; Studio/shared/Retarget 37/37 với FBX thật; build/typechecks/targeted lint đạt. Browser Chromium153 xác nhận root rest tại frame30/40, actor(2,0,0), tay đổi pose, Undo/Redo, clone/reload và 0 external requests. Trajectory/alignment/fades, cross-rig bake, native Animation và Film/game chưa hoàn tất; clone500 ngắt quãng và production build EPERM chưa sửa.

Optional native `MotionClip.motion.rootMotion={policy:skeletal|in-place,boneName}` projects the shared policy into the engine; `inPlace` matches it. Bone name comes from the target SkeletonProfile rootBoneId. In-place removes all root translation/rotation relative to rest; root scale and non-root tracks remain. UI exposes the mode when editing an existing binding; initial placement defaults skeletal. Legacy drafts without the optional field retain their previous playback. This subset does not establish continue endpoint chaining acceptance.


## Incremental implementation — DOC-034

DOC-034: trajectory cho imported direct FBX tách root translation/rotation sang motionRoot dưới actor; placement/path authored không bị ghi đè. Native interpolants và rest/unit hierarchy được tái sử dụng. Loop tích lũy cả góc xoay, reverse/trim/speed giữ fractional time, origin dùng anchor nguồn và continue nối end-exclusive endpoint clip trước; seek/gap không dựa frame đã render. Shared binding/native metadata cùng revision/history; provenance path trùng nguồn trả ROOT_MOTION_CONFLICT; overlap và loop count vượt precision bị chặn. 93 file/542 Builder test; Studio/shared/Retarget37/37; build/typechecks/targeted lint đạt. Browser FBX thật đạt skeletal→trajectory world-matrix parity, max delta6.625060056109078e-9, seek lùi/reload và0 external requests. Chưa có headless root bake/export, general skeletal alignment, fades, khác-rig bake, native Animation hay Film/game acceptance; camera follow và gizmo/autosave trajectory chưa kiểm. Clone500/production EPERM chưa sửa.

Native projection: `rootMotion={policy:skeletal|in-place|trajectory,boneName,alignment?:origin|continue}`. Let D(t) be root delta in actor coordinates and s/e the source window endpoints in playback order. For trajectory origin, anchor=D(s). Continue uses the previous clip end-exclusive root endpoint if available. The normalized cycle is C=D(s)^-1 D(e); trajectory is anchor*C^n*D(s)^-1*D(t). Non-loop clamps at the source window endpoint; loop accumulates full cycles including turns, reverse swaps endpoints. Clip gaps hold the last trajectory endpoint. Root local position/quaternion reset to rest; limbs and model-parent animation remain in the native sampler. Actor placement/path multiplies the transient root group once. General skeletal alignment is still pending.

Errors: duplicated source path provenance -> ROOT_MOTION_CONFLICT, trajectory overlap/unsafe cycle count -> VALIDATION_FAILED. Missing preceding loaded motion falls back without fabricating a root trajectory. Headless scene.evaluate returns placement transforms plus SKELETON_EVALUATION_UNAVAILABLE; it is not export/bake acceptance. UI exposes trajectory and alignment on binding edit; initial placement remains skeletal.


## Incremental implementation — DOC-035

DOC-035: scene.evaluate đọc asset đã kiểm SHA/path và trả skeletonSamples CPU gồm đủ bone local pose/world matrices, placementMatrix, trajectoryMatrix, actorWorldMatrix và metersPerUnit. Dùng chung buildCharacterRig, CharacterAnimator/MotionPlayer và root sampler với browser; entrypoint /skeleton riêng không kéo renderer/MediaBunny. Native model/motion templates không bị sửa; đọc không đổi revision/history. Browser/API đối chiếu65 bone FBX thật đạt max world-matrix delta4.440892098500626e-16. Builder94 files/544 tests; Studio/shared/Retarget37/37; build/typechecks/targeted lint đạt. Thiếu source, texture/compression không decode được, rig không hỗ trợ hoặc library pose chưa nạp trả issue rõ ràng; loader chặn tài nguyên ngoài. Còn thiếu range bake/export, native Animation, Retarget khác rig, geometry checks/render và Film/game; production EPERM/clone500 chưa sửa.

scene.evaluate result adds `transformSpace=authored-placement`, `skeletonMatrixOrder=column-major`, `boneLocalSpace=model-units`, `boneWorldSpace=scene-meters`, and `skeletonSamples[]`. Each sample has nodeId, metersPerUnit, placementMatrix, trajectoryMatrix, actorWorldMatrix and bones[{name,position,rotation,scale,worldMatrix}]. Bone names map to the shared profile; local values preserve model units, world matrices use Scene meters. API/CLI/MCP use the same read command and revision. Geometry checks and full formats are pending; explicit SKELETON_EVALUATION_UNAVAILABLE/POSE_LIBRARY_UNAVAILABLE issues identify incomplete samples. No network resource fetch, project edits or native source mutation is permitted by evaluation.
