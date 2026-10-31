# SPDX-License-Identifier: GPL-3.0-or-later
"""Lossless text-only encoding of our Chromium screenshots (requires Pillow).

Usage: python screenshot-to-svg.py <png-dir> <svg-dir>
No image data is embedded: RGB pixel runs become SVG paths.
"""
from collections import Counter, defaultdict
from pathlib import Path
import re
import sys
import xml.etree.ElementTree as ET

from PIL import Image, ImageChops, ImageDraw


def encode(source, destination):
    image = Image.open(source).convert("RGB")
    width, height = image.size
    pixels = image.load()
    background = Counter(image.getdata()).most_common(1)[0][0]
    active = {}
    groups = defaultdict(list)

    def finish(key, span):
        x, length, color = key
        y, rows = span
        groups[color].append(f"M{x} {y}h{length}v{rows}h-{length}z")

    for y in range(height):
        runs = {}
        x = 0
        while x < width:
            color = pixels[x, y]
            start = x
            x += 1
            while x < width and pixels[x, y] == color:
                x += 1
            if color != background:
                runs[(start, x - start, color)] = True
        for key, span in active.items():
            if key not in runs:
                finish(key, span)
        active = {
            key: (active[key][0], active[key][1] + 1) if key in active else (y, 1)
            for key in runs
        }
    for key, span in active.items():
        finish(key, span)

    def hex_color(color):
        return "#%02x%02x%02x" % color

    svg = (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" '
        f'viewBox="0 0 {width} {height}" shape-rendering="crispEdges">'
        f'<title>App 3 Chromium screenshot: {source.stem}</title>'
        f'<rect width="{width}" height="{height}" fill="{hex_color(background)}"/>'
    )
    svg += "".join(
        f'<path fill="{hex_color(color)}" d="{"".join(paths)}"/>'
        for color, paths in groups.items()
    ) + "</svg>\n"
    destination.write_text(svg, encoding="utf-8")

    # Independently decode the written text and compare every RGB pixel.
    restored = Image.new("RGB", (width, height))
    draw = ImageDraw.Draw(restored)
    for node in ET.parse(destination).getroot():
        if node.tag.endswith("rect"):
            draw.rectangle((0, 0, width - 1, height - 1), fill=node.attrib["fill"])
        elif node.tag.endswith("path"):
            for x, y, length, rows, _ in re.findall(
                r"M(\d+) (\d+)h(\d+)v(\d+)h-(\d+)z", node.attrib["d"]
            ):
                x, y, length, rows = map(int, (x, y, length, rows))
                draw.rectangle(
                    (x, y, x + length - 1, y + rows - 1), fill=node.attrib["fill"]
                )
    if ImageChops.difference(image, restored).getbbox() is not None:
        raise RuntimeError(f"Lossless round trip failed: {source}")
    print(f"PASS exact RGB: {destination.name} ({len(svg)} bytes)")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit(__doc__)
    source_dir, destination_dir = map(Path, sys.argv[1:])
    destination_dir.mkdir(parents=True, exist_ok=True)
    for name in (
        "classic-1920x1080", "modes-1920x1080", "classic-1024x768", "modes-1024x768"
    ):
        encode(source_dir / (name + ".png"), destination_dir / (name + ".svg"))
