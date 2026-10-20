# Kế hoạch ưu tiên Demo Runtime MVP

> **Bổ sung đề xuất sau phản hồi người dùng 2026-10-19:** P0-04/D2 bên dưới chưa đủ vì mới có Topview blocking. Đọc [đặc tả native Creation](docs/features/animation-creation-integration.md) và [task AC](ANIMATION_CREATION_TASK_PLAN.md): native editor, tạo/sửa key xương, IK/graph cơ bản, lưu/mở lại và edited playback phải lên P0; P2 chỉ hoãn full parity nâng cao. Chưa code bổ sung trước khi duyệt. Phần kế hoạch cũ giữ để truy vết, không dùng nó để loại native creation khỏi MVP mới.

Ngày: 2026-10-19. **Đề xuất chờ duyệt; chưa triển khai code hoặc chạy game.** Cơ sở: [MVP_RUNTIME_READINESS_REVIEW.md](MVP_RUNTIME_READINESS_REVIEW.md). Kế hoạch ưu tiên tái sử dụng source và thử rủi ro sớm, không ghép toàn bộ feature catalog trước khi có demo.

**Bàn giao cho agent code:** đọc [MVP_IMPLEMENTATION_HANDOFF.md](MVP_IMPLEMENTATION_HANDOFF.md) để có scope, source/module, contract, fixture,20 assertion và deliverables; người dùng có thể dùng [MVP_AGENT_PROMPT.md](MVP_AGENT_PROMPT.md) để giao việc. Phương án đề xuất hiện tại là **B — một app**, target65; A chỉ đối chiếu/dự phòng. Các lựa chọn này chưa tự trở thành quyền code.

## 1. Đích demo có thể nghiệm thu

Một fixture được khóa hash: model skinned, animation nguồn và target **Mixamo65** hợp lệ; chọn một motion có thể retarget bằng engine nguồn hiện có. Hai Character (có thể cùng một model),3giây ở30FPS, một camera và tối đa hai shot, cut1,5giây nằm trên grid20Hz, một chỉnh sửa blocking/pose rõ ràng ở tick30. Actor scale1; không actor roll; bối cảnh Minecraft sẵn có. Nếu cần texture, dùng một ảnh chung được converter hỗ trợ.

PASS cuối: Import model/action → retarget thật → Scene bố trí → Animation chỉnh một key tạo kết quả khác nguồn → native Film/asset package → BBS FS2.4 mở/phát đúng → sửa một key trong Film Editor → save/reopen giữ thay đổi. So sánh source hash trước/sau, thời gian60ticks, tọa độ actor/camera và pose tại tick0/30/60; ghi version/hash, ảnh/video và kết quả từng bước. Những dung sai số học dùng lại `docs/acceptance.yaml`; không tự nới khi fail.

Mixamo65 là phương án đề xuất theo lựa chọn “65 hoặc25” của người dùng. MC25 chưa có implementation đã xác minh; nếu chọn MC25 phải bổ sung fixture/hierarchy/rest/semantic mapping/skin/roundtrip trước. Không dùng MC20 thay MC25. Fixture Mixamo65 đã chuẩn hóa sẵn chỉ dùng kiểm exporter sớm; không tính đó là đã vượt bước retarget.

## 2. Chọn phương án triển khai

