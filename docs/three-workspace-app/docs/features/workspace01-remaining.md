# W01-PLAN-003 — Kế hoạch và đặc tả phần còn thiếu

Ngày: 2026-10-20. Baseline code đối chiếu: DOC-108. Đặc tả ban đầu được lập theo yêu cầu chưa code; người dùng sau đó đã cho phép code đầy đủ theo goal. Hiện triển khai từng task; xem [STATUS](../STATUS.md) và [inventory](../inventory/workspace01-remaining.yaml) để biết implementation/evidence. Runtime và fixture vẫn chờ theo lựa chọn trước đó.

Phạm vi là phần thiếu của Workspace 01 Universal Animation Retargeting Engine, giữ các yêu cầu tại [đặc tả gốc](rig-animation-normalization.md). Không bao gồm hoàn tất Workspace 02/03 hay Film. [Inventory phần thiếu](../inventory/workspace01-remaining.yaml) và [LISTCODE](../../LISTCODE) dùng cùng ID; 17 task con không thay 8 gate nghiệm thu. Các phương án kỹ thuật bên dưới được đề xuất để duyệt, không phải hành vi đã có.

## 1. Đối chiếu hiện trạng và phần cần bổ sung

Đường dẫn code trong tài liệu tính từ `three-workspace-app/`; tên symbol là điểm sửa thực tế, không phải module mới đã được tạo. Đây là rà soát tập trung các luồng liên quan, không tuyên bố audit toàn bộ ba ứng dụng.

| Phần | Đã có trong code | Khoảng trống xác nhận / cần kiểm |
| --- | --- | --- |
| Inspect và sampler | `createThreeRigAdapter`, `inspectProjectRig`: giữ ancestor, sample trên clone, cây nguồn/action | Adapter chặn nhiều skeleton; profile links dựa tên; track ngoài rig/không hỗ trợ làm lỗi inspect thay vì báo theo Action |
| Mapping | `validateSemanticMapping`, `validateUniversalMapping`; đủ role65, chain, trọng số, preset v3, ignored reasons | Gợi ý chủ yếu theo alias; thiếu xác nhận topology/geometry, reference-pose calibration universal và local-chain composition |
| Calibration | `rootTranslationScale`, preserve/in-place chạy xuyên plan/job/UI/CLI | `skeleton.mapping.set` chỉ nhận calibration V9.12 và ghi `referencePose: null`; normalization plan không tiêu thụ calibration pose |
| Solver | `createUniversalRetargeter`: weighted mean world rotation delta, hierarchy target, root travel | Chưa có reference-pose correction riêng, local composition, end-effector constraint hay contact solve; không coi target rest length hiện có là đã có IK |
| Model+Rig | `makeCanonicalSkeleton`, `rebindCanonicalModel`: dùng profile đích, chuyển skin; DOC-108 đọc 8→4 influences và review trước Apply | Chưa fit target rig theo source; ownership vẫn theo tên; thiếu animated deformation metrics, rigid attachment/exclude-mesh policy, texture roundtrip |
| Assignment | `assignCanonicalAnimation`, host plan/run/commit: derivative theo receiver, history/revision | Cần add/replace/isolation rõ ràng, giữ range/root policy, preview và kiểm receiver khác tỷ lệ thực |
| Scene handoff | Model panel gọi `asset.import` → `character.add` → `motion.place` | Ba command riêng có thể để lại project dở dang; cần một transaction và một Undo |
| Quality | `createNormalizationMetrics`: solver consistency; synthetic roundtrip/test | Chưa có reference độc lập/contact/mesh metrics; test vừa chạy solver vừa so công thức solver không chứng minh motion đúng |
| Kiểm tra | DOC-108 ghi Studio 68 PASS/2 SKIP, Retarget 52/52, typecheck đạt | Đây là kết quả lịch sử, chưa chạy lại; lint/evaluate có lỗi sceneBasis, build có Windows EPERM; runtime chờ fixture |

Tái sử dụng nguyên các solver V9.12, catalogue85, upload/blob/hash, command/revision/history, normalize/bake/export và preview đang có. Chỉ bổ sung tại ranh giới còn thiếu. Không tạo editor pose tổng quát trong Retarget; công cụ calibration dưới đây chỉ xác lập tư thế tham chiếu và joint fit phục vụ chuyển đổi.

## 2. Hợp đồng kỹ thuật chung đề xuất

### 2.1 Identity, capability và bảo toàn nguồn

Identity dùng source hash + skeleton/component ID + node identity từ parser; tên là nhãn hiển thị. ID `node:index` hiện tại chỉ có hiệu lực trong cùng kết quả parse; không lưu xuyên converter revision nếu chưa có bảng liên kết kiểm chứng. Mapping/preset phải xác nhận lại khi fingerprint hoặc node identity thay đổi.

