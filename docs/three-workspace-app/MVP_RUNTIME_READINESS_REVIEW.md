# Review mức sẵn sàng Demo Runtime MVP

> **Đính chính phạm vi, không thay evidence lịch sử (2026-10-19):** đề xuất chỉ dùng Topview blocking trong review này chưa đáp ứng yêu cầu đưa Animation Creation gốc vào Workspace 03. Xem [đặc tả bổ sung](docs/features/animation-creation-integration.md) và [task AC](ANIMATION_CREATION_TASK_PLAN.md). Chưa có kiểm chứng runtime mới trong lượt lập đặc tả.

Ngày: 2026-10-19. Phạm vi: review source, đối chiếu bằng chứng và chạy lại test logic có sẵn. Không sửa mã ứng dụng, không chạy game, không triển khai Site. Kế hoạch tiếp theo: [MVP_PRIORITY_PLAN.md](MVP_PRIORITY_PLAN.md).

Bàn giao triển khai đã được mô tả tại [MVP_IMPLEMENTATION_HANDOFF.md](MVP_IMPLEMENTATION_HANDOFF.md); [MVP_AGENT_PROMPT.md](MVP_AGENT_PROMPT.md) là mẫu người dùng gửi agent khác. Đây là đặc tả đề xuất, không thay đổi các kết luận runtime chưa xác minh trong review này.

## 1. Kết luận

**Chưa có Demo Runtime xuyên suốt đúng MVP được xác nhận PASS.** Tuy nhiên, luồng bỏ qua retarget khác rig đã có bằng chứng chạy tới **ZIP Film native**: nhập FBX Punch Combo 65 xương → hai Character → đặt motion cùng skeleton → hai camera shot → converter Blender → native worker → ZIP. DOC-059 ghi nhận browser job thành công; thao tác chọn thư mục/lưu browser dùng stub trong bộ nhớ, chưa phải lưu bằng hộp thoại hệ điều hành và chưa mở trong game.

Điểm đứt rõ nhất trong ứng dụng hợp nhất là **đầu ra Retarget chưa trở thành Motion/Character đích mà Scene và Animation dùng được**. `exportBakedClip()` chỉ tải Three.js JSON. `motion.place` yêu cầu skeleton fingerprint/đơn vị giống nhau và metadata clip FBX. Không thể lấy preview Minecraft20 hiện tại làm bằng chứng hoàn thành retarget sang Mixamo65 hoặc Minecraft25.

Điểm chưa xác minh có rủi ro cao nhất là **native Film đọc lại bằng codec nhưng chưa phát/chỉnh đúng trong BBS FS 2.4**. Nên kiểm tra đầu ra đã có trong game sớm, trước khi mở rộng tính năng hoặc viết lại exporter.

## 2. Workflow và phạm vi được đánh giá

Đã đọc trực tiếp cây nội dung của `C:/Users/Administrator/Downloads/workflow Tuan.mmap`: ba workspace, bảo toàn action, chuyển scene, xuất Film và nghiệm thu trong game. Nội dung file được dùng làm dữ liệu workflow; yêu cầu review hiện tại của người dùng quyết định phạm vi thao tác.

- Yêu cầu mới: đích **Mixamo65 hoặc Minecraft25**. Code và quy ước dự án cũ dùng Mixamo65/Minecraft20. Review giữ Minecraft25 là yêu cầu mới chưa đáp ứng; không đổi tên profile20 thành25 và không tự đổi skeleton.
- Nhánh Mixamo65 là lựa chọn MVP ít mở rộng hơn vì đã tồn tại trong source gốc. Điều đó không có nghĩa hỗ trợ retarget mọi rig vào Mixamo65.
- Source ứng dụng hợp nhất: `three-workspace-app/editor`, CLI/converter/worker: `three-workspace-app/agent`.
- Source gốc: Retarget V9.12; Topview v0.1.8; Animation Studio 1.31.8 theo `docs/SOURCES.yaml`. Đã đối chiếu module source gốc liên quan đến bake/export, scene evaluator và control rig; không mặc định toàn bộ chức năng nguồn đã được ghép vào app.
- Đích export đang hard-code BBS FS **2.4**, Minecraft **1.20.1**. Bản BBS thực tế người dùng mở phải khớp; không dùng HEAD checkout 2.7 làm bằng chứng cho2.4.
- Đây là review các đường code phục vụ MVP, không phải audit bảo mật hoặc nghiệm thu tất cả chức năng của ba sản phẩm nguồn.

