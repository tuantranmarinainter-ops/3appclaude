"""Offline, deterministic Snowstorm-subset preview renderer (not BBS runtime)."""

from __future__ import annotations

import argparse
import ast
import json
import math
import struct
import zlib
from pathlib import Path
from typing import Any

from .ir_to_bbs import BBS_BILLBOARD_SIDE, convert_effect_ir


DEFAULT_VIEWER_CAMERA = {"projection": "perspective", "distance": 15.0, "angle_x": 20.0, "angle_y": 30.0,
                         "vertical_fov_degrees": 45.0, "focus": (0.0, 0.0, 0.0)}


def render_preview(
    effect_ir: dict[str, Any], output_dir: str | Path, timestamps: list[float],
    reference_dir: str | Path | None = None, width: int = 256, height: int = 256,
    camera: dict[str, Any] | None = None,
) -> dict[str, Any]:
    if width < 16 or height < 16 or width > 2048 or height > 2048:
        raise ValueError("Preview dimensions must be between 16 and 2048 pixels")
    if not timestamps or any(isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value < 0 for value in timestamps):
        raise ValueError("timestamps must be a non-empty list of finite nonnegative seconds")
    conversion = convert_effect_ir(effect_ir)
    camera_settings = {**DEFAULT_VIEWER_CAMERA, **(camera or {})}
    _validate_camera(camera_settings)
    output = Path(output_dir)
    output.mkdir(parents=True, exist_ok=True)
    effect_name = _slug(str(effect_ir.get("name", "effect")))
    result = {
        "schemaVersion": 1,
        "effect": effect_ir.get("name"),
        "mode": "SIMULATION_ONLY",
        "actualBbsRuntime": "NOT_RUN",
        "warning": "Offline Snowstorm-subset simulation; this PNG is not an Effekseer render and does not certify BBS FS playback.",
        "camera": camera_settings,
        "simulationNotes": ["Random particle lifetime ranges are simulated using the quantized maximum endpoint; random sampling is not reproduced.", "Add mode renders the converted halo behind the core; source texture pixels are not sampled, so luminance detail is represented by the configured tint and layer coefficients.", "Molang size and parametric expressions use deterministic per-particle random variables.", "Camera position, perspective projection type, distance, angles, focus, viewport, and background match tools/render_preview.py defaults. The 45-degree vertical FOV approximates Effekseer Viewer projection; native matrix equivalence is NOT_RUN."],
        "conversionStatus": conversion["status"],
        "timestamps": [],
    }
    reference_root = Path(reference_dir) if reference_dir else None
    for timestamp in timestamps:
        seconds = float(timestamp)
        stamp = _stamp(seconds)
        sim_name = f"simulation_{effect_name}_{stamp}s.png"
        sim_path = output / sim_name
        if conversion["status"] == "BLOCKED":
            pixels = _blank(width, height)
        else:
            pixels = _render_schemes(conversion["schemes"], seconds, width, height, camera_settings)
        _write_png(sim_path, width, height, pixels)
        entry: dict[str, Any] = {
            "timeSeconds": seconds,
            "simulationPng": sim_name,
            "simulationLabel": "SIMULATION ONLY — NOT EFFEKSEER OR BBS FS RENDER",
            "conversionStatus": conversion["status"],
        }
        if reference_root is not None:
            reference = reference_root / f"{effect_name}_{stamp}s.png"
            if reference.is_file():
                ref_width, ref_height, ref_pixels = _read_png(reference)
                comparison_name = f"comparison_{effect_name}_{stamp}s.png"
                _write_comparison(output / comparison_name, pixels, width, height, ref_pixels, ref_width, ref_height)
                entry.update({
                    "referencePng": str(reference),
                    "referenceSource": "caller-supplied image; provenance is not verified",
                    "comparisonPng": comparison_name,
                    "comparisonLabel": "Left: simulation only. Right: caller-supplied reference image (provenance unverified); no pixel-equivalence claim.",
                })
            else:
                entry["effekseerReferenceStatus"] = "NOT_AVAILABLE"
        result["timestamps"].append(entry)
    manifest_path = output / "preview-report.json"
    manifest_path.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return result


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="effekseer-ai preview")
    parser.add_argument("effect_ir", help="EffectIR JSON input")
    parser.add_argument("output_dir", help="Directory for simulation PNGs and preview-report.json")
    parser.add_argument("--timestamps", default="0,0.25,0.5", help="Comma-separated timestamps in seconds")
    parser.add_argument("--reference-dir", help="Optional directory containing <effect>_<seconds>s.png Effekseer references")
    parser.add_argument("--width", type=int, default=256)
    parser.add_argument("--height", type=int, default=256)
    parser.add_argument("--distance", type=float, default=15.0)
    parser.add_argument("--angle-x", type=float, default=20.0)
    parser.add_argument("--angle-y", type=float, default=30.0)
    parser.add_argument("--vertical-fov", type=float, default=45.0, help="Projection approximation; Effekseer native matrix is not exposed to this simulator")
    args = parser.parse_args(argv)
    try:
        effect = json.loads(Path(args.effect_ir).read_text(encoding="utf-8"))
        timestamps = [float(part.strip()) for part in args.timestamps.split(",") if part.strip()]
        camera = {"distance": args.distance, "angle_x": args.angle_x, "angle_y": args.angle_y, "vertical_fov_degrees": args.vertical_fov}
        result = render_preview(effect, args.output_dir, timestamps, args.reference_dir, args.width, args.height, camera)
    except (OSError, json.JSONDecodeError, ValueError, zlib.error) as error:
        print(json.dumps({"status": "ERROR", "error": str(error)}, ensure_ascii=False))
        return 2
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


