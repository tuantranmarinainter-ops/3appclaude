#!/usr/bin/env python3
"""GitHub pull requests without the `gh` CLI (not installed on this machine).

The token comes from `git credential fill` for github.com, so nothing is stored or printed. The repository is read
from `git remote get-url origin`.

  python gh_pr.py open  --head BRANCH --title "..." --body-file body.md [--base main]
  python gh_pr.py info  N [N ...]          # state, merged, mergeable, head -> base
  python gh_pr.py list  [--state open]     # number, head -> base, title
  python gh_pr.py base  N BRANCH           # retarget a PR (stacked PRs: move to main before merging)
  python gh_pr.py merge N [N ...] [--method merge|squash|rebase]
  python gh_pr.py stack N1 N2 ...          # merge a stacked chain in order, retargeting each later PR to main first
"""
import argparse
import io
import json
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request


def repo_slug() -> str:
    url = subprocess.run(['git', 'remote', 'get-url', 'origin'], capture_output=True, text=True, check=True).stdout.strip()
    m = re.search(r'github\.com[:/](.+?)(?:\.git)?$', url)
    if not m:
        sys.exit('origin is not a GitHub remote: ' + url)
    return m.group(1)


def token() -> str:
    out = subprocess.run(['git', 'credential', 'fill'], input='protocol=https\nhost=github.com\n\n',
                         capture_output=True, text=True, check=True).stdout
    values = dict(line.split('=', 1) for line in out.splitlines() if '=' in line)
    if 'password' not in values:
        sys.exit('No GitHub credential from git credential fill')
    return values['password']


class Api:
    def __init__(self):
        self.base = 'https://api.github.com/repos/' + repo_slug()
        self.tok = token()

    def call(self, method, path, data=None):
        req = urllib.request.Request(self.base + path, method=method,
                                     data=json.dumps(data).encode() if data is not None else None,
                                     headers={'Authorization': 'Bearer ' + self.tok, 'Accept': 'application/vnd.github+json'})
        try:
            return json.load(urllib.request.urlopen(req))
        except urllib.error.HTTPError as e:
            return {'error': e.code, 'message': e.read().decode(errors='replace')[:400]}

    def pr(self, n):
        # `mergeable` is computed lazily; ask again briefly when GitHub has not decided yet.
        for _ in range(5):
            p = self.call('GET', f'/pulls/{n}')
            if p.get('error') or p.get('mergeable') is not None or p.get('state') != 'open':
                return p
            time.sleep(2)
        return p


def show(p):
    if p.get('error'):
        return f"ERROR {p['error']}: {p.get('message')}"
    return f"#{p['number']} {p['state']} merged={p.get('merged')} mergeable={p.get('mergeable')} ({p.get('mergeable_state')}) {p['head']['ref']} -> {p['base']['ref']} · {p['title']}"


def main():
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest='cmd', required=True)
    o = sub.add_parser('open'); o.add_argument('--head', required=True); o.add_argument('--title', required=True)
    o.add_argument('--body-file', required=True); o.add_argument('--base', default='main')
    i = sub.add_parser('info'); i.add_argument('n', nargs='+', type=int)
    l = sub.add_parser('list'); l.add_argument('--state', default='open')
    b = sub.add_parser('base'); b.add_argument('n', type=int); b.add_argument('branch')
    m = sub.add_parser('merge'); m.add_argument('n', nargs='+', type=int); m.add_argument('--method', default='merge')
    s = sub.add_parser('stack'); s.add_argument('n', nargs='+', type=int); s.add_argument('--method', default='merge')
    a = ap.parse_args()
    api = Api()

    if a.cmd == 'open':
        body = open(a.body_file, encoding='utf-8').read()
        r = api.call('POST', '/pulls', {'title': a.title, 'head': a.head, 'base': a.base, 'body': body})
        print(f"#{r['number']} {r['html_url']}" if 'number' in r else f"ERROR {r.get('error')}: {r.get('message')}")
    elif a.cmd == 'info':
        for n in a.n:
            print(show(api.pr(n)))
    elif a.cmd == 'list':
        for p in api.call('GET', f'/pulls?state={a.state}&per_page=100'):
            print(f"#{p['number']} {p['head']['ref']} -> {p['base']['ref']} · {p['title']}")
    elif a.cmd == 'base':
        r = api.call('PATCH', f'/pulls/{a.n}', {'base': a.branch})
        print(show(r))
    elif a.cmd in ('merge', 'stack'):
        for n in a.n:
            p = api.pr(n)
            if p.get('merged'):
                print(f'#{n} already merged'); continue
            if a.cmd == 'stack' and p.get('base', {}).get('ref') != 'main':
                api.call('PATCH', f'/pulls/{n}', {'base': 'main'})
                p = api.pr(n)
            if p.get('mergeable') is False:
                print(f'#{n} NOT mergeable (conflict) — stop'); return 1
            r = api.call('PUT', f'/pulls/{n}/merge', {'merge_method': a.method})
            print(f"#{n} merged={r.get('merged')} {r.get('message', '')}")
            if not r.get('merged'):
                return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
