"""Create a sandbox for a NEW shot from the previous shot's project (never writes the real project or the real library).

  python new-shot.py --from S:/Claude/w01-samples/tap15v3/projects/<prevId> --name "Tập 15 · Shot 05" --slug s5 --port 3142 [--end 300]

Creates:
  S:/Claude/w01-samples/<slug>-projects/<newId>   copy of the previous project: new id (also inside asset URLs), no history/jobs
  S:/Claude/w01-samples/<slug>-lib                library subset (packs the project references) via w01-test-sandbox
  S:/Claude/w01-samples/<slug>-vfx-previews       vfx-previews + Tập 15 pixelfx previews (rainbow, trúng đòn, …)
  launch.json entry <slug> (next dev on --editor, default the built worktree S:/Claude/w01-film)
  S:/Claude/w01/work/<slug>/shot.json             config every other script reads (characters, prop, end, prev shot)
"""
import argparse, json, re, shutil, subprocess, sys, unicodedata, uuid
from pathlib import Path

SAMPLES = Path('S:/Claude/w01-samples')
REAL = [Path('S:/Claude/w01-samples/tap15v3/projects'), Path('S:/Claude/w01-library')]
SKILLS = Path(__file__).resolve().parents[2]


def slugify(name):
    s = unicodedata.normalize('NFD', name.replace('Đ', 'D').replace('đ', 'd')).encode('ascii', 'ignore').decode().lower()
    return re.sub(r'[^a-z0-9]+', '', s.split('_')[0]) or 'c'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--from', dest='src', required=True, help='previous shot project folder (read only)')
    ap.add_argument('--name', required=True)
    ap.add_argument('--slug', required=True, help='short id, e.g. s5')
    ap.add_argument('--port', type=int, required=True)
    ap.add_argument('--end', type=int, default=300, help='shot length in frames (30 fps)')
    ap.add_argument('--editor', default='S:/Claude/w01-film/three-workspace-app/editor', help='built checkout that serves the sandbox')
    ap.add_argument('--launch', default='S:/Claude/w01/.claude/launch.json')
    ap.add_argument('--extra-previews', default='S:/Claude/w01-samples/vfx-previews-tap15')
    a = ap.parse_args()
    if a.port in (3002, 3016, 3046, 3048, 3050):
        sys.exit('port is used by the user / other sandboxes')
    src = Path(a.src)
    prev = json.loads((src / 'project.json').read_text(encoding='utf8'))
    root = SAMPLES / f'{a.slug}-projects'
    if root.exists():
        sys.exit(f'{root} exists: pick another --slug')
    new_id = str(uuid.uuid4())
    dst = root / new_id
    shutil.copytree(src, dst, symlinks=False, ignore=shutil.ignore_patterns('.history', '.jobs'))  # dereference junctions
    text = (dst / 'project.json').read_text(encoding='utf8').replace(prev['projectId'], new_id)
    p = json.loads(text)
    p['name'], p['revision'] = a.name, 0
    (dst / 'project.json').write_text(json.dumps(p, ensure_ascii=False), encoding='utf8')
    lib = SAMPLES / f'{a.slug}-lib'
    subprocess.run([sys.executable, str(SKILLS / 'w01-test-sandbox/scripts/sandbox.py'), 'library', '--projects', str(root), '--to', str(lib)], check=True)
    prev_dir = SAMPLES / f'{a.slug}-vfx-previews'
    shutil.copytree(SAMPLES / 'vfx-previews', prev_dir, dirs_exist_ok=True)
    extra = Path(a.extra_previews)
    if extra.exists():
        for d in extra.iterdir():
            if d.is_dir() and d.name.startswith('tap15-') and not (prev_dir / d.name).exists():
                shutil.copytree(d, prev_dir / d.name)
    # launch.json entry
    launch = json.loads(Path(a.launch).read_text(encoding='utf8'))
    env = {'W01_LIBRARY': lib.as_posix(), 'BBS_UNIFIED_PROJECTS_DIR': root.as_posix(),
           'W01_AAA_ASSETS': 'S:/Claude/w01-samples/tong-duyet/config-bbs-assets/effeks/samples', 'W01_VFX_PREVIEWS': prev_dir.as_posix(),
           'BBS_JAVA_HOME': 'C:/Program Files/Microsoft/jdk-17.0.20.101-hotspot'}
    js = ''.join(f"process.env.{k}='{v}';" for k, v in env.items()) + \
        f"require('child_process').spawn('pnpm',['--dir','{a.editor}','--filter','@topview/3d-studio','exec','next','dev','--hostname','127.0.0.1','--port','{a.port}'],{{stdio:'inherit',shell:true}})"
    launch['configurations'] = [c for c in launch['configurations'] if c['name'] != a.slug] + \
        [{'name': a.slug, 'runtimeExecutable': 'node', 'runtimeArgs': ['-e', js], 'port': a.port, 'autoPort': False}]
    Path(a.launch).write_text(json.dumps(launch, indent=2, ensure_ascii=False), encoding='utf8')
    # shot.json
    chars, used = {}, set()
    for cid, c in p['characters'].items():
        key = slugify(c.get('name', 'c'))
        while key in used:
            key += 'x'
        used.add(key)
        chars[key] = {'node': c['nodeId'], 'char': cid, 'name': c.get('name')}
    props = [n for n in p['scene']['content']['nodes'] if n.get('type') == 'prop']
    work = Path('S:/Claude/w01/work') / a.slug
    work.mkdir(parents=True, exist_ok=True)
    shot = {'project': new_id, 'name': a.name, 'api': f'http://127.0.0.1:{a.port}', 'projectsDir': root.as_posix(), 'library': lib.as_posix(), 'previews': prev_dir.as_posix(),
            'editor': a.editor, 'work': work.as_posix(), 'end': a.end, 'camera': next((n['id'] for n in p['scene']['content']['nodes'] if n.get('type') == 'camera'), 'camera_1'),
            'prev': {'dir': src.parent.as_posix(), 'id': prev['projectId'], 'frame': p['scene']['content']['timeline']['frameEnd'] - 1},
            'chars': chars, 'floor': [], 'fastFrames': []}
    if props:
        shot['prop'] = {'node': props[0]['id'], 'follow': None, 'bone': None, 'tip': [0, 1.0, 0]}
    (work / 'shot.json').write_text(json.dumps(shot, indent=2, ensure_ascii=False), encoding='utf8')
    print(f'project {dst}\nlibrary {lib}\npreviews {prev_dir}\nlaunch "{a.slug}" port {a.port}\nconfig {work / "shot.json"}')
    print('next: preview_start name=' + a.slug + ', then node continue-from.mjs ' + (work / 'shot.json').as_posix())


if __name__ == '__main__':
    main()
