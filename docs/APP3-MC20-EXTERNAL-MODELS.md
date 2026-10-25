# External Minecraft20 bases (A9)

Emoticons model/license assets are never checked into this repository. Actual Emoticons/game/Windows acceptance is NOT_RUN in Linux cloud; synthetic tests do not establish visual or game compatibility.

Extract from a user supplied jar to a **new directory outside this repository**:

```powershell
python three-workspace-app/scripts/extract-emoticons-models.py --jar "S:\Minecraft\Minecraft Forge 1.12.2\mods\emoticons-1.1.2-1.12.2.jar" --out "S:\Claude\w01-samples\mc20-emoticons"
$env:W01_MC20_BASE_DIR = 'S:\Claude\w01-samples\mc20-emoticons'
```

From `three-workspace-app/editor/packages/builder`, first make a dereferenced physical library copy and inspect migration:

```powershell
node --import tsx ../retarget/cli/migrateMinecraft20Emoticons.ts --source-library '<original-library>' --copied-library '<new-test-copy>' --copy --dry-run
node --import tsx ../retarget/cli/migrateMinecraft20Emoticons.ts --source-library '<original-library>' --copied-library '<new-test-copy>'
```

Use `--base-dir` instead of the environment variable, and `--variant slim` (or another extracted basename) if appropriate. Both explicit library paths are mandatory; nested/identical roots, configured live W01_LIBRARY, and destination symlinks/junctions are rejected. `--copy` requires a new destination and copies linked file bytes rather than preserving links. Do not point runtime/project environment variables at production data during acceptance.

Every Minecraft20 character requires its own `characters/<id>/skin.png` with a 64×64 PNG IHDR. Import preflights the entire character set. It checks the exact twenty names, parent relations and rest matrices against the existing V9.12 action skeleton, plus a metre-scale mesh near floor zero. Incompatible variants stop with an error instead of silently rescaling or remapping existing actions. Native model bytes stay unchanged. Each character registers its own owner-specific base model ID and receives its own `textures/<object>/default.png` skin copies. Character IDs, action references, original files and prior base models stay in the copied library; no original external paths are added to metadata. This migration is explicit and does not change the older generic legacy migration command.

App3 detects the exact MC20 skeleton, exposes all twenty FK bone handles and four limb IK chains. Shin endpoints are editor-only Object3D nodes projected along the shin; they are not export bones or animation tracks. This preserves twenty-bone native exports and existing action channels. Hands use the existing `.end` bones. Leg IK changes thigh/shin rotations without adding a foot bone.

Portable verification:

```powershell
# From editor/packages/builder
node --import tsx ../retarget/test/migrateMinecraft20Emoticons.test.ts
# From animation-studio/work/material_alpha_v1_31_8
node --loader ./src/shot_test_loader.mjs src/minecraft20_controls.test.mjs
```

The raw App3 BOBJ loader currently rejects the native action library’s SINE interpolation; use the existing baked GLB action pipeline for those clips. A9 leaves that existing interpolation limitation unchanged. Tests evaluate all 85 native actions at three ticks against both original and migrated skeletons, check finite matrices and exact pose parity, and decode the generated skin/material and GLB texture references.

Setting W01_MC20_BASE_DIR enables optional real default-model validation. Before promoting a copy, separately verify Hero/Đen skins, all joints and arm/leg IK in App3, save/return through App2, and BBS FS 2.7 visibility/height beside the player. These real acceptance checks and real Samba are NOT_RUN here.
