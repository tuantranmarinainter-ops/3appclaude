"""Extract only native model BOBJs into a NEW external directory; no mesh in Git."""
import argparse
from pathlib import Path
from zipfile import ZipFile


def extract(jar, destination):
    destination = Path(destination).resolve()
    repo = Path(__file__).resolve().parents[2]
    if destination == repo or repo in destination.parents:
        raise ValueError('Models must remain outside the repository')
    if destination.exists():
        raise ValueError('Destination must be new')
    with ZipFile(jar) as archive:
        entries = [i for i in archive.infolist() if i.filename.startswith('assets/emoticons/models/entity/') and i.filename.endswith('.bobj')]
        if not entries:
            raise ValueError('No Emoticons entity models found')
        names = [Path(i.filename).name for i in entries]
        if len(names) != len(set(names)) or any(i.file_size > 32 * 1024 * 1024 for i in entries):
            raise ValueError('Duplicate names or oversized model')
        destination.mkdir(parents=True)
        for info, name in zip(entries, names):
            (destination / name).write_bytes(archive.read(info))
    return names


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--jar', required=True)
    parser.add_argument('--out', required=True)
    args = parser.parse_args()
    print('\n'.join(extract(args.jar, args.out)))
