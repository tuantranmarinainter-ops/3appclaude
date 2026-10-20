# Workspace 01 — Rig & Animation Normalization

**Cập nhật 2026-10-20:** [W01-PLAN-003 — phần thiếu sau DOC-108](workspace01-remaining.md) theo dõi 17 task con và 8 gate. Người dùng đã yêu cầu triển khai toàn Workspace01, giữ nguyên 85 animation và luồng Mixamo65↔Minecraft20. DOC-116 sửa lỗi quaternion ở local-chain và mở rộng kiểm tra Assignment Character C; đây là bằng chứng code/test, chưa phải nghiệm thu đa nguồn runtime. Fixture, skin-loss/quality review, Scene atomicity và Studio production build vẫn được theo dõi riêng.

Cập nhật W01-PLAN-002 ngày 2026-10-19 theo AGENT UPDATE: số xương nguồn bất kỳ, ưu tiên chuyển hóa animation từ ít nhất hai hệ xương khác nhau. Người dùng đã duyệt triển khai toàn bộ Workspace 01 trong goal “hãy code từ đặc tả full”; implementation đang tiến hành, chưa gate nào được nghiệm thu chỉ từ việc có code. Nguồn yêu cầu: văn bản đính kèm `edafc979-6b18-4cda-8f90-bbe0dcbab4d4`.

## 1. Mục tiêu và ranh giới

Chuẩn hóa model/rig ngoài và animation về Mixamo65, bảo toàn nguồn và đo mức sai lệch. Đây là chức năng chính. Thư viện 85 animation và Mixamo65↔Minecraft20 nằm trong nhóm Tương thích V9.12; bảo toàn phần đã hoạt động, không coi cả hai chiều đã hoàn chỉnh trong app hợp nhất.

“Mọi rig” là mục tiêu sản phẩm, không cam kết mọi topology đều biểu diễn chính xác bằng humanoid 65 xương. MVP hỗ trợ humanoid có skin và action thật; rig phi humanoid, nhiều armature, constraint chưa bake, morph animation, shear/scale động chưa hỗ trợ phải được chặn hoặc báo capability thiếu. Không tự loại các track này.

Mixamo65 phải được khóa bằng manifest đủ 65 tên/ID/parent/role và rest convention từ fixture hợp lệ; không nhận diện chỉ bằng số lượng và vài tên xương. Prefix tên được xử lý ở adapter. 65 là số joints của skeleton đích; scene container/mesh node không được tính là bone. Cùng topology Mixamo65 không có nghĩa cùng rest pose, chiều dài chi hay fingerprint.

## 1A. Universal engine: nguồn linh hoạt, đích chuẩn

Đầu vào không có whitelist số lượng, tên hay cấu trúc xương. Adapter nhận graph với node identity, parent, bind/rest, units/basis và channels theo thời gian; solver nhận graph + semantic mapping + target profile, không dùng nhánh if nguồn115/CC/UE để chạy thuật toán riêng. Preset theo hãng chỉ gợi ý, nguồn không nhận diện vẫn mapping thủ công được.

Tách ba khả năng: (a) đọc format/inspect graph; (b) ánh xạ chuyển động biểu diễn được sang humanoid65; (c) chuyển mesh/skin. Import thành công không có nghĩa (b)/(c) PASS. Hierarchy bất kỳ hợp lệ được giữ; cycle, dangling refs, thiếu rest hoặc channel không giải được trả diagnostics. Nguồn nhiều skeleton cho chọn từng skeleton/component, giữ node cha ảnh hưởng evaluation; không âm thầm flatten hoặc bỏ rig chưa chọn. Engine không ép mọi creature/face rig thành chuyển động humanoid chính xác.

Không giới hạn số xương theo loại rig không có nghĩa tài nguyên vô hạn. Kích thước file, node/channel/sample count và memory/time budget phải có kiểm soát theo job, báo RESOURCE_LIMIT và cách chia range/clip; không truncate silently. Giới hạn hiện có của shared validator/importer và converter Film phải được rà riêng; không mang cap512 của BOBJ sang universal engine. Các cap runtime cụ thể chỉ chốt sau profiling.

