# Issue #35 report — App 5 library core

## Work completed

- Added an external, configurable library root and filesystem-backed records for packs, rigs, characters, and the generated index.
- Added import of successful App 1 normalized outputs, with hash/gate verification, immutable content-addressed GLB packs, sidecar preservation, and action metadata.
- Added rig/category/tag/text search, action lookup, character registration/listing, metadata-only edits, and handlers/schemas for the three library MCP tools.
- Applied the user's app numbering: this is App 5 (Library); App 4 refers to VFX.
- Source contract read: `origin/ai1/j1-contract-v11:docs/LIBRARY-CONTRACT.md`, including temporary decisions in §8. The App-numbering table was not present in this checkout's `docs/DECISIONS.md`; the user's instruction controls.

## Changed files

- `three-workspace-app/editor/packages/library/README.md`
- `three-workspace-app/editor/packages/library/REPORT.md`
- `three-workspace-app/editor/packages/library/types.ts`
- `three-workspace-app/editor/packages/library/store.ts`
- `three-workspace-app/editor/packages/library/importPack.ts`
- `three-workspace-app/editor/packages/library/library.ts`
- `three-workspace-app/editor/packages/library/mcp.ts`
- `three-workspace-app/editor/packages/library/index.ts`
- `three-workspace-app/editor/packages/library/library.test.ts`

## Re-run commands and gates

- `pnpm --filter @topview/3d-builder exec tsx --test ../library/library.test.ts` — **PASS**, 4 passed, 0 failed, 0 skipped.
- `pnpm --filter @topview/3d-builder exec tsc --noEmit --target ES2022 --module ESNext --moduleResolution Bundler --strict --skipLibCheck --allowImportingTsExtensions --types node --typeRoots node_modules/@types ../library/index.ts ../library/library.test.ts` — **PASS**.
- `pnpm --filter @topview/3d-builder build` — **PASS**.
- `pnpm typecheck` — **PASS**, full workspace; ran after the Builder build.
- App 5 browser UI / Chromium — **NOT_RUN**; no browser UI is in this file scope. After UI integration, run Studio browser smoke on Windows/Chromium.
- Blender, Java, BBS FS, and VFX rendering — **NOT_RUN**; those tools are not required for this package core. Claude can validate VFX separately in App 4.

## Remaining scope blockers

- I2 core ingestion/search is implemented in this region.
- I3 browser UI, I4 App 2/App 3 wiring, and I5 registration with the MCP server are **BLOCKED** by the assigned file boundary; completing them requires edits outside `packages/library`. This PR provides the core APIs and MCP handlers only.
- No package manifest or lockfile was added, per scope constraints; the workspace does not yet resolve `packages/library` by package name.
