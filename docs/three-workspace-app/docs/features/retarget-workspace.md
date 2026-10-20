# 1.3.1–1.3.3 — Retarget và chuẩn hóa skeleton

**Điều chỉnh mục tiêu 2026-10-19:** [Rig & Animation Normalization](rig-animation-normalization.md) là đề xuất chính cho Workspace01. Nội dung V9.12 bên dưới giữ làm baseline/nhóm tương thích; không dùng làm bằng chứng chuẩn hóa arbitrary rig → Mixamo65. Chưa được duyệt code thay đổi mới.

## Mục tiêu / nguồn
Giữ85Minecraft actions, hai chiều Mixamo65↔Minecraft20, Source bất biến, mapping/calibration/reference pose, corrections/feet/hands, target timeline, project/history và export V9.12. [Inventory](../inventory/retarget.yaml) ghi vùng code; [source index](../inventory/source-index.yaml) ghi file/hash/đích.

## Ranh giới trích engine
| ID | Code nguồn / giữ hành vi | Adapter mới |
| --- | --- | --- |
| 1.3.1 | loadFBX/loadSourceMixamoFBX, applyRetarget/buildReverseCache/applyReverseRetarget, evaluateTargetV98, ACTIONS_BOBJ/ACTION_LABELS | Tách DOM/filepicker/window globals ra host; engine nhận explicit session và asset resolver, không truy React store. Giữ85actions theo ID/data hash. |
| 1.3.2 | applyMappingV99/applyFeetV99/applyHandPresets, native context/controls/segments/sourcePose/interpolation | Map ProfileIDs/fingerprints và calibration; thêm Metarig semantic mapping, không giả định V9.12 đã hỗ trợ. |
| 1.3.3 | validateProjectV99/applyProjectV99, exportBobj/buildThreeClipFromBake/exportBVH/exportGLB/exportFbxBridge | UI React dùng session native; Apply/Bake là shared command; history native preview không thành history project thứ hai. |

## Input/Output và luồng
Input source asset+clip/profile, target asset/profile, mapping+reference pose/calibration, correction settings, range/FPS/root mode. Output preview pose, diagnostics, Motion mới với provenance; source không bị ghi. Load→fingerprint→mapping→reference/calibrate→preview→adjust→Apply session→Bake→đặt motion vào character.

Typed port dự kiến: loadSource(AssetRef)->SourceHandle; loadTarget(AssetRef)->TargetHandle; validateSession(NativeProject,handles)->Issue[]; evaluate(session,timeSeconds)->PoseSample; bake(session,{range,fps,rootPolicy})->MotionSamples; dispose(). PoseSample gồm boneId/native TRS, rootDelta, native basis/unit, warnings. Hàm là adapter mới; math/hàm nguồn giữ nguyên bên trong.

## Metarig và chuẩn hóa
Nhận topology từ asset thực, không đoán bằng số xương. Semantic roles root/pelvis, spine/chest/neck/head, hai arm/forearm/hand, thigh/shin/foot/toe; gợi ý mapping tên rồi người dùng xác nhận. Twist/finger/extra bones hiện riêng; unmapped phải có reason, không xóa âm thầm. Missing essential role hoặc đổi rest fingerprint vô hiệu mapping.

Chuẩn hóa tạo profile/motion đích trên target rig đã chọn; giữ source mesh/rig. Nếu yêu cầu model skin theo rig đích, tạo derivative riêng: chuyển vertex weights qua bảng bone mapping đã xác nhận, cộng các weight cùng target, normalize tổng1; vertex có weight không map chặn export. Bind matrices tính lại từ target rest và biến đổi mesh về cùng basis/unit. Không tự nearest-bone gán lại vùng da hoặc hứa mọi rig tùy ý. Đây là phần mới trong1.3.2 vì V9.12 chưa chứng minh rebind Metarig; kiểm rest-pose mesh và joints bằng RIG-01. Preset target lấy từ file fixture/profile hash, không một skeleton65 toàn cục cho mọi model.

## UI / API
Hai viewport Source/Target, clip selector85actions, profile/mapping, calibration/reference, corrections/feet/hands, root policy, target timeline, Apply/Bake/export. Label Source chỉ đọc; draft badge; thay source/target yêu cầu validate mapping lại. Chọn bone thông qua stable key, giữ left/right/both và mọi controls source. Không khôi phục standalone pose creation đã gỡ.

Commands skeleton.mapping.set, retarget.session.set, retarget.bake, motion.place; [API](../contracts/commands-v1.yaml). JSON vẫn type/version1 và buildV9.9; giữ controls/context/sides/movement. Preview speed không đổi bakeFPS; targetMinecraft mặc định30FPS source, Film sample20Hz ở exporter.

## Lỗi / nghiệm thu / tác động
Chặn missing bone/invalid quaternion/segments out of range/fingerprint mismatch/NaN/unit unknown; cancel bake không tạo Motion nửa chừng. Golden RETARGET-01..03 và RIG-01 trong [acceptance](../acceptance.yaml), tất cả85clips trên hai chiều, mapping/feet/skin/format/error/undo. Không chỉ test một clip rồi tuyên bố85đạt. Motion mới đi Scene/Animation; source project vẫn mở độc lập. Runtime/game riêng, chưa được kiểm trong đợt docs.

## Bằng chứng implementation hiện tại — một phần

DOC-060 bổ sung `bakeReverseRetargetFrames`: lấy source pose theo từng frame ở 15/24/30 FPS và gọi solver V9.12 hiện có để trả các target poses cùng tick/time. DOC-061 nối sampler vào Retarget Preview ở 30 FPS, chuyển local target transforms thành Three.js `AnimationClip` và tải JSON. Test phát clip trên Three.js Bone/Mixer. Đây mới là file export: chưa tạo Motion trong project/history, chưa đặt vào timeline, chưa so golden native; target rest/hierarchy vẫn dựa armature BOBJ tĩnh V9.12.

