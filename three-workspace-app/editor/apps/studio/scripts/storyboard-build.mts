// B14 "Kịch bản → cảnh": build a new App 2 project from a storyboard.v1 JSON file (docs/STORYBOARD-FORMAT.md).
// Usage (from apps/studio): pnpm --filter @topview/3d-builder exec tsx <abs path>/scripts/storyboard-build.mts <storyboard.json>
// Set BBS_UNIFIED_PROJECTS_DIR to choose the projects folder. Relative paths in the file resolve against its folder.
import { readFileSync } from 'node:fs'
import path from 'node:path'
const file = process.argv[2]
if (!file) { console.error('usage: storyboard-build.mts <storyboard.json>'); process.exit(2) }
const { buildStoryboard, StoryboardError } = await import('../src/storyboard')
try {
  const result = await buildStoryboard(JSON.parse(readFileSync(file, 'utf8')), path.dirname(path.resolve(file)))
  console.log(JSON.stringify(result, null, 2))
} catch (error) {
  if (error instanceof StoryboardError) { console.error(JSON.stringify({ error: 'STORYBOARD_INVALID', issues: error.issues }, null, 2)); process.exit(1) }
  throw error
}