Kết quả inspect thêm `skeletons`, `selectedSkeletonId`, `actions`, `issues`. Mỗi issue gồm `code`, `severity` (info/warning/blocking), node/track/action liên quan, ảnh hưởng `animation-only`/`model` và cách xử lý. Capability dùng trạng thái `supported`, `requires-conversion`, `unsupported`, `unverified`; không suy ra hỗ trợ từ tên hãng. Lỗi Action B không làm mất khả năng inspect hoặc chạy Action A hợp lệ.

Nguồn chính vẫn FBX và GLB/glTF tự chứa đã có adapter. `.ma/.mb/.uasset/.iMotion` và format game chưa có converter xác minh phải báo cần chuyển đổi; kế hoạch này không mặc nhiên thêm native parser cho từng hãng. Unsupported track phải có chính sách rõ: chặn phần bị ảnh hưởng hoặc loại có xác nhận và ghi report; không âm thầm bỏ.

### 2.2 Universal calibration và migration

Đề xuất JSON blob riêng `bbs.universal-calibration`, `version: 1`, `engine: universal`, gắn source/target fingerprint, source hash, mapping digest, units/basis, selected skeleton và algorithm version. `SkeletonMapping.calibration` tiếp tục là BlobRef nhưng validator đọc discriminated union với V9.12; không diễn giải các slider V9.12 thành universal settings.

- `sourceReference` và `targetReference`: rest mặc định hoặc snapshot đầy đủ TRS tại Action/time được chọn, kèm corrections quaternion theo node ID. Không đổi rest/bind hay Action nguồn. Không cần ghi lại cùng snapshot ở cả hai blob: `referencePose` trỏ snapshot dùng bởi calibration và được kiểm hash.
- `chainMode`: mỗi target role là `world-average` mặc định hoặc `local-compose` opt-in. Dữ liệu cũ giữ nguyên kết quả world-average; preset mới version4, đọc v1/v2/v3 như hiện tại, không suy đoán pose khi import preset sang rig mới.
- `root`: preserve/in-place hiện có; scale mặc định1. Đề xuất `scaleMode: meters | manual | height-ratio`; tỉ lệ chiều cao tính từ hip đến ground trong tư thế tham chiếu đã xác nhận, không lấy bounding box cánh/đuôi. Cấm vừa nhân height-ratio vừa nhân manual lần nữa. Chưa đủ mốc chân thì bắt chọn meters/manual.
- `limbs`: end-effector mode `off` mặc định hoặc `scaled-displacement`, pole vector và giới hạn solve. Đề xuất chain hai đoạn tay/chân; không giả định arbitrary source topology là chain IK hai đoạn.

Plan phải hash toàn bộ dữ liệu đã resolve: defaults, calibration blob hash, reference pose hash, target profile/fit hash, selected skeleton, mapping, exclusions, action/range, root policy và solver version. Mọi thay đổi vô hiệu staging. Thiếu calibration universal ở project cũ chạy chế độ legacy-compatible hiện có, hiển thị rõ và không tự chuyển data lưu trên đĩa.

API dự kiến mở rộng `skeleton.mapping.set`, `rig.inspect`, `rig.normalization.plan/run`, `animation.assignment.plan/run/commit`. Cùng contract dùng cho UI, Python CLI/MCP. `expectedRevision` bắt buộc ở run/commit; read-only plan không tăng revision. Unknown field/version, stale hash và không tương thích profile trả lỗi có cấu trúc. Commit lưu snapshot/blob mới, một Undo khôi phục project; blob bất biến chưa tham chiếu không bị xóa tự động trong thao tác Undo.

### 2.3 Quy ước thuật toán cần kiểm trước khi nối UI

Quaternion dùng `[x,y,z,w]`, normalize, `q` và `-q` tương đương; tất cả tọa độ solver đã về mét và scene basis đúng một lần. Reference pose là correction riêng, không thay target bind pose; output keys vẫn biểu diễn trên target rest/bind để Assignment và skin hoạt động.

Reference alignment cho world-average: tính world delta của source so source reference, chuyển qua basis alignment đã lưu, áp lên target reference; root displacement tính từ cùng reference origin. Source tại reference phải trả đúng target reference. Calibration mặc định rest + identity alignment phải giữ kết quả DOC-108 trong tolerance.