```text
Source format → parser/converter được xác minh → RigGraph + ActionSampler
                                            ↓
                        Semantic Mapping + rest/basis calibration
                                            ↓
                             Universal Retarget → Mixamo65 Motion
                                            ↓
              Animation-only → Assignment → model C → Preview / Scene
              Model branch → rig fit + skin transfer → Model+Rig+Actions
```

Format adapters nằm tại host/local worker; graph và solver thuần trong packages/retarget; shared giữ IDs/provenance/contracts. Adapter contract dự kiến: inspect→graph/capabilities/issues; sample(action,t)→evaluated TRS/root ở source conventions; dispose/cancel. Preserve intermediate ancestor nodes và animation trên non-bone nodes. Mọi conversion ghi source hash, exporter/adapter version, channel losses và format trước/sau để đo riêng lỗi import và lỗi retarget.

Giữ hai output đã yêu cầu. Animation-only cần skeleton/rest/channels nhưng không yêu cầu mesh hoặc skin. Model+Rig+Animation chỉ được PASS khi cả retarget và mesh/skin đã đạt. Tính năng nhận rig tùy ý không đồng nghĩa mở trực tiếp .uasset/.ma/.mb/.iMotion hoặc các format game độc quyền.

Implementation note DOC-103 (2026-10-19): Workspace 01 now renders synchronized source and Mixamo65 skeleton lines from the selected Action and shared playhead using the universal solver. This is a motion inspection preview only; it does not display meshes, skin deformation, material/texture changes or prove browser/runtime parity.

Implementation note DOC-104 (2026-10-19): a confirmed target-role mapping may include an ordered `sourceBoneIds` chain beginning at `sourceBoneId`. IDs must follow one ancestor path. Normalization uses an equal quaternion mean of source world-rotation deltas; root displacement remains owned by the mapped base bone. Mapping preset v2 preserves additional source-bone names while v1 remains importable. Exclusion and skin-loss policy is not included in this merge operation.

Implementation note DOC-116 (2026-10-20): local-chain rotation conjugation now uses an immutable calibration frame. Previously, quaternion multiplication mutated the frame before its inverse was read, reducing every mapped local delta to identity. A regression test covers shared-parent motion, ancestor-first composition, source weights, and distinct source/target rest frames. Test paths for the pinned Mixamo65 GLB and legacy 85-action catalogue now resolve relative to their test modules. This fixes solver/test reliability; it does not certify real external-rig runtime or complete all W01 acceptance tasks.

## 2. Workflow và giao diện đề xuất

```text
Workspace 01 — Chuẩn hóa Rig & Animation
1 Nhập nguồn → cây Node/Bone, Mesh/Skin, danh sách Action, preview nguồn
2 Mapping → gợi ý, sửa tay, chọn/loại trừ, calibration, preset
3 Chuẩn hóa → rig Mixamo65, skin transfer, retarget, so sánh trước/sau
4 Animation Assignment → chọn nhân vật, chọn Action, gán/thay/thêm, preview
5 Xuất → Model + Rig + Animation | Animation-only
6 Gửi Scene → Character/Motion dùng chung, một transaction có Undo
Nhóm phụ: Tương thích V9.12 → 85 actions, các luồng Mixamo↔Minecraft hiện có
```

Bố cục theo Topview: trái là cây nguồn có tìm kiếm/thu gọn; giữa là hai viewport nguồn/đích đồng bộ thời gian; phải là Mapping/Calibration/Diagnostics; dưới là Action list và playback. Mỗi bước hiện điều kiện còn thiếu, không chỉ có nút Next. Assignment là tab con Workspace 01, không thay editor tạo/sửa animation của Workspace 03.

Ba đường đi: A chuẩn hóa model và action → Scene; B animation-only → gán sang nhân vật Mixamo65 khác → Scene; C chuẩn hóa nhân vật → gán thêm action ngoài → Scene. B không yêu cầu mesh nguồn, nhưng vẫn cần rig/rest pose nguồn đủ để retarget.

## 3. Review lịch sử DOC-066 và module tái sử dụng

