# Thiết kế MCP cục bộ cho App 3 — đề xuất v1.0.0

Ngày: 2026-10-21. Nhánh: `ai2/app3-mcp-design`.
Nguồn đối chiếu: commit `58afbcc` của `main`. TASK-4 chỉ tạo tài liệu này, không triển khai code.

## 1. Phạm vi và hiện trạng đã đối chiếu

App 3 là Animation Studio nhúng trong iframe của Studio. Mục tiêu là cho AI đọc và tạo bản sửa động tác
của nhân vật được chọn qua broker cục bộ, giữ preview → apply theo revision và một bước Undo.
Không thay đổi chức năng giao diện, không bỏ hàm/id, không kiểm hoặc sửa nhập Warcraft.
Đọc cùng `CLAUDE.md`, `DECISIONS.md`, `APP3-REVIEW-2026-10-21.md` và TASK-4 trong
`AI-TASKS-2026-10-21.md`.

Phân biệt ba trạng thái:

- **Có thật trong nguồn:** các hàm/bộ xử lý dẫn ở mục 2–4, API `window.__studio.director` và
  `window.__studio.scene`. Chưa có nghĩa MCP cục bộ gọi được chúng.
- **Chưa có:** đăng ký session App 3 ở broker local, hàng đợi tới iframe, lệnh postMessage cho Director,
  nhận/trả gói shot TASK-2 và export GLB hợp đồng kèm UUID/manifest.
- **Đề xuất:** tất cả tên lệnh `app3.*`, endpoint, capability và mã lỗi trong tài liệu này. Chưa được
  thêm vào enum `SUPPORTED_COMMANDS` hoặc hiện trong tools/list; chỉ mở công cụ sau khi broker thực thi được.

`studio_bridge.js` hiện là **transport HTTP của bản Sites**, không phải bộ xử lý lệnh: `StudioBridge.connect`,
`request`, `poll`, `disconnect` gọi `/api/studio/…`; `poll` chuyển tiếp `this.api.call(tool,args)` và
cache 100 kết quả theo command ID. `setupDirector()` tạo bridge với `{context: directorContext, call: directorCall}`.
`window.__studio.director.call` đã trỏ tới `directorCall`, còn `directorCall` chuyển sáu lệnh scene tới `sceneCall`.

`host-bridge.js` local hiện chỉ nhận `open`, `save`, `saved`, `active`, `ping`; dùng channel
`bbs-animation-studio-v1.31.8`, kiểm origin/source/requestId và chờ `window.__studio.ready` tối đa 30 giây.
Không có handler Director hay broker push tới iframe. Bản build ghép `director_controller.js` và
`scene_controller.js` sau `app.js`; không cần chuyển thuật toán Director sang Python hoặc server.

## 2. Bản đồ nguồn để người điều phối dò lại

Các đường dẫn dưới đây tính từ gốc repo. Trong bảng lệnh dùng ký hiệu ngắn ở cột đầu.

| Ký hiệu | Tệp có thật | Hàm/API có thật cần đọc |
| --- | --- | --- |
| W | `three-workspace-app/animation-studio/work/material_alpha_v1_31_8/mcp_worker.js` | `tools`, `callTool`, `result`, `createWorker`; schema của 23 operation và 3 công cụ hạ tầng |
| B | `three-workspace-app/animation-studio/work/material_alpha_v1_31_8/src/studio_bridge.js` | class `StudioBridge`: `connect`, `request`, `poll`, `disconnect` |
| D | `three-workspace-app/animation-studio/work/material_alpha_v1_31_8/src/director_controller.js` | `directorRevision`, `directorContext`, `directorGuard`, `directorCheckRevision`, `directorStage`, `directorApply`, `directorCancel`, `directorCall`, `setupDirector` |
| A | `three-workspace-app/animation-studio/work/material_alpha_v1_31_8/src/animation_director.js` | `blocking`, `setPose`, `breakdown`, `retime`, `hold`, `smooth`, `patch`, `analyze`, `metadata`, `ids` |
| S | `three-workspace-app/animation-studio/work/material_alpha_v1_31_8/src/scene_controller.js` | `sceneRevision`, `sceneContext`, `sceneHeartbeat`, `sceneStage`, `sceneCall`, `sceneCancelPending`, `sceneHistoryPush`, `sceneUndoAction`, `sceneExport`, `setupSceneStudio` |
| M | `three-workspace-app/animation-studio/work/material_alpha_v1_31_8/src/scene_studio.js` | `operation`, `summary`, `validate`; mutation map trong `operation` |
| Z | `three-workspace-app/animation-studio/work/material_alpha_v1_31_8/src/scene_package.js` | `build`, `sample`, `glb`, `safeName` |
| P | `three-workspace-app/animation-studio/work/material_alpha_v1_31_8/src/app.js` | `commit`, `restoreHistory`, `buildGLB`, `buildDirectAnimation`, `exportSkeleton`; API `window.__studio` có `exportCapture`, `serialized`, `installAsset`, `loadProject`, `setHostActive` |
| H | `three-workspace-app/editor/apps/studio/public/animation-studio/v1.31.8/host-bridge.js` | IIFE nhận message qua `addEventListener`; hàm `waitForStudio`, `reply`; các nhánh open/save/saved/active/ping |
| U | `three-workspace-app/editor/apps/studio/app/workbench/components/animation-creation/index.tsx` | component `AnimationCreationPanel`; `receive`, `request`, `openEditor`, `saveMotion` |
| R | `three-workspace-app/editor/apps/studio/src/unifiedProjectStore.ts` | `executeUnifiedCommand`, `getRequestResult`; xử lý `motion.edit` và shared history |
| HTTP | `three-workspace-app/editor/apps/studio/app/api/unified/commands/route.ts` | `POST`, `readJsonLimited`; `validateLocalRequest` ở `src/unifiedSession.ts` |
| PY | `three-workspace-app/agent/unified_mcp.py` | `SUPPORTED_COMMANDS`, `TOOL`, `run_unified_command`, `_tool_call`, `handle_message` |
| CLI | `three-workspace-app/agent/unified_cli.py` | `local_base`, `open_session`, `command`, `save_render_files` |