Local-compose opt-in: resolve đường ancestry liên tục giữa các bone đã chọn, bao gồm helper trung gian; lấy local quaternion tương đối với parent, tạo local reference delta, conjugate vào cùng target-parent reference frame rồi mới nhân theo thứ tự ancestor→descendant. Không cộng trực tiếp Euler và không nhân các world delta đã chứa cùng chuyển động parent. Trọng số0 bỏ delta; trọng số local-compose là hệ số góc `[0,1]`, dùng shortest-arc slerp(identity,delta,w), không dùng nghĩa tương đối của world-average. Khi đổi mode phải đề xuất weights mới và yêu cầu review, không tự diễn giải vector cũ. Chuyển động ancestor ngoài chain do target parent hoặc base alignment nhận đúng một lần; mọi contributor/owner ghi trong plan. Sai chain, overlap ownership không giải được hoặc reference parent thiếu thì chặn. Bộ golden độc lập phải kiểm parent quay, twist và noncommuting axes trước khi nghiệm thu.

End-effector: với limb base B và endpoint E, định nghĩa `d(t)=(E_source(t)-B_source(t))-(E_source(ref)-B_source(ref))`; goal target là base target hiện tại + reference offset target + `s * R * d(t)`. `s` là target/source chiều dài chain đã xác nhận, `R` từ reference alignment. Analytic two-bone IK dùng pole vector và giữ độ dài target; goal ngoài tầm với được clamp và ghi residual, không kéo dài xương. Endpoint orientation xử lý riêng sau vị trí. Contact interval được đánh dấu mới khóa goal world; không tự ghi contact PASS nếu chưa có annotation.

### 2.4 Báo cáo và điều kiện chấp nhận

Report versioned gồm provenance/hash, warnings/loss, số slots mapped `/65` trước/sau chỉnh tay, required roles coverage, source bones xử lý, unsupported tracks và từng metric. Mỗi metric có value/unit/sampleCount/referenceSpace/referenceHash/method/status; không có dữ liệu thì value null, status NOT_RUN hoặc UNAVAILABLE. `solver-consistency` giữ riêng với `reference-quality`.

Ngưỡng đề xuất từ đặc tả gốc: weight sum sai số≤1e-5, không orphan; rest mesh max error≤1e-5×height; duration lệch≤1 sample; root error≤1cm; angular≤2° ở joint tương thích sau alignment; contact drift≤2cm trên interval đánh dấu; retained-mesh deformation RMS≤1%height, max≤3%. Golden tổng hợp dùng ngưỡng số học chặt hơn theo test. Ngưỡng runtime cần chốt với fixture; report lưu threshold profile/hash, không tự hạ ngưỡng để PASS. Mesh vùng cố ý mất chuyển động báo riêng và không loại torso/chi khỏi số đo để che lỗi.

## 3. Task và đặc tả triển khai

Mỗi task dưới đây chỉ là kế hoạch bổ sung/kiểm chứng. Test được mô tả là test cần viết/chạy sau khi được code, không phải kết quả đã đạt. Dependencies máy đọc ở YAML; thứ tự phase ở mục4.

<a id="1.3.4.1.1"></a>
### 1.3.4.1.1 — Khóa fixture thực và reference độc lập

- Mục tiêu/luồng: tiếp nhận nguồn được phép sử dụng, kiểm hash/license/version → inspect → xác nhận mapping/contact/reference → khóa registry. Tối thiểu hai topology/rest thật khác nhau, một receiver C khác tỷ lệ; ưu tiên CC/iClone và UE. Không dùng cùng skeleton đổi tên để đếm hai nguồn.
- I/O: bytes source + provenance → manifest có hash, converter/version, actions, actual bone count, mapping chuẩn và reference evidence. Fixture chưa có giữ null/NOT_RUN.
- UI/API/code: registry `docs/fixtures/workspace01-source-candidates.yaml`, `WORKSPACE01_SOURCE_REVIEW.md`; dùng inspector/report task .2.2. Không cần UI tải asset công khai mới.
- Lỗi/nghiệm thu: license/identity chưa rõ không tính fixture đạt; cả ba file và reference kiểm lại hash được, nguồn bất biến. Tác động: mọi gate runtime; **chờ fixture theo lựa chọn người dùng**, không cản test code tổng hợp.

<a id="1.3.4.2.1"></a>
### 1.3.4.2.1 — Identity và chọn skeleton

Implementation partial DOC-112: GLB/glTF import now creates one profile per distinct skin by node index; FBX import separates bone components. Motions route by node identity where one Action resolves to one profile; ambiguous glTF/FBX Actions remain in source and return an `actionIndex` issue. `rig.inspect` accepts a selected profile ID, and normalization/Model+Rig UI and preview carry that selection. Duplicate labels are allowed in the shared profile validator and linked through source node UUIDs. Synthetic glTF import/host tests pass. This does not complete converter-version identity, cross-workspace profile lifecycle, or real-FBX/other-format verification; runtime remains deferred. See [DOC-112 evidence](../evidence/workspace01-doc112-validation.yaml).

