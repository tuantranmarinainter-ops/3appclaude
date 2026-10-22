"""G0: render real preview frames of an Effekseer effect without the editor GUI.

Path: EffekseerCore exports the document to `.efk` bytes -> Effekseer editor's native viewer
(`Viewer.dll`, reached through the `Effekseer.swig` bindings in `EffekseerCoreGUI.dll`) loads them ->
`EffectRecorder` in Sprite mode writes one PNG per sampled frame. The DirectX 11 device is created on
a hidden Win32 window; nothing is shown on screen.

Usage (Windows, EFFEKSEER_AI_BIN_DIR set):
    python tools/render_preview.py <effect.efkefc> <out_dir> [--frames 0,15,30,60,120]
        [--size 512] [--background 20,20,24] [--distance 15] [--angle-x 20] [--angle-y 30]

Prints a JSON report (one entry per frame: file, bytes, sha256, non-background pixel count).
"""

from __future__ import annotations

import argparse
import ctypes
import hashlib
import json
import os
import struct
import sys
import tempfile
import zlib
from ctypes import wintypes
from pathlib import Path

from effekseer_ai.runtime import editor_bin_directory, load_core


def hidden_window(width: int, height: int) -> int:
    user32 = ctypes.WinDLL("user32", use_last_error=True)
    user32.CreateWindowExW.restype = wintypes.HWND
    user32.CreateWindowExW.argtypes = [
        wintypes.DWORD, wintypes.LPCWSTR, wintypes.LPCWSTR, wintypes.DWORD,
        ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int,
        wintypes.HWND, wintypes.HMENU, wintypes.HINSTANCE, wintypes.LPVOID,
    ]
    # WS_POPUP, never shown.
    hwnd = user32.CreateWindowExW(0, "STATIC", "effekseer-ai-preview", 0x80000000,
                                  0, 0, width, height, None, None, None, None)
    if not hwnd:
        raise OSError(ctypes.get_last_error(), "CreateWindowExW failed")
    return hwnd