Đã đọc các điểm vào, mapping, bake, importer, broker và test liên quan trong app hiện tại; đây là review tĩnh có đối chiếu hồ sơ, chưa phải audit hành vi mọi module nguồn V9.12 hoặc chạy lại hồi quy. Hồ sơ hiện tại tới DOC-066; báo cáo DOC-044 cũ không còn là trạng thái mới nhất.

| Module hiện có dưới three-workspace-app/editor/ | Có thể tái sử dụng | Phần chưa đáp ứng |
| --- | --- | --- |
| apps/studio/src/unifiedAssetFiles.ts | upload/hash/blob bất biến, FBX/GLB import, profile/rest/unit/basis | chưa pipeline thay skeleton và weights; nhập bất kỳ hierarchy chưa bảo đảm; GLB hiện có giới hạn skeleton kết nối |
| packages/retarget/src/mapping.ts | stable IDs, alias suggestions, ambiguity/fingerprint/conflict validation | 20 semantic roles; calibration gắn engine retarget-9.12; thiếu đủ fingers/65 roles, topology scoring và exclusion policy |
| apps/studio/app/workbench/components/SkeletonMappingEditor.tsx | UI chọn cặp xương, lưu mapping/calibration | cần cây nguồn/đích, highlight mesh chịu ảnh hưởng, policy loại trừ và preset portable |
| packages/retarget/src/reverse.ts và bake.ts | solver V9.12 cho đường cũ; frame grid, kiểm hữu hạn, tạo AnimationClip | solver Mixamo→Minecraft cố định không phải universal target solver; export JSON chưa là normalized model |
| apps/studio/app/workbench/components/RetargetWorkspace.tsx, RetargetPreview.tsx | catalogue85, source playback, UI lifecycle | hiện ưu tiên catalogue/reverse preview; cần bố trí lại workflow |
| apps/studio/src/unifiedProjectStore.ts | mapping/session commit, revision/history, character.add, motion.place, motion.edit | motion.place chặn fingerprint/unit khác; Assignment khác tỷ lệ cần tạo derivative tương thích trước khi place |
| apps/studio/src/unifiedSkeletonEvaluation.ts | CPU evaluate và provenance derivative | không thay thế solver chuẩn hóa/skin validation |
| packages/builder/src/engine/objects/MotionPlayer.ts | phát Motion sau khi đã bind đúng rig | không được nới kiểm fingerprint để giả lập retarget |
| agent/film_worker/blender/convert_model.py | cách điều phối Blender local, staging và kiểm kết quả | exporter BOBJ phục vụ Film, không tái sử dụng như bộ chuẩn hóa Mixamo |

Tests mapping/bake/retargetBobj và hồ sơ runtime hiện tại chứng minh các phần cũ ở phạm vi đã ghi; chưa chứng minh universal retarget từ hai rig khác nhau về Mixamo65. Không tự nhân rộng PASS của same-rig FBX hoặc native Animation thành PASS của universal normalization.

## 4. Chuẩn hóa rig, skin và animation