Không có hàm riêng tên `set_marker`, `set_idea`, `edit_curves` trong A: chúng là nhánh switch của `patch`.
Tương tự apply scene là nhánh của `sceneCall`, không tồn tại hàm tên `applyScenePatch` để gọi thẳng.

## 3. Quy ước đọc bảng lệnh

Cột đầu vào mô tả tham số nghiệp vụ hiện tại của W; `?` nghĩa là tùy chọn. W thêm `sessionId`,
`expectedRevision` kiểu **chuỗi của editor** và `idempotencyKey?`; các công cụ read-only không bắt buộc revision.
Ngoại lệ hiện tại: `preview_patch`, `cancel_patch` không bắt buộc expectedRevision;
`cancel_scene_patch` có revision bắt buộc ở worker nhưng nhánh `sceneCall` chưa tự kiểm nó.

Cột đầu ra là **value thực tế trong iframe**, trước khi Sites bọc ticket. Ở Sites, mọi operation đi qua
`{commandId,status:queued}` → `get_command_result` → `{status:done,result:{ok,value}}` hoặc lỗi.
Các lệnh tạo candidate không tự ghi vào project, kể cả `set_idea`/`set_marker` qua MCP.

Cột sửa nguồn: **Nối** = cần bổ sung adapter local tại H/U/broker/PY và transport B, tái sử dụng handler hiện tại;
**Bọc** = thêm chốt an toàn ở adapter, không sửa thuật toán A/P; **Hoãn** = chưa expose trong MVP shot.
Mọi sửa nguồn được nhắc ở đây là việc tương lai, không được thực hiện trong TASK-4.

## 4. Từng lệnh hiện có và cách đưa về local

