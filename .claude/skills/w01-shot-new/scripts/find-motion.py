"""Find library motions a given shot character can actually use, and copy their packs into the sandbox library.

  python find-motion.py <shot.json> <charKey> "fly attack" "slam" [--rig auto] [--copy UUID ...]

Rules (learned in Tập 15):
  * Verity / "custom-preserved" characters (Gỗ Xưa) only take actions owned by their library character (ownerCharId),
    Mixamo65 actions fail with PROFILE_MISMATCH.
  * Minecraft20 characters (Hero, Đen…) take any minecraft20 action.
  * Mixamo65 characters take mixamo65 actions.
--copy copies the packs of the listed action UUIDs into shot.library (the sandbox library) so library.place works.
"""
import json, shutil, sys
from pathlib import Path

REAL_LIB = Path('S:/Claude/w01-library')


def main():
    sys.stdout.reconfigure(encoding='utf-8')
    args = sys.argv[1:]
    shot = json.loads(Path(args[0]).read_text(encoding='utf8'))
    key = args[1]
    copy = args[args.index('--copy') + 1:] if '--copy' in args else []
    words = [w.lower() for w in args[2:args.index('--copy') if '--copy' in args else len(args)] if not w.startswith('--')]
    index = json.loads((REAL_LIB / 'index.json').read_text(encoding='utf8'))
    packs = {p['packId']: p for p in index['packs']}
    proj = json.loads((Path(shot['projectsDir']) / shot['project'] / 'project.json').read_text(encoding='utf8'))
    ch = proj['characters'][shot['chars'][key]['char']]
    skel = proj['skeletons'].get(ch.get('skeletonId'), {})
    rig = (skel.get('rig') or skel.get('profile') or '').lower()
    name = ch.get('name', '')
    chars = index.get('characters', [])
    base = name.split('_')[0].strip()
    lib_char = next((c for c in chars if c.get('name') == base), None) or \
        max((c for c in chars if base.startswith(c.get('name', '~'))), key=lambda c: len(c['name']), default=None)
    owner = lib_char['charId'] if lib_char else None
    lib_rig = (lib_char or {}).get('rig', '')
    # Minecraft20 characters use minecraft20 actions; a mixamo-family character that owns actions (Gỗ Xưa, Verity rig
    # kept as custom-preserved) only accepts its own; others take mixamo65.
    custom = lib_rig != 'minecraft20' and any(x.get('ownerCharId') == owner for x in index['actions'])

    def usable(a):
        r = packs.get(a['packId'], {}).get('rig')
        if custom:
            return a.get('ownerCharId') == owner
        if lib_rig == 'minecraft20':
            return r == 'minecraft20'
        return r == 'mixamo65'
    if copy:
        dst = Path(shot['library']) / 'packs'
        for u in copy:
            a = next(x for x in index['actions'] if x['uuid'] == u)
            src = REAL_LIB / 'packs' / a['packId']
            if not (dst / a['packId']).exists():
                shutil.copytree(src, dst / a['packId'])
            print('copied pack', a['packId'], 'for', a['name'])
        return
    print(f"{key}: {name} | library character {owner} rig {lib_rig} | {'owned actions only (custom-preserved)' if custom else 'rig ' + (lib_rig or rig)}")
    rows = [a for a in index['actions'] if usable(a) and (not words or any(w in (a['name'] + ' ' + (a.get('nameVi') or '')).lower() for w in words))]
    for a in rows[:80]:
        print(f"{a['uuid']}  {a['durationSeconds']:.2f}s  {a['name']}  ({a.get('nameVi') or ''})  pack {a['packId']}")
    print(len(rows), 'matches')


if __name__ == '__main__':
    main()
