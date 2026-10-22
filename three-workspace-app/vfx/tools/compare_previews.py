"""Measure paired Effekseer and converted PNGs without rescaling either image.

Windows example:
  python tools/compare_previews.py --pair sample-025,effekseer/t0015.png,converted/t0.25.png
"""
from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

from render_preview import read_png_rgba


def metrics(path: Path, background: tuple[int, int, int], threshold: int = 8) -> dict:
    width, height, channels, pixels = read_png_rgba(path)
    points, sums = [], [0, 0, 0]
    for y in range(height):
        for x in range(width):
            i = (y * width + x) * channels
            rgb = pixels[i:i + 3]
            if any(abs(rgb[c] - background[c]) > threshold for c in range(3)):
                points.append((x, y))
                for c in range(3):
                    sums[c] += rgb[c]
    if not points:
        return {"brightPixels": 0, "bbox": None, "meanRGB": None}
    return {
        "brightPixels": len(points),
        "bbox": [min(p[0] for p in points), min(p[1] for p in points), max(p[0] for p in points), max(p[1] for p in points)],
        "meanRGB": [round(v / len(points), 2) for v in sums],
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--pair", action="append", required=True, help="label,effekseer.png,converted.png; repeat per sample/time")
    parser.add_argument("--background", default="20,20,24")
    parser.add_argument("--json", required=True)
    args = parser.parse_args()
    background = tuple(int(v) for v in args.background.split(","))
    rows = []
    for value in args.pair:
        label, source, converted = value.split(",", 2)
        a, b = metrics(Path(source), background), metrics(Path(converted), background)
        if a["bbox"] and b["bbox"]:
            aw, ah = a["bbox"][2] - a["bbox"][0] + 1, a["bbox"][3] - a["bbox"][1] + 1
            bw, bh = b["bbox"][2] - b["bbox"][0] + 1, b["bbox"][3] - b["bbox"][1] + 1
            color_delta = math.dist(a["meanRGB"], b["meanRGB"])
            passed = bw >= aw * .5 and bh >= ah * .5 and color_delta <= 40
        else:
            aw = ah = bw = bh = color_delta = None
            passed = False
        rows.append({"label": label, "effekseer": a, "converted": b,
                     "bboxRatio": [bw / aw, bh / ah] if aw and ah else None,
                     "meanColorDistance": round(color_delta, 2) if color_delta is not None else None,
                     "status": "PASS" if passed else "FAIL"})
    result = {"status": "PASS" if all(row["status"] == "PASS" for row in rows) else "FAIL",
              "cameraPolicy": "fixed viewport/world scale; images are not resized or auto-fit",
              "threshold": {"backgroundChannelDelta": 8, "minimumBboxRatio": .5, "maximumMeanRGBDistance": 40},
              "rows": rows}
    Path(args.json).write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result, indent=2))
    return 0 if result["status"] == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
