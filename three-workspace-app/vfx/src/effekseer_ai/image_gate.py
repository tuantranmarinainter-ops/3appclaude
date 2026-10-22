"""Fixed-frame metrics for the Effekseer-to-Snowstorm visual integration gate."""
from __future__ import annotations

import math
from pathlib import Path
from typing import Any



BACKGROUND = (20, 20, 24)


def image_metrics(path: str | Path, threshold: int = 8) -> dict[str, Any]:
    from .preview import _read_png
    width, height, pixels = _read_png(Path(path))
    points: list[tuple[int, int]] = []
    sums = [0, 0, 0]
    for y in range(height):
        for x in range(width):
            offset = (y * width + x) * 4
            rgb = pixels[offset:offset + 3]
            if any(abs(rgb[channel] - BACKGROUND[channel]) > threshold for channel in range(3)):
                points.append((x, y))
                for channel in range(3):
                    sums[channel] += rgb[channel]
    if not points:
        return {"brightPixels": 0, "bbox": None, "meanRGB": None}
    return {
        "brightPixels": len(points),
        "bbox": [min(x for x, _ in points), min(y for _, y in points),
                 max(x for x, _ in points), max(y for _, y in points)],
        "meanRGB": [round(value / len(points), 2) for value in sums],
    }


def compare_metrics(effekseer: dict[str, Any], converted: dict[str, Any]) -> dict[str, Any]:
    """Gate on footprint and hue. Brightness is reported only: Effekseer Add glows brighter than the flat
    alpha-blended simulation by design (option 2), so absolute RGB distance is not a fair gate."""
    a, b = effekseer["bbox"], converted["bbox"]
    if not a and not b:
        return {"status": "PASS", "bboxRatio": None, "meanColorDistance": None, "reason": "both renders empty at this time"}
    if not a or not b:
        return {"status": "FAIL", "bboxRatio": None, "meanColorDistance": None, "reason": "only one render is empty"}
    aw, ah = a[2] - a[0] + 1, a[3] - a[1] + 1
    bw, bh = b[2] - b[0] + 1, b[3] - b[1] + 1
    ratios = [bw / aw, bh / ah]
    color_distance = math.dist(effekseer["meanRGB"], converted["meanRGB"])
    chroma = lambda rgb: [channel / max(1e-9, sum(rgb)) for channel in rgb]  # noqa: E731
    hue_distance = math.dist(chroma(effekseer["meanRGB"]), chroma(converted["meanRGB"]))
    passed = 0.5 <= min(ratios) and max(ratios) <= 2.0 and hue_distance <= 0.06
    return {"status": "PASS" if passed else "FAIL",
            "bboxRatio": [round(value, 4) for value in ratios],
            "meanColorDistance": round(color_distance, 2), "hueDistance": round(hue_distance, 4)}