| Phương án | Phần tái dùng | Việc thêm | Thủ công | Mức sẵn sàng |
|---|---|---|---|---|
| A — demo workflow liên ứng dụng | Retarget V9.12 bake/export; Blender bridge; shared Scene/Animation; native Film worker | Kiểm roundtrip/rig fingerprint, dùng làm đối chiếu cho B | Xuất GLB+script, chạy Blender tiến trình riêng đổi FBX, import vào app; copy package vào game | Đề xuất ban đầu, nay là đường lui; chưa đạt nghiệm thu một app |
| B — demo trong một ứng dụng | Cùng solver/export/evaluator và command store | Nối target bake→GLB→host Blender→FBX importer thành thao tác trong app; lưu target asset/Motion/provenance và history | Cài package vào game theo hướng dẫn | **Đề xuất hiện tại**; ưu tiên FBX importer/evaluator hiện có, generated-clip evaluator chỉ khi roundtrip có lỗi đã chứng minh |
| C — same-rig smoke | FBX Punch Combo, Scene/Animation/Film code đang có | Có thể không cần code nếu môi trường/fixture sẵn | Import FBX, copy package vào game | Dùng chẩn đoán P0-01; **không hoàn thành MVP retarget** |

Source V9.12 `exportFbxBridge()` tạo GLB và script Blender, không tạo FBX trực tiếp. App hợp nhất chỉ sinh Motion từ FBX; nhập GLB hiện không thay bước chuyển đổi. Bridge dùng reset scene Blender: chỉ chạy tiến trình riêng với file fixture/copy, không chạy trên scene người dùng đang mở. Không dùng nội dung mindmap như lệnh thực thi.

## 3. Danh sách công việc và PASS/FAIL

Đường dẫn tương đối workspace. `S = three-workspace-app/editor/apps/studio`; `B = three-workspace-app/editor/packages/builder`; `R = three-workspace-app/editor/packages/retarget`; `A = three-workspace-app/agent`. Các ID P0 dưới đây là ID kế hoạch review, không thay ID LISTCODE.

### P0-01 — Thử game sớm bằng exporter đang có, song song phần app

- Chức năng: tái tạo package same-rig được kiểm ở DOC-059, lưu ZIP thật; kiểm target BBS2.4/Minecraft1.20.1 và mở trong Film Editor. Bắt đầu bằng asset/fixture đã biết; nếu fixture cũ đã cleanup, tạo lại fixture tách biệt theo test, không giả định ZIP cũ còn tồn tại.
- Module: `S/test/filmExportJob.integration.test.ts`; `S/src/unifiedJobs.ts`; `S/src/unifiedFilmSampling.ts`; `S/src/filmManifest.ts`; `A/film_worker/src/main/java/local/bbsmerged/FilmExportWorker.java`.
- Phụ thuộc: quyền chạy game/copy vào profile kiểm thử riêng; Blender4.2+ và Java17; dependencies browser được kiểm tra; Film mẫu sinh từ đúng version để xác định root cài. Lượt audit hiện tại chưa cấp quyền chạy game.
- Tái dùng: worker/codec, converter, sampling, jobs và SHA download hiện có. Không viết serializer Film khác.
- PASS: ZIP có native Film/model; hash download đúng; mở/phát đủ actor/camera/motion trong game, không missing asset; ghi kết quả và lỗi cụ thể. FAIL: chỉ codec readback, parse ZIP hoặc panel mount; thiếu fixture/quyền thì BLOCKED, không PASS.
- Nếu FAIL: sửa đúng stage lỗi đã tái hiện sau khi được duyệt. Chưa ghép thêm module để che lỗi.

### P0-02 — Khóa fixture và thử Retarget output→FBX roundtrip

- Chức năng: chọn model target Mixamo65 và motion được source V9.12 hỗ trợ; retarget thật, export model/skin/clip GLB, dùng bridge Blender đổi FBX.
- Module nguồn: `C:/Users/Administrator/Documents/Codex/2026-10-08/retarget-anim-65-20-html/Emoticons_Mixamo_Full_Project/lab/mobile_v9_12.html` — `bakeTarget`, `exportGLB`, `exportFbxBridge`; `S/src/unifiedAssetFiles.ts` importer.
- Phụ thuộc: xác nhận fixture/đích65; không có yêu cầu demo mọi rig. P0-01 thử độc lập khi người dùng kiểm game; không chặn code/test app trong lúc chờ. Nếu game FAIL, sửa stage tương thích có bằng chứng.
- PASS: output FBX có mesh/skin/target skeleton/clip, Action nguồn hash không đổi; clip count/name/duration được đối chiếu; pose tại đầu/giữa/cuối đúng target; importer tạo Character và Motion cùng fingerprint/unit; không gọi source passthrough là retarget.
- FAIL: chỉ có stick-rig preview, animation JSON rời, model không có mesh, FBX không có action, hoặc giả fingerprint cho qua validation. Nếu bridge không giữ skin/clip đúng, ghi lỗi và chọn B/adapter nhỏ; không khẳng định phương án A đã sẵn sàng.