- Mục tiêu/luồng: inspect từng skeleton/component → người dùng chọn → giữ ancestor liên quan → resolve profile links bằng identity → sample riêng. Nhiều mesh chung skeleton không bị đếm thành nhiều rig.
- I/O: imported asset, selection → selected rig/profile links/actions và danh sách phần không chọn. Bao gồm nguồn chỉ có animation, không cần mesh.
- UI/API/code: skeleton selector, tree hiển thị path khi trùng tên; mở rộng `rig.inspect`/plan; sửa `threeRigAdapter.ts`, `unifiedRigInspection.ts`, profile extraction tại `unifiedAssetFiles.ts`, `RigTree.tsx`, shared validators và CLI/MCP.
- Lỗi/nghiệm thu: duplicate names vẫn chọn đúng ID; cycle/dangling refs chặn; shared ancestor được evaluate đúng, không bỏ track âm thầm; reimport cùng bytes giữ links, converter đổi thì vô hiệu preset. Test hai rig cùng tên bones + animated container và source immutable. Tác động: mapping, Model owners, Assignment, target fingerprint.

<a id="1.3.4.2.2"></a>
### 1.3.4.2.2 — Capability, losses và budget trước chạy

Implementation partial DOC-112: per-Action unsupported-track diagnostics, per-Action importer ownership issues, plan blocking for affected Actions, node-sample/working-set estimate, and pre-bake budget guard are in code. Action import ambiguity no longer prevents unrelated valid Actions from being persisted. Format capability/conversion matrix, raw influence preservation above importer limits, and the full UI/CLI/MCP loss-confirmation workflow remain open. See [validation evidence](../evidence/workspace01-doc112-validation.yaml) and [DOC-111](../evidence/workspace01-doc111-validation.yaml).

- Mục tiêu/luồng: inspect không phụ thuộc bake → phân loại từng Action/track/format → hiển thị điều kiện còn thiếu → plan chỉ chạy phần hợp lệ. Rà các cap importer/shared/worker hiện có, giữ sample cap18000 hiện tại; bổ sung dự toán node×sample/memory và cancellation thay vì cố định số xương theo hãng.
- I/O: graph, channels, output mode → diagnostics/capabilities/estimatedCost/ready; report có các mất mát người dùng đã xác nhận.
- UI/API/code: panel Diagnostics gần action selector, badge từng Action, thông báo cần converter; sửa `threeRigAdapter.ts`, `unifiedRigInspection.ts`, `unifiedNormalizationPlan.ts`, `unifiedJobs.ts`, normalization hook/panel và CLI/MCP.
- Lỗi/nghiệm thu: morph/scale động/shear/constraint chưa bake/external resource không bị silently dropped; unsupported Action B không chặn Action A. >8 influences phải phát hiện từ raw format hoặc báo chưa xác minh, không dựa loader đã bỏ dữ liệu. Test resource rejection trước allocate lớn và cancel không commit. Tác động: mọi plan/preview/export; capability model hiện hardcode false phải thay bằng kết quả có bằng chứng, không flip true hàng loạt.

<a id="1.3.4.2.3"></a>
### 1.3.4.2.3 — Preview mesh và review sai lệch

- Mục tiêu/luồng: mở source + staged derivative/receiver → cùng Action/time/FPS → play/pause/scrub → overlay bones/contact/error, hiển thị loss và material warnings.
- I/O: asset blobs, calibrated plan, derivative/report → hai viewport cùng playhead; không ghi project khi xem. Skeleton-only vẫn dùng khi không có mesh.
- UI/API/code: mở rộng `NormalizationPreview.tsx`, `previewUtils.ts`, `ModelRebindPanel.tsx`, `AssignmentPanel.tsx`; dùng cùng adapter/solver/exported derivative, không viết solver thứ hai trong React.
- Lỗi/nghiệm thu: selection đổi/cancel/unmount dispose resources và bỏ kết quả cũ; explicit notice runtime4 influences nếu source8, không dùng preview4 làm reference source8. Test playhead/cleanup/headless sampling; WebGL mesh/texture chỉ nghiệm thu ở .8.2. Tác động: Scene/Animation dùng cùng binding và root policy.

<a id="1.3.4.3.1"></a>
### 1.3.4.3.1 — Calibration reference pose và persistence

