# VFX review 2 image measurements

| Sample | Seconds | Effekseer bright pixels / bbox / mean RGB | Converted bright pixels / bbox / mean RGB | bbox ratio W/H | RGB distance (info) | hue distance | Gate |
|---|---:|---|---|---|---:|---:|---|
| Simple_Sprite_BillBoard | 0.25 | 77685 / [86, 122, 481, 426] / [164.65, 148.33, 152.3] | 98422 / [75, 72, 414, 429] / [125.28, 116.18, 118.15] | [0.8586, 1.1738] | 61.24 | 0.0071 | PASS |
| Simple_Sprite_BillBoard | 0.50 | 136556 / [46, 72, 501, 480] / [99.81, 66.24, 72.13] | 131474 / [41, 39, 451, 466] / [45.41, 36.43, 39.3] | [0.9013, 1.0465] | 70.18 | 0.0541 | PASS |
| Simple_Sprite_BillBoard | 1.00 | 0 / None / None | 0 / None / None | None | None | — | PASS |
| Simple_SpawnMethod1 | 0.25 | 0 / None / None | 0 / None / None | None | None | — | PASS |
| Simple_SpawnMethod1 | 0.50 | 0 / None / None | 0 / None / None | None | None | — | PASS |
| Simple_SpawnMethod1 | 1.00 | 0 / None / None | 0 / None / None | None | None | — | PASS |

Fixed 512x512 viewport, perspective projection, distance 15, angles 20/30, focus origin, background 20,20,24; no per-image auto-fit. Offline projection uses a fixed 45-degree vertical FOV because the native Viewer matrix is not exposed to the simulator; this FOV is an explicit approximation and is NOT_RUN against Windows. Gate: bbox width/height ratio within 0.5–2.0 and chromaticity (hue) distance ≤ 0.06; RGB distance is informational because Add glow is brighter than the alpha fallback by design; both-empty frames pass. BBS runtime is not certified.

## Review on the Windows machine (Claude, 2026-10-22)
- Dump rewritten against real Effekseer 1.80.6 Core paths (snapshots in `three-workspace-app/vfx/tests/fixtures/core-paths/`).
- Official `Sample/00_Basic`: Simple_Sprite_BillBoard, Simple_SpawnMethod1 convert (PASS); Laser01 converts 4/5 nodes, the beam node is
  BLOCKED (custom sprite corners: off-centre pivot); Simple_Turbulence_Particles BLOCKED (custom `.efkmat` material); Ribbon_Sword,
  Ring_Shape1, Distortion BLOCKED for ribbon / ring / BackDistortion.
- `bbs-package` on Simple_Sprite_BillBoard: 2 schemes (core + halo, option 2), 2 generated textures with luminance alpha
  (corner alpha 0, centre white 255), CREDITS (CC0 Effekseer sample), manifest, report.
- BBS billboard side is `size * 2.25` (BBS FS 2.7 `ParticleComponentAppearanceBillboard`); the converter divides by 2.25.
- Limits: Simple_SpawnMethod1 is empty in both renders at 0.25/0.5/1 s, so the gate does not exercise it; the simulator fills
  quads with a flat tint (no texture sampling); **BBS FS in-game playback is NOT_RUN** (needs the user's game).