1. Inspect nguồn: lưu bytes/hash, toàn bộ node/bone graph, mesh/submesh/material/UV, skin joint indices/weights/inverse-bind, Actions, thời gian, trục/đơn vị và constraint capability. Stable IDs dựa identity/path, không chỉ tên; tên trùng phải hiển thị đủ path. Multi-root cần quyết định container rõ, không âm thầm gộp.
2. Mapping: gợi ý từ tên + hierarchy + rest direction/position; confidence chỉ là gợi ý. Người dùng xác nhận pelvis/spine/head/chi và bên trái/phải. Chains nhiều xương (twist/spine) cần rule nhiều→một hoặc phân bố có trọng số; không ép validator một-cặp cho toàn bộ bài toán. **Đã có DOC-104:** mapping có thể chứa `sourceBoneIds` theo một nhánh descendant; solver lấy equal-mean world-rotation delta, còn root travel do source bone gốc sở hữu. **Đã có DOC-106:** `sourceBoneWeights` tùy chọn, cùng thứ tự chain, là trọng số tương đối không âm; thiếu field nghĩa là trọng số bằng nhau, tổng bằng 0/giá trị không hữu hạn/khác độ dài bị từ chối. Trọng số 0 bỏ ảnh hưởng xoay nhưng không chuyển root-motion owner khỏi bone gốc. Preset v3 lưu vector, v1/v2 vẫn đọc. Local-chain composition và end-effector scaling vẫn thiếu. Thiếu ngón có thể sinh joints nghỉ có đánh dấu, không bịa animation; thiếu chi chính chặn hoặc yêu cầu calibration rõ.
3. Target rig: tạo skeleton theo manifest Mixamo65, fit joint locations/tỷ lệ từ source đã mapping và calibration A/T pose. Giữ mesh rest geometry ban đầu trong cùng hệ tọa độ. Tính lại bind matrices/inverse binds cho rig mới. Không áp scale hoặc axis hai lần.
4. Skin: chuyển influence qua bảng source joint→target joint, cộng weight trùng và chuẩn hóa tổng. Twist/helper có owner xác định; xương bị loại phải chọn owner đích hoặc chính sách khác. Nếu giới hạn số influence của output nhỏ hơn nguồn, đo lượng weight bị cắt và deformation trước khi chấp nhận. Không dùng auto-weight toàn mesh làm mặc định vì dễ phá skin tốt sẵn có.
5. Retarget: sample source action tại thời gian t, giải rest-relative rotations trong hệ tọa độ đã calibration, tái lập target global/local transforms theo target hierarchy. Giữ timing, range, tên Action, source IDs; giải chains/end effectors khi tỷ lệ khác. Translation chỉ chuyển theo channel policy tường minh; root displacement có tùy chọn giữ mét hoặc tỷ lệ chiều cao, mặc định giữ mét. In-place/trajectory/skeletal có một owner, không cộng root hai lần.
6. Bake thành derivative mới; giữ source Actions/rest/mapping và conversion report. Preview nguồn/đích đồng bộ; so joint/mesh/foot-contact theo vùng và frame. Xuất/reimport rồi đo lại, không chỉ nhìn viewport trước export.

Report của nhánh Model+Rig được lưu bất biến như JSON derivative, gắn output GLB SHA-256 và source/profile/mapping/Motion IDs; UI có thể đọc lại sau khi đóng panel. Host kiểm tra hash liên kết, danh tính và schema/range của metrics. Metrics hiện do client Three.js tạo, chưa được host tính độc lập; chỉ runtime/fixture đối chiếu mới đủ để đánh giá deformation thực tế.

### Khi bỏ xương cánh/đuôi/phụ

“Exclude” mặc định loại khỏi retarget, không xóa nguồn hay mesh. Trước bake yêu cầu xử lý skin ảnh hưởng:
- Giữ mesh, chuyển weight sang owner đích người dùng chọn (ví dụ torso); hình học nghỉ giữ, chuyển động cánh độc lập mất và phải báo.
- Chuyển phần phụ thành rigid attachment vào một joint đích nếu phù hợp; không tạo bone thứ 66. Báo mất deformation phụ.
- Loại mesh chỉ khi người dùng chọn riêng. Không tự cắt mesh theo tên bone; mesh dùng chung cần quy tắc chọn faces/vertices được xác nhận, ngoài MVP mặc định chặn.
Không có owner hợp lệ hoặc vertex mất toàn bộ influence: chặn xuất. Report ghi bones/tracks bị bỏ, vertex/weight chịu ảnh hưởng và mức sai lệch; mọi loss phải hiện trước Apply.

Khi lưu mapping, mọi source bone chưa được chiếu sang motion đích phải có lý do rõ. Plan chuẩn hóa hiển thị danh sách source bone đã loại (profile ID, tên, lý do); report derivative giữ cùng danh sách để kiểm toán sau khi bake. Danh sách này mô tả mất motion, không thay cho skin-owner policy ở Model+Rig.

### Trọng số nhiều xương nguồn cho một joint đích — DOC-106

