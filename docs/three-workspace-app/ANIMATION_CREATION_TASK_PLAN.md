# Task bàn giao — tích hợp Animation Creation tối thiểu

Ngày: 2026-10-19. **Được người dùng cho phép triển khai:** “Hãy code list dựa trên các đặc tả.” Phạm vi là AC-00–AC-08 theo [đặc tả](docs/features/animation-creation-integration.md). Thực hiện theo phụ thuộc, giữ nguyên thay đổi có sẵn và không mở rộng sang commit/push/publish/game.

`S` = `three-workspace-app/editor/apps/studio`; `B` = `three-workspace-app/editor/packages/builder`; `A` = `three-workspace-app/editor/packages/animation` (**package dự kiến, chưa có**). Native = source 1.31.8 đã khóa trong đặc tả. File ghi “dự kiến” là nơi đề xuất tạo sau duyệt, không phải bằng chứng code hiện có.

Các ID AC là work-item của đợt này, ánh xạ LISTCODE `1.5.1–1.5.3` và shared `1.2.*`; không thay hoặc tự đánh dấu hoàn tất LISTCODE. Trạng thái mỗi task chỉ đổi khi có implementation và bằng chứng tương ứng.

## Thứ tự và phần được hoãn

```text
AC-00 → AC-01 → AC-02 → AC-03 → AC-04 → AC-05 → AC-06 → AC-07 → AC-08
```

Một agent có thể làm tuần tự; không cần nhiều agent sửa cùng store/UI. Sau AC-00, chuẩn bị persistence tests và lifecycle có thể tách nếu cùng dùng contract đã khóa. Không chạy triển khai song song trước khi thống nhất rig map/derivative/save semantics.

| Task | Ưu tiên | Kết quả người dùng nhận | Trạng thái hiện tại |
| --- | --- | --- | --- |
| AC-00 | P0 | Bằng chứng native engine có thể nối playback mà không viết lại | Partial — browser/runtime bake và CPU sample chạy; pose parity theo nhiều frame chưa đo |
| AC-01 | P0 | Editor Animation Creation mở trong app, cùng Character | Partial — mở đúng Character, viewport resize và RAF pause/resume đã đo; keyboard focus/context disposal/stale reply chưa nghiệm thu |
| AC-02 | P0 | Tạo/sửa motion bằng bone keys, IK, graph/easing | Partial — native UI ghi 132 keys và Spine pose thay đổi, GLB playback chạy; IK và graph/easing parity chưa kiểm |
| AC-03 | P0 | Lưu native motion vào project, mở lại, không mất dữ liệu | Partial — stale revision bị từ chối và draft lưu thành Motion mới; clone-on-edit/rebind và giữ Motion nguồn PASS; reload/reopen PASS; history/Undo và local bake trust còn thiếu |
| AC-04 | P0 | Đặt motion đã chỉnh vào scene, hai nhân vật không sửa lẫn nhau | Partial — hai Character dùng chung Motion; sửa A clone/rebind clip A, clip B và Motion nguồn giữ nguyên; clone/delete/document.replace/reload matrix chưa đủ |
| AC-05 | P0 | Scene/WebGL và CPU phát cùng kết quả native | Partial — isolated smoke so CPU evaluator với Three.js `AnimationMixer` trên GLB đã lưu tại frame 0/45/89, quaternion dot 1.0/1.0/1.0; viewport WebGL phát đổi hình, GLB HTTP200. Chưa đo fractional time, loop/trim, root trajectory, IK/easing parity |
| AC-06 | P0 | Draft, chuyển workspace, Undo/Redo và lỗi hoạt động đúng | Partial — isolated smoke xác nhận native Undo/Redo, giữ 132 keys qua Animation→Scene→Animation, cảnh báo đóng dự án và browser reload; placement Undo/Redo, commit reload/reopen PASS. Disconnect/conflict recovery matrix và khôi phục draft chưa lưu sau reload chưa đủ |
| AC-07 | P0 | Xuất package thật có chỉnh sửa animation | PASS — native Film sampling → Blender 4.2.3 conversion → BBS 2.4 worker → ZIP/hash/CRC/native readback; 65 pose tracks gồm changed pose |
| AC-08 | P0 | Bản demo và hướng dẫn tự test, report từng gate | Partial — isolated Playwright smoke và demo project có sẵn; N1–N5 acceptance checklist/report chưa xong |