| Lệnh | Đầu vào nghiệp vụ | Đầu ra thực tế | Hàm thực thi có thật | Có cần sửa nguồn khi triển khai? |
| --- | --- | --- | --- | --- |
| `create_blocking` | `markers[2..128]` gồm time/label, id?/kind?/locked?; `idea?` tối đa 4000 ký tự; đầu 0, cuối bằng duration | Candidate `{patchId,baseRevision,summary,markers}` | D `directorCall` → `directorStage`; A `blocking`; P `snapshot`/`C.evaluate`/`C.capture` qua callback | Nối; giữ sampling và FK Step. Bọc chặn retime vượt duration shot. |
| `set_pose` | `time` giây; `transforms` theo bone ID, mỗi bone có p[3], q[4], s[3]; `interpolation?` step/linear/auto/cubic/smooth | Candidate như trên | D `directorStage` → A `patch` → `setPose` | Nối; thêm kiểm editable character và đổi đơn vị tại adapter shot. |
| `insert_breakdown` | `time`, `boneIds`; `label?`, `fraction?` 0..1, `offsets?` vector local theo bone | Candidate như trên | A `patch` → `breakdown` qua D `directorStage` | Nối; giữ locked pose và Euler winding. |
| `retime_segment` | `markerId`, `time` giây | Candidate; marker/key và slope được retime | A `patch` → `retime` qua D | Nối; Bọc không thay frameRange shot. Mốc cuối làm đổi duration thì từ chối trong shot mode. |
| `set_hold` | `markerId`, `duration` giây | Candidate, kéo dài clip và dời key sau marker | A `patch` → `hold` qua D | Nối trong standalone; Hoãn trong shot mode vì hiện làm tăng duration, cần range policy chốt trước. |
| `set_marker` | `markerId`; `label?`, `locked?`, `kind?` pose/contact/breakdown/hold | Candidate như trên | A `patch`, nhánh `set_marker` → A `validate`; D `directorStage` | Nối; không gọi `directorAction('marker')` vì UI tự apply ngay. |
| `set_idea` | `idea` tối đa 4000 ký tự | Candidate, notes trong metadata | A `patch`, nhánh `set_idea`; A `metadata`; D `directorStage` | Nối; không tạo animation từ prompt, không gọi UI action tự apply. |
| `smooth_motion` | `boneIds`, `start`, `end`; `method?` filter/auto/cubic, `strength?` 0..1, `window?` 1..12, `channels?` p/q/s | Candidate như trên | A `patch` → `smooth` → `C.smoothing.processTracks`; D | Nối; không hứa giải IK, va chạm hoặc foot sliding. |
| `edit_keyframes` | `refs[]` gồm id/time/kind=keys; `action` move/copy/delete; `targetTime?` (cần với move/copy) | Candidate như trên | A `patch`, nhánh `edit_keyframes` → `C.editKeyframes`; D | Nối; adapter phải validate targetTime có số hữu hạn khi action cần, khóa marker/collision vẫn ở core. |
| `edit_curves` | `boneId`, `path` p/r/s, `axis` 0..2, `times[]`; `type?` linear/step/auto/smooth/spline/break/unify, `side?` in/out/both, `slope?` | Candidate như trên | A `patch`, nhánh `edit_curves` → `C.graphCurves.handle` hoặc `tangent`; D | Nối; yêu cầu type khi không có slope; r là Euler XYZ độ, cần Euler curves có sẵn; giữ Spin. |
| `read_keyframes` | `boneIds?`, `start?`, `end?` giây | `{revision,tracks}`; tối đa 2000 key, mặc định bone được chọn | D `directorCall`, nhánh `read_keyframes`; A `ids`; `C.clone` | Nối; trước khi gọi phải ready và có rig/project; giới hạn payload. |
| `analyze_motion` | `boneIds?`, `start?`, `end?`, `samples?` nguyên 4..600 | `{space,sampleRate,results,note}`; tốc độ local, biến thiên tốc độ, gap hai đầu position/rotation | D `directorCall` → A `analyze` | Nối; gói trả local bổ sung animationRevision lấy từ context vì raw value chưa có revision; Lab bị chặn. |
| `preview_patch` | `patchId`, `original?` boolean | `{patchId,summary,showing,time}` | D `directorCall`, nhánh `preview_patch`; `C.evaluate` | Nối/Bọc kiểm session epoch/revision; bản hiện tại tự kiểm pending.id và pending.before. |
| `apply_patch` | `patchId`, revision chuỗi | `{applied:true,revision,undoSteps:1}` | D `directorCall` → `directorApply` → P `commit` | Nối; serialize trong hàng đợi một writer, dedupe để không apply/Undo hai lần. |
| `cancel_patch` | Không có tham số nghiệp vụ | `{cancelled:true}` | D `directorCall` → `directorCancel`, dùng `directorRestore` khi revision/slot còn khớp | Nối/Bọc: local thêm patchId + revision để cancel cũ không hủy preview mới; không tạo bước Undo. |
| `undo_animation` | revision chuỗi | `directorContext()` sau restore | D `directorCall` → `directorCancel` → P `restoreHistory(historyIndex-1)` | Nối/Bọc: phát hiện không còn history để trả NOTHING_TO_UNDO; không nhầm với Undo project App 2. |
| `export_animation` | `format` bobj/fbx; revision chuỗi | `{filename,format,encoding,data}`; bobj=text, fbx=base64 | D `directorCall` → P `buildDirectAnimation` → `buildGLB`; P `safeName` | Nối cho standalone export; thay download URL R2 bằng artifact local. Không coi đây là export GLB hợp đồng TASK-2. |
| `get_scene_context` | Không có tham số nghiệp vụ | `{revision,scene,time,playing,editing,pending}` | D `directorCall` → S `sceneCall` → `sceneContext`; M `summary` | Nối read-only; dùng sceneRevision, không dùng animationRevision. Không tự mở scene. |
| `preview_scene_patch` | `operation`, `parameters`; revision scene | `{patchId,baseRevision,summary,scene}` | D → S `sceneCall` → `sceneStage` → M `operation`; nhánh add_actor dùng `scenePrepare` | Nối ở standalone; Hoãn ghi scene khi đang nhận shot App 2. Giữ nguyên 11 operation được liệt kê dưới bảng. |
| `apply_scene_patch` | `patchId`, revision scene | `sceneContext()`; không có raw field undoSteps | S `sceneCall`, nhánh apply → `sceneHistoryPush`, `SceneStudio.validate`, tăng revision/epoch | Nối ở standalone; local có thể báo undoSteps=1 sau xác nhận; Hoãn trong shot mode. |
| `cancel_scene_patch` | Không có tham số nghiệp vụ, worker yêu cầu revision scene | `{cancelled:true}` | S `sceneCall` → `sceneCancelPending` → `syncScenePreview` | Nối/Bọc kiểm patchId + revision trước cancel; hủy actor runtime tạm nếu có; Hoãn trong shot mode. |
| `undo_scene` | `redo?` boolean; revision scene | `sceneContext()` mới | S `sceneCall` → `sceneUndoAction` | Nối ở standalone; Hoãn trong shot mode; giữ history riêng 30 bước, không gọi project history. |
| `export_scene` | `includeFbx?` boolean; revision scene | `{filename,format:zip,encoding:base64,data,report}`; raw MCP giới hạn 17 MiB | S `sceneCall` → `sceneExport` → Z `build` | Hoãn trong MVP shot: đây là ZIP BOBJ/layout cũ, không phải result.json hoặc film BBS của App 2. UI cũ vẫn giữ. |