## 3. Cách tính và bảng tổng hợp

**Code (%) = số tiêu chí triển khai hoàn chỉnh đã kiểm chứng / tổng tiêu chí triển khai đã chốt ×100.** Hiện chưa có phân rã định lượng đủ cho rig bất kỳ, các format, bảo toàn mọi action và toàn bộ handoff; nhiều mục mới một phần. Vì vậy không quy code có mặt thành phần trăm code hoàn thành, cũng không tự cho PARTIAL=50%.

**Runtime Ready (%) = số kịch bản runtime bắt buộc đã PASS trên cùng phạm vi/fixture/version / tổng kịch bản bắt buộc đã chốt ×100.** Kết quả unit test, browser stub và codec readback không thay thế runtime game. Các workspace chưa có bộ kịch bản đủ bao phủ yêu cầu mới nên ghi N/A. Với đúng một kịch bản nghiệm thu xuyên suốt trong yêu cầu, hiện có **0/1 được xác nhận PASS =0% bằng chứng nghiệm thu E2E**. Đây không phải kết luận 0% code hay mọi tính năng đều không chạy.

| Hạng mục | Code (%) | Runtime Ready (%) | Thiếu gì? | Ưu tiên |
|---|---:|---:|---|---|
| Workspace01 | N/A — có code một phần | N/A — chưa PASS handoff retarget đúng đích MVP | Minecraft25; forward/target mesh integration; bake thành asset/Motion đích; model+animation roundtrip; bảo toàn đầy đủ action | P0 |
| Workspace02 | N/A — nhiều thành phần đã nối | N/A — có browser PASS trên FBX cùng rig | Nhận sản phẩm retarget thật; kiểm scene/camera chuyển workspace trên cùng fixture; props không tự đi vào Film | P0 handoff; P1 phần mở rộng |
| Workspace03 | N/A — timeline cùng rig đã nối | N/A — clip edit/preview có browser PASS, pose-edit→game chưa PASS | Motion đích retarget; blocking key thực sự lưu và export; thư viện khác rig; native Animation1.31.8 chưa ghép đầy đủ | P0 |
| BBS FS Export/Import | N/A — native export pipeline đã nối | N/A — native ZIP có bằng chứng; import/playback/edit trong game chưa chạy | Lưu file thật; model/texture đúng fixture; import vào profile2.4; playback; edit/save/reopen | P0 |
| **Toàn bộ MVP** | **N/A — chưa đủ cơ sở cho tỷ lệ code hoàn thành** | **0% E2E được xác nhận: 0/1** | **Retarget handoff và nghiệm thu BBS FS; chưa có cùng một fixture chạy hết chuỗi** | **P0** |

Ledger cũ có 24 nhóm core đều PARTIAL và hai nhóm QA chưa có implementation status. Con số 26/28 có code một phần (~93%) là thống kê nhóm, không dùng làm tiến độ MVP. Không dùng 0/24 DONE để phủ nhận các luồng con đã có bằng chứng chạy.

## 4. Ma trận chức năng dựa trên code

Quy ước: Có = có implementation trong phạm vi ghi rõ; Một phần = phạm vi hẹp hơn yêu cầu; Chưa nối = nguồn gốc có nhưng app chưa có đường sử dụng; Chưa xác minh = thiếu bằng chứng, không đồng nghĩa FAIL. Runtime dưới đây là bằng chứng lịch sử khi ghi DOC, không khẳng định server hiện đang chạy.