P1/P2 nằm ở đặc tả; không lấy việc hoãn toàn bộ native creation làm cách đạt MVP. Retarget forward và BBS game vẫn là công việc/gate riêng trong kế hoạch toàn app.

## AC-00 — Kiểm chứng seam native → shared trước khi làm UI

- Phụ thuộc: không; cần model/clip fixture thật có hash và quyền đọc nguồn.
- Tái dùng: Native `core.js` (`makeRig/newProject/evaluate/validateProject`), `app.js` đường bake/GLTF export và import clip; loaders hiện có. Đọc `S/src/unifiedSkeletonEvaluation.ts`, `B/src/engine/io/AssetLoader.ts` và caller `loadMotion` trước sửa.
- Đầu ra sau duyệt: prototype nhỏ trong `A` (dự kiến), fixture manifest không nhúng asset cá nhân vào source, bảng native bone ID→shared bone, source/vendor version và NOTICE, báo cáo sample ở `docs/evidence/animation-creation-seam.md` (dự kiến).
- Thử: pose FK khác rest + pose IK + graph/easing trên rig65; xuất derivative GLB; nạp vào runtime Three của host; so pose native/CPU tại key và fractional time, kiểm unit/basis và animation track name. Native project deserialize rồi serialize không mất keys/settings.
- PASS: source không đổi hash, chạy offline bằng vendor local, sai số đạt ngưỡng acceptance đã ghi; chỉ rõ loader/public seam cần sửa và chi phí ước lượng phần còn lại. FAIL: chỉ build/import module, chỉ stick rig, thiếu track, cần đổi solver mới chạy, hoặc không kiểm midpoint.
- Nếu FAIL: báo adapter hỏng cụ thể trước khi làm UI rộng. Không lấy static iframe demo thay bằng chứng.

## AC-01 — Đưa editor gốc vào Workspace 03

- Phụ thuộc: AC-00. Tái dùng toàn bộ module cần cho UI nguồn và lifecycle nhỏ trong bản sao, không port hàng loạt sang React/TypeScript.
- File hiện có: `S/app/workbench/components/StudioOverlay.tsx`, `AnimationWorkspace.tsx`; cấu hình workspace/build liên quan đọc trước sửa. File mới dự kiến: `A/src/hostBridge.*`, `A` entry/build local; `S/app/workbench/components/AnimationCreationPanel/index.tsx` và hooks theo quy tắc repo.
- Đầu vào: Character/asset bytes, native edit tùy chọn, session/revision, active state. Đầu ra: ready/error/dirty/serialized project. Làm bridge đúng mục4 đặc tả, không mở `/api/studio` mailbox hoặc CDN fallback.
- PASS: native viewport/model/control hiện trong tab, focus và resize đúng, pause khi ẩn, dispose renderer/listeners/object URLs khi đóng; mở lại không tăng listener/context vô hạn. Host nhận lỗi load và stale-session reply bị bỏ. Kiểm origin/source và payload bằng test nhỏ.
- FAIL: editor chạy độc lập không nhận Character chung; hai renderer ẩn vẫn chạy; stylesheet/phím tắt làm thay Topview.

## AC-02 — Tạo mới và sửa animation thật