- Mục tiêu/luồng: chọn rest hoặc frame A/T → correction từng role cần thiết → đối chiếu pose → lưu calibration blob → rebuild plan → preview/bake cùng settings.
- I/O: source/target snapshot, mapping, reference corrections, root policy → calibration v1 theo mục2.2, hash-bound plan/report. Preview hiện lưu frame nguồn hiện tại và reference đích là rest hoặc Action tại cùng playhead (clamp theo duration), có căn chỉnh trục chung và correction role. Root mode/scale có trên normalization controls. Chưa có timeline tạo Action mới.
- API/code: shared mapping/store command `skeleton.mapping.set`, `persistUniversalReferencePose`, `unifiedNormalizationPlan.ts`, `normalizeAnimation.ts`, `universalCalibration.ts`, `universal.ts`; UI `NormalizationPreview.tsx`. CLI/MCP và preset version4 chưa nối.
- Trạng thái implementation partial DOC-113: immutable v1 calibration/reference blobs được ràng buộc bằng source hash, mapping digest, reference SHA; solver/runtime và plan hash dùng cùng snapshot; preview hiện hỗ trợ target rest/action, global alignment và correction theo role. Target Action UI chưa có preview lựa chọn riêng: dùng shared playhead; chưa có preset migration v4, CLI/MCP parity hoặc browser/WebGL/fixture review.
- Lỗi/nghiệm thu: quaternion không hữu hạn/zero, missing parent, stale pose/profile, unsupported version chặn. Tests rest mặc định parity, A→T và T→A nonidentity basis, save/reopen/preset v1–v4, modified settings đổi plan hash, source rest/Actions không đổi. Tác động: Assignment/model fit/preview đều dùng cùng calibration; V9.12 giữ decoder riêng.

<a id="1.3.4.3.2"></a>
### 1.3.4.3.2 — Chain local composition

- Mục tiêu/luồng: chọn mode cho target chain → resolve contributors/helper ancestors → review weights/ownership → compose theo mục2.3 → bake và báo mode/weights thực dùng.
- I/O: ordered source path, reference calibration, chain mode/weights → quaternion target và diagnostics. UI mode selector, contributor list, reset defaults; world-average mặc định bảo toàn DOC-106.
- API/code: `RetargetBonePair`, semantic/shared validators, `mappingPreset.ts`, plan, `universal.ts`, preview và metrics; không dùng lại quaternion average như phép compose.
- Lỗi/nghiệm thu: branch/cycle/missing sample/overlapping ownership không giải được chặn. Golden độc lập: hai trục không giao hoán, parent quay90°, helper chưa map, weights0/1, near180°; không double-count ancestor/root. Metrics phải biết mode. Tác động: preset migration, derived Motion hash; không đổi existing clips.

<a id="1.3.4.3.3"></a>
### 1.3.4.3.3 — Proportion và end-effector constraints

- Mục tiêu/luồng: derive chain lengths/reference axes → review pole/scale → bật IK tùy limb → solve sau rotational retarget → clamp/report residual → bake.
- I/O: calibrated source sample, target lengths, limb goals/contact intervals → target rotations giữ chiều dài, root cùng policy và residual. UI limb enable, pole gizmo, contact range, reachable status; mặc định off.
- API/code: bổ sung solver thuần dự kiến `packages/retarget/src/universalLimbSolve.ts`; nối `universal.ts`, `normalizeAnimation.ts`, metrics và calibration contract. Chỉ tái sử dụng IK sẵn có nếu frame/constraints và test phù hợp; không kéo UI Animation vào Retarget.
- Lỗi/nghiệm thu: zero-length/collinear pole báo rõ; singular pose giữ nghiệm liên tục hoặc lỗi, không NaN; unreachable clamp không stretch. Tests tay/chân target dài/ngắn, quay body, hai contact đồng thời, root preserve/in-place không cộng hai lần, giải tắt giữ baseline. Tác động: Assignment/model fit phải dùng đúng target fingerprint; contact quality thực cần .1.1/.8.2.

<a id="1.3.4.3.4"></a>
### 1.3.4.3.4 — Gợi ý mapping theo hierarchy và geometry

- Mục tiêu/luồng: giữ alias hiện có → lọc ancestry/side/rest direction → xếp candidate có lý do → người dùng xác nhận. Không tự confirm khi chỉ đủ65 slots.
- I/O: rig/profile/calibrated basis → candidate scores, ambiguity, required-role coverage và optional joints nghỉ. UI giải thích gợi ý, chọn bone qua tree, thông báo left/right conflict.
- API/code: mở rộng `mapping.ts`, `MappingEditor.tsx`, `RigTree.tsx`; giữ validators và manual fallback. Preset fingerprint khác chỉ gợi ý, không tự áp calibration.
- Lỗi/nghiệm thu: rig tên ngẫu nhiên vẫn mapping tay; bone đối xứng ambiguous giữ rỗng; ảnh hưởng xương phụ không làm chọn sai root. Test renamed/duplicate/twist skeleton và side conflict; accuracy runtime so mapping chuẩn, không đánh đồng confidence với accuracy. Tác động: giảm thao tác cho các nguồn, không thêm solver theo hãng.

<a id="1.3.4.4.1"></a>
### 1.3.4.4.1 — Fit rig65 theo model nguồn