| ID / chức năng | Implemented | Integrated | Tested | Runtime Ready / Missing-Broken |
|---|---|---|---|---|
| W1-01 Import model/motion | FBX, GLB/glTF, PNG/JPEG | Có qua upload→asset.import | DOC-038; asset tests lịch sử | FBX thật đã chạy. `unifiedAssetFiles.ts:350` chỉ whitelist các format này; Motion lấy từ FBX. BOBJ/Blockbench JSON chưa có importer hợp nhất |
| W1-02 Giữ nguồn/action | Blob nguồn/hash, clip metadata, selection clip index | Có cho FBX | DOC-038/059 có unchanged hash và playback | Giữ file gốc có bằng chứng; không chứng minh bảo toàn mọi action/NLA qua tất cả exporter |
| W1-03 Retarget đúng đích | Reverse Mixamo65→Minecraft20 có; source V9.12 có target Mixamo65 | Forward/Mixamo65 target chưa có đường hoàn chỉnh trong app; Minecraft25 chưa đáp ứng | 6 test Retarget chạy lại PASS | Current preview trên armature20 tĩnh. Target mesh, forward parity và MC25 chưa sẵn sàng |
| W1-04 Bake/export | `bakeReverseRetargetFrames`, `retargetFramesToAnimationClip`, UI JSON download | UI nối bake; chưa lưu generated Motion vào project | 6 test gồm AnimationMixer và tên bone có dấu chấm | Browser bake/download/loadback chưa được kiểm. JSON không phải model+rig+animation package |
| W1-05 Handoff đích | Mapping/session lưu được | Chưa nối sản phẩm bake tới Scene/Animation | Không có E2E target-motion acceptance | `RetargetPreview.tsx` nêu rõ save là FBX nguồn; output bake riêng. Đây là blocker chính |
| W2-01 Asset→Character, bố trí | character.add, prop.add, scene.apply, transform | Có qua shared project | DOC-038 browser, basis/asset tests lịch sử | Đã chạy trên direct FBX; chưa trên output retarget mới |
| W2-02 Camera/shot | CameraRig, camera.shot.set, sampler/cuts | Có | DOC-059 hai shot; 11 test camera chạy lại PASS | Camera export tồn tại; perspective, cut20Hz, range/shot coverage có guard |
| W2-03 Chuyển Scene→Animation | Cùng projectId và LocalHostAdapter/DirectorStudio | Có trong StudioOverlay | DOC-038 mount và reload PASS | Không cần serializer chuyển hai bản scene độc lập. Chưa chứng minh mọi edit/shot giữ nguyên trong fixture retarget mới |
| W3-01 Motion library/place/edit | Motion FBX, trim/speed/loop/reverse, root policies | Có khi fingerprint và unit giống nhau | DOC-038 browser PASS | `AnimationWorkspace.tsx` lọc FBX; store:1113/1121 từ chối khác rig hoặc thiếu clip index. 85 action hiển thị ở Retarget không tự là library timeline |
| W3-02 Blocking/pose keys | Topview pose/timeline, FCurve/userKeys có sẵn | DirectorStudio được mount; DocumentSync lưu overlays | Test pose/sync nguồn và DOC-038 mount; chưa đủ nghiệm thu chỉnh key thủ công | Không được đánh đồng mount với “sửa pose mới→reload→Film→game” PASS |
| W3-03 Native Animation Studio | Nguồn `control_rig.js`, `motion_lab.js`, `graph_editor.js`, `scene_evaluator.js`, `animation_export.js` có | Chưa có parity/tích hợp native1.31.8 vào shell | DOC-038 xác định giới hạn | Dùng Topview blocking tối thiểu trước; không cần ghép hết bộ native để thử MVP |
| W3-04 Blend/fades | Có logic nguồn ở các sản phẩm | Shared binding từ chối fade khác0 | Guard store:564 | `UNSUPPORTED_CAPABILITY`, không phải nút lỗi ngẫu nhiên. Hoãn blend nâng cao |
| F-01 Sample→convert→Film | `unifiedJobs.ts`, sampling, manifest, pose bake, worker | Có UI/API/CLI | DOC-059 job thực; 20 unit camera/pose/manifest chạy lại PASS | Native ZIP đã chạy trên65 bones/1action,2Character,2shot,1giây; chưa đạt fixture3giây/game |
| F-02 File output/import | SHA-verified ZIP download, worker staging | Có; copy/install game thủ công | DOC-059 browser save dùng stub; CLI/download có test | Native Film có thật; OS picker và import game chưa xác minh |
| F-03 Playback/editable | Worker ghi pose_transform + native readback | Không có runtime acceptance BBS | FILM-02/03, E2E-01 chưa PASS | Không thể khẳng định model/pose/camera nhìn đúng, key sửa được trong game |

## 5. Code và evidence đối chiếu

Đường dẫn dưới đây tương đối workspace gốc `C:/Users/Administrator/Documents/ChatGPT/BBS MINECRAFT`:

