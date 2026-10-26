# AAA runtime — V1 / B18 (2026-10-26)

**Game Forge + Connector: NOT_RUN.** Cloud only verified distribution metadata, jar contents and API signatures. No game instance/world/store was opened or changed. A usable Windows jar set is not yet certified.

## Evidence and preferred candidate

Official [AAA project metadata](https://api.modrinth.com/v2/project/aaa-particles) points to [ChloePrime/AAAParticles](https://github.com/ChloePrime/AAAParticles). [1.20.1 versions](https://api.modrinth.com/v2/project/aaa-particles/version?game_versions=%5B%221.20.1%22%5D) include **Forge 2.2.3** and Fabric 2.2.3. Both downloaded official jars contain `LICENSE_AAA Particles`: MIT, copyright 2024-present ChloePrime; permission includes modification/distribution with notice. [Upstream license](https://github.com/ChloePrime/AAAParticles/blob/master/LICENSE). This does not establish redistribution rights for every bundled/native component; this repository distributes no jars.

Forge jar `META-INF/mods.toml`: `aaa_particles` 2.2.3, Forge >=47.2.30, Minecraft [1.20.1,1.21). The user's 47.4.10 meets that declared range. JarJar metadata embeds **architectury-forge 9.2.14**, **mixinextras-forge 0.4.1**. No embedded Fabric config port. Therefore try the **official Forge AAA first**, in a backed-up isolated instance, with BBS Fabric/addon through Connector. Remove the standalone Fabric AAA/Architectury/config-port candidates from that test instance; do not load two copies of AAA. Keep the existing Connector-compatible Fabric API unchanged during this first comparison.

[Addon build](https://github.com/tuantranmarinainter-ops/BBS-AAAddon/blob/fs-2.7/build.gradle) compiles against AAA Fabric 2.2.3, Architectury Fabric 9.2.14 and config port 8.0.0. [Addon metadata](https://github.com/tuantranmarinainter-ops/BBS-AAAddon/blob/fs-2.7/src/main/resources/fabric.mod.json) declares `bbs-aaaddon`, Fabric Loader >=0.15.0, fabric-api, bbs and aaa_particles; it does **not** directly declare the config port. [ParticlePlayback](https://github.com/tuantranmarinainter-ops/BBS-AAAddon/blob/fs-2.7/src/client/java/diobede/bbsaaa/particles/ParticlePlayback.java) calls the common `mod.chloeprime.aaaparticles.api.client` API. Both official jars contain 17 classes under that API prefix. Java 17 `javap` confirms both expose `EffectDefinition.play(Type, Minecraft identifier)`, `setEffect`, and emitter pause/resume/progress/draw callbacks. Forge uses Mojmap ResourceLocation; Fabric uses intermediary Minecraft names. Connector must remap these descriptors and resolve the Forge mod identity, mixins, resource loader and native renderer correctly. Matching class/method names is **insufficient to claim binary/runtime compatibility**. Architectury Fabric is not a proven drop-in replacement for Forge Architectury; do not add both variants to fix an unmeasured error.

## Verified downloads

Hashes below were computed over actual downloaded bytes (SHA-256), not inferred from filenames. Download/content inspection PASS; every runtime result NOT_RUN.

| Jar | Version | SHA-256 | Official download |
|---|---|---|---|
| AAA Forge | 1.20.1-2.2.3 | `2d9e540e61feb5b7795c77014662f1556c73aee063391f1b0297ad60e62424fc` | [jar](https://cdn.modrinth.com/data/En8uHTOK/versions/9cBh3Vh8/aaa_particles-forge-1.20.1-2.2.3.jar) |
| AAA Fabric | 1.20.1-2.2.3 | `332c1237b555276aabdf3907379679ed978e7a4880b39ddbac997a33c58cde2f` | [jar](https://cdn.modrinth.com/data/En8uHTOK/versions/KPUjU5NL/aaa_particles-fabric-1.20.1-2.2.3.jar) |
| Fabric Loader | 0.16.14 | `9ed7b7f4197153ad97d71b4b9cd9148989e8f0c600934b035ce45f3ef003efc0` | [Maven jar](https://maven.fabricmc.net/net/fabricmc/fabric-loader/0.16.14/fabric-loader-0.16.14.jar) |
| Fabric API (pure Fabric) | 0.92.6+1.20.1 | `0ece50476da3692111ab04b75945c5458e70d98cd069eefc044ab3e57977deeb` | [jar](https://cdn.modrinth.com/data/P7dR8mSH/versions/UapVHwiP/fabric-api-0.92.6%2B1.20.1.jar) |
| BBS FS Fabric | 2.7-1.20.1 | `78ffc06eb3a546ef8616c23c1ae91615a120212a41b0e7384b17aa1b063168f8` | [CurseForge file 8934314](https://mediafilez.forgecdn.net/files/8934/314/bbs-2.7-1.20.1.jar), downloaded/hash verified by V2 |
| BBS-AAAddon fs-2.7 | Source branch; user's 2.0 jar unverified | **Unavailable — NOT_RUN** | [fork](https://github.com/tuantranmarinainter-ops/BBS-AAAddon/tree/fs-2.7); release API returned zero releases; build reviewed V2 branch and hash resulting local jar |

Machine-readable partial profile: `three-workspace-app/tools/aaa/runtime-profile.json`. It deliberately records the missing addon artifact. Loader Maven jar is a version/hash reference, not a complete launcher installation: use the [official Fabric installer](https://fabricmc.net/use/installer/) to create a separate Minecraft 1.20.1 / Loader 0.16.14 profile. Installer/bootstrap/library provisioning was NOT_RUN.

## Optional local Fabric patch

Official Fabric AAA bundles `META-INF/jars/architectury-fabric-9.2.14.jar` and `forgeconfigapiport-fabric-8.0.0.jar`, both listed in `fabric.mod.json.jars`. Its top-level depends has fabricloader, fabric, minecraft, java, **no** config-port dependency. Disabling a separate config port jar therefore cannot remove the embedded conflict recorded in B18.

`three-workspace-app/tools/aaa/patch_config_port.py` creates a separate local derivative, removes exactly that nested config jar/list entry and a matching direct dependency if present, preserving other payloads/licenses. The README has the exact command with verified source hash. Tests use synthetic temporary ZIPs only. The script does not install anything or distribute a modified binary. **Experimental NOT_RUN:** Forge's config package availability does not prove Fabric config registration/loader expectations will work; embedded Architectury Fabric may still fail through Connector. Prefer official Forge candidate first. Never use this derivative in pure Fabric.

## Pure Fabric fallback and Windows handoff

1. Ask the user before changing their game files; back up mods, config/bbs and world. Create a separate **pure Fabric** instance; no Forge or Connector and no Connector-specific Fabric API build.
2. Install Minecraft 1.20.1, Java 17 and Loader 0.16.14 through the official installer. Add the unmodified Fabric AAA, ordinary Fabric API and BBS jars in the table. AAA already bundles Fabric Architectury/config port; do not add duplicate standalone copies without a demonstrated reason.
3. Obtain/build the reviewed fs-2.7 addon (including V2 safety fix), record its exact commit and SHA-256 using `inspect_profile.py` or PowerShell `Get-FileHash -Algorithm SHA256`. **Until available this profile is incomplete; startup/film acceptance NOT_RUN.** Do not assume an old 2.0 filename is the reviewed build.
4. With Minecraft closed, copy the backed-up world from `saves/<world>` and the whole `config/bbs` tree to the new instance. Copy, never move; retain paths/resources. Do not open the original world in the experimental profile. Check other world mod dependencies before loading the copy.
5. On Windows first test official Forge candidate in a separate backed-up copy. Capture exact jar inventory/hashes, latest.log/crash report, resource reload, startup and world entry. If loader resolution fails, keep film export effects omitted and use pure Fabric fallback; do not “confirm compatible” in the app based on jar presence.
6. Follow [in-game checklist](AAA-INGAME-CHECKLIST.md) for laser/ribbon/ring, missing resource replay, seek/restart, editor selection, world exit and numeric FPS. Record each gate independently. No cloud test substitutes for those gates.

## Validation

Synthetic tools tests: **4 PASS** (3 patch + 1 inventory), covering payload/source preservation, exact metadata removal, hash/identity/signature/duplicate rejection, existing-output and in-place refusal. Builder build PASS; monorepo typecheck PASS; relevant Studio film/install tests PASS (2 files). The initial tsx CLI attempt failed before running tests because sandbox IPC listen returned EPERM; the Node `--import tsx --test` invocation completed successfully. Logs: `/tmp/v1-builder-build.log`, `/tmp/v1-typecheck.log`, `/tmp/v1-studio-tests-node.log`, `/tmp/v1-python-tests.log`. No binary, real game/store fixture, golden regeneration or BBS FS source change.

Official-download structural check: patched a disposable `/tmp` copy with the verified input hash. Output SHA-256 `f39b4211b78c8a7e0858821f3f7fe5e868d79da8d8014c1b4cc0395d35398b2f`. ZIP comparison: exactly **1 entry removed** (the nested config port), exactly **1 retained payload changed** (`fabric.mod.json`), all other payloads byte-identical, including Architectury and license. The nested original metadata confirms `forgeconfigapiport` version `8.0.0`. Structural gate PASS; runtime remains NOT_RUN. This derivative stays outside the repository and is not a published artifact.
