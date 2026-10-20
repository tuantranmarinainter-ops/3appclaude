# Checkpoints

## DOC-116 — 2026-10-20 — Universal local-chain regression and Workspace01 checks

- Fixed a shared solver defect in `packages/retarget/src/universal.ts`: quaternion multiplication mutated the calibration frame before the inverse frame was read, cancelling each local rotation delta to identity. The conjugation now uses a stable frame anchored to the first mapped chain parent.
- Added an assertion diagnostic for the local-chain regression, tested two distinct source topologies against canonical Mixamo65, corrected the pinned Mixamo65 GLB and 85-action catalogue test paths to resolve from `import.meta.url`, and extended Studio Assignment integration to create Characters A/B/C, assign only to C, preserve the source Motion, and verify no Binding was created for A/B.
- Checks: all Retarget tests 59 PASS; Studio normalization/import tests 33 PASS/1 SKIP; Python CLI/MCP 47 PASS; Builder evaluate 557 PASS/1 SKIP; Retarget and Studio package typechecks PASS; `pnpm lint` and locale validation PASS.
- The first full workspace `pnpm typecheck` overlapped with Builder's clean build and observed missing generated `.d.ts` files in `packages/shared`; a sequential rerun passed all five workspace typechecks. Workspace production build reached Studio and failed on `EPERM scandir C:\Users\Administrator\AppData\Local\Application Data`; offline smoke ran before a build existed and failed for that reason, so it is not a valid runtime result.
- Real CC/UE/other external source files are absent from the workspace. Synthetic different-topology rigs, GLB roundtrip, profile selection, Minecraft20 and catalogue85 tests pass, but external-source import/runtime and browser/WebGL remain NOT_RUN. No game, commit, push or publish.
- Existing demo port 3118 is occupied but its health request timed out; no second server was started and the existing process was left untouched.
- Status: `.3.2` improved but broader task remains partial; Workspace01 acceptance remains 0/8. See [validation evidence](evidence/workspace01-doc116-validation.yaml).

## DOC-113 — 2026-10-20 — Universal calibration reference pose and persistence

- Universal calibration v1 now validates quaternion/reference snapshots, persists source/target poses as immutable blobs, and binds calibration to source hash, mapping digest and reference-pose SHA. Normalization plan rejects stale profile/action/hash data and includes calibration/reference hashes plus root policy/scale in its hash; the shared solver uses those snapshots, global alignment and per-role corrections. Legacy V9.12 calibration remains on its prior path.
- Normalization preview can store the current source Action frame with target rest or a supported target Action sampled at the shared playhead. UI adds global axis alignment and per-role rotation controls. Adapter includes all profile bones so non-deforming/helper bones can be captured.
- Tests: Studio import + mapping 26 PASS/1 SKIP; Retarget Universal 15 PASS; Studio and Retarget typecheck, workspace lint and locales PASS. Synthetic end-to-end covers hash-bound persistence/reload and verifies changed alignment changes plan/output hashes; unit test confirms rest+identity parity with legacy default.
- Isolated Next build `.next-doc113-cal` fails during webpack tracing with `EPERM scandir C:\Users\Administrator\AppData\Local\Application Data`; scoped output was removed after verifying the path. Browser/WebGL, real fixture and game runtime were not run per user choice.
- Limits: separate target-action scrubber/comparison, preset v4 and CLI/MCP parity remain open. This is partial task1.3.4.3.1 only; Workspace01 remains 0/17 remaining tasks complete and 0/8 accepted gates. See [validation evidence](evidence/workspace01-doc113-validation.yaml).

## DOC-112 — 2026-10-20 — Multi-skeleton import, selection and Action ownership

- GLB/glTF imports now extract one profile per distinct skin using glTF node indices; FBX code separates bone components. Shared profile validation permits repeated display names while requiring unique IDs. Profile links resolve by source UUID/index instead of treating names as identity.
- `asset.import` persists multiple profiles and routes an Action Motion to one profile only when channel node identity resolves uniquely. Ambiguous/unmapped Actions remain in the original asset and produce an issue with `actionIndex`; valid sibling Actions still import. FBX follows the same policy when track names/UUIDs identify one component.
- `rig.inspect` accepts optional `skeletonProfileId` and requires explicit choice for ambiguous sources. Retarget panel and Model+Rig panel expose the profile choice; normalization/Assignment/preview pass profile IDs through inspection, sampling, and plan.
- Evidence: synthetic multi-skin GLTF with duplicate names, per-Action profile routing, ambiguous shared-root Action retention and host persistence; explicit profile-inspection regression. Combined Retarget + Studio import suite78 tests:77 PASS/1 SKIP; workspace typecheck PASS; workspace lint/locales PASS; Builder evaluate557 PASS/1 SKIP.
- Studio Next production build retried in isolated `.next-doc112`: fails while tracing the Windows Local `Application Data` junction (`EPERM scandir`); the exact isolated output directory was removed. No source of the broad glob was identified; no tracing exclusion added.
- Limits: real FBX multi-component import is not fixture-tested; no source fixture/browser/WebGL/game runtime ran. Converter identity/lifecycle and broader capability/loss policy remain open. Current W01 remaining task count stays0/17 complete and accepted gates0/8. See [validation evidence](evidence/workspace01-doc112-validation.yaml).

## DOC-111 — 2026-10-20 — Action diagnostics and normalization budget

- `createThreeRigAdapter` can collect blocking track issues per Action for inspection. Valid Actions remain inspectable/sampleable; sampling an Action with unsupported channels is blocked, so the adapter does not silently bake a partial clip. The Studio Action selector and plan display the issue count/details.
- Added shared `estimateUniversalBakeCost`: reports `(source nodes + target nodes) × samples`, estimates retained working-set bytes, and gates at 50,000,000 node-samples / 768 MiB before frame allocation. Existing 18,000 sample cap and abort checks remain. Cost and Action issues are included in the plan/hash.
- Checks: Retarget + `unifiedAssetImport` tests 73 PASS/1 existing SKIP; full workspace typecheck PASS; `pnpm lint` and locale checks PASS; Builder `test:evaluate` 557 PASS/1 SKIP.
- Build probe: Studio Next build fails with `EPERM` while NFT traces `C:/Users/Administrator/AppData/Local/**/*`; Windows junctions `Application Data`, `History`, and `Temporary Internet Files` reject scans. The producing source was not identified, so no tracing exclusion was added. Offline smoke was not run after the failed build.
- Runtime/WebGL remains deferred by user choice. Workspace01 still has 0 fully completed remaining tasks and 0/8 accepted gates. `.2.1` identity/skeleton selection and the wider `.2.2` importer/capability policies are not complete.

## DOC-110 — 2026-10-20 — Builder scene-basis layer and Vitest gates

- Pure evaluator now returns column-major scene-basis elements; Three.js `Matrix4` construction lives in the engine adapter. Package subpath `@topview/3d-builder/evaluate` exposes a compatibility facade retaining `sceneBasisMatrix` and adding `sceneBasisElements`.
- Replaced the `node:test` sceneBasis test that Vitest had rejected as a suite with Vitest coverage for matrix elements and the legacy adapter conversion.
- Checks: Builder typecheck PASS; Builder lint PASS; `test:evaluate` 557 PASS/1 SKIP; Builder build PASS; workspace `pnpm typecheck` PASS; workspace `pnpm lint` and locales PASS.
- Workspace `pnpm build` still fails in Studio Next.js with `EPERM scandir C:\Users\Administrator\AppData\Local\Application Data`; isolated `.next-doc109` output reproduces it. Root cause remains unknown. Offline smoke was not run because the Studio build did not produce a valid build. Runtime/WebGL/game not run.
- Scope: partial completion of W01-PLAN-003 task1.3.4.8.1; accepted gates remain0/8.

## DOC-109 — 2026-10-20 — Workspace01 remaining-work specification

- Documentation only: W01-PLAN-003, 17 child tasks, dependency inventory and LISTCODE links. Baseline application remains DOC-108.
- Focused static inspection confirms name-based profile/skin links, multiple-skeleton rejection, V9.12-only calibration persistence, missing fitted target profile and three separate model-to-Scene writes. Existing 8-influence recovery and pre-Apply weight-loss review are retained.
- New algorithm/contracts are proposals pending implementation confirmation. Source-fixture/runtime work remains deferred; accepted gates remain 0/8.
- Documentation validation results are recorded in [evidence](evidence/workspace01-plan003-validation.yaml). No application build/tests/browser/game executed in this documentation change.

## DOC-108 — 2026-10-20 — Secondary glTF skin influences and pre-apply review

- Three.js GLTFLoader omits `JOINTS_1/WEIGHTS_1`; the Model+Rig loader now resolves those accessors through its parser, restoring raw weight sets for owner selection and transfer. Core rebind now evaluates rest positions with all eight influences, enforces valid finite/nonnegative weights summing to 1, transfers to four output slots, removes source-indexed secondary attributes from output, and reports dropped weight/affected vertices.
- Model+Rig UI now stages the GLB/report without project writes, shows per-mesh loss and max rest error, and only uploads/imports/creates the Scene Character after explicit confirmation. Staged output is invalidated when selection, owner or project revision changes.
- Tests: all 15 Studio test files 68 PASS/2 SKIP; full Retarget suite 52/52 PASS (includes 85 legacy actions and Mixamo65↔Minecraft20 coverage); workspace typecheck, focused Studio ESLint and locale checks PASS. `pnpm lint` retains two existing restricted imports in Builder `sceneBasis`; `pnpm test:evaluate` 554 PASS/1 SKIP but fails because `sceneBasis.test.ts` registers no Vitest suite. Builder build passes; Next build fails on Windows `Application Data` junction scan (`EPERM`), so offline smoke cannot find `.next`.
- Runtime/browser/WebGL and external rig fixtures remain deferred; Workspace01 remains 0/8 accepted gates.
- Limits: three.js/output support remains four influences at runtime, so set 1 is transferred and any discarded weight is presented for review. Source formats beyond self-contained GLB/GLTF and FBX are not added.

## DOC-107 — 2026-10-19 — Excluded source-bone audit trail

- Normalization plan now resolves every explicitly ignored source bone to its profile name and carries its ID/name/reason in the plan hash. The same list is included in the baked Motion report and shown in the plan UI before normalization; skin-transfer ownership remains a separate policy.
- Added an integration regression excluding an optional source bone, checking the plan list, staged report, and persisted JSON derivative after import/undo/redo. `unifiedAssetImport.test.ts`: 18 PASS/1 existing SKIP; affected Retarget mapping/universal/metrics/preset tests: 26/26 PASS; workspace `pnpm typecheck`, focused Studio ESLint and locale checks PASS.
- Runtime/browser/WebGL and external fixtures remain deferred. Workspace01 stays 0/8 accepted gates; skin-loss measurement/owner handling is still separate and incomplete.

## DOC-106 — 2026-10-19 — Per-bone source-chain rotation weights

- Added optional `sourceBoneWeights`, aligned with `sourceBoneIds`, through shared project validation, host mapping persistence, semantic/universal validators, normalization plan, Three.js preview, weighted quaternion solver and solver-consistency metrics. Values are relative, finite and nonnegative with at least one positive weight; missing vectors preserve equal weighting. Root travel stays with the first source bone even when its rotation weight is zero.
- Mapping editor exposes per-bone numeric weights. Portable mapping preset v3 stores vectors and continues to import v1/v2 with equal-weight defaults. Added tests for weighted rotation, root ownership, invalid vectors, host persistence/plan hash propagation, metrics parity and preset compatibility.
- Checks: Retarget 51/51 PASS (includes 85-action manifest regression); Studio 66 PASS/2 existing SKIP; workspace typecheck and focused Studio ESLint PASS.
- Required upstream gates remain: `pnpm lint` finds the two existing restricted `three` imports in Builder `sceneBasis.ts` and its test; `pnpm test:evaluate` reports 554 PASS/1 SKIP but fails because the same `node:test` file registers no Vitest suite; Builder build passes, Next.js build fails scanning Windows `AppData\Local\Application Data` with `EPERM`.
- Browser/WebGL, offline smoke and real fixtures were not run because runtime is deferred pending fixtures. Workspace01 remains 0/8 accepted gates.

## DOC-105 — 2026-10-19 — Skin owners for mapped source chains

- Fixed Model+Rig skin ownership so each source joint in a confirmed many-to-one chain defaults to that target role's Mixamo65 joint. The UI can still override each weighted source joint independently; the shared owner resolver is used by both the editor and GLB rebind path.
- Added a focused regression for chain owner expansion. Full Retarget suite 48/48 PASS; full Studio suite 66 PASS/2 existing SKIP; workspace typecheck PASS; focused Studio ESLint PASS. `unifiedAssetImport.test.ts` currently reports 18 PASS/1 existing SKIP.
- Required broader checks: `pnpm lint` remains blocked by two existing restricted `three` imports in builder `sceneBasis.ts` and its test; `pnpm test:evaluate` has 554 PASS/1 SKIP but fails because that `node:test` file registers no Vitest suite; `pnpm build` builds the Builder then Next.js fails scanning the Windows `AppData\Local\Application Data` junction with `EPERM`.
- No browser/WebGL/runtime validation was run because runtime is deferred pending source fixtures. W01 remains 0/8 accepted gates.

## DOC-104 — 2026-10-19 — Many-to-one source chain mapping

- Extended saved semantic mappings with optional ordered `sourceBoneIds` while preserving `sourceBoneId` as the compatibility base. Shared project validation and host validation require distinct IDs along one ancestor path and account for every chain bone when validating ignored-bone reasons.
- Universal retarget maps each chain to one canonical target joint using an equal quaternion mean of world-space rotation deltas; root travel stays owned by the mapped base bone. Plan, preview, normalization metrics, mapping UI and portable preset v2 carry the chain; v1 presets remain importable.
- Checks: full Retarget suite 48/48 PASS, including equal-mean chain rotation, primary-owned root travel and 85 legacy action regression; full Studio suite 65 PASS/2 existing SKIP, including host persistence, project validation and V9.12 session regression; workspace typecheck PASS; focused Studio ESLint PASS.
- Limits: no adjustable per-source weights, local-space chain composition or end-effector length calibration; exclusion/skin-loss remains a separate unsolved policy. Browser/runtime remains deferred; Workspace01 stays 0/8 accepted gates.

## DOC-103 — 2026-10-19 — Synchronized universal retarget skeleton preview

- Added a local Three.js preview for the selected source Action and canonical Mixamo65 target. Both skeletons sample the same time through `createThreeRigAdapter` and `createUniversalRetargeter`; users can play, pause and scrub. Source/target profile identity, mapping links, unit/basis conversion and root policy/scale are applied before drawing.
- Checks: full Studio tests 65 PASS/2 existing SKIP; preview segment utility 2/2 PASS; workspace `pnpm typecheck` PASS; focused ESLint PASS; `git diff --check` PASS.
- Required broader gates remain blocked by existing builder issues (`pnpm lint`: two restricted `three` imports; `pnpm test:evaluate`: 554 PASS/1 SKIP plus the `node:test` file that Vitest reports as having no suite) and the Windows Next.js build `EPERM` junction scan. Offline smoke and browser preview were not run; the user asked to defer runtime until fixtures are available.
- Preview intentionally draws skeleton lines only. It does not validate skin deformation, mesh/material fidelity, frame parity in a browser or external fixtures. No browser/WebGL runtime was launched per the fixture choice; Workspace01 remains 0/8 accepted gates.

## DOC-102 — 2026-10-19 — Universal source rig inspection tree

- Connected the existing `rig.inspect` graph, profile links and joint list to the Workspace 01 panel. The tree shows the arbitrary source hierarchy, bone IDs, matched versus missing/ambiguous profile links, search with ancestor context, and collapse/expand controls.
- Checks: `RigTree.test.ts` 2/2 PASS; full Studio test set 63 PASS/2 existing SKIP; workspace `pnpm typecheck` PASS; focused ESLint PASS; YAML parse/unique IDs and `git diff --check` PASS. Corrected the legacy Mixamo fixture to use the pinned canonical 65-bone hierarchy; its V9.12 persistence regression now passes instead of testing a 65-node but non-Mixamo topology.
- Gate 1.3.4.2 remains partial: action inspection and source bone tree are visible, while synchronized source/target preview, capability/loss display and fixture runtime are outstanding. Workspace01 remains 0/8 accepted gates.

## DOC-101 — 2026-10-19 — Root travel calibration through normalization

- Added `rootTranslationScale` (0.01–20, default 1) to universal normalization. Preserve mode scales source root travel; in-place ignores it. Value is part of the plan hash and staged report, and is wired through Studio UI, host plan/run, CLI and MCP.
- Checks: workspace `pnpm typecheck` PASS; focused ESLint PASS; Studio normalization suite 18 PASS/1 existing SKIP, including scale-bound rejection, plan-hash change and report propagation; Retarget 45/45 PASS; Python CLI/MCP unittest 47 PASS.
- Full editor gates: `pnpm lint` BLOCKED by existing restricted `three` imports in builder `sceneBasis.ts` and `sceneBasis.test.ts`; `pnpm test:evaluate` has 554 PASS/1 SKIP and one existing failed suite because `sceneBasis.test.ts` registers no Vitest suite; `pnpm build` reaches Next.js then fails with Windows `EPERM scandir` on `C:\Users\Administrator\AppData\Local\Application Data`; `test:offline` cannot start because that build did not create `.next`.
- Broader Python `pytest -q` cannot collect the unrelated Topview CLI suite because installed Python lacks `jsonschema`; focused unified CLI/MCP tests use unittest and pass.
- Remaining calibration work: A/T-pose and proportion adjustments, chain many-to-one rules, explicit exclusion policies, visual comparison and external fixture/runtime acceptance. Workspace01 remains 0/8; no game/browser run per fixture choice.

## DOC-100 — 2026-10-19 — Persist Model+Rig rebind report

- `asset.import` now accepts an optional Model+Rig+Animation report only with one GLB. The host verifies its GLB hash, source asset/hash, source/target fingerprints, confirmed mapping, target-profile Motion and bounded mesh/joint metrics, then stores immutable JSON under the imported asset's derivatives.
- The Studio flow sends the report in the same Asset import transaction and offers a readback button. Report data records `producer: studio-client`; host checks identity, shape and bounds but does not recompute client-side deformation metrics.
- Checks: workspace `pnpm typecheck` PASS; focused ESLint PASS; `modelRebindUtils.test.ts` + `unifiedAssetImport.test.ts`: 20 PASS/1 existing SKIP, including malformed-report rejection and successful hash-bound sidecar persistence/readback; full Retarget suite 45/45 PASS; YAML IDs/source refs and `git diff --check` PASS.
- Required broader gates: `pnpm lint` still fails only on the existing `three` restricted imports in builder `sceneBasis.ts` and `sceneBasis.test.ts`; `pnpm test:evaluate` has 554 PASS/1 SKIP and the existing `node:test`-style `sceneBasis.test.ts` Vitest suite failure; `pnpm build` is blocked by `EPERM scandir C:\Users\Administrator\AppData\Local\Application Data`; offline smoke then cannot start because the failed build left no `.next` production build.
- Not verified: browser/WebGL interaction, external model fixtures, independent metric recomputation, texture/material fidelity or in-game playback. Workspace01 acceptance remains 0/8.

