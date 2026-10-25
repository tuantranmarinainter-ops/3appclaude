"""Portable synthetic ZIP tests; no Emoticons mesh or binary fixture is committed."""
import importlib.util
from pathlib import Path
import tempfile
import unittest
from zipfile import ZipFile

spec = importlib.util.spec_from_file_location('extract_emoticons', Path(__file__).with_name('extract-emoticons-models.py'))
extractor = importlib.util.module_from_spec(spec)
spec.loader.exec_module(extractor)


class ExtractionTests(unittest.TestCase):
    def test_whitelist_and_new_external_directory(self):
        with tempfile.TemporaryDirectory() as directory:
            jar, out = Path(directory) / 'synthetic.jar', Path(directory) / 'out'
            with ZipFile(jar, 'w') as archive:
                archive.writestr('assets/emoticons/models/entity/default.bobj', 'synthetic-only')
                archive.writestr('unrelated/file', 'ignored')
            self.assertEqual(extractor.extract(jar, out), ['default.bobj'])
            self.assertEqual((out / 'default.bobj').read_text(), 'synthetic-only')
            with self.assertRaises(ValueError):
                extractor.extract(jar, out)

    def test_unsafe_basename_never_writes(self):
        with tempfile.TemporaryDirectory() as directory:
            jar, out = Path(directory) / 'synthetic.jar', Path(directory) / 'out'
            with ZipFile(jar, 'w') as archive:
                archive.writestr('assets/emoticons/models/entity/C:unsafe.bobj', 'synthetic-only')
            with self.assertRaises(ValueError):
                extractor.extract(jar, out)
            self.assertFalse(out.exists())


if __name__ == '__main__':
    unittest.main()
