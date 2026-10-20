# Bàn giao triển khai MVP Runtime — ba Workspace

> **Phạm vi cần duyệt bổ sung 2026-10-19:** đặc tả D2 cũ dưới đây chưa bao gồm Animation Creation gốc. [Đặc tả native integration](docs/features/animation-creation-integration.md) và [task AC-00–AC-08](ANIMATION_CREATION_TASK_PLAN.md) đề xuất bổ sung N1–N4 vào điều kiện D2, N5 vào D3. Không dùng APP16 cũ để tuyên bố đã đáp ứng yêu cầu native creation. Chưa có quyền code hoặc runtime PASS mới từ ghi chú này.

Ngày: 2026-10-19. **Đặc tả đề xuất để người dùng giao cho agent code; tài liệu này chưa cấp quyền sửa ứng dụng.** Đọc cùng [review bằng chứng](MVP_RUNTIME_READINESS_REVIEW.md), [kế hoạch ưu tiên](MVP_PRIORITY_PLAN.md) và [prompt giao việc](MVP_AGENT_PROMPT.md). Phần dưới ghi rõ cái đang có và phần cần bổ sung; không coi API thiết kế là API đã chạy.

## 1. Kết quả cần bàn giao và phạm vi

Mục tiêu triển khai: trong **một app hợp nhất**, người dùng nhập model, chọn animation nguồn, retarget thật, lưu kết quả, bố trí scene, chỉnh animation/blocking, rồi tải package Film native. Dữ liệu đi qua một project chung. Tái dùng các engine hiện có; không viết lại ba ứng dụng.

Hai mức hoàn thành riêng:

- **APP_RUNTIME_READY:** D0–D3 PASS trên cùng bản code/fixture; có cách khởi động, URL local, project mẫu, file xuất thật và hướng dẫn để người dùng tự test. Không cần đợi game để giao mức này.
- **E2E_GAME_PASS:** thêm D4 PASS trong BBS FS 2.4/Fabric Minecraft 1.20.1, bao gồm sửa key và save/reopen. Native codec readback không thay nghiệm thu này.

**Phạm vi mặc định đề xuất khi người dùng gửi prompt:** target Mixamo65; model target FBX có mesh/skin; một motion Minecraft20 từ thư viện BOBJ V9.12 được forward-retarget sang model65. Đây là chiều có code nguồn để tái dùng. Minecraft20 ở đây là **nguồn animation**, không thay target Minecraft25. Giữ đường nhập FBX/motion cùng rig đang hoạt động làm hồi quy.

Điểm còn cần người dùng chấp nhận trong lần giao việc là lựa chọn target65 và ca nguồn này. Không có cam kết retarget mọi FBX/arbitrary rig vào65. Nếu người dùng yêu cầu target25 hoặc nguồn khác, ghi thay đổi phạm vi và kiểm solver/fixture tương ứng trước; không đổi tên profile20 thành25. Gửi nguyên prompt kèm dưới đồng nghĩa đề nghị triển khai phạm vi65 này, không phải toàn bộ catalog tính năng.

Không xóa/bỏ chức năng nguồn hoặc action để đạt MVP. Những gì hoãn nghiệm thu: full parity ba sản phẩm, toàn bộ85 action trên mọi rig, advanced IK/contact/layers/fades, mọi format, multi-texture/shape keys, props/world export, xuất phim dài. Không làm thêm nền tảng debug độc lập.

## 2. Source và điểm sửa

Đường dẫn trong bảng tính từ workspace `C:/Users/Administrator/Documents/ChatGPT/BBS MINECRAFT`.