## DOC-099 — 2026-10-19 — Model + Mixamo65 rig + animation workflow

- Added a Studio workflow to select a source skinned FBX/GLB, an existing Mixamo65 profile, a confirmed mapping and a normalized Motion. Every positively weighted source joint requires an explicit Mixamo65 skin owner; saved semantic pairs prefill owners, and the operator can correct them before export.
- The workflow normalizes source/target units and basis, rebinds mesh skin weights to the canonical 65-joint hierarchy, attaches the selected canonical clip, exports GLB, imports its model and Motion, adds the resulting Character to Scene, and places the imported Motion on its timeline. The original source asset remains unchanged.
- Studio typecheck PASS; focused ESLint PASS. Synthetic skin transfer, rest-drift and GLB export/reimport remain covered by the existing Retarget package tests (45/45 were run in DOC-098; no Retarget package code changed in this checkpoint).
- Not verified: actual browser/WebGL, external fixtures, multi-skeleton or >4-influence models, texture/material roundtrip quality, and game playback. User selected code-only until fixtures are available; Workspace01 acceptance remains 0/8.

## DOC-098 — 2026-10-19 — Assignment host commit and workflow

- Added `animation.assignment.run` as a cancellable job producing a hashed GLB/report. `asset.import` with `assignmentJobId` (also exposed as `animation.assignment.commit`) checks exact project revision/snapshot, source Motion/receiver identity and output skeleton rest or embedded target fingerprint.
- A successful commit adds the derived asset/Motion, places a non-overlapping clip on the chosen Character timeline and records its MotionBinding/provenance in one revision; Undo/Redo tests remove/restore the complete assignment. Reopening a saved assigned Motion resolves its receiver profile and reconstructs canonical bone names from the output fingerprint.
- Added Retarget Assignment panel, CLI `rig assignment-plan|assignment-run|assignment-save`, and MCP plan/run/commit commands. Updated source-to-target Motion profile resolution.
- Checks: Studio typecheck PASS; `unifiedAssetImport.test.ts` 16 PASS/1 existing SKIP, including run/commit/placement/replan/undo/redo; Python CLI/MCP 46/46; Retarget suite 45/45.
- Not verified: browser/WebGL preview, real receiver models/external fixtures, or game playback. Assignment remains staged until explicit commit; successful project commit is atomic.

## DOC-097 — 2026-10-19 — Portable Mixamo65 mapping preset

- Phạm vi: hoàn thiện phần preset của LISTCODE 1.3.4.3 trong Retarget package và normalization mapping editor; không sửa solver, V9.12 calibration format hoặc project schema.
- Hành vi: JSON preset versioned lưu 65 semantic roles, source/target bone names và fingerprints, không lưu profile-local bone IDs. Import kiểm schema/role order, remap exact normalized names duy nhất, báo profile fingerprint khác và slot thiếu/trùng; UI yêu cầu xác nhận đã rà soát trước khi lưu. Export không có I/O server và không đổi project.
- Thay đổi: `packages/retarget/src/mappingPreset.ts`, exports/test; `apps/studio/app/workbench/components/normalization/MappingEditor.tsx`; LISTCODE/STATUS/inventory cập nhật.
- Kiểm tra: toàn Retarget suite 45/45 PASS; Retarget typecheck PASS; Studio typecheck PASS; ESLint panel PASS.
- Chưa xác minh: tương tác browser thực, preset JSON từ nguồn ngoài, runtime rig thực, calibration universal, skin ownership và gates W01. Mapping preset không khẳng định chất lượng chuyển động; tổng nghiệm thu vẫn 0/8.

## DOC-096 — 2026-10-19 — Normalization solver consistency metrics

- Added streaming per-frame metrics to normalization reports: mapped world rotation max/RMS degrees, root translation max error in normalized meters, and target segment-length change. Existing report persistence carries these fields without a new project schema.
- Scope explicitly solver-consistency; expected rotations derive from the same rest-relative convention. This is not independent semantic accuracy or animation quality. Contact drift, semantic mapping accuracy and mesh deformation remain null until independently measured.
- Test perturbs output90°/2m and confirms metrics detect it, while valid normalization reports frame counts/zero root error. Focused4/4 PASS; Retarget and Studio typechecks PASS. No contact annotations/real-source thresholds/browser acceptance;0/8.

## DOC-095 — 2026-10-19 — glTF matrix rest profile import

- Fixed glTF skeleton profile extraction that previously ignored node.matrix and substituted identity TRS. Affine invertible TRS-decomposable matrices now preserve rest translation/rotation/scale; mixed matrix/TRS, shear, singular/nonfinite determinant and malformed TRS field types reject explicitly.
- Regression verifies matrix and equivalent TRS produce identical profile fingerprints, checks rest pose and malformed input rejection. Studio suite16 PASS/1 existing SKIP; Studio typecheck PASS before final malformed-field/determinant guards, lint PASS after them.
- Does not add shear/reflection retargeting or inverse-bind/profile reconciliation for arbitrary exporter conventions. Assignment apply, model host/UI and external-source/browser acceptance remain incomplete;0/8.

## DOC-094 — 2026-10-19 — Explicit normalization root translation policy

- Added preserve/in-place rootTranslationPolicy across universal solver, normalization/report, host plan/run and panel. Default preserves meter displacement; in-place removes mapped root translation while retaining rotations. Policy is part of plan args/hash and changing it invalidates UI plan.
- Roundtrip test confirms in-place final root travel is zero and source immutable; existing preserve/fractional-endpoint tests retain their behavior. Combined normalization/host suites18 PASS/1 existing SKIP; Retarget/Studio typechecks and Studio lint PASS after type narrowing repair.
- Trajectory extraction/actor ownership, contact preservation, CLI convenience flag and browser policy interaction are not covered by this change. Assignment apply/model workflow/calibration/real-source acceptance remain open;0/8.

## DOC-093 — 2026-10-19 — Assignment loads baked native Motion derivative

- Extended host rig loader with optional Motion identity: native Animation1.31.8 Motion uses verified sourceClip blob and its exact profile, GLTF loader and explicit joint names. Inspection/provenance use derivative hash rather than original asset hash.
- Assignment plan/staging accepts imported normalized or baked native Motion, resolves native clip0 and retargets receiver rest. Legacy V9.12 evaluator remains explicitly unsupported by this path.
- Synthetic snapshot tests exercise native evaluator/verified derivative staging and reject altered blob hash. Studio integration15 PASS/1 existing SKIP, typecheck/lint PASS before final derivative-name normalization correction.
- No actual native-editor→Assignment browser test or apply/binding transaction yet; rest/unit/basis behavior on real edited assets remains unverified. Other model/calibration/runtime requirements remain open;0/8.

## DOC-092 — 2026-10-19 — Reload/update canonical mappings in UI

- Mapping65 editor loads matching selected saved canonical pairs and updates the same MappingID. Existing calibration is fetched/validated and preserved instead of resetting to defaults.
- Form captures editing revision; unrelated project changes reject save rather than silently using a fresh revision. Project refresh does not remount the form and erase unapplied edits. Reload currently requires reselecting mapping/asset or reopening the workspace.
- Studio typecheck/lint PASS. Browser save/reload/conflict interaction remains untested; portable presets, calibration UX and remaining goal requirements remain incomplete;0/8.

## DOC-091 — 2026-10-19 — Inspected Action selection in normalization UI

- Replaced numeric action index input with rig.inspect-driven names/durations/channel counts. Source changes clear selection and obsolete responses are ignored; plan is disabled during inspection or when no Actions exist. UI validates inspection response shape before listing actions.
- Studio typecheck/lint PASS; host integration15 PASS/1 existing SKIP with explicit Action metadata assertions (name/index/duration/195 channels for synthetic65 clip).
- No rendered interaction/async-race browser test yet. This is Action selection, not source playback/side-by-side preview. Assignment apply, host model workflow, calibration/presets and real-source acceptance remain incomplete;0/8.

## DOC-090 — 2026-10-19 — Full Retarget package regression and85-action data checks

- Added catalog85 test reading the shipped V9.12 BOBJ and manifest: all85 names, durations and key counts match; every channel evaluates finitely at start/mid/end. This is data/parser/interpolator coverage, not pose parity, visual playback or both-direction retarget acceptance.
- Added mixed-weight skin regression:25%/75% influences yield expected1.5-unit vertex displacement for a2-unit owner move; translated/scaled source and translated target roots retain rest mesh within tolerance, without dropped weight.
- All Retarget package tests40/40 PASS, including legacy bake/reverse/project/mapping and universal/Assignment/model tests. No golden data or shipped assets changed. Browser/game/real source fixtures unrun; overall goal remains0/8 accepted gates.

## DOC-089 — 2026-10-19 — Model+Rig+Animation GLB exporter and roundtrip

- Added exportCanonicalModel using installed Three GLTFExporter: validates canonical65 skin joints and unambiguous normalized TRS clip targets before binary export. Caller supplies rebound model and target clips; no file/network I/O in package.
- Synthetic no-texture roundtrip reimports with real GLTFLoader, checks65 skin joints/clip duration and CPU vertex deformation at mid-animation. Test provides a Node-only Blob/FileReader shim for exporter; it is not browser/WebGL verification or textured-model evidence.
- Skin/model suite4/4 PASS; Retarget typecheck PASS. Host model-job/UI/export workflow, source fitting, materials/textures, attachment/old-action handling, multi-skeleton/influence support and real model metrics remain incomplete;0/8.

## DOC-088 — 2026-10-19 — Rebound model animated joint-name collision regression

- Added CPU AnimationMixer deformation test: source/target both contain Hips; after rebinding, a45° receiver rotation must move the weighted vertex around the target bind joint. Test failed because the preserved source node captured the target animation track.
- Fixed colliding source-node names in the private output clone, retaining original names in userData and report. Geometry/material/source assets remain unmodified; target tracks now resolve to the canonical receiver rig.
- Skin suite3/3 PASS and Retarget typecheck PASS before final additional report/source immutability assertions. This is one-joint synthetic CPU deformation, not full skin quality, model export/reimport or browser acceptance.
- Output still retains source hierarchy; source animation conversion/attachment policies require further integration. Model+Rig+Animation and remaining goal gates are not complete;0/8.

## DOC-087 — 2026-10-19 — Canonical model rest skin rebinding primitive

- Added rebindCanonicalModel: private source/receiver clones, explicit source-joint-name→target-owner weights, canonical65 skeleton/inverse binds, cloned geometry skin attributes and rest-deformation check. Source geometry/material resources are not edited; original source graph remains retained in output alongside receiver rig.
- Requires detached roots already in a common normalized coordinate system, one source skeleton, unique names, four skin influences and skeleton-only receiver. Unsupported selection/influence layouts and unmapped/invalid owners reject instead of auto-weighting or silently dropping influences.
- Two synthetic skin tests PASS:65-joint rebinding/rest error/source-buffer immutability and missing-owner rejection. Retarget typecheck PASS before final skeleton-only receiver guard; no model GLB export/reimport, animated deformation/texture/browser validation or target fitting yet.
- This package primitive does not complete model branch. Host/UI/worker integration and real skin/animation metrics remain open;0/8.

## DOC-086 — 2026-10-19 — Normalization MCP command exposure

- MCP command enum now exposes rig.inspect, rig.normalization.plan/run and animation.assignment.plan. Tool description distinguishes staged normalization outputs from project Motion commit and Assignment preflight from apply.
- MCP and Python command helper require explicit expectedRevision for normalization.run; they cannot auto-fetch a new revision and silently bypass the reviewed plan snapshot.
- CLI/MCP regression46/46 PASS, covering command exposure/forwarding and missing-revision rejection. Transport tests use mocks; live MCP host/runtime is unverified. Normalization save remains CLI/API only, not a new MCP raw upload capability.
- Assignment apply/atomic binding/UI, model/skin, calibration/presets/metrics and real-source/browser acceptance remain open;0/8.

## DOC-085 — 2026-10-19 — Project Assignment preflight and staging

- Added animation.assignment.plan command and host planProjectAssignment/stageProjectAssignment helpers. Resolve imported normalized Motion/action and receiver Character profiles, verify canonical65/assets, bind plan to hashes/revision and stage rest-rebound output/provenance. Native edited Motion sources currently reject explicitly until derivative loading is supported.
- Synthetic helper integration uses a receiver Character record in a cloned test snapshot, verifies65 correspondence/output provenance and stale-plan rejection. This is not persisted Character/Assignment apply/placement acceptance.
- Studio typecheck/lint PASS; import/normalization/Assignment-helper suite15 PASS/1 existing SKIP. Assignment apply job/atomic derivative+binding, UI/CLI, add/replace/isolation matrix, real-character preview and model/skin remain open;0/8.

## DOC-084 — 2026-10-19 — Canonical Assignment rest rebinding primitive

- Added exported assignCanonicalAnimation: verifies exact65 source/receiver topology, resolves unique canonical joint correspondence and retargets sampled motion onto receiver rest through the existing normalization engine. Does not relax project fingerprint checks or mutate source/receiver assets.
- Synthetic roundtrip test uses receiver joints2.5× longer plus changed Spine rest rotation and Mixamo name prefix; checks meter-preserved final root translation, receiver Spine world position/rest rotation and immutable inputs. Noncanonical source rejects.
- Assignment tests2/2 PASS and Retarget typecheck PASS. This is a package primitive, not project Assignment plan/apply/UI/placement/preview acceptance; turning/contact/end-effector quality, add/replace/isolation and real characters remain unverified.
- Model/skin and remaining universal requirements stay open;0/8.

## DOC-083 — 2026-10-19 — Explicit unsupported transform rejection

- Universal matrix boundary now rejects singular/projective/reflected transforms and non-TRS shear before inversion/decomposition. Mapped source world-scale changes relative to rest are rejected instead of silently discarded by the rotation/root-only solver.
- This is capability validation, not support for animated scale, shear or reflection conversion. Source Actions remain unchanged; users must bake/resolve these channels before conversion. Static affine TRS and existing unit conversion remain supported at their tested scope.
- Universal sampler/solver/export/normalization suites20/20 PASS; Retarget typecheck PASS. Studio import/job/history suite15 PASS/1 existing SKIP and Studio typecheck PASS after change.
- Target-rest Assignment, calibration/chains, model/skin, complete UI/CLI and real-source/browser runtime remain open; acceptance0/8.

## DOC-082 — 2026-10-19 — Persisted mapping through normalization command integration

- Replaced injected-only mapping setup in synthetic65 integration with actual skeleton.mapping.set commit/reload. Tests now invoke rig.normalization.plan and rig.normalization.run through command boundary; retry returns the same jobId; artifact import/report/reopen/Undo/Redo remain verified.
- Normalization import additionally checks full project snapshot SHA-256 alongside revision. Regression edits a temporary test manifest without changing revision, verifies REVISION_CONFLICT, restores bytes and completes the valid import.
- Studio integration15 PASS/1 existing SKIP; Studio typecheck/lint PASS. Fixture remains synthetic same-profile identity mapping with static action; this proves command/storage behavior, not cross-rig motion quality or browser interaction.
- Universal calibration/presets/chain/skin policies, model output, third-character Assignment and real-source/browser acceptance remain open;0/8.

## DOC-081 — 2026-10-19 — Canonical65 mapping editor

- Added normalization/MappingEditor.tsx, mounted for unambiguous selected source/target profiles. Provides all65 target slots, exact normalized-name suggestions, manual source selection with IDs and joint search. Requires verified canonical target topology.
- Lists all unmapped source/target bones and requires explicit acknowledgment before saving their motion exclusion/rest policy. This acknowledgment does not authorize skin-weight loss. Save uses existing skeleton.mapping.set revision/history validation and selects the resulting mapping in normalization controls.
- Studio typecheck/lint PASS. Browser interaction, mapping save/run end-to-end and real-source correctness remain unverified. UI currently creates new mappings, does not reload/edit existing presets and stores default legacy calibration as required by existing broker; universal rest calibration, chain distribution and skin-owner policies remain open.
- CLI/host/package evidence is separate; no acceptance promotion. Model/skin, Assignment across different rest poses, quality metrics and external fixtures remain incomplete;0/8.

## DOC-080 — 2026-10-19 — Canonical65 mapping role validation

- Extended saved semantic mapping validation with explicit `mixamo65:<CanonicalJointName>` namespace for all65 slots. Such mappings require verified canonical target topology; role must match the selected target joint. Required body/limb slots gate confirmation; missing fingers remain unmapped/rest with existing ignored-bone accounting.
- Legacy role namespace and Minecraft20 behavior remain on their existing validation path. Mixed namespaces are rejected. Source graph/bone count remains flexible.
- Added full65/role-target mismatch/missing-required tests and broker skeleton.mapping.set dry-run acceptance on imported synthetic65. Combined mapping/import suites20 PASS/1 existing SKIP; Retarget/Studio typechecks and Studio lint PASS.
- Canonical mapping editor, actual saved mapping→run command integration, calibration/exclusion/preset UX, model/skin and real-source runtime remain incomplete;0/8.

## DOC-079 — 2026-10-19 — Normalization CLI command forwarding

- Added `rig inspect/plan/run/save` to Python unified CLI, forwarding to existing shared host commands. Run requires plan SHA-256 and explicit revision; save uses exact revision and normalizationJobId. Invalid FPS/action/revision/hash are locally rejected and host remains authoritative.
- Added payload/revision forwarding tests. Python CLI/MCP regression45/45 PASS. This is mock transport coverage, not CLI-host/browser or external-rig acceptance. MCP command exposure and dedicated CLI normalization polling/download remain open.
- Usage and limits: NORMALIZATION_CLI.md. UI mapping/preview, model/skin, target-rest Assignment, quality metrics and real fixtures remain incomplete;0/8.

## DOC-078 — 2026-10-19 — Workspace01 normalization controls

- Added `components/normalization/index.tsx` and private hook, mounted in Retarget settings. Select source/target assets, saved mapping, action index and FPS; check plan/issues, run/cancel job and save generated Motion through shared API/history.
- Controls lock inputs during jobs; project commits invalidate the plan; run rejects stale revision; polling survives transient observation errors without restarting the job. Source/target dropdowns rely on server validation for canonical/profile compatibility.
- Studio typecheck/lint PASS before final polling retry adjustment. No browser/WebGL interaction evidence yet; action index remains numeric, saved mappings still use legacy mapping UI, no universal tree/side-by-side preview or complete calibration/exclusion/preset UX.
- API/host integration evidence remains synthetic and separate from rendered UI. CLI, model/skin, target-rest Assignment, metrics and real-source runtime remain incomplete;0/8.