### P0-03 — Hoàn thành handoff sản phẩm Retarget

- Phương án A: dùng FBX đã đạt P0-02 làm asset nguồn mới trong shared project; tái dùng `asset.import`, `character.add`, `motion.place`. Có thể chỉ cần xác minh tích hợp, không sửa code nếu các gate qua.
- Phương án B khi duyệt một-app: nối forward bake/GLB→Blender riêng→FBX importer bên trong thao tác “Lưu kết quả vào dự án”, sinh immutable asset + Motion target và provenance/history. Tái dùng clip metadata/evaluator hiện có; chỉ thêm generated-clip evaluator nếu roundtrip fail có bằng chứng. Hợp đồng chi tiết ở bàn giao mục3. Không bỏ guard same-rig một cách toàn cục.
- File: `R/src/bake.ts`, `reverse.ts`, `mapping.ts`; `S/app/workbench/components/RetargetPreview.tsx`; `S/src/unifiedAssetFiles.ts`, `unifiedProjectStore.ts`, `unifiedSkeletonEvaluation.ts`; `S/app/workbench/components/AnimationWorkspace.tsx`; `B/src/engine/io/AssetLoader.ts`; hợp đồng `three-workspace-app/editor/packages/shared/src/index.ts`.
- Phụ thuộc: P0-02. Với target65 phải tái dùng forward engine nguồn; reverse20 hiện có không giải quyết đích65/25 chỉ bằng đổi tên.
- PASS: chọn motion retarget trong Animation, play trên đúng target model; save/reload/Undo/Redo giữ clip/binding/provenance; source immutable; stale revision/invalid target bị từ chối; CPU và WebGL cùng pose trên fixture. FAIL: chỉ download JSON, clip chạy trên source rig hoặc khác target rest/mesh.

### P0-04 — Scene→Animation và một chỉnh sửa blocking có thể xuất

- Chức năng: hai Character, đặt vị trí/hướng, camera/shot, chuyển workspace, đặt motion, chỉnh thời gian và tạo một blocking transform key trên actor; không cần toàn bộ native Animation Studio hoặc một hệ bone pose mới.
- File: `S/app/workbench/components/StudioOverlay.tsx`, `AnimationWorkspace.tsx`; `S/src/LocalHostAdapter.ts`, `unifiedProjectStore.ts`; `B/src/sync/DocumentSync.ts`, `B/src/components/inspector/PosePanel.tsx`, `B/src/components/timeline/TimelineKeyframeRows.tsx`.
- Phụ thuộc: P0-03. Tái dùng DirectorStudio, FCurves/userKeys, history và evaluator hiện có.
- PASS: project/Character/clip/camera ID không đổi khi chuyển workspace; blocking key thay đổi pose tại tick30, Undo/Redo và reload đúng; CPU sampling có cùng chỉnh sửa, không reset về clip nguồn. FAIL: UI thể hiện key nhưng sample/export bỏ key, hoặc clone/reload mất dữ liệu.
- Nếu clone IO_FAILED tái hiện trong demo, sửa nguyên nhân ở storage/command path trước; có thể tạo hai Character qua `character.add` để loại clone khỏi đường demo nhưng vẫn ghi lỗi tồn tại.

### P0-05 — Xuất package thật từ chính fixture retarget và blocking

