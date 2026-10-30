"""Verify immutable published assets against hashes reviewed in source control."""
import argparse
import hashlib
import json
import zipfile
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('directory', type=Path)
parser.add_argument('--tag', required=True)
args = parser.parse_args()
catalog = json.loads((Path(__file__).resolve().parents[1] / 'deployment/release-current.json').read_text('utf-8'))
if args.tag != catalog['tag']:
    raise ValueError('Tag does not match the reviewed release catalog')
expected = catalog['publishedAssets']
if {p.name for p in args.directory.iterdir()} != set(expected):
    raise ValueError('Published asset set differs from reviewed catalog')
for name, digest in expected.items():
    if Path(name).name != name:
        raise ValueError('Invalid asset filename')
    path = args.directory / name
    if hashlib.sha256(path.read_bytes()).hexdigest() != digest:
        raise ValueError('Published asset SHA256 mismatch: ' + name)
    if path.suffix in ('.apk', '.zip'):
        with zipfile.ZipFile(path) as archive:
            if archive.testzip() is not None:
                raise ValueError('Corrupt archive: ' + name)
    print('PASS:', name)
