#!/usr/bin/env python3
"""Rebuild the App 3 embed that App 2 serves, then prove nothing was lost.

Steps (each prints PASS/FAIL):
  1. keep the current served index.html as the baseline (from git HEAD, so a dirty/merged tree still has a fair base)
  2. node editor/apps/studio/scripts/embed-app3.mjs --version <APP3_EMBED_VERSION> --force [--allow-dirty]
     (builds src/, copies index.html + host-bridge.js + LICENSE/NOTICE, REWRITES README.md with fresh SHA-256)
  3. node animation-studio/tools/check-features.mjs <baseline> <new>   ("không bỏ chức năng": no element id may vanish)
  4. node --test on the App 3 unit tests (not the *.browser.test.mjs ones)
  5. tsx --test editor/apps/studio/test/app3Embed.test.ts (hash/README contract)

Usage (from anywhere inside the repo or a worktree):
  python app3_build.py [--allow-dirty] [--skip-tests] [--base-ref HEAD]
After a merge conflict in v<ver>/README.md or index.html: finish the merge of the *source* files, then run this with
--allow-dirty; it regenerates both files, so `git add` them and commit.
"""
import argparse
import io
import os
import re
import subprocess
import sys
import tempfile

UNIT_TESTS = ['onion_spread.test.mjs', 'app3_bridge.test.mjs', 'layout_modes.test.mjs', 'app3_workflow_steps.test.mjs',
              'shot_package.test.mjs']


def run(cmd, cwd, shell=False):
    print('$ ' + (cmd if isinstance(cmd, str) else ' '.join(cmd)), flush=True)
    return subprocess.run(cmd, cwd=cwd, shell=shell, text=True, encoding='utf-8', errors='replace',
                          stdout=subprocess.PIPE, stderr=subprocess.STDOUT)


def main():
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
    ap = argparse.ArgumentParser()
    ap.add_argument('--allow-dirty', action='store_true', help='build even if animation-studio/ has uncommitted edits')
    ap.add_argument('--skip-tests', action='store_true')
    ap.add_argument('--base-ref', default='HEAD', help='git ref whose served index.html is the feature baseline')
    a = ap.parse_args()

    root = subprocess.run(['git', 'rev-parse', '--show-toplevel'], capture_output=True, text=True, check=True).stdout.strip()
    tw = os.path.join(root, 'three-workspace-app')
    studio = os.path.join(tw, 'editor', 'apps', 'studio')
    embed_ts = open(os.path.join(studio, 'src', 'app3Embed.ts'), encoding='utf-8').read()
    version = re.search(r"APP3_EMBED_VERSION = '([\d.]+)'", embed_ts).group(1)
    served_rel = f'three-workspace-app/editor/apps/studio/public/animation-studio/v{version}/index.html'
    ok = True

    base = subprocess.run(['git', 'show', f'{a.base_ref}:{served_rel}'], cwd=root, capture_output=True)
    if base.returncode != 0:
        print(f'FAIL baseline: {served_rel} not in {a.base_ref}'); return 1
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix='.html'); tmp.write(base.stdout); tmp.close()

    cmd = ['node', 'scripts/embed-app3.mjs', '--version', version, '--force'] + (['--allow-dirty'] if a.allow_dirty else [])
    r = run(cmd, studio)
    print(r.stdout[-1500:])
    if r.returncode != 0:
        print('FAIL embed (commit the App 3 source first, or pass --allow-dirty)'); return 1
    print(f'PASS embed v{version}')

    r = run(['node', 'tools/check-features.mjs', tmp.name, os.path.join(root, served_rel)], os.path.join(tw, 'animation-studio'))
    print(r.stdout[-1200:])
    print(('PASS' if r.returncode == 0 else 'FAIL') + ' check-features (no App 3 element id lost)')
    ok &= r.returncode == 0
    os.unlink(tmp.name)

    if not a.skip_tests:
        src = os.path.join(tw, 'animation-studio', 'work', 'material_alpha_v1_31_8', 'src')
        tests = [t for t in UNIT_TESTS if os.path.exists(os.path.join(src, t))]
        r = run(['node', '--test'] + tests, src)
        tail = [l for l in r.stdout.splitlines() if l.startswith(('ℹ pass', 'ℹ fail', 'not ok'))]
        print('\n'.join(tail))
        print(('PASS' if r.returncode == 0 else 'FAIL') + ' App 3 unit tests')
        ok &= r.returncode == 0
        editor = os.path.join(tw, 'editor')
        test = os.path.join(studio, 'test', 'app3Embed.test.ts').replace('\\', '/')
        r = run(f'pnpm --filter @topview/3d-builder exec tsx --test "{test}"', editor, shell=True)
        tail = [l for l in r.stdout.splitlines() if l.startswith(('ℹ pass', 'ℹ fail', 'not ok'))]
        print('\n'.join(tail))
        print(('PASS' if r.returncode == 0 else 'FAIL') + ' app3Embed (README hashes)')
        ok &= r.returncode == 0

    print('ALL PASS' if ok else 'SOME FAILED')
    print(f'Files to commit: three-workspace-app/editor/apps/studio/public/animation-studio/v{version}/ (index.html, host-bridge.js, README.md)')
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
