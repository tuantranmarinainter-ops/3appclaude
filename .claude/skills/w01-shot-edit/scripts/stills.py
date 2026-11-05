"""Render review stills of a shot (through its camera, BBS look) and build one labelled contact sheet.

usage: python -I stills.py <projectId> <frames e.g. 0,30,40,72> --out S:/Claude/w01/work/<topic>/<name>
       [--api http://127.0.0.1:3131] [--sequence sequence_1] [--clip shot_03] [--cols 4]

Writes <name>-f###.png per frame and <name>.jpg (sheet). The server caps a request at ~8 frames, so frames are chunked.
NOTE: review stills IGNORE user keys (extensions.topview.fcurves.userKeys); the App 2 viewport and the film export use them.
Always confirm timing in the viewport too (references/viewport-probe.md).
"""
import argparse
import base64
import http.cookiejar
import json
import urllib.request

from PIL import Image, ImageDraw

ap = argparse.ArgumentParser()
ap.add_argument('project')
ap.add_argument('frames')
ap.add_argument('--out', required=True)
ap.add_argument('--api', default='http://127.0.0.1:3131')
ap.add_argument('--sequence', default='sequence_1')
ap.add_argument('--clip', default=None, help='editorial clip id; default = first clip of the sequence')
ap.add_argument('--cols', type=int, default=4)
a = ap.parse_args()
if ':3016' in a.api or ':3002' in a.api:
    raise SystemExit('stills only from a sandbox/temporary server, not the user App 2')

hdr = {'content-type': 'application/json', 'origin': a.api}
op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
op.open(urllib.request.Request(a.api + '/api/unified/session', data=b'{}', headers=hdr, method='POST'))
clip = a.clip
if not clip:
    p = json.load(op.open(f'{a.api}/api/unified/projects/{a.project}'))['project']
    seq = next(s for s in p['scene']['content']['editorial']['sequences'] if s['id'] == a.sequence)
    clip = seq['clips'][0]['id']
frames = [int(x) for x in a.frames.split(',')]
files = []
for i in range(0, len(frames), 8):
    chunk = frames[i:i + 8]
    body = json.dumps({'sequenceId': a.sequence, 'clipId': clip, 'frames': chunk}).encode()
    res = json.load(op.open(urllib.request.Request(f'{a.api}/api/unified/projects/{a.project}/review-capture', data=body, headers=hdr), timeout=900))
    for f, img in zip(chunk, res['images']):
        path = f'{a.out}-f{f:03d}.png'
        open(path, 'wb').write(base64.b64decode(img.split(',', 1)[1]))
        files.append((f, path))
w, h = 400, 225
rows = (len(files) + a.cols - 1) // a.cols
sheet = Image.new('RGB', (w * a.cols, h * rows))
for k, (f, path) in enumerate(files):
    im = Image.open(path).convert('RGB').resize((w, h))
    ImageDraw.Draw(im).text((6, 4), f'khung {f}', fill=(255, 40, 40))
    sheet.paste(im, ((k % a.cols) * w, (k // a.cols) * h))
sheet.save(a.out + '.jpg', quality=85)
print(a.out + '.jpg')
