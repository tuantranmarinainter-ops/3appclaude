#!/usr/bin/env python3
"""Add a B<n> row to the W01 backlog table (docs/BACKLOG-2026-10-25.md) safely.

Why a script: rows are long Vietnamese markdown with backslashes and pipes; writing them through shell heredocs
mangles `\\` on this machine and hand-picked numbers collide between sessions. This picks the next free number,
escapes pipes, keeps the file's line endings (CRLF/LF) and inserts right after the current highest B row.

Usage:
  python backlog_add.py --problem "..." --fix "..." [--source "Người dùng 2026-11-03, ..."] [--file PATH] [--dry-run]
  python backlog_add.py --problem-file p.md --fix-file f.md
  python backlog_add.py --list            # show the last 5 rows' numbers and first words
Prints the new code (e.g. B74) on success.
"""
import argparse
import io
import os
import re
import subprocess
import sys

DEFAULT_REL = os.path.join('docs', 'BACKLOG-2026-10-25.md')
ROW = re.compile(r'^\| B(\d+) \|')


def repo_root() -> str:
    try:
        return subprocess.run(['git', 'rev-parse', '--show-toplevel'], capture_output=True, text=True, check=True).stdout.strip()
    except Exception:
        return os.getcwd()


def cell(text: str) -> str:
    # A table cell is one line; pipes would split the cell.
    return ' '.join(text.replace('|', '\\|').split())


def main() -> int:
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
    ap = argparse.ArgumentParser()
    ap.add_argument('--file', default=None)
    ap.add_argument('--problem')
    ap.add_argument('--problem-file')
    ap.add_argument('--fix')
    ap.add_argument('--fix-file')
    ap.add_argument('--source', default=None, help='italic prefix, e.g. "Người dùng 2026-11-03, test bản 3050."')
    ap.add_argument('--list', action='store_true')
    ap.add_argument('--dry-run', action='store_true')
    a = ap.parse_args()

    path = a.file or os.path.join(repo_root(), DEFAULT_REL)
    raw = open(path, encoding='utf-8', newline='').read()
    nl = '\r\n' if '\r\n' in raw else '\n'
    lines = raw.split(nl)
    rows = [(int(m.group(1)), i) for i, line in enumerate(lines) if (m := ROW.match(line))]
    if not rows:
        print('Không tìm thấy bảng B<n> trong ' + path, file=sys.stderr)
        return 2
    if a.list:
        for n, i in sorted(rows)[-5:]:
            print(f'B{n}: {lines[i][:110]}')
        return 0

    problem = open(a.problem_file, encoding='utf-8').read() if a.problem_file else a.problem
    fix = open(a.fix_file, encoding='utf-8').read() if a.fix_file else a.fix
    if not problem or not fix:
        print('Cần --problem/--problem-file và --fix/--fix-file', file=sys.stderr)
        return 2
    last_n, last_i = max(rows)
    code = f'B{last_n + 1}'
    prefix = f'*({cell(a.source)})* ' if a.source else ''
    row = f'| {code} | {prefix}{cell(problem)} | {cell(fix)} |'
    if a.dry_run:
        print(row)
        return 0
    lines.insert(last_i + 1, row)
    open(path, 'w', encoding='utf-8', newline='').write(nl.join(lines))
    print(code)
    return 0


if __name__ == '__main__':
    sys.exit(main())