- Phụ thuộc: AC-01. Native: `app.js` (`writeKeys/seek/saveProject/loadProject/labBaseFromClip`), `core.js`, `control_rig.js`, `rig_kinematics.js`, `graph_editor.js`, `graph_curves.js`, `easing_panel.js`, `easing.js`.
- File tích hợp: bản sao trong `A`, host panel AC-01 và `AnimationWorkspace.tsx`. Reuse native controls/history; chỉ thêm open-new/open-existing/serialize seam. Giữ native JSON, không biến mọi thứ thành actor transform keys.
- PASS: tạo motion từ rig không cần source clip; sửa FBX motion đã nhập; thêm/sửa/xóa bone key, scrub/play, một IK control, interpolation/easing; kết quả khác nguồn và có thể mở lại trong native editor. Model/texture không mất trên fixture. UI phân biệt “Chỉnh animation” với “Sửa thời gian clip”.
- FAIL: nút có mặt nhưng không đổi pose; native motion-lab base không được giữ khi edit FBX; nguồn bị ghi đè. Những module nâng cao giữ code/data nhưng chưa nghiệm thu được ghi rõ.

## AC-03 — Lưu native motion bằng một transaction

- Phụ thuộc: AC-02. File: `S/src/unifiedProjectStore.ts`, `unifiedAssetFiles.ts`, `unifiedApi.ts`; `editor/packages/shared/src/index.ts` và validators liên quan; contract docs `commands-v1.yaml/project-v1.yaml` chỉ cập nhật theo implementation đã duyệt. Native validator/baker từ AC-00.
- Thêm handler `motion.edit` theo đặc tả: create-new khi thiếu motionId, clone-on-edit khi có; optional clipId rebind atomically. Reuse immutable blob/hash, exact revision, requestId/idempotence, history. Không thêm project database hoặc writer riêng.
- Đầu ra: MotionID, native edit blob + GLB sourceClip, evaluator/version/derivedFrom, affectedClipIds. Nếu server không bake được từ JSON/rig, xử lý seam AC-00; không âm thầm tin sample client.
- Test dự kiến: `S/test/nativeMotionEdit.test.ts` cho create, clone, optional rebind, rig mismatch, invalid/nonfinite/oversized input, missing asset, shortened duration, stale revision, retry, bake/storage failure, Undo/Redo và reopen.
- PASS: một commit hoặc không thay project; chưa có clip vẫn tạo được motion; input gốc bất biến; thất bại không mất draft; replay request không duplicate. FAIL: lưu file download ngoài project, mutate asset dùng chung hoặc history chỉ khôi phục nửa reference.

## AC-04 — Thư viện/clip dùng motion native

- Phụ thuộc: AC-03. File: `AnimationWorkspace.tsx`, `unifiedProjectStore.ts` handlers `motion.place/motion.binding.set/scene.apply`, shared validation, `LocalHostAdapter.ts` đường save/load; caller `document.replace`.
- Bỏ điều kiện “chỉ FBX” đúng chỗ và thay bằng capability/rig validation; không bỏ same-rig guard. Motion vừa tạo hiện tên người dùng, có action đặt/sửa. Existing clip edit giữ ClipID/CharacterID/timeline span và đổi riêng motion reference.
- PASS: hai Character/clip ban đầu dùng cùng motion; sửa clip A chỉ đổi A, B và source giữ nguyên. Tạo native motion mới rồi place, trim/speed/reverse/loop và reload hoạt động. Clone/delete/document.replace không bỏ native Motion/edit và không đưa reference cũ trở lại. Invalid duration/mismatch/locked actor bị từ chối.
- FAIL: UI liệt kê native motion nhưng API reject vì FBX-only; alias AssetID/MotionID; tự rebake mọi actor hoặc đổi motion đang dùng chung.

## AC-05 — Cùng edited motion cho WebGL và CPU

