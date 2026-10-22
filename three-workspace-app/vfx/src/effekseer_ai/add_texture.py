"""Small dependency-free RGBA PNG transform for the approved Add fallback."""
from __future__ import annotations
import struct
import zlib
from typing import Iterable

_SIG = b"\x89PNG\r\n\x1a\n"


def add_layers(data: bytes, exponent: float = 1.5, alpha_scale: float = 1.0, halo_alpha: float = 0.55) -> tuple[bytes, bytes]:
    width, height, pixels = _decode(data)
    core = bytearray()
    halo = bytearray()
    for i in range(0, len(pixels), 4):
        r, g, b, a = pixels[i:i + 4]
        lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
        peak = max(r, g, b)
        normalized = (r / peak, g / peak, b / peak) if peak else (0, 0, 0)
        mix = lum ** exponent
        core.extend(round(255 * (c * (1 - mix) + mix)) for c in normalized)
        core.append(round(max(0, min(255, lum * alpha_scale * 255))))
        halo.extend(round(c * 255) for c in normalized)
        halo.append(round(max(0, min(255, lum * alpha_scale * halo_alpha * 255))))
    return _encode(width, height, bytes(core)), _encode(width, height, bytes(halo))


def _decode(data: bytes) -> tuple[int, int, bytes]:
    if not data.startswith(_SIG): raise ValueError("Add texture must be a PNG")
    pos, width, height, color, depth, interlace = 8, 0, 0, 0, 0, 0
    compressed = bytearray()
    while pos < len(data):
        size = struct.unpack_from(">I", data, pos)[0]; kind = data[pos + 4:pos + 8]; payload = data[pos + 8:pos + 8 + size]; pos += 12 + size
        if kind == b"IHDR": width, height, depth, color, comp, filt, interlace = struct.unpack(">IIBBBBB", payload)
        elif kind == b"IDAT": compressed.extend(payload)
        elif kind == b"IEND": break
    if depth != 8 or color not in (2, 6) or interlace != 0: raise ValueError("Add texture PNG must be non-interlaced RGB/RGBA 8-bit")
    channels = 4 if color == 6 else 3; stride = width * channels
    raw = zlib.decompress(compressed); rows=[]; offset=0; previous=bytearray(stride)
    for _ in range(height):
        method=raw[offset]; offset+=1; scan=bytearray(raw[offset:offset+stride]); offset+=stride
        for x in range(stride):
            left=scan[x-channels] if x>=channels else 0; up=previous[x]; upper_left=previous[x-channels] if x>=channels else 0
            if method==1: scan[x]=(scan[x]+left)&255
            elif method==2: scan[x]=(scan[x]+up)&255
            elif method==3: scan[x]=(scan[x]+((left+up)//2))&255
            elif method==4:
                p=left+up-upper_left; pa=abs(p-left); pb=abs(p-up); pc=abs(p-upper_left); predict=left if pa<=pb and pa<=pc else up if pb<=pc else upper_left; scan[x]=(scan[x]+predict)&255
            elif method!=0: raise ValueError("Unsupported PNG filter")
        rows.append(bytes(scan)); previous=scan
    if color == 6: return width, height, b"".join(rows)
    rgba=bytearray()
    for row in rows:
        for i in range(0,len(row),3): rgba.extend((*row[i:i+3],255))
    return width,height,bytes(rgba)


def _encode(width: int, height: int, rgba: bytes) -> bytes:
    raw=b"".join(b"\0"+rgba[y*width*4:(y+1)*width*4] for y in range(height))
    def chunk(kind: bytes, payload: bytes) -> bytes:
        body=kind+payload
        return struct.pack(">I",len(payload))+body+struct.pack(">I",zlib.crc32(body)&0xffffffff)
    return _SIG+chunk(b"IHDR",struct.pack(">IIBBBBB",width,height,8,6,0,0,0))+chunk(b"IDAT",zlib.compress(raw))+chunk(b"IEND",b"")
