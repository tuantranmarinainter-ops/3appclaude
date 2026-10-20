# Bản đồ nguồn

**W01-PLAN-002:** [universal adapter/graph/sampler/mapping/retarget](features/rig-animation-normalization.md) nhận số xương nguồn bất kỳ; animation-only độc lập skin. [Ma trận nguồn](WORKSPACE01_SOURCE_REVIEW.md) tách import format/converter khỏi runtime support. Người dùng đã duyệt code; solver/bake, GLB Motion import và profile-based Animation assignment đã nối một phần; universal map/preview và model+skin export còn thiếu.

**Workspace01 đang triển khai (2026-10-19):** V9.12 reverse vẫn giữ nguyên. Universal package hiện có matrix retarget, mapping report, clip bake, weight remap/loss report và topology Mixamo65 pin theo built-in fixture hash. GLB/glTF clip metadata đi vào project Motion; Animation workspace có import animation-only GLB cho profile Mixamo65 và timeline placement. Chưa có source animation sampler → universal solver integration, generic mapping/preview UI, geometry/bind rewrite, export hoặc runtime CC/UE; xem [DOC-067](CHECKPOINTS.md#doc-067--2026-10-19--universal-retarget-solver-foundation) và [DOC-068](CHECKPOINTS.md#doc-068--2026-10-19--glb-animation-only-import-and-assignment-path).

## Nguồn và tình trạng kiểm tra

| Dự án | Source phát hiện | Điểm vào / giới hạn |
|---|---|---|
| Animation Studio 1.31.8 | `C:/Users/Administrator/Documents/Codex/2026-10-09/animation-studio/sites/animation-studio-mdx-alpha-1318/work/material_alpha_v1_31_8/src` | `index.html`, `app.js`, `build.mjs`; 47 source/module files, UI/scene/animation/rig/import-export |
| Retarget V9.12 | `C:/Users/Administrator/Documents/Codex/2026-10-08/retarget-anim-65-20-html/Emoticons_Mixamo_Full_Project/lab/mobile_v9_12.html` | Bundled HTML 11,388,129 bytes; scripts/build/tests riêng trong project root |
| Topview v0.1.8 | `.build-tools/topview-3d-builder-v0.1.8` (`631c08c8fd352b4ff83df33aa9a74a4563f4674b`) | Checkout đủ 929 file: Python CLI, Next/React Studio, Three.js builder, Node renderer, tests và builtin assets; 26 file CLI local khớp nội dung sau chuẩn hóa newline |

Chi tiết module/symbol nằm trong inventory YAML. Runtime đóng gói Topview có renderer/Studio JavaScript; đó không phải source gốc TypeScript/React.

## Hiện trạng

Chưa có bản app hợp nhất được nghiệm thu. Implementation đang ở bản sao riêng; source Animation1.31.8 đã đối chiếu35module+6app+2CSS với HTML; nhãn package1.31.5/lineage1.31.7 vẫn ghi provenance. [Bằng chứng](evidence/animation-lineage.yaml).

Topview0.1.8 checkout đủ929files, CLI26cached files khớp sau normalization. [source-index](inventory/source-index.yaml)977records gồm cả47Animationfiles và1RetargetHTML; regex symbol index không phải full behavioral audit. Test/runtime hiện có bằng chứng riêng trong STATUS và CHECKPOINTS; chưa phải full parity audit.

Cây dưới là thứ tự trình bày nguồn, không phải ID LISTCODE. Mã module nguồn dùng namespace animation:/retarget:/topview: và target_ids trong từng inventory; ID đích ở ARCHITECTURE/development.

## Cây source hiện trạng

```text
1.1 Animation Studio 1.31.8
  1.1.1 src/ — 47 file: shell, rig/IK, motion/timeline, scene, import/export
  1.1.2 tests/ — 138 file lịch sử theo nhiều phiên bản; không phải toàn bộ report 1.31.8
  1.1.3 outputs/ và Site — HTML giao, TEST_REPORT và artifact kiểm tra
1.2 Retarget V9.12
  1.2.1 Emoticons_Mixamo_Full_Project/lab/mobile_v9_12.html — bundle source chính
  1.2.2 work/ — builder, regression/skin scripts và Blender bridge helpers
  1.2.3 outputs/v9_12_regression/ — kết quả browser, JSON/BOBJ/BVH/GLB/FBX fixtures
  1.2.4 outputs/v9_12_skin/ — 7 kiểm tra skin/viewport và kết quả
1.3 Topview 3D Builder v0.1.8 — 929 tracked files, commit 631c08c8fd352b4ff83df33aa9a74a4563f4674b
  1.3.1 agent/topview_3d_cli/ — 24 Python modules, schema, 16 test modules và local fixtures
  1.3.2 editor/apps/studio/ — 75 file Next.js/React, workbench, API routes, locale, scripts
  1.3.3 editor/packages/builder/ — 434 file: React/Three editor, document/history, engine, evaluator, sync, UI, schema, 87 test files
  1.3.4 editor/packages/director-cli/ — 22 file Node/Playwright renderer và 5 test files
  1.3.5 builtin-assets/ — 249 file: 4 characters, 121 poses/covers, manifest, notices
  1.3.6 docs/, scripts/, skills/, plugin configs — contract, automation, test/build/install guidance
```

Chi tiết file/symbol, I/O, test map và quyết định hợp nhất: YAML [Animation](inventory/animation.yaml), [Retarget](inventory/retarget.yaml), [Topview](inventory/topview.yaml), [shared](inventory/shared.yaml). Các manifest hash pin 47 Animation files, 27 artifact Retarget và 26 file Python/schema của package cache; commit Git pin toàn bộ checkout Topview.

| Nguồn local đã thấy | Ý nghĩa và giới hạn |
| --- | --- |
| [Animation Rig](../../../Animation-Rig-1.20.1/docs/PROJECT.md), [trạng thái](../../../Animation-Rig-1.20.1/docs/STATUS.md) | Một dự án khác; không gộp nhầm với Animation Studio web |
| [BBS FS MCP merged 024](../../../BBS_FS_MCP_MERGED_024/README.md) | Chọn reuse codec/FilmEditor binary đã pin qua worker staging. Source Film2.4 phải đọc tại commit0085f77ced9232dc4e26ac51fc7d98f95d1d5b0b bằng git show, không đọc HEAD2.7 làm2.4; xem [SOURCES.yaml](SOURCES.yaml) và [đặc tả Film](features/bbs-film-export.md) |
| [Exporter BOBJ](../../../io_export_bobj_blender402_filtered/io_export_bobj/README.md) | Một nguồn exporter local được tìm thấy; chưa chọn phiên bản chuẩn |
| [Sites](../../../sites/) | Bao gồm Site sơ đồ chức năng Topview, không phải source app hợp nhất |
| [topview-projects](../../../topview-projects/) | Project scene data; không phải checkout editor source |

## Kiến trúc dự kiến

Chuẩn hóa asset → dựng scene → tạo/chỉnh motion → xuất Film và assets BBS FS.

Ba workspace dùng một manifest project; giai đoạn C có shell/UI, broker local và adapter Scene. Retarget đã trích 85 BOBJ actions, port channel/action sampler và reverse solver Mixamo65→Minecraft20; UI phát BOBJ Minecraft20 và preview source FBX bằng WebGL. `asset.import` lưu FBX gốc thành source Motion, trích Mixamo65 SkeletonProfile, tính fingerprint đúng định dạng V9.12 và ghi history transaction. Mapping editor/command lưu semantic pairs và calibration blob theo profile fingerprint; preview chỉ dùng mapping khi source hash/unit và target hierarchy tương thích. Session panel lưu/nạp native V9.12 JSON đã kiểm tra vào blob bất biến, có đường đọc cục bộ và shared Undo/Redo; Python CLI/MCP gọi cùng command broker để lưu snapshot. Preview nay dùng `sourcePose` của session khi mapping ID, source FBX SHA-256 và đơn vị trùng; solver vẫn dùng armature Minecraft20 V9.12 cố định, chưa dùng rest matrix target profile. Metarig skin, feet/hands, forward solver, bake, timeline placement và export còn thiếu. Animation chưa chuyển engine; MCP chỉ công bố command đã triển khai. Asset conversion và Film chưa triển khai.

Bước kiểm kê còn lại trước khi thay engine nguồn: hoàn thiện behavioral audit Topview/Animation/Retarget; chạy characterization/golden parity; truy serializer/importer/assets BBS FS. Code giai đoạn C chỉ tạo broker/adapter, chưa thay engine hoặc source đã khóa.

## Hợp đồng và phần mới dự kiến

[Project/API](contracts/project-v1.yaml), [commands](contracts/commands-v1.yaml), [development inventory](inventory/development.yaml) là hợp đồng đích. Phần đã code còn giới hạn theo STATUS; native source modules vẫn là nguồn hành vi, errors và serializers.

## Bản sao implementation giai đoạn C

- `../../../three-workspace-app/editor/packages/shared/src/index.ts` — shared types and Topview Zod validation; validates content-addressed assets, skeleton transforms/hierarchy, character bindings and cross-entity references. Cross-rig Retarget and trajectory/alignment remain incomplete; same-profile direct FBX supports in-place binding playback at DOC-033.
- `../../../three-workspace-app/editor/apps/studio/src/unifiedProjectStore.ts` — local project manifest, atomic replace, exact revision check, request dedupe, global history, camera.shot.set, read-only scene.evaluate with geometry checks, asset.import/relink subset, character.add, prop.add via Topview buildPropNode and same-profile `motion.place`/`motion.binding.set`.
- `../../../three-workspace-app/editor/packages/director-cli/scene-checks.mjs` and `render.mjs` — reuse Topview's Chromium mesh measurement, grounding tolerance, AABB pair metric and camera-frustum evaluator; `scene.evaluate` supplies verified local asset files and evaluated node transforms. DOC-041 adds snapshot render jobs through native Node ESM renderer imports.
- `../../../three-workspace-app/editor/packages/builder/src/evaluate/retarget/fbxSourceBones.ts` — pure structural source-bone selector; server-safe evaluate export used by Studio FBX importer/preview; recognizes FBXLoader aliases without removing source skin bones. MotionPlayer uses the same alias predicate when capturing bind transforms.
- `../../../three-workspace-app/editor/apps/studio/src/unifiedAssetFiles.ts` — bounded local upload staging, content hashes, immutable blobs, GLB/glTF/FBX profile extraction, FBX model geometry classification/unit metadata, FBX source Motion/native V9.12 fingerprints, immutable session/calibration blobs, exact-hash relink and verified asset reads. FBX texture decoding that requires a browser DOM is not covered.
- `../../../three-workspace-app/editor/apps/studio/app/api/unified/` — loopback session, project read/list, command broker và request-result routes.
- `../../../three-workspace-app/editor/apps/studio/src/LocalHostAdapter.ts` — reuses Topview HostAdapter; unified save commits scene + fcurves in one command.
- `../../../three-workspace-app/editor/apps/studio/app/workbench/` — project entry, searchable/collapsible workspace navigation, Scene editor, local asset import/list/relink/add-character/add-prop flow, Retarget 85-action library, WebGL previews, semantic mapping editor and V9.12 session panel; Animation has a same-profile FBX placement/binding edit panel, while native rig/key/layer editing remains unimplemented. Search folds Vietnamese accents and matches current workspace feature IDs; leaf-to-panel routing remains pending.
- `../../../three-workspace-app/editor/packages/retarget/src/index.ts`, `src/reverse.ts`, `src/mapping.ts`, `src/universal.ts`, `src/universalBake.ts` and `src/project.ts` — V9.12 BOBJ parser/evaluator and unchanged Mixamo65→Minecraft20 solver; arbitrary named rig graph validation, unique-name mapping suggestions, rest-relative matrix retarget, bounded frame baking to Three.js clips; legacy semantic mapping/calibration and V9.12 project JSON validation. Universal package tests currently cover synthetic graph cases only.
- `../../../three-workspace-app/editor/apps/studio/src/unifiedProjectStore.ts` and `src/unifiedAssetFiles.ts` — `skeleton.mapping.set` persists mapping/calibration; `retarget.session.set` verifies source fingerprint and persists the native V9.12 snapshot under shared project revision/history. The UI applies validated reference rotations to preview under exact source hash/unit/mapping match; target rest profile remains unsupported.
- `../../../three-workspace-app/editor/apps/studio/app/api/unified/projects/[id]/mappings/[mappingId]/calibration/route.ts` — session-protected, project/mapping-scoped read for the persisted calibration blob.
- `../../../three-workspace-app/editor/apps/studio/app/api/unified/projects/[id]/retarget-sessions/[sessionId]/native-project/route.ts` — session-protected read for a persisted V9.12 session snapshot.
- `../../../three-workspace-app/editor/apps/studio/app/workbench/components/MinecraftActionPreview.tsx` — WebGL playback/scrubbing of native V9.12 BOBJ actions on the embedded Minecraft20 armature.
- `../../../three-workspace-app/editor/apps/studio/app/workbench/components/RetargetPreview.tsx` and `RetargetSessionPanel.tsx` — local FBX loader, conditional semantic mapping and session-reference preview, V9.12 correction controls, source Motion save, and session snapshot import/save/load/download.
- `../../../three-workspace-app/editor/apps/studio/public/retarget/v9.12/` — extracted BOBJ action payload/armature, manifest, translated labels and GPL-3.0 notice/license; data hashes recorded in SOURCES.
- `../../../three-workspace-app/agent/unified_cli.py` — Python standard-library client including scene render and `film project-export`; polls jobs and saves SHA-verified client-side artifacts.
- `../../../three-workspace-app/agent/film_model_converter.py` and `agent/film_worker/blender/convert_model.py` — DOC-043 local FBX/GLB-to-BOBJ conversion via Blender; vendored unchanged BBSFix exporter/helper are GPL-2.0-or-later and identified in `agent/film_worker/NOTICE.md`.
- `../../../three-workspace-app/agent/test_film_model_converter.py` — Blender-generated rig/action/texture FBX integration fixture and boundary checks for conversion output.
- `../../../three-workspace-app/agent/unified_mcp.py` — MCP `2026-07-28` newline-delimited stdio server; exposes one validated tool for 17 broker commands including Film export and keeps stdout protocol-only.
- `../../../three-workspace-app/agent/test_unified_cli.py`, `test_unified_mcp.py` — offline tests for loopback URL, exit-code mapping, same-ID retry/recovery, MCP discovery/tool schemas/command forwarding and stdio smoke.

Implementation copy pins the same Topview revision. DOC-032: Builder 92 files/538 tests pass; Studio 25/25 with real FBX; shared/Retarget 12/12; Python CLI/MCP 30/30; build/typechecks/targeted lint pass. Legacy offline and unified browser workflow passed on Chromium 153.0.8010.12 at 1600x1000, 2 skinned meshes, unit 0.01, pose change, history, server clone and reload with zero external requests. Earlier intermittent clone IO_FAILED is unresolved; production Next build still fails AppData glob EPERM. No full format, native Animation, MCP-host or Film/game acceptance. Original source workspaces remain unchanged.

- `../../../three-workspace-app/editor/apps/studio/scripts/unified-smoke.mjs` — local UI FBX workflow with failure-aware JSON report/screenshot; requires a loopback server with isolated smoke storage. `offline-smoke.mjs` preserves legacy Scene/pose/save coverage and cleans its draft through the API.


DOC-033: in-place cho FBX direct rig qua motion.binding.set và form Sửa clip; root translation/quaternion về rest theo SkeletonProfile, giữ limb animation, unit và actor placement. Native rootMotion/inPlace và shared binding được ghi cùng transaction; validation chặn sai bone/policy/rig và document.replace xóa policy. Builder 93 files/539 tests; Studio/shared/Retarget 37/37 với FBX thật; build/typechecks/targeted lint đạt. Browser Chromium153 xác nhận root rest tại frame30/40, actor(2,0,0), tay đổi pose, Undo/Redo, clone/reload và 0 external requests. Trajectory/alignment/fades, cross-rig bake, native Animation và Film/game chưa hoàn tất; clone500 ngắt quãng và production build EPERM chưa sửa. See [evidence](evidence/root-motion.yaml), builder `engine/__tests__/rootMotion.test.ts` and `engine/objects/applySnapshot.ts`.


## DOC-034 — Root trajectory runtime

DOC-034: trajectory cho imported direct FBX tách root translation/rotation sang motionRoot dưới actor; placement/path authored không bị ghi đè. Native interpolants và rest/unit hierarchy được tái sử dụng. Loop tích lũy cả góc xoay, reverse/trim/speed giữ fractional time, origin dùng anchor nguồn và continue nối end-exclusive endpoint clip trước; seek/gap không dựa frame đã render. Shared binding/native metadata cùng revision/history; provenance path trùng nguồn trả ROOT_MOTION_CONFLICT; overlap và loop count vượt precision bị chặn. 93 file/542 Builder test; Studio/shared/Retarget37/37; build/typechecks/targeted lint đạt. Browser FBX thật đạt skeletal→trajectory world-matrix parity, max delta6.625060056109078e-9, seek lùi/reload và0 external requests. Chưa có headless root bake/export, general skeletal alignment, fades, khác-rig bake, native Animation hay Film/game acceptance; camera follow và gizmo/autosave trajectory chưa kiểm. Clone500/production EPERM chưa sửa.

- `../../../three-workspace-app/editor/packages/builder/src/engine/objects/rootMotion.ts`: native track sampling, root delta/unit hierarchy, cyclic matrix accumulation and endpoint chaining.
- CharacterObject owns optional motionRoot for direct rigs and frozen restScale; applySnapshot resets the transient group, samples/extracts root and applies its matrix once. Base root remains authored placement.
- Shared findRootMotionConflict and validation protect native/shared root policy/alignment, provenance collisions, overlap and loop precision. UI binding editor exposes trajectory + origin/continue; Python CLI/MCP reuse the existing complete binding payload.
- [Source/build/runtime evidence](evidence/trajectory.yaml). Earlier DOC-033 descriptions are historical subset evidence.


## DOC-035 — CPU evaluation

DOC-035: scene.evaluate đọc asset đã kiểm SHA/path và trả skeletonSamples CPU gồm đủ bone local pose/world matrices, placementMatrix, trajectoryMatrix, actorWorldMatrix và metersPerUnit. Dùng chung buildCharacterRig, CharacterAnimator/MotionPlayer và root sampler với browser; entrypoint /skeleton riêng không kéo renderer/MediaBunny. Native model/motion templates không bị sửa; đọc không đổi revision/history. Browser/API đối chiếu65 bone FBX thật đạt max world-matrix delta4.440892098500626e-16. Builder94 files/544 tests; Studio/shared/Retarget37/37; build/typechecks/targeted lint đạt. Thiếu source, texture/compression không decode được, rig không hỗ trợ hoặc library pose chưa nạp trả issue rõ ràng; loader chặn tài nguyên ngoài. Còn thiếu range bake/export, native Animation, Retarget khác rig, geometry checks/render và Film/game; production EPERM/clone500 chưa sửa.

- `../../../three-workspace-app/editor/apps/studio/src/unifiedSkeletonEvaluation.ts` verifies/decodes local model/motion sources and reports unsupported cases without exposing paths.
- `../../../three-workspace-app/editor/packages/builder/src/headless/skeletonEvaluator.ts` provides createSkeletonEvaluator through /skeleton and /headless; models and motions are passed by the host, no package I/O. It reuses the extracted CharacterObject.buildCharacterRig, native source registration and applySnapshot playback/root transforms.
- scene.evaluate remains a read command; returns authored transforms separately from skeletonSamples matrices. CPU resources are disposed after each request. Range jobs can reuse the persistent evaluator later; no job/bake implementation is claimed.
- [Evidence](evidence/headless-skeleton.yaml).


## DOC-036 — Range sampler

DOC-036: sampler CPU stream range inclusive sang grid20Hz + một endpoint left; 3s@30 cho61 mẫu, đoạn1s cho21. Endpoint chọn clip trước tại cut, loop/reverse không wrap về pose đầu; trajectory/path cùng ownership, trim/speed/fractional time giữ nguyên. Host chọn CharacterID tường minh, preflight source một lần và dispose trong finally; không tạo artifact sản phẩm/job. API/range nay áp saved user keys như browser mặc định. Range FBX thật phát hiện pose reset làm hỏng64 alias; applyPose bỏ qua alias và stopAll dừng cả action đã clamped. Browser kiểm đủ64 alias identity sau gap và giữ CPU/browser65-bone parity. Builder95 files/549 tests; Studio/shared/Retarget37/37; build/typechecks/targeted lint đạt. Chưa có converter/export/job/Film codec hoàn chỉnh hoặc camera/shot export endpoint; full acceptance còn thiếu.

- `../../../three-workspace-app/editor/packages/builder/src/headless/sampleSkeletonRange.ts` streams selected inclusive range to regular sample clock and left endpoint; exported through /skeleton and /headless.
- Runtime-only flags in FrameSnapshot/SceneContract, clips/evaluateSteps and rootMotion apply owned motion/path samples without changing preview defaults.
- `../../../three-workspace-app/editor/apps/studio/src/unifiedSkeletonEvaluation.ts` supplies selected range preflight/reusable CPU evaluator and projectEvaluationScene saved key overlays; store uses the same scene setup.
- applyPose alias handling and CharacterAnimator.stopAll fixes are reused by browser and CPU. [Evidence](evidence/range-sampling.yaml).


## DOC-037 — Camera/shot range

DOC-037: camera/shot CPU sampler dùng CameraRig và helper applyEvaluatedCamera chung với viewport; xuất position/quaternion/lookAt/verticalFov/aspect/near/far, sourceFrame và thời gian shot/sequence. Giữ left/right riêng tại cut, loop endpoint không wrap, manual roll/user keys/own aspect/path/orbit được kiểm. sampleProjectCameraSequence gắn sourceRevision và saved overlays; không mutate project. Camera bám target có trajectory bị chặn tới khi effective-world subject evaluation được nối. Builder96 files/554 tests; Studio/shared/Retarget37/37; build/source-test typechecks/targeted lint đạt. Browser FBX regression đạt65-bone CPU parity và64 aliases identity sau gap. Snapshot hai shot3s tạo62 mẫu gồm hai endpoint, cut t=1 giữ previous-left/next-right. Chưa có Film codec/assets/export jobs, grid20Hz cut preflight hoặc game acceptance.

- `../../../three-workspace-app/editor/packages/builder/src/headless/sampleCameraSequence.ts`: validates editorial/camera and streams each shot with explicit boundary/time. Exported via /skeleton and /headless.
- `../../../three-workspace-app/editor/packages/builder/src/engine/objects/cameraTransform.ts`: shared viewport/CPU transform, keeps authored roll and evaluated quaternion.
- CameraRig/evaluateSteps honor runtime export boundary and separate chain cache. Host sampleProjectCameraSequence uses saved overlays/sourceRevision. [Evidence](evidence/camera-sampling.yaml).


## DOC-038 — Animation workspace reuses Topview editor

`../../../three-workspace-app/editor/apps/studio/app/workbench/components/StudioOverlay.tsx` mounts the same public Topview `DirectorStudio` in Scene and Animation. `AnimationWorkspace.tsx` places that editor beside the existing FBX clip/binding panel; both receive the same `LocalHostAdapter`, project ID and history. This exposes Topview rig controls, pose tools and timeline/key editing in Animation while reusing existing code.

Typecheck, targeted lint and Chromium153 real-FBX browser smoke passed. The UI asserts the Animation viewport canvas and Animation controls mount together; the broader workflow also verifies 65-bone CPU/WebGL parity, clip/root playback and history. [Evidence/report](evidence/animation-workspace.yaml). This does not implement Animation1.31.8-specific IK, skin, graph/layers, motion-lab, compare/onion-skin or native edit serialization; acceptance remains partial.

## DOC-039 — Effective-world camera subjects

- `../../../three-workspace-app/editor/packages/builder/src/evaluate/FrameSnapshot.ts`, `evaluateFrame.ts`, and `sceneFromDocument.ts`: an optional non-wire resolver can replace subject transforms after character/path/key evaluation and before camera binding.
- `../../../three-workspace-app/editor/packages/builder/src/headless/sampleCameraSequence.ts`: continues to reject trajectory targets when no resolver is supplied, preserving the safe low-level contract.
- `../../../three-workspace-app/editor/apps/studio/src/unifiedSkeletonEvaluation.ts`: project sampler preloads only referenced trajectory Character sources, uses `createSkeletonEvaluator` per frame, resolves actor world position/yaw, and exposes an async generator with cleanup.
- Tests cover static-camera regressions, missing resolver rejection, synthetic rotation offsets, and per-sample parity against the real Punch Combo actor world matrices. [Evidence](evidence/camera-subject-sampling.yaml).

## DOC-040 — Scene geometry checks

`../../../three-workspace-app/editor/apps/studio/src/unifiedProjectStore.ts` stages the referenced hash-verified assets for one read-only query and forwards saved frame transforms to `@topview/3d-director-cli`. `scene-checks.mjs` assembles grounding, pairwise AABB overlap, frustum results and partial/unavailable issues; `render.mjs` applies frame transforms after Topview's timeline seek before measuring actual mesh geometry. Primitive Chromium tests verify all three checks, and the optional Punch Combo integration verifies local FBX mesh bounds plus missing-source handling. The project revision/history remains unchanged. DOC-041 below implements Scene PNG/contact-sheet jobs; animated-mesh parity remains pending. [Evidence/source hashes](evidence/scene-geometry-checks.yaml).

## DOC-041 — Snapshot render jobs

- `../../../three-workspace-app/editor/apps/studio/src/unifiedJobs.ts`: snapshot, renderer slot, asset staging, progress/cancel, ten terminal jobs, file hashes and path-scoped reads.
- `../../../three-workspace-app/editor/apps/studio/next.config.mjs`: native ESM externals for renderer/check modules because Next's default external matcher misses workspace symlinks.
- `../../../three-workspace-app/editor/apps/studio/app/api/unified/projects/[id]/jobs/`: session/Origin-checked job and artifact reads.
- `../../../three-workspace-app/editor/apps/studio/app/workbench/components/scene-render/`: React view, private hook and output/hash utilities; select frame/cameras and client directory, poll/cancel/save, preserve existing folders.
- `../../../three-workspace-app/agent/unified_cli.py` and `unified_mcp.py`: client-only output paths, stable retry capability, job polling/cancel and SHA-verified writes.
- `../../../three-workspace-app/editor/apps/studio/scripts/scene-render-smoke.mjs`: live Next render/browser OPFS regression; OS folder picker is explicitly substituted.

DOC-041: immutable Scene render jobs now run through the live Next host using native ESM renderer externals. Fixed concurrent-start reservation, cancel cleanup, stale revision errors, dry-run cancel, CLI/MCP retry identity and browser save errors. UI selects up to three cameras; two cameras at frames 0/45/89 produced nine SHA-verified files in real browser OPFS without changing history. 46 Studio/shared/Retarget/navigation tests, 37 Python unified tests and 29 director-cli tests passed; Builder 553 passed/1 skipped. All package typechecks and root lint/locale checks passed. Legacy offline and real-FBX browser smoke passed. OS folder picker and live MCP host remain unverified. Production Next build still fails AppData junction EPERM; legacy Python suite has 218 passed, 11 failed, 10 errors, 4 skipped from asset-manifest/Windows packaging/mtime issues. Full app remains incomplete. [Evidence](evidence/scene-render-jobs.yaml).

## DOC-042 — Offline Film worker

- `../../../three-workspace-app/agent/unified_cli.py`: adds `film export MANIFEST --output-dir EXISTING_FOLDER`; the command invokes the local worker directly and does not open a Studio session.
- `../../../three-workspace-app/agent/film_worker.py`: checks manifest size, local paths, Java 17 and pinned bridge/Gson SHA-256, then compiles into a temporary directory and runs the worker.
- `../../../three-workspace-app/agent/film_worker/src/main/java/local/bbsmerged/FilmExportWorker.java`: validates the typed manifest and assets, creates an isolated package with BBS FS 2.4 `FilmEditor`, writes actor/camera/action/pose tracks, performs codec/structural read-back, and publishes the new package directory.
- `DraftEditor.java` is an app-local MIT-attributed adaptation that adds `pose_transform` keyframes. Vendored bridge/Gson licenses and source hash are recorded in `agent/film_worker/NOTICE.md`.

DOC-042 tests pass 2/2 with Java 17 plus 38/38 Python CLI/MCP tests. This is a manifest-only worker: shared-project sampling, automatic BOBJ conversion, UI/API/MCP job, exact source-value parity, Minecraft playback and Film Editor edit/reopen are still open. [Evidence](evidence/film-export-worker.yaml).

## DOC-046 — Project samples to editable Film pose tracks

At DOC-046, `../../../three-workspace-app/editor/apps/studio/src/filmPoseBake.ts` mapped source rest hierarchy to converter BOBJ global rest matrices, checked one common basis, removed actor placement, then emitted rest-relative `pose_transform` tracks. `unifiedFilmSampling.ts` joined the baked actor tracks with sampled camera clips. That checkpoint passed 26/26 tests and Studio typecheck; the project integration used a synthetic typed BOBJ profile, while the separate converter matrix probe had not yet passed through the baker. DOC-047 extends this path as recorded below. [DOC-046 evidence, hashes and limits](evidence/film-pose-bake.yaml).

## DOC-047 — Film export manifest builder

`../../../three-workspace-app/editor/apps/studio/src/filmManifest.ts` joins project samples, converter BOBJ profiles and file hashes into the worker's typed manifest, including one actor transform sample per tick, camera clips and editable pose tracks. A generated one-bone FBX passed through the real converter, builder and Java 17 worker to successful native readback. This does not yet invoke those tools as a project job or establish Film Editor/game parity. [Evidence](evidence/film-manifest-builder.yaml).

## DOC-048 — Project-scoped Film job

`../../../three-workspace-app/editor/apps/studio/src/unifiedJobs.ts` now runs project sampling→source verification→Blender conversion→manifest building→Java Film worker and stores the completed ZIP as a hash-verified job artifact. `unifiedProjectStore.ts` exposes `film.export`; Studio `film-export/` panel, CLI `film project-export` and MCP retain output folders client-side and fetch only completed verified artifacts. A generated static two-bone FBX completed the project-scoped job and native worker readback; browser interaction and animated production rigs remain unverified. [Evidence](evidence/film-project-export-job.yaml).

## DOC-045 — Shared-project Film sampling input

`../../../three-workspace-app/editor/apps/studio/src/unifiedFilmSampling.ts` freezes a valid project snapshot, validates selected Characters, direct rig profiles, units/basis, source shot coverage and 20 Hz limits, then reuses `sampleProjectSkeletonRange` and `sampleProjectCameraSequence`. `filmCamera.ts` converts camera orientation to the BBS camera track while keeping both sides of a cut. The output is an internal converter input with source revision and dependency hashes; it is not yet accepted by the Java worker. Punch Combo project sampling and camera conversion tests passed, as did Studio typecheck. [Evidence, hashes and limits](evidence/film-project-sampling.yaml).
