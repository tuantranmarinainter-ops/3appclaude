#!/usr/bin/env node
// "Không bỏ chức năng": every element id of the baseline build must still exist in the candidate build, and every
// id the app code looks up with $('…') / getElementById('…') must exist in the candidate HTML.
// Usage: node tools/check-features.mjs <baseline.html> <candidate.html>
import { readFileSync } from 'node:fs'

const [baselinePath, candidatePath] = process.argv.slice(2)
if (!baselinePath || !candidatePath) { console.error('usage: check-features.mjs <baseline.html> <candidate.html>'); process.exit(2) }
const ids = (html) => new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]))
const lookups = (html) => new Set([...html.matchAll(/(?:\$|getElementById)\('([A-Za-z][\w-]*)'\)/g)].map((match) => match[1]))
const baseline = readFileSync(baselinePath, 'utf8'), candidate = readFileSync(candidatePath, 'utf8')
const baseIds = ids(baseline), candIds = ids(candidate), candLookups = lookups(candidate)
// Ids created at runtime by the code (not present in static HTML) are allowed; they are reported only if the baseline had them statically.
const missing = [...baseIds].filter((id) => !candIds.has(id)).sort()
const unresolved = [...candLookups].filter((id) => !candIds.has(id) && baseIds.has(id)).sort()
const report = { baselineIds: baseIds.size, candidateIds: candIds.size, missing, unresolvedLookups: unresolved }
console.log(JSON.stringify(report, null, 2))
process.exit(missing.length || unresolved.length ? 1 : 0)