- Phụ thuộc: AC-04. File: `S/src/unifiedSkeletonEvaluation.ts`, host asset/library routes/resolver của motion hiện có, `LocalHostAdapter.ts`; `B/src/engine/io/AssetLoader.ts` và loader caller nếu public seam cần bổ sung. Không alias `builder/src` từ host.
- Resolver native nạp `Motion.sourceClip` derivative; model vẫn nạp asset nhân vật. Browser và CPU dùng cùng hash/clip index và rig mapping. Giữ clip-time/root-policy evaluator chung hiện có. Test dự kiến `S/test/nativeMotionEvaluation.test.ts` và builder evaluate test ở seam bị sửa.
- PASS: N4; pose frame0/15/30/45/60/89 + fractional + loop/trim boundary khớp native theo ngưỡng; FK/IK/easing đều được kiểm. Actor world transform áp một lần; skeletal/in-place đúng; unsupported trajectory trả lỗi rõ. Same-rig FBX playback/root regression vẫn qua.
- FAIL: editor riêng đúng nhưng Scene/export dùng original clip; CPU khác browser; scale100x; sai trục; root bị cộng hai lần; cache còn dùng derivative cũ sau Save/Undo.

## AC-06 — Bảo vệ draft và tích hợp workflow

- Phụ thuộc: AC-05. File: `StudioOverlay.tsx`, `AnimationWorkspace.tsx`, panel/hooks AC-01, locale host hiện có, `LocalHostAdapter.ts` lifecycle/history; không đổi Topview nội bộ.
- Hoàn thiện guard Lưu/Bỏ sửa/Ở lại, pending Topview key, host Undo so với local draft Undo, trạng thái đang lưu/thất bại, lỗi API mất kết nối/404/conflict. Clip selection cũ không được tự Apply sang clip mới. Tải file backup native khi cần khôi phục là thao tác rõ ràng, không tự công bố autosave draft đã tồn tại.
- PASS: switch/reopen giữ draft trong phiên; reload sau commit khôi phục native project; reload khi dirty có cảnh báo phù hợp browser; save fail không đóng editor; keyboard focus đúng; UI không tràn ba kích thước; đổi project hủy session cũ và không leak dữ liệu.
- FAIL: silently discard draft, autosave scene đè motion vừa commit, Undo xử lý hai lần hoặc nâng trạng thái “Đã lưu” trước khi transaction thành công.

## AC-07 — Export phải chứa native edit

- Phụ thuộc: AC-05 và AC-06. File: `S/src/unifiedFilmSampling.ts`, `unifiedSkeletonEvaluation.ts`, `filmPoseBake.ts`, `filmManifest.ts`, `unifiedJobs.ts`; `S/test/filmExportJob.integration.test.ts`. Model converter/Java worker hiện có giữ nguyên trừ lỗi được chứng minh do đường native motion.
- Dùng scene hai Character, một actor có native bone edit dễ nhìn, camera/range3giây. Export snapshot revision, sample20Hz; load output bằng reader hiện có và so với pose đã chỉnh, kiểm một clip không chỉnh làm đối chứng.
- PASS: N5, ZIP thật + hash/report; native edit hiện ở pose/Film data, nguồn không đổi; job lỗi thiếu derivative chặn thay vì fallback source. Runtime game chưa kiểm vẫn ghi riêng. FAIL: chỉ job completed/ZIP tồn tại hoặc chỉ codec parse mà không so pose.
- Phụ thuộc môi trường: Blender/Java và fixture skin/material theo pipeline hiện có; ghi path/version thật. Không tự chạy game/copy vào profile/thay mod để vượt blocker.

## AC-08 — Bàn giao demo có thể debug