- Mục tiêu: cho phép người dùng điều chỉnh mức đóng góp xoay của từng source bone trong một chain descendant đã map vào cùng Mixamo65 role.
- Luồng: mở chain role → chỉnh trọng số không âm cho từng bone → lưu mapping; plan, preview, bake, metrics và preset dùng cùng vector. Mặc định đồng trọng số nếu dữ liệu cũ không có vector.
- Input/Output: `sourceBoneIds` và `sourceBoneWeights` có cùng thứ tự/độ dài; solver chuẩn hóa trọng số tương đối trước khi tính hemisphere-aligned quaternion mean. Vector rỗng, khác độ dài, giá trị âm/không hữu hạn hoặc toàn số 0 bị từ chối. Root translation vẫn theo sourceBoneId đầu tiên.
- UI: trường số cho từng bone chain; 0 loại ảnh hưởng xoay; giải thích rõ đây không đổi owner root motion hoặc skin.
- API/module: shared mapping schema, host validator, `SemanticBonePair`, universal solver/metrics, normalization plan/preview, portable mapping preset v3. Preset v1/v2 và project mappings không có weights tiếp tục đọc theo mặc định đồng trọng số.
- Nghiệm thu: quaternion weighted mean với trọng số 1:3 cho 0°/90° bằng khoảng 68.402°; bone đầu trọng số 0 vẫn giữ root displacement; malformed vectors bị chặn tại shared/host/solver; preset v3 roundtrip weights và v1/v2 remain importable.
- Tác động: chỉ thay cách gộp rotation cho mapping có vector; single-bone, chain cũ, root-motion ownership, Model skin-owner overrides, Assignment, 85 legacy actions và Minecraft20 reverse solver giữ hành vi.

### Truy vết source bone bị loại trong normalization — DOC-107

- **Mục tiêu:** người dùng xem được bone nào không chuyển motion và vì sao, cả trước khi bake lẫn trong báo cáo Motion đã tạo.
- **Luồng:** plan đọc `mapping.ignored` ở phía source, tra ID/tên từ Skeleton Profile, đưa danh sách vào nội dung được hash; khi chạy, cùng danh sách được ghi trong report derivative. UI cho mở danh sách ở kết quả Check plan.
- **Input/Output:** input là source bone ID và lý do đã lưu trong mapping; output mỗi mục gồm profile bone ID, tên hiển thị và lý do. Thiếu bone trong profile làm plan thất bại rõ ràng thay vì bỏ qua.
- **UI:** trạng thái plan hiển thị số mẫu/trạng thái; mục có thể mở rộng liệt kê tên, ID, lý do trước Normalize.
- **API/module:** `planProjectNormalization` → `stageProjectNormalization` → `normalizeAnimation`; `report.excludedSourceBones` giữ bản sao kiểm toán.
- **Nghiệm thu:** fixture integration loại một bone tùy chọn; plan hash thay đổi theo mapping; plan và report có cùng mục ID/tên/lý do; không sửa Action nguồn.
- **Tác động:** chỉ làm rõ mất motion trong nhánh Animation-only. Danh sách không quyết định skin owner, không xóa mesh/bone, không thay Skin transfer report hoặc legacy retarget.

### Đọc tám influence và review skin loss trước khi áp dụng — DOC-108

- **Mục tiêu:** không bỏ im lặng bộ influence glTF thứ hai; đo số vertex/weight bị cắt xuống giới hạn bốn output influences và cho người dùng xem trước khi ghi Model/Character vào project.
- **Luồng:** loader đọc lại accessor `JOINTS_1/WEIGHTS_1` bằng parser Three.js sau khi dựng geometry; rebind gộp influences theo owner, giữ 4 influence lớn nhất, đo weight bị cắt và xác minh rest mesh dùng đầy đủ source influences. Studio tạo staged GLB/report trước; người dùng xem sai số rest, vertex bị ảnh hưởng và weight loss theo mesh rồi bấm xác nhận để import/tạo Character/đặt Motion.
- **Input/Output:** hỗ trợ 1–8 influences/vertex (glTF set 0/1), tất cả set phải đủ cặp, kích thước/count đúng, joint index hợp lệ, weight không âm/hữu hạn và tổng mỗi vertex bằng 1 trong sai số `1e-3`. Output giữ tối đa 4; report có tổng weight bị cắt và số vertex chịu ảnh hưởng theo mesh. Thiếu cặp, set thứ ba hoặc dữ liệu lỗi thì dừng.
- **UI:** “Chuẩn bị và xem report” không ghi project; review hiện max rest error và loss theo mesh; chỉ nút xác nhận mới upload/import và tạo Character/clip trong Scene. Đổi asset, rig, mapping, Motion, owner hoặc revision làm staged result mất hiệu lực.
- **API/module:** Three.js `GLTFParser.loadAccessor`, `weightedSourceBones`, `rebindCanonicalModel`, skin report bất biến và `ModelRebindPanel` staged/apply; không đổi giới hạn shader/export bốn influences.
- **Nghiệm thu:** GLB có JOINTS_1/WEIGHTS_1 được loader khôi phục; influences 5–8 xuất hiện trong danh sách owner; test cho đúng dropped weight/affected vertex, rest-mesh sai số vẫn dưới ngưỡng; source bytes không đổi; không có project revision trước xác nhận; sau xác nhận report gắn output hash.
- **Tác động:** chỉ nhánh Model+Rig; Animation-only/Assignment vẫn độc lập. Ba set influences trở lên, nhiều skeleton cùng model, browser/WebGL và fixture nguồn thực ngoài phạm vi đã kiểm.

