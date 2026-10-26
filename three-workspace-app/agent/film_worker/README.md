# Offline BBS FS 2.4 Film worker

`python -m agent.unified_cli film export manifest.json --output-dir EXISTING_FOLDER` compiles this Java 17 worker in a temporary directory and writes a new package named by `filmName`. Set `BBS_JAVA_HOME` to a Java 17 JDK when Java is not on `PATH`.

The input is a local typed manifest with `schemaVersion: 1`, `targetVersion: "2.4"`, `projectId`, `sourceRevision`, `mode` (`playback` or `editable`), `filmName`, `durationTicks`, `models`, `actors`, and `cameras`. Model files are explicit `{sourcePath,targetPath,sha256}` entries. A model has a safe BBS resource `id`, its verified `bones`/`actions` profile and one `model.bobj`. Actors supply transform samples `{tick,x,y,z,pitch,yaw}`; optional `poseTracks` use `{boneName,keyframes:[{tick,t,s,r,r2,fix,color,lighting}]}` with BOBJ ZYX radians; optional `animationKeyframes` name an action from that model profile. Cameras supply `startTick`, `durationTicks`, and `{tick,x,y,z,pitch,yaw,roll,verticalFovDegrees}` samples.

The worker reuses the pinned BBS Animation Bridge 0.2.0 FilmEditor/BbsCodec, verifies every asset hash, writes the native compressed `.dat` under a fresh staging folder, reads it back through BbsCodec, then atomically renames the complete package. Existing destinations are rejected. It does not write into a game directory or contact the game.

The separate `python -m agent.unified_cli film convert-model SOURCE.fbx|SOURCE.glb --output-dir EXISTING_FOLDER [--unit-meters N]` command converts one rigged FBX or GLB into a fresh `model-<source-hash>` folder containing `model.bobj`, `profile.json`, and optionally `model.png`. FBX requires an explicit finite positive unit; GLB uses meters. It requires Blender 4.2+, accepts one armature with linked meshes, up to 512 bones, and at most one shared image texture (including embedded PNG/JPEG in GLB). Shape keys, vertex colors, multi-texture materials, and meshes not linked to the armature are rejected. Each profile bone includes its BOBJ bind/rest matrix as 16 finite row-major values copied from the exported `arm_bone` record; these are global BOBJ-space matrices, not baked animation tracks. The converter writes only within a temporary child of the existing output directory, validates hashes and profile, then renames the complete folder; it does not alter the source.

The Film exporter can consume these file paths through an explicit manifest, but project-to-manifest sampling, pose-delta baking from shared skeleton samples, project-bound jobs, browser UI, API/MCP tracking, game playback parity and Film Editor save/reopen acceptance are not implemented. Action names and bone names must come from the verified imported Skeleton Profile; worker validation does not replace runtime loading in BBS FS.

The bridge JAR and BbsCodec are pinned by SHA-256 in `agent/film_worker.py`. Their licenses, plus the reused DraftEditor source license and origin hash, are included under `vendor/` and `NOTICE.md`.


Height-calibrated actors may also supply `formScale` (positive uniform scale, at most 1000) and `formOffsetY`.
The worker writes BBS FS 2.7 `form.transform.s` and `form.transform.t` as float vectors and verifies them after native
read-back. Replay positions remain in world blocks; skeletal pose channels retain native model units. Canonical model
files remain unchanged and shared between differently sized actors. Fresh unified models use the BBS ModelConfig default
scale of one. Original BOBJ grounding uses `formOffsetY = -nativeFloor * formScale`; calibrated height is native mesh height
multiplied by `formScale`. The export report includes the transform read back from the native film, while game playback
acceptance remains NOT_RUN.

Wire evidence, pinned BBS FS 2.7 source:
- [`Transform.toData/fromData`](https://github.com/Wemppy4/bbs-fs/blob/998c9d585427b4cf0061940496ae1f6a7df1bb03/src/main/java/mchorse/bbs_mod/utils/pose/Transform.java#L485) stores `t` and `s`.
- [`ModelConfig.scale`](https://github.com/Wemppy4/bbs-fs/blob/998c9d585427b4cf0061940496ae1f6a7df1bb03/src/client/java/mchorse/bbs_mod/cubic/model/config/ModelConfig.java#L49) defaults to `(1,1,1)`.
- [`BOBJLoader`](https://github.com/Wemppy4/bbs-fs/blob/998c9d585427b4cf0061940496ae1f6a7df1bb03/src/main/java/mchorse/bbs_mod/bobj/BOBJLoader.java#L264) retains native vertex coordinates.