- Chức năng: nối fixture P0-04 vào pipeline export có sẵn, xác minh cut/tick, material và file thật.
- File: `S/src/unifiedFilmSampling.ts`, `filmCamera.ts`, `filmPoseBake.ts`, `filmManifest.ts`, `unifiedJobs.ts`; `S/app/workbench/components/film-export/hooks/useFilmExport.ts`; `S/app/workbench/components/scene-render/utils.ts`; `A/film_model_converter.py`, `A/film_worker/blender/convert_model.py`.
- Phụ thuộc: P0-04 có nội dung cần xuất; dùng contract pinned BBS2.4 hiện có. P0-01 cung cấp phản hồi game khi có, không chặn tạo/lưu package trong lúc chờ. Chưa thử game thì chỉ báo native readback PASS.
- PASS:3giây=60ticks, camera cut đúng20Hz, native readback, target bone names/rest mapping đúng, pose key mới tồn tại; actor scale/unit/root đúng; texture của fixture hiện diện; file lưu trên đĩa thật có SHA bằng job record. Có thể dùng CLI verified download nếu OS folder picker lỗi và ghi rõ thao tác thủ công.
- FAIL: output tồn tại nhưng mất chỉnh sửa, không có texture bắt buộc, camera sai hoặc save chỉ là stub. Không bỏ giới hạn scale/shear/cut để giả PASS.

### P0-06 — Nghiệm thu xuyên suốt trong BBS FS

- Chức năng: install bản package mới vào profile kiểm thử đúng version, mở Film, playback; chỉnh key ở tick30, save/reopen/play.
- Module tham chiếu: `A/film_worker/src/main/java/local/bbsmerged/FilmExportWorker.java`; pinned BBS2.4 Film/Replay/Film Editor theo `docs/SOURCES.yaml`; tiêu chí `docs/acceptance.yaml` FILM-02, FILM-03, E2E-01.
- Phụ thuộc: P0-05, quyền thao tác game riêng. Đây là kiểm thử cần thiết, không phải một tính năng web mới.
- PASS: đúng hai actor,60ticks, pose/camera/placement/root/texture khớp fixture; edit key lưu và mở lại có tác dụng, không đổi actor/camera khác; source project/action không đổi. Lưu version/hash + ảnh/video + số đo/steps.
- FAIL: chỉ native codec parse, ảnh preview web, video render hoặc model/action tải được từng phần. Chỉ khi bước này PASS mới gọi Demo Runtime MVP xuyên suốt hoàn thành.

### P1-01 — Tái lập môi trường demo và khả năng khôi phục

- Module: `three-workspace-app/editor/package.json`, `apps/studio/package.json`, lockfile/launcher hiện có; CLI doctor/start/stop và project backup theo CODEMAP.
- Phụ thuộc: kiểm nhanh môi trường trước P0-01, hoàn thiện packaging sau luồng chính. Nếu dependency hiện tại làm dev server không khởi động, phần đó trở thành P0 blocker thực tế.
- PASS: khởi động lại được cùng version/deps, mở lại project và asset trên đĩa, không cần tự sửa junction mỗi lần; kiểm backup vào thư mục riêng. Ghi Next production EPERM là lỗi packaging riêng nếu dùng dev host cho demo.

### P1-02 / P2 — Chỉ mở rộng sau demo

- P1: MC25 đúng hierarchy/rest/skin nếu được chọn thay65; GLB Motion và BOBJ/Blockbench importer nếu bắt buộc; props export hoặc world build nếu nằm trong cảnh nghiệm thu. Files: `unifiedAssetFiles.ts`, shared profile/types, Retarget mappings, `unifiedFilmSampling.ts`/`filmManifest.ts` cho props. PASS phải có fixture format/profile tương ứng, không chỉ schema mới.
- P2: advanced IK/contact, clip fades/layers, full85action matrix, arbitrary rig retarget, native Animation1.31.8 parity, AI/prompt generation, một hệ MCP/debug mới, multi-texture/shape keys và long-film export. Debug tối thiểu qua CLI/broker/MCP sẵn có thuộc mục6, không hoãn toàn bộ chẩn đoán tới P2.