def _render_schemes(schemes: list[dict[str, Any]], time: float, width: int, height: int,
                    camera: dict[str, Any] | None = None) -> bytearray:
    camera_settings = {**DEFAULT_VIEWER_CAMERA, **(camera or {})}
    _validate_camera(camera_settings)
    canvas = _blank(width, height)
    for scheme in schemes:
        effect = scheme["json"]["particle_effect"]
        components = effect["components"]
        active_time = float(components.get("minecraft:emitter_lifetime_once", {}).get("active_time", math.inf))
        life = _max_lifetime(components["minecraft:particle_lifetime_expression"]["max_lifetime"])
        instant = components.get("minecraft:emitter_rate_instant", {}).get("num_particles")
        rate = components.get("minecraft:emitter_rate_steady", {}).get("spawn_rate", 1)
        cap = components.get("minecraft:emitter_rate_steady", {}).get("max_particles", instant if instant is not None else 32)
        cap = min(int(cap), 256)
        shape_key = next((key for key in components if key.startswith("minecraft:emitter_shape_")), None)
        shape = components.get(shape_key, {}) if shape_key else {}
        origin = shape.get("offset", [0, 0, 0])
        direction = shape.get("direction", [0, 1, 0])
        acceleration = components.get("minecraft:particle_motion_dynamic", {}).get("linear_acceleration", [0, 0, 0])
        speed = _eval_molang(components.get("minecraft:particle_initial_speed", 0), 0, life, _random_values(0))
        tint = components.get("minecraft:particle_appearance_tinting", {}).get("color", "#ffffff")
        size = components.get("minecraft:particle_appearance_billboard", {}).get("size", [1, 1])
        add_layer = scheme.get("addBlend", {}).get("layer")
        spawns = _spawn_times(time, float(rate), cap, active_time, int(instant) if instant is not None else None)
        for index, spawn in enumerate(spawns):
            age = time - spawn
            if spawn > active_time or age < 0 or age > life:
                continue
            randoms = _random_values(index)
            particle_color = _tint_color(tint, age, life, randoms)
            if add_layer == "halo" and not isinstance(tint, list):
                particle_color = (*particle_color[:3], round(particle_color[3] * float(scheme["addBlend"]["options"]["haloAlpha"])))
            elif add_layer == "core":
                exponent = float(scheme["addBlend"]["options"]["coreExponent"])
                mix = 0.5 ** exponent
                particle_color = tuple(round(channel * (1 - mix) + 255 * mix) for channel in particle_color[:3]) + (particle_color[3],)
            evaluated_size = [_eval_molang(value, age, life, randoms) for value in size]
            angle = (index * 2.399963229728653) % (math.tau)
            shape_radius = float(shape.get("radius", 0))
            x = _eval_molang(origin[0], age, life, randoms) + math.cos(angle) * shape_radius + float(direction[0]) * speed * age + float(acceleration[0]) * age * age / 2
            y = _eval_molang(origin[1], age, life, randoms) + math.sin(angle) * shape_radius + float(direction[1]) * speed * age + float(acceleration[1]) * age * age / 2
            parametric = components.get("minecraft:particle_motion_parametric", {}).get("relative_position", {})
            if parametric:
                x += _eval_molang(parametric.get("x", 0), age, life, randoms)
                y += _eval_molang(parametric.get("y", 0), age, life, randoms)
            projected = project_camera((x, y, _eval_molang(origin[2], age, life, randoms)), width, height, camera_settings)
            if projected is None:
                continue
            px, py = map(round, projected)
            depth = _camera_depth((x, y, _eval_molang(origin[2], age, life, randoms)), camera_settings)
            focal = height / (2 * math.tan(math.radians(float(camera_settings["vertical_fov_degrees"])) / 2))
            rx = max(1, min(120, round(abs(evaluated_size[0]) * BBS_BILLBOARD_SIDE * focal / depth / 2)))
            ry = max(1, min(120, round(abs(evaluated_size[1] if len(evaluated_size) > 1 else evaluated_size[0]) * BBS_BILLBOARD_SIDE * focal / depth / 2)))
            spin = components.get("minecraft:particle_initial_spin", {})
            rotation = _eval_molang(spin.get("rotation", 0), age, life, randoms) + _eval_molang(spin.get("rotation_rate", 0), age, life, randoms) * age
            fade = max(0.15, 1 - age / max(life, 1e-9))
            _ellipse(canvas, width, height, px, py, rx, ry, math.radians(rotation), tuple(int(channel * fade) for channel in particle_color))
    return canvas


