import hashlib
import io
import json
from pathlib import Path
import tempfile
import unittest
import zipfile
from patch_config_port import CONFIG, patch


class PatchTests(unittest.TestCase):
    def fixture(self, root, *, signed=False, identity='aaa_particles', duplicate=False):
        nested = io.BytesIO()
        with zipfile.ZipFile(nested, 'w') as z:
            z.writestr('fabric.mod.json', json.dumps({'id': 'forgeconfigapiport', 'version': '8.0.0'}))
        source = root / 'source.jar'
        with zipfile.ZipFile(source, 'w') as z:
            z.writestr('fabric.mod.json', json.dumps({'id': identity, 'version': '2.2.3',
                'jars': [{'file': CONFIG}, {'file': 'META-INF/jars/keep.jar'}],
                'depends': {'forgeconfigapiport': '*', 'fabric': '*'}}))
            z.writestr(CONFIG, nested.getvalue())
            z.writestr('META-INF/jars/keep.jar', b'unchanged')
            z.writestr('LICENSE', b'unchanged license')
            if signed:
                z.writestr('META-INF/SIGN.SF', b'signature')
            if duplicate:
                z.writestr('LICENSE', b'duplicate')
        return source, hashlib.sha256(source.read_bytes()).hexdigest()

    def test_narrow_removal_preserves_source_and_other_payloads(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); source, digest = self.fixture(root); original = source.read_bytes()
            output = root / 'patched.jar'; report = patch(source, output, digest)
            self.assertEqual(source.read_bytes(), original)
            self.assertEqual(report['runtimeStatus'], 'NOT_RUN')
            with zipfile.ZipFile(output) as z:
                self.assertNotIn(CONFIG, z.namelist())
                self.assertEqual(z.read('LICENSE'), b'unchanged license')
                self.assertEqual(z.read('META-INF/jars/keep.jar'), b'unchanged')
                meta = json.loads(z.read('fabric.mod.json'))
                self.assertEqual(meta['depends'], {'fabric': '*'})
                self.assertEqual(meta['jars'], [{'file': 'META-INF/jars/keep.jar'}])

    def test_refuses_unsafe_inputs_without_output(self):
        for options in [{'signed': True}, {'identity': 'other'}, {'duplicate': True}, {}]:
            with self.subTest(options=options), tempfile.TemporaryDirectory() as temp:
                root = Path(temp); source, digest = self.fixture(root, **options); output = root / 'out.jar'
                with self.assertRaises(ValueError):
                    patch(source, output, digest if options else '0' * 64)
                self.assertFalse(output.exists())

    def test_refuses_in_place_and_existing_output(self):
        with tempfile.TemporaryDirectory() as temp:
            source, digest = self.fixture(Path(temp))
            with self.assertRaises(ValueError):
                patch(source, source, digest)
            output = Path(temp) / 'out.jar'; output.write_bytes(b'keep')
            with self.assertRaises(ValueError):
                patch(source, output, digest)
            self.assertEqual(output.read_bytes(), b'keep')


if __name__ == '__main__':
    unittest.main()