| Khu vực | File/module đang có | Cách sử dụng / phần còn thiếu |
|---|---|---|
| Model/motion import | `three-workspace-app/editor/apps/studio/src/unifiedAssetFiles.ts` | `buildImportedAsset` sinh Motion từ FBX. GLB hiện chỉ import model; không giả định import GLB có motion |
| Project, revision, history | `three-workspace-app/editor/apps/studio/src/unifiedProjectStore.ts` | Tái dùng staged upload, `asset.import`, `character.add`, `motion.place`, transaction/history. Không ghi project JSON từ đường riêng |
| Hợp đồng chung | `three-workspace-app/editor/packages/shared/src/index.ts` | Asset/BlobRef/SkeletonProfile/Motion/Character/MotionBinding/CommandEnvelope đã có; ưu tiên giữ schema và public API |
| Retarget đang tích hợp | `three-workspace-app/editor/packages/retarget/src/bake.ts`, `reverse.ts`; `three-workspace-app/editor/apps/studio/app/workbench/components/RetargetPreview.tsx` | Reverse65→20 và bake JSON đã có; Save Source vẫn là source FBX. Thiếu forward20→65 + target model/motion persistence |
| Scene/Animation | `three-workspace-app/editor/apps/studio/app/workbench/components/StudioOverlay.tsx`, `AnimationWorkspace.tsx`; `three-workspace-app/editor/apps/studio/src/LocalHostAdapter.ts` | Dùng cùng DirectorStudio/project. Thêm target asset/motion vào đường đang có, giữ guard fingerprint/unit |
| Blocking/key | `three-workspace-app/editor/packages/builder/src/sync/DocumentSync.ts`, `components/inspector/PosePanel.tsx`, `components/timeline/TimelineKeyframeRows.tsx` | Tái dùng FCurves/userKeys/history. Xác minh key đi tới evaluator và exporter |
| Export | `three-workspace-app/editor/apps/studio/src/unifiedFilmSampling.ts`, `unifiedSkeletonEvaluation.ts`, `filmPoseBake.ts`, `filmCamera.ts`, `filmManifest.ts`, `unifiedJobs.ts` | Giữ sampling20Hz, rest/basis/unit mapping, native codec và job/download; bổ sung stage lỗi nếu thiếu |
| Converter/worker | `three-workspace-app/agent/film_model_converter.py`, `film_worker/blender/convert_model.py`, `film_worker.py` | Tái dùng converter BOBJ và Java worker cho Film. GLB→FBX là adapter nhỏ riêng, không gọi converter BOBJ như thể nó xuất FBX |
| Debug/client | `three-workspace-app/agent/unified_cli.py`, `unified_mcp.py`; `three-workspace-app/editor/apps/studio/src/devtools/DevToolsDock.tsx`, `tools.tsx`, `liveStudio.ts` | Cùng broker/session; thêm quan sát và báo cáo lỗi tối thiểu |
| Runtime harness | `three-workspace-app/editor/apps/studio/scripts/unified-smoke.mjs`; `three-workspace-app/editor/apps/studio/test/filmExportJob.integration.test.ts` | Mở rộng fixture retarget thật và download thật; không viết harness mới toàn bộ |

Source forward chuẩn, chỉ đọc/tái dùng, không sửa bản gốc:

`C:/Users/Administrator/Documents/Codex/2026-10-08/retarget-anim-65-20-html/Emoticons_Mixamo_Full_Project/lab/mobile_v9_12.html`

Đọc implementation có hiệu lực cuối file: `setTargetModel`, `evaluateTargetV98`, `bakeTarget` bị gán lại ở cuối, `buildThreeClipFromBake`, `glbBlobV99`, `exportFbxBridge`. Không lấy bản định nghĩa đầu rồi bỏ các override V9.12. `createMixamo65()` synthetic chỉ làm đối chiếu, không thay model skinned nghiệm thu. Giữ NOTICE/license và đối chiếu native–adapter trên cùng fixture.

Trước sửa đọc AGENTS gốc, `docs/three-workspace-app/AGENTS.md`, `three-workspace-app/editor/AGENTS.md` và [SOURCES](docs/SOURCES.yaml). Host tiêu thụ builder qua public exports/dist; không alias sang `builder/src`. Không trộn object Three.js khác phiên bản; chuyển dữ liệu qua adapter đang có.

## 3. Đường nối được đề xuất cụ thể

```text
Model target FBX có skin + action BOBJ nguồn + state mapping/calibration V9.12
  → forward solver V9.12, bake target, GLB gồm mesh/skin/clip
  → host chạy Blender riêng để đổi GLB thành FBX
  → importer FBX hiện tại tạo Asset + SkeletonProfile + Motion đích
  → cùng transaction lưu provenance → Scene tạo Character → Animation đặt Motion
  → evaluator hiện tại → film.export → ZIP native có kiểm SHA → game test thủ công
```

