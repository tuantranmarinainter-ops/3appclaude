"""Turn rendered pixelfx sheets into (1) App 2 preview sheets and (2) BBS FS 2.7 particle packages via App 4.

Usage: python -I build_pack.py <repo-root> <work-dir>
Input:  <work-dir>/render/<key>/ (from render_all.mjs)
Output: <work-dir>/pack/app2-vfx-previews/<key>/{sheet.png,sheet.json}
        <work-dir>/pack/bbs-particles/<key>.zip   (App 4 bbs-package)
        <work-dir>/pack/report.json
Binary output stays outside the repository.
"""
import json, math, shutil, sys
from pathlib import Path
from PIL import Image

HERE = Path(__file__).resolve().parent
if len(sys.argv) < 3:
    sys.exit('usage: python -I build_pack.py <repo-root> <work-dir>')
REPO = Path(sys.argv[1]).resolve()
WORKDIR = Path(sys.argv[2]).resolve()
sys.path.insert(0, str(REPO / 'three-workspace-app/vfx/src'))
from effekseer_ai.bbs_package import build_bbs_package  # noqa: E402
from effekseer_ai.ir_to_bbs import BBS_BILLBOARD_SIDE  # noqa: E402

PX_PER_METER = 38 / 1.8    # pixelfx stock actor (scale 2) is 38 px tall ≈ a 1.8 m Minecraft character
BBS_FPS = 20               # BBS ticks at 20 Hz
MAX_STRIP = 8192           # keep strip textures inside common GPU limits

plan = json.loads((HERE / 'plan.json').read_text('utf8'))
out = WORKDIR / 'pack'
shutil.rmtree(out, ignore_errors=True)
(out / 'app2-vfx-previews').mkdir(parents=True)
(out / 'bbs-particles').mkdir(parents=True)
work = WORKDIR / 'work'
shutil.rmtree(work, ignore_errors=True)
work.mkdir()
report = []