## 5. Animation Assignment và dữ liệu/API dự kiến

Chọn Target Character Mixamo65 → chọn một/nhiều Motion → kiểm topology/rest/unit → direct bind nếu fingerprint/rest phù hợp; nếu khác tỷ lệ/rest thì retarget/bake thành Motion derivative gắn target profile → Preview → Apply. Thêm Action mặc định; Replace chỉ thay liên kết đã chọn, không sửa Motion dùng chung của nhân vật khác. Action có ID ổn định; cho rename/remove binding/duplicate, giữ source. Export nhiều action cần manifest tên→ID, duration, root policy.

Normalization plan có `rootTranslationScale` tùy chọn `[0.01, 20]`; mặc định `1` giữ root travel theo mét. Nó chỉ tác động khi root policy là preserve, được đưa vào plan hash/job/report và truyền như nhau qua UI, CLI, MCP. Đây là hiệu chỉnh quãng đường root; chưa thay thế hiệu chỉnh A/T-pose, trục/chains hoặc calibration theo proportion.

Dùng lại Asset/Character/SkeletonProfile/Motion/Mapping/BlobRef. Bổ sung session normalization có version: source refs/hashes; source profile; canonical target profile version; mapping/preset; exclusion policies; calibration; selected actions/ranges/sampleFPS; root policy; output mode; report; derived IDs. Session mới không giả làm JSON V9.12. Preset lưu semantic rules + fingerprints, áp sang nguồn khác phải remap và xác nhận lại.

Host hiện có `rig.inspect`, `rig.normalization.plan/run`, `animation.assignment.plan/run/commit` cùng `job.get/cancel`. Normalization plan trả issues/mapping completeness và gắn calibration vào plan hash; Run dùng expectedRevision, staged outputs; asset import kiểm rồi commit. Assignment commit tạo derivative + bindings nguyên tử; Undo/Redo đổi refs, không xóa source blob. Retry dùng requestId; stale revision yêu cầu plan lại, không ghi đè project.

Python/Blender local xử lý rebind/mesh/export nặng qua broker host; math retarget dùng lại thư viện đang có khi phù hợp, engine mới nằm packages/retarget, không nhét vào shared. UI/CLI/MCP dùng cùng command validation. Scene nhận shared IDs qua character.add/motion.place sau chuẩn hóa; không gửi blob tùy ý hoặc dựng project thứ hai.

Output đề xuất MVP: GLB model+skin+actions; animation-only là GLB chứa skeleton/rest và channels không mesh, kèm report JSON. FBX export bổ sung sau khi có roundtrip test; không tuyên bố exporter Film BOBJ thay cho output Mixamo. Import MVP FBX hoặc GLB có rig humanoid/action baked, nguồn khác chỉ inspect/capability report tới khi có adapter.

## 6. Kế hoạch và nghiệm thu đề xuất

ID con mới giữ namespace 1.3.4, không đổi ID legacy 1.3.1–1.3.3. Các gate W01-PLAN-002 đã được duyệt triển khai trước đây; kế hoạch phần thiếu W01-PLAN-003 hiện chờ xác nhận code. Phụ thuộc và trạng thái ở [YAML](../inventory/workspace01-normalization.yaml).