Chuyển GLB→FBX phải nằm sau thao tác **“Lưu kết quả vào dự án”** trong app. Người dùng không phải tải GLB, mở Blender rồi import tay để đạt APP_RUNTIME_READY. Blender chạy tiến trình riêng, background, thư mục job riêng; không reset live Blender của người dùng. Giữ model gốc, bind/rest, texture và tất cả action nguồn nguyên vẹn. Kết quả retarget được tạo thành asset mới.

Ưu tiên này tránh mở thêm evaluator cho Three.js JSON: timeline hiện chấp nhận FBX có clip metadata. Nếu phép roundtrip thật không giữ được skin/animation trong dung sai, ghi rõ lỗi và bằng chứng rồi chuyển sang generated-clip adapter nhỏ nhất; không bỏ guard fingerprint/unit, không sửa expected test. Không triển khai đồng thời cả hai kiến trúc. JSON download rời hay thao tác thủ công chỉ là công cụ đối chiếu/đường lui, chưa đạt handoff một app.

### Hợp đồng đầu vào, đầu ra và lưu trữ

Đây là yêu cầu cho phần bổ sung, không phải command đã có:

| Điểm nối | Input bắt buộc | Output / bất biến |
|---|---|---|
| Native forward→bake | Target asset đúng hash/rest; source action đúng hash/tên; state mapping/calibration/reference pose/trim/root đã xác nhận; FPS rõ ràng | Target clip theo tên xương target thật; finite transforms; mesh/skin/rest cùng target; source không sửa |
| Bake→host | Upload handle GLB và snapshot native project; reference source/target hash + action + FPS/range | Host resolve handle trong staging, giới hạn size/format; không nhận shell string hoặc arbitrary absolute path từ UI/MCP |
| Host→asset store | FBX converter output đã kiểm clip/skin/unit/rest; metadata provenance | Asset/BlobRef content hash thật; SkeletonProfile fingerprint tính từ output; Motion trỏ asset/profile/clip metadata do importer sinh |
| Store→Scene/Animation | `assetIds`, `skeletonIds`, `motionIds` như kết quả importer hiện có; project revision mới | `character.add` và `motion.place` dùng đúng ID; không fake nguồn FBX, không gán source fingerprint vào target |
| Animation→Film | Scene/FCurves/MotionBinding và snapshot revision | Sample có cả blocking chỉnh mới; export theo snapshot, không đọc lẫn revision khác trong job |

Phần apply nên đi qua **một command mới `retarget.apply` được đề xuất**, dùng `CommandEnvelope` hiện có: `requestId`, `projectId`, `expectedRevision`, `command`, `args`. `args` gồm `targetAssetId`, `sourceAction` (loại nguồn, ID/reference, hash, tên action), `nativeProjectUploadId`, `bakedGlbUploadId`. FPS/trim/root lấy từ snapshot native đã validate, không duy trì hai bộ giá trị có thể lệch nhau. Agent được đặt tên helper/file theo cấu trúc hiện hữu; thay contract này phải cập nhật tài liệu và caller/tests cùng lượt.

- Trả `jobId`, `sourceRevision`, state/progress qua cơ chế jobs sẵn có. UI poll `job.get`, hủy qua `job.cancel`. Thành công trả các ID asset/profile/motion và revision **đã commit**. Thêm type job chỉ khi cần, không xây queue/service mới.
- Commit asset/motion/provenance cùng một transaction sau khi conversion và validation PASS; recheck expected revision dưới write lock. Conflict/cancel/error trước commit không tạo Character, clip hoặc manifest tham chiếu file thiếu. File staging không hiển thị như asset thành công. Hủy sau commit phải báo đã commit, không giả rollback.
- Cùng `requestId` và cùng payload trả lại kết quả/job cũ; payload khác bị từ chối. Undo/Redo xử lý apply như một thay đổi người dùng, khôi phục cả metadata tham chiếu; không xóa source gốc.
- Native snapshot/source action/hash/target hash/output hash/solver version/converter version phải được lưu có liên kết tới output. Tái dùng `BlobRef`, `Asset.provenance` và extension lưu trữ hợp lệ; nếu nguồn BOBJ chưa có `Motion`, `derivedFrom` có thể là `null` và provenance phải chứa reference nguồn thật, không tạo Motion giả để qua validator.
- `RetargetSession` hiện yêu cầu source Motion và bị giới hạn reverse65→20. Không đưa forward state vào đó như thể đã hỗ trợ. Có thể lưu snapshot forward tại extension riêng của project cùng output reference; chỉ mở rộng session/type/validator nếu đường sử dụng thực sự cần. Reload phải khôi phục mapping/clip lựa chọn và output đã lưu.
- Dùng lại mã lỗi `VALIDATION_FAILED`, `REVISION_CONFLICT`, `UNSUPPORTED_CAPABILITY` nếu phù hợp. Lỗi conversion/bake có stage và nguyên nhân an toàn; không chỉ “export failed”. Asset/Motion không hợp lệ phải bị chặn trước khi timeline hiển thị nút sử dụng.