for fx in plan['effects']:
    key = fx['key']
    src = WORKDIR / 'render' / key
    meta = json.loads((src / 'pixelfx.json').read_text('utf8'))['meta']['pixelfx']
    sheet = Image.open(src / 'pixelfx.png').convert('RGBA')
    w, h = meta['frameSize']
    cols, n, fps, loop = meta['columns'], meta['frames'], meta['fps'], meta['loop']
    frames = [sheet.crop(((i % cols) * w, (i // cols) * h, (i % cols) * w + w, (i // cols) * h + h)) for i in range(n)]
    # Union of visible pixels over every frame, so later sprites carry no empty margin.
    boxes = [f.getchannel('A').getbbox() for f in frames]
    boxes = [b for b in boxes if b]
    x0, y0 = min(b[0] for b in boxes), min(b[1] for b in boxes)
    x1, y1 = max(b[2] for b in boxes), max(b[3] for b in boxes)
    crop = [f.crop((x0, y0, x1, y1)) for f in frames]
    cw, ch = x1 - x0, y1 - y0
    px, py = meta['pivot'][0] - x0, meta['pivot'][1] - y0

    # (1) App 2 preview: square cells (App 2 sprites are square), pivot kept, alpha blend.
    side = max(cw, ch)
    ox, oy = (side - cw) // 2, side - ch          # centre horizontally, sit on the bottom edge
    gcols = math.ceil(math.sqrt(n)); grows = math.ceil(n / gcols)
    grid = Image.new('RGBA', (gcols * side, grows * side))
    for i, f in enumerate(crop):
        grid.alpha_composite(f, ((i % gcols) * side + ox, (i // gcols) * side + oy))
    dest = out / 'app2-vfx-previews' / key
    dest.mkdir()
    grid.save(dest / 'sheet.png', optimize=True)
    pivot = [round((px + ox) / side, 4), round(1 - (py + oy) / side, 4)]
    app2 = {'frames': n, 'columns': gcols, 'rows': grows, 'fps': fps, 'sizeMeters': round(side / PX_PER_METER, 3),
            'pivot': pivot, 'blend': 'alpha', 'loop': loop}
    (dest / 'sheet.json').write_text(json.dumps(app2, indent=2), 'utf8')

    # (2) BBS particle: one horizontal strip at 20 fps (Snowstorm flipbooks step along one axis).
    # Prefer 20 fps; drop to 15/10 fps for long effects; past that, halve the strip resolution instead of
    # dropping more frames (billboard size in metres is unchanged, only texel density drops).
    bfps = BBS_FPS
    while True:
        count = max(1, round(n / fps * bfps))
        if count * cw <= MAX_STRIP or bfps <= 10:
            break
        bfps -= 5
    factor = min(1.0, MAX_STRIP / (count * cw))
    tw, th = max(1, int(cw * factor)), max(1, int(ch * factor))
    picks = [min(n - 1, round(k * fps / bfps)) for k in range(count)]
    strip = Image.new('RGBA', (count * tw, th))
    for k, i in enumerate(picks):
        cell = crop[i] if factor == 1.0 else crop[i].resize((tw, th), Image.NEAREST)
        strip.alpha_composite(cell, (k * tw, 0))
    tex_rel = f'textures/tap15/{key}.png'
    (work / 'textures/tap15').mkdir(parents=True, exist_ok=True)
    strip.save(work / tex_rel, optimize=True)
    size_m = [cw / PX_PER_METER, ch / PX_PER_METER]
    ir = {
        'schemaVersion': 1, 'name': key, 'fps': bfps,
        'assets': [{'path': tex_rel, 'license': 'MIT', 'credit': f"pixelfx {fx['src']} (patch-gg/pixelfx, MIT), recoloured for Tập 15"}],
        'nodes': [
            {'id': 'root', 'path': 'node/id/root', 'parentId': None, 'name': 'Root', 'renderType': 'none'},
            {'id': key.replace('-', '_'), 'path': 'node/id/' + key.replace('-', '_'), 'parentId': 'root', 'name': fx['name'], 'renderType': 'sprite',
             'blend': 'blend', 'texture': tex_rel,
             'generation': {'maxGeneration': 1, 'generationTime': count, 'generationTimeOffset': 0, 'infinite': bool(loop)},
             'life': {'min': count, 'max': count},
             'location': {'type': 'fixed', 'shape': 'point', 'position': [0, size_m[1] / 2, 0], 'direction': [0, 1, 0]},
             'size': [s * BBS_BILLBOARD_SIDE for s in size_m],
             'color': [1, 1, 1, 1],
             'flipbook': {'baseUV': [0, 0], 'sizeUV': [1 / count, 1], 'stepUV': [1 / count, 0],
                          'framesPerSecond': bfps, 'maxFrame': count, 'loop': bool(loop), 'stretchToLifetime': False},
             'unsupportedFeatures': []},
        ],
    }
    (work / f'{key}.ir.json').write_text(json.dumps(ir, indent=1), 'utf8')
    result = build_bbs_package(ir, out / 'bbs-particles' / f'{key}.zip', work)
    report.append({'key': key, 'source': fx['src'], 'name': fx['name'], 'palette': fx.get('palette'),
                   'frames': n, 'fps': fps, 'loop': loop, 'trimmed': [cw, ch], 'app2': app2,
                   'bbs': {'status': result.get('status'), 'fps': bfps, 'frames': count, 'strip': [count * tw, th], 'textureScale': round(factor, 3),
                           'billboardMeters': size_m, 'error': result.get('error')}})
    print(f"{key:26} app2 {gcols}x{grows} {side}px {app2['sizeMeters']}m | bbs {result.get('status')} {count}f@{bfps} {count*tw}x{th} x{factor:.2f}")

(out / 'report.json').write_text(json.dumps(report, indent=2, ensure_ascii=False), 'utf8')
