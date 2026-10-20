# 1.5.1–1.5.3 — Animation, rig và motion editing

**Bổ sung đề xuất 2026-10-19:** [đặc tả tích hợp Animation Creation](animation-creation-integration.md) và [task AC-00–AC-08](../../ANIMATION_CREATION_TASK_PLAN.md) cụ thể hóa native editor/creation tối thiểu thành P0. Placement FBX hoặc actor transform của Topview không đủ nghiệm thu phần này. Chưa duyệt code cho bổ sung; mô tả implementation bên dưới không tự trở thành runtime PASS mới.

## Mục tiêu / khóa nguồn
Giữ nghiệp vụ Animation1.31.8 qua typed JS adapters trước khi chuyển TypeScript. [Bằng chứng lineage](../evidence/animation-lineage.yaml):35embedded modules,6app files ghép và2CSS khớp HTML sau chuẩn hóa imports/line endings theo builder. Package label1.31.5 vẫn là discrepancy metadata; không dùng nó phủ nhận bytes đã đối chiếu hoặc gọi build/runtime mới đã đạt.

## Chức năng / I/O / code
| ID | Nhóm phải giữ | Input → Output / source |
| --- | --- | --- |
| 1.5.1 | Rig/control/IK/joint limits, pose, skin shape, dual editor/compare, onion skin, viewport/ground/settings | Asset rig+native project+time → pose/skin edits/display; core/control_rig/rig_kinematics/joint_limits/skin_shape/dual_editor/viewport/compare/onion modules. |
| 1.5.2 | Timeline/graph/easing, layers, smoothing/motion lab/quick animation, library, markers/contacts/templates, director controls | Native keys/curves/IK/layers → edited project; graph/easing/motion/smoothing/director/scene modules giữ math/evaluator. |
| 1.5.3 | FBX/GLB/BOBJ, WarcraftMDX/MDL/DDS/material alpha, League assets, textures, BVH/FBX/GLB/BOBJ exporters, bridge | Source bytes → Three rig/mesh/motion; edited motion → derivative + report; importer/exporter handlers giữ nguyên. Không bỏ exotic loader chỉ vì skeleton ngoài3profile mục tiêu. |

## Luồng / adapter
Chọn CharacterID và clip→resolve native rig+Motion/edit→validate fingerprint→mount editor→preview→commit một native edit blob qua motion.edit→refresh shared evaluator. Mặc định clone-on-edit để hai instance không vô tình cùng đổi. Viewport controls/time theo host nhưng native engine giữ coordinate convention.

Port mới: open({asset,skeleton,nativeProject})->EditorHandle; evaluate({project,timeSeconds,rootPolicy})->PoseSample; validate(project,rig)->Issue[]; applyEdit(nativeAction)->newNativeProject; serialize()->nativeProject; export(request)->artifact; dispose(). UI/DOM tách khỏi pure math; không viết lại solver. Layers/graph/IK settings phải nằm native edit blob, không chỉ lưu pose samples.

Native Scene Studio actors/clips/library/markers/contacts/templates được nối vào cùng IDs. UI scene layout/cameras dùng Topview, còn Animation vẫn có controls chỉnh scene motion/contacts. studio_bridge/source_preview/director actions đi broker, không gửi sang project riêng. Feature nguồn có panel riêng chưa thay thế phải giữ panel adapter tới khi parity đạt.

## UI / API
Giữ chức năng hiện có theo inventory, bố trí trong panels Animation: Rig/Pose, Timeline/Graph/Layers, Motion/Library, Import/Export, Skin/Texture; tìm trong cây mở đúng panel. Bone selection stable; multi-select/key insertion/delete/shortcuts source giữ. Edit không có rig phù hợp bị chặn với relink/mapping action.

`motion.place` đặt FBX Motion lên Character có cùng skeleton fingerprint/đơn vị. UI cho chọn frame, source in/length, tốc độ 0.01–16x, lặp và hướng ngược; evaluator phát trong source window, giữ fractional time, còn clip index, MotionBinding và Undo/Redo được giữ chung. CLI/MCP gọi cùng broker command. Trajectory/alignment, bake Retarget V9.12, khác-rig placement, `motion.edit` và asset.convert còn thiếu; exporters nhận snapshot/frame range/FPS, không đọc playhead mutable giữa job.

`motion.binding.set` sửa binding đã đặt trong một transaction, giữ ClipID. Nút **Sửa clip** nạp binding và revision gốc vào cùng form; Apply gửi source range, reverse, Motion/Character tương thích, speed/loop và khoảng frame inclusive. Cancel bỏ draft. Dữ liệu project thay đổi trong lúc sửa sẽ làm Apply trả REVISION_CONFLICT; không lấy revision mới để ghi đè draft cũ. API nhận toàn bộ binding và clipPatch tùy chọn; không truyền frameEnd thì giữ span cũ khi di chuyển, chỉ sửa source range thì giữ nguyên khoảng timeline. Clip chồng lấn hoặc Character cũ/mới bị khóa bị từ chối; root policy ngoài skeletal/in-place, alignment ngoài continue và fade khác 0 trả UNSUPPORTED_CAPABILITY tới khi evaluator tương ứng được nối. Các lỗi không đổi project; Undo/Redo phục hồi clip và binding cùng nhau. DOC-038 nhúng Topview DirectorStudio trong workspace Animation để dùng editor viewport/rig/timeline/keyframe trên cùng adapter; graph/layer/motion-lab và native edit data riêng của Animation1.31.8 vẫn chưa tích hợp.