## DOC-077 — 2026-10-19 — Persistent normalization conversion report

- Normalization job import now verifies report.json and persists it as an immutable project blob linked from the derivative Asset. Report keys include content SHA-256, preserving distinct conversion reports even for identical output GLB bytes.
- Existing-source imports merge report references and persist new report bytes before the project/history commit. Job pruning no longer owns the only report copy.
- Integration reads the report through the verified asset resolver, checks plan/output hashes and reads the same bytes after Undo/Redo. Studio typecheck/lint PASS; suite15 PASS/1 existing SKIP.
- Updated Workspace01 inventory to reflect implemented sampler/host job/history/report and animation-only GLB roundtrip. External rig/browser runtime, complete UI/CLI, Assignment across rest poses, metrics and model/skin remain open; acceptance0/8.

## DOC-076 — 2026-10-19 — Normalization derivative import with shared history

- `asset.import` now accepts only `{normalizationJobId}` for completed normalization outputs. Checks job type/success, project revision/expectedRevision and verified downloadable GLB before using existing asset/skeleton/Motion persistence and history transaction.
- Imported output must contain one canonical Mixamo65 Motion; preserves source dependency, normalization job provenance and derivedFrom source Motion where clip index matches. Source/target profile compatibility for assignment is not bypassed.
- Synthetic integration covers staged job→derivative import→read/retry idempotency→Undo→Redo→stale result rejection. Source fixture mapping is injected into the helper snapshot, so this does not establish saved universal mapping/UI/run command acceptance.
- Studio typecheck PASS before test addition; Studio lint PASS and integration15 PASS/1 existing SKIP after implementation. Full upstream/browser gates unrun. Job status still means staged output success; imported Motion is evidenced through project/history, not by changing job status.
- Remaining: complete conversion report storage, target-rest assignment, UI/CLI, model/skin, cross-rig/legacy/runtime acceptance. Workspace01 stays0/8.

## DOC-075 — 2026-10-19 — Normalization job lifecycle regression

- Added integration checks for success/download hash, queued cancellation, concurrent JOB_BUSY, failed stale-plan job, unavailable cancelled/failed downloads and unchanged source project revision.
- Tests exposed terminal-state publication before the final persist released the active-job slot. Shared get/cancel now await the finishing worker before returning a terminal state. Normalization success remains explicitly uncommitted to project, including job.cancel dry-run.
- Run command checks stale expectedRevision before expensive inspection and preserves JOB_BUSY/423 instead of wrapping it as validation failure.
- Studio typecheck/lint PASS; asset-import suite15 PASS/1 existing SKIP after the lifecycle fix. No derivative Motion commit/history, UI/CLI, model/skin or real-source runtime acceptance yet;0/8.

## DOC-074 — 2026-10-19 — Normalization run job and downloadable artifacts

- Added `rig.normalization.run` command requiring current expectedRevision and a ready matching plan hash. Uses existing shared job registry/persistence/get/cancel/file resolver; restart detection recognizes the new job type.
- Worker runs against a cloned project snapshot, stages canonical GLB/report, publishes results only after success and verifies SHA-256 on download. Result provenance explicitly records `committedToProject:false`; this is not yet Motion/history commit. GLB MIME is allowed by the existing protected job-file resolver.
- Positive synthetic65 helper/job integration runs to success, downloads GLB and checks hash; source project revision remains unchanged. Studio suite15 PASS/1 existing SKIP; typecheck/lint PASS before the final one-line cancellation-result semantic correction. Run command with saved mapping, cancel/restart/race matrix and browser paths remain unverified.
- Remaining: derivative commit/history, UI/CLI, full mapping/calibration/exclusions, model/skin output and real-source runtime. Acceptance remains0/8.

## DOC-073 — 2026-10-19 — Verified plan to staged host normalization

- Extracted reusable verified `loadProjectRig`; inspection and execution use the same loaders/profile normalization. Added `stageProjectNormalization`: recompute plan, reject stale hash/unresolved issues, run universal normalization and return GLB/report with source hashes/revision/mapping and output SHA-256.
- Added positive synthetic65 integration: export GLB → import/persist source asset → inspect/resolve all65 profile IDs → deterministic ready plan → host normalization → output hash/provenance. Hash changes with revision; stale plan, missing required mappings and stale fingerprint reject. Source project on disk remains revision1.
- Test uses a synthetic same-profile identity mapping supplied to the host helper; it is not saved-mapping command acceptance, cross-rig runtime, or project derivative commit coverage.
- Studio typecheck PASS; asset-import suite15 PASS/1 existing SKIP. Jobs/run command, atomic commit/history, UI/CLI, model output and real-source runtime remain open. Acceptance stays0/8.

## DOC-072 — 2026-10-19 — Normalization plan API

- Added `rig.normalization.plan` through shared command boundary and `unifiedNormalizationPlan.ts`: verifies imported source/target, saved mapping IDs/fingerprints, action duration, canonical Mixamo65 target, profile↔adapter identity, required body/limb mappings and sample budget.
- Plan carries source revision, source/target SHA-256, fingerprints, enabled adapter pairs, report, issues/readiness and SHA-256 of the plan content. This is a read-only preflight; no normalization job or derivative commit is implemented yet.
- Studio typecheck/lint PASS. Asset-import integration suite 14 PASS/1 existing SKIP; added negative checks reject absent mapping and invalid FPS without changing revision. Successful full mapping plan/run integration remains unverified.
- Mapping quality/chain/exclusion policies, complete UI/CLI, model/skin output and real-source runtime acceptance remain open; Workspace01 stays 0/8.

## DOC-071 — 2026-10-19 — Shared rig.inspect command

- Added host `unifiedRigInspection.ts` and `rig.inspect` command using existing verified asset resolver, FBX/GLTF loaders, profile units/basis and universal adapter. The read-only command returns source hash/revision, evaluated rest graph, joints, actions/channels and explicit profile-to-adapter ID correspondence.
- Missing or ambiguous profile/name links are reported instead of silently assigned. External resources and unsupported bindings/skeleton selection are rejected. Model rebinding capability is explicitly false.
- Integration verifies two GLB joints plus retained scene ancestor, identity links, source hash, unchanged revision and invalid AssetID rejection. Studio asset-import suite: 14 PASS/1 existing SKIP. Studio typecheck PASS; Studio lint PASS before the final identity-link addition (not rerun afterward).
- Remaining: normalization plan/run, asynchronous job/commit/provenance, UI/CLI command exposure and model output; real-source runtime remains deferred. Workspace01 acceptance stays 0/8.

## DOC-070 — 2026-10-19 — Cancellable animation normalization orchestration

- Added exported `normalizeAnimation` in Retarget package: parsed source/target → mapping validation → source sampling → universal solver → canonical animation-only GLB and conversion report. Output remains staged; host project/job commit is still required.
- Exact source duration is retained with an extra final sample for fractional frame endpoints. Reports include fingerprints, action identity, sample/joint counts, root translation scale and unmapped/required joint diagnostics.
- AbortSignal is checked before setup and each sample; async yielding every 32 samples permits in-flight cancellation. More than 18000 samples is rejected without truncation.
- Two focused tests PASS: real GLTFLoader roundtrip checks fractional duration/final root displacement/source immutability; cancellation/resource/mapping rejection checks PASS. Retarget typecheck PASS.
- No host normalization command/job, persisted derivative, UI/CLI integration or real-source runtime claim is added by this checkpoint. Model+skin output and acceptance remain incomplete; Workspace01 stays 0/8.

## DOC-069 — 2026-10-19 — Universal sampler, solver correction and GLB roundtrip

- Added `threeRigAdapter.ts`: samples a private clone of parsed Three.js assets, retains animated ancestors, validates track bindings, supports explicit animation-only joints and uniform unit/basis normalization. Multiple distinct skeletons, ambiguous names, unsupported tracks, reflection/shear normalization are rejected explicitly.
- Fixed universal solver world rotation delta order and mapped-child positions: target offsets now follow posed parents; root motion can be carried by the first mapped joint below an unmapped container. Two regression tests failed before the correction and pass afterward.
- Added `universalGlb.ts`: canonical Mixamo65 animation-only GLB with rest hierarchy and sampled TRS. Actual GLTFLoader reimport tests compare all 65 world transforms at frames 0/15/30, preserve duration/source and verify deterministic bytes. These are synthetic fixtures, not real-source runtime acceptance.
- Fixed GLB importer cyclic ancestry traversal to reject cycles rather than hang; added regression coverage.
- Focused checks: 31 PASS, 1 existing FBX test SKIP across Studio asset-import and three universal suites; Retarget/Studio typechecks and Studio ESLint PASS. Full upstream build/evaluate/offline browser gates were not run for this checkpoint.
- Remaining: connect these package APIs to normalization plan/run jobs, persisted derivative Motion/provenance, Workspace01 mapping/preview/Assignment UI and CLI; model/skin rewrite, quality metrics and external source fixtures remain open. Acceptance remains 0/8; no game, commit, push or publish.

## DOC-068 — 2026-10-19 — GLB animation-only import and Assignment path

- Added GLB/glTF animation clip extraction into project Motion records, preserving original source bytes and assigning an existing Skeleton Profile only when explicitly selected. `motion.place` still validates profile fingerprint/unit compatibility.
- Animation workspace now lists GLB/glTF Motion assets and offers animation-only GLB import to a Mixamo65 profile before timeline placement. Existing FBX and Animation Studio edit paths remain available.
- Studio and Retarget typechecks PASS; Studio ESLint PASS; Universal Retarget package tests 8/8 PASS.
- Studio integration suite ran through the cached local `tsx` runner: 13 passed, 1 pre-existing FBX converter test skipped. The added test covers GLB import → preserved source → profile assignment → timeline placement.
- This only implements direct compatible Mixamo65 assignment; it does not retarget arbitrary source rigs or demonstrate playback/runtime. No CC/UE fixture, browser/WebGL run, Site, game test, commit or publish.

## DOC-067 — 2026-10-19 — Universal Retarget solver foundation

- User approved implementation of all Workspace01 gates 1.3.4.1–1.3.4.8. Reused `three` already in `@bbs/retarget`; retained the V9.12 solver/API unchanged.
- Added `packages/retarget/src/universal.ts`: validates arbitrary source/target bone IDs, parents and finite rest/sample matrices; accepts multi-root source graphs, rejects cycles/stale IDs/duplicate target mappings, suggests only unique normalized names, reports unmapped/required target joints, maps rest-relative world rotation to target rest space, preserves target rest offsets/scales, and optionally carries root translation in normalized scene units.
- Added `universalBake.ts` (18,000-frame cap), `universalSkin.ts` (explicit weight remap/normalize with loss reporting) and exact Mixamo65 topology recognition. Pinned target topology to licensed built-in Female GLB SHA-256 `d4ce…0f8be5`; inspected all four bundled Mixamo characters: each has 65 joints and same topology, while all 65 rest transforms differ across the remaining three vs Female. Attribution in builtin manifest: Topview, CC-BY-4.0.
- Verification: Retarget and Studio typechecks PASS; `node --experimental-strip-types --test packages/retarget/test/universal.test.ts` PASS (8/8, including hash/topology check against the real fixture).
- Not yet integrated with imported FBX/GLB sampling, project commands/history, mapping UI, Preview, Animation Assignment, mesh/bind-matrix rewrite, exports or Python CLI/MCP. User chose to defer runtime until fixtures are supplied. Workspace acceptance remains 0/8. Solver still needs basis/unit adapters, chain distribution, constraint evaluation and deformation-error metrics.
- Updated W01 authorization/status/LISTCODE/inventory and CODEMAP. No source workspace, user project, game, commit, push or publish was changed.

## W01-PLAN-002 — 2026-10-19 — Scope đa nguồn, không cố định115 bones

- Artifact: đặc tả rig-animation-normalization, inventory8gate, source review và registry14 ứng viên; đồng bộ LISTCODE/PROJECT/STATUS/CODEMAP.
- Research: tài liệu Reallusion/Epic/Autodesk/Unity/Sketchfab và repositories tác giả Warcraft/WoW/LoL; nguồn dẫn trong review. Đây là format-route evidence, không phải engine PASS.
- Không sửa app, cài converter, download model hoặc chạy DCC/browser/test sản phẩm. Chưa khóa fixture mới; actual counts/metrics null, runtime NOT_RUN.
- Kiểm docs: YAML/unique IDs/dependency DAG/local links và bỏ yêu cầu115 cố định trong current spec; lịch sử W01-PLAN-001 giữ nguyên để truy nguyên.

## W01-PLAN-001 — 2026-10-19 — Tài liệu đề xuất Workspace01

- Đã đọc yêu cầu đính kèm, quy tắc dự án, STATUS tới DOC-066, đặc tả Retarget, code importer/mapping/bake/UI/broker và tests liên quan. Review tĩnh có giới hạn, không phải full behavioral audit.
- Artifact: [đặc tả](features/rig-animation-normalization.md), [inventory8gate](inventory/workspace01-normalization.yaml), liên kết LISTCODE/PROJECT/STATUS/CODEMAP và lịch sử.
- Chưa code; chưa chạy test sản phẩm, browser hoặc runtime115. Chưa khóa fixture115/profile65 cuối cùng. Nghiệm thu scope mới 0/8, chờ phê duyệt triển khai.

## DOC-066 — 2026-10-19 — CPU evaluation uses native Motion derivative

- AC-05 implementation: `unifiedSkeletonEvaluation.ts` now decodes `Motion.sourceClip` for evaluator `animation-1.31.8`, preserving the existing source-asset loader for older evaluators. `resolveProjectBlob` validates project-root containment, file size and SHA-256 before GLB decode.
- Runtime evidence: existing isolated demo project `3c66afd3-1532-454b-9b16-cf10fbc3e873`; native Motion `f5ce6fe1-45fa-43cc-bd10-373363c45536`, source clip SHA-256 `0ebb82017e9e54fc81ce01fc89b755804327c5592f56dda2d579ef02edc3e84f`. Direct `scene.evaluate` succeeded at frames 0/15/30/45/60/89 with no issues; Spine local quaternion changed from `[-0.08016, 0, ~0, 0.99678]` to `[-0.46627, 0, ~0, 0.88464]`. Browser had already loaded the native GLB with HTTP 200.
- Checks: Studio typecheck PASS, lint PASS, smoke script syntax PASS. A fresh full smoke attempt timed out before sending `asset.import`; the newly strengthened full-smoke native-pose assertion was therefore not reached.
- Status: AC-05 remains Partial. The probe shows CPU can sample the persisted edited derivative and Scene can fetch that derivative; no numeric CPU/WebGL parity tolerance, loop/trim boundary, IK/easing, or root-motion parity has passed. Overall acceptance remains 1/9 (AC-07 only).
- No API/schema changes, game test, commit, push or publish.

## DOC-065 — 2026-10-19 — Animation draft conflict and iframe lifecycle smoke

- Phạm vi: tiếp tục goal Animation Creation AC-00–AC-08; vá bảo vệ revision/bản nháp và ngừng vòng render khi workspace ẩn. Không sửa Topview internals, game hoặc release.
- Code: host ghi `expectedRevision` lấy lúc mở editor, khóa đổi nhân vật/animation khi bản nháp dirty, báo stale conflict và cho lưu nội dung hiện có thành Motion mới. Native iframe expose `setHostActive`; RAF dừng khi inactive và khởi động lại khi active. `motion.edit` chỉ cho phép transform tracks của node wrapper `AuxScene` ngoài các bone của Character; các tên bone không hợp lệ vẫn bị từ chối.
- Runtime PASS trên isolated storage, URL `http://127.0.0.1:3118/?unified=3c66afd3-1532-454b-9b16-cf10fbc3e873`: 132 keys, Spine đổi pose, hai Character dùng chung Motion, sửa A clone/rebind riêng trong khi clip B và Motion nguồn không đổi; reload/reopen, placement Undo/Redo, CPU frame 0/45 khác nhau, WebGL GLB 200 và viewport đổi khi phát, iframe đổi kích thước theo host và RAF pause/resume. Stale revision `REVISION_CONFLICT` + draft retry-as-new PASS ở probe riêng `81112dea-14f0-45f0-a266-80773fd3cfbb`.
- `pnpm --filter @topview/3d-studio typecheck` PASS; `lint` PASS; runtime `smoke:native-animation` PASS. Bằng chứng cập nhật tại [evidence/native-animation-runtime-smoke.yaml](evidence/native-animation-runtime-smoke.yaml).
- Trạng thái task: AC-01 thêm bằng chứng resize/pause/resume nhưng chưa keyboard focus/context disposal/stale replies; AC-02 FK key editing/pose change PASS, IK/graph/easing chưa đo; AC-03 exact conflict + retry/reopen và clone-on-edit PASS, history/Undo chưa đủ; AC-04 hai-Character isolation qua clone/rebind PASS, nhưng clone/delete/document.replace matrix chưa đủ. AC-00,05,06,08 vẫn partial; AC nghiệm thu tổng vẫn 1/9 (AC-07).
- Giới hạn còn lại: chưa có multi-frame CPU/WebGL numerical parity, complete pending-draft navigation/reload tests, independent server-side bake, full clone/delete/document.replace matrix, Film Editor roundtrip hoặc Minecraft playback.

## DOC-064 — 2026-10-19 — Native Animation Creation and Film job runtime smoke