## 4. Thứ tự ngắn nhất và đường lui

```text
D0: môi trường + debug tối thiểu + fixture
   → P0-02 retarget roundtrip target65
   → P0-03 handoff B trong app
   → P0-04 blocking/key persistence
   → P0-05 package từ đúng fixture đã retarget/chỉnh
   → giao APP_RUNTIME_READY cho người dùng kiểm

Song song khi có người kiểm game: P0-01 same-rig smoke
Sau package P0-05 + quyền kiểm game: P0-06 playback/edit/save/reopen
   → E2E_GAME_PASS
```

Không cần xây cả workflow mới. Các điểm đã có — import FBX, shared scene, timeline cùng rig, sampling, Blender converter, Java native codec — được giữ. Công việc còn lại được giới hạn bởi gate cụ thể và lỗi thực tế.

**Giải pháp trung gian cho BBS:** đã có exporter native nên ưu tiên ZIP hiện tại và copy `films/`/`assets/` thủ công theo root2.4 đã xác minh. Nếu native Film không tương thích, trước tiên lấy Film mẫu của đúng version để sửa adapter có bằng chứng. Phương án dự phòng là BOBJ model/actions + manifest actor/camera/timing rồi tự tạo Film/Replay, gán model/action và camera/key trong game. Đây là lắp thủ công, chưa phải E2E export PASS và phải kiểm action tồn tại; không đổi đuôi JSON thành Film.

Không cam kết ngày hoàn tất từ số dòng code. Sau D0 và P0-02, ước lượng phần app còn lại theo lỗi/task đã xác minh; thời gian chờ P0-01/P0-06 ghi riêng. Không cần chờ game để ước lượng hoặc giao phần app. Dừng mở rộng phạm vi cho đến khi demo đạt hoặc phát hiện blocker có bằng chứng.

## 5. Phạm vi duyệt đề xuất

Đề xuất ban đầu của review là target Mixamo65 với phương án A có chuyển file thủ công. **Theo định hướng tiếp theo của người dùng muốn hoàn thiện tối thiểu để trực tiếp test runtime và có MCP debug, phương án đề xuất hiện tại chuyển sang B: hoàn thiện MVP trong một app, thêm chẩn đoán tối thiểu; A chỉ là đường đối chiếu hoặc dự phòng.** Vẫn kiểm native Film sớm để loại rủi ro cuối chuỗi. Đây là đề xuất cập nhật, chưa phải xác nhận code. Quyền code không tự cấp quyền chạy game, copy asset vào profile, thay mod, publish Site hoặc sửa source gốc.

Lượt review ban đầu tạo hai báo cáo và chạy26test logic sẵn có; lượt đề xuất debug kiểm thêm15 MCP unit test. Lượt bàn giao bổ sung đặc tả/prompt, không sửa ứng dụng hoặc chạy các công việc P0 ở trên.

## 6. Đề xuất cách làm cho app lớn: MVP chạy được + chẩn đoán chung

Cập nhật theo yêu cầu tiếp theo ngày2026-10-19. Mục tiêu là hoàn thiện toàn bộ phần tối thiểu trong một app để người dùng kiểm thử được, đồng thời có cách tái hiện lỗi nhanh. MCP là một kênh gọi công cụ; nó không thay việc hoàn thiện Retarget, shared Motion hoặc kiểm WebGL/game. Không tạo một hệ thống debug lớn trước khi giao luồng sử dụng.

### Những gì đã có để tái sử dụng