### UI tối thiểu

WS01: chọn target model, source action, preview, “Lưu kết quả vào dự án”; hiện stage/progress/lỗi/retry và motion đích sau thành công. Retry không nhân đôi asset/clip. Giữ source và target phân biệt rõ.

WS02: chọn target asset đã lưu, thêm hai Character, chỉnh vị trí/hướng, đặt camera; chuyển sang WS03 giữ project/selection/frame/ID. Không serialize/import scene sang một project khác để chuyển workspace.

WS03: chọn motion retarget từ thư viện, đặt clip, play/scrub, chỉnh trim/timing và một blocking transform key. Chọn thao tác tối thiểu **key transform actor** làm nghiệm thu; không bắt xây thêm hệ bone pose/layer mới. Key phải làm thay đổi sample và Film thật. Một camera với hai shot có cut rõ; không yêu cầu thêm camera thứ hai.

Export: dùng panel/job hiện có; hiển thị stage, lỗi, download ZIP và nút báo cáo lỗi. Nếu browser folder picker không dùng được, cho download chuẩn hoặc CLI verified-download với hướng dẫn rõ. Không dùng memory stub để nghiệm thu file lưu thật.

## 4. Fixture và quy tắc đo

Agent khóa fixture trước D1, ghi đường dẫn thực + SHA256 vào manifest kiểm thử ở nơi project đã quy định. Nếu fixture cũ đã cleanup, tìm nguồn hợp lệ hoặc yêu cầu đúng asset còn thiếu; không giả định ZIP/FBX lịch sử còn tồn tại. Không tải model không rõ license hoặc ghi binary vào docs để né gitignore.

- Target: một model Mixamo65 skinned thật, một texture chung nếu model cần texture; có hierarchy/rest/unit đã ghi nhận. Hai Character dùng cùng asset, ID và transform độc lập.
- Source: một action BOBJ của thư viện V9.12 hiện có, có chuyển động rõ; chọn action đủ dài hoặc ghi loop rõ ràng để dựng3giây, không sửa duration nguồn. Ghi action count/name/duration trước/sau, toàn bộ source hash và clip lựa chọn. Giữ mọi action nguồn; chỉ một action đích được chọn cho ca demo, không báo đã nghiệm thu toàn bộ thư viện.
- Timeline30FPS: range **0..89 inclusive**, duration3s. Shot1 **0..44**, shot2 **45..89**, cut1.5s. Native Film duration60ticks; sampling có terminal sample theo quy tắc hiện tại, không lấy “90 frames =90ticks” hoặc đòi đúng60 mẫu bao gồm cả endpoint.
- Actor scale1, không roll/shear; vị trí/hướng khác nhau; root policy khai báo rõ. Tạo blocking transform key tại frame45/tick30 để thay đổi dễ quan sát. Camera perspective, shot phủ kín range.
- Bối cảnh Minecraft sẵn có; prop chỉ có trong web không được báo đã xuất sang game. Không mở rộng converter chỉ để đưa nhiều material/shape keys vào fixture đầu tiên.