| ID | Công việc / phụ thuộc | Điều kiện hoàn tất |
| --- | --- | --- |
| 1.3.4.1 | Khóa hai rig nguồn khác nhau, target65 và baseline | Hash/license/version, topology/rest nguồn khác nhau thật; có action thật, không ràng buộc số xương |
| 1.3.4.2 | Universal inspect và preview; sau .1 | Node/Bone/Skin/Actions đầy đủ; phát nguồn; lỗi capability rõ; bytes nguồn giữ nguyên |
| 1.3.4.3 | Mapping/preset/calibration/exclusion; sau .2 | Map đủ target roles hoặc missing policy; cảnh báo ambiguity/conflict; save/reload preset; trọng số chain theo từng bone; loại cánh có weight ownership |
| 1.3.4.4 | Rig65 + skin transfer; sau .3 | Đúng65 joints/parents; bind/inverse-bind hợp lệ; không orphan weights; rest mesh không drift vượt ngưỡng |
| 1.3.4.5 | Retarget/bake/compare; sau .3 | Hai rig nguồn → target65; animation-only không phụ thuộc skin transfer .4; timing/root/contact kiểm định, source bất biến |
| 1.3.4.6 | Assignment; sau .5 | Animation-only gán lên model65 thứ hai khác tỷ lệ/rest; add/replace/isolation/Undo/Redo/reopen đạt |
| 1.3.4.7 | Export/reimport/Send Scene; sau .4,.5,.6 | Cả hai output reimport đúng; Scene phát đúng Character/Motion; IDs, texture và history giữ |
| 1.3.4.8 | Runtime demo + regression; sau .7 | Ít nhất hai rig nguồn khác nhau → Mixamo65 → Character thứ ba → Preview đạt; ba luồng A/B/C và 85-action legacy regression có report/video/số đo; người dùng nghiệm thu riêng |

Giai đoạn P0 khóa hai nguồn/profile65/loss policy (.1); P1 import/mapping (.2–.3); P2 ưu tiên animation-only retarget (.5) và Assignment (.6), nhánh rig/skin (.4) độc lập sau .3; P3 hợp nhất hai output/Scene (.7); P4 runtime/regression (.8). Không chuyển gate chỉ vì UI đã render. Mỗi phase bàn giao demo + test + gap list.

MVP chọn ưu tiên nguồn A: nhân vật Character Creator/iClone ở rig nguyên gốc với action body; nguồn B: UE4 Mannequin hoặc UE5 Manny với action body. Khóa đúng một phiên bản cho mỗi sample; không đổi CC sang skeleton Unreal/Mixamo trước khi đưa vào engine. Cả hai chuyển về profile Mixamo65 rồi gán lên nhân vật C có tỷ lệ/rest khác nguồn. Nếu chưa có hai fixture này, phương án thay thế là Maya/custom rig hoặc Warcraft humanoid có dữ liệu hợp lệ; thay sample phải ghi rõ, không được báo PASS cho nhóm chưa chạy. Chi tiết ở [ma trận nguồn và kế hoạch mẫu](../WORKSPACE01_SOURCE_REVIEW.md).

Số115 chỉ là ví dụ lịch sử, không còn là điều kiện nghiệm thu. Hai file cùng một skeleton đổi tên, hoặc cùng asset đi qua hai phần mềm, không được tính là hai hệ xương khác nhau. Đếm bones/nodes thực tế từ file, không suy từ nhãn CC/UE/Unity. Fixture synthetic dùng test thuật toán/resource limits, không thay runtime trên action thực. Chưa khóa bytes của hai mẫu mới; mọi metric đang unknown, runtime NOT_RUN.

Ngưỡng đề xuất cần chốt với fixture: weight hữu hạn/không âm/tổng sai số ≤1e-5, zero orphan vertices; rest retained-mesh max error ≤1e-5 × chiều cao nhân vật; duration lệch ≤1 sample; root trajectory lệch ≤1cm khi giữ mét; sai số angular ở joints mapped tương thích ≤2° sau alignment; hand/foot contact drift ≤2cm trong đoạn được đánh dấu. Đo RMS/max deformation trên vùng mesh giữ lại (mục tiêu RMS ≤1% chiều cao, max ≤3%); vùng bị cố ý loại chuyển động báo riêng, không dùng để che lỗi torso/chi. Các ngưỡng này là đề xuất, chưa đo hoặc PASS; khác tỷ lệ phải so trong không gian đã chuẩn hóa/target goal, không so tọa độ nguồn thô.