11 operation của `preview_scene_patch`: `add_actor`, `set_actor`, `add_clip`, `move_clip`, `delete_clip`,
`add_marker`, `set_marker`, `retime_marker`, `add_contact`, `add_library_item`, `apply_template`.
Tham số từng operation giữ validator của M `operation` và S `sceneStage`; riêng add_actor trong MCP hiện
**clone actor có sẵn**, không phải bộ nhập file tùy ý. Không đồng nhất scene marker với Director marker.

Ba công cụ hạ tầng W cũng cần có cách thay thế local:

| Lệnh | Đầu vào | Đầu ra hiện tại | Nguồn hiện tại | Đề xuất local / có cần sửa? |
| --- | --- | --- | --- | --- |
| `list_studio_sessions` | Không có | `{sessions:[{sessionId,name,revision,updated}]}` | W `callTool`, đọc R2 active/meta; B `connect` tạo phiên | Có: registry local thay R2; thêm projectId, characterId, mode, ready, active, epoch, capabilities. |
| `get_animation_context` | `sessionId` | `directorContext` cộng sessionId/updated | W `callTool`; B gửi context; D `directorCall` → `directorContext` | Có: đọc tươi qua iframe; trả rõ tuổi heartbeat, animationRevision và shot identity. |
| `get_command_result` | `sessionId`, `commandId` | pending/done/expired; kết quả export được đổi thành URL download riêng | W `result`; B `poll` gọi handler và gửi result | Có: kho kết quả local có TTL, xác thực cùng project/session/epoch; chỉ thành công khi done và result.ok=true. |

## 5. Đường đi cục bộ đề xuất

Không giữ R2 làm dependency local. Luồng yêu cầu là:

1. MCP Python `unified_mcp.py` qua `run_unified_command` → CLI `local_base`/`open_session`/`command` →
   HTTP `POST /api/unified/commands` → broker Studio. Dùng session cookie và kiểm loopback/origin hiện có;
   không mở cổng public hoặc dùng Sites identity header cho localhost.
2. Broker tra registry App 3 do **host React đã mount iframe** đăng ký. Đề xuất registry gắn
   `(projectId, sessionId, epoch, characterId, shotId?)`; cookie phiên HTTP không được dùng làm character identity.
   Host đăng ký sau `bridge-ready` rồi ping/ready thành công; chọn đúng session, không chọn ngẫu nhiên giữa tab.
3. Server không có `window` để tự postMessage. Cần hàng đợi broker local; host nhận command bằng poll/SSE có
   heartbeat và session lease. Đề xuất poll 1–1.5 giây ở MVP để gần cơ chế B hiện tại; chưa có endpoint này.
4. U `AnimationCreationPanel` gửi command cho iframe qua H bằng postMessage có requestId. Thêm message type
   **đề xuất** `director-command` và `director-context`; giữ toàn bộ type cũ. Thời hạn chờ tối đa 30 giây là
   mặc định transport, export dài chạy job có progress/cancel riêng thay vì treo vô hạn.
5. H kiểm `event.origin === location.origin`, `event.source === parent`, channel/version, requestId và schema;
   chờ ready. Chuyển command sang B qua một entry adapter local **cần bổ sung**, tái dùng đối tượng
   `window.__studio.director.bridge()` và `this.api.call`. Entry này gọi D `directorCall` như B `poll` đang làm.
   Có thể fallback dispatch trực tiếp `window.__studio.director.call` khi capability cho phép; không giả định
   `StudioBridge` hiện đã có handler postMessage. Chọn một dispatch path, tránh execute hai lần.
6. Iframe trả kết quả qua H `reply` → U `receive` → broker ghi result, context, revision mới → MCP poll ticket.
   Chuyển binary thành artifact handle/file local; không nhét GLB/ZIP base64 vào phản hồi text của MCP.

Ưu tiên adapter/additive entry trong B/H và broker; không chép lại blocking/smoothing/curve logic A.
Không tự gọi `StudioBridge.connect()` bản Sites khi iframe local khởi động, vì Studio không có
`/api/studio/sessions` mailbox. Giữ bản Sites như transport riêng để không làm hỏng tính năng cũ.

