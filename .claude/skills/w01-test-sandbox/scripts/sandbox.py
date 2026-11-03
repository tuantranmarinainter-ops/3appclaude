#!/usr/bin/env python3
"""Safe test sandbox for W01 App 2/App 3: worktree + copied projects + small library copy + launch config.

Why: the dev/prod server reads projects from BBS_UNIFIED_PROJECTS_DIR and the library from W01_LIBRARY, and W01_LIBRARY
DEFAULTS TO THE REAL 16 GB LIBRARY. A test that saves a merged clip or converts an action writes there. Every sandbox
therefore gets its own project copy and a library copy holding only what those projects reference.

  python sandbox.py worktree --name k6 --branch claude/my-fix [--from origin/main]
      -> S:/Claude/w01-k6 on a new branch, pnpm install, builder build
  python sandbox.py projects --from S:/Claude/w01-samples/tall-projects --to S:/Claude/w01-samples/k6-projects
  python sandbox.py library  --projects S:/Claude/w01-samples/k6-projects --to S:/Claude/w01-samples/k6-lib [--dry-run]
  python sandbox.py launch   --name k6 --worktree S:/Claude/w01-k6 --projects ... --library ... --port 3121 [--prod]
      -> adds/updates an entry in <main checkout>/.claude/launch.json (start it with the preview tool by name)
  python sandbox.py all --name k6 --branch claude/my-fix --from-projects S:/Claude/w01-samples/tall-projects --port 3121 [--prod]

Never point --to / --library at S:/Claude/w01-library, C:/w01-library or a real project folder; the script refuses.
"""
import argparse
import io
import json
import os
import re
import shutil
import subprocess
import sys

REAL_LIBRARY = r'S:\Claude\w01-library'
SAMPLES = r'S:\Claude\w01-samples'
FORBIDDEN = [REAL_LIBRARY, r'C:\w01-library', os.path.join(SAMPLES, 'tap15v3')]
MAIN = r'S:\Claude\w01'
UUID = re.compile(r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}')


def norm(p):
    return os.path.normcase(os.path.abspath(p))


def refuse_real(path):
    for bad in FORBIDDEN:
        if norm(path) == norm(bad) or norm(path).startswith(norm(bad) + os.sep):
            sys.exit(f'REFUSED: {path} is real data ({bad}). Use a copy under {SAMPLES}.')


def sh(cmd, cwd=None):
    print('$ ' + cmd, flush=True)
    r = subprocess.run(cmd, cwd=cwd, shell=True)
    if r.returncode:
        sys.exit(f'failed: {cmd}')


def worktree(a):
    path = os.path.join(os.path.dirname(MAIN), 'w01-' + a.name)
    if os.path.exists(path):
        sys.exit(f'{path} exists; pick another --name or remove it with git worktree remove')
    sh('git fetch -q origin', MAIN)
    sh(f'git worktree add -q -b {a.branch} "{path}" {a.from_ref}', MAIN)
    editor = os.path.join(path, 'three-workspace-app', 'editor')
    sh('pnpm install --frozen-lockfile', editor)
    sh('pnpm --filter @topview/3d-builder build', editor)
    print('WORKTREE ' + path)
    return path


def projects(a):
    refuse_real(a.to)
    if os.path.exists(a.to):
        sys.exit(f'{a.to} exists; choose a new folder (never overwrite someone else\'s sandbox)')
    # copytree dereferences symlinks/junctions by default (symlinks=False): C:\w01-samples\* are junctions.
    shutil.copytree(a.src, a.to, symlinks=False)
    print('PROJECTS ' + a.to)


def library(a):
    refuse_real(a.to)
    src = a.real or REAL_LIBRARY
    idx = json.load(open(os.path.join(src, 'index.json'), encoding='utf-8'))
    text = ''
    for d in os.listdir(a.projects):
        p = os.path.join(a.projects, d, 'project.json')
        if os.path.isfile(p):
            text += open(p, encoding='utf-8').read()
    ids = set(UUID.findall(text))
    first = [x for x in idx['actions'] if x['uuid'] in ids]
    chains = {x.get('variantOf') or x['uuid'] for x in first} | {x.get('parentUuid') for x in first if x.get('parentUuid')}
    actions = [x for x in idx['actions'] if x['uuid'] in ids or x['uuid'] in chains or x.get('variantOf') in chains]
    packs = sorted({x['packId'] for x in actions if x.get('packId')})
    size = sum(os.path.getsize(os.path.join(r, f)) for p in packs for r, _, fs in os.walk(os.path.join(src, 'packs', p)) for f in fs)
    print(f'actions {len(actions)} · packs {len(packs)} · {size / 1e6:.0f} MB of packs')
    if a.dry_run:
        return
    if os.path.exists(a.to):
        sys.exit(f'{a.to} exists')
    os.makedirs(a.to)
    for f in ('index.json', 'library.json'):
        shutil.copy2(os.path.join(src, f), os.path.join(a.to, f))
    for sub in ('models', 'rigs', 'characters'):
        shutil.copytree(os.path.join(src, sub), os.path.join(a.to, sub), symlinks=False)
    for p in packs:
        shutil.copytree(os.path.join(src, 'packs', p), os.path.join(a.to, 'packs', p), symlinks=False)
    print('LIBRARY ' + a.to)