- Latest isolated browser smoke on local Studio `127.0.0.1:3117`: imported hash-pinned T-Pose FBX, added Character, opened native Animation Studio 1.31.8, wrote 132 keys and changed Spine rotation to 35°, saved native edit + GLB, placed Motion, verified placement Undo/Redo, CPU-evaluated frames 0/45, then loaded the GLB in Scene and played it. GLB request returned 200 and the viewport canvas changed during playback. Reload/reopen passed; 0 page/console errors. CPU Spine quaternion dot is `0.9794477746581245`. Project: `6b432023-754a-4ba2-9176-0684761de9c7`; Character: `6e344413-0278-453f-af28-a0bbc489faa3`; Motion: `e2c92c71-9ee9-4219-81be-b2c240dc6667`; clip: `user_mc_gfoygxm9`. Demo URL: `http://127.0.0.1:3117/?unified=6b432023-754a-4ba2-9176-0684761de9c7`.
- Runtime uncovered and fixed two integration defects: long base64 regex overflowed the JS stack on a baked GLB; GLBExporter added a namespace (`mixamorig:Hips`) and wrapper nodes that did not match the imported Character profile. Validation now canonicalizes node names to the selected profile, unions skin joints for multi-skin exports, ignores non-profile wrapper parents, and still requires all Character bones, exact parent/rest transforms and animation targets to match. The immutable GLB stored and used for playback has the normalized names.
- `pnpm --filter @topview/3d-studio typecheck` PASS; Studio lint PASS; `smoke:native-animation` PASS; offline browser smoke PASS against the already-running local dev host (2 Characters, pose search, 0 external requests). Builder `test:evaluate`: 554 passed, 1 skipped, suite FAIL because `sceneBasis.test.ts` declares no Vitest suite. Locale checker reports two missing diagnostics catalog keys and one unused English string. Fresh production build fails at Next's Windows glob with `EPERM` scanning `C:\Users\Administrator\AppData\Local\Application Data`; production offline smoke therefore cannot use a fresh build.
- Film job on the same changed-pose project passed preflight (61 samples) and completed with Blender 4.2.3 LTS + Microsoft OpenJDK 17.0.20.1. Job `0fb992b7-5ee3-480a-8e26-636d0a56b362` produced ZIP `NativeAnimationRuntimeDemo.zip` (1,112,711 bytes; SHA-256 `dd4148b4815620b30a809af46f99f72df9ae1146f28231436c836b75915d0ca7`). Download endpoint returned 200; ZIP CRC passed. `export-report.json` reports `nativeReadback: true`, 1 actor, 1 camera, 65 pose tracks; BbsCodec decoded the Film `.dat`, and one pose channel contains 61 samples with a changing rotation (`bone1`: near 0 to `-0.8123647` radians). Imported FBX SHA-256 remains `0c3fd77e693707a1f6c99da95070d482c568b3b91d1f9a060f3b5b53db77768d`. This validates local Film packaging/readback; it does not validate Minecraft playback or Film Editor save/reopen.
- Runtime gates: N1 partial (real Character opens; focus/resize lifecycle not measured); N2 partial (changed pose confirmed, but IK/graph/easing acceptance not covered); N3 partial (commit/reload/reopen and placement Undo/Redo proven, clone/history conflict not covered); N4 partial (CPU samples differ, WebGL loads/visually changes, but numerical CPU/WebGL parity is not measured); N5 PASS for native sampling/package/readback. Overall AC acceptance: 1/9 (AC-07).
- Remaining limitations: derivative is still generated in the trusted local iframe; no independent server rebake. One same-rig Character and T-Pose fixture only; no two-Character isolation, Film Editor edit/save/reopen or Minecraft playback. No game, source checkout, user project storage, release or Site was changed.
- [Evidence](evidence/native-animation-runtime-smoke.yaml).

## DOC-063 — 2026-10-19 — MVP app debug runtime

- Người dùng cho phép triển khai MVP gọn để chạy/debug flow. Chỉ sửa app tích hợp trong `three-workspace-app/editor`; giữ source checkout và game nguyên trạng.
- Sửa `pnpm dev`: build Builder một lần rồi chạy Studio Next dev. Trước đó Builder watcher ghi đè `dist` bằng ESM imports không được Next route resolve, gây API 500; smoke cô lập sau sửa PASS.
- Thêm API `/api/unified/health` (Node/Python/Blender/Java) và panel Dev Tools `项目诊断` để đọc project, kiểm asset/profile/unit/timeline, xuất báo cáo JSON local. Không đưa file asset/credential vào report.
- Runtime: Chromium smoke `Punch Combo.fbx` qua import → Character → Motion binding → Scene WebGL → CPU/WebGL parity → Undo/Redo/clone/reload PASS, external requests 0. Project/report chỉ trong `.mvp-runtime`; server dev local `http://127.0.0.1:3002` dùng storage cô lập. Health thấy Python 3.12.8, Blender và Java không có trên PATH.
- Kiểm tra: Studio typecheck PASS; Builder evaluate 554 PASS, 1 skipped, 1 suite lỗi vì `sceneBasis.test.ts` không khai báo Vitest suite (file dùng `node:test`). Không sửa test/golden để che lỗi. Full workspace build/lint chưa chạy.
- Giới hạn: đây là same-rig FBX regression + debug runtime, chưa đạt forward BOBJ20→Mixamo65, retarget Motion persist, cũng chưa xác nhận native Film/game export. 0/24 LISTCODE acceptance không đổi. Xem evidence `evidence/mvp-debug-runtime.yaml`.

## DOC-062 — 2026-10-19 — Review MVP và bàn giao cho agent triển khai

- Phạm vi: đối chiếu workflow/source/test, lập kế hoạch ưu tiên và đặc tả để người dùng giao agent khác; không sửa ứng dụng, source gốc, release hoặc game.
- Artifact: [MVP_RUNTIME_READINESS_REVIEW](../MVP_RUNTIME_READINESS_REVIEW.md), [MVP_PRIORITY_PLAN](../MVP_PRIORITY_PLAN.md), [MVP_IMPLEMENTATION_HANDOFF](../MVP_IMPLEMENTATION_HANDOFF.md), [MVP_AGENT_PROMPT](../MVP_AGENT_PROMPT.md).
- Findings: bake JSON DOC-061 chưa là shared target Motion; direct-rig FBX→native Film ZIP có evidence lịch sử nhưng game chưa được nghiệm thu. Đề xuất target65 với forward V9.12 và GLB→FBX bên trong app, giữ importer/evaluator/codec; A chuyển file thủ công nay là đường lui. Scope và20 assertion là đề xuất, không phải quyền code hay runtime PASS.
- Kiểm tra trong các lượt review/đề xuất: Retarget bake/reverse6/6; Film camera/manifest/pose20/20; Python MCP15/15 PASS. Đây là41 test logic/unit, không phải20 assertion runtime MVP. Lượt bàn giao chỉ kiểm tài liệu: UTF8, đích link và module tham chiếu,20 ID assertion duy nhất (APP16/BBS4), tính thống nhất kế hoạch/prompt.
- Giới hạn: không chạy lại browser/WebGL, download OS thật, MCP live handshake hoặc game; không tạo Site/commit. Fixture target65 và lựa chọn source action cần được khóa khi scope được duyệt; không có ETA ngày hoàn tất dựa trên số liệu đã đo.
- Nguồn khôi phục: không tạo snapshot/commit trong lượt tài liệu. Không nâng trạng thái LISTCODE hoặc phủ nhận bằng chứng partial hiện có.

## DOC-061 — 2026-10-19 — Retarget preview bake clip export

- Connected the existing frame sampler to Retarget Preview. The selected FBX clip is sampled at 30 FPS and converted from V9.12 Minecraft20 local poses into a Three.js `AnimationClip`; the UI downloads the clip JSON and restores the preview's previous play time afterward.
- Added validation for empty clips, duplicate/mismatched target bones, non-finite transforms and non-increasing times. A focused test applies the clip to a Three.js Bone/Mixer and verifies its transform changes.
- Verification: Retarget and Studio TypeScript checks pass; focused bake/reverse tests pass 6/6. No browser/WebGL interaction test was run.
- Limits: exported JSON is not a shared-project Motion. It has no project blob/history transaction or timeline binding; target rig rest/hierarchy parity, native golden comparison and arbitrary target rigs remain unverified. LISTCODE remains 28 groups (26 partial, 2 unstarted, 0 complete); scope 1.1–1.7 remains 24 partial.
- [Evidence](evidence/retarget-preview-bake-json.yaml).

## DOC-060 — 2026-10-19 — Retarget frame-bake engine

- Added `bakeReverseRetargetFrames` in the shared Retarget package. It evaluates an inclusive frame range at 15, 24, or 30 fps, samples the caller's source pose at exact frame times, and routes every sample through the existing V9.12 Mixamo65→Minecraft20 solver. Invalid ranges, more than 18,000 frames, and non-finite poses fail before a result is returned.
- Verification: 5 focused Node tests passed, including a real bundled V9.12 20-bone armature with a changing source pose; Retarget package TypeScript check passed.
- Limits: this is engine groundwork only. UI invocation, target-profile rest binding, native generated Motion storage/history, timeline placement/export, native golden parity, feet/hands and skin rebind remain incomplete. A broad direct-Node run could not load two existing suites because of their extensionless imports; they are not claimed as passing.
- LISTCODE remains 28 groups (26 partial, 2 unstarted, 0 complete); scope 1.1–1.7 remains 24 partial. [Evidence](evidence/retarget-frame-bake.yaml).

## DOC-059 — 2026-10-19 — Punch Combo browser export

- Fixture: Punch Combo FBX from the app copy's `.test-runtime` cache, SHA-256 `acd9e347686dfabda0a3cac3207885d96f466795753882284f3b4ddfb29fabeb`, 1,916,352 bytes. Read-only Blender 5.1.2 conversion reported 65 bones, one action and no required texture; the source hash stayed unchanged.
- Integration: `node --import ./packages/builder/node_modules/tsx/dist/loader.mjs --test apps/studio/test/filmExportJob.integration.test.ts` passed 1/1. Two Characters shared the imported source and Motion over frames 0–29 with two contiguous camera cuts; native worker ZIP job `5ba32428-d4b9-4e75-a289-c922c94f03ba` succeeded, 20 ticks, 1,286,591 bytes.
- Browser: Chromium 153 / Next.js 15.1.9 opened project `69a82b7d-bccf-4e47-9831-8ff476bf2cdd`; the Film panel selected both Characters and submitted `film.export` for the same two-shot sequence. Job `a7270753-2ed4-424f-80e0-41284fd6afbc` succeeded at revision 6, duration 20 ticks, with no warnings or blocked requests. `film-punchcombo-browser.zip` was 1,286,590 bytes and its SHA-256 `998be98134bfefae234b96f405a4a77a6b0608ad49ef33853c461ff0c636300c` matched both the job record and saved bytes. Browser had 0 page errors, 0 external requests and 0 failed HTTP responses.
- Cleanup: server stopped, port 3002 closed; isolated project, converter output, custom Next output and smoke script removed; `tsconfig.json` returned to its normal include list. FBX source stayed unchanged. No original workspace, release, Site or game changed.
- Limits: test-cache rig only; the in-memory directory handle does not validate OS picker/disk behavior. Film Editor open/edit/save/reopen, live MCP and Minecraft playback remain unverified. LISTCODE remains 28 total (26 partial, 2 unstarted); scope 1.1–1.7 remains 24 partial.
- [Evidence](evidence/film-punch-combo-browser-export.yaml).

## DOC-058 — 2026-10-19 — Animated Film browser export

- Test adjustment: the integration creates two Characters from one imported FBX, so the per-Character sampled model list contains two basis matrices. The previous assertion expected one and failed before starting the job. Updated it to expect one source basis per selected Character and named the test for animated Characters.
- Fixture: existing generated FBX at test time, source SHA-256 `88135f34c6cadd03a61f85010eaa545b5502081128461d5d1a49096e9e0f4cd8`; Blender 5.1.2 conversion profile has 2 bones and 1 action. Test verifies both Characters' first/last sampled skeletons differ, one sequence has two contiguous camera shots (frames 0–14 and 15–29), and duration is 20 ticks.
- Integration: `node --import ./packages/builder/node_modules/tsx/dist/loader.mjs --test apps/studio/test/filmExportJob.integration.test.ts` passed 1/1. Job `eb4f6e53-3979-48e3-92c2-f346e3e13ae4` succeeded at source revision 6; ZIP size 5,160 bytes, SHA-256 `d123ef78f1c310283cbf2aca2916fe21157780f9ddfea69d849a704cee8f67fd`.
- Browser: Next.js 15.1.9 at `127.0.0.1:3002`, Chromium 153; opened project `4843f27c-33c0-4f0b-87e2-fc5c3a538af3` and selected both Characters in the Film panel. UI command used sequence `film-e2e-sequence`, frames 0–29, aspect 16:9 and name `film-animated-browser`. Job `54d505fa-d6e0-4d75-84e5-660db1e1fd4e` succeeded at revision 6, duration 20 ticks, with no warnings or blocked requests. Browser saved `film-animated-browser.zip` (5,194 bytes; SHA-256 `2ba233fb5a4fb5ad3aed22fff524696d2d6f2fc384cdb12f4cda00f4eada3abb`); SHA matched both the job record and in-memory saved bytes. 0 page errors, 0 external requests, 0 failed HTTP responses.
- Cleanup: dev server stopped; port 3002 has no listener. Removed isolated test project directories, conversion output, custom Next output and smoke harness. Source FBX was read-only and its hash matched. No original workspace, release, Site or game changed.
- Limits: synthetic 2-bone/1-action fixture only; directory picker and disk write used an in-memory stub. Production rigs, Film Editor open/edit/save/reopen, live MCP and Minecraft playback remain unverified. LISTCODE stays at 28 groups (26 partial, 2 unstarted, 0 complete); scope 1.1–1.7 remains 24 partial.

## DOC-057 — 2026-10-19 — Browser Film export smoke and package check

- Dependency recovery: `pnpm install --frozen-lockfile --ignore-scripts` reused 427 packages from local store, downloaded 0, ran no lifecycle scripts. Workspace `pnpm typecheck` passed. `pnpm --filter @topview/3d-builder build` passed tsup CJS/ESM/DTS and finalize-dist; direct ESM/CJS assertions passed for Z-up mapping and rejection of malformed/non-orthonormal bases.
- Browser scope: Chromium 153 on isolated Next 15.1.9 at `127.0.0.1:3002`; created project `590566db-0de6-4d19-b9f5-b1bce561dbe5`, imported one generated static two-bone FBX with basis `[1,0,0,0,0,1,0,-1,0]`, made one Character and one camera shot at frames 0–29, then launched `film.export` from the Film panel. Job `53c295aa-53f1-4314-b9ff-141ee2123895` succeeded at revision 3, progress 1/1, duration 20 ticks, no warnings/blocked requests.
- Artifact: `Film-browser-smoke.zip`, 2,846 bytes, SHA-256 `44a8aebb800052990ca6d7820f679d97a6eb4ebfdda566142c362072e3984527`; ZIP signature verified. `saveJob` reloaded and checked size/hash, then wrote via an in-memory `FileSystemDirectoryHandle` stub. Browser had 0 page errors and 0 external requests. Detailed provenance and limits: [evidence](evidence/film-browser-export.yaml).
- Cleanup: stopped dev server; port 3002 has no listener. Removed isolated `.film-ui-smoke-data`, `.next-film-ui-smoke`, smoke script and temporary `tsconfig` include. Kept the valid workspace `node_modules` installed from the frozen lockfile. No original workspace source, release, Site or game changed.
- Limits: one generated static two-bone FBX/one Character/one camera shot only. Real OS directory picker/disk write, Film Editor open-edit-save-reopen, live MCP host, animated multi-bone browser job and Minecraft playback remain unverified. No LISTCODE status promoted: 28 total (26 partial, 2 unstarted, 0 complete); scope 1.1–1.7 is 24 partial.

## DOC-056 — 2026-10-19 — Film browser job environment check

- Scope: start an isolated Studio instance and continue DOC-055 from the Film panel empty-state into a successful browser export job, using the existing local two-bone FBX fixture.
- Result: blocked before route compilation. Next detected missing TypeScript packages and invoked pnpm; the local cache had only an incomplete `@types/react@18.3.31` directory without `node_modules/@types/react`. npm cache contained only `@types/react@19.2.18`, which does not match the pinned version. Registry requests failed with EACCES. No dependency install completed and no browser assertions ran.
- Cleanup: stopped the server; removed temporary dependency junctions and isolated project/output directories; preserved the local `.pnpm` store. Port 3002 has no listener. No app source, project data, release, Site or game changed.
- Next: restore a complete local `@types/react` package or run the approved dependency install, then retry the Film browser job from DOC-055. [Evidence](evidence/film-browser-job-environment.yaml).
- LISTCODE remains 28 groups: 26 partial, 2 unstarted; all 24 groups in 1.1–1.7 remain partial.

## DOC-055 — 2026-10-19 — Browser and Z-up import smokes

- Scope: continue DOC-054 using only temporary links to packages already in the local pnpm store; test the existing offline browser path, Film panel empty-state and basis-enabled `asset.import`.
- Passed: Chromium153 offline smoke reported two Characters, 28 pose-search hits and zero external requests. Film panel smoke confirmed a blank project has no Character options, export stays disabled, and default file naming follows the project. Authenticated API import of a generated two-bone FBX returned a model/profile and persisted Z-up basis `[1,0,0,0,0,1,0,-1,0]`. Direct ESM/CJS checks confirmed `sceneBasisMatrix` export, Y-up→Z-up mapping and malformed-basis rejection.
- Runtime packaging repair: Builder source already defined `sceneBasisMatrix`, but its checked-in local-copy `dist` did not export it. Manually transpiled that source with cached TypeScript and synchronized ESM, CJS and declaration exports across six dist files. This is a local generated-dist sync, not a successful package build. Full tsup build failed because the cached esbuild JS module was absent; pnpm/Next registry access had previously failed with EACCES. Full typecheck was not run.
- Cleanup: stopped Next server; removed temporary app dependency junctions, smoke output directories and dist backup. Kept the local `.pnpm` store. No source Animation/Retarget/Topview workspace, release, Site or game changed.
- Limits: no successful Film export job through browser UI, Film Editor acceptance, live MCP host or Minecraft playback. Browser run logged an autoprefixer mixed-support warning and a duplicate Mediabunny load warning under the temporary links; neither was investigated. `.next-dev` generated output was not assessed. [Evidence](evidence/studio-browser-and-basis-runtime.yaml).
- LISTCODE remains 28 groups: 26 partial, 2 unstarted; all 24 groups in 1.1–1.7 remain partial.

## DOC-054 — 2026-10-19 — Browser smoke environment probe

- Scope: attempt the existing offline browser smoke against the local Studio dev server after DOC-053.
- Result: Next 15.1.9 started, then returned HTTP 500 during `/` compilation because webpack could not resolve `three` imported by `packages/retarget/src/index.ts`. The `pnpm exec` probe and Next's missing-TypeScript-types setup attempted registry access and received EACCES; no dependency install completed.
- Cleanup: stopped the dev server and removed the temporary app/package junctions. No browser interaction or export acceptance passed; no source application code changed. Generated `.next-dev` artifacts may reflect the attempted compile.
- Next: restore the declared pnpm workspace dependency links from a valid local store/online install, then rerun the existing offline smoke and Film export panel smoke. [Evidence](evidence/browser-smoke-environment.yaml).

## DOC-053 — 2026-10-19 — Film source-basis conversion