Trong bản sao `three-workspace-app/editor/`, `packages/retarget/src/reverse.ts` port reverse solver Mixamo65→Minecraft20 và giữ armature BOBJ 20 xương dạng multi-root; `index.ts` port `localDeltaMatrix` để sample đủ85 action theo thứ tự V9.12 `restLocal × T × Rz × Ry × Rx × S`. `MinecraftActionPreview.tsx` phát/scrub native BOBJ trên armature Minecraft20 bằng Three.js. `RetargetPreview.tsx` nạp FBX, chọn clip, chuẩn hóa cm/m, preview source→target và điều chỉnh root/mirror/proportion. Nút lưu gửi FBX qua upload+`asset.import`; Node tạo source SkeletonProfile và clip Motion, giữ bytes/hash/unit và commit một revision/history transaction. `retargetMotionMetadata` giữ tên/index clip. FBX có mesh được nhập model Asset để thêm Character/Prop ở Scene, đồng thời giữ source Motion/Profile; file cần DOM-only texture decode có thể bị từ chối. Parser/evaluator BOBJ giữ dữ liệu và tick source.

Kiểm chứng cục bộ lượt mới: shared/Retarget/Studio typecheck, ESLint các file Studio đổi và 26 test đạt; một FBX importer test bị skip do lượt chạy không đặt `BBS_TEST_MIXAMO_FBX`. Thêm test cho V9.12 project JSON validator và `retarget.session.set`: giữ JSON nguyên dạng trong blob hash-addressed, commit vào history, undo/redo phục hồi, fingerprint sai bị từ chối mà revision không đổi. Test session dùng fixture cấu trúc với fingerprint tổng hợp; không thay cho kiểm tra FBX runtime. Sample toàn bộ85 BOBJ action vẫn đạt. Các lượt fixture trước đã ghi nhận hai FBX cho 13 mapping source và 20 target pose hữu hạn. Edge WebGL smoke trước đó xác nhận BOBJ canvas/playback. Đây chưa phải golden parity V9.12.

Đã nối mapping tương thích vào reverse preview: chỉ áp dụng khi mapping đã xác nhận, target là Minecraft20 với assignment khớp hierarchy V9.12, source FBX hash chính xác và unit trùng profile. Solver vẫn phát trên armature BOBJ V9.12 tĩnh, không nạp mesh/rest pose của target profile. `SkeletonMappingEditor.tsx` cho chọn Motion/profile, gán stable bone IDs, lưu draft/confirmed mapping, nạp lại mapping/calibration rồi cập nhật cùng ID; xương dư cần reason. Calibration blob được hash-addressed; history Undo/Redo dùng chung. GET calibration bị giới hạn theo local session, project và mapping ID.

`RetargetSessionPanel.tsx` nhận file project JSON V9.12, cho chọn source Motion/target Character/mapping, lưu session và đọc/tải lại snapshot. `retarget.session.set` port server-side structural validation của V9.12, kiểm source fingerprint với metadata lúc FBX import, kiểm profile/entity links, lưu native JSON thành blob bất biến theo SHA-256 và đưa session vào project history. Khi nạp hoặc lưu một session hợp lệ, preview dùng `state.context.sourcePose` làm quaternion tham chiếu của xương nguồn; việc áp dụng yêu cầu mapping ID, SHA-256 của FBX và đơn vị phải khớp session. Solver vẫn phát trên armature BOBJ V9.12 tĩnh; native target fingerprint chưa được đối chiếu với rest matrix/mesh của Character đích, nên snapshot chưa đủ để bake hoặc khẳng định parity target.

RETARGET-02/RIG-01 và mapping/session UI/API chưa được smoke test trên browser. Metarig semantic profile/skin rebind, feet/hands, forward solver, tích hợp bake UI/project, export, đặt Motion lên timeline, Python CLI/MCP cho thao tác Retarget và BBS FS vẫn chưa triển khai. FBX models đã có browser smoke với Punch Combo qua ba workspace; FBX có texture cần DOM decode vẫn có thể bị Node importer từ chối. Reference-pose quaternion có unit test với armature V9.12; chưa có kiểm thử browser/API roundtrip cho thao tác nạp snapshot và preview.

## FBX source adapter — cập nhật DOC-031

Importer và preview dùng public helper `fbxSourceBones` của Builder để bỏ qua identity child alias do FBXLoader tạo khi nhiều mesh dùng chung một bone. Alias không bị xóa khỏi source mesh/skin; profile chỉ lưu một source identity. Bone trùng tên thật, khác FBX ID, có transformData riêng hoặc khác identity transform vẫn bị từ chối. Preview không liệt kê animation stack rỗng; importer bỏ stack hoàn toàn rỗng nhưng giữ index của array nguồn cho các Motion còn lại. Rest-bind cache cũng bỏ qua alias, tránh để rest identity của child ghi đè rest của bone thật. Fixture Punch Combo khóa hash đã qua importer và đối chiếu đủ 65 bone ở direct-bind trim/reverse; UI/WebGL/skin vẫn cần kiểm riêng.


DOC-032: helper source-bone là pure structural/numeric và export từ `@topview/3d-builder/evaluate`, dùng được trên Next server. Không gọi helper từ main client entrypoint trong API. FBX import với mesh cho phép thêm Character cùng source profile và direct-bound Motion, giữ original skin/material; browser đã kiểm unit 0.01 và animation giữa hai frame, không thay nghiệm thu skin/Metarig/forward solver đầy đủ.