def _spawn_times(time: float, rate: float, cap: int, active_time: float, instant_count: int | None = None) -> list[float]:
    if instant_count is not None:
        return [0.0] * min(cap, instant_count) if time >= 0 and active_time >= 0 else []
    if rate <= 0 or time < 0:
        return []
    last_index = min(cap - 1, int(math.floor(min(time, active_time) * rate)))
    return [index / rate for index in range(max(0, last_index + 1))]


def _validate_camera(camera: dict[str, Any]) -> None:
    for key in ("distance", "vertical_fov_degrees"):
        value = camera[key]
        if not isinstance(value, (int, float)) or not math.isfinite(value) or value <= 0:
            raise ValueError(f"camera {key} must be a positive finite number")
    if camera["vertical_fov_degrees"] >= 179:
        raise ValueError("camera vertical_fov_degrees must be below 179")


def project_camera(point: tuple[float, float, float], width: int, height: int,
                   camera: dict[str, Any] | None = None) -> tuple[float, float] | None:
    """Project one world point using the fixed perspective camera used by the preview gate."""
    settings = {**DEFAULT_VIEWER_CAMERA, **(camera or {})}
    _validate_camera(settings)
    ax, ay = math.radians(float(settings["angle_x"])), math.radians(float(settings["angle_y"]))
    cx, cy, cz = settings["focus"]
    dx, dy, dz = point[0] - cx, point[1] - cy, point[2] - cz
    right = (math.cos(ay), 0.0, -math.sin(ay))
    up = (math.sin(ax) * math.sin(ay), math.cos(ax), math.sin(ax) * math.cos(ay))
    forward = (-math.cos(ax) * math.sin(ay), math.sin(ax), -math.cos(ax) * math.cos(ay))
    eye_depth = float(settings["distance"]) - (dx * forward[0] + dy * forward[1] + dz * forward[2])
    if eye_depth <= 1e-6:
        return None
    focal = height / (2 * math.tan(math.radians(float(settings["vertical_fov_degrees"])) / 2))
    sx = dx * right[0] + dy * right[1] + dz * right[2]
    sy = dx * up[0] + dy * up[1] + dz * up[2]
    return width / 2 + focal * sx / eye_depth, height / 2 - focal * sy / eye_depth


def _camera_depth(point: tuple[float, float, float], camera: dict[str, Any]) -> float:
    ax, ay = math.radians(float(camera["angle_x"])), math.radians(float(camera["angle_y"]))
    forward = (-math.cos(ax) * math.sin(ay), math.sin(ax), -math.cos(ax) * math.cos(ay))
    dx, dy, dz = (point[i] - camera["focus"][i] for i in range(3))
    return max(1e-6, float(camera["distance"]) - (dx * forward[0] + dy * forward[1] + dz * forward[2]))


def _blank(width: int, height: int) -> bytearray:
    return bytearray([20, 20, 24, 255] * width * height)


def _disc(pixels: bytearray, width: int, height: int, cx: int, cy: int, radius: int, color: tuple[int, int, int, int]) -> None:
    for y in range(max(0, cy - radius), min(height, cy + radius + 1)):
        for x in range(max(0, cx - radius), min(width, cx + radius + 1)):
            if (x - cx) ** 2 + (y - cy) ** 2 > radius ** 2:
                continue
            index = (y * width + x) * 4
            alpha = color[3] / 255
            for channel in range(3):
                pixels[index + channel] = round(color[channel] * alpha + pixels[index + channel] * (1 - alpha))
            pixels[index + 3] = 255