Dung sai kế thừa [acceptance.yaml](docs/acceptance.yaml): native adapter vị trí≤1e-5m, quaternion angular≤0.001°, scale≤1e-6; chuyển format vị trí≤0.001m, rotation≤0.1°, scale≤1e-4; Film world≤0.001block, pose/FOV≤0.1°, animation time≤0.025s, shot bound integer ticks chính xác. Tên/ID/hierarchy/action/hash phải khớp theo lớp dữ liệu đang đối chiếu; đổi tên bone an toàn của BOBJ phải có mapping đã kiểm, không yêu cầu tên BOBJ bằng tên FBX khi codec cần chuyển.

Native–adapter và roundtrip kiểm **mọi bone/mẫu đã bake**, không chỉ bình quân hoặc ảnh đầu/giữa/cuối. Các ảnh/tick0/30/60 là evidence đọc nhanh bổ sung. Không nới dung sai khi test fail. Không đòi hash FBX bằng hash GLB; so hash file với record tương ứng và so dữ liệu qua converter theo dung sai format.

## 5. Debug đủ dùng, không thành dự án riêng

Ưu tiên CLI/broker + DevToolsDock + harness đang có. Không cần cài MCP mới để bắt đầu D1. D0 chỉ cần đọc lỗi và chạy lại ca test; hoàn thiện gói lỗi cùng D3.

| Khả năng | Dữ liệu tối thiểu và nghiệm thu |
|---|---|
| Health | App/build identifier, URL/port thật; Node/pnpm/Python/Blender/Java version và capability đã kiểm; dependency thiếu có nguyên nhân/cách sửa. Chỉ kiểm đọc; không tự cài/đổi version |
| Snapshot | Project ID/revision, asset/motion/profile IDs và fingerprint/unit, frame evaluate, missing assets; selection/workspace từ liveStudio khi có editor mở. Không có UI thì trả unavailable, không bịa selection |
| Stage/error | `requestId`, `projectId`, `sourceRevision`, `jobId`, `stage`, state/progress, timestamp, error code/message; phân biệt bake/conversion/import/sample/native-write/package/download. Giữ log có giới hạn và bỏ cookie/token/Authorization |
| Báo cáo lỗi | Version/hash, fixture references, request/job IDs, bước tái hiện, report và log liên quan. Không tự đóng gói source model lớn, project khác hoặc credential. Screenshot chỉ khi browser/harness thật cung cấp |
| Chạy lại demo | CLI/harness dùng project và thư mục output tách riêng. Runner dùng ca test cố định; không mở arbitrary shell qua MCP. Có thể chạy từ terminal, chưa cần một API runner riêng |

MCP hiện có17 command nhưng `asset.import`/`skeleton.mapping.set` chưa được công bố. Chỉ thêm command cần dùng, qua session/validation/opaque upload của host. Không mở tool filesystem tự do. `retarget.apply` ở mục3 là command **chưa triển khai**, không khai báo capability trước khi handler/caller/test đã nối.

Nếu bàn giao MCP: thử **đúng client thực tế** discover/list→inspect→evaluate→job/report; ghi client/server version và kết quả. Bridge hiện từ chối `initialize`; kiểm handshake thật rồi sửa tương thích cần thiết, không giả định unit test chứng minh kết nối. Nếu chưa có client kết nối được, giao CLI hoạt động và ghi `MCP_LIVE_UNVERIFIED`; điều này không chặn APP_RUNTIME_READY, nhưng không được báo MCP đã hoàn tất.

## 6. Thứ tự công việc và tiêu chí PASS/FAIL

Ưu tiên code: D0 tối thiểu → D1 → D2 → D3. P0-01 same-rig game smoke làm sớm **song song khi người dùng sẵn sàng kiểm game**. Không đợi quyền chạy game mới tiếp tục app. D4 phụ thuộc package D3 và kiểm game được phép.

Mỗi dòng dưới là một assertion: chỉ PASS khi toàn bộ điều kiện của dòng có evidence; còn lại FAIL/BLOCKED/NOT_RUN. Đây là bộ nghiệm thu **đề xuất** cho phạm vi65, không tự thay acceptance toàn dự án. Tổng20 assertion, trong đó16 cho app và4 cho game.