- Phụ thuộc: AC-00–AC-07 PASS cho phạm vi fixture. File: mở rộng `S/scripts/unified-smoke.mjs`, diagnostic existing ở `S/src/devtools/`, evidence/STATUS/CHECKPOINTS và hướng dẫn khởi động. Không xây MCP server/debug platform mới.
- Evidence gồm version/hash code+source+fixture, project seed/cách tạo, revision/MotionID/edit hash/derivative hash, report N1–N5, ảnh/video thao tác, output package và lỗi còn mở. Không log asset bytes/credential. Nếu cần MCP dùng broker/server hiện có, không gọi CLI pass là live MCP pass.
- Chạy gate repo: từ editor `pnpm typecheck`, `pnpm lint`, `pnpm test:evaluate`, `pnpm build`, `pnpm --filter @topview/3d-studio test:offline`; thêm focused tests ở trên và browser/WebGL smoke. Ghi nguyên nhân test baseline lỗi, không tự đổi expected để qua. Python/renderer suite chỉ khi sửa các phần tương ứng.
- PASS: người dùng mở URL local, làm lại N1–N5 theo checklist; test/report truy về đúng build. Nếu tạo phiên bản Animation Studio mới: build/kiểm tra rồi tạo Site owner-private mới đúng version theo AGENTS; không ghi đè Site cũ và nói rõ backend local/Film/game không chạy được ở Site tĩnh.
- FAIL: chỉ screenshot UI, project mock, URL chưa chạy, mất runtime steps hoặc gọi toàn MVP hoàn tất khi Retarget/game gate chưa qua.

## Quy tắc tiến độ và bàn giao cho agent

- Ghi `Task AC: n/9 đã nghiệm thu` và `Runtime native: N1…N5 PASS/FAIL/NOT RUN`; đó là tiến độ phạm vi Animation, không phải % toàn dự án. Ban đầu 0 task được nghiệm thu; số này không có nghĩa 0% code toàn app.
- Giao demo sớm sau AC-02 (chỉnh trong phiên), AC-06 (lưu–mở–Scene), AC-08 (export/report); ghi rõ giới hạn từng mốc, không đợi full parity.
- Không cộng máy móc mẫu số APP16 cũ với N1–N5 vì có phần giao nhau. Khi triển khai đã được duyệt, lập ma trận D0–D4 ↔ N1–N5, tái dùng evidence đúng version/fixture; native N1–N4 trở thành điều kiện bổ sung bắt buộc của D2, N5 của D3.
- Sau AC-00/AC-01, báo ước lượng còn lại thành task đã có bằng chứng, blocker và phần chờ; nếu seam thất bại, cập nhật dự báo ngay. Chưa có cơ sở hứa hạn hoàn tất trước khi kiểm seam.
- Giữ code ngoài phạm vi và source/baseline. Không tự commit/push/publish/game. Phạm vi AC-00–AC-08 đã được người dùng duyệt; việc duyệt không tự đánh dấu acceptance/runtime PASS.

## Kết quả triển khai hiện tại — 2026-10-19 (cập nhật sau Film job runtime)