| Nhóm | Source đã kiểm | Evidence/test liên quan |
|---|---|---|
| Import/persistence | `three-workspace-app/editor/apps/studio/src/unifiedAssetFiles.ts`; `unifiedProjectStore.ts` cùng thư mục | `apps/studio/test/unifiedAssetImport.test.ts`; DOC-038 |
| Retarget | `three-workspace-app/editor/packages/retarget/src/bake.ts`, `reverse.ts`, `mapping.ts`; `apps/studio/app/workbench/components/RetargetPreview.tsx` | `packages/retarget/test/bake.test.ts`, `reverse.test.ts`; [DOC-061](docs/evidence/retarget-preview-bake-json.yaml) |
| Shared UI/Animation | `three-workspace-app/editor/apps/studio/app/workbench/components/StudioOverlay.tsx`, `AnimationWorkspace.tsx`; `packages/builder/src/sync/DocumentSync.ts` | [DOC-038](docs/evidence/animation-workspace.yaml) |
| Export | `three-workspace-app/editor/apps/studio/src/unifiedJobs.ts`, `unifiedFilmSampling.ts`, `filmManifest.ts`, `filmPoseBake.ts`, `filmCamera.ts` | [DOC-059](docs/evidence/film-punch-combo-browser-export.yaml); `apps/studio/test/filmExportJob.integration.test.ts` |
| Converter/native | `three-workspace-app/agent/film_model_converter.py`, `film_worker.py`, `film_worker/blender/convert_model.py`, `film_worker/src/main/java/local/bbsmerged/FilmExportWorker.java` | [Safe names](docs/evidence/film-safe-bone-names.yaml); [Bind-frame](docs/evidence/film-pose-frame-calibration.yaml) |

Source Retarget gốc: `C:/Users/Administrator/Documents/Codex/2026-10-08/retarget-anim-65-20-html/Emoticons_Mixamo_Full_Project/lab/mobile_v9_12.html`. `bakeTarget` khoảng dòng69295; `exportGLB`69325; `exportFbxBridge`69336. **FBX export này xuất GLB và script Blender, không phải FBX browser trực tiếp.** Script reset scene Blender: chỉ chạy trong tiến trình/scene riêng khi phương án được duyệt, không chạy trên scene đang có dữ liệu người dùng.

Source Animation gốc: `C:/Users/Administrator/Documents/Codex/2026-10-09/animation-studio/sites/animation-studio-mdx-alpha-1318/work/material_alpha_v1_31_8/src`. `scene_package.js` có sample/build/GLB; `animation_export.js` có bake/BVH/FBX; `scene_evaluator.js` có evaluate/check và basis mapping. Có thể tái dùng, nhưng đưa cả bộ này vào shared project cần adapter; tên module giống chức năng không chứng minh đã tích hợp.

### Kiểm chứng thực hiện trong lượt review

Từ `three-workspace-app/editor`:

```text
node --experimental-strip-types --test packages/retarget/test/bake.test.ts packages/retarget/test/reverse.test.ts
Kết quả: 6 passed, 0 failed, 0 skipped.

node --import ./packages/builder/node_modules/tsx/dist/loader.mjs --test apps/studio/test/filmPoseBake.test.ts apps/studio/test/filmCamera.test.ts apps/studio/test/filmManifest.test.ts
Kết quả: 20 passed, 0 failed, 0 skipped.
```

Hash hiện tại của bake.ts, Retarget index.ts, RetargetPreview.tsx và bake.test.ts khớp DOC-061. Báo cáo browser và ảnh DOC-038 vẫn tồn tại dưới `three-workspace-app/.test-runtime/browser/`. DOC-059 ghi cleanup các fixture/job/harness; lượt này đọc evidence YAML, không tái chạy integration/browser job và không xác minh lại ZIP lịch sử trên đĩa. Không coi 26 test logic này là browser/game acceptance mới.

### Các báo cáo cũ cần đọc có điều kiện

- Worker README còn câu “project jobs/pose bake/UI chưa implemented”, trái với `unifiedJobs.ts`, `filmManifest.ts` và DOC-059. Review ưu tiên source hiện tại và evidence mới.
- DOC-048 animated job failed và DOC-049 unsafe name blocker đã có sửa/case mới ở DOC-050/059; không tiếp tục liệt kê chúng là lỗi hiện tại chưa sửa.
- Clone IO_FAILED ngắt quãng, Next production build EPERM và lỗi legacy Python suite là lỗi lịch sử được ghi, chưa tái hiện/chứng minh đã sửa trong lượt này. Dev demo từng chạy; không vì production build fail mà kết luận mọi browser runtime hỏng. Cũng không dùng dev PASS để khẳng định bản đóng gói sẵn sàng.

