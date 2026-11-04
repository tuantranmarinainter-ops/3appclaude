"""Test lõi cài/gỡ phim: chạy `python -m unittest test_installer_core` trong thư mục này."""
import gzip
import io
import json
import os
import tempfile
import unittest
import zipfile
from pathlib import Path

import installer_core as core

MODEL = 'assets/models/unified/aaaa-bbbb/model.bobj'
TEXTURE = 'assets/models/unified/aaaa-bbbb/textures/Body/default.png'


def make_zip(folder: Path, name='Film.zip', film='Film.dat', film_text=b'BBS1\x00\x11unified/aaaa-bbbb', extra=None, required=None) -> Path:
    path = folder / name
    with zipfile.ZipFile(path, 'w') as z:
        z.writestr('README.txt', 'doc')
        z.writestr('required-mods.json', json.dumps(required or {'schemaVersion': 1, 'requiredMods': ['BBS FS 2.7'], 'includedEffectCount': 0}))
        z.writestr(f'films/{film}', gzip.compress(film_text))
        z.writestr(MODEL, b'model-bytes')
        z.writestr(TEXTURE, b'png-bytes')
        for k, v in (extra or {}).items():
            z.writestr(k, v)
    return path


def make_game(folder: Path, worlds=('World A', 'World B')) -> Path:
    game = folder / 'game'
    (game / 'mods').mkdir(parents=True)
    for w in worlds:
        (game / 'saves' / w).mkdir(parents=True)
        (game / 'saves' / w / 'level.dat').write_bytes(b'x')
    (game / 'saves' / 'no-level').mkdir()
    return game


def add_mod(game: Path, mod_id: str, version: str) -> None:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w') as z:
        z.writestr('fabric.mod.json', json.dumps({'id': mod_id, 'version': version}))
    (game / 'mods' / f'{mod_id}.jar').write_bytes(buf.getvalue())


class CoreTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)
        self.game = make_game(self.dir)

    def tearDown(self):
        self.tmp.cleanup()

    def test_worlds_and_root_detection(self):
        self.assertEqual(core.list_worlds(self.game), ['World A', 'World B'])
        nested = self.game / 'saves' / 'World A'
        self.assertEqual(core.canonical_game_dir(str(nested)), self.game.resolve())

    def test_install_plan_install_skip_conflict(self):
        pkg = core.read_package(str(make_zip(self.dir)))
        self.assertEqual(pkg.films, ['Film.dat'])
        self.assertFalse(pkg.requires_effects)
        root = core.canonical_game_dir(str(self.game))
        plan = core.plan_install(pkg, root, 'World A')
        self.assertEqual({r.target for r in plan.rows}, {'saves/World A/bbs/films/Film.dat', 'config/bbs/' + MODEL, 'config/bbs/' + TEXTURE})
        self.assertEqual(plan.count('install'), 3)
        result = core.apply_install(plan)
        self.assertEqual(len(result.installed), 3)
        self.assertTrue((root / 'saves/World A/bbs/films/Film.dat').is_file())
        # cài lại: mọi file cùng nội dung -> bỏ qua
        again = core.plan_install(pkg, root, 'World A')
        self.assertEqual(again.count('skip'), 3)
        # file khác nội dung -> xung đột, không ghi đè
        (root / 'config/bbs' / MODEL).write_bytes(b'changed')
        third = core.plan_install(pkg, root, 'World A')
        self.assertEqual(third.count('conflict'), 1)
        res = core.apply_install(third)
        self.assertEqual(res.conflicts, ['config/bbs/' + MODEL])
        self.assertEqual((root / 'config/bbs' / MODEL).read_bytes(), b'changed')

    def test_log_format_matches_app2(self):
        root = core.canonical_game_dir(str(self.game))
        core.apply_install(core.plan_install(core.read_package(str(make_zip(self.dir))), root, 'World A'))
        log = json.loads((root / 'config/bbs/w01-install-log.json').read_text('utf8'))
        self.assertEqual(log['version'], 1)
        entry = log['installs'][0]
        self.assertEqual(set(entry), {'installId', 'installedAt', 'packageName', 'packageSha256', 'ownedFiles'})
        self.assertRegex(entry['installedAt'], r'^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$')
        self.assertTrue(all(core.safe_owned_path(f['path']) for f in entry['ownedFiles']))

    def test_uninstall_keeps_assets_used_by_other_film(self):
        root = core.canonical_game_dir(str(self.game))
        first = core.apply_install(core.plan_install(core.read_package(str(make_zip(self.dir))), root, 'World A'))
        other = make_zip(self.dir, name='Other.zip', film='Other.dat')
        core.apply_install(core.plan_install(core.read_package(str(other)), root, 'World B'))
        res = core.uninstall(root, first.install_id)
        self.assertEqual(res.removed, ['saves/World A/bbs/films/Film.dat'])
        self.assertEqual(sorted(res.in_use), sorted(['config/bbs/' + MODEL, 'config/bbs/' + TEXTURE]))
        self.assertTrue((root / 'config/bbs' / MODEL).is_file())
        # còn lại phim Other; gỡ nó thì asset được dọn hết (quyền sở hữu đã chuyển sang)
        last = core.list_installs(root)
        self.assertEqual(len(last), 1)
        res2 = core.uninstall(root, last[0].install_id)
        self.assertIn('config/bbs/' + MODEL, res2.removed)
        self.assertFalse((root / 'config/bbs' / MODEL).exists())
        self.assertEqual(core.list_installs(root), [])

    def test_uninstall_preserves_edited_files(self):
        root = core.canonical_game_dir(str(self.game))
        res = core.apply_install(core.plan_install(core.read_package(str(make_zip(self.dir))), root, 'World A'))
        (root / 'saves/World A/bbs/films/Film.dat').write_bytes(b'edited in game')
        out = core.uninstall(root, res.install_id)
        self.assertIn('saves/World A/bbs/films/Film.dat', out.preserved)
        self.assertTrue((root / 'saves/World A/bbs/films/Film.dat').exists())

    def test_rejects_unsafe_zip(self):
        bad = self.dir / 'bad.zip'
        with zipfile.ZipFile(bad, 'w') as z:
            z.writestr('films/../../evil.dat', b'x')
        with self.assertRaises(core.InstallError):
            core.read_package(str(bad))
        empty = self.dir / 'empty.zip'
        with zipfile.ZipFile(empty, 'w') as z:
            z.writestr('README.txt', b'x')
        with self.assertRaises(core.InstallError):
            core.read_package(str(empty))

    def test_effects_require_aaa(self):
        pkg = core.read_package(str(make_zip(self.dir, extra={'assets/effeks/aaa/fx.efkefc': b'fx'})))
        self.assertTrue(pkg.requires_effects)
        root = core.canonical_game_dir(str(self.game))
        add_mod(self.game, 'bbs', '2.7')
        check = core.check_mods(root, pkg)
        self.assertFalse(check.ok)
        add_mod(self.game, 'aaa_particles', '2.2.3')
        add_mod(self.game, 'bbs-aaaddon', '2.0')
        self.assertTrue(core.check_mods(root, pkg).ok)

    def test_mod_check_bbs_version(self):
        pkg = core.read_package(str(make_zip(self.dir)))
        root = core.canonical_game_dir(str(self.game))
        self.assertFalse(core.check_mods(root, pkg).ok)
        add_mod(self.game, 'bbs', '2.7-1.20.1')
        self.assertTrue(core.check_mods(root, pkg).ok)

    def test_minecraft_version(self):
        root = core.canonical_game_dir(str(self.game))
        pkg = core.read_package(str(make_zip(self.dir)))
        add_mod(self.game, 'bbs', '2.7-1.20.1')
        check = core.check_mods(root, pkg)
        self.assertEqual(check.lines[0], (True, 'Minecraft 1.20.1'))
        (self.game / 'versions' / '1.19.2-forge-43.2.0').mkdir(parents=True)
        bad = core.check_mods(root, pkg)
        self.assertFalse(bad.ok)
        self.assertIn('1.19.2', bad.lines[0][1])

    def test_unknown_version_does_not_block(self):
        root = core.canonical_game_dir(str(self.game))
        pkg = core.read_package(str(make_zip(self.dir)))
        add_mod(self.game, 'bbs', '2.7')
        check = core.check_mods(root, pkg)
        self.assertIsNone(check.lines[0][0])
        self.assertTrue(check.ok)

    def test_reference_key(self):
        self.assertEqual(core.asset_reference_key('models/unified/ab-cd/textures/x/default.png'), 'unified/ab-cd')
        self.assertEqual(core.asset_reference_key('effeks/aaa/fx.efkefc'), 'effeks/aaa')

    @unittest.skipUnless(os.environ.get('FI_REAL_ZIP'), 'đặt FI_REAL_ZIP=<gói thật xuất từ App 2>')
    def test_real_package(self):
        pkg = core.read_package(os.environ['FI_REAL_ZIP'])
        root = core.canonical_game_dir(str(self.game))
        res = core.apply_install(core.plan_install(pkg, root, 'World A'))
        self.assertEqual(len(res.installed), len(pkg.files))
        out = core.uninstall(root, res.install_id)
        self.assertEqual(sorted(out.removed), sorted(res.installed))


if __name__ == '__main__':
    unittest.main()