def launch(a):
    refuse_real(a.projects); refuse_real(a.library)
    if a.port in (3002, 3046, 3048, 3050):
        sys.exit(f'port {a.port} is used by another sandbox or the user; pick 3110-3199')
    editor = os.path.join(a.worktree, 'three-workspace-app', 'editor').replace('\\', '/')
    env = {
        'W01_LIBRARY': a.library, 'BBS_UNIFIED_PROJECTS_DIR': a.projects,
        'W01_AAA_ASSETS': os.path.join(SAMPLES, 'tong-duyet', 'config-bbs-assets', 'effeks', 'samples'),
        'W01_VFX_PREVIEWS': os.path.join(SAMPLES, 'vfx-previews'),
        'BBS_JAVA_HOME': r'C:\Program Files\Microsoft\jdk-17.0.20.101-hotspot',
    }
    sets = ';'.join(f"process.env.{k}='{v.replace(chr(92), '/')}'" for k, v in env.items())
    verb = 'start' if a.prod else 'dev'
    spawn = (f"require('child_process').spawn('pnpm',['--dir','{editor}','--filter','@topview/3d-studio','exec','next','{verb}',"
             f"'--hostname','127.0.0.1','--port','{a.port}'],{{stdio:'inherit',shell:true}})")
    path = os.path.join(MAIN, '.claude', 'launch.json')
    cfg = json.load(open(path, encoding='utf-8')) if os.path.exists(path) else {'version': '0.0.1', 'configurations': []}
    cfg['configurations'] = [c for c in cfg['configurations'] if c.get('name') != a.name]
    cfg['configurations'].append({'name': a.name, 'runtimeExecutable': 'node', 'runtimeArgs': ['-e', sets + ';' + spawn],
                                  'port': a.port, 'autoPort': False})
    json.dump(cfg, open(path, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
    print(f'LAUNCH {a.name} -> http://127.0.0.1:{a.port}  ({"next start: run pnpm build first" if a.prod else "next dev"})')


def main():
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest='cmd', required=True)
    w = sub.add_parser('worktree'); w.add_argument('--name', required=True); w.add_argument('--branch', required=True); w.add_argument('--from', dest='from_ref', default='origin/main')
    p = sub.add_parser('projects'); p.add_argument('--from', dest='src', required=True); p.add_argument('--to', required=True)
    l = sub.add_parser('library'); l.add_argument('--projects', required=True); l.add_argument('--to', required=True); l.add_argument('--real'); l.add_argument('--dry-run', action='store_true')
    n = sub.add_parser('launch'); n.add_argument('--name', required=True); n.add_argument('--worktree', required=True); n.add_argument('--projects', required=True); n.add_argument('--library', required=True); n.add_argument('--port', type=int, required=True); n.add_argument('--prod', action='store_true')
    al = sub.add_parser('all'); al.add_argument('--name', required=True); al.add_argument('--branch', required=True); al.add_argument('--from', dest='from_ref', default='origin/main'); al.add_argument('--from-projects', required=True); al.add_argument('--port', type=int, required=True); al.add_argument('--prod', action='store_true')
    a = ap.parse_args()
    if a.cmd == 'worktree': worktree(a)
    elif a.cmd == 'projects': projects(a)
    elif a.cmd == 'library': library(a)
    elif a.cmd == 'launch': launch(a)
    else:
        wt = worktree(a)
        proj = os.path.join(SAMPLES, a.name + '-projects'); lib = os.path.join(SAMPLES, a.name + '-lib')
        projects(argparse.Namespace(src=a.from_projects, to=proj))
        library(argparse.Namespace(projects=proj, to=lib, real=None, dry_run=False))
        launch(argparse.Namespace(name=a.name, worktree=wt, projects=proj, library=lib, port=a.port, prod=a.prod))
        if a.prod:
            sh('pnpm build', os.path.join(wt, 'three-workspace-app', 'editor'))
    return 0


if __name__ == '__main__':
    sys.exit(main())