- Film sampling now carries each Character's `basisToScene` into the converter and pose baker. The Blender exporter left-multiplies the same basis into BOBJ geometry/rest output; the baker applies it to source rest matrices before deriving per-bone pose deltas. The identity-only Film preflight rejection is removed. Same-source conversion caching includes the basis and still rejects conflicting interpretations.
- Blender 4.2.3 integration converted generated animated FBX/GLB fixtures under Z-up rotation and reflection bases. BOBJ rest matrices, vertex positions, normals and face orientation matched the transformed defaults; source hashes and textures remained valid. Converter/CLI tests passed 35/35, including malformed-basis rejection. The Node pose-bake suite passed 7/7, including animated Z-up samples and actor placement cancellation.
- The opt-in project Film export integration passed 1/1 with Z-up import, two Characters, two camera cuts, Blender 4.2.3, Java 17, a successful Film export job and downloaded ZIP. Standard Studio typecheck, browser export smoke, Film Editor and Minecraft playback remain unverified. [Evidence](evidence/film-basis-bake.yaml).
- LISTCODE remains 28 groups: 26 partial, 2 unstarted; all 24 groups in 1.1–1.7 remain partial. DOC-052 Character/Prop browser and adapter limitations are still open. [Basis adapter evidence](evidence/scene-basis-adapter.yaml).

## DOC-052 — 2026-10-19 — Imported source basis adapter

- `asset.import.basis` now accepts only finite orthonormal 3×3 matrices; Z-up `[1,0,0,0,0,1,0,-1,0]` is preserved in SkeletonProfile and model import metadata without modifying source bytes. Shared validation rejects invalid node bases and Character/profile mismatches.
- Character, Prop and CPU skeleton evaluation wrap source objects in the same source-to-scene matrix once. Same-hash model imports with conflicting units/basis are rejected.
- Added tests for point/inverse conversion, invalid matrices, runtime Character/Prop wrappers, and persisted import metadata/profile.
- Node 24 basis math tests passed 2/2. With temporary TypeScript transpile loaders and cached package junctions, imported Character/Prop tests passed 3/3, shared project validation passed 6/6 and the focused Studio Z-up import/headless test passed 1/1. The integration test exposed the CPU loader and `buildCharacterRig` both applying the basis; the redundant loader wrapper was removed. Character/Prop tests used a node:test shim and labels stub rather than Vitest. Standard typechecks and the broader Studio suite remain unrun: pnpm tried recreating `node_modules` and stalled; offline install failed because supply-chain policy metadata for `@typescript-eslint/project-service` was missing; cached Vitest lacks its esbuild link.
- Limits: Film sampling explicitly blocks nonidentity basis; cross-version Three.js bridge, skinned mesh/material parity, and full DATA-02 acceptance remain open. [Evidence](evidence/scene-basis-adapter.yaml).
- Follow-up verification: the full focused asset-import/Prop selection in `unifiedAssetImport.test.ts` passed 6/6 through a temporary Node transpile harness, including the source-byte preservation, profile/metadata, Prop, invalid import and Z-up CPU evaluator checks. The standard Studio suite and typecheck remain outstanding.

## DOC-051 — 2026-10-19 — Reparent under rotated nonuniform groups

- Strengthened the existing Scene reparent test to use different nonuniform scales under equally rotated groups. It checks that the primitive's composed world matrix remains within `1e-6` after reparenting, and retains undo and keyed-node rejection checks.
- Verification: `unifiedAssetImport.test.ts` passed 11 tests with one optional Mixamo fixture skipped; Studio TypeScript check and ESLint passed.
- Limits: covers a representable static transform. General Z-up basis conversion, cross-version Three.js adapter parity and cases that require local shear remain open.
- [Evidence and source hashes](evidence/scene-parent-transform.yaml).

## DOC-050 — 2026-10-19 — Safe BOBJ bone IDs for imported rigs

- Converted bone names that contain BOBJ-unsafe characters into unique safe IDs and rewrote exact BOBJ tokens so hierarchy, vertex weights and action channels reference the same IDs. Converter profiles retain the FBXLoader-normalized source name, allowing the Film baker to resolve source samples and still emit target BOBJ IDs.
- Punch Combo converted with the real Blender 4.2.3 converter (65 bones, 1 action). The project integration adds two Characters sharing that asset, places the Motion on both, splits two camera shots at a cut, confirms both sampled poses change, and completes conversion/profile mapping → editable manifest → Java 17 worker → ZIP native readback (1/1).
- Verification: Studio suite39/39 with Punch Combo and opt-in export enabled; converter tests5/5 with Blender; Studio typecheck and ESLint passed.
- Limits: tested one 65-bone source rig reused by two Characters and two camera shots. Arbitrary rig/runtime parity, Film Editor open/edit/save/reopen, live MCP host and Minecraft playback remain unverified.
- [Evidence, commands and source hashes](evidence/film-safe-bone-names.yaml).

## DOC-049 — 2026-10-19 — Per-bone BOBJ bind-frame calibration

- Fixed animated Film manifest rejection when source and converted BOBJ bones use different local bind frames. Pose baking now derives a rigid source-to-BOBJ frame conversion per bone, propagates it through parents, and conjugates each sampled local delta into the BOBJ frame; non-rigid basis changes remain rejected.
- Updated the opt-in project integration to place an imported Motion and assert sampled bone matrices change before exporting. A Blender 5.1.2 fixture with Root translation and Arm rotation at frames 0/15/29 completed project import → Motion placement → 20 Hz sample → BOBJ conversion → manifest → Java 17 worker → ZIP job readback (1/1, 12.3 s).
- Verification: 38 Studio tests, 37 passed and 1 optional integration skipped; the opt-in animated integration separately passed 1/1. Punch Combo import remained enabled. Studio TypeScript check and direct ESLint passed.
- Limits: generated two-bone fixture only; production rig/name compatibility, multiple Characters/cuts, Film Editor edit/save/reopen and Minecraft playback remain open.
- [Evidence, fixture recipe, commands and hashes](evidence/film-pose-frame-calibration.yaml).

## DOC-048 — 2026-10-19 — Project-scoped BBS Film export job

- Added the `film.export` command and persisted job that snapshots the project, samples Characters/camera sequence, verifies source hashes, runs the local Blender model converter, builds the typed BBS2.4 editable manifest, invokes the Java worker and stores a ZIP artifact under the project job record. Existing `job.get`/`job.cancel`, progress and single-local-job reservation are reused.
- Added the Studio Film export panel plus CLI `film project-export` and MCP `film.export`; clients keep the selected output directory local and save only size/SHA-verified ZIP artifacts. MCP stores its selected path until `job.get` sees success.
- Verification: Studio job/Film/camera/pose/output tests passed 23/23; Studio TypeScript check and direct ESLint passed; Python CLI/MCP suites passed 43/43. Chromium opened the Film panel, checked its inputs and confirmed export is disabled with an empty project (no page errors). An opt-in Blender 5.1.2 + Java 17 integration imported a generated static two-bone skinned FBX into a project and completed the project job to a native-readable ZIP (1/1).
- Limits: generated animated two-bone FBX converted independently (2 bones, 1 action), but its full project export job failed at 8% with the job's generic error; animated project sampling/manifest compatibility is unresolved. Browser smoke did not run export or verify folder save. Multiple Characters/camera cuts, live MCP host, Film Editor open/edit/save/reopen and Minecraft playback are not verified. The successful integrated source was generated/static, not a production asset.
- [Evidence, commands and hashes](evidence/film-project-export-job.yaml).

## DOC-047 — 2026-10-19 — BBS Film export manifest builder

- Added `buildFilmExportManifest` to join immutable project samples, BOBJ converter profiles/files, per-tick actor transforms, sampled cameras and baked editable pose tracks into the pinned worker schema. Unrepresentable actor scale, roll, shear and mismatched source/profile hashes fail preflight.
- Real temporary one-bone FBX generated with Blender 5.1.2 passed through the actual converter, manifest builder and Java 17 worker; native readback succeeded with one actor, camera and pose track.
- Verification: Studio integration suite passed 28/28 including Punch Combo FBX; TypeScript check and direct ESLint passed.
- Limits: smoke sample was assembled manually and static; project-scoped converter/worker job, API/UI/CLI/MCP, Film Editor save/reopen and Minecraft playback remain open.
- [Commands, hashes and limits](evidence/film-manifest-builder.yaml).

## DOC-046 — 2026-10-19 — Project pose samples to editable Film tracks

- Added internal BOBJ rest-relative pose baking from the shared project sampler. It validates the common source-to-BOBJ rest basis, removes actor placement, and emits finite `pose_transform` tracks with continuous Euler angles.
- Punch Combo project integration baked 65 bones × 21 ticks using a typed synthetic BOBJ profile. A separate three-bone Blender 4.2.3 fixture converted through the real BBS converter and showed a common rest basis within `3.469446951953614e-18`; that profile was not run through the baker.
- Verification: combined Studio camera, pose-bake and project integration tests passed 26/26; Studio TypeScript check passed.
- Still open: real converter-profile-to-baker integration, Film manifest creation, converter/worker job and UI/API/CLI/MCP path, Film Editor save/reopen and Minecraft playback. No universal source parity is claimed.
- [Commands, source hashes and limits](evidence/film-pose-bake.yaml).

## DOC-045 — 2026-10-19 — Shared-project Film sampling input

- Added an internal `sampleProjectFilm` path that freezes the project and arguments, preflights selected Characters and ordered shots, samples actor skeletons and camera motion at 20 Hz, and returns source revision/hash plus model/motion hashes. It reuses the existing CPU skeleton and effective-world camera samplers and never edits project history.
- Camera conversion maps Three.js quaternion forward/up orientation to BBS yaw/pitch/roll, preserves incoming-right/outgoing-left cuts, verifies the 20 Hz grid, and rejects unsupported aspect/quaternion/range inputs. Sampling currently requires a contiguous source-frame shot sequence, perspective cameras and direct imported FBX/GLB rigs with the imported basis.
- Verification: Studio integration test passed 12/12 with the Punch Combo FBX fixture; camera conversion passed 11/11 including basis reconstruction for 100 generated rotations; Studio TypeScript check passed.
- Output is a converter input snapshot, not the Film manifest. BOBJ rest-relative pose baking, model conversion orchestration, worker execution, persisted jobs, broker/API/UI/CLI/MCP wiring and Film Editor/game acceptance remain open. No arbitrary-source parity is claimed.
- [Commands, source hashes and limits](evidence/film-project-sampling.yaml).

## DOC-044 — 2026-10-19 — BOBJ bind/rest matrices in converter profile

- Extended each converter profile bone with `bobjRestMatrixRowMajor`, the 16 finite values written in the BOBJ `arm_bone` record. These are global BOBJ-space bind/rest matrices; no pose animation is baked.
- The coordinator validates shape, numeric type and finiteness. A generated Blender FBX/GLB integration compares each reported matrix to the exported BOBJ record, including exact values.
- Verification: `python -m unittest agent.test_film_model_converter agent.test_film_worker agent.test_unified_cli agent.test_unified_mcp -v` passed 47/47 in 50.560 s with Blender 4.2.3 and Microsoft OpenJDK 17.0.20.1; no skips. `python -m py_compile agent/film_model_converter.py agent/film_worker/blender/convert_model.py agent/test_film_model_converter.py` passed.
- This supplies verified bind matrices for future rest-relative pose baking. It does not transform shared samples into BOBJ pose tracks, create project manifests/jobs, add UI/API/MCP export, or verify Film Editor/Minecraft playback. The existing DOC-043 fixture-only format limitations remain.
- [Source hashes, commands, evidence and limits](evidence/bobj-rest-profile.yaml).

## DOC-043 — 2026-10-19 — Offline FBX/GLB-to-BOBJ converter

- Added `python -m agent.unified_cli film convert-model SOURCE.fbx|SOURCE.glb --output-dir EXISTING_FOLDER [--unit-meters N]`. FBX requires an explicit finite positive unit; GLB uses meters. Requires Blender 4.2+ and writes a new hash-named package containing BOBJ/profile and optional PNG.
- Reused the BBSFix BOBJ exporter and `animation_api.py` byte-for-byte from `BBSFix-Blender512`; upstream hashes and GPL-2.0-or-later license are recorded in `agent/film_worker/NOTICE.md` and `vendor/LICENSE-GPL-2.0-or-later.txt`. Original sources were not edited.
- Blender 4.2.3 generated temporary FBX and GLB files with a weighted mesh, one armature, one action, and an embedded JPEG. Both conversions passed profile/action/PNG/hash checks and left source hashes unchanged. The GLB importer added an unlinked helper mesh in `glTF_not_exported`; the converter excluded it from BOBJ output. Output uses a staging directory under the destination and does not overwrite existing packages.
- Verification: 46 converter, Film worker, CLI, and MCP tests passed in 51.6 s with Blender 4.2.3 and Microsoft OpenJDK 17.0.20.1; Python compilation and CLI help passed. The test also packaged the converted GLB BOBJ/PNG with the native Film worker and read the Film back through BbsCodec. Test-generated FBX/GLB and outputs were removed with their temporary directory.
- Limits: only generated FBX/GLB fixtures were integration-tested; arbitrary third-party models remain unverified. One armature/one texture only, no shape keys or vertex colors. No project sampling/manifest/job/UI/API/MCP integration, Film Editor reopen/edit, browser/WebGL or Minecraft playback was performed.
- [Source hashes, test commands, supported surface and limits](evidence/film-model-converter.yaml).

## DOC-042 — 2026-10-19 — Offline native Film worker

- Added `python -m agent.unified_cli film export MANIFEST --output-dir EXISTING_FOLDER`, a manifest-only offline path. It compiles the Java 17 worker in a temporary directory, checks pinned bridge/Gson hashes, validates model files and writes a new package without overwriting an existing destination or touching a game directory.
- The worker reuses BBS FS 2.4 `FilmEditor`/`BbsCodec` and adapted `DraftEditor` operations for actors, transforms, camera clips, optional actions and editable BOBJ `pose_transform` tracks. Fixture: two actors, one camera, 60 ticks, one pose track and the pinned Steve BOBJ.
- Verification: `python -m unittest agent.test_film_worker -v` passed 2/2 in 38.971 s with Microsoft OpenJDK/javac 17.0.20.1; `python -m unittest agent.test_unified_cli agent.test_unified_mcp -v` passed 38/38 in 0.443 s. The tests verified compressed BBS1, BbsCodec semantic read/write/read, actor/camera counts, pose channel type/count, copied asset hash, and rejection of invalid asset hash, traversal path, out-of-range revision and unordered action keyframes.
- No persistent Film artifact remains; integration tests use temporary directories. No project-to-manifest conversion, FBX/GLB-to-BOBJ conversion, UI/API/MCP Film job, game playback, Film Editor reopen/edit, Site, release, commit or source-workspace edit was performed. Next build was not rerun; DOC-041's AppData junction EPERM remains the last result.
- [Hashes, test results and exact limits](evidence/film-export-worker.yaml).

## DOC-041 — 2026-10-18 — Scene render jobs and live-host verification

DOC-041: immutable Scene render jobs now run through the live Next host using native ESM renderer externals. Fixed concurrent-start reservation, cancel cleanup, stale revision errors, dry-run cancel, CLI/MCP retry identity and browser save errors. UI selects up to three cameras; two cameras at frames 0/45/89 produced nine SHA-verified files in real browser OPFS without changing history. 46 Studio/shared/Retarget/navigation tests, 37 Python unified tests and 29 director-cli tests passed; Builder 553 passed/1 skipped. All package typechecks and root lint/locale checks passed. Legacy offline and real-FBX browser smoke passed. OS folder picker and live MCP host remain unverified. Production Next build still fails AppData junction EPERM; legacy Python suite has 218 passed, 11 failed, 10 errors, 4 skipped from asset-manifest/Windows packaging/mtime issues. Full app remains incomplete. [Evidence](evidence/scene-render-jobs.yaml).

## DOC-040 — 2026-10-18 — Scene geometry checks

- `scene.evaluate` now accepts only `grounding`, `overlap` and `frustum`. It reuses Topview `inspect-nodes` for world mesh bounds and `evaluateDocumentFrames` for camera visibility, with evaluated project transforms overlaid after timeline evaluation. Grounding retains the source 0.02 m tolerance; overlap reports axis-aligned world-space gaps/intersections.
- The Studio stages only referenced hash-verified model/motion source bytes in a private temporary directory, serves them to the existing offline Chromium renderer, and removes the directory in `finally`. The read command preserves revision/history; unavailable sources/renderers return `CHECK_UNAVAILABLE`, and unmeasurable nodes are surfaced as partial.
- Studio primitive regression verified grounding, intersecting AABBs and two in-frustum nodes. Punch Combo FBX regression verified actual mesh measurements and the missing-source failure path. Director-CLI 28/28 tests and Studio typecheck passed. The check emitted no blocked external requests; Chromium reported a Mediabunny duplicate-load advisory.
- No scene-render job, PNG/contact sheet, animated-mesh pose parity, broad-format parity, Site, release, source-workspace edit, commit or game run. `pnpm install --offline --ignore-scripts --frozen-lockfile` stopped before changes because pnpm required purging `node_modules` without a TTY; no purge was authorized.
- [Evidence and hashes](evidence/scene-geometry-checks.yaml).

## DOC-039 — 2026-10-18 — Effective-world camera subject follow

- Camera sampling now resolves trajectory-driven subject position and horizontal rotation from the same direct-rig CPU evaluator used by skeleton sampling, before Topview camera subject/look-at bindings run. Project sampling preloads selected sources once and disposes the evaluator on completion/cancel; unavailable or unsupported source data fails before output.
- Punch Combo FBX integration compared all 21 camera samples with the corresponding skeleton actor world matrix, including rotation-relative camera offset and the shot's left endpoint. Builder 96 test files:553 passed,1 existing skip; source/test typechecks and build/finalize passed. Studio camera command1/1, FBX integration12/12, app typecheck and targeted ESLint passed.
- `sampleProjectCameraSequence` is now an async generator because effective-world evaluation loads verified local assets. No broker/job/Film format, browser framing acceptance, Site, release, source-workspace change, commit or game run.
- [Evidence and hashes](evidence/camera-subject-sampling.yaml).

## DOC-038 — 2026-10-18 — Animation workspace reuses Topview editor

- Workspace Animation now mounts Topview `DirectorStudio` with the same project adapter next to the clip controls. The original Scene and Animation tabs share the same saved scene, timeline keys, revision and history; no new animation engine or project store was added.
- The browser smoke was extended to require the Animation editor viewport and clip controls together. Punch Combo FBX workflow passed on Chromium153.0.8010.12 at1600×1000: import, Character, clip placement/edit, root motion, history, clone/reload and CPU/WebGL parity (65 bones; max delta `4.440892098500626e-16`); zero console errors, failed requests or external requests. Screenshot inspected: [Animation workspace](../../../three-workspace-app/.test-runtime/browser/doc038-animation-workspace.png).
- Studio typecheck, targeted ESLint and smoke-script syntax passed. The Next dev server was stopped and its temporary `tsconfig.json` include was removed. No Site, release, commit, source-workspace edit or game run.
- LISTCODE remains28 groups:23 partial,5 unstarted,0 fully complete; within1.1–1.7,21 partial and3 unstarted. The reused Topview controls do not prove Animation1.31.8 parity: IK, skin, compare/onion-skin, native graph/layers/motion-lab, edit blobs and exporters remain.
- [Evidence, source hashes and browser artifacts](evidence/animation-workspace.yaml).