- Mục tiêu/luồng: source reference + confirmed mapping → fit vị trí joints target65 → review → sinh profile mới → rebind giữ rest mesh → normalize Action lên đúng fitted profile.
- I/O: source rest/calibration + canonical template → exactly65 hierarchy, fitted rest/local TRS, inverse binds, fingerprint mới và report joints synthesized. Không dùng clip từ profile cũ trên rig fit mới: phải normalize/assign lại trước xuất. Stage skeleton GLB và profile mới thành một cặp hash-verified; plan resolve target từ cặp này qua loader hiện có, không chỉ đổi target profile trong khi vẫn sample bytes của template cũ. Chưa commit Asset/Character khi chỉ review fit.
- UI/API/code: fit preview và reset template trong ModelRebindPanel, `makeCanonicalSkeleton`/`rebindAndExport` tại modelUtils, `mixamo65.ts`, `rebindCanonicalModel.ts`; module fit thuần dự kiến `packages/retarget/src/fitCanonicalRig.ts`.
- Lỗi/nghiệm thu: thiếu required joint chặn; optional finger thiếu dùng template tỷ lệ/rest đã đánh dấu; zero segment/invalid rest chặn. Tests source khác tỷ lệ, exactly65 parents, fingerprint đổi, source mesh/rest không đổi, rest drift trong ngưỡng. Tác động: mapping target/profile/Motion/Assignment cần replan khi fit đổi; canonical template gốc bất biến.

<a id="1.3.4.4.2"></a>
### 1.3.4.4.2 — Exclusion policy và animated skin loss

- Mục tiêu/luồng: giữ Prepare/Review đã có → ownership bằng identity → chọn transfer/rigid-attachment/exclude-mesh cho vùng phụ → đo rest và animated deformation → xác nhận bản loss cụ thể trước Apply.
- I/O: source weights/mesh IDs, owner map, derived samples, policy → model derivative + report theo mesh/region/vertex, dropped-weight và deformation max/RMS. Reference deformation tính CPU từ raw influence sets đã inspect, không từ GPU preview chỉ có4 influences; so trong cùng không gian/reference đã hiệu chỉnh tỷ lệ. Region trộn torso và phần phụ phải review; exclude-mesh chỉ bỏ khỏi bản sao output.
- UI/API/code: `modelUtils.ts`, `universalSkin.ts`, `rebindCanonicalModel.ts`, ModelRebindPanel và host report validation. Rigid attachment là scene node, không thêm joint thứ66; metadata giữ source ID/owner/policy.
- Lỗi/nghiệm thu: weighted bone không owner chặn, unresolved duplicate name chặn, rest loss vượt ngưỡng không tự Apply; >8 influences báo unsupported trước mất dữ liệu. Tests wings weighted, source8→output4, cùng tên khác ID, rigid follow đúng, retained torso metrics không bị loại. Tác động: scene assets và export report; user review không được thay bằng một cờ global không gắn output hash.

<a id="1.3.4.5.1"></a>
### 1.3.4.5.1 — Action range, batch và channel policy

- Mục tiêu/luồng: chọn một/nhiều Action và range → plan chi phí/loss từng action → bake sequential/cancellable → staged derivatives riêng → commit phần thành công được chọn rõ.
- I/O: action IDs/indices, start/end giây, fps, loop/trim/reverse/speed nếu đã chọn trong workflow → source provenance, output time mapping và exact boundary samples. Default full action giữ hiện tại; không áp timeline speed lần hai vào derivative.
- UI/API/code: action list/range controls, normalization hooks; `normalizeAnimation.ts`, `universalBake.ts`, `universalGlb.ts`, plan/jobs/CLI/MCP. Tái sử dụng sampler/range utilities của Motion khi cùng semantics.
- Lỗi/nghiệm thu: empty/invalid range chặn; cap tính từng job và tổng batch, cancel không ghi Motion dở; unsupported translation track ngoài root có policy được review, không silent loss. Tests noninteger endpoint, loop boundary, reverse, hai Action một lỗi, exact duration và source immutable. Tác động: Assignment/timeline report giữ đúng source range.

<a id="1.3.4.5.2"></a>
### 1.3.4.5.2 — Quality report độc lập và roundtrip

- Mục tiêu/luồng: sample source/reference + output → đo từng metric theo mục2.4 → export/reimport → đo lại → report có worst frames và provenance; không dùng output solver làm reference cho chính nó.
- I/O: calibrated reference goals/contact labels, source/output samples và optional mesh regions → report versioned, null cho metric chưa đo. UI bảng metric, nhảy tới frame lỗi, tải JSON report.
- API/code: mở rộng `normalizationMetrics.ts`/tests, normalize/export/Assignment report, host derivative persistence; module reference comparison mới chỉ khi cần tách khỏi consistency helper.
- Lỗi/nghiệm thu: thiếu reference trả UNAVAILABLE, không0/PASS; test perturb rotation90°, translation2m, thời gian1sample, chân trượt và texture thiếu phát hiện đúng; roundtrip frame metrics bảo toàn. Tác động: report mọi workspace; không coi host kiểm schema report là host đã recompute deformation.

