# BBS Animation Workspace

Local desktop app for a shared Scene, Retarget and Animation project. The editor is copied from the pinned Topview 3D Builder v0.1.8 source (`631c08c8fd352b4ff83df33aa9a74a4563f4674b`); the original checkout under `.build-tools/` remains unchanged.

## Run locally

From `editor/`, run `pnpm install`, then `pnpm dev`. Studio binds to `127.0.0.1:3002`. Create a “Dự án hợp nhất” from the workbench; it opens the existing Topview Scene editor against a project manifest with revisioned saves. Project data is stored under `editor/apps/studio/unified-projects/` by default, or in `BBS_UNIFIED_PROJECTS_DIR` if set.

The Python client uses only the standard library:

```powershell
python agent/unified_cli.py --help
python agent/unified_cli.py inspect <project-id>
python agent/unified_cli.py import-topview project <cli-project-id>
python agent/unified_cli.py undo <project-id>
python agent/unified_cli.py request-result <request-id>
python -m agent.unified_cli film convert-model character.fbx --unit-meters 0.01 --output-dir converted
python -m agent.unified_cli film export manifest.json --output-dir exports
```

It talks to the local Studio broker; it does not write project files directly. On a timeout it retries the same request ID and checks for a committed result before retrying the command.

Run the offline CLI checks from this directory with `python -m unittest agent.test_unified_cli -v`.

## Current implementation boundary

Scene creation/edit/save, project manifest import/export, revision checks and shared undo/redo are wired. The Retarget and Animation workspace entries remain partial. The offline `film convert-model` CLI converts one rigged FBX/GLB to a BOBJ profile, and `film export` writes a native BBS FS 2.4 package from an explicit manifest and converted assets; neither command is connected to the shared project, Studio UI, broker or MCP. Importing a legacy Topview project creates a new manifest and leaves the source project untouched. Only scene-only unified manifests can currently be imported because project asset migration is not integrated.

Project schema, command contract, per-source inventory and status live in `../docs/three-workspace-app/`.