### Đề xuất namespace broker và envelope

Giữ MCP tool `bbs_unified_command` hiện có, thêm nhóm command khi thực thi xong:
`app3.session.list`, `app3.context.get`, `app3.command.submit`, `app3.command.result`.
Submit có `tool` là một tên ở mục 4; sessionId/epoch/characterId là tham số được kiểm ở broker,
không truyền trực tiếp vào core. Tất cả API mới đều nằm trong host, không thêm fetch vào packages/builder.

- `requestId` UUID của broker là khóa idempotency cho submit/retry; cùng ID và cùng payload trả cùng ticket,
  cùng ID khác payload trả REQUEST_ID_CONFLICT. Poll mới dùng requestId mới để không bị cache phản hồi pending.
- `expectedRevision` số nguyên ở envelope là revision project App 2, giữ đúng kiểu hiện tại.
  `args.expectedAnimationRevision` hoặc `args.expectedSceneRevision` là chuỗi của D/S; adapter chuyển chuỗi
  tương ứng thành `expectedRevision` của `directorCall`/`sceneCall`. Không ép chuỗi D thành số project.
- Với submit sửa editor, cần guard project ở lúc nhận và recheck session/epoch/character/editor revision lúc
  thực thi; không tự tăng project revision khi chỉ preview/apply trong native editor chưa lưu.
- Chỉ `motion.edit` hoặc lệnh apply result mới làm transaction thay project App 2; kiểm lại revision số
  ở lúc commit. Thay đổi UI concurrent phải làm apply/export cũ bị từ chối.
- `dryRun` mới chỉ kiểm schema/capability/định danh/revision, không dispatch mutating/preview/export qua iframe.
  Với preview phải dùng tool staging thực sự; không gọi dryRun là đã tạo candidate.

### Preview, apply, Undo và idempotency

D `directorStage` tạo candidate từ clone/sampling, giữ snapshot, chưa gọi P `commit`; `directorApply` chỉ
nhận đúng patchId, base revision và editor slot, rồi gọi `commit` đúng một lần. D `directorRevision` phụ thuộc
JSON project, root UUID, editor slot, bank, activeRoot và units. Không dùng nó thay SHA-256 hoặc project revision.
`directorCancel` có thể là no-op nếu không còn pending; `restoreHistory` ở biên cũng có thể no-op.

Cơ chế local giữ các tính chất này, nhưng bổ sung:

- Một command đang thực thi mỗi session; revision kiểm ngay trước gọi handler. Không chạy hai apply song song.
- Một animation candidate và một scene candidate tồn tại riêng trong nguồn. Trong shot mode cho tối đa một
  candidate sửa tại một thời điểm và khóa scene mutation; không tự đồng nhất hai loại patchId.
- Bản hiện tại stage mới tự cancel pending cũ. Local mặc định trả PATCH_PENDING; muốn thay phải cancel đúng
  patchId/revision trước, tránh ghi đè phần người dùng vừa review. Preview result phải có summary và context
  sau stage; AI chỉ apply patch đã review, không gộp preview và apply trong một tool tự động.
- Guard cho preview/cancel được làm chặt hơn Sites: session epoch + patchId + revision; scene cancel hiện thiếu
  check nội bộ, nên adapter phải kiểm. Apply lặp cùng commandId trả kết quả cache, không thêm history.
- Dùng journal commandId/result và cache ở receiver để retry sau mất reply không chạy lần nữa. Sau reload đổi
  epoch, command cũ trả SESSION_REPLACED/COMMAND_OUTCOME_UNKNOWN; không tự replay mutation đã dispatch.
  Dedupe cache 100 phần tử của B một mình chưa đủ bảo đảm qua restart.
- Undo animation dùng `restoreHistory`, Undo scene dùng `sceneUndoAction`; Undo project dùng broker history.
  Apply trong editor là một bước history native; lưu vào App 2 là transaction history riêng. Không hứa Undo
  nguyên tử xuyên hai lịch sử. Undo sau lưu cần lệnh tương ứng, không âm thầm xóa derivative đã lưu.

### Khi tab App 3 không mở, bị ẩn hoặc reload

- Không mount/không đăng ký session: APP3_NOT_OPEN; hướng dẫn mở tab Animation và nạp nhân vật. Không tự mở
  editor hoặc thay model có draft. Registry rỗng trả sessions=[]; context không giả thành ready.
- Có iframe nhưng chưa ready: APP3_NOT_READY; không gọi handler trước khi rig/project sẵn sàng.
- Tab App 3 bị ẩn: P `setHostActive(false)` dừng vòng render, không đồng nghĩa iframe đã đóng. Host báo
  active=false. Đọc context vẫn được nếu ready; preview/apply trả APP3_INACTIVE cho đến khi người dùng mở tab
  để xem, không tự bật render gây tải hoặc tự apply khi người dùng không quan sát.