<a id="1.3.4.6.1"></a>
### 1.3.4.6.1 — Assignment add/replace và isolation

- Mục tiêu/luồng: chọn Motion+Character C → plan calibration/range/root → chọn add hoặc replace đúng clip → preview staged → atomic commit → Undo/Redo/reopen.
- I/O: existing args mở rộng placement frame, mode, replaceClipId và root/calibration reference → derivative theo receiver + Binding/timeline clip. Add mặc định giữ hành vi cũ; replace giữ vị trí/range đã xác nhận, không xóa clip cùng Motion trên Character khác.
- UI/API/code: `AssignmentPanel.tsx`, `hooks/useAssignment.ts`, `unifiedAssignment.ts`, `assignCanonicalAnimation.ts`, store commit, CLI/MCP. Tái sử dụng atomic Assignment commit hiện có, không viết transaction thứ hai.
- Lỗi/nghiệm thu: receiver đổi rest/hash hoặc stale revision chặn; source clip in-place không bị biến thành travel; tests hai Character dùng chung asset, add/replace/Undo/Redo/reopen và receiver khác rest/tỷ lệ. Tác động: Workspace02/03 thấy cùng IDs, không mutate Motion nguồn.

<a id="1.3.4.7.1"></a>
### 1.3.4.7.1 — Model gửi Scene bằng một transaction

- Mục tiêu/luồng: Prepare/Review đã có → upload staging → host verify hash/profile/Motion/report → một command commit asset+profile+Motion+Character+clip+Binding → trả IDs/revision. Một Undo bỏ toàn bộ kết quả khỏi project.
- I/O: staged upload/report, output hash, review hash, placement/name, expectedRevision → project revision mới và IDs. Đề xuất command mới `rig.model.commit`; không đổi semantics của `asset.import` cho caller cũ.
- UI/API/code: ModelRebindPanel thay chuỗi ba lệnh hiện tại; `unifiedProjectStore.ts`, `unifiedAssetFiles.ts`, shared command contracts và CLI/MCP. Tái sử dụng cơ chế staging/atomic save/history của Assignment.
- Lỗi/nghiệm thu: fail sau từng bước, disk failure, stale review/revision không để Character thiếu clip hay asset project thừa. Retry cùng command identity không tạo bản đôi; commit thành công nhưng response mất phải truy hồi được. Test fault injection và một Undo/Redo/reopen. Tác động: Scene/history chung; orphan staging chỉ thu hồi theo cơ chế hiện có sau xác minh không còn refs.

<a id="1.3.4.7.2"></a>
### 1.3.4.7.2 — Export/reimport và material fidelity

- Mục tiêu/luồng: chọn Animation-only hoặc Model+Rig+Actions → export GLB tự chứa + report → reimport → kiểm joints/keys/skin/material → cho tải/gửi Scene. Không thêm FBX exporter mới trong đợt này; yêu cầu đó giữ là lựa chọn mở.
- I/O: committed/staged derivative và assets → GLB/report có hashes; giữ image/UV/material assignments, alpha mode/doubleSide và names/provenance theo format hỗ trợ.
- UI/API/code: tái sử dụng `exportCanonicalModel.ts`, `universalGlb.ts`, loader/asset persistence; report các channel/material ngoài exporter capability trước khi xác nhận. Download hai output rõ ràng, action selection không âm thầm chỉ lấy clip0.
- Lỗi/nghiệm thu: texture thiếu/external resource chưa đóng gói chặn output tự chứa hoặc báo loss có review; unsupported material không hứa parity. Tests textured synthetic GLB, alpha, multi-material, multiple Actions, node-name collision, reimport weights/animation; visual parity chờ runtime. Tác động: asset catalog/Scene/Assignment; không gọi GLB là Film native BBS.

<a id="1.3.4.8.1"></a>
### 1.3.4.8.1 — Khôi phục các gate kiểm tra code

- Mục tiêu/luồng: tái hiện lỗi lint sceneBasis, test runner và Windows build EPERM theo DOC-108 → sửa nguyên nhân trong phạm vi tối thiểu → chạy gates. Đây là task dự kiến, không khẳng định nguyên nhân EPERM đã xác minh.
- I/O: checkout/config/test commands → log exit code và báo lỗi còn lại. Không cần UI hay API mới.
- Code dự kiến khảo sát: `editor/packages/builder/src` sceneBasis và test, eslint/vitest config, Next config/tracing root; chỉ sửa sau khi tái hiện. Không disable rule/test hoặc quét thư mục hệ thống để che lỗi.
- Nghiệm thu: typecheck/lint/test:evaluate/build đạt trên local; targeted Retarget/Studio/CLI suites và locales đạt. Offline/browser smoke chỉ chạy khi người dùng cho runtime; code checks không bị đánh PASS cho smoke chưa chạy. Tác động: nền Topview dùng chung, giữ hồi quy85 actions.