| ID / ưu tiên | Việc / liên kết kế hoạch | PASS bắt buộc |
|---|---|---|
| D0.1 / P0 | Môi trường, P1-01 phần chặn launch | Khởi động lại app bằng lệnh đã ghi; URL thật mở được project và viewport; version/dependency được ghi |
| D0.2 / P0 | Debug snapshot | CLI hoặc MCP và UI đọc cùng project/revision; inspect không sửa project; unknown UI state báo đúng |
| D0.3 / P0 | Chẩn đoán lỗi | Một lỗi có chủ đích trên project test hiện đúng request/job/stage/cause; dữ liệu người dùng không đổi; không lộ credential |
| D0.4 / P0 | Vòng kiểm thử | Harness tạo project test riêng, trả report/ảnh/lỗi; chạy lại được và giữ project đang làm của người dùng |
| D1.1 / P0 | Fixture + native parity, P0-02 | Có target skinned65 và action nguồn thật; forward adapter khớp native V9.12 trong dung sai; không same-rig passthrough |
| D1.2 / P0 | Target roundtrip, P0-02 | GLB→FBX giữ mesh/skin/rest/texture/clip; motion importer có đúng target fingerprint/unit; mọi mẫu kiểm đạt dung sai |
| D1.3 / P0 | Apply/persistence, P0-03 | Bấm lưu trong app tạo target asset/motion dùng được, reload giữ state/provenance, source và mọi action nguồn nguyên vẹn |
| D1.4 / P0 | Transaction, P0-03 | Undo/Redo apply đúng; duplicate request không nhân đôi; stale revision/cancel/lỗi trước commit không để manifest dở dang |
| D2.1 / P0 | Shared scene, P0-04 | Hai Character từ target asset, vị trí/hướng độc lập; camera và project/node/clip IDs không mất khi đổi workspace |
| D2.2 / P0 | Motion library/timing | Motion retarget có trong thư viện, play/scrub trên target; trim/timing edit giữ đúng sau reload; binding/units không bị giả |
| D2.3 / P0 | Blocking key, P0-04 | Key transform tại frame45 làm thay đổi actor thật; Undo/Redo/reload giữ đúng; không làm đổi Character còn lại |
| D2.4 / P0 | Evaluator parity | CPU sample khớp WebGL trên clip đã chỉnh; root áp một lần; camera shot 0..44/45..89 đúng cut |
| D3.1 / P0 | Native package, P0-05 | Job từ đúng project D2 tạo ZIP với Film native, model và texture cần thiết; duration60ticks, native readback PASS |
| D3.2 / P0 | Fidelity | Film samples giữ blocking key/pose/actor placement/camera/cut/root trong dung sai; BOBJ safe-name/rest mapping đúng |
| D3.3 / P0 | Download thật | File có trên đĩa, size/SHA khớp job; reopen project và export lại hoạt động; không stub picker/write |
| D3.4 / P0 | Bàn giao test | Có project mẫu, fixture manifest, lệnh launch, URL, hướng dẫn click và gói lỗi; cancel/failure export không đổi project nguồn |
| D4.1 / P0 | Import BBS, P0-06 | Đúng BBS FS2.4/MC1.20.1 nhận package trong profile test; mở Film không missing actor/model/texture |
| D4.2 / P0 | Playback | Phát3giây đúng hai Character, placement/motion/blocking/camera/root; có evidence so với D3 |
| D4.3 / P0 | Edit/save | Sửa một key trong Film Editor, save/reopen giữ thay đổi; actor/camera khác không bị đổi |
| D4.4 / P0 | Khả năng chạy lại | Đóng/mở lại Film và phát từ đầu đúng; lưu version/hash/steps/ảnh hoặc video, ghi thao tác copy/import thủ công |

FAIL bao gồm kết quả sai/exception/mất dữ liệu. BLOCKED là thiếu prerequisite hoặc quyền/asset không có; không tính PASS. NOT_RUN là chưa kiểm. Không tự gán FAIL cho ca chưa chạy.

