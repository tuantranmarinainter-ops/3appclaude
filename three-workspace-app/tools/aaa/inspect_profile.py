"""Read-only inventory of user-selected jars. Does not certify compatibility."""
import argparse
import hashlib
import json
from pathlib import Path
import zipfile


def inspect(path):
    path = Path(path)
    if path.stat().st_size > 256 * 1024 * 1024:
        raise ValueError('Jar exceeds inspection size limit')
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    with zipfile.ZipFile(path) as jar:
        metadata = {}
        for name in ('fabric.mod.json', 'META-INF/mods.toml', 'META-INF/jarjar/metadata.json'):
            if name in jar.namelist():
                info = jar.getinfo(name)
                if info.file_size > 1024 * 1024:
                    raise ValueError('Metadata exceeds size limit')
                metadata[name] = jar.read(name).decode('utf-8')
    return {'file': path.name, 'sha256': digest, 'metadata': metadata, 'runtimeStatus': 'NOT_RUN'}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('jars', nargs='+')
    args = parser.parse_args()
    print(json.dumps([inspect(path) for path in args.jars], indent=2))
