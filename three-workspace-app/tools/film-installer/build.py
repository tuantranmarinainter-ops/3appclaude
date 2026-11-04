"""Đóng gói "Import ZIP to BBS FS Tool.exe" (1 file, không cần cài Python): python build.py [--out <thư mục>]

Cần: pip install pyinstaller. Mặc định ra `dist/Import ZIP to BBS FS Tool.exe` cạnh file này (dist/ và build/ không commit).
"""
import argparse
import subprocess
import sys
from pathlib import Path

here = Path(__file__).resolve().parent
parser = argparse.ArgumentParser()
parser.add_argument('--out', default=str(here / 'dist'))
args = parser.parse_args()
work = Path(args.out).parent / 'build-film-installer'
cmd = [sys.executable, '-m', 'PyInstaller', '--noconfirm', '--clean', '--onefile', '--windowed', '--name', 'Import ZIP to BBS FS Tool',
       '--distpath', args.out, '--workpath', str(work), '--specpath', str(work),
       '--paths', str(here), '--hidden-import', 'installer_core', str(here / 'film_installer.pyw')]
sys.exit(subprocess.call(cmd))