## DOC-037 — 2026-10-18 — Camera/shot export sampling

DOC-037: camera/shot CPU sampler dùng CameraRig và helper applyEvaluatedCamera chung với viewport; xuất position/quaternion/lookAt/verticalFov/aspect/near/far, sourceFrame và thời gian shot/sequence. Giữ left/right riêng tại cut, loop endpoint không wrap, manual roll/user keys/own aspect/path/orbit được kiểm. sampleProjectCameraSequence gắn sourceRevision và saved overlays; không mutate project. Camera bám target có trajectory bị chặn tới khi effective-world subject evaluation được nối. Builder96 files/554 tests; Studio/shared/Retarget37/37; build/source-test typechecks/targeted lint đạt. Browser FBX regression đạt65-bone CPU parity và64 aliases identity sau gap. Snapshot hai shot3s tạo62 mẫu gồm hai endpoint, cut t=1 giữ previous-left/next-right. Chưa có Film codec/assets/export jobs, grid20Hz cut preflight hoặc game acceptance.
- Export boundary bổ sung tùy chọn vào evaluateCameraPoseInto; preview chọn clip như cũ. Camera chain cache export riêng giữ loop end-left; raw camera time vẫn dùng frame ratio/trim/source native. Nonuniform scale camera không được bake ở đây.
- [Evidence/source/build hashes](evidence/camera-sampling.yaml). Browser và two-shot snapshot là hai draft test khác nhau, IDs ghi riêng. Smoke server đã dừng, tsconfig include thử đã gỡ; không release/Site/commit/game.

## DOC-036 — 2026-10-18 — CPU range và export boundary

- DOC-036: sampler CPU stream range inclusive sang grid20Hz + một endpoint left; 3s@30 cho61 mẫu, đoạn1s cho21. Endpoint chọn clip trước tại cut, loop/reverse không wrap về pose đầu; trajectory/path cùng ownership, trim/speed/fractional time giữ nguyên. Host chọn CharacterID tường minh, preflight source một lần và dispose trong finally; không tạo artifact sản phẩm/job. API/range nay áp saved user keys như browser mặc định. Range FBX thật phát hiện pose reset làm hỏng64 alias; applyPose bỏ qua alias và stopAll dừng cả action đã clamped. Browser kiểm đủ64 alias identity sau gap và giữ CPU/browser65-bone parity. Builder95 files/549 tests; Studio/shared/Retarget37/37; build/typechecks/targeted lint đạt. Chưa có converter/export/job/Film codec hoàn chỉnh hoặc camera/shot export endpoint; full acceptance còn thiếu.
- sampleSkeletonRange(scene,{startFrame,endFrame,sampleFps},evaluate) dùng evaluator đã load, yield grid interior/right và đúng một terminal/left. Scene runtime exportSampleBoundary + clampSource chỉ được đặt cho export; preview/golden cũ giữ nguyên. Parent/path ownership và trajectory predecessor dùng cùng boundary. Native float32 source endpoint có tolerance1e-7s khi chọn left limit ở loop.
- sampleProjectSkeletonRange(project,range,characterIds) là input backend cho converter: selected ID validation, hash/path/source decode preflight, một evaluator cho range, sourceRevision mỗi sample, dispose khi return/throw. Không phải asset.convert/job hay Film native.
- applyPose/findCanonicalBones/library reset nay bỏ qua FBX identity aliases; action đã finished/clamped được stop để trả bind position trước gap. Ca lỗi thật ban đầu báo duplicate bone ở range0..89 đã được tái hiện, sửa và kiểm đủ65 bone ở61 samples. Browser sau motion→gap giữ64 aliases identity.
- projectEvaluationScene dùng chung saved FCurves + userKeys enabled mặc định; trước đó scene.evaluate bỏ qua saved user-key overlay. Camera key API và actor key range tests đã đạt; transient UI mute không được serialize vào project.
- [Report/build/source hashes](evidence/range-sampling.yaml), numeric artifacts61/21 samples và browser65-bone parity. Range artifact và browser regression dùng hai draft test riêng, cùng fixture nguồn; projectId được ghi riêng trong evidence.
- Test range ban đầu giả định upstream makeEmptyDraft frameEnd89 nhưng native trả90; negative test đổi sang meta.frameEnd+1. Không sửa native duration/golden để làm test đạt. Sampler selected0..89 vẫn đúng3s theo contract.
- 1.6.2 chuyển partial chỉ cho preflight/range input; converters/jobs/atomic output vẫn chưa có. Tổng28 nhóm:22 partial,6 chưa triển khai,0 hoàn tất. Riêng1.1–1.7:24 nhóm,20 partial/4 chưa triển khai. Không release/Site/commit/game; smoke server đã dừng, tsconfig include thử gỡ.

## DOC-035 — 2026-10-18 — CPU skeleton evaluation qua API

- DOC-035: scene.evaluate đọc asset đã kiểm SHA/path và trả skeletonSamples CPU gồm đủ bone local pose/world matrices, placementMatrix, trajectoryMatrix, actorWorldMatrix và metersPerUnit. Dùng chung buildCharacterRig, CharacterAnimator/MotionPlayer và root sampler với browser; entrypoint /skeleton riêng không kéo renderer/MediaBunny. Native model/motion templates không bị sửa; đọc không đổi revision/history. Browser/API đối chiếu65 bone FBX thật đạt max world-matrix delta4.440892098500626e-16. Builder94 files/544 tests; Studio/shared/Retarget37/37; build/typechecks/targeted lint đạt. Thiếu source, texture/compression không decode được, rig không hỗ trợ hoặc library pose chưa nạp trả issue rõ ràng; loader chặn tài nguyên ngoài. Còn thiếu range bake/export, native Animation, Retarget khác rig, geometry checks/render và Film/game; production EPERM/clone500 chưa sửa.
- Mỗi request decode unique source một lần; resolveUnifiedAssetFile xác minh bytes, size, SHA và chống traversal/symlink. LoadingManager chỉ nhận data URI, không truy cập tài nguyên ngoài. Skeleton names/count phải khớp profile trước khi sample. Unsupported/missing source trả issue, không trả rest pose giả làm kết quả thành công.
- Header giữ transforms ở authored-placement; skeletonMatrixOrder=column-major, boneLocalSpace=model-units, boneWorldSpace=scene-meters. skeletonSamples là output bổ sung; poseSamples cũ giữ nguyên. Runtime evaluator có dispose và native source registration với frozen bind.
- Browser thực gọi API scene.evaluate ở frame40 sau trajectory/reload/clone; đối chiếu đủ65 bone world matrices. Hai run đạt; screenshot đã xem. [Report/source/build hashes](evidence/headless-skeleton.yaml).
- Rebuild khi dev server còn theo dõi dist đã gây báo styles.css tạm mất trong HMR; đã dừng server, finalize đầy đủ, khởi động lại và smoke cuối đạt. Không coi đây là lỗi đã sửa của clone500 hoặc production EPERM.
- Task count vẫn28 nhóm:21 một phần,7 chưa triển khai; phạm vi1.1–1.7 là24 nhóm:19 một phần,5 chưa triển khai. Không đánh dấu hoàn tất từ test hẹp. Smoke server đã dừng, include tsconfig thử đã gỡ; không release/Site/commit/game.

## DOC-034 — 2026-10-18 — Trajectory và nối endpoint cho FBX direct rig

- DOC-034: trajectory cho imported direct FBX tách root translation/rotation sang motionRoot dưới actor; placement/path authored không bị ghi đè. Native interpolants và rest/unit hierarchy được tái sử dụng. Loop tích lũy cả góc xoay, reverse/trim/speed giữ fractional time, origin dùng anchor nguồn và continue nối end-exclusive endpoint clip trước; seek/gap không dựa frame đã render. Shared binding/native metadata cùng revision/history; provenance path trùng nguồn trả ROOT_MOTION_CONFLICT; overlap và loop count vượt precision bị chặn. 93 file/542 Builder test; Studio/shared/Retarget37/37; build/typechecks/targeted lint đạt. Browser FBX thật đạt skeletal→trajectory world-matrix parity, max delta6.625060056109078e-9, seek lùi/reload và0 external requests. Chưa có headless root bake/export, general skeletal alignment, fades, khác-rig bake, native Animation hay Film/game acceptance; camera follow và gizmo/autosave trajectory chưa kiểm. Clone500/production EPERM chưa sửa.
- `engine/objects/rootMotion.ts` dùng track interpolant native và matrix conjugation qua parent/unit; không ghi lại source clip. MotionRoot giữ matrix chính xác, gồm shear do source/actor scale không đồng đều. Actor root giữ authored placement để gizmo không tự ghi delta vào placement lần nữa; label đi theo motionRoot.
- `FrameSnapshot.frame` là trường tùy chọn để engine sample source elapsed/cycle và endpoint tuyệt đối. Native rootMotion thêm trajectory và alignment tùy chọn; dữ liệu DOC-033 thiếu alignment vẫn tương thích.
- Kiểm thử số gồm model-parent animation, rest rotation, nonuniform actor scale, root/limb world matrices, trimmed speed2 loops/reverse, endpoint/gaps/continue; negative tests cho conflict dry-run/mutation, overlap và excessive loops. Browser origin parity với Punch Combo; chưa browser-test hai clip continue.
- `scene.evaluate` headless chưa có loaded skeleton; trả issue SKELETON_EVALUATION_UNAVAILABLE khi có trajectory để không nhầm placement transform là kết quả bake. Conflict detection yêu cầu provenance `path.derivedSource.motionClipId` hoặc `motionId`; path độc lập vẫn được phép.
- [Evidence/source/build hashes](evidence/trajectory.yaml); screenshot đã xem trực tiếp. Smoke storage riêng được giữ để kiểm; server đã dừng, include tsconfig smoke được gỡ. Không release/Site/commit hoặc chạy game.

## DOC-033 — 2026-10-18 — Root motion tại chỗ cho FBX direct rig

- DOC-033: in-place cho FBX direct rig qua motion.binding.set và form Sửa clip; root translation/quaternion về rest theo SkeletonProfile, giữ limb animation, unit và actor placement. Native rootMotion/inPlace và shared binding được ghi cùng transaction; validation chặn sai bone/policy/rig và document.replace xóa policy. Builder 93 files/539 tests; Studio/shared/Retarget 37/37 với FBX thật; build/typechecks/targeted lint đạt. Browser Chromium153 xác nhận root rest tại frame30/40, actor(2,0,0), tay đổi pose, Undo/Redo, clone/reload và 0 external requests. Trajectory/alignment/fades, cross-rig bake, native Animation và Film/game chưa hoàn tất; clone500 ngắt quãng và production build EPERM chưa sửa.
- Reuse CharacterAnimator và rest cache; không thêm solver hoặc đổi source FBX. MotionClip.rootMotion là field tùy chọn; draft cũ không có field giữ đường phát cũ. CLI/MCP dùng binding payload hiện có.
- Browser lần đầu timeout vì implicit select label gồm cả option text; thêm accessible aria-label đúng tên. Hai run sau đạt; screenshot đã xem trực tiếp. Artifact/hash ở [root-motion.yaml](evidence/root-motion.yaml).
- Không có release/Site/commit, không chạy game, không sửa ba nguồn gốc.

## DOC-032 — 2026-10-18 — FBX Model và browser xuyên workspace