## 6. Rủi ro và giới hạn export sang BBS FS

1. **Quan trọng nhất: hợp đồng runtime của game chưa được kiểm.** Codec parse được không đảm bảo bind/rest pose, rotation order/radians, resource path, texture, camera/FOV và editable keys đúng trong Film Editor2.4.
2. `unifiedFilmSampling.ts` chỉ nhận imported direct rig, không nhận unresolved library pose; FBX/GLB source; 20Hz,1–255ticks (tối đa12,75giây), cut đúng grid và shot phủ hết range. Demo3giây nằm trong giới hạn.
3. `filmManifest.ts` yêu cầu actor scale1, không shear, không actor roll; `filmPoseBake.ts` kiểm bind frames/bone mapping. Không giảm guard để “export cho qua”.
4. Converter hiện giới hạn một armature, mesh gắn rig, tối đa một texture ảnh dùng chung; shape keys, vertex colors, multi-texture bị hạn chế/từ chối. Fixture DOC-059 không yêu cầu texture, nên không chứng minh skin/material production.
5. Package hiện tạo actor từ Character được chọn; không có nhánh xuất toàn bộ Prop/bối cảnh thành world Minecraft. Với MVP tối thiểu dùng bối cảnh có sẵn trong game; nếu bắt buộc xuất props, đó là công việc bổ sung cần chốt rõ.
6. Model/source hash, target rest/hierarchy, unit và quyền sở hữu root motion phải đi cùng nhau. Motion retarget khác rig không được gắn lại fingerprint giả để vượt validation. Tránh vừa bật action gốc vừa áp pose bake làm chuyển động hai lần.
7. Worker ghi `films/`, `assets/models/`, `export-manifest.json`, `export-report.json`; README yêu cầu copy vào đúng asset root của BBS. ZIP không phải cơ chế tự cài vào game. Cần xác định root bằng Film mẫu do đúng bản game tạo, không đoán đường dẫn.

## 7. Năm câu trả lời bắt buộc

1. **MVP đã hoàn thành bao nhiêu?** Không có % code hoàn thành đáng tin cậy; runtime E2E được xác nhận0/1=0%. Nhiều thành phần và một luồng same-rig tới native ZIP đã hoạt động; không gọi toàn bộ là0% implementation.
2. **Chạy đến bước nào?** Lịch sử browser đi tới ZIP native khi dùng FBX cùng rig; Retarget khác rig chỉ có preview/bake JSON tách rời. Luồng đúng yêu cầu retarget→handoff chưa thông, game chưa PASS.
3. **Tối thiểu cần gì?** Chốt fixture target Mixamo65 hoặc profile25 đúng nghĩa; tạo output retarget có model/clip tương thích; đưa clip vào timeline; chứng minh blocking key tồn tại sau reload/export; lưu package thật và kiểm game playback/edit/save/reopen.
4. **Nhanh nhất, ít sửa nhất?** Thử gate BBS trên exporter đang có trước. Sau đó chọn target Mixamo65, dùng source V9.12 để retarget→GLB→script Blender FBX rồi import vào app hợp nhất, tái dùng Scene/Animation/worker. Đây là phương án demo có thao tác thủ công, chưa được xác minh xuyên suốt. Nếu bắt buộc một app không chuyển file thủ công, cần triển khai adapter generated Motion/target model; không hứa chỉ nối một nút là xong.
5. **Bắt đầu ở đâu?** P0-01 kiểm native Film hiện có trong đúng BBS2.4 để loại rủi ro cuối chuỗi; công việc code đầu tiên, nếu cần và được duyệt, là P0-03 handoff sản phẩm retarget. Không bắt đầu bằng viết lại solver, timeline hoặc codec.

Có thể hoãn: MC25 nếu chọn nhánh Mixamo65, arbitrary rigs/formats, forward+reverse đầy đủ85action, advanced IK/contact/feet, blends/layers/onion-skin, prompt blocking/AI, props-to-world, long sequences, full native1.31.8 parity, production packaging và live MCP parity. Không hoãn kiểm source immutability, units, root motion, key persistence và game playback của fixture MVP.
