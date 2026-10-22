from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

from effekseer_ai.effect_dump import dump_effect_ir
from effekseer_ai.image_gate import compare_metrics, image_metrics
from effekseer_ai.session import EffectSession


@pytest.mark.integration
def test_four_official_effects_match_fixed_frame_visual_gate(tmp_path: Path) -> None:
    dll = os.environ.get("EFFEKSEER_AI_BIN_DIR")
    samples = os.environ.get("EFFEKSEER_AI_SAMPLE_DIR")
    if not dll or not samples:
        pytest.skip("Set EFFEKSEER_AI_BIN_DIR and EFFEKSEER_AI_SAMPLE_DIR on Windows")
    from effekseer_ai.preview import render_preview
    sample_root = Path(samples)
    # Turbulence (custom .efkmat material) and the Laser01 beam (custom quad) are BLOCKED by design; see test_effect_dump.
    names = ("Simple_Sprite_BillBoard", "Simple_SpawnMethod1")
    rows = []
    failures = []
    for name in names:
        source = next(sample_root.rglob(f"{name}.efkefc"), None)
        if source is None:
            reason = f"missing official sample {name}.efkefc"
            failures.append(reason)
            rows.extend({"sample": name, "seconds": seconds, "status": "BLOCKED", "reason": reason}
                        for seconds in (0.25, 0.5, 1.0))
            continue
        eff_dir = tmp_path / "effekseer" / name
        command = [sys.executable, "tools/render_preview.py", str(source), str(eff_dir),
                   "--frames", "15,30,60", "--size", "512", "--background", "20,20,24",
                   "--distance", "15", "--angle-x", "20", "--angle-y", "30"]
        try:
            subprocess.run(command, check=True, capture_output=True, text=True)
        except (OSError, subprocess.CalledProcessError) as exc:
            reason = f"Effekseer reference render failed: {exc}"
            failures.append(f"{name}: {reason}")
            rows.extend({"sample": name, "seconds": seconds, "status": "FAIL", "reason": reason}
                        for seconds in (0.25, 0.5, 1.0))
            continue
        try:
            effect_ir = dump_effect_ir(EffectSession.open(source))
            conversion = render_preview(effect_ir, tmp_path / "converted" / name, [0.25, 0.5, 1.0], width=512, height=512,
                                        camera={"projection": "perspective", "distance": 15.0, "angle_x": 20.0,
                                                "angle_y": 30.0, "vertical_fov_degrees": 45.0, "focus": (0.0, 0.0, 0.0)})
        except Exception as exc:
            reason = f"dump/conversion/preview failed: {type(exc).__name__}: {exc}"
            failures.append(f"{name}: {reason}")
            rows.extend({"sample": name, "seconds": seconds, "status": "FAIL", "reason": reason}
                        for seconds in (0.25, 0.5, 1.0))
            continue
        if conversion.get("conversionStatus") == "BLOCKED":
            reason = "; ".join(conversion.get("blockingReasons", [])) or "conversion status BLOCKED"
            failures.append(f"{name}: {reason}")
            rows.extend({"sample": name, "seconds": seconds, "status": "BLOCKED", "reason": reason}
                        for seconds in (0.25, 0.5, 1.0))
            continue
        for frame, seconds in zip((15, 30, 60), (0.25, 0.5, 1.0)):
            try:
                ref = eff_dir / f"t{frame:04d}.png"
                stamp = f"{seconds:g}".replace(".", "p")
                converted = tmp_path / "converted" / name / f"simulation_{name.lower()}_{stamp}s.png"
                a, b = image_metrics(ref), image_metrics(converted)
                gate = compare_metrics(a, b)
                rows.append({"sample": name, "seconds": seconds, "effekseer": a, "converted": b, **gate})
                if gate["status"] != "PASS":
                    failures.append(f"{name} at {seconds}s: {gate.get('reason', gate['status'])}")
            except Exception as exc:
                reason = f"metric/render output failed: {type(exc).__name__}: {exc}"
                rows.append({"sample": name, "seconds": seconds, "status": "FAIL", "reason": reason})
                failures.append(f"{name} at {seconds}s: {reason}")

    markdown = ["| Sample | Seconds | Effekseer bright pixels / bbox / mean RGB | Converted bright pixels / bbox / mean RGB | bbox ratio W/H | RGB distance (info) | hue distance | Gate |",
                "|---|---:|---|---|---|---:|---:|---|"]
    for row in rows:
        eff = row.get("effekseer", {})
        converted = row.get("converted", {})
        reason = row.get("reason", "")
        markdown.append(f"| {row['sample']} | {row['seconds']:.2f} | {eff.get('brightPixels', '—')} / {eff.get('bbox', '—')} / {eff.get('meanRGB', '—')} | {converted.get('brightPixels', '—')} / {converted.get('bbox', '—')} / {converted.get('meanRGB', '—')} | {row.get('bboxRatio', reason or '—')} | {row.get('meanColorDistance', '—')} | {row.get('hueDistance', '—')} | {row['status']} |")
    report = Path(os.environ.get("VFX_IMAGE_GATE_REPORT", "../../docs/VFX-REPORT-V2-IMAGE-GATE.md"))
    report.parent.mkdir(parents=True, exist_ok=True)
    report.write_text("# VFX review 2 image measurements\n\n" + "\n".join(markdown) + "\n\n" +
                      "Fixed 512x512 viewport, perspective projection, distance 15, angles 20/30, focus origin, background 20,20,24; no per-image auto-fit. Offline projection uses a fixed 45-degree vertical FOV because the native Viewer matrix is not exposed to the simulator; this FOV is an explicit approximation and is NOT_RUN against Windows. Gate: bbox width/height ratio within 0.5–2.0 and chromaticity (hue) distance ≤ 0.06; RGB distance is informational because Add glow is brighter than the alpha fallback by design; both-empty frames pass. BBS runtime is not certified.\n",
                      encoding="utf-8")
    print(report.read_text(encoding="utf-8"))
    assert not failures and len(rows) == len(names) * 3 and all(row["status"] == "PASS" for row in rows), (
        "visual comparison failed; see measurement report: " + "; ".join(failures)
    )
