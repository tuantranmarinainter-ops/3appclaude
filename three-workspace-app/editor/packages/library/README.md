# App 5 animation library core

This directory implements the local filesystem core for the shared animation library. The library data lives outside the repository. On Windows the default root is `C:\w01-library`; set `W01_LIBRARY` to override it. The current draft contract defines immutable content-addressed motion packs, editable action metadata, registered rigs, character records, and a regenerable `index.json`.

The public API is exported from `index.ts`. Library contract version 1.1 keeps reading 1.0 data and upgrades `library.json` on the first locked operation. Actions without `ownerCharId` or `status` remain raw library actions.

- `importPack({ sourceDirectory, license, ... })` imports a passing `normalize.ts` or `normalizeBatch.ts` output as one immutable pack. It verifies the GLB hash and report gate, derives the pack ID from the first 16 SHA-256 characters, preserves the App 1 manifest and report, and records each action UUID.
- `searchLibrary({ rig, category, tags, text, boundCharacter, ownerCharId, status, limit, offset })` rebuilds the search index from pack and character metadata.
- `getAction({ actionUuid })` returns metadata and local paths for the immutable GLB, manifest, and optional cover.
- `setActionMetadata(...)` edits tags/category/loop/parent UUID in `meta.json` without touching the GLB or App 1 manifest.
- `registerLibraryCharacter(...)` copies a GLB/BOBJ character into the external library with a non-committable default license.
- `callLibraryTool(...)` provides the `library.search`, `library.get`, and `library.characters` handlers for a local MCP transport.
- `addDraftToCharacter(...)` copies one raw action into a character-owned immutable version chain. Verity characters use their Mixamo65 view for compatibility checks.
- `saveCharacterActionVersion(...)` validates a single-animation GLB and appends an immutable `edited` version. `setCharacterActionStatus(...)`, `copyActionToCharacter(...)`, `listCharacterActions(...)`, and `removeCharacterAction(...)` manage approval, reuse, listing, and association without deleting stored files.
- `setCharacterProfile(...)` stores personality and required actions. Older characters receive the twelve standard requirements when read; `coverageMatrix(...)` reports the newest owned action tagged with each requirement key.

Character version ancestry uses two fields deliberately: `variantOf` always names version 1 of the chain, while `parentUuid` names the source action from which the chain was drafted or copied. Saving edited versions keeps that original `parentUuid`.

Example from the editor workspace, after the normal frozen install:

```ts
import { importPack, searchLibrary } from './packages/library/index.ts'

const pack = importPack({ sourceDirectory: 'C:/normalized/walk', license: { id: 'CC-BY-4.0', commitable: false } })
const results = searchLibrary({ rig: pack.rig, category: 'locomotion', tags: ['walk'] })
```

Run the package tests from `three-workspace-app/editor`:

```sh
pnpm --filter @topview/3d-builder exec tsx --test ../library/library.test.ts
pnpm --filter @topview/3d-builder exec tsx --test ../library/characters.test.ts ../library/characterActions.test.ts
pnpm --filter @topview/3d-builder exec tsc --noEmit --target ES2022 --module ESNext --moduleResolution Bundler --strict --skipLibCheck --allowImportingTsExtensions --types node --typeRoots node_modules/@types ../library/index.ts ../library/library.test.ts
```

`packages/library` was required to remain the only edited region, and manifests/lockfiles were excluded. As a result, workspace package registration, Studio browser UI, App 2/App 3 consumer wiring, and MCP transport registration still need a follow-up outside this directory. The API and MCP handler are ready for those integrations.