def _ellipse(pixels: bytearray, width: int, height: int, cx: int, cy: int, rx: int, ry: int,
             angle: float, color: tuple[int, int, int, int]) -> None:
    cos_a, sin_a = math.cos(angle), math.sin(angle)
    extent_x = min(256, math.ceil(math.sqrt((rx * cos_a) ** 2 + (ry * sin_a) ** 2)))
    extent_y = min(256, math.ceil(math.sqrt((rx * sin_a) ** 2 + (ry * cos_a) ** 2)))
    alpha = color[3] / 255
    for y in range(max(0, cy - extent_y), min(height, cy + extent_y + 1)):
        for x in range(max(0, cx - extent_x), min(width, cx + extent_x + 1)):
            dx, dy = x - cx, y - cy
            u, v = dx * cos_a + dy * sin_a, -dx * sin_a + dy * cos_a
            if (u / rx) ** 2 + (v / ry) ** 2 > 1:
                continue
            offset = (y * width + x) * 4
            for channel in range(3):
                pixels[offset + channel] = round(color[channel] * alpha + pixels[offset + channel] * (1 - alpha))
            pixels[offset + 3] = 255


def _write_png(path: Path, width: int, height: int, pixels: bytearray) -> None:
    raw = b"".join(b"\x00" + pixels[y * width * 4:(y + 1) * width * 4] for y in range(height))
    _png_bytes(path, width, height, zlib.compress(raw, 9))


def _png_bytes(path: Path, width: int, height: int, compressed: bytes) -> None:
    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xffffffff)
    data = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)) + chunk(b"IDAT", compressed) + chunk(b"IEND", b"")
    path.write_bytes(data)