- Đã copy artifact Animation Studio 1.31.8 vào static assets; SHA-256 khớp source đã pin. Bridge cùng origin nối Character bytes, native edit JSON, dirty state và GLB export với Workspace 03.
- Đã thêm `motion.edit` dùng exact revision/history/idempotency hiện có, lưu native edit và GLB thành asset/hash bất biến; có thể tạo Motion mới hoặc clone-on-edit và tùy chọn rebind clip.
- Đã cho phép native motion trong placement; Scene GLTF loader giữ `gltf.animations`; WebGL MotionPlayer nạp GLB trong khi giữ FBX path cũ.
- `pnpm typecheck` PASS; Studio lint PASS; isolated browser runtime smoke PASS; `scene.evaluate` CPU sample PASS; native edit reload/reopen PASS; 554 Builder tests PASS, 1 skipped. `pnpm test:evaluate` vẫn FAIL vì `sceneBasis.test.ts` không khai báo Vitest suite. Next production build dừng ở EPERM khi quét `C:\Users\Administrator\AppData\Local\Application Data`; production offline smoke do đó không thể chạy từ build mới.
- Demo cô lập mới nhất: `http://127.0.0.1:3117/?unified=6b432023-754a-4ba2-9176-0684761de9c7`; FBX hash `0c3fd77e693707a1f6c99da95070d482c568b3b91d1f9a060f3b5b53db77768d`, Character `6e344413-0278-453f-af28-a0bbc489faa3`, Motion `e2c92c71-9ee9-4219-81be-b2c240dc6667`, clip `user_mc_gfoygxm9`. Runtime smoke ghi 132 keys và đổi Spine pose; CPU frame 0→45 quaternion dot `0.9794477746581245`; GLB tải 200 và ảnh viewport WebGL đổi khi phát; đặt clip Undo/Redo, reload/reopen PASS; browser errors 0. Server dùng storage cô lập.
- Film runtime (project cô lập `6b432023-754a-4ba2-9176-0684761de9c7`): sequence `sequence_1`/shot `runtime-film-shot`, preflight PASS với 61 samples; job `0fb992b7-5ee3-480a-8e26-636d0a56b362` PASS. Blender 4.2.3 LTS + Microsoft OpenJDK 17.0.20.1; tải ZIP HTTP 200, 1,112,711 bytes, SHA-256 `dd4148b4815620b30a809af46f99f72df9ae1146f28231436c836b75915d0ca7`, ZIP CRC PASS, report `nativeReadback: true`, 65 pose tracks. Giải nén/đọc lại native `.dat` bằng BbsCodec xác nhận kênh `bone1` có 61 key và rotation biến thiên từ gần 0 đến `-0.8123647` radians; source FBX hash giữ nguyên. Chưa chạy trong Minecraft hoặc mở/lưu lại bằng Film Editor.
- Runtime native: N1 partial, N2 partial, N3 partial, N4 partial, N5 PASS. `Task AC: 1/9 đã nghiệm thu` (AC-07); các AC còn lại cần parity số CPU/WebGL, IK/graph/easing, clone isolation/history conflict và lifecycle/draft/browser evidence.
- Giới hạn: GLB names chuẩn hóa về Character profile, nhiều skin union joints có structural checks; derivative vẫn do iframe tạo, chưa có server-side rebake. Chưa xác minh WebGL/CPU parity nhiều frame, hai Character isolation, ZIP thật/Film readback hoặc BBS game.

## Cập nhật 2026-10-20 — sửa lỗi lưu GLB native

- Smoke isolated trên `127.0.0.1:3120` chạy PASS từ import FBX đến lưu native Motion, placement, CPU evaluation, tải WebGL, phát, Undo/Redo, clone-on-edit hai Character và reload/reopen. Smoke đồng bộ bằng cách đợi rig T-Pose thực sự nạp xong trước khi ghi key; điều kiện cũ chỉ chờ iframe `ready` và có thể chạy trên rig mẫu trước khi lệnh host hoàn tất.
- Root cause: GLTFExporter nhận một scene root không tên và sinh channel nhắm tới node không tên; `motion.edit` từ chối derivative với `PROFILE_MISMATCH`. Export copy nay đặt tên fallback `AuxScene` cho wrapper root theo allowlist validator sẵn có; tên bone hiện hữu giữ nguyên. Không đổi API/schema.
- Bằng chứng sample: project `071f1988-46ba-46c9-8972-e7d408fc0723`; Motion `63d53e47-38d9-4a58-8ffe-5eaf17098bab`; edited clone `faaa063b-85d5-4cc7-8a80-69ae1e22396b`; clip `user_mc_u5c6e131`; 132 keys; Spine CPU rotation dot frame0↔45 `0.9794477746581245`, CPU↔native pose frame89 `0.9999898158102627`; CPU↔GLB `AnimationMixer` quaternion dot at frames 0/45/89 = `1.0000000000000004/1/1`; native Undo/Redo, draft workspace switch, placement Undo/Redo and shared Motion isolation PASS; derivative GLB HTTP 200; viewport changed during playback; browser errors 0.
- AC-05 remains Partial: exact sampled local-bone parity is proven at three integer frames; fractional time, loop/trim boundaries, root trajectory and IK/easing parity remain open. Existing AC-07 remains the only accepted task: **1/9**.
- Latest evidence is recorded in `docs/evidence/native-animation-runtime-smoke.yaml`; the debug smoke server used isolated project storage and is stopped after the run.