- Host đóng/reload/quá heartbeat TTL 120 giây (đề xuất, lấy mốc Sites): thu hồi lease, expire pending ticket.
  Command chưa dispatch có thể kết thúc APP3_OFFLINE; đã dispatch nhưng mất reply thì outcome unknown,
  bắt buộc đọc lại context/history trước quyết định tiếp. Command lease mặc định 60 giây như Sites;
  export lớn chuyển job riêng, không dùng cùng timeout ngắn.
- Dirty/draft, sourcePreview, compare mode hoặc đang kéo gizmo: giữ `directorGuard`, trả lỗi có thể xử lý được;
  không auto ghi key/hủy draft/đổi nhân vật. Không biến read-only get_scene_context thành thao tác mở scene.

## 6. Giữ, hoãn và những ranh giới của luồng 3 app

| Nhóm | Quyết định local MVP | Lý do |
| --- | --- | --- |
| 10 lệnh tạo/sửa candidate animation (create_blocking đến edit_curves trong bảng) | Giữ; riêng set_hold hoãn trong shot mode | Core đã có; cần wrapper và range guard, không cần R2. |
| Đọc context/key/analyze, preview/apply/cancel/undo | Giữ | Là chu trình AI review → commit, không thay người dùng bằng auto-apply. |
| BOBJ/FBX export standalone | Giữ sau khi có artifact local | Codec là local; chỉ URL download/private mailbox phụ thuộc Sites. Không thêm Warcraft. |
| R2 BUCKET, Sites user headers, controller token Sites, URL `/api/studio/download/...` | Không đưa vào local | Transport cloud được thay bằng broker session cookie/registry/queue và file handle; không xóa bản Sites. |
| get_scene_context | Giữ read-only để xem actor/timeline | Scene Studio cũ khác shot TASK-2; cần adapter rõ ràng. |
| 5 lệnh ghi/Undo/export scene còn lại | Hoãn expose trong shot mode; giữ toàn bộ UI standalone | App 2 sở hữu cảnh/camera/nhân vật khác; export_scene không phải film BBS/FS của App 2. |
| Tạo chuyển động bằng AI từ ý tưởng, IK va chạm/foot-lock tự động | Không quảng cáo như capability hiện có | set_idea chỉ ghi chú; analyze/smooth không chứng minh chất lượng hình ảnh. |

Trong `preview_scene_patch`, camera không nằm trong 11 operation hiện tại; không tự thêm set_camera vào
schema hiện có và không nói App 3 đã sửa camera qua MCP.

## 7. Lệnh cần thêm để nhận/trả gói shot TASK-2

Ở commit đọc cho TASK-4, `docs/SHOT-PACKAGE-CONTRACT.md` và `agent/shot_package.py` **chưa có trên main**.
TASK-2 đã được bàn giao riêng; cần review và tích hợp trước khi dùng làm dependency. Các field dùng dưới đây
bám TASK-2; các lựa chọn wire format cụ thể phải khớp bản hợp đồng được Claude chấp nhận.
Không copy module TASK-2 vào TASK-4, không nhận định rằng round-trip đã chạy được.

| Lệnh đề xuất, chưa có | Đầu vào / đầu ra đề xuất | Điểm tái sử dụng và phần còn thiếu |
| --- | --- | --- |
| `app3.shot.open` | Vào: projectId, session/epoch, package handle của broker, shotId/baseShotSha256, characterId, revision số App 2. Ra: ready/context, shot identity/hash, actionUuid, mapping bone ID và capability | Python validator TASK-2 kiểm gói trước; H open → P installAsset/loadProject là nền. Cần adapter chọn Action theo manifest/UUID, không theo index 0; dựng camera/nhân vật tham chiếu read-only. Dirty editor phải chặn, không tự bỏ sửa. |
| `app3.shot.context` | Vào session/epoch. Ra frameRange, fps=30, camera, selected editable character, clip source range/speed/loop/reverse, rootPolicy, placement, originalActionUuid, hai revision và pending patch | D directorContext và S sceneContext chỉ là nguồn trạng thái hiện có. Cần thêm shot metadata và binding ID; không coi sceneProject cũ là shot.json. |
| `app3.shot.placement.preview` | Vào characterId, placementKeys tuyệt đối, expectedAnimationRevision/shot edit revision, hash shot gốc. Ra patchId/baseRevision/summary/key range | Cần adapter shot mới, không dùng set_actor trên scene camera/actor khác; kiểm frame tăng dần trong frameRange, position mét/yaw độ. Candidate pose và placement phải commit/Undo cùng một bước trong shot edit state. |
| `app3.shot.result.export` | Vào shot identity/hash, expectedAnimationRevision và shot edit revision, danh sách nhân vật sửa được đã apply; ra artifact handle chứa result.json + GLB mới + manifest, hash các file, UUID mới và UUID gốc | P exportCapture/buildGLB chỉ là điểm lấy animation; chưa đạt GLB contract tự động. Cần bake 30 FPS, chọn Action/rig65 không prefix, Y-up/mét, UUID derivative/manifest, sha256, placementKeys và TASK-2 validate_result. Chỉ xuất đã apply, không xuất pending candidate. |
| `app3.shot.result.apply` | Vào result artifact, projectId, expectedRevision số của App 2, baseShotSha256, requestId. Ra transaction revision, derivative motion UUID, clip/binding đã cập nhật | Broker R xử lý motion.edit là nền lưu native+derivative hiện có. Cần transaction đổi clip sang UUID mới, giữ Action cũ, nhận placement và kiểm shot gốc chưa đổi; UUID/schema mới không được giả là đang được motion.edit hỗ trợ nguyên vẹn. |