- `A/unified_mcp.py`: một tool `bbs_unified_command`,17 command được công bố; đã có project.inspect, scene.evaluate, job.get/cancel, motion.place, history và film.export qua broker chung.
- `A/unified_cli.py`: HTTP client/session, command identity, upload, verified download và CLI cùng broker. Không xây kênh ghi project thứ hai.
- `S/src/devtools/DevToolsDock.tsx`, `tools.tsx`, `liveStudio.ts`: dock và reference tới editor thật. Registry hiện chỉ có export-draft; chưa phải bảng chẩn đoán hoàn chỉnh.
- `S/scripts/unified-smoke.mjs`: Playwright chạy workflow FBX, thu page/console errors và HTTP failures; có report/screenshot options. Đây là nền kiểm browser, không cần viết MCP tự điều khiển browser từ đầu.
- `S/src/unifiedJobs.ts`: job state/progress đã lưu. Tuy nhiên catch của Film hiện trả `FILM_EXPORT_FAILED` chung; chưa giữ nguyên nhân/stage đủ cho tìm lỗi nhanh.
- Chạy thêm `python -m unittest agent.test_unified_mcp`: **15/15 PASS**, không có live client/server/game trong test. Đây là kiểm transport/validation bằng test hiện có, không phải kết nối MCP runtime PASS.

### Bộ chẩn đoán tối thiểu cần duyệt

| Phần | Kết quả cần có | Cách làm nhỏ nhất / module | PASS |
|---|---|---|---|
| Kiểm môi trường | Thấy lỗi dependency, port, package build, Blender/Java ngay khi mở demo | Bổ sung kiểm vào launcher/CLI hiện có; trả version và capability có thật | Máy hiện tại khởi động lại app được; thiếu thành phần thì báo tên và cách sửa, không treo |
| Đọc trạng thái project | Workspace, revision, selected actor, frame, motion/target fingerprint, missing asset | Dùng project.inspect/scene.evaluate và liveStudio; chỉ thêm trường cần thiết | UI và MCP/CLI đọc cùng project/revision; đọc không thay đổi dữ liệu |
| Nhật ký theo lần chạy | Từ thao tác UI tới requestId/jobId, stage và lỗi đầu tiên | Bổ sung structured stage/error trong unifiedJobs/command path; giữ log có giới hạn và loại token/cookie | Cố ý làm lỗi converter: thấy đúng stage, mã lỗi và tóm tắt nguyên nhân; không chỉ “Film export failed” |
| Chạy kiểm demo | Báo PASS/FAIL/BLOCKED từng bước trên bản project test riêng, xuất report/ảnh | Mở rộng unified-smoke và integration test có sẵn, chạy bằng CLI/terminal; chỉ nối MCP runner nếu thực sự cần, dùng allowlist | Kịch bản chạy lại cho kết quả giải thích được; không ghi đè project/asset người dùng |
| Gói lỗi cho người dùng | Nút “Xuất báo cáo lỗi”: version/hash, project metadata, bước tái hiện, log liên quan; ảnh khi browser runner có | Tái dùng DevToolsDock và export panel; asset lớn không tự nhúng | Gói đủ tái hiện lỗi fixture, thiếu asset được liệt kê; không chứa credential |

Tên command chẩn đoán mới chỉ là thiết kế khi triển khai; không ghi vào client như tool đã tồn tại. Ưu tiên mở rộng tool/broker hiện có, không đăng ký thêm nhiều MCP server. `asset.import` và `skeleton.mapping.set` chưa nằm trong17command bridge: nếu test workflow cần thì nối có validation/opaque upload như CLI, không cho phép đọc mọi đường dẫn filesystem qua tool.

**Gate bắt buộc nếu báo MCP đã sẵn sàng:** kết nối đúng client người dùng đang dùng, discover/list tool→inspect project→evaluate frame→đọc job/report. Chạy harness trên project riêng bằng CLI trước; không bắt thêm API runner. Code bridge hiện khai báo stateless protocol và từ chối `initialize`; phải quan sát handshake thực tế, bổ sung tương thích nếu cần. Không giả định unit test PASS có nghĩa client nào cũng kết nối được. Nếu client chưa hỗ trợ, CLI dùng cùng broker là kênh debug tạm thời để việc hoàn thiện MVP không bị dừng.

