# Native character host Save browser QA

Run from `three-workspace-app/editor` against an already built, running Studio using a copied real native library fixture and isolated project storage. Requires installed Playwright Chromium and the Hero, Den, GoXua owned draft actions. The script creates unique projects; it never starts a server, copies fixtures, resets data, or changes existing projects.

```powershell
$env:STUDIO_URL = 'http://127.0.0.1:3014'
$env:SMOKE_ISOLATED_STORAGE = '1'
# Optional: absolute evidence destination. Default: editor/work/qa/c2-native-browser.
$env:C2_EVIDENCE_DIR = (Join-Path (Get-Location) 'work/qa/c2-native-browser')
node apps/studio/scripts/c2-native-browser.mjs
```

`SMOKE_ISOLATED_STORAGE=1` asserts that the server already uses disposable library/project copies. Use the same loopback hostname throughout for session cookies and Origin validation.

The check places each actor through existing APIs, opens its complete MotionClip as a shot, compares library geometry and decoded texture pixels, and checks 20/20/84 joints through Blocking → Refine → Export. It edits and keys a bone in Refine, clicks the actual host Save, requires draft POST/GET 200, and records screenshots and `production-host-save.json`. Response-body reads have a 10-second limit; HTTP status is persisted before reading. Failures retain host status/alerts and iframe diagnostics.

Exit 0 requires all actors to pass. Outer React #418 is recorded separately as `hostErrors`; review it even if native checks pass. Evidence files and fixture data are local artifacts, never commit them. Multi-actor Return/playback and host layout are separate integration checks.

Validated against integrated production with the Lab export and durable Save receipt fixes: all three actors passed, with complete response bodies, Saved UI status, matching draft readback byte counts, and no native or outer errors. No golden files changed.
