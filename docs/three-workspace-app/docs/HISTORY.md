# Lịch sử

## 2026-10-20 — DOC-116: Universal local-chain regression and Workspace01 checks

- Fixed quaternion frame mutation that cancelled local-chain rotation deltas; tested two source topologies against canonical Mixamo65 and made the pinned GLB/85-action tests independent of shell working directory. Extended normalization→Assignment integration to assign only to Character C after A/B and preserve the source Motion.
- Checks: Retarget 59 PASS; Studio normalization/import 33 PASS/1 SKIP; CLI/MCP 47 PASS; Builder evaluate557 PASS/1 SKIP; workspace typecheck and lint/locales PASS.
- Studio production build remains blocked by Windows AppData junction `EPERM`; offline smoke therefore has no valid run. No external CC/UE rig fixtures were found, so real-source import and browser/WebGL remain NOT_RUN. No game, commit, push or publish.
- Partial implementation only; 0/8 Workspace01 gates accepted. [Evidence](evidence/workspace01-doc116-validation.yaml), [checkpoint](CHECKPOINTS.md#doc-116--2026-10-20--universal-local-chain-regression-and-workspace01-checks).

## 2026-10-20 — DOC-113: Universal calibration reference pose và persistence

- Added strict Universal calibration/reference-pose v1 validation, immutable hash-bound persistence, source/target reference-aware retargeting, global axis alignment, per-role correction and root policy/scale through normalization planning and staging. Preview can save the current source frame against target rest or a supported target Action at the shared playhead; preview includes alignment and role controls. Solver default/rest identity parity is covered.
- Checks: Studio import + skeleton mapping tests 26 PASS/1 SKIP; Retarget universal tests 15 PASS; Studio and Retarget typecheck, workspace lint and locale checks PASS. Synthetic normalization verifies saved blob reload, calibration change → plan hash change → output hash change.
- Isolated Studio Next build still fails `EPERM scandir C:\Users\Administrator\AppData\Local\Application Data`; output was safely removed. Runtime fixture/browser/WebGL/game were not run by user choice.
- Partial only: preset v4, CLI/MCP parity and distinct target-action preview/comparison remain. Workspace01 is still 0/17 completed and 0/8 accepted gates. [Evidence](evidence/workspace01-doc113-validation.yaml), [checkpoint](CHECKPOINTS.md#doc-113--2026-10-20--universal-calibration-reference-pose-and-persistence).

## 2026-10-20 — DOC-112: Import nhiều skeleton và chọn profile

- GLB/glTF nhập mỗi skin thành profile riêng theo node index; FBX code tách các bone components. Action được gắn vào profile theo node identity khi xác định duy nhất; Action mơ hồ/không khớp được giữ trong asset nguồn và trả issue theo `actionIndex`, trong khi Action hợp lệ vẫn lưu thành Motion.
- `rig.inspect` nhận SkeletonProfileID tường minh. Normalization và Model+Rig UI có bộ chọn profile; plan, Assignment và preview dùng đúng ID đã chọn. Shared validator cho phép tên bone trùng và adapter nối bằng UUID.
- Retarget + Studio integration 77 PASS/1 SKIP; workspace typecheck/lint/locales PASS; Builder evaluate557 PASS/1 SKIP.
- Studio Next build tái hiện lỗi EPERM tại `AppData\Local\Application Data`; output cô lập đã dọn sau kiểm tra đường dẫn. Không chạy fixture thật, browser/WebGL hoặc game; FBX multi-component mới chỉ typecheck.
- DOC-112 là partial, không đóng task `.2.1`, `.2.2`, `.8.1`; remaining tasks0/17, W01 gates0/8. [Evidence](evidence/workspace01-doc112-validation.yaml), [checkpoint](CHECKPOINTS.md#doc-112--2026-10-20--multi-skeleton-import-selection-and-action-ownership).

## 2026-10-20 — DOC-111: Action diagnostics and normalization budget

Retarget adapter có chế độ inspect ghi issue theo track/Action; plan đánh dấu Action chứa channel không hỗ trợ là chưa sẵn sàng nhưng các Action hợp lệ vẫn dùng được. Thêm dự toán node-samples/working-set, guard 50 triệu node-samples và 768 MiB trước vòng bake, hiển thị chi phí trong UI. Thêm regression adapter, guard và host plan. Retarget + Studio integration 73 PASS/1 SKIP; workspace typecheck/lint/locales PASS; Builder evaluate557 PASS/1 SKIP. Next build vẫn EPERM khi glob AppData Local đi qua Windows junction; offline smoke chưa chạy. Chưa hoàn tất identity/multiple skeleton, capability toàn importer hoặc runtime fixture; nghiệm thu W01 vẫn0/8. [Checkpoint](CHECKPOINTS.md#doc-111--2026-10-20--action-diagnostics-and-normalization-budget).

## 2026-10-20 — DOC-110: Builder pure basis API and Vitest gate

Đã tách `sceneBasisElements` thuần khỏi adapter Three `sceneBasisMatrix`; subpath evaluate giữ API cũ qua facade evaluatePublic. Đổi test sceneBasis từ `node:test` (Vitest không thu suite) sang Vitest và thêm kiểm tra Matrix4 compatibility. Builder typecheck/lint/build và evaluate 557 PASS/1 SKIP; workspace typecheck/lint/locales PASS. Studio Next build vẫn lỗi EPERM ở `C:\Users\Administrator\AppData\Local\Application Data`; chưa xác định/sửa nguyên nhân. Không chạy browser/runtime. [Checkpoint](CHECKPOINTS.md#doc-110--2026-10-20--builder-scene-basis-layer-and-vitest-gates).

## 2026-10-20 — W01-PLAN-003: đặc tả phần thiếu, chưa code

Theo yêu cầu lập kế hoạch trước triển khai, đối chiếu baseline DOC-108 và các đường inspect/calibration/retarget/skin/Assignment/Scene. Bổ sung 17 task ổn định, contracts/migration, test độc lập và thứ tự P0–P4. Sửa mô tả cũ về skin-loss review: Prepare/Review đã có; animated metrics/policy còn thiếu. Không sửa ứng dụng, chạy runtime, commit hay publish. [Đặc tả](features/workspace01-remaining.md).

## 2026-10-19 — W01-PLAN-002: Universal Animation Retargeting Engine

Người dùng làm rõ115 chỉ là ví dụ; nguồn có số lượng/tên/hierarchy bất kỳ. Đã sửa đặc tả và dependencies để animation-only không chờ skin; MVP ≥2 rig nguồn khác nhau → Mixamo65 → Assignment lên model khác → Preview. Thêm ma trận nguồn, đường format/converter có dẫn chứng và registry14 ứng viên chưa khóa. Không code, chưa runtime; 0/8 gate, 0/2 nguồn đạt MVP. [Review](WORKSPACE01_SOURCE_REVIEW.md).

## 2026-10-19 — W01-PLAN-001: Điều chỉnh mục tiêu Workspace01

Người dùng yêu cầu review/đề xuất trước code: rig ngoài → Mixamo65, bảo toàn skin/action, Assignment và Scene handoff. Đã lập [đặc tả](features/rig-animation-normalization.md), module reuse/gaps, loss policies, 8 gate MVP và inventory đề xuất. Không sửa ứng dụng hoặc chạy runtime; không thay trạng thái nghiệm thu legacy.

## 2026-10-19 — Người dùng duyệt code Animation Creation AC-00–AC-08

- Người dùng xác nhận: “Hãy code list dựa trên các đặc tả.” Phạm vi được duyệt là task plan AC-00–AC-08 và đặc tả native Animation Creation, không bao gồm commit/push/publish hoặc chạy game.
- Implementation và bằng chứng được ghi theo task; quyền code không đồng nghĩa task hoặc runtime đã PASS.

## 2026-10-19 — DOC-064: Native Animation Creation and Film runtime smoke

- Playwright đã chạy same-rig FBX → Character → Animation Studio 1.31.8 → 132 keys, đổi Spine pose → lưu native edit/GLB → Motion timeline → Undo/Redo placement → CPU frame0/45 → WebGL GLB HTTP200 và viewport đổi khi phát → reload/reopen. Quaternion dot giữa CPU sample là `0.9794477746581245`; browser errors0. Project cô lập mới nhất `6b432023-754a-4ba2-9176-0684761de9c7` tại local port3117.
- Sửa GLB base64 regex stack overflow; chuẩn hóa node bone namespace theo Character profile và hỗ trợ GLB nhiều skin sau khi union joints, vẫn xác minh toàn bộ target bones, hierarchy, rest transforms và animation channels.
- Film export PASS trên project cô lập `6b432023-754a-4ba2-9176-0684761de9c7`: ZIP 1,112,711 bytes, SHA-256 `dd4148b4815620b30a809af46f99f72df9ae1146f28231436c836b75915d0ca7`, native BBS readback, 65 pose tracks và changed rotation data. Cấu hình đúng `BBS_BLENDER_EXE` (Blender 4.2.3) và `BBS_JAVA_HOME` (JDK17); sửa health endpoint để đọc stderr Java và các đường dẫn cấu hình. N5/AC-07 PASS; tổng AC 1/9; còn clone/isolation, CPU/WebGL numerical parity, Film Editor/game acceptance. Fresh build vẫn lỗi Next EPERM; xem [DOC-064](CHECKPOINTS.md#doc-064--2026-10-19--native-animation-creation-and-film-job-runtime-smoke) và evidence.

## 2026-10-19 — Đề xuất sửa phạm vi MVP Animation Creation

- Đối chiếu ý kiến người dùng với source: `AnimationWorkspace` hiện dùng `DirectorStudio` và placement/binding FBX, chưa đưa editor Animation Studio 1.31.8 vào app. MVP D2 trước quá hẹp khi chỉ yêu cầu actor blocking key; không thay thế native creation ban đầu.
- Tạo [đặc tả tích hợp](features/animation-creation-integration.md) và [AC-00–AC-08](../ANIMATION_CREATION_TASK_PLAN.md): editor native cô lập DOM/Three, native JSON qua broker chung, derivative dùng chung cho Scene/CPU/export; kiểm seam trước khi làm rộng. P0 có tạo/sửa bone keys, IK/graph cơ bản, persist/reopen và clone isolation.
- Chỉ thay tài liệu và liên kết bàn giao; chưa sửa app, contract thực thi hoặc baseline, chưa có runtime evidence mới. Các tiêu chí N1–N5 là đề xuất chờ duyệt; lịch sử D0–D4 và evidence cũ được giữ nguyên.

## 2026-10-19 — DOC-063: MVP app debug runtime

- Người dùng xác nhận code MVP để chạy/debug flow nhanh. Sửa root `pnpm dev` để giữ Builder bundle ổn định, thêm project health endpoint và Dev Tools project diagnostic JSON.
- Chromium smoke same-rig FBX import→Character→Animation→Scene/WebGL→history/clone/reload PASS; Studio typecheck PASS. Builder evaluate:554 passed,1 skipped; một suite cấu hình sai dùng `node:test` bị Vitest báo không có suite.
- Blender/Java không có trên PATH. Forward retarget/persist và native Film/game chưa làm hoặc nghiệm thu; xem [DOC-063](CHECKPOINTS.md#doc-063--2026-10-19--mvp-app-debug-runtime) và [evidence](evidence/mvp-debug-runtime.yaml).

## 2026-10-19 — DOC-062: review MVP và bàn giao cho agent khác

- Theo yêu cầu review không code, tạo hai báo cáo MVP dựa trên source và bằng chứng; phân biệt code có mặt, tích hợp, test logic, runtime app và game. Không dùng93% nhóm partial làm phần trăm hoàn thành.
- Theo đề nghị hoàn thiện phần tối thiểu và debug phù hợp app lớn, chuyển phương án đề xuất từ liên ứng dụng A sang một app B; tái dùng solver, importer/evaluator, jobs và native worker. GLB→FBX được đề xuất chạy trong host; source gốc giữ nguyên.
- Người dùng nói sẽ giao agent khác code: thêm đặc tả bàn giao và prompt với phạm vi65 đề xuất, contract/provenance/history, file/caller/tests, debug tối thiểu,20 assertion và hai mức APP_RUNTIME_READY/E2E_GAME_PASS. Quyền code chỉ có khi người dùng xác nhận phạm vi hoặc gửi prompt, không đến từ file tài liệu.
- Đưa game smoke thành việc kiểm sớm song song, tránh chặn toàn bộ app trong lúc chờ người dùng kiểm game. Không đổi lịch sử target20 thành target25; target25 là yêu cầu mới chưa được implementation xác minh.
- Kiểm logic/unit trong review đạt26+15test; lượt bàn giao kiểm cấu trúc/link/đường dẫn tài liệu. Không có browser/game PASS mới, không đổi nghiệm thu LISTCODE. Xem [checkpoint DOC-062](CHECKPOINTS.md).

## 2026-10-19 — Điều chỉnh kế hoạch tái sử dụng sau DOC-061

- Người dùng nhắc mục tiêu là đấu nối/tái sử dụng code có sẵn. Đối chiếu AGENTS và REUSE_MATRIX xác nhận giữ các engine, importer/exporter và module runtime gốc qua adapter, không viết lại chỉ để đồng nhất công nghệ.
- Rút lại các ước lượng đã đề xuất trong DOC-061 (demo 3–5 ngày, Retarget thêm 1–2 tuần, toàn phạm vi 6–10+ tuần): chưa có bảng khối lượng adapter hoặc tốc độ hoàn tất được đo làm căn cứ. Không thay bằng một hạn mới chưa được chứng minh.
- ROADMAP ưu tiên cho người dùng chạy luồng đã có, rồi khép Retarget → Motion/history → timeline và tích hợp module Animation native. Xuất clip JSON riêng DOC-061 vẫn là partial, chưa thay cho điểm đấu nối còn thiếu. Phạm vi LISTCODE 1.1–1.7 và 0/24 nhóm hoàn tất giữ nguyên.

## 2026-10-19 — DOC-061

- Retarget Preview now has a user-triggered bake action: it samples the chosen FBX clip at 30 FPS, uses the V9.12 reverse solver, builds a target-local Three.js AnimationClip and downloads its JSON. The preview returns to its prior time after export.
- Retarget/Studio typechecks passed; focused bake/reverse suite passed 6/6, including playback on a Three.js rig. Browser UI, target-profile rest binding, project Motion/history, timeline placement, native golden parity and game playback remain unchecked. [Checkpoint](CHECKPOINTS.md#doc-061--2026-10-19--retarget-preview-bake-clip-export), [evidence](evidence/retarget-preview-bake-json.yaml).

## 2026-10-19 — DOC-060

- Thêm engine bake theo frame cho reverse Retarget đang có: lấy source pose ở frame time xác định rồi chạy V9.12 solver trên toàn khoảng inclusive; giới hạn FPS/range và từ chối kết quả không hữu hạn.
- Test 5/5 và typecheck package Retarget đạt; fixture armature Minecraft20 thật có 20 bone và pose thay đổi theo source sample. UI, Motion generated trong project/history, timeline/export và parity golden native chưa nối hoặc kiểm. [Checkpoint](CHECKPOINTS.md#doc-060--2026-10-19--retarget-frame-bake), [evidence](evidence/retarget-frame-bake.yaml).

## 2026-10-19 — DOC-059

- Tìm lại FBX Punch Combo 65 xương trong cache kiểm thử của bản sao app; hash nguồn `acd9e347686dfabda0a3cac3207885d96f466795753882284f3b4ddfb29fabeb`. Chạy converter Blender 5.1.2 trên bản đọc-only xác nhận profile 65 bones/1 action; source hash sau kiểm tra giữ nguyên.
- Integration project với hai Character/two-shot/frame 0–29 passed 1/1; job `5ba32428-d4b9-4e75-a289-c922c94f03ba` tạo ZIP 1,286,591 byte. Chromium 153 chạy export qua Film panel trên cùng project; job `a7270753-2ed4-424f-80e0-41284fd6afbc` thành công, ZIP 1,286,590 byte, SHA-256 `998be98134bfefae234b96f405a4a77a6b0608ad49ef33853c461ff0c636300c` khớp job record và byte lưu qua in-memory directory stub. 0 lỗi trang, 0 external request, 0 response lỗi.
- Dừng server và xóa project/output/harness cô lập; khôi phục `tsconfig.json`, không sửa FBX nguồn, workspace Animation/Retarget/Topview, release, Site hay game. Picker thật, Film Editor và playback chưa kiểm. [Checkpoint](CHECKPOINTS.md#doc-059--2026-10-19--punch-combo-browser-export), [evidence](evidence/film-punch-combo-browser-export.yaml).

## 2026-10-19 — DOC-058

- Sửa assertion trong `filmExportJob.integration.test.ts`: sample basis expectation phải có đúng một giá trị cho mỗi Character được xuất; lần đầu phát hiện test dừng trước job với hai Character. Đổi tên test để thể hiện rõ các Character dùng Motion animated.
- Integration chạy lại thành công trên FBX tổng hợp 2 xương/1 action, source SHA-256 `88135f34c6cadd03a61f85010eaa545b5502081128461d5d1a49096e9e0f4cd8`; kiểm tra pose của cả hai Character thay đổi qua 0–29, hai camera cuts, job Blender→manifest→Java worker và ZIP đạt.
- Browser Chromium 153 mở cùng project, chọn hai Character trong Film panel, chạy export 20 tick và save flow. Job `54d505fa-d6e0-4d75-84e5-660db1e1fd4e` thành công; ZIP 5,194 byte, SHA-256 `2ba233fb5a4fb5ad3aed22fff524696d2d6f2fc384cdb12f4cda00f4eada3abb`, hash khớp cả record lẫn file đã lưu trong directory-handle stub. 0 page errors, 0 external requests, job không warning/blocked request.
- Dừng server và xóa test projects, conversion output, Next output và script harness tạm. Không đổi source Animation/Retarget/Topview, release, Site hoặc game. OS directory picker, Film Editor và Minecraft playback chưa được kiểm. [Checkpoint](CHECKPOINTS.md#doc-058--2026-10-19--animated-film-browser-export), [evidence](evidence/film-animated-browser-export.yaml).

## 2026-10-19 — DOC-057

- Khôi phục dependency bằng `pnpm install --frozen-lockfile --ignore-scripts` từ cache cục bộ (427 reused, 0 downloaded); workspace `pnpm typecheck`, Builder package build/finalize và ESM/CJS basis runtime assertions đều đạt.
- Chromium 153 tạo project, import fixture FBX tĩnh hai xương theo Z-up, cấu hình shot frames 0–29, chạy export từ Film panel và tải ZIP 2,846 byte. Job `53c295aa-53f1-4314-b9ff-141ee2123895` thành công; SHA-256 `44a8aebb800052990ca6d7820f679d97a6eb4ebfdda566142c362072e3984527`; `saveJob` kiểm size/hash và ghi qua in-memory directory-handle stub. Trang có 0 lỗi và 0 external request.
- Đã dừng server và dọn storage/build output/script thử tạm. Không sửa ba workspace nguồn, không tạo release/Site, không chạy game. OS directory picker thật, Film Editor/game, live MCP và coverage fixture rộng chưa xác minh. [Checkpoint](CHECKPOINTS.md#doc-057--2026-10-19--browser-film-export-smoke-and-package-check), [evidence](evidence/film-browser-export.yaml).

## 2026-10-19 — DOC-056

- Thử tiếp tục browser smoke tới Film export job bằng project storage cô lập và fixture FBX cục bộ. Next dừng trước route compilation khi không tìm thấy package files `@types/react` trong cache; registry trả EACCES nên không có cài đặt nào hoàn tất.
- Dừng server, gỡ dependency junction tạm và xác nhận storage/output tạm đã dọn, store `.pnpm` còn nguyên. Không đổi source app; Film job UI vẫn chưa được xác minh. [Checkpoint](CHECKPOINTS.md#doc-056--2026-10-19--film-browser-job-environment-check), [evidence](evidence/film-browser-job-environment.yaml).

## 2026-10-19 — DOC-055

- Khắc phục smoke offline bằng các junction dependency cục bộ tạm thời: Chromium153 đạt 2 Character, 28 pose và 0 external request; Film panel hiển thị export bị khóa với project trống và tên mặc định theo project. API `asset.import` với FBX hai xương Z-up tạo asset/profile và lưu basis chính xác.
- Đồng bộ thủ công sáu tệp Builder `dist` để export `sceneBasisMatrix` đã có trong source, rồi kiểm tra ESM/CJS và basis runtime. Không chạy được full tsup build/typecheck do cached esbuild thiếu module và registry EACCES; đây không phải bằng chứng build chuẩn.
- Dừng server và dọn junction/cache/backup do smoke tạo. Không sửa ba workspace nguồn, release, Site hoặc game. Browser Film job hoàn chỉnh, Film Editor và Minecraft acceptance vẫn chưa xác minh. [Checkpoint](CHECKPOINTS.md#doc-055--2026-10-19--browser-and-z-up-import-smokes), [evidence](evidence/studio-browser-and-basis-runtime.yaml).

## 2026-10-19 — DOC-054

- Thử browser smoke bằng Next dev server và cache dependency cục bộ. Trang trả HTTP 500 vì Next không resolve được `three` từ package workspace bên ngoài app; `pnpm exec` và auto-install TypeScript của Next gặp registry EACCES.
- Dừng server, gỡ junction tạm và xác nhận không có browser acceptance pass. Không đổi source ứng dụng; giới hạn và bước gỡ nút được ghi tại [checkpoint](CHECKPOINTS.md#doc-054--2026-10-19--browser-smoke-environment-probe) và [evidence](evidence/browser-smoke-environment.yaml).

## 2026-10-19 — DOC-053

- Film sampling now carries source basis through local conversion and rest-relative pose baking. Blender applies it to BOBJ geometry, normals and rest matrices; the job cache keys include the basis.
- Blender 4.2.3 generated FBX/GLB basis fixtures passed converter verification; Python converter/CLI 35/35 and pose-bake 7/7 passed. A Z-up two-Character/two-shot project job passed 1/1 through Java 17 and produced a downloadable ZIP. Standard Studio typecheck, browser export smoke, Film Editor and Minecraft playback remain open. [Evidence](evidence/film-basis-bake.yaml).

## 2026-10-19 — DOC-052

- Implemented validated source-to-scene basis handling for imported GLB/glTF/FBX profiles, persisted model metadata and Character/Prop placement; CPU skeleton evaluation uses the same basis wrapper. Conflicting interpretations of identical source bytes are rejected.
- Added focused basis and import-path tests. Execution is pending because workspace dependencies were unavailable; see [evidence](evidence/scene-basis-adapter.yaml).
- At DOC-052, Film sampling still rejected nonidentity bases; DOC-053 adds the converter and bake path. No source workspace, release, game, or site was changed.

## 2026-10-19 — DOC-051

Expanded the Scene reparent regression to rotated parent groups with different nonuniform scales and exact composed-world preservation within `1e-6`. Studio test, typecheck and ESLint passed. This does not implement general Z-up conversion or native Three.js version bridging. [Evidence](evidence/scene-parent-transform.yaml).

## 2026-10-19 — DOC-050

Converter now assigns collision-free safe BOBJ IDs to unsafe bone names and carries FBXLoader-normalized source names through the profile. Pose baking maps source samples to target IDs. Punch Combo (65 bones, 1 action) passed real Blender conversion and a two-Character/two-shot project job through Java 17 native ZIP readback. Studio39/39 and converter5/5 passed; Film Editor and Minecraft acceptance remain open. [Evidence](evidence/film-safe-bone-names.yaml).

## 2026-10-19 — DOC-049

Sửa pose-bake để chuyển sampled bone delta theo bind frame BOBJ riêng của từng bone, truyền hiệu chỉnh xuống con và chặn basis có scale/shear. Integration test nay place Motion và xác nhận pose thay đổi; FBX animation hai xương đạt project job→manifest→Java17 worker→ZIP native readback (1/1). Studio suite37/37 và một test opt-in skip, typecheck, ESLint đạt. Production rigs, Film Editor và Minecraft chưa nghiệm thu. [Bằng chứng](evidence/film-pose-frame-calibration.yaml).

## 2026-10-19 — DOC-048

Nối shared-project sampling/conversion/manifest/native worker thành `film.export` job có progress/cancel và ZIP artifact hash-verified. Thêm CLI `film project-export`, MCP `film.export` và Studio Film panel; clients giữ output path ở client. Studio targeted suite23/23, Python CLI/MCP43/43, typecheck và ESLint đạt. Chromium smoke xác nhận panel/control và khóa export khi project trống. Static two-bone FBX chạy qua project job tới native readback; animated two-bone FBX chuyển đổi độc lập nhưng project job thất bại ở 8% với lỗi tổng quát. Film Editor/game và live MCP acceptance còn mở. [Bằng chứng](evidence/film-project-export-job.yaml).

## 2026-10-19 — DOC-047

Thêm manifest builder cho BBS Film 2.4: profile BOBJ/file hashes, actor transforms 20Hz, camera clips và pose tracks từ immutable samples; chặn scale/roll/shear không được Replay schema biểu diễn. Fixture tạm một xương qua Blender5.1.2 → converter thật → builder → Java17 worker đạt native readback (1 actor/camera/track). Studio suite28/28, typecheck và ESLint đạt. Project job/API/UI/CLI/MCP, Film Editor và game acceptance vẫn mở. [Bằng chứng](evidence/film-manifest-builder.yaml).

## 2026-10-19 — DOC-046

Project Film samples nay được bake thành BBS `pose_transform` tracks theo BOBJ rest basis; integration Punch Combo tạo 65×21 key với BOBJ fixture tổng hợp. Converter Blender fixture riêng xác nhận quan hệ rest basis chung, nhưng chưa nối profile converter thật vào baker. Studio camera/pose/project tests đạt 26/26, typecheck đạt. Manifest/job, Film Editor và game acceptance vẫn mở. [Bằng chứng](evidence/film-pose-bake.yaml).

## 2026-10-19 — DOC-045

Nối sample project chung thành input nội bộ cho Film: khóa snapshot/revision/hash, kiểm profile và lưới 20 Hz, lấy mẫu skeleton/camera qua evaluator đã có, chuyển quaternion camera thành góc BBS và giữ hai phía của cut. Integration Punch Combo đạt 12/12; camera basis/giới hạn đạt 11/11; Studio typecheck đạt. Chưa bake BOBJ pose, tạo worker manifest/job hoặc nối UI/API/CLI/MCP; Film Editor/game chưa nghiệm thu. [Bằng chứng](evidence/film-project-sampling.yaml).

## 2026-10-19 — DOC-044

Mở rộng profile BOBJ để giữ matrix bind/rest toàn cục (row-major) cho từng bone, đọc từ `arm_bone`. Validator từ chối thiếu matrix, sai kích thước, boolean hoặc số không hữu hạn; Blender fixture đối chiếu matrix profile với BOBJ output. Combined converter/Film-worker/CLI/MCP suite đạt 47/47 với Blender 4.2.3 và Java 17; chưa có pose bake hoặc project-bound Film export. [Evidence](evidence/bobj-rest-profile.yaml).

## 2026-10-19 — DOC-043

Thêm `film convert-model` để chuyển một FBX/GLB có rig sang BOBJ, Skeleton Profile và tối đa một texture PNG bằng Blender cục bộ. Reuse exporter/helper BBSFix nguyên bản từ workspace nguồn, giữ SHA-256 và GPL-2.0-or-later license trong gói; source BBSFix không bị sửa. Test tạo FBX và GLB tạm có rig, action, JPEG; thêm validation output hash/không ghi đè, unit và CLI exit code. Đã kiểm Blender 4.2.3, Python CLI/MCP và native Film worker. Converter vẫn chưa đọc project chung/tạo Film manifest/job hoặc xác nhận playback trong game. [Bằng chứng](evidence/film-model-converter.yaml).

## 2026-10-19 — DOC-042

Thêm offline `film export` CLI và worker Java 17 dùng BBS FS 2.4 FilmEditor/BbsCodec đã pin. Worker đóng gói `.dat` cùng BOBJ assets từ manifest có hash, kiểm tra native read-back và pose-transform tracks; không đọc shared project hoặc ghi vào game. Thêm test 2/2 qua compiler/bridge thật và CLI/MCP 38/38. `sourceRevision` nay được parse chính xác, không làm tròn qua `double`; thêm chặn keyframe action không tăng dần. Probe riêng cho thấy BBSFix BOBJ exporter tạo được rig/mesh tổng hợp trên Blender 4.2.3; exporter 4.0.2 lỗi do API normals đã bỏ. Chưa thử import FBX/action/texture, và chưa đưa mã GPL vào app. Project integration, playback trong game và Film Editor acceptance còn mở. [Bằng chứng](evidence/film-export-worker.yaml).

## 2026-10-18 — DOC-041

DOC-041: immutable Scene render jobs now run through the live Next host using native ESM renderer externals. Fixed concurrent-start reservation, cancel cleanup, stale revision errors, dry-run cancel, CLI/MCP retry identity and browser save errors. UI selects up to three cameras; two cameras at frames 0/45/89 produced nine SHA-verified files in real browser OPFS without changing history. 46 Studio/shared/Retarget/navigation tests, 37 Python unified tests and 29 director-cli tests passed; Builder 553 passed/1 skipped. All package typechecks and root lint/locale checks passed. Legacy offline and real-FBX browser smoke passed. OS folder picker and live MCP host remain unverified. Production Next build still fails AppData junction EPERM; legacy Python suite has 218 passed, 11 failed, 10 errors, 4 skipped from asset-manifest/Windows packaging/mtime issues. Full app remains incomplete. [Evidence](evidence/scene-render-jobs.yaml).

## 2026-10-18 — DOC-040

Added Topview-backed geometry checks to read-only `scene.evaluate`: grounding at the pinned 0.02 m tolerance, pairwise world AABB overlap, and frustum evaluation using the same frame transforms. Only referenced assets are SHA/path verified and staged to a temporary offline renderer directory, which is cleaned on success or failure. Primitive integration verified all three checks; a real Punch Combo FBX verified mesh measurement; missing FBX source returns CHECK_UNAVAILABLE without changing project revision/history. Director-CLI 28/28 tests and Studio typecheck passed. Scene render jobs, animated-mesh parity, broad-format checks and Film/game acceptance remain open. [Evidence](evidence/scene-geometry-checks.yaml).

## 2026-10-18 — DOC-039

Camera shot sampling now resolves trajectory-driven subject transforms from the shared CPU skeleton evaluator before Topview subject/look-at binding evaluation. The project sampler preloads assets once, emits no static fallback when the source is unavailable, and disposes its evaluator on completion/cancel. Punch Combo integration matched all 21 samples to actor world matrices, including rotation-relative offsets and the left endpoint. Builder 553 passed/1 existing skip; Studio camera command1/1 and FBX integration12/12 passed, with typechecks, targeted lint and build/finalize passing. The sampler API is now asynchronous. Browser framing, Film export and game playback remain unverified. [Evidence](evidence/camera-subject-sampling.yaml).

## 2026-10-18 — DOC-038

Workspace Animation now embeds Topview `DirectorStudio` beside the shared FBX clip controls, using the same project adapter and history. Typecheck, targeted ESLint, smoke syntax and Chromium153 real-FBX workflow passed; browser evidence confirms both the editor and Animation panel mounted. The full FBX/edit/history/CPU-WebGL regression had zero console errors, failed requests or external requests. This reuses Topview rig/pose/timeline controls; Animation1.31.8 parity is still incomplete. LISTCODE:23 partial,5 unstarted,0 fully complete; 1.1–1.7:21 partial,3 unstarted. [Evidence](evidence/animation-workspace.yaml).

## 2026-10-18 — DOC-037

DOC-037: camera/shot CPU sampler dùng CameraRig và helper applyEvaluatedCamera chung với viewport; xuất position/quaternion/lookAt/verticalFov/aspect/near/far, sourceFrame và thời gian shot/sequence. Giữ left/right riêng tại cut, loop endpoint không wrap, manual roll/user keys/own aspect/path/orbit được kiểm. sampleProjectCameraSequence gắn sourceRevision và saved overlays; không mutate project. Camera bám target có trajectory bị chặn tới khi effective-world subject evaluation được nối. Builder96 files/554 tests; Studio/shared/Retarget37/37; build/source-test typechecks/targeted lint đạt. Browser FBX regression đạt65-bone CPU parity và64 aliases identity sau gap. Snapshot hai shot3s tạo62 mẫu gồm hai endpoint, cut t=1 giữ previous-left/next-right. Chưa có Film codec/assets/export jobs, grid20Hz cut preflight hoặc game acceptance.

## 2026-10-18 — DOC-036

DOC-036: sampler CPU stream range inclusive sang grid20Hz + một endpoint left; 3s@30 cho61 mẫu, đoạn1s cho21. Endpoint chọn clip trước tại cut, loop/reverse không wrap về pose đầu; trajectory/path cùng ownership, trim/speed/fractional time giữ nguyên. Host chọn CharacterID tường minh, preflight source một lần và dispose trong finally; không tạo artifact sản phẩm/job. API/range nay áp saved user keys như browser mặc định. Range FBX thật phát hiện pose reset làm hỏng64 alias; applyPose bỏ qua alias và stopAll dừng cả action đã clamped. Browser kiểm đủ64 alias identity sau gap và giữ CPU/browser65-bone parity. Builder95 files/549 tests; Studio/shared/Retarget37/37; build/typechecks/targeted lint đạt. Chưa có converter/export/job/Film codec hoàn chỉnh hoặc camera/shot export endpoint; full acceptance còn thiếu.

## 2026-10-18 — DOC-035

DOC-035: scene.evaluate đọc asset đã kiểm SHA/path và trả skeletonSamples CPU gồm đủ bone local pose/world matrices, placementMatrix, trajectoryMatrix, actorWorldMatrix và metersPerUnit. Dùng chung buildCharacterRig, CharacterAnimator/MotionPlayer và root sampler với browser; entrypoint /skeleton riêng không kéo renderer/MediaBunny. Native model/motion templates không bị sửa; đọc không đổi revision/history. Browser/API đối chiếu65 bone FBX thật đạt max world-matrix delta4.440892098500626e-16. Builder94 files/544 tests; Studio/shared/Retarget37/37; build/typechecks/targeted lint đạt. Thiếu source, texture/compression không decode được, rig không hỗ trợ hoặc library pose chưa nạp trả issue rõ ràng; loader chặn tài nguyên ngoài. DOC-040 adds geometry checks; render jobs, range bake/export, native Animation, Retarget khác rig và Film/game remain incomplete; production EPERM/clone500 chưa sửa.

## 2026-10-18 — DOC-034

DOC-034: trajectory cho imported direct FBX tách root translation/rotation sang motionRoot dưới actor; placement/path authored không bị ghi đè. Native interpolants và rest/unit hierarchy được tái sử dụng. Loop tích lũy cả góc xoay, reverse/trim/speed giữ fractional time, origin dùng anchor nguồn và continue nối end-exclusive endpoint clip trước; seek/gap không dựa frame đã render. Shared binding/native metadata cùng revision/history; provenance path trùng nguồn trả ROOT_MOTION_CONFLICT; overlap và loop count vượt precision bị chặn. 93 file/542 Builder test; Studio/shared/Retarget37/37; build/typechecks/targeted lint đạt. Browser FBX thật đạt skeletal→trajectory world-matrix parity, max delta6.625060056109078e-9, seek lùi/reload và0 external requests. Chưa có headless root bake/export, general skeletal alignment, fades, khác-rig bake, native Animation hay Film/game acceptance; camera follow và gizmo/autosave trajectory chưa kiểm. Clone500/production EPERM chưa sửa.

## 2026-10-18 — DOC-033

DOC-033: in-place cho FBX direct rig qua motion.binding.set và form Sửa clip; root translation/quaternion về rest theo SkeletonProfile, giữ limb animation, unit và actor placement. Native rootMotion/inPlace và shared binding được ghi cùng transaction; validation chặn sai bone/policy/rig và document.replace xóa policy. Builder 93 files/539 tests; Studio/shared/Retarget 37/37 với FBX thật; build/typechecks/targeted lint đạt. Browser Chromium153 xác nhận root rest tại frame30/40, actor(2,0,0), tay đổi pose, Undo/Redo, clone/reload và 0 external requests. Trajectory/alignment/fades, cross-rig bake, native Animation và Film/game chưa hoàn tất; clone500 ngắt quãng và production build EPERM chưa sửa.

## 2026-10-18 — FBX Character thực trong ba workspace

- Nối FBX mesh/skin vào Scene với format/unit/material tường minh, dùng source profile cho cả Character và Motion. Thêm export pure dùng trên Next server; CLI import FBX bắt buộc unit; project hợp nhất mới 30 fps.
- Builder 538, Studio 25, shared/Retarget 12 và Python 30 test đạt. Local browser đã chạy luồng Retarget → Animation → Scene với FBX thực, edit/history/clone/reload; xem DOC-032. Production Next EPERM và clone IO_FAILED thỉnh thoảng vẫn mở; chưa nghiệm thu toàn app.

## 2026-10-18 — FBX thực và hồi quy toàn Builder

- Fixture Punch Combo đã khóa hash làm lộ hai lỗi importer: FBXLoader alias của bone dùng chung mesh bị coi là duplicate thật, và animation stack rỗng làm cả import thất bại. Profile/preview/rest cache nay nhận diện alias nhưng giữ nguyên skeleton/skin nguồn; stack rỗng được bỏ với clip index gốc được bảo toàn.
- Đối chiếu numerical pose của đủ 65 bone trên direct-bind trim/reverse đạt. Builder 91 file/535 test và Studio 25 test đều đạt với fixture thật; Builder build/typechecks và targeted ESLint đạt, golden không regenerate. Xem DOC-031; browser/WebGL và các phần root/alignment/Film vẫn chưa nghiệm thu.

## 2026-10-18 — Chỉnh binding đã đặt qua cùng broker

- `motion.binding.set` giữ ClipID và cập nhật source/playback/frame range cùng shared binding/history; UI dùng revision của draft, CLI nhận JSON có giới hạn, MCP công bố command thứ 13. Sửa clip chồng lấn/Character khóa hoặc tùy chọn root/alignment/fade chưa thực thi bị từ chối rõ.
- Studio 24 pass/1 fixture FBX skip, typecheck/ESLint; Python CLI/MCP 29/29. Chưa smoke test browser, live broker/MCP hoặc Film/game. Root-motion/alignment và native Animation editor còn tiếp tục theo LISTCODE.

## 2026-10-18 — Đặt FBX motion vào timeline Animation/Scene

- Thêm `motion.place` qua broker chung: chỉ chấp nhận Character cùng skeleton fingerprint và đơn vị với FBX Motion; thêm clip Topview cùng MotionBinding, giữ clip index cho FBX nhiều animation, dồn clip bị chồng theo helper Topview. Giao dịch hỗ trợ dry-run, revision, Undo/Redo.
- Animation workspace có panel chọn motion/character/frame; Python CLI có `motion place`; MCP bridge công bố command thứ 12. Builder loader chuyển clip index đến MotionPlayer.
- Kiểm: Studio focused suite 11 pass/1 FBX skip; builder `studioIntents` 4/4; Python CLI/MCP 26/26; builder/Retarget/Studio typecheck và Builder build đạt. Browser/runtime chưa kiểm.
- Giới hạn: chỉ cùng rig; V9.12 bake, reverse/source-range/root-motion, Animation keyframe/graph/layers và BBS Film export chưa triển khai.

## 2026-10-18 — V9.12 session reference pose trong Retarget preview

- Reverse solver nhận quaternion tham chiếu theo tên xương; Retarget UI chỉ truyền `sourcePose` từ snapshot hợp lệ khi mapping ID, source FBX SHA-256 và đơn vị khớp. Đổi session/links sẽ xóa reference pose đang áp dụng.
- Kiểm: hai regression test đối chiếu công thức quaternion V9.12 và từ chối quaternion lỗi/tên xương trùng chuẩn hóa; Retarget/Studio typecheck và ESLint bốn component đạt. Full suite chưa chạy lại; browser/session API chưa smoke-test.

## 2026-10-18 — Topview editor clone giữ shared records khi autosave

- document.replace autosave nay nhận diện node/clip clone theo ID convention của Topview, tạo Character và MotionBinding riêng thay vì để clone dùng metadata/binding của nguồn.
- Kiểm: regression đi qua duplicateDocumentNodes và document.replace, rồi Undo; Studio suite 33 pass/1 FBX skip, typecheck và targeted ESLint đạt.

## 2026-10-18 — Reparent primitive giữ world transform

- Thêm node.reparent cho primitive tĩnh giữa scene root và root group. Reuse Three.js matrix compose/decompose; cập nhật đồng thời parentId/children và rollback trường hợp keyframe/motion, group khóa/lồng hoặc shear.
- Kiểm: Studio 33 pass/1 FBX skip; reparent matrix/Undo/keyed-node regression; shared/Retarget/builder/Studio typecheck, targeted ESLint; Python CLI/MCP 25/25.

## 2026-10-18 — Scene clone giữ dữ liệu native

- Thêm node.clone vào scene.apply, reuse Topview document duplication; clone node/descendant, native clips, FCurves/user keys và remap Character/MotionBinding. CLI/MCP dùng batch contract chung, một transaction có Undo.
- Kiểm: Studio 32 pass/1 FBX skip; Topview focused 23/23; shared/Retarget/builder/Studio typecheck, targeted ESLint; Python CLI/MCP 25/25.

## 2026-10-18 — Batch Scene node operations

- `scene.apply` hỗ trợ transform patch, visible/locked flags, rename và delete theo batch tối đa 64 operations. Reuse Topview transform/deletion helpers; batch commit một shared revision và Undo; node deletion dọn clip phụ thuộc, active camera, editorial shots, FCurves, user keys, Character và bindings.
- Input lỗi hoặc còn camera/Retarget reference làm hủy toàn batch. CLI/MCP dùng broker command hiện hữu.
- Kiểm: TS 31 pass/1 FBX skip; shared/Retarget/Studio typecheck, targeted ESLint; Python CLI/MCP 25/25.

## 2026-10-18 — Dọn Character an toàn trong scene.apply

- Thay document Scene giờ xóa Character không còn node, FCurve/user keys của node và binding tới clip đã mất cùng transaction/revision. Từ chối nếu camera/timeline/path/editorial shot còn tham chiếu hoặc Retarget session còn cần Character; lỗi không ghi thay đổi.
- Kiểm: shared/Retarget/Studio typecheck, targeted ESLint, 30 test pass và 1 FBX fixture skip. Browser/live broker chưa kiểm.

## 2026-10-18 — Đặt model không rig thành Scene prop

- Thêm `prop.add` qua shared broker dùng pinned Topview `buildPropNode`; model GLB/glTF không skin có thể thêm vào Scene mà không tạo Character/Skeleton. UI asset rail, Python CLI và MCP dùng chung command; transform, group parent, validation, dry-run và Undo/Redo cùng revision.
- Kiểm: shared/Retarget/Studio typecheck; 29 test pass, 1 FBX fixture test skipped; Python CLI/MCP 25/25; 18 YAML parse. Browser UI/live broker chưa smoke-test.

## 2026-10-18 — Kiểm tra liên kết cây Scene

- Shared project validator nay từ chối `parentId` mồ côi/trỏ sai loại node, `children` mồ côi/trùng và vòng parent; vẫn giữ nguyên Topview document, không tự sửa graph.
- Kiểm: shared/Retarget/Studio typecheck; suite 29 pass, 1 FBX fixture skip. Geometry/browser hierarchy interaction chưa được smoke-test.

## 2026-10-18 — CLI scene.apply

- Thêm `scene apply PROJECT_ID operations.json`: Python CLI đọc bounded UTF-8 JSON array và dispatch qua cùng shared broker, không ghi manifest trực tiếp. Broker hiện chỉ hỗ trợ một `document.replace` operation cho lệnh này.
- Kiểm: Python CLI/MCP unit tests 25/25; `scene apply --help` đạt. Scene node-level operations và live broker chưa được kiểm.

## 2026-10-18 — Python CLI/MCP lưu session V9.12

- Python CLI có `retarget session set` với giới hạn JSON UTF-8 12 MiB; MCP broker tool hỗ trợ cùng command, còn bake/export vẫn chưa hỗ trợ.
- Kiểm: Python CLI/MCP unit tests 21/21, compile, CLI help và 18 YAML parse đạt. Live broker/MCP host chưa smoke-test.

## 2026-10-18 — Dùng mapping trong preview và lưu session V9.12

- Reverse preview áp mapping/calibration đã lưu khi FBX hash, đơn vị và hierarchy Minecraft20 khớp điều kiện; solver tiếp tục dùng armature V9.12 tĩnh. GLB importer nhận Mixamo65 theo signature 65 xương + core names.
- Thêm port validator cho JSON project V9.12, fingerprint source FBX khi import, command `retarget.session.set`, blob JSON bất biến, shared undo/redo, route đọc snapshot và Retarget Session panel để import/save/load/download.
- Kiểm: 26 test pass, một FBX fixture test skipped; shared/Retarget/Studio typecheck, ESLint các file Studio đổi và `git diff --check` đạt. UI/API browser smoke chưa chạy.
- Giới hạn: test session dùng fingerprint fixture tổng hợp; target native fingerprint chưa được đối chiếu với target Character rest matrices. Snapshot chưa được apply vào evaluator; chưa có bake, timeline placement, export hay RETARGET-02/RIG-01 acceptance.

## 2026-10-18 — Tải lại và cập nhật semantic mapping đã lưu

- Mapping đã lưu có thể được chọn; UI nạp lại bone pairs và calibration fingerprint-bound từ local API, rồi hiển thị chính xác correction controls. Lưu lần nữa cập nhật cùng mapping ID, tạo calibration blob mới và giữ Undo/Redo.
- Kiểm: shared/Retarget/Studio typecheck, ESLint; mapping/calibration 6/6; toàn bộ shared/Retarget/Studio suite 22 pass, 1 FBX fixture test skipped; 18 YAML parse.
- Chưa chạy browser interaction; mapping vẫn chưa được áp vào solver/session.

## 2026-10-18 — Lưu semantic mapping và calibration V9.12

- Thêm role suggestions khớp alias chính xác, báo ambiguous để người dùng gán tay, validation theo family đích và mapping UI bằng stable bone IDs. Xương không map cần `ignored.reason`; incomplete mapping lưu thành draft, không tự xác nhận.
- `skeleton.mapping.set` kiểm source/target fingerprint, pair/role/target uniqueness và calibration settings; lưu JSON theo SHA-256 trong project, có revision/Undo/Redo. Correction controls của preview được truyền vào calibration. Thêm API đọc calibration theo project/mapping dưới local session.
- Kiểm trước khi bổ sung thao tác nạp lại: shared/Retarget/Studio typecheck và targeted ESLint; kết quả test gần nhất được ghi tại checkpoint trên.
- Chưa kiểm UI/API mapping trên browser; mapping hiện chỉ được lưu, chưa được áp vào retarget session/solver. Chưa có reference pose, Metarig/skin rebind, feet/hands, bake, timeline hoặc export.

## 2026-10-18 — Phát thư viện BOBJ V9.12 trên armature Minecraft20

- Port sampler `restLocal × T × Rz × Ry × Rx × S` và world hierarchy; UI có viewport Three.js, play/pause và scrub clip native BOBJ.
- Kiểm: toàn85 action sample ra pose hữu hạn, thư viện có chuyển động; Retarget/Studio typecheck và ESLint đạt. Chưa có browser smoke hay golden matrix parity.

## 2026-10-18 — Lưu FBX source Motion vào unified project

- Mở rộng `asset.import` cho FBX: Node Three FBXLoader lấy hierarchy/rest transforms và animation clips; source asset, source SkeletonProfile và từng Motion clip được commit chung dưới revision/history. Original FBX giữ nguyên hash-addressed; `unitMeters` lưu trong profile, UI chọn cm hoặc m.
- Nút Save trong Retarget Preview nạp file vào project đang mở; kiểm thử fixture thực xác nhận profile Mixamo65 65 xương, 30 FPS, metadata clip, dedupe cùng unit và Undo/Redo.
- Chưa có configurable mapping, retarget session, bake, timeline placement, converter export hoặc browser-to-API smoke; FBX có texture cần DOM vẫn có nguy cơ không parse được trên Node.

## 2026-10-18 — Solver reverse và viewport Retarget

- Thêm `parseBobjArmature` và `createReverseRetargeter` cho Mixamo65→Minecraft20; giữ skeleton BOBJ multi-root và output numeric tuples, kiểm soát quat/range/input finite.
- Retarget UI nạp FBX tại browser, chọn clip, đơn vị cm/m, playback/scrub, source/target WebGL skeleton, root/mirror/intensity/stride/vertical/proportion/arm-space controls. Source bytes chỉ ở bộ nhớ tab, chưa lưu project.
- Test 6/6; Retarget/Studio typecheck, ESLint; kiểm hai FBX fixture 65→20; browser WebGL Edge playback đạt. Cập nhật provenance armature/license và LISTCODE/STATUS.
- Còn mapping/calibration profile, Metarig, feet/hands, forward retarget, project asset/session/bake/export, CLI/MCP và Film; Next production build dừng ở Windows glob EPERM. Không sửa HTML V9.12 gốc.

## 2026-10-18 — Bắt đầu tích hợp Retarget V9.12

- Thêm package `@bbs/retarget`: parser BOBJ và evaluator nội suy; trích library 85 actions/manifest/labels với provenance GPL-3.0-only vào bản app hợp nhất.
- Thay placeholder Retarget bằng UI tìm/chọn clip, xem metadata và nạp/phân tích keyframe; không hiển thị giả kết quả retarget khi solver chưa được chuyển.
- Đối chiếu đủ 85 actions với manifest; parser/evaluator tests 3/3; combined Studio targeted tests 9/9; package và Studio typecheck, lint component đạt.
- Chưa chuyển FBX, rig solver, mapping/calibration, preview, bake, export hoặc kiểm thử browser. Source V9.12 giữ nguyên.

## 2026-10-18 — Bắt đầu code giai đoạn C theo đặc tả

- Người dùng yêu cầu “dựa vào đặc tả hãy code”. Tạo implementation copy độc lập `three-workspace-app/editor/` từ Topview v0.1.8 đã khóa; checkout nguồn `.build-tools/topview-3d-builder-v0.1.8` không sửa.
- Triển khai một phần IDs 1.1.1–1.1.3, 1.2.1–1.2.6, 1.6.1 và 1.6.3: shared project types/validator, store JSON riêng, revision/CAS, atomic write, request-ID lock/dedupe, history, loopback API, HostAdapter lưu Scene+fcurves một transaction, workspace shell và Python CLI. Phím Ctrl/Cmd+Z, Shift+Ctrl/Cmd+Z, Ctrl/Cmd+Y trong unified shell gọi project history; input text giữ undo gốc. Tất cả broker command dùng request lock trước dedupe để tránh hai payload cùng ID vượt kiểm tra đồng thời.
- Retarget/Animation hiện là placeholder. Scene `document.replace` là command duy nhất của editor; project manifests có binary asset records, native retarget/motion operations, converters, MCP và Film export chưa hoạt động. Legacy Topview import tạo project mới, không chạm nguồn.
- Xác minh cục bộ: typecheck shared, builder source+tests và Studio; builder build; 87 file/524 test Topview; targeted Studio ESLint, locale check; final-schema store smoke; 8 session assertions; dev API/workbench route smoke; 6 Python CLI tests; CLI `--help`; 10 TS + 1 JS syntax checks; 18 YAML, manifests/lockfile và 28 IDs parse. Production Next build lỗi Glob/EPERM tại junction `AppData\Local\Application Data`, kể cả `--no-lint`; dev server/API chạy. pnpm install dừng ở cảnh báo lifecycle scripts và pnpm wrapper không có TTY; dùng executable trực tiếp cho kiểm tra. Browser hydration/WebGL chưa chạy. Xem [DOC-006](CHECKPOINTS.md#doc-006) và [STATUS](STATUS.md).

## 2026-10-18 — Hoàn thiện đặc tả trước code

- Theo yêu cầu “hãy hoàn thành đặc tả và báo cáo lại”: hoàn thiện11feature specs/28development IDs,2contract YAML/25commands,33acceptance cases,14fixture files+3recipes và source-index977files. Giữ AGENTS65dòng, chưa sửa source ứng dụng.
- Đối chiếu35Animationmodules+6appfiles+2CSS với HTML1.31.8; giữ discrepancy metadata package1.31.5/lineage1.31.7. Xác nhận Three upstream khác phiên bản: Topview0.184,Retarget0.186.1,AnimationREVISION186; bổ sung numeric adapter boundary.
- Sửa nhận diện BBS: checkoutHEAD hiện2.7; target2.4 được khóa commit0085f77ced9232dc4e26ac51fc7d98f95d1d5b0b. Pin25source blobs+5bridge artifacts; thiết kế reuse codec/FilmEditorJava17 staging, không ghi game.
- Sửa PROJECT hiện hành sangMinecraft20; phần25thuộc yêu cầu ban đầu đã bị thay thế. Tách source namespace khỏi target IDs; trạng thái code presence/test/runtime/user acceptance không gộp complete.
- Kiểm docs đạt; xem DOC-005 và evidence/docs-validation.yaml. File index không thay full behavior audit; golden/runtime/Site/game chưa chạy.

## 2026-10-18 — Áp dụng AGENTS và rà soát đặc tả trước code

- Người dùng yêu cầu giữ dưới 200 dòng, sau đó xác nhận “ok áp dụng”. Áp dụng nguyên khối AGENTS đã đề xuất: 65 dòng; chỉ thay hướng dẫn của dự án hợp nhất, giữ ba AGENTS nguồn.
- Đối chiếu 11 đặc tả với 28 đầu việc phát triển trong LISTCODE: mọi đầu việc có liên kết đặc tả, nhưng còn khoảng trống về source coverage, schema/API, migration, fixture/sai số và Film codec. Ghi rõ tại [SPEC_READINESS](SPEC_READINESS.md).
- Cập nhật trạng thái [bản đề xuất](AGENTS_PROPOSAL.md) thành đã áp dụng phần AGENTS; giữ các mục cần đồng bộ tiếp. Không chuyển phê duyệt tài liệu thành quyền sửa ứng dụng.

## 2026-10-18 — Pin source Topview v0.1.8

- Truy vấn refs GitHub và clone tag `v0.1.8` về `.build-tools/topview-3d-builder-v0.1.8`; khóa commit `631c08c8fd352b4ff83df33aa9a74a4563f4674b`.
- Lập cây 929 file, map Studio/Builder/CLI/tests/assets/license; 26 file Python/schema của cache khớp tag sau chuẩn hóa line ending.
- Mở rộng `inventory/topview.yaml`, cập nhật CODEMAP/ROADMAP/LISTCODE và đặc tả Scene. Không chạy test, build hoặc UI/WebGL.

## 2026-10-18 — Kiểm kê A–B

- Người dùng duyệt hồ sơ A–B; chọn Animation Studio 1.31.8, Retarget V9.12, Topview CLI 0.1.8, PC local, Minecraft20, chuyển module theo đợt, Film BBS FS và nghiệm thu keyframe riêng.
- Đối chiếu tĩnh source/artifact Animation và Retarget, package Python/schema/API CLI Topview; thêm inventory, kiến trúc, reuse matrix, đặc tả, roadmap và LISTCODE.
- Khóa SHA-256 cho 47 file Animation source, 27 artifact Retarget V9.12 và 26 file Python/schema Topview local; thêm đặc tả workspace còn thiếu và cập nhật bằng chứng Film/replay/keyframe BBS FS.
- GitHub outbound bị chặn (`git ls-remote` không kết nối được); chưa audit source TypeScript/React đầy đủ của Topview. Không tự suy ra trạng thái module từ mindmap. Xem [SOURCES](SOURCES.yaml), [STATUS](STATUS.md), [checkpoint](CHECKPOINTS.md).
- Không sửa source app, build, Site, release, game hoặc commit.

## 2026-10-18 — Khởi tạo tài liệu

- Người dùng cung cấp trao đổi về một ứng dụng có ba workspace và ban đầu yêu cầu chỉ ghi nhận.
- Sau đó người dùng yêu cầu tạo docs theo skill docs: cho phép tạo tài liệu, không cấp quyền sửa code.
- Tạo bộ tài liệu riêng để mô tả mục tiêu hợp nhất; giữ nguyên tài liệu của các dự án hiện có.
- Tách yêu cầu của người dùng khỏi đề xuất trong phần tư vấn và các khả năng chưa xác minh.
- Nguồn sản phẩm và baseline để trạng thái chưa xác định. Xem [mốc tài liệu](CHECKPOINTS.md).

## 2026-10-19 — Triển khai Animation Creation AC-00–AC-08

- Người dùng duyệt code AC-00–AC-08. Tích hợp artifact 1.31.8, host bridge, `motion.edit`, asset storage, Scene placement và GLB loaders; không sửa source gốc.
- Typecheck, Studio lint, offline smoke và static route check đạt. Builder evaluate có 554 test đạt/1 bỏ qua nhưng suite fail do file `sceneBasis.test.ts` không khai báo suite; Next build gặp EPERM ở thư mục AppData.
- Chưa có browser/WebGL, parity, native Film export hoặc N1–N5 evidence; ghi `0/9` AC nghiệm thu. Derivative vẫn do local editor tạo, chưa có server-side rebake. Xem [task plan](../ANIMATION_CREATION_TASK_PLAN.md) và [STATUS](STATUS.md).