def read_png_rgba(path: Path) -> tuple[int, int, int, bytes]:
    """Decode an 8-bit RGB/RGBA non-interlaced PNG; returns (width, height, channels, pixels)."""
    data = path.read_bytes()
    pos, idat = 8, b""
    while pos < len(data):
        length, kind = struct.unpack(">I4s", data[pos:pos + 8])
        body = data[pos + 8:pos + 8 + length]
        if kind == b"IHDR":
            width, height, depth, color = struct.unpack(">IIBB", body[:10])
            if depth != 8 or color not in (2, 6):
                raise ValueError(f"Unsupported PNG format: depth={depth} color={color}")
            channels = 4 if color == 6 else 3
        elif kind == b"IDAT":
            idat += body
        pos += 12 + length
    raw, stride = zlib.decompress(idat), width * channels
    out, prev = bytearray(), bytearray(stride)
    for row in range(height):
        start = row * (stride + 1)
        kind, line = raw[start], bytearray(raw[start + 1:start + 1 + stride])
        for i in range(stride):
            a = line[i - channels] if i >= channels else 0
            b, c = prev[i], prev[i - channels] if i >= channels else 0
            if kind == 1:
                line[i] = (line[i] + a) & 0xFF
            elif kind == 2:
                line[i] = (line[i] + b) & 0xFF
            elif kind == 3:
                line[i] = (line[i] + (a + b) // 2) & 0xFF
            elif kind == 4:
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                line[i] = (line[i] + (a if pa <= pb and pa <= pc else b if pb <= pc else c)) & 0xFF
        out += line
        prev = line
    return width, height, channels, bytes(out)


def lit_pixels(path: Path, background: tuple[int, int, int], tolerance: int = 8) -> int:
    width, height, channels, pixels = read_png_rgba(path)
    count = 0
    for i in range(0, width * height * channels, channels):
        if any(abs(pixels[i + k] - background[k]) > tolerance for k in range(3)):
            count += 1
    return count


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("effect")
    parser.add_argument("out_dir")
    parser.add_argument("--frames", default="0,15,30,60,120")
    parser.add_argument("--size", type=int, default=512)
    parser.add_argument("--background", default="20,20,24")
    parser.add_argument("--distance", type=float, default=15.0)
    parser.add_argument("--angle-x", type=float, default=20.0)
    parser.add_argument("--angle-y", type=float, default=30.0)
    args = parser.parse_args()

    frames = sorted({int(f) for f in args.frames.split(",")})
    background = tuple(int(c) for c in args.background.split(","))
    effect_path = Path(args.effect).resolve()
    out_dir = Path(args.out_dir).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    core = load_core()
    if not core.LoadFrom(str(effect_path)):
        raise ValueError(f"Effekseer cannot open: {effect_path}")
    from Effekseer.Binary import Exporter
    efk_bytes = Exporter().Export(core.Root, 1.0)  # System.Byte[]

    bin_dir = editor_bin_directory()
    os.add_dll_directory(str(bin_dir))
    import clr
    clr.AddReference(str(bin_dir / "EffekseerCoreGUI.dll"))
    from Effekseer import swig
    from System import IntPtr
    from System.Runtime.InteropServices import Marshal

    # The editor initializes the native IO singleton at startup; without it (or with a null SoundDevice)
    # LoadEffect crashes with an access violation.
    swig.IO.Initialize()
    size = args.size
    device = swig.GraphicsDevice.Create(IntPtr(hidden_window(size, size)), size, size, False,
                                        swig.DeviceType.DirectX11)
    if device is None:
        raise RuntimeError("GraphicsDevice.Create returned null (DirectX 11)")
    sound = swig.SoundDevice.Create()
    setting = swig.EffectSetting.Create(device, sound)
    factory = swig.EffectFactory(setting)
    buffer = Marshal.AllocHGlobal(efk_bytes.Length)
    Marshal.Copy(efk_bytes, 0, buffer, efk_bytes.Length)
    # The path is used to resolve textures/models relative to the source document.
    effect = factory.LoadEffect(buffer, efk_bytes.Length, str(effect_path))
    Marshal.FreeHGlobal(buffer)
    if effect is None:
        raise RuntimeError("EffectFactory.LoadEffect returned null")

    view = swig.ViewPointController()
    view.SetScreenSize(size, size)
    view.SetProjectionType(swig.ProjectionType.Perspective)
    view.SetCoordinateSystem(swig.CoordinateSystemType.RH)
    view.SetDistance(args.distance)
    view.SetAngleX(args.angle_x)
    view.SetAngleY(args.angle_y)
    view.Update()

    config = swig.EffectRendererParameter()
    config.CameraMatrix = view.GetCameraMatrix()
    config.ProjectionMatrix = view.GetProjectionMatrix()
    color = swig.Color()
    color.R, color.G, color.B, color.A = background[0], background[1], background[2], 255
    config.BackgroundColor = color

    behavior = swig.ViewerEffectBehavior()
    behavior.CountX = behavior.CountY = behavior.CountZ = 1
    behavior.ScaleX = behavior.ScaleY = behavior.ScaleZ = 1.0
    behavior.AllColorR = behavior.AllColorG = behavior.AllColorB = behavior.AllColorA = 255
    behavior.PlaybackSpeed = 1.0
    behavior.RemovedTime = 2 ** 30

    results = []
    with tempfile.TemporaryDirectory(dir=out_dir) as scratch:
        for frame in frames:
            recording = swig.RecordingParameter()
            recording.RecordingMode = swig.RecordingModeType.Sprite
            recording.Count = 1
            recording.HorizontalCount = 1
            recording.OffsetFrame = frame
            recording.Freq = 1
            recording.Scale = 1
            recording.Transparence = getattr(swig.TransparenceType, "None")
            stem = Path(scratch) / f"f{frame:04d}"
            recording.SetPath(str(stem))
            recording.SetExt(".png")

            recorder = swig.EffectRecorder()
            ok = recorder.Begin(8000, config, swig.Vector2I(size, size), device, setting, recording,
                                swig.Vector2I(size, size), False, behavior,
                                swig.ViewerExternalModelVector(), swig.PostEffectParameter(), effect)
            if not ok:
                raise RuntimeError(f"EffectRecorder.Begin failed at frame {frame}")
            steps = 0
            while not recorder.IsCompleted():
                recorder.Step(1)
                steps += 1
                if steps > frame + 10_000:
                    raise RuntimeError(f"Recorder did not complete at frame {frame}")
            recorder.End()
            recorder.Dispose()

            written = sorted(Path(scratch).glob(f"f{frame:04d}*.png"))
            if len(written) != 1:
                raise RuntimeError(f"Expected one PNG for frame {frame}, got {[p.name for p in written]}")
            target = out_dir / f"t{frame:04d}.png"
            written[0].replace(target)
            results.append({
                "frame": frame,
                "seconds": round(frame / 60.0, 3),
                "file": str(target),
                "bytes": target.stat().st_size,
                "sha256": hashlib.sha256(target.read_bytes()).hexdigest(),
                "lit_pixels": lit_pixels(target, background),
                "recorder_steps": steps,
            })

    report = {
        "effect": str(effect_path),
        "renderer": "Effekseer 1.80.6 Viewer.dll EffectRecorder (Sprite), DirectX 11, hidden window",
        "fps": 60,
        "size": [size, size],
        "background": list(background),
        "camera": {"distance": args.distance, "angle_x": args.angle_x, "angle_y": args.angle_y},
        "frames": results,
    }
    (out_dir / "preview.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
