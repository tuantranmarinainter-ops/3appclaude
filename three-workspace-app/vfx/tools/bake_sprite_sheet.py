"""Bake an Effekseer effect into a sprite sheet for the App 2 viewport preview (B9 / C3).

Renders frames with tools/render_preview.py (Effekseer Viewer.dll, hidden DirectX 11 window) on a black background,
then packs them into `sheet.png` + `sheet.json` ({frames, columns, rows, fps, sizeMeters, pivot, blend, loop}) as read
by `packages/builder/src/engine/objects/vfxSprites.ts`. Black background + additive blending reproduces the glow of
most effects; the camera looks straight at the effect origin, so the pivot is the image centre.

The viewer projection is a 60 degree perspective (measured: a 1-unit default sprite at distance 10 spans 46 of 512 px),
so a frame shows 2 * distance * tan(30 deg) Effekseer units, one unit per block in BBS FS 2.7 with the AAA addon
(checked 2026-10-23 on forcefieldtornado, Tap 15 shot 16: 70 px in game vs 72 px in App 2 at the same camera).
--game-scale stays available for effects measured otherwise.

Usage (Windows, EFFEKSEER_AI_BIN_DIR and DOTNET_ROOT set):
    python tools/bake_sprite_sheet.py <effect.efkefc> <out_dir> [--name aura01] [--distance 15] [--angle-x 10]
        [--max-seconds 3] [--fps 30] [--cell 192] [--columns 8] [--render-python <python with pythonnet>]
Packing needs Pillow; rendering needs pythonnet, so the renderer can run under a different interpreter.
"""

from __future__ import annotations

import argparse
import json
import math
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image

EFFEKSEER_FPS = 60
VIEW_FOV_DEGREES = 60.0


def lit_box(image: Image.Image, threshold: int = 6) -> tuple[int, int, int, int] | None:
    return image.convert("L").point(lambda value: 255 if value > threshold else 0).getbbox()


def render(python: str, effect: Path, frames: list[int], distance: float, angle_x: float, out: Path, size: int) -> list[Path]:
    tool = Path(__file__).with_name("render_preview.py")
    subprocess.run([python, str(tool), str(effect), str(out), "--frames", ",".join(map(str, frames)),
                    "--size", str(size), "--background", "0,0,0", "--distance", str(distance),
                    "--angle-x", str(angle_x), "--angle-y", "0"], check=True, stdout=subprocess.DEVNULL)
    return [out / f"t{frame:04d}.png" for frame in frames]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("effect")
    parser.add_argument("out_dir")
    parser.add_argument("--name")
    parser.add_argument("--distance", type=float, default=15.0)
    parser.add_argument("--angle-x", type=float, default=10.0)
    parser.add_argument("--max-seconds", type=float, default=3.0)
    parser.add_argument("--fps", type=int, default=30)
    parser.add_argument("--cell", type=int, default=192)
    parser.add_argument("--columns", type=int, default=8)
    parser.add_argument("--size", type=int, default=512)
    parser.add_argument("--render-python", default=sys.executable)
    parser.add_argument("--game-scale", type=float, default=1.0)
    args = parser.parse_args()
    if EFFEKSEER_FPS % args.fps:
        raise SystemExit("--fps must divide 60")

    effect = Path(args.effect).resolve()
    name = args.name or effect.stem.lower()
    out_dir = Path(args.out_dir).resolve() / name
    out_dir.mkdir(parents=True, exist_ok=True)
    step = EFFEKSEER_FPS // args.fps
    frames = list(range(0, int(args.max_seconds * EFFEKSEER_FPS) + 1, step))

    distance = args.distance
    with tempfile.TemporaryDirectory(dir=out_dir) as scratch:
        for _attempt in range(3):
            paths = render(args.render_python, effect, frames, distance, args.angle_x, Path(scratch), args.size)
            images = [Image.open(path).convert("RGB") for path in paths]
            boxes = [lit_box(image) for image in images]
            touching = any(box and (box[0] <= 1 or box[1] <= 1 or box[2] >= args.size - 1 or box[3] >= args.size - 1) for box in boxes)
            if not touching:
                break
            distance *= 1.6  # the effect leaves the frame: step back and render again
        lit = [index for index, box in enumerate(boxes) if box]
        if not lit:
            raise SystemExit(f"{name}: no visible pixels in {args.max_seconds} s")
        last = lit[-1]
        # Still visible at the last sampled frame: treat it as a looping effect and keep the full window.
        loop = last == len(images) - 1
        images = images[:last + 1]
        columns = min(args.columns, len(images))
        rows = math.ceil(len(images) / columns)
        sheet = Image.new("RGB", (columns * args.cell, rows * args.cell), (0, 0, 0))
        for index, image in enumerate(images):
            cell = image.resize((args.cell, args.cell), Image.LANCZOS)
            sheet.paste(cell, ((index % columns) * args.cell, (index // columns) * args.cell))
        sheet.save(out_dir / "sheet.png", optimize=True)

    meta = {
        "frames": len(images), "columns": columns, "rows": rows, "fps": args.fps,
        "sizeMeters": round(2 * distance * math.tan(math.radians(VIEW_FOV_DEGREES / 2)) * args.game_scale, 4),
        "gameScale": args.game_scale,
        "pivot": [0.5, 0.5], "blend": "add", "loop": loop,
        "source": effect.name, "camera": {"distance": distance, "angleX": args.angle_x},
    }
    (out_dir / "sheet.json").write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"effect": name, **meta}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
