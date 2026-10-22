# Issue #35 report — App 5 Library

## Work completed

- I2 core remains in place: external library path, immutable normalized packs, metadata/index/search, character registration, and core library APIs.
- I3: added the `/library` Studio route with cover grid, rig/category/tag/text filters, GLB Action playback preview, and category/tag editing. Studio API routes read/search the library, update metadata, and serve the selected pack's cover and GLB with no-store/nosniff headers.
- I5: registered `library.search`, `library.get`, and `library.characters` as MCP tools in the unified MCP server; MCP reads the external `W01_LIBRARY` index and pack metadata. Added direct MCP tests.
- Applied the requested numbering: App 5 is Library and App 4 is VFX. Read `CLAUDE.md`, `docs/DECISIONS.md`, and `docs/LIBRARY-CONTRACT.md` from current main; §8 temporary decisions are approved.

## Changed files

- `three-workspace-app/editor/apps/studio/app/library/page.tsx`
- `three-workspace-app/editor/apps/studio/app/library/ActionPreview.tsx`
- `three-workspace-app/editor/apps/studio/app/api/library/route.ts`
- `three-workspace-app/editor/apps/studio/app/api/library/cover/[uuid]/route.ts`
- `three-workspace-app/editor/apps/studio/app/api/library/animation/[uuid]/route.ts`
- `three-workspace-app/agent/unified_mcp.py`
- `three-workspace-app/agent/test_unified_mcp.py`
- `three-workspace-app/editor/packages/library/*` (internal import suffixes changed to extensionless so Studio TypeScript can consume the package)

## Re-run commands and gates

- `pnpm --config.dangerouslyAllowAllBuilds=true --filter @topview/3d-builder build` — **PASS**.
- `pnpm --config.dangerouslyAllowAllBuilds=true typecheck` — **PASS**, all five workspace projects with typecheck scripts; run after Builder build completed.
- `pnpm --config.dangerouslyAllowAllBuilds=true --filter @topview/3d-studio build` — **PASS**, Next.js production build.
- `pnpm --config.dangerouslyAllowAllBuilds=true --filter @topview/3d-builder exec tsx --test ../library/library.test.ts` — **PASS**, 4 passed, 0 failed.
- `python -m unittest agent.test_unified_mcp` (from `three-workspace-app`) — **PASS**, 20 passed.
- Chromium UI smoke — **NOT_RUN**. On Windows: from `three-workspace-app/editor`, run `pnpm --filter @topview/3d-studio dev`, then open `http://127.0.0.1:3002/library` in Chromium and test filtering, GLB preview, and metadata save.
- Blender, Java, BBS FS — **NOT_RUN**; this work does not invoke them.

## Remaining blockers

- I4 App 2 drag-to-character is **BLOCKED** at the authorized boundary. App 2 has no public drop consumer that can convert a library Action into a broker-owned Motion; existing `motion.place` requires a Motion already present in the project. The missing library-to-Motion operation requires changes to the unified broker's `motion.place` asset resolution (`apps/studio/src/unifiedProjectStore.ts`) and builder character/timeline drop surface (`packages/builder`), outside the allowed files.
- I4 App 3 open-library-Action is **BLOCKED** at the authorized boundary. The existing App 3 bridge supports editing/importing its native project and shot artifacts; it has no command to load a library GLB Action into an Animation Studio session. That requires an Animation Studio host-bridge command and broker validation/dispatch changes (`animation-studio` and `apps/studio/src/app3Bridge.ts`), which are outside the allowed files.
- The `/library` route can be opened directly. Adding a link to the existing Studio navigation would require modifying an existing host component, outside the “new library UI/routes only” boundary.
- Chromium rendering and actual Windows behavior remain **NOT_RUN** pending Claude's Windows validation.
