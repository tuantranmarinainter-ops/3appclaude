from pathlib import Path
import tempfile
import unittest
import zipfile
from inspect_profile import inspect


class InventoryTests(unittest.TestCase):
    def test_reads_metadata_and_hash_without_mutating(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / 'test.jar'
            with zipfile.ZipFile(path, 'w') as jar:
                jar.writestr('fabric.mod.json', '{"id":"synthetic"}')
            before = path.read_bytes()
            result = inspect(path)
            self.assertEqual(path.read_bytes(), before)
            self.assertEqual(result['runtimeStatus'], 'NOT_RUN')
            self.assertEqual(len(result['sha256']), 64)
            self.assertEqual(result['metadata']['fabric.mod.json'], '{"id":"synthetic"}')


if __name__ == '__main__':
    unittest.main()