### Các mốc bàn giao có thể mở và kiểm thử

| Mốc | Người dùng kiểm được gì? | Điều kiện kết thúc |
|---|---|---|
| D0 — App khởi động + nhìn thấy lỗi | Mở app, mở project mẫu, xem health/error; agent đọc cùng trạng thái qua CLI/MCP | Launcher thật, live client nếu khả dụng, lỗi giả lập có đúng stage. Chỉ làm bộ chẩn đoán đủ cho vòng test đầu |
| D1 — Import/Retarget→target asset | Nạp fixture, retarget đúng target đã chốt, lưu model/motion đích và mở lại | P0-02/03; target mesh/rig/clip thật, nguồn bất biến. Current reverse20 không được tính là target65/25 |
| D2 — Scene→Animation | Đặt actor/camera, chuyển workspace, áp motion và sửa một key | P0-04; reload/Undo/Redo/CPU sampling giữ key và scene |
| D3 — Package thật trên đĩa | Bấm Export, xem tiến độ từng stage, lấy native Film+assets | P0-05; không stub file picker/save, checksum và native readback |
| D4 — BBS runtime | Mở/phát và sửa/lưu lại Film trong đúng game | P0-06 do người dùng test hoặc cấp quyền kiểm; ghi evidence |

P0-01 (same-rig native Film smoke) nên được làm sớm ngay khi có người dùng kiểm game để đánh giá rủi ro, không chờ D3 của fixture retarget. Các mốc trên là thứ tự bàn giao mục tiêu, **không phải trạng thái hiện tại và không coi cả5mốc chưa làm chỉ vì đang lập kế hoạch**: trước triển khai, gắn evidence hiện có vào từng assertion rồi chỉ làm phần thiếu.

### Cách điều hành để tránh kéo dài và tốn token

1. Khóa một fixture, một target và một đường demo. Đề xuất Mixamo65; nếu phải Minecraft25 thì làm đúng profile25 riêng. Không nhận thêm full-feature parity vào MVP.
2. Mỗi công việc là một khoảng đứt cụ thể giữa hai bước, có file, input/output và PASS/FAIL như P0-01…06. Tái dùng solver/evaluator/codec; không rewrite để đồng nhất framework.
3. Mỗi mốc lưu demo project có version, lệnh mở/chạy lại, báo cáo test và lỗi còn lại. Người dùng không phải tự dựng dữ liệu mới để biết tiến độ.
4. Theo dõi **hai dòng**: “đã triển khai các tiêu chí MVP” và “đã PASS runtime các tiêu chí MVP”; tổng số tiêu chí giữ cố định sau duyệt. Chỉ có code/API thì không đánh dấu runtime PASS; N/A khi chưa đủ bằng chứng. Số test PASS là evidence, không phải phần trăm dự án.
5. Mỗi lượt sửa phải xử lý một blocker đã tái hiện và chạy regression liên quan. Không chạy lại toàn bộ suite sau sửa docs hoặc gọi lại audit toàn repo khi không có thay đổi liên quan.
6. Mỗi lần dừng phải có kết quả mở được hoặc blocker kèm evidence, phần cần làm tiếp và phạm vi rõ. Nếu ước lượng trượt vì phát hiện contract/rig khác, báo ngay thay vì tăng scope âm thầm.

Không đưa ngày giờ hoàn tất chưa có căn cứ. Sau D0 và fixture retarget đầu tiên, ước lượng phần còn lại theo khoảng việc thực tế, báo lại khi đổi giả định. Bộ debug không được trở thành một dự án riêng; chỉ bổ sung khả năng quan sát nào đang giúp xử lý blocker MVP.