<a id="1.3.4.8.2"></a>
### 1.3.4.8.2 — Runtime đa nguồn và nghiệm thu8 gate

- Mục tiêu/luồng: hai rig thật → normalized65 → receiver C → Preview → save/reopen/Undo/Redo → cả hai output reimport → Scene; đối chiếu ba luồng A/B/C và V9.12/85 actions.
- I/O: fixtures .1.1, build đã qua checks, threshold profile → per-source PASS/FAIL/NOT_RUN, report/video/screenshots/output hashes và user acceptance riêng. Báo actual bone count/import/coverage/errors/excluded bones cho từng mẫu.
- UI/API/code: dùng workflow đã có và các task trước; bổ sung test harness/records khi code được duyệt. Không thêm tính năng để làm demo trông đúng. Chỉ nhóm nguồn thực chạy mới được PASS; không suy ra Maya/Unity/Sketchfab/Warcraft/LoL đều đạt từ CC/UE.
- Nghiệm thu: đủ evidence cho từng gate, không lấy số test làm phần trăm code; nếu thiếu fixture giữ NOT_RUN. Tác động: bàn giao toàn W01; game/Film không nằm đợt này. **Đang chờ fixture và runtime theo lựa chọn người dùng.**

## 4. Thứ tự thực hiện và điều kiện chuyển bước

| Đợt | Tasks | Sản phẩm và điều kiện chuyển |
| --- | --- | --- |
| P0 — Nền kiểm chứng | .8.1, .2.1, .2.2 | Build/checks có log; identity và capability không mất dữ liệu; có test tổng hợp độc lập. .1.1 chờ fixture, không chặn code |
| P1 — Mapping/calibration | .3.1, .3.4, .3.2 | Contracts/migration trước UI; rest/default regression đạt; mới bật các mode bổ sung |
| P2 — Animation-only | .3.3, .5.1, .5.2, .6.1 | Golden pose/root/timing/IK và Assignment transaction đạt; nhánh này không chờ skin |
| P3 — Model branch | .4.1, .4.2, .7.1, .7.2 | Fitted profile+motion đúng fingerprint; loss có review; xuất/reimport và Scene commit atomic |
| P4 — Review và runtime | .2.3, .1.1, .8.2 | Code preview có thể làm sớm sau P1; nghiệm thu mesh/contact/material đợi P2/P3 và fixture |

Mỗi task triển khai theo thứ tự: bổ sung test đặc trưng → logic thuần và validation → host/hash/history → UI/CLI/MCP cần thiết → focused tests → required gates phù hợp → cập nhật evidence. Không phải task nào cũng thêm command/module mới. Những lần kiểm tra rộng chỉ lặp khi thay đổi hoặc lỗi mới cần kiểm.

Đề xuất đợt code đầu để duyệt: **1.3.4.8.1 + 1.3.4.2.1 + 1.3.4.2.2**, sau đó **1.3.4.3.1**. Không bắt đầu bằng chỉnh UI calibration khi identity/diagnostics còn không ổn định. Chưa có ETA hoặc % công sức có cơ sở.

## 5. Quyết định, giới hạn và cách báo tiến độ

Đã chốt từ yêu cầu: nguồn không giới hạn số xương theo hãng; đích Mixamo65; hai output; bảo toàn nguồn; reuse; runtime chờ fixture; không code trong lượt tài liệu này. Giữ scope V9.12/Metarig/Minecraft20 và không thêm Minecraft25.

Đề xuất cần duyệt cùng đợt code: calibration union/reference snapshot, chain mode mới có semantics trọng số riêng, IK opt-in, fit65 sinh fingerprint mới, atomic model command, GLB-first. Không cần xin lại quyền cho từng file sau khi cả đợt đã duyệt. FBX output, multi-rig merge thành một nhân vật và native parser format độc quyền chưa được đưa vào đợt này; multi-rig selection đã có task, không bỏ yêu cầu giữ graph nguồn.

Báo riêng: task phần thiếu đã hoàn thành/17 (chỉ sau khi có evidence), code checks, runtime sources đạt/2 và gate accepted/8. Hiện 17 task đều chưa hoàn tất theo tiêu chí mới; nhiều task mở rộng code có sẵn, không có nghĩa toàn code bắt đầu từ0. Nghiệm thu vẫn0/8; chưa cộng kết quả DOC-108 thành % mới. Các thông tin review DOC-066 trong đặc tả gốc là lịch sử và được thay bằng bảng hiện trạng mục1 cho kế hoạch này.