def _read_png(path: Path) -> tuple[int, int, bytearray]:
    data = path.read_bytes()
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError(f"Reference is not a PNG: {path}")
    pos, width, height, color_type, compressed = 8, 0, 0, 0, bytearray()
    while pos < len(data):
        length = struct.unpack(">I", data[pos:pos + 4])[0]
        kind = data[pos + 4:pos + 8]
        payload = data[pos + 8:pos + 8 + length]
        pos += 12 + length
        if kind == b"IHDR":
            width, height, depth, color_type, compression, filtering, interlace = struct.unpack(">IIBBBBB", payload)
            if depth != 8 or color_type not in {2, 6} or compression or filtering or interlace:
                raise ValueError("Reference PNG must be non-interlaced 8-bit RGB/RGBA")
        elif kind == b"IDAT":
            compressed.extend(payload)
        elif kind == b"IEND":
            break
    channels = 4 if color_type == 6 else 3
    stride = width * channels
    raw = zlib.decompress(compressed)
    rows: list[bytearray] = []
    previous = bytearray(stride)
    offset = 0
    for _ in range(height):
        filter_type = raw[offset]
        scan = bytearray(raw[offset + 1:offset + 1 + stride])
        offset += stride + 1
        for i in range(stride):
            left = scan[i - channels] if i >= channels else 0
            up = previous[i]
            upper_left = previous[i - channels] if i >= channels else 0
            if filter_type == 1:
                scan[i] = (scan[i] + left) & 255
            elif filter_type == 2:
                scan[i] = (scan[i] + up) & 255
            elif filter_type == 3:
                scan[i] = (scan[i] + ((left + up) // 2)) & 255
            elif filter_type == 4:
                scan[i] = (scan[i] + _paeth(left, up, upper_left)) & 255
            elif filter_type != 0:
                raise ValueError(f"Unsupported PNG row filter: {filter_type}")
        rgba = bytearray(width * 4)
        for x in range(width):
            source = x * channels
            target = x * 4
            rgba[target:target + 3] = scan[source:source + 3]
            rgba[target + 3] = scan[source + 3] if channels == 4 else 255
        rows.append(rgba)
        previous = scan
    return width, height, bytearray().join(rows)


def _write_comparison(path: Path, left: bytearray, lw: int, lh: int, right: bytearray, rw: int, rh: int) -> None:
    height = max(lh, rh)
    width = lw + rw
    canvas = _blank(width, height)
    _blit(canvas, width, height, left, lw, lh, 0, (height - lh) // 2)
    _blit(canvas, width, height, right, rw, rh, lw, (height - rh) // 2)
    _write_png(path, width, height, canvas)


def _blit(target: bytearray, tw: int, th: int, source: bytearray, sw: int, sh: int, x0: int, y0: int) -> None:
    for y in range(sh):
        if y + y0 >= th:
            break
        start = y * sw * 4
        end = start + sw * 4
        dest = ((y + y0) * tw + x0) * 4
        target[dest:dest + sw * 4] = source[start:end]


def _paeth(left: int, up: int, upper_left: int) -> int:
    estimate = left + up - upper_left
    distances = (abs(estimate - left), abs(estimate - up), abs(estimate - upper_left))
    return (left, up, upper_left)[distances.index(min(distances))]


def _parse_color(value: str) -> tuple[int, int, int, int]:
    value = value.lstrip("#")
    if len(value) != 6:
        return 255, 255, 255, 255
    return int(value[0:2], 16), int(value[2:4], 16), int(value[4:6], 16), 255


def _random_values(index: int) -> dict[str, float]:
    return {f"variable.particle_random_{i}": (index * (0.61803398875 + i * 0.17320508075) + i * 0.31415926535) % 1 for i in range(1, 5)}


def _eval_molang(value: Any, age: float, life: float, randoms: dict[str, float]) -> float:
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return float(value)
    if not isinstance(value, str):
        raise ValueError(f"Unsupported Molang value: {value!r}")
    tree = ast.parse(value, mode="eval")

    def visit(node: ast.AST) -> float:
        if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)):
            return float(node.value)
        if isinstance(node, ast.Name) and node.id == "variable":
            return 0
        if isinstance(node, ast.Attribute):
            name = _attribute_name(node)
            if name == "variable.particle_age": return age
            if name == "variable.particle_lifetime": return life
            if name in randoms: return randoms[name]
            raise ValueError(f"Unsupported Molang variable: {name}")
        if isinstance(node, ast.BinOp):
            a, b = visit(node.left), visit(node.right)
            if isinstance(node.op, ast.Add): return a + b
            if isinstance(node.op, ast.Sub): return a - b
            if isinstance(node.op, ast.Mult): return a * b
            if isinstance(node.op, ast.Div): return a / b if b else 0
            if isinstance(node.op, ast.Pow): return a ** b
        if isinstance(node, ast.UnaryOp):
            return -visit(node.operand) if isinstance(node.op, ast.USub) else visit(node.operand)
        if isinstance(node, ast.Call):
            name = _attribute_name(node.func)
            args = [visit(arg) for arg in node.args]
            if name == "math.lerp" and len(args) == 3: return args[0] + (args[1] - args[0]) * args[2]
            if name == "math.clamp" and len(args) == 3: return min(max(args[0], args[1]), args[2])
        raise ValueError(f"Unsupported Molang expression: {value}")

    return visit(tree.body)


def _attribute_name(node: ast.AST) -> str:
    return _attribute_name(node.value) + "." + node.attr if isinstance(node, ast.Attribute) else node.id if isinstance(node, ast.Name) else ""


def _tint_color(value: Any, age: float, life: float, randoms: dict[str, float]) -> tuple[int, int, int, int]:
    if isinstance(value, list) and len(value) in {3, 4}:
        channels = [_eval_molang(channel, age, life, randoms) for channel in value]
        if max(channels, default=0) <= 1:
            channels = [channel * 255 for channel in channels]
        if len(channels) == 3:
            channels.append(255)
        return tuple(max(0, min(255, round(channel))) for channel in channels)  # type: ignore[return-value]
    if isinstance(value, dict) and isinstance(value.get("gradient"), dict):
        gradient = value["gradient"]
        points = sorted((float(key), _parse_color(color)) for key, color in gradient.items())
        t = _eval_molang(value.get("interpolant", 0), age, life, randoms)
        if len(points) >= 2:
            (a, ca), (b, cb) = points[0], points[-1]
            factor = min(1, max(0, (t - a) / (b - a))) if b > a else 0
            return tuple(round(x + (y - x) * factor) for x, y in zip(ca, cb))
    return _parse_color(value) if isinstance(value, str) else (255, 255, 255, 255)


def _max_lifetime(value: Any) -> float:
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return float(value)
    if isinstance(value, str) and value.startswith("math.random(") and value.endswith(")"):
        endpoints = value[len("math.random("):-1].split(",")
        if len(endpoints) == 2:
            return max(float(endpoint.strip()) for endpoint in endpoints)
    raise ValueError(f"Unsupported Snowstorm lifetime expression for preview: {value}")


def _slug(value: str) -> str:
    slug = "".join(character.lower() if character.isalnum() else "_" for character in value).strip("_")
    return slug or "effect"


def _stamp(value: float) -> str:
    return f"{value:g}".replace(".", "p")


if __name__ == "__main__":
    raise SystemExit(main())
