"""Spectrite rod (OBJ + vertical animated texture sheet) -> GLB for App 2 props.

Geometry is rescaled so the rod has the same length and grip point as the old App 2 rod
(gay-cau-vong-v2: y from -0.15 to 1.13, grip at y=0, long axis +Y, centred on X/Z).
UVs point at frame 0 of the sheet, so viewers without texture animation still show a correct rod.
Material extras.w01TextureAnimation tells App 2 (and later the BBS export) how to cycle frames.

usage: python -I build_rod_glb.py <rod.obj> <sheet.png> <sheet.png.mcmeta> <out.glb>
"""
import json
import struct
import sys

OLD_BOTTOM, OLD_TOP = -0.15, 1.13


def read_obj(path):
    verts, uvs, faces = [], [], []
    for line in open(path, encoding='utf-8'):
        p = line.split()
        if not p:
            continue
        if p[0] == 'v':
            verts.append(tuple(map(float, p[1:4])))
        elif p[0] == 'vt':
            uvs.append(tuple(map(float, p[1:3])))
        elif p[0] == 'f':
            faces.append([tuple(int(x) - 1 for x in c.split('/')[:2]) for c in p[1:]])
    return verts, uvs, faces


def png_size(data):
    return struct.unpack('>II', data[16:24])


def main(obj_path, png_path, mcmeta_path, out_path):
    verts, uvs, faces = read_obj(obj_path)
    png = open(png_path, 'rb').read()
    width, height = png_size(png)
    frames = height // width
    meta = json.load(open(mcmeta_path, encoding='utf-8'))['animation']
    frametime = int(meta.get('frametime', 1))
    order = [int(f) for f in meta.get('frames', range(frames))]

    ys = [v[1] for v in verts]
    y0, y1 = min(ys), max(ys)
    scale = (OLD_TOP - OLD_BOTTOM) / (y1 - y0)
    cx = (min(v[0] for v in verts) + max(v[0] for v in verts)) / 2
    cz = (min(v[2] for v in verts) + max(v[2] for v in verts)) / 2

    def pos(v):
        return ((v[0] - cx) * scale, (v[1] - y0) * scale + OLD_BOTTOM, (v[2] - cz) * scale)

    P, N, T, I = [], [], [], []
    for face in faces:
        pts = [pos(verts[vi]) for vi, _ in face]
        a, b, c = pts[0], pts[1], pts[2]
        u = [b[i] - a[i] for i in range(3)]
        w = [c[i] - a[i] for i in range(3)]
        n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]]
        ln = sum(x * x for x in n) ** 0.5 or 1
        n = [x / ln for x in n]
        base = len(P)
        for (vi, ti), p in zip(face, pts):
            su, sv = uvs[ti]
            P.append(p)
            N.append(n)
            # OBJ v is bottom-up; glTF v is top-down. Frame 0 is the top square of the sheet.
            T.append((su, (1.0 - sv) / frames))
        for k in range(1, len(face) - 1):
            I += [base, base + k, base + k + 1]

    def pack(fmt, rows):
        return b''.join(struct.pack(fmt, *r) for r in rows)

    blobs = [pack('<3f', P), pack('<3f', N), pack('<2f', T), struct.pack(f'<{len(I)}H', *I), png]
    views, offset, binary = [], 0, b''
    for blob in blobs:
        pad = (-len(binary)) % 4
        binary += b'\0' * pad
        offset = len(binary)
        views.append({'buffer': 0, 'byteOffset': offset, 'byteLength': len(blob)})
        binary += blob
    binary += b'\0' * ((-len(binary)) % 4)
    for i in range(3):
        views[i]['target'] = 34962
    views[3]['target'] = 34963

    mn = [min(p[i] for p in P) for i in range(3)]
    mx = [max(p[i] for p in P) for i in range(3)]
    animation = {
        'version': 1,
        'layout': 'vertical-strip',
        'frameCount': frames,
        'frameOrder': order,
        'frametimeTicks': frametime,
        'ticksPerSecond': 20,
        'interpolate': bool(meta.get('interpolate', False)),
        'uvFrame': 0,
        'source': 'minecraft .png.mcmeta',
    }
    gltf = {
        'asset': {'version': '2.0', 'generator': 'w01 build_rod_glb.py'},
        'scene': 0,
        'scenes': [{'nodes': [0]}],
        'nodes': [{'name': 'spectrite_rod', 'mesh': 0}],
        'meshes': [{'name': 'spectrite_rod', 'primitives': [{
            'attributes': {'POSITION': 0, 'NORMAL': 1, 'TEXCOORD_0': 2}, 'indices': 3, 'material': 0}]}],
        'materials': [{
            'name': 'spectrite_rainbow',
            'pbrMetallicRoughness': {'baseColorTexture': {'index': 0}, 'metallicFactor': 0, 'roughnessFactor': 0.7},
            'emissiveTexture': {'index': 0},
            'emissiveFactor': [0.55, 0.55, 0.55],
            'alphaMode': 'MASK',
            'alphaCutoff': 0.5,
            'extras': {'w01TextureAnimation': animation},
        }],
        'textures': [{'sampler': 0, 'source': 0}],
        'samplers': [{'magFilter': 9728, 'minFilter': 9728, 'wrapS': 33071, 'wrapT': 33071}],
        'images': [{'bufferView': 4, 'mimeType': 'image/png', 'name': 'spectrite_rod_sheet'}],
        'accessors': [
            {'bufferView': 0, 'componentType': 5126, 'count': len(P), 'type': 'VEC3', 'min': mn, 'max': mx},
            {'bufferView': 1, 'componentType': 5126, 'count': len(N), 'type': 'VEC3'},
            {'bufferView': 2, 'componentType': 5126, 'count': len(T), 'type': 'VEC2'},
            {'bufferView': 3, 'componentType': 5123, 'count': len(I), 'type': 'SCALAR'},
        ],
        'bufferViews': views,
        'buffers': [{'byteLength': len(binary)}],
    }
    js = json.dumps(gltf, separators=(',', ':')).encode('utf-8')
    js += b' ' * ((-len(js)) % 4)
    out = b''.join([
        struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(binary)),
        struct.pack('<II', len(js), 0x4E4F534A), js,
        struct.pack('<II', len(binary), 0x004E4942), binary,
    ])
    open(out_path, 'wb').write(out)
    print(json.dumps({'out': out_path, 'bytes': len(out), 'triangles': len(I) // 3, 'frames': frames,
                      'scale': scale, 'bbox': [mn, mx]}))


if __name__ == '__main__':
    main(*sys.argv[1:5])