Tiến độ báo bằng `APP: n/16 PASS`, `BBS: m/4 PASS`; nếu biểu diễn %, `n/16×100` và `m/4×100`, không lấy số file/module làm độ hoàn tất. Mỗi milestone chỉ xong khi4/4 assertion của nó PASS. Không lấy tổng20 làm “% toàn dự án”; đây chỉ là MVP đã chọn. Trước code gắn lại evidence cũ hợp lệ, ghi version/fixture/giới hạn; không reset thành0 nếu có evidence dùng được, không kế thừa PASS sai fixture/phiên bản.

Sau D0/D1, agent ước lượng phần còn lại theo số task/lỗi đã xác minh và số vòng kiểm thử; nêu điều kiện chờ asset/game. Không cam kết ngày hoàn tất từ26/28 nhóm có code. Giao milestone ngay khi chạy được, không chờ mọi báo cáo/catalog hoàn chỉnh.

## 7. Caller, tests, config, exports cần đi cùng thay đổi

- Retarget forward: native parity fixture; export public của `packages/retarget`; caller RetargetPreview; snapshot/parser; bake/converter và bất biến source. Không vô tình làm hỏng reverse65→20 đang chạy.
- Apply command/job: shared type/validator nếu đổi; `unifiedProjectStore` transaction/history; upload/session boundary; `unifiedJobs`; UI polling/cancel/retry; CLI/MCP schema chỉ khi công bố command; persistence reload và regression project cũ.
- Timeline/blocking: AnimationWorkspace/LocalHostAdapter/DocumentSync; CPU sampler và Film exporter dùng cùng dữ liệu key. Thay public API phải cập nhật caller và package exports/dist; không chỉ sửa UI.
- Python/conversion: dependency executable path, timeout/cancel/stderr và test trên process riêng; không nhận string shell tùy ý. Không nâng package hàng loạt hoặc thay lockfile để chữa một lỗi chưa tái hiện.
- Test hiện có để nối thêm: `packages/retarget/test/{bake,reverse,mapping,project}.test.ts`; `apps/studio/test/unifiedAssetImport.test.ts`; `filmPoseBake.test.ts`, `filmCamera.test.ts`, `filmManifest.test.ts`, `filmExportJob.integration.test.ts`; `agent/test_unified_cli.py`, `agent/test_unified_mcp.py`; `apps/studio/scripts/unified-smoke.mjs`. Đường test mới có thể đặt cạnh các file này theo cấu trúc repo.

Gate AGENTS khi sửa builder/Studio, từ `three-workspace-app/editor`: `pnpm typecheck`, `pnpm lint`, `pnpm test:evaluate`, `pnpm build`, `pnpm --filter @topview/3d-studio test:offline`; thêm browser WebGL thật cho đường retarget/playback và test Python liên quan. Ghi rõ skipped/blocked và lý do. Không sửa golden để cho qua, không lặp full suite mỗi khi chỉ sửa docs. Nếu dev runtime chạy nhưng production build fail, ghi giới hạn dev-demo và lỗi packaging; không báo full build PASS.

## 8. Deliverables và quyền thao tác

Agent code bàn giao: diff/source đã sửa; cách launch/stop và URL thực tế; fixture manifest/hash + project mẫu lưu ở nơi hợp lệ; package ZIP thật; report20assertion với status/evidence/reason; hướng dẫn click để người dùng test; danh sách lỗi còn lại. Report cần có build/source ID, runner/browser/dependency versions và ngày kiểm. Cập nhật STATUS/CHECKPOINTS và hai báo cáo MVP đúng phạm vi thay đổi, giữ lịch sử.

Không tự commit/push, sửa source gốc, thay mod hoặc chạy/copy dữ liệu vào game. Người dùng có thể tự làm D4 theo hướng dẫn; việc chờ D4 không cản sửa lỗi D0–D3 đã được duyệt. Nếu tạo phiên bản Animation Studio mới, tuân thủ quy định tạo **Site kiểm thử mới owner-private**, version rõ, không ghi đè Site cũ; Site không thay local backend/Blender/Java hay game test. Nếu deploy không khả dụng, ghi thiếu deliverable, không tự mở public/production.

Tình trạng tại lúc viết bàn giao: **chưa triển khai các bổ sung này**. Review đã có26 test logic PASS và15 MCP unit test PASS; đó không phải20 assertion runtime ở trên đã PASS. Không dùng tài liệu này để tự nâng trạng thái ứng dụng.