Các lệnh placement dùng cùng preview/apply/cancel của adapter shot được capability negotiation công bố;
không đưa patch chưa được core nhận biết vào D `directorApply` rồi mong core tự lưu metadata mới.
Trong giai đoạn đầu chỉ một editable character mỗi phiên; nhiều nhân vật sửa được có session/editor state riêng,
result tập hợp theo characterId, không lấy nhầm editor A/B hoặc rig đang active. Nhân vật khác và camera chỉ xem.

### Các chuyển đổi và điểm chưa chốt phải công khai

- Director dùng **giây local trong editor** và `p/q/s` theo đơn vị model; shot dùng frame tuyệt đối ở 30 FPS,
  placement theo mét/yaw độ, GLB trao đổi Y-up. Không gửi frame làm time hoặc gửi position thế giới cho set_pose.
  Adapter chọn bake đoạn shot vào clip chỉnh 0..T ở 30 FPS; T=(end-start)/30. Nguồn được lấy mẫu theo source
  range/speed/loop/reverse; kết quả GLB playback đơn giản speed=1/loop=false/reverse=false để tránh áp clip cũ
  lần hai. Cách ghi clip thay thế cần App 2 xác nhận trong integration; TASK-2 chưa định nghĩa hết mapping này.
  Range chỉ một frame có T=0: buildGLB hiện từ chối end<=start. MVP export báo STATIC_SHOT_UNSUPPORTED
  cho đến khi có đường bake pose tĩnh được kiểm riêng; không tự kéo dài shot để vượt qua giới hạn.
- Dựng camera từ lookAt/FOV của gói shot qua viewport adapter; scene Studio cũ có quy ước riêng, không dùng
  transform của nó để suy ra yaw/Y-up một cách ngầm định. Mọi conversion có test bằng số và log đơn vị.
- P buildGLB hiện theo project.fps, UI axis/range/units/target/skin và xuất một AnimationClip;
  exportCapture hiện chỉ thêm base64. Chưa bảo đảm canonical65, tên không prefix hoặc UUID/manifest.
  Contract export phải cấu hình độc lập UI, preflight rig, phục hồi mọi trạng thái UI/editor sau export;
  báo CONTRACT_UNSUPPORTED thay vì tự retarget (App 1 phụ trách) khi rig không khớp.
- **Đề xuất chưa chốt:** vị trí sửa ghi vào placementKeys, root Action giữ như cũ để tránh cộng hai lần.
  `set_pose` tới root trong shot mode phải bị chặn hoặc giới hạn bởi policy được chốt; không vừa bake cùng
  displacement vào root vừa cộng placement. Root edit hợp lệ về động tác và placement edit cần phân biệt rõ.
  Chưa implement và không tự sửa DECISIONS.md để biến đề xuất thành quyết định.
- Import/export dùng broker-owned package/artifact handle, không để iframe/MCP tự đọc đường dẫn tùy ý.
  Mọi đường dẫn/hash/UUID/readonly/baseShotSha256 đều được validate; metadata không thay thế kiểm GLB thật.
  Không trả đường dẫn tuyệt đối, token hoặc base64 lớn trong context; file tải qua endpoint local được xác thực.

## 8. Danh sách test phải viết khi triển khai code

Các tên bên dưới là **ca test đề xuất**, chưa phải file/test đang có. Dùng fixture tự tạo hoặc dữ liệu hợp lệ
đã có trong repo; không thêm mẫu game/binary vào commit. Không ghi PASS cho test chưa chạy.