## Lỗi / nghiệm thu / tác động
Missing texture/unsupported material có report; không thay trắng rồi tuyên bố đúng. Fingerprint mismatch/invalid key time/NaN/unsupported clip rig chặn commit. Long job cancel không đổi source, shared revision conflict không mất draft.

ANIM-01..03, RIG-01, FORMAT-01: pose/IK/rest, graph/easing/layers/smoothing, model textures/alpha, all supported exporter roundtrips so với HTML khóa. Dùng Flair/iClone fixture và native source test generators; historical reports chỉ tham khảo. Mỗi bản Animation mới sau code/build có Site owner-private riêng; Site thiếu Blender/local bridge phải nêu rõ. Motion/evaluator phục vụ Scene và BBS, pose creation không đưa sang Retarget.


## Incremental implementation — DOC-033

DOC-033: in-place cho FBX direct rig qua motion.binding.set và form Sửa clip; root translation/quaternion về rest theo SkeletonProfile, giữ limb animation, unit và actor placement. Native rootMotion/inPlace và shared binding được ghi cùng transaction; validation chặn sai bone/policy/rig và document.replace xóa policy. Builder 93 files/539 tests; Studio/shared/Retarget 37/37 với FBX thật; build/typechecks/targeted lint đạt. Browser Chromium153 xác nhận root rest tại frame30/40, actor(2,0,0), tay đổi pose, Undo/Redo, clone/reload và 0 external requests. Trajectory/alignment/fades, cross-rig bake, native Animation và Film/game chưa hoàn tất; clone500 ngắt quãng và production build EPERM chưa sửa.

Optional native `MotionClip.motion.rootMotion={policy:skeletal|in-place,boneName}` projects the shared policy into the engine; `inPlace` matches it. Bone name comes from the target SkeletonProfile rootBoneId. In-place removes all root translation/rotation relative to rest; root scale and non-root tracks remain. UI exposes the mode when editing an existing binding; initial placement defaults skeletal. Legacy drafts without the optional field retain their previous playback. This subset does not establish continue endpoint chaining acceptance.


## Incremental implementation — DOC-034

DOC-034: trajectory cho imported direct FBX tách root translation/rotation sang motionRoot dưới actor; placement/path authored không bị ghi đè. Native interpolants và rest/unit hierarchy được tái sử dụng. Loop tích lũy cả góc xoay, reverse/trim/speed giữ fractional time, origin dùng anchor nguồn và continue nối end-exclusive endpoint clip trước; seek/gap không dựa frame đã render. Shared binding/native metadata cùng revision/history; provenance path trùng nguồn trả ROOT_MOTION_CONFLICT; overlap và loop count vượt precision bị chặn. 93 file/542 Builder test; Studio/shared/Retarget37/37; build/typechecks/targeted lint đạt. Browser FBX thật đạt skeletal→trajectory world-matrix parity, max delta6.625060056109078e-9, seek lùi/reload và0 external requests. Chưa có headless root bake/export, general skeletal alignment, fades, khác-rig bake, native Animation hay Film/game acceptance; camera follow và gizmo/autosave trajectory chưa kiểm. Clone500/production EPERM chưa sửa.

Native projection: `rootMotion={policy:skeletal|in-place|trajectory,boneName,alignment?:origin|continue}`. Let D(t) be root delta in actor coordinates and s/e the source window endpoints in playback order. For trajectory origin, anchor=D(s). Continue uses the previous clip end-exclusive root endpoint if available. The normalized cycle is C=D(s)^-1 D(e); trajectory is anchor*C^n*D(s)^-1*D(t). Non-loop clamps at the source window endpoint; loop accumulates full cycles including turns, reverse swaps endpoints. Clip gaps hold the last trajectory endpoint. Root local position/quaternion reset to rest; limbs and model-parent animation remain in the native sampler. Actor placement/path multiplies the transient root group once. General skeletal alignment is still pending.

Errors: duplicated source path provenance -> ROOT_MOTION_CONFLICT, trajectory overlap/unsafe cycle count -> VALIDATION_FAILED. Missing preceding loaded motion falls back without fabricating a root trajectory. Headless scene.evaluate returns placement transforms plus SKELETON_EVALUATION_UNAVAILABLE; it is not export/bake acceptance. UI exposes trajectory and alignment on binding edit; initial placement remains skeletal.


## Incremental implementation — DOC-038 — Reuse Topview rig/timeline editor

Workspace Animation now mounts the existing Topview `DirectorStudio` next to the shared FBX placement/binding panel. Both use the same `LocalHostAdapter`, project revision, saved timeline keys, and project history. This exposes the existing viewport, rig tools, transform/pose key editing, playback and Topview timeline in the Animation workspace without adding another evaluator or project copy.

Validation: Studio TypeScript check, targeted ESLint and smoke-script syntax passed. Chromium153 browser smoke with the real Punch Combo FBX confirmed the viewport canvas and Animation controls mount together; the complete source import, Character, clip place/edit, root-motion playback, Undo/Redo, clone/reload and CPU/WebGL 65-bone parity flow passed with zero console errors, failed requests or external requests. See [browser evidence](../evidence/animation-workspace.yaml).

This makes 1.5.1 partial because Topview rig/pose controls are reachable, and advances 1.5.2 by exposing its existing timeline/keyframe editor. It does not establish parity for Animation1.31.8 control rig, IK, skin shaping, compare/onion-skin, graph/layers/motion-lab, native edit blobs, or export. Acceptance remains open.
