"""Create an experimental local derivative; never edits the downloaded source jar."""
import argparse
import hashlib
import io
import json
from pathlib import Path
import zipfile

CONFIG = 'META-INF/jars/forgeconfigapiport-fabric-8.0.0.jar'
MAX_SIZE = 256 * 1024 * 1024


def patch(source, output, expected_sha256):
    source, output = Path(source), Path(output)
    if source.resolve() == output.resolve() or output.exists():
        raise ValueError('Output must be a new file, separate from the source')
    if source.stat().st_size > MAX_SIZE:
        raise ValueError('Input too large')
    raw = source.read_bytes()
    before = hashlib.sha256(raw).hexdigest()
    if before != expected_sha256.lower():
        raise ValueError('Source SHA-256 mismatch')
    with zipfile.ZipFile(io.BytesIO(raw)) as jar:
        names = jar.namelist()
        if len(names) != len(set(names)) or sum(i.file_size for i in jar.infolist()) > MAX_SIZE:
            raise ValueError('Duplicate entries or excessive expanded size')
        if any(n.upper().startswith('META-INF/') and n.upper().endswith(('.SF', '.RSA', '.DSA', '.EC')) for n in names):
            raise ValueError('Signed jar cannot be patched')
        meta = json.loads(jar.read('fabric.mod.json'))
        if (meta.get('id'), meta.get('version')) != ('aaa_particles', '2.2.3'):
            raise ValueError('Only AAA Fabric 2.2.3 is supported')
        entries = meta.get('jars', [])
        if sum(e.get('file') == CONFIG for e in entries) != 1 or CONFIG not in names:
            raise ValueError('Expected nested config jar missing or ambiguous')
        with zipfile.ZipFile(io.BytesIO(jar.read(CONFIG))) as nested:
            config_meta = json.loads(nested.read('fabric.mod.json'))
        if (config_meta.get('id'), config_meta.get('version')) != ('forgeconfigapiport', '8.0.0'):
            raise ValueError('Unexpected nested config identity')
        meta['jars'] = [e for e in entries if e.get('file') != CONFIG]
        meta.get('depends', {}).pop('forgeconfigapiport', None)
        result = io.BytesIO()
        with zipfile.ZipFile(result, 'w') as target:
            target.comment = jar.comment
            for info in jar.infolist():
                if info.filename != CONFIG:
                    data = json.dumps(meta, ensure_ascii=False, indent=2).encode() + b'\n' if info.filename == 'fabric.mod.json' else jar.read(info)
                    target.writestr(info, data)
    # Exclusive creation prevents overwriting even if another process creates the path.
    try:
        with output.open('xb') as target:
            target.write(result.getvalue())
    except FileExistsError:
        raise ValueError('Output already exists') from None
    return {'sourceSha256': before, 'outputSha256': hashlib.sha256(result.getvalue()).hexdigest(),
            'removed': [CONFIG], 'runtimeStatus': 'NOT_RUN'}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source')
    parser.add_argument('output')
    parser.add_argument('--expected-sha256', required=True)
    args = parser.parse_args()
    try:
        print(json.dumps(patch(args.source, args.output, args.expected_sha256), indent=2))
    except (ValueError, OSError, KeyError, zipfile.BadZipFile) as error:
        parser.exit(1, f'Patch refused: {error}\n')