- FBX có mesh tạo model Asset kèm Motion, dùng source profile cho Character/direct binding. `extensions.assetImportModels` giữ format/unit; node metadata modelFormat/modelUnitMeters/preserveMaterials điều khiển loader và wrapper unit. Giữ skin, material groups/alpha và transform nguồn; actor XYZ tách khỏi model unit. FBX không có mesh báo FBX_NO_GEOMETRY; reimport có thể nâng source-only Asset cũ thành model mà giữ bytes/ID. Validator chặn profile sai source và Character unit lệch profile. CLI FBX yêu cầu unit tường minh; project hợp nhất mới mặc định 30 fps.
- Next API thực phát hiện helper từ main entrypoint bị proxy `use client`. Helper chuyển thành pure structural/numeric tại `evaluate/retarget/fbxSourceBones.ts` và export từ evaluate; main/engine re-exports giữ tương thích. `duplicateDocumentNodes` cũng có server-safe evaluate export; broker đổi sang export đó. ESLint shared có TypeScript parser, evaluator không import Three.
- Legacy offline smoke đạt tạo draft → thêm Character → áp pose → lưu, 0 request ngoài; sửa selector và cleanup qua API. Unified smoke đạt Retarget nhập Punch Combo → lưu source → thêm Character → Animation đặt/sửa trim/reverse → Scene render 2 skinned meshes ở unit 0.01 → pose frame 30/40 thay đổi → Undo/Redo → server clone → reload. Report có time/version và passed=false khi lỗi, tránh artifact pass cũ. Screenshot đã xem trực tiếp; artifact/hash ở [browser-smoke.yaml](evidence/browser-smoke.yaml).
- Đạt: Builder 92 file/538 test, golden không đổi; Studio 25/25 với FBX thực; shared/Retarget 12/12; Python CLI/MCP 30/30. Builder build/finalize và source/test typecheck, Studio/shared typecheck, targeted lint đạt. Chromium 153.0.8010.12, viewport 1600×1000; ba run gần nhất đạt, pose component delta 0.1350244.
- Lỗi clone IO_FAILED 500 từng xuất hiện giữa các run, chưa chốt nguyên nhân; không coi ba pass cuối là bằng chứng lỗi đã sửa. Development diagnostic giới hạn loại lỗi/native code/syscall và TypeError không chứa path, không ghi payload. Production Next build vẫn fail EPERM: trace quan sát glob `C:/Users/Administrator/AppData/Local/**/*` chạm junction Application Data, kể cả standalone với tracing root tường minh. Không bypass filesystem hoặc sửa vendor. [NFT analysis](https://github.com/vercel/nft#analysis) mô tả cơ chế emitGlobs.
- Smoke dùng storage `.test-runtime` riêng, server đã dừng và include tsconfig thử đã gỡ; artifacts được ignore. Không tạo release/Site/commit, không sửa nguồn gốc. Root-motion/alignment/fades, cross-rig bake, native Animation editor, formats còn thiếu và Film/game vẫn chưa hoàn tất.

## DOC-031 — 2026-10-18 — Import và phát ngược trên FBX Mixamo thực

- Fixture FX-MIXAMO-PUNCH có SHA-256 `acd9e347686dfabda0a3cac3207885d96f466795753882284f3b4ddfb29fabeb` khớp manifest. Test thực phát hiện FBXLoader tạo 129 Bone objects cho 65 source bones dùng chung mesh; identity child alias cùng FBX ID bị nhầm là bone trùng tên thật. File còn có một animation stack rỗng.
- Thêm helper public `fbxSourceBones` để importer và Retarget preview dùng cùng danh sách source bones. Nhận diện alias bằng nguồn ID/originalName, thiếu transformData và transform identity; vẫn chặn bone trùng tên thật. Không tháo alias khỏi mesh/skin hoặc đổi bytes nguồn. MotionPlayer bỏ qua alias khi capture rest bind để tránh ghi đè rest thật; hỗ trợ cả clone của Three làm mất custom ID nhưng giữ userData.
- Import bỏ stack hoàn toàn rỗng, giữ clipIndex của array gốc. Broker không còn giả định clipIndex phải nhỏ hơn số Motion được nhập, vì stack rỗng có thể tạo khoảng trống. Retarget UI không đưa stack rỗng vào lựa chọn. Regression đối chiếu pose native với direct-bind trim/reverse cho đủ 65 bone, angular tolerance 1e-5 rad và position tolerance 1e-5 source units; đây là numerical test, chưa phải skin/WebGL acceptance.
- Đạt: toàn bộ 91 file test Builder, 535/535 (gồm FBX thực và golden evaluator không đổi); Builder build/finalize và source/test typecheck; cả 5 file test Studio, 25/25 không skip với fixture thực; Studio typecheck và changed-file ESLint. Python CLI/MCP 29/29 ở DOC-030. Hai fixture motion/pose cache cũ được bổ sung playback fields theo contract.
- Studio dùng helper từ main public export để tránh nạp song song main/engine bundle và cảnh báo Mediabunny hai lần. Chạy lại suite không còn cảnh báo đó. Browser/WebGL, full conversion-format parity, root-motion/alignment/fades, cross-rig bake và Film/game chưa được nghiệm thu.

## DOC-030 — 2026-10-18 — Giao dịch chỉnh MotionBinding đã đặt

- Nối `motion.binding.set` vào broker, form Animation, Python CLI `motion binding set PROJECT binding.json --expected-revision N [--clip-patch patch.json]` và MCP (13 command). Sửa source range/reverse, Motion/Character tương thích, frame range và speed/loop mà giữ ClipID; thiếu frameEnd thì giữ span cũ. Các native field khác được giữ.
- UI giữ revision lúc bắt đầu sửa; CLI/MCP bắt buộc revision của snapshot và từ chối trước dispatch nếu thiếu, tránh ghi đè thay đổi mới. Broker từ chối trường lạ, range/speed lỗi, sai rig/đơn vị, Character khóa và overlap inclusive. Root-motion/alignment/fade chưa có evaluator trả UNSUPPORTED_CAPABILITY. Dry-run không ghi; retry requestId, revision conflict và Undo/Redo dùng hạ tầng chung.
- Đã chạy: cả 5 file test Studio, 24 pass/1 FBX fixture skip; Studio typecheck và targeted ESLint; Python CLI/MCP 29/29. Builder không thay source trong mốc này; bằng chứng build/schema và 13 test Builder nằm ở DOC-029.
- Chưa kiểm form thực trên browser/WebGL, MCP host/live broker, FBX fixture thực, Film/game; chưa hoàn thành root-motion/alignment, fades, bake khác rig, Animation Graph/keys/layers hoặc toàn LISTCODE. Source gốc giữ nguyên.

## DOC-029 — 2026-10-18 — Source trim và reverse cho FBX motion

- `motion.place` nhận source start/length và reverse qua UI, CLI, MCP; timeline span được tính theo sourceLength/speed. Builder evaluator giữ thời gian fractional trong source window, hỗ trợ reverse/loop, và playback non-loop seek được lùi mà không rơi về rest pose. `MotionBinding` được cập nhật cùng sửa clip qua `scene.apply`.
- Playback cache/prefetch phân biệt `(AssetID, clipIndex)`; nhiều clip của cùng FBX được nạp riêng. Regression bao phủ trim, clamp, loop/reverse, clip index, non-loop reverse seek, binding và Undo/Redo.
- Kiểm tra đạt: Builder build/finalize/schema; Builder focused tests 13/13 và source/test typecheck; Studio integration 11 pass/1 FBX fixture skip, typecheck và targeted ESLint; Python CLI/MCP 26/26. Chưa chạy full suites, browser/WebGL, live MCP host, Film/game hoặc nghiệm thu người dùng. Vì FBX fixture bị skip, chưa xác minh runtime trên file FBX thực.
- Root-motion/alignment, bake khác rig, Animation keyframe editor, browser/WebGL, live MCP host, Film/game và nghiệm thu người dùng vẫn chưa được kiểm.
- Không sửa Topview source checkout hoặc workspace nguồn.

## DOC-028 — 2026-10-18 — Runtime phát đúng FBX clip index

- Sửa cache `MotionPlayer` trong bản sao Builder để key theo asset ID và clip index; raw UAL1 preview và direct-bind playback cùng nhận index từ `MotionClip`. Trước đây cache theo asset ID có thể trả clip đầu tiên khi nhiều clip cùng dùng một FBX.
- Regression dùng cùng asset ID với index 0/1 và kiểm cả raw/direct-bind clip. Builder focused tests 8/8, source/test typecheck, Builder build/finalize, Studio focused suite 11 đạt/1 FBX fixture skip, Studio typecheck/ESLint, Python CLI/MCP 26/26.
- Không sửa Topview source checkout hay workspace nguồn; browser/WebGL, live broker, Film/game chưa kiểm.

## DOC-027 — 2026-10-18 — Speed và loop cho FBX motion placement

- `motion.place` nhận `speed` (0.01–16, mặc định 1) và `loop` (mặc định false). Tốc độ điều chỉnh độ dài clip trên timeline; trạng thái loop được ghi vào Topview playback fields. UI Animation, Python CLI (`--speed`, `--loop`) và MCP dùng cùng broker command; chỉ áp dụng clip đầy đủ trên rig cùng fingerprint/đơn vị.
- Regression kiểm validation speed, dry-run, clip index, duration nguồn, speed/loop trên hai playback fields, binding và Undo/Redo. Python CLI/MCP test xác nhận forward tùy chọn.
- Kiểm lượt này: Studio 11 đạt/1 fixture FBX skip; Studio typecheck và ESLint; Python CLI/MCP 26/26. Chưa smoke test browser/WebGL, live broker/MCP host hoặc Film/game.
- Còn thiếu: trim, reverse, root/alignment evaluation, cross-rig bake và chỉnh keyframe; source workspaces giữ nguyên.

## DOC-026 — 2026-10-18 — Shared FBX Motion placement in Animation workspace

- Added `motion.place` across broker, shared history, Animation UI, Python CLI and MCP. Requires a Motion from an imported FBX, a valid stored clip index, and matching Character skeleton fingerprint and unit; places the full clip at a start frame using Topview overlap shifting, and creates a shared MotionBinding.
- Topview `AssetLoader` forwards the selected clip index and `MotionPlayer` loads that FBX animation; Topview MotionClip schema now accepts an optional non-negative `clipIndex`.
- Verification: Studio focused suite 11 passed/1 fixture skipped; focused Builder clip-index/intent suite 7/7; Python CLI/MCP 26/26; Builder/Retarget/Studio typechecks, Builder build and targeted ESLint passed; 18 YAML files parsed, 28 LISTCODE IDs are unique, command contract and generated JSON schema include the new capability.
- Limits: no cross-rig retarget, V9.12 bake, source-range/reverse/root-motion controls, Animation graph/key/layer editing, browser/WebGL test, live broker/MCP test or Film/game acceptance. Original workspaces unchanged.

## DOC-025 — 2026-10-18 — Áp reference pose V9.12 vào Retarget preview

- `context.sourcePose` từ snapshot session nay làm quaternion tham chiếu của solver nguồn. Chỉ kích hoạt khi session hợp lệ, mapping ID trùng, source FBX SHA-256 trùng và đơn vị khớp; đổi session, motion, character hoặc mapping sẽ gỡ snapshot khỏi preview. Solver đích vẫn dùng armature BOBJ V9.12 tĩnh.
- Files: `editor/packages/retarget/src/reverse.ts`; `editor/apps/studio/app/workbench/components/{RetargetPreview,RetargetSessionPanel,RetargetWorkspace,SkeletonMappingEditor}.tsx`; regression `editor/packages/retarget/test/reverse.test.ts`.
- Kiểm: reverse-reference 2/2; Retarget/Studio typecheck và ESLint bốn component đạt. Node strip-only full-suite run không resolve được một số import extensionless và parameter properties; full suite chưa rerun. Browser/UI/API và Film/game chưa kiểm.
- Giới hạn: chưa dùng target profile rest matrices/skin, chưa bake hoặc đạt parity/golden; implementation gốc không bị sửa.

## DOC-024 — 2026-10-18 — Topview editor clone giữ shared records khi autosave

- Topview selection clone gửi toàn Scene qua document.replace; broker đối soát source ID theo quy ước clone của Topview, tạo CharacterID riêng và sao chép MotionBinding cho các clip clone trong cùng revision.
- Regression dùng Topview duplicateDocumentNodes helper rồi đi qua document.replace, xác minh Character/MotionBinding/FCurve và Undo.
- Kiểm: Studio suite 34 test (33 đạt, 1 FBX fixture skip); Studio typecheck và targeted ESLint đạt.
- Giới hạn: cần giữ quy ước ID clone của Topview; browser interaction/live autosave chưa smoke-test.

## DOC-023 — 2026-10-18 — Reparent primitive giữ world transform

- scene.apply thêm node.reparent cho primitive tĩnh giữa scene root và group gốc; cập nhật parentId/children và phân rã ma trận Three.js thành TRS cục bộ giữ nguyên world transform. CLI/MCP chuyển operation qua broker.
- Chặn node/group bị khóa, parent không hỗ trợ, node có keyframe/motion, group lồng nhau, parent singular và kết quả cần shear; không ghi thay đổi khi chặn.
- Kiểm: Studio suite 34 test (33 đạt, 1 FBX fixture skip); reparent test xác minh matrix trước/sau, Undo và keyed-node rejection; Python CLI/MCP 25/25. Shared/Retarget/builder/Studio typecheck và targeted ESLint đạt.
- Còn thiếu: reparent cho node animated/khác primitive, browser/live broker interaction, catalog/path/full SCENE-01 acceptance và Film/game.

## DOC-022 — 2026-10-18 — Scene clone giữ dữ liệu native

- scene.apply thêm node.clone qua helper công khai của Topview; nhân bản node con, motion/camera/path clips, FCurves và user keys. Shared Character ID và MotionBinding được cấp/remap trong cùng revision/history; delta transform là tùy chọn.
- CLI và MCP chuyển nguyên operation clone; regression test kiểm clone Character/clip/binding/FCurve và Undo. Không sửa source Topview gốc.
- Kiểm: Studio suite 33 test (32 đạt, 1 FBX fixture skip); Topview focused suite 23/23; shared/Retarget/builder/Studio typecheck, targeted ESLint; Python CLI/MCP 25/25.
- Còn thiếu: reparent, browser/live broker interaction, full SCENE-01 acceptance và Film/game.

## DOC-021 — 2026-10-18 — Batch Scene node operations qua shared history

- `scene.apply` nay nhận tối đa 64 operations cùng batch: `node.transform.patch`, `node.flags.set`, `node.rename`, `node.delete`; `document.replace` tiếp tục được hỗ trợ riêng. CLI/MCP forwarding hiện có dùng nguyên envelope broker, không cần giao thức thứ hai.
- Reuse Topview transform patch, group/derived-path delete, timeline/editorial cleanup; toàn batch dùng một revision/Undo. Character/FCurve/user keys/bindings được reconcile; tham chiếu camera hoặc Retarget còn sống làm rollback cả batch.
- Kiểm: Studio suite 32 test, 31 đạt, 1 FBX fixture skip; 16/16 Topview intent/editorial helper tests; shared/Retarget/Studio typecheck, targeted ESLint; Python CLI/MCP 25/25; 18 YAML parse và 28 LISTCODE IDs duy nhất.
- Còn thiếu: clone/reparent, browser/live broker interaction, full SCENE-01 acceptance và Film/game.

## DOC-020 — 2026-10-18 — Scene replacement dọn Character có kiểm soát

- `scene.apply` thay document nay xóa Character cùng binding clip đã mất trong cùng revision/history transaction; xóa node cũng dọn FCurve và user keys tương ứng. Chặn commit nếu camera/timeline/path/editorial shot hoặc Retarget session còn tham chiếu Character; validation chạy trước khi ghi.
- Regression test xác minh xóa + Undo khôi phục Character, FCurve stale bị dọn, và camera tham chiếu sống làm transaction thất bại mà revision không đổi.
- Kiểm tra: shared/Retarget/Studio typecheck, ESLint hai file đổi; TS suite 31 test, 30 đạt, 1 FBX fixture skip; Python CLI/MCP 25/25 và 18 YAML parse được.
- Giới hạn tại checkpoint đó: broker `scene.apply` chỉ nhận một `document.replace`; browser/live broker smoke và Film/game validation chưa làm.

## DOC-019 — 2026-10-18 — Ràng buộc parent/children trong Scene Graph

- Shared project validator giờ chặn group parent/child bị thiếu, child lặp, parent không phải group và vòng lặp. Không tự sửa hoặc loại node khỏi source document.
- Kiểm: shared/Retarget/Studio typecheck; suite 29 pass, 1 FBX fixture skip. Các tham chiếu timeline/camera và adapter unit/trục vẫn thiếu.

## DOC-018 — 2026-10-18 — Python CLI scene.apply

- Implemented trong app copy: `scene apply PROJECT_ID operations.json` đọc UTF-8 JSON array tối đa 64 MiB rồi gửi `scene.apply` qua shared broker; CLI không ghi manifest trực tiếp.
- Kiểm: Python CLI/MCP 25/25; kiểm file không phải array và file quá giới hạn trước dispatch; `scene apply --help`, Python compile và 18 YAML parse đạt.
- Giới hạn: broker hiện chỉ hỗ trợ một `document.replace`, chưa có batch node operations; live broker chưa smoke-test.

## DOC-017 — 2026-10-18 — Đặt model không rig thành Scene prop

- Implemented trong app copy: command `prop.add` dùng Topview `buildPropNode`; UI asset rail, Python CLI và MCP có thể gọi command. Chỉ nhận model asset có sẵn, giữ blob/content URL, hỗ trợ transform/group parent ở broker và ghi shared history; không tạo Character/Skeleton record.
- Kiểm: shared/Retarget/Studio typecheck, targeted Studio ESLint; 29 test pass/1 FBX fixture skip, gồm validator asset reference/group hierarchy và dry-run/Undo/Redo cho prop; Python CLI/MCP 25/25, Python compile, `scene apply --help`, `prop add --help`, 18 YAML parse đều đạt.
- Giới hạn: chưa browser-smoke-test prop UI hoặc live broker/MCP host; SCENE-01 vẫn partial vì full catalog, pose, hierarchy operations và runtime acceptance còn thiếu.

## DOC-016 — 2026-10-18 — Python CLI/MCP lưu session V9.12

- Implemented trong app copy: `retarget session set` đọc JSON UTF-8 tối đa 12 MiB và gửi lệnh `retarget.session.set` qua broker; MCP cho phép cùng command trong schema 10 lệnh và chặn snapshot quá cỡ. Bake/export chưa được mở.
- Kiểm: Python CLI/MCP unit tests 21/21, Python compile và `retarget session set --help` đạt; 18 YAML parse được.
- Giới hạn: chưa smoke-test CLI/MCP với live Studio broker hoặc host MCP thật; lệnh chỉ lưu snapshot, không apply solver/bake/export.

## DOC-015 — 2026-10-18 — Preview mapping và lưu session V9.12 (một phần)

- Implemented trong app copy: reverse preview dùng mapping/calibration đã lưu khi hash FBX, unit và hierarchy đích tương thích; GLB profile nhận Mixamo65 theo core signature. `retarget.session.set` kiểm tra V9.12 JSON, so fingerprint nguồn với metadata lúc import, kiểm profile/entity references, ghi native JSON thành blob hash-addressed và đưa session vào shared revision/history. Retarget UI import/save/load/download snapshot; GET route được giới hạn bởi local session/project/session ID.
- Kiểm: shared/Retarget/Studio typecheck; ESLint các file Studio đổi; 26 test pass, 1 FBX importer test skip vì chưa đặt `BBS_TEST_MIXAMO_FBX`; validator/session test kiểm hash blob, Undo/Redo và fingerprint sai không commit.
- Giới hạn: session test dùng source fingerprint tổng hợp; real FBX importer fingerprint generation và browser UI/API chưa smoke-test. Native target fingerprint chưa được đối chiếu với rest matrices của Character; snapshot chưa điều khiển solver/evaluator. Không đánh dấu RETARGET-02 hoặc RIG-01 đạt. Còn Metarig skin, reference pose, feet/hands, bake/export và timeline.

## DOC-014 — 2026-10-18 — Semantic Retarget mapping and calibration persistence (một phần)

- Implemented trong app copy: exact-alias role suggestions (ambiguous names remain unassigned), mapping editor theo stable bone ID, target-family required-role checks, explicit reasons cho mọi xương dư. `skeleton.mapping.set` kiểm fingerprint/assignments, lưu V9.12 calibration JSON theo SHA-256, derives `confirmed`, và đưa mapping/blob ref vào shared revision/history. Người dùng có thể chọn mapping đã lưu, nạp lại calibration qua local GET đã xác thực, sửa role/calibration rồi cập nhật cùng mapping ID; history giữ nguyên Undo/Redo.
- Kiểm: shared/Retarget/Studio typecheck và targeted ESLint đạt; shared/Retarget/Studio test suite 22 pass/1 skipped (fixture FBX chưa đặt), mapping/calibration tests 6/6 pass; 18 YAML parse được. RETARGET-02 và browser UI/API interaction chưa chạy.
- Còn thiếu: solver chưa dùng mapping/calibration đã lưu; chưa có retarget session, reference pose, Metarig semantic profile/skin rebind, feet/hands, bake/export hoặc timeline placement. Không đánh dấu RETARGET-02/RIG-01 đạt.

## DOC-013 — 2026-10-18 — Native BOBJ action playback (một phần)

- Implemented trong app copy: `evaluateBobjAction` sample V9.12 groups theo `restLocal × T × Rz × Ry × Rx × S`, nhân world theo hierarchy; `MinecraftActionPreview` phát/scrub pose lên armature Minecraft20 trong Three.js.
- Validation: 7 Retarget tests gồm sample finite toàn85 action và xác nhận có pose đổi; Studio/Retarget typecheck, ESLint và 5 asset import tests đạt. Temporary Next route in Edge WebGL loaded the native armature, showed the canvas, and Play advanced the clip time; route/server đã gỡ/tắt. Golden matrix parity chưa chạy.
- Limit: vẫn thiếu mapping/calibration, compare Mixamo/BOBJ đồng bộ, bake, export và timeline placement.

## DOC-012 — 2026-10-18 — FBX source Motion persistence (một phần)

- Implemented trong app copy: Retarget Preview có thể lưu FBX vào project qua upload có session; importer Node trích profile rig bằng Three FBXLoader, nhận diện Mixamo65 khi đủ topology/names, suy ra FPS từ sample intervals, lưu mỗi clip thành Motion cùng metadata và giữ bytes gốc hash-addressed. Asset/profile/motions cùng một history transaction; nhập trùng cùng file+unit dedupe, Undo/Redo khôi phục project references.
- Validation: Studio+Retarget typecheck, ESLint và test mục tiêu 11/11 đạt; integration dùng `Thriller Part 2.fbx` xác nhận65 bones, 30 FPS, cm→m metadata, source bytes không đổi, dedupe và Undo/Redo.
- Limit: chưa kiểm nút Save qua browser/API; FBX cần texture decode qua DOM có thể bị Node importer từ chối. Đây mới là source Motion, chưa có mapping/session, bake, clip placement, Animation workspace hay Film.

## DOC-011 — 2026-10-18 — Reverse Retarget preview Mixamo65→Minecraft20 (một phần)

- Implemented trong bản sao app: port solver reverse V9.12, parser armature Minecraft20 20 xương multi-root, local FBX/clip player, cm/m conversion và source/target WebGL skeleton preview; giữ 85-action library. Correction UI gồm intensity, stride, vertical/root, mirror, proportion và arm spacing.
- Provenance: source HTML SHA-256 vẫn `010C5519318D0272381EE35035170D234E0FB6AC737E10459215B943C98B850C`; armature BOBJ 2,843 bytes, SHA-256 `86C47894747B96C8C3A000A267E07796F72C4B6D4367CEBF38B3C4F6586DDE2D`; GPL attribution/license được cập nhật.
- Validation: Retarget tests 6/6; Retarget/Studio typecheck và component ESLint đạt; `Thriller Part 2.fbx` + `Flair.fbx` cho 65 bones, 13/13 source mapping, 20 animated/finite target bones; Edge headless WebGL upload/play/pause/unit/correction smoke đạt. Temporary browser route đã gỡ.
- Limit: chỉ reverse Mixamo65→Minecraft20; chưa có source Asset/Profile/project persistence, mapping/calibration tự chọn, Metarig, forward solver, feet/hands, bake/export, CLI/MCP, Film/game acceptance. Production Next build vẫn dừng vì `EPERM` khi Next glob `C:\Users\Administrator\AppData\Local\Application Data`; workspace source chưa commit.

## DOC-010 — 2026-10-18 — Thư viện action Retarget V9.12 (một phần)

- Implemented trong bản sao app: thêm package `@bbs/retarget` với parser BOBJ và evaluator channel giữ tick/interpolation semantics V9.12; trích 85 action, manifest và label vào Retarget UI; tìm kiếm/chọn clip, nạp và kiểm dữ liệu. Source HTML V9.12 không sửa.
- Provenance/license: HTML source SHA vẫn khớp `SOURCES.yaml`; payload BOBJ 3,357,829 bytes, SHA-256 `0CAA59054918F19AE42536D21BA530CDA25CF37D9E7C60BE074B0F56A07244A3`; dữ liệu đánh dấu GPL-3.0-only, kèm attribution và license text.
- Validation: `retargetBobj.test.ts` so khớp names/bones/key counts/duration của đủ 85 clips với manifest; interpolation và malformed input; tổng test Studio mục tiêu 9/9; package+Studio typecheck và ESLint component đạt. Next dev `/` và static BOBJ/catalog routes trả 200; `pnpm list -r` nhận package mới. Lockfile-only install check dừng do cache offline thiếu metadata `@next/swc-linux-x64-musl`.
- Remaining: FBX/source rig loading, 65↔20 solver, mapping/calibration/reference pose, corrections/feet/hands, preview, project commands, bake/export, CLI/MCP, browser UI/WebGL và user acceptance chưa có.

## DOC-009 — 2026-10-18 — Local MCP command bridge

- Implemented: `agent/unified_mcp.py` serves MCP stdio `2026-07-28` with `server/discover`, `tools/list`, `tools/call` and `ping`. One schema-limited command tool forwards supported project/Scene/character/camera/history commands to the existing Studio broker; output is structured JSON, mutation revision and requestId are preserved, and no stdout is emitted outside JSON-RPC.
- Validation: Python CLI/MCP unit tests 17/17; MCP stdio discovery/list smoke; Python compile. No third-party dependency was added.
- Remaining: only the stdio transport and supported command subset are implemented. File upload/relink, jobs, Retarget/Animation, legacy MCP protocol versions and approval behavior in a real MCP host are not covered; MCP host must prompt before mutations.

## DOC-008 — 2026-10-18 — Hash-checked asset relink

- Implemented: `asset.relink` validates asset ID, staged upload, SHA-256 and byte length; restores missing immutable source bytes (and original bytes when they share the same content hash). Existing/corrupt content-addressed blobs are never overwritten. Scene asset cards expose the relink picker; Python CLI exposes `asset relink` through the same broker. Wrong-hash files leave project revision unchanged.
- Validation: Studio typecheck and ESLint pass; targeted Studio tests 6/6 pass, including missing-file restoration and wrong-hash rejection; Python CLI tests 10/10 pass; Python module compiles.
- Remaining: only restores the asset's source hash and same-hash original. It does not migrate legacy manifests, recover distinct original/derivative blobs, or implement format conversion. Browser picker/API interaction and production Next build remain unverified.

## DOC-007 — 2026-10-18 — Binary assets and shared character/camera commands

- Scope: continued implementation in the authorized `three-workspace-app/editor/` copy; no edits to pinned Topview, Animation Studio or Retarget sources; no commit, Site, release or game install.
- Implemented: session-protected local upload endpoint (256 MiB/file, staged handles expire after 24 hours); immutable content-addressed project/original blobs; glTF skin hierarchy and canonical skeleton fingerprint; PNG/JPEG asset records; hash-verified project asset reads; `asset.import`, `character.add` and Topview-native `camera.shot.set` use exact revision and shared undo history. `scene.evaluate` reuses the pinned Topview evaluator as a read-only query. Scene shell uploads/lists assets and adds characters; Python CLI exposes asset/character/camera/evaluate commands through the broker.
- Supported import limit: GLB v2, self-contained embedded-resource glTF, PNG and JPEG. glTF import preserves standard meter/Y-up interpretation and rejects external resource paths or custom unit/basis; unsupported FBX/BOBJ/MDX/MDL/League files are rejected. Models with multiple different skins are rejected instead of silently choosing one. Profile family is `custom-preserved`; native Metarig/Mixamo/Minecraft profile recognition is not implemented.
- Validation: Studio typecheck; targeted ESLint; Studio tests 5/5 passing for shot insert/update/undo, read-only scene evaluation, upload/hash/store/profile/character, duplicate content, embedded glTF and unsupported format rollback; Python CLI tests 9/9 and command help checks pass. Browser route authorization, GLTFLoader, WebGL and UI interaction were not exercised.
- Risks/remaining: `project.import` still rejects entity manifests requiring blob copy; no native FBX etc import handlers, relink, motion evaluation/binding, geometry checks/render jobs, complete Scene UI, Retarget/Animation workspaces, converters, full Python command registry or BBS Film output. New immutable blobs can remain orphaned after a failed manifest commit by design; they are not auto-deleted.

## DOC-006 — 2026-10-18 — Implementation giai đoạn C (một phần, chưa nghiệm thu)

- Phạm vi: code một phần các ID 1.1.1–1.1.3, 1.2.1–1.2.6, 1.6.1 và 1.6.3 trong bản sao riêng `three-workspace-app/`; không sửa checkout Topview/Animation/Retarget gốc, không commit/release/Site/game.
- Source: Topview v0.1.8 commit `631c08c8fd352b4ff83df33aa9a74a4563f4674b`; full source copy giữ nguyên license/NOTICE và cùng revision.
- Code chính: shared types `editor/packages/shared/src/index.ts`; project store `editor/apps/studio/src/unifiedProjectStore.ts`; session/API `editor/apps/studio/src/unifiedSession.ts` và `app/api/unified/`; adapter `editor/apps/studio/src/LocalHostAdapter.ts`; shell `editor/apps/studio/app/workbench/`; Python client `agent/unified_cli.py`.
- Hành vi được code: tạo project từ Topview document; import/export manifest scene-only; nhập legacy Topview draft/project sang project mới; Scene autosave document+fcurves trong một transaction exact revision/CAS; atomic manifest replace; request dedupe với request lock chung; undo/redo qua nút và phím tắt global (input text giữ undo riêng); API loopback có session; searchable/collapsible workspace tree.
- Kiểm đã chạy: typecheck shared, builder source+tests và Studio; build builder; 87 test files/524 builder tests; ESLint các file Studio đã sửa; locale check; store smoke với validator Zod cuối (create/CAS conflict/dedupe/request-result/undo/redo); 8 session-security assertions; dev API smoke session/create/scene commit/request-result/conflict/undo/project read/workbench route; 6 Python CLI unit tests và CLI `--help`; 10 TS + 1 JS syntax checks; 18 YAML, package manifests, lockfile và 28 task IDs parse/consistency.
- Production `next build` và `next build --no-lint` đều dừng ở `EPERM` khi Glob quét `C:\Users\Administrator\AppData\Local\Application Data`; dev server và HTTP routes chạy. `pnpm install --frozen-lockfile` tải dependency nhưng kết thúc với ignored lifecycle scripts; pnpm typecheck wrapper cần TTY để tự cài lại, vì vậy typechecks được gọi trực tiếp. Browser hydration/WebGL và người dùng chưa nghiệm thu.
- Giới hạn/rủi ro: Retarget/Animation chỉ là placeholders; chưa có asset blob copy/hash, retarget/native motion operations, coordinate conversion, conversion jobs, MCP, Film exporter/keyframe. DirectorDocument/fcurves dùng schema Topview và đã qua store/API smoke; fixture/golden đầy đủ vẫn chưa chạy. Project entity maps cho asset/character/skeleton/mapping/motion chưa có validator/operations và hiện bắt buộc rỗng. `.writer.lock` hoặc `.requests/*.lock` có thể còn lại nếu process crash; không tự cướp lock. Chỉ import scene-only unified manifests; native asset manifests trả ASSET_MISSING.
- Khôi phục: bỏ riêng thư mục `three-workspace-app/` để quay về source app chưa có implementation; docs cập nhật tại LISTCODE/STATUS/CODEMAP/HISTORY/SOURCES/inventory và đặc tả liên quan.

## DOC-005 — 2026-10-18 — Đặc tả chi tiết hoàn thiện

- Phạm vi: tài liệu/khảo sát app ba workspace; không code ứng dụng, không build/test sản phẩm, không game/Site/release/commit.
- Artifact:11feature specs; contracts/project-v1.yaml và commands-v1.yaml; inventory/development.yaml28items; acceptance.yaml33cases; fixtures/manifest.yaml14file hashes+3recipes; source-index.yaml977files/3271lexical symbol locations; SOURCES/PROJECT/CODEMAP/STATUS/REUSE_MATRIX/ROADMAP/LISTCODE được đồng bộ.
- Nguồn: Animation1.31.8,RetargetV9.12,Topview0.1.8 commit631c08c8fd352b4ff83df33aa9a74a4563f4674b. BBS2.4 commit0085f77ced9232dc4e26ac51fc7d98f95d1d5b0b; HEAD2.7 không phải target.
- Bằng chứng: evidence/animation-lineage.yaml35module+6app+2CSS match, không full vendor/template rebuild; evidence/bbs-2.4.yaml25git blobs+5bridge artifacts; metadata Three versions được đối chiếu từ source/artifact.
- Kiểm đã chạy:17YAML hồ sơ parse;28task IDs/33cases/35architecture IDs; dependencies không cycle; target/spec/fixture refs;977source hashes/3271symbol locations;100hashes manifests cũ;15fixture path hashes (14file+HTMLembedded recipe);25BBS blobs+5bridge hashes; rendered Markdown links (bỏ code fence proposal) hợp lệ. Chi tiết lần cuối ở evidence/docs-validation.yaml, report YAML được kiểm riêng.
- AGENTS nguyên vẹn65dòng; SHA25606112ffe7a2c18fc45ab7584d02711417936d75c283eac9cd7b8437bbb9e258e; dưới200dòng.
- Chưa kiểm: behavioral audit mọi module, new golden generation, runtimeJS/WebGL, Film native worker và game playback/editable keyframe. Không báo pass từ historical reports; fixtures recipe có expected nhưng chưa actual.
- Thiết kế đã đủ mô tả để review từng scope; không đồng nghĩa được code. Tên/root app vẫn cần chọn lúc duyệt triển khai. Binary bridge reuse cần giữlicense/checksum, source vendor không có.
- Không tạo source snapshot/backup mới; original sources/hash là tham chiếu, không gọi đó là restore checkpoint sản phẩm.

## DOC-004 — Áp dụng AGENTS và kiểm độ phủ đặc tả · 2026-10-18

- Phạm vi được người dùng duyệt: áp dụng AGENTS đã đề xuất, dưới 200 dòng; trả lời mức đầy đủ của đặc tả trước code.
- Artifact: [AGENTS.md](../AGENTS.md) 65 dòng, khớp nguyên khối bản đã duyệt; SHA-256 `06112ffe7a2c18fc45ab7584d02711417936d75c283eac9cd7b8437bbb9e258e`. [SPEC_READINESS](SPEC_READINESS.md) liệt kê khoảng trống theo từng nhóm.
- Kiểm tra đạt: 28/28 đầu việc phát triển có liên kết tới 11 file đặc tả; bảng readiness bao phủ đúng các ID/file này; các nhóm nội dung bắt buộc và liên kết local hợp lệ; ba AGENTS nguồn giữ nguyên hash.
- Giới hạn: đây là kiểm tra tài liệu và rà nội dung đặc tả cấp nhóm; chưa chứng minh mọi chức năng con đã được audit hoặc schema/API/fixture/Film codec đã đủ để code toàn bộ.
- Không sửa code ứng dụng; không chạy build/test sản phẩm, browser/WebGL hoặc game; không tạo Site hoặc commit.

## DOC-003 — Khóa source Topview v0.1.8 · 2026-10-18

- Phạm vi: clone tag `v0.1.8`, map monorepo và đối chiếu package Python/schema đã cài.
- Source: `.build-tools/topview-3d-builder-v0.1.8`, tag object `9005bd860917f0dd2815f8cfa764611140a58ef5`, commit `631c08c8fd352b4ff83df33aa9a74a4563f4674b`; 929 tracked files.
- Đối chiếu: 26 file `.py`/`.json` trong cache khác byte do CRLF/LF, nhưng toàn bộ nội dung khớp sau chuẩn hóa newline.
- Inventory: 75 file Studio, 434 builder package (87 test files), 22 Node renderer (5 test files), 16 Python test modules, 249 builtin asset files.
- Kiểm tra tài liệu: 9 YAML parse được; 35 ID LISTCODE/kiến trúc và các liên kết, đường dẫn entrypoint/test/symbol đại diện hợp lệ; 47/27/26 hash manifest khớp; checkout tag sạch.
- Chưa kiểm tra: chạy test/build, browser/WebGL/Studio runtime, file/symbol coverage đầy đủ của builder, Animation-to-HTML lineage, BBS Film runtime roundtrip.
- Source checkout không chỉnh sửa; đây là checkpoint tài liệu, không phải nghiệm thu sản phẩm.

## DOC-002 — Hồ sơ kiểm kê A–B · 2026-10-18

- Phạm vi: khóa/đối chiếu source Animation Studio 1.31.8 và Retarget V9.12; kiểm tra package Python Topview CLI 0.1.8; thiết kế hồ sơ hợp nhất.
- Artifact: các file nguồn ghi trong [SOURCES.yaml](SOURCES.yaml); đầu ra hồ sơ liệt kê trong [STATUS](STATUS.md).
- Kiểm tra nguồn: HTML V9.12 giống byte giữa hai artifact được băm; HTML Studio 1.31.8 giống byte giữa output giao và Site output; package local báo `__version__ == 0.1.8`. Manifest SHA-256 khóa 47 file Animation source, 27 artifact Retarget V9.12 và 26 file Python/schema Topview local. Đã đọc reports kiểm tra đã lưu; không chạy lại suite.
- BBS FS: đã kiểm tra tĩnh Film camera/replays, replay keyframe channels và Film Editor Animation-to-Pose/limb-track helpers. Chưa xác minh app ngoài có thể tạo/import package đó hoặc roundtrip trong game.
- Chặn: `git ls-remote https://github.com/topviewai/topview-3d-builder.git` thất bại kết nối GitHub:443. Chưa khóa upstream commit, không có đầy đủ source UI TypeScript/React.
- Chưa kiểm tra: runtime app hợp nhất, WebGL/game, export Film native, chỉnh keyframe Film Editor.
- Đây là checkpoint tài liệu, không phải baseline/release app. Không tạo snapshot source, commit hoặc bản sao lưu mới.

## DOC-001 — 2026-10-18

- Phạm vi: khởi tạo tài liệu app ba workspace từ nội dung người dùng cung cấp.
- Artifact: README, AGENTS và năm file PROJECT, CODEMAP, STATUS, HISTORY, CHECKPOINTS trong bộ tài liệu này.
- Nguồn/version ứng dụng: chưa xác định; không tạo build hoặc release.
- Kiểm tra: đối chiếu nội dung với yêu cầu trong chat; kiểm tra tồn tại file và đích liên kết local trước bàn giao.
- Chưa kiểm tra: source ứng dụng, retarget, WebGL, Film serializer, xuất/nhập BBS FS, khả năng chỉnh keyframe và runtime game.
- Hạn chế: đây là mốc tài liệu, không phải nghiệm thu hoặc baseline sản phẩm.
- Nguồn khôi phục: chưa tạo snapshot, commit hoặc bản sao lưu trong tác vụ này.
## DOC-114 — 2026-10-20 — native Motion GLB root name and end-to-end smoke

- Scope: resume Animation Creation goal; isolated browser smoke for native Animation Studio → project Motion → Scene runtime. No game, publish, commit or push.
- Failure found: the editor's GLTFExporter emitted an unnamed scene-root animation target. The existing project validator correctly rejected it as `PROFILE_MISMATCH` before saving the Motion.
- Change: `public/animation-studio/v1.31.8/index.html` now assigns `AuxScene` to an unnamed export wrapper root (and deterministic fallback names to other unnamed nodes) on the export copy only. Existing source bone names/transforms and project API/schema remain unchanged. The existing store validation already explicitly permits the `AuxScene` wrapper while rejecting unknown animated bones.
- Runtime: isolated server `127.0.0.1:3120`, isolated storage under `%LOCALAPPDATA%\Temp\bbs-animation-goal-20oct`; project `65a182fe-a013-4836-b7f1-abee929df9e3`; FBX fixture SHA-256 `0c3fd77e693707a1f6c99da95070d482c568b3b91d1f9a060f3b5b53db77768d`.
- PASS: import asset, add Character, wait for the host-loaded T-Pose FBX before editing (prevents the iframe's initial sample-rig load race), create 132 keys and changed Spine pose, native Undo/Redo, keep draft through Animation→Scene→Animation, persist native edit + GLB, place Motion, CPU scene evaluation (0/45/89), load GLB in Scene/WebGL (HTTP200), visible viewport playback change, placement Undo/Redo, shared Motion clone-on-edit isolation across two Characters, reload and reopen native edit. CPU frame0↔45 quaternion dot `0.9794477746581245`; frame89 CPU↔native edited pose dot `0.9999898158102627`; CPU-vs-GLB `AnimationMixer` local quaternion dots at frames0/45/89: `1.0000000000000004/1/1`; browser errors0.
- Acceptance: AC-07 remains the only accepted task, **1/9**. AC-05 remains Partial because fractional time, loop/trim boundaries, root trajectory and IK/easing parity are not measured. AC-06 remains Partial because dirty reload/disconnect recovery are not measured. No Minecraft playback claim.
- Limits: iframe still authors the baked derivative; no server-side rebake. This smoke does not validate Windows picker, Film Editor save/reopen, keyboard focus/context disposal, or game runtime. The isolated dev server has been stopped.
- Evidence: [native-animation-runtime-smoke.yaml](evidence/native-animation-runtime-smoke.yaml).

## DOC-115 — 2026-10-20 — native editor dirty guard single prompt

- Scope: finish isolated AC-06 dirty-state checks after DOC-114; no game, release, Site, commit or push.
- Smoke project: `52847307-1047-4edf-8b45-8d290ba8e705` at isolated `http://127.0.0.1:3120`, separate storage; fixture FBX SHA-256 `0c3fd77e693707a1f6c99da95070d482c568b3b91d1f9a060f3b5b53db77768d`.
- PASS: import/add Character; edit 132 keys; native Undo/Redo; preserve draft through Animation→Scene→Animation; close-project confirmation; browser reload `beforeunload`; save Motion/GLB; CPU↔GLB AnimationMixer quaternion parity at frames0/45/89 `1.0000000000000004/1/1`; WebGL playback changes viewport; clone isolation; placement Undo/Redo; reload/reopen native edit; iframe resize/pause/resume; browser errors0.
- Failure fixed: duplicate beforeunload prompts were emitted because both the host and native editor iframe installed a reload guard. Removed the host reload listener and retained the editor's existing guard; host close-project confirmation remains. The second isolated run passes without browser errors.
- Checks: Studio typecheck, lint/locale, smoke-script syntax and `git diff --check` PASS. AC acceptance remains1/9 (only AC-07); AC-05 fractional/loop/trim/root trajectory/IK/easing parity and AC-06 disconnect/conflict/recovery matrix plus dirty-draft restoration remain open.
- Limit: native iframe still authors its derivative GLB; no server rebake, Film Editor save/reopen, keyboard/context lifecycle audit or Minecraft game playback. Next dev environment cleanup/demo host restoration is tracked in the active turn, not product acceptance. Chromium emitted a Mediabunny duplicate-load advisory during development; the smoke's browser error list remained empty.
- Evidence: [native-animation-runtime-smoke.yaml](evidence/native-animation-runtime-smoke.yaml).

