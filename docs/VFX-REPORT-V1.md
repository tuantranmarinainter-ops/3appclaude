# V1 report — App 4 VFX trust core

## Work completed

- Image imports are stored under content SHA-256 filenames. `resources/manifest.json` records each source filename, digest, and relative resource path; manifest replacement is atomic. Different images with the same filename no longer overwrite each other.
- `settings_set` resolves and validates the complete batch before writing; if Core rejects a write, previously touched values are rolled back.
- `curve_set_keys` validates key data and builds replacement keys before removing current keys. If Core fails while adding a key, it restores the previous curve.
- `node_list` now returns stable `node/id/<uuid>` references alongside display paths. These references continue resolving after sibling deletion and moves between branches within the live session.
- Saving over an existing `.efkefc` creates a one-step `.efkefc.bak` backup. Added `edit_undo` to CLI and MCP; it restores and consumes that backup. Backup files are ignored by Git.
- Pinned the existing MCP SDK dependency below major version 2 because the server uses the v1 `FastMCP` API; the unconstrained resolver selected v2.3.0, which no longer provides `mcp.server.fastmcp`.
- MCP inventory check confirms all original 17 tool names remain and `edit_undo` adds the 18th.

## Changed files

- `three-workspace-app/vfx/.gitignore`
- `three-workspace-app/vfx/pyproject.toml`
- `three-workspace-app/vfx/README.md`
- `three-workspace-app/vfx/README.zh-CN.md`
- `three-workspace-app/vfx/docs/mcp.md`
- `three-workspace-app/vfx/src/effekseer_ai/session.py`
- `three-workspace-app/vfx/src/effekseer_ai/cli.py`
- `three-workspace-app/vfx/src/effekseer_ai/mcp_server.py`
- `three-workspace-app/vfx/tests/test_cli.py`
- `three-workspace-app/vfx/tests/test_session_safety.py`
- `docs/VFX-REPORT-V1.md`

## Rerun and measured results

From `three-workspace-app/vfx`:

```powershell
python -m pip install -e ".[dev]"
python -m pytest -q
python -m pytest -m integration -q
```

- `python -m pytest -q`: **PASS**, 12 passed, 1 skipped. The skipped test is the explicitly marked Effekseer Core integration roundtrip.
- Resource collision test: two different `spark.png` files produced two unique SHA-256 resource paths and two manifest records; both stored byte sequences matched their sources.
- Settings rollback test: injected failure on the second field restored both original values (`1`, `2`). Full batch validation test recorded zero writes when a later path was invalid.
- Curve tests: duplicate frame rejected before touching the current curve; injected Core failure during replacement restored the original key (1/1).
- Stable ID test: deleting a preceding sibling changed the display path while preserving ID resolution; moving a node to a different branch also preserved its ID.
- Backup test: previous document bytes were restored once, and a second undo was rejected because the one-step backup had been consumed.
- MCP inventory: all 17 pre-existing tool names plus `edit_undo` (18 total).
- `python -m compileall -q src tests` and `git diff --check`: **PASS**.

## Gates

| Gate | Status | Details |
| --- | --- | --- |
| Unit tests and portable package behavior | PASS | `python -m pytest -q`: 12 passed, 1 skipped. |
| Effekseer Core integration roundtrip | NOT_RUN | No Windows `EffekseerCore.dll` or configured `EFFEKSEER_AI_BIN_DIR` in this cloud environment. On Windows, set `DOTNET_ROOT` and `EFFEKSEER_AI_BIN_DIR` as in `docs/VFX-G0-REPORT.md`, then run `python -m pytest -m integration -q`. |
| BBS FS 2.7 runtime | NOT_RUN | V1 does not add BBS output; exported effect playback remains a separate later gate. |

No Effekseer DLL, `.efkefc` sample, texture, or other binary asset was committed.