Test bắt buộc: thiếu/đảo left-right/duplicate mapping; stale preset; loại cánh còn weights; twist/multi-chain; nonidentity rest/basis/unit; cancellation/stale revision; source immutable; multiple Actions/loop/trim/root; export-reimport; assignment model thứ hai; save/reopen/Undo/Redo; hồi quy đường cũ. Browser/WebGL và output file thực phải được kiểm, test mock không thay runtime.

## 7. Tiến độ, tác động và điểm cần chốt

Theo 8 gate mới: **0/8 gate đã nghiệm thu (0%)**. Đây là tỷ lệ nghiệm thu mục tiêu mới, không phải 0% code nền và không phải ước lượng khối lượng. Nền import/mapping/playback/history có thể tái sử dụng nhưng chưa đủ để đánh dấu gate mới hoàn tất. Không cộng tỷ lệ AC hoặc Film vào mục tiêu universal animation retargeting.

Tác động: Workspace02 nhận derivatives và profile mới; Workspace03 tiếp tục tạo/sửa animation trên Character đã chuẩn hóa; Film dùng output chung nhưng không nằm gate MVP Workspace01. Giữ API/session V9.12 và các dự án cũ qua versioned adapter; không nới validator hiện tại hàng loạt.

Ghi chú lịch sử trước đợt code đầu (manifest65 hiện đã pin; xem W01-PLAN-003 cho quyết định còn mở): manifest65 chuẩn; hai fixture nguồn khác nhau và license; output MVP GLB có đủ nhu cầu hay bắt buộc FBX; chính sách cánh giữ mesh+owner hay rigid attachment; các ngưỡng trên. Đề xuất mặc định: GLB trước, giữ mesh và chọn owner rõ, humanoid một armature, 30FPS bake có giữ duration và boundary nguồn. Các lựa chọn này chưa được coi là phê duyệt triển khai.

## 8. Báo cáo từng mẫu và tiêu chí MVP mới

[Ma trận nguồn](../WORKSPACE01_SOURCE_REVIEW.md) liệt kê ứng viên theo nhóm; [registry](../fixtures/workspace01-source-candidates.yaml) giữ số đo null khi chưa chạy. Với mỗi sample lưu: source/version/hash, native/interchange format, converter version, bone count và node count thực, actions/duration, import status, auto mapping coverage, mapping sau chỉnh tay, chất lượng sau retarget, excluded/unmapped bones/tracks, Assignment target, output và runtime artifacts.

Mapping: báo số target slots có source correspondence hợp lệ /65 trước và sau sửa tay; nhiều→một chỉ tính target một lần. Báo thêm số required semantic roles đạt / tổng required đã khóa trong target profile và source bones đã xử lý / tổng source bones. Xương sinh ở rest không được tính là mapped animation. Gợi ý confidence cao vẫn phải đo độ chính xác so mapping chuẩn; 100% coverage không chứng minh animation đúng.

Runtime states: NOT_RUN = chưa chạy; BLOCKED = thiếu fixture/tool/adapter; FAIL = đã chạy và vi phạm acceptance; PASS = đủ evidence ở gate tương ứng. Không dùng FAIL thay cho chưa có dữ liệu. Quality report lưu joint angle error, target-space end-effector error, root/timing error, contact drift, mesh metrics nếu có; người dùng xem video side-by-side và report loss trước nghiệm thu.

MVP animation gate: hai source rig khác topology/rest thực → canonical Mixamo65 motion → gán từng motion lên model C tương thích khác tỷ lệ/rest → browser Preview/play/scrub/reopen đúng và không sửa Action nguồn. Đo cả root translation và turning, timing, pose; ít nhất một source có helper/extra bones để kiểm exclusions. Model-output gate riêng giữ rig65/weights/material/animation/export-reimport/Scene. Tổng nghiệm thu mới vẫn 0/8; không chuyển thành phần trăm từ UI hoặc nguồn docs của hãng.