| Nhóm test | Ca bắt buộc và kết quả mong đợi |
| --- | --- |
| Schema MCP | Có đủ 26 tên hiện tại khi capability tương ứng đã triển khai; chặn command chưa hỗ trợ, unknown field, wrong type, NaN/Infinity, vượt giới hạn markers/bones/refs/times/payload. move/copy thiếu targetTime, curve thiếu type/slope bị từ chối. |
| Python → broker | Reuse open_session/loopback; thiếu cookie, Origin sai, host khác localhost bị chặn; outer revision số và editor revision chuỗi không bị lẫn; chỉ advertise command đã thực thi. |
| Host ↔ iframe | origin/source/channel sai bị bỏ qua; requestId khớp; không ready/không mount/inactive/timeout/reload trả trạng thái đúng; duplicate reply/late reply không resolve ticket khác. |
| Registry / nhiều tab | Hai tab cùng project và hai nhân vật không sửa chéo; đổi A/B/activeRoot/units làm invalid patch; session epoch mới không nhận lệnh cũ. |
| Preview | Mỗi lệnh edit trả candidate, project JSON/history không đổi trước apply; preview original/processed chỉ đổi xem; stage mới khi còn pending trả PATCH_PENDING. |
| Apply / Undo | Đúng patch + revision tạo đúng một bước native Undo; apply lặp chỉ một commit; stale/wrong patch sai slot bị chặn; cancel không tạo history, cancel cũ không hủy preview mới; Undo ở biên báo NOTHING_TO_UNDO. |
| Concurrency / retry | UI edit sau preview → REVISION_CONFLICT; hai writer serialize; timeout trước/sau apply và mất ack không apply hai lần; reload/server restart không tự replay; poll dùng requestId mới. |
| Rig / animation | Lock/contact/Step giữ đúng; breakdown giữ Spin, retime scale slope; Lab bị chặn đúng trừ create_blocking; set_idea không tạo chuyển động; read tối đa 2000 key; analyze đối chiếu số local đã biết. |
| Scene | Sáu lệnh scene routing đúng revision/history; preview 11 operation; add_actor clone cleanup sau cancel; cancel scene stale bị chặn ở adapter; shot mode chặn scene writes/export, read vẫn dùng được. |
| Export artifact | BOBJ 20 ticks/s, FBX skeleton output, ZIP legacy giữ hành vi; không còn URL R2 trong local; byte hash/size đúng, output không ghi đè nguồn, pending patch chặn export, export lỗi phục hồi editor/UI. |
| Shot validation | Chạy test TASK-2 đã tích hợp; thiếu file/path traversal/symlink/hash sai/UUID thiếu/readonly/characterId trùng/base hash stale đều bị chặn trước sửa hay commit. |
| Shot timing / placement | start frame khác 0, range một frame, speed != 1, source offset, loop/reverse, in-place/skeletal, đơn vị cm/m, Y-up, yaw; không double-apply clip hoặc root, placement absolute, key đúng range. |
| Round-trip 3 app | Hai Action trong GLB chọn bằng UUID đúng; export UUID mới/manifest/SHA; giữ Action gốc; replace clip và placement cùng transaction App 2; conflict rollback không đổi clip/native file. |
| Tính năng cũ | Native history và project history riêng đúng; open/save/saved/active/ping vẫn chạy; Sites transport cũ không hỏng; không mất 434 id giao diện, không lỗi console; không chạy kiểm nhập Warcraft. |

Khi có code, chạy test mới + `python -m unittest agent.test_unified_cli agent.test_unified_mcp` và các test Studio
liên quan broker/iframe/motion.edit. Nếu sửa build App 3, chạy build và check-features theo TASK-3, giữ mọi id/hàm.
TASK-4 hiện không sửa source nên không build UI và không tuyên bố những gate này đã PASS.

## 9. Thứ tự triển khai sau khi duyệt thiết kế

1. Nối registry/queue/context và ready/offline, không expose mutation trước khi transport test đủ.
2. Nối read/analyze rồi staging/preview/apply/cancel/undo cùng dedupe và revision guards.
3. Nối artifact local cho BOBJ/FBX standalone; giữ scene write theo capability riêng.
4. Sau TASK-2 được tích hợp và root/timing policy được chốt: import shot read-only surroundings,
   placement candidate/history, export GLB contract, validate result và transaction App 2.

Mọi chỉnh sửa tương lai cần task riêng với file allowlist; TASK-4 chỉ bàn giao thiết kế.

## 10. Kiểm tra thực tế cho bản tài liệu này

- PASS: đọc module W bằng Node, đối chiếu đủ 26/26 công cụ có dòng riêng trong bảng (23 operation + 3 hạ tầng).
- PASS: đối chiếu 55/55 tên hàm/API được chọn với tệp nguồn; mọi đường dẫn nguồn trong bảng tồn tại.
  Đây là kiểm tra tham chiếu tài liệu, không phải test thực thi hành vi MCP local.
- PASS: `python -m unittest agent.test_unified_cli agent.test_unified_mcp`, chạy từ `three-workspace-app`:
  47 test, 0 fail, 0 error, 0 skip, Python 3.12.14; 0.334 giây.
- PASS: `git diff --cached --check`; diff chỉ thêm `docs/APP3-MCP-DESIGN.md`.
- NOT_RUN: test MCP local mới, browser end-to-end, build App 3, check-features và mẫu thật;
  TASK-4 chỉ thiết kế, chưa triển khai transport/shot adapter, không sửa source hoặc UI.
