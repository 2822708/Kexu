"""Stage only verified public native packages and installation guides for GitHub Releases."""
import argparse
import hashlib
import json
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def prepare(destination, tag):
    config = json.loads((ROOT / 'deployment/release-current.json').read_text('utf-8'))
    if tag != config['tag']:
        raise ValueError('Tag does not match the reviewed release catalog')
    directory = (ROOT / config['directory']).resolve()
    if not directory.is_relative_to(ROOT / 'releases/native'):
        raise ValueError('Release directory must remain under releases/native')
    manifest_bytes = (directory / 'RELEASE_MANIFEST.json').read_bytes()
    manifest = json.loads(manifest_bytes)
    if manifest['product'] != 'Kexu':
        raise ValueError('Unexpected product')
    if 'v' + manifest['android']['versionName'] != tag:
        raise ValueError('APK version and release tag differ')
    assets = {}
    for name in (config['apk'], config['windows']):
        if Path(name).name != name:
            raise ValueError('Asset names must be plain filenames')
        record = next(entry for entry in manifest['artifacts'] if entry['path'] == name)
        data = (directory / name).read_bytes()
        if len(data) != record['bytes'] or sha256(data) != record['sha256']:
            raise ValueError('Artifact size/hash mismatch: ' + name)
        with zipfile.ZipFile(directory / name) as archive:
            if archive.testzip() is not None:
                raise ValueError('Corrupt APK/ZIP: ' + name)
            for member in archive.namelist():
                parts = member.replace('\\', '/').split('/')
                if '..' in parts or member.startswith(('/', '\\')):
                    raise ValueError('Unsafe archive member')
                if any(part.lower() in ('data', 'private', 'node_modules', '.git') for part in parts):
                    raise ValueError('Private/build data in release')
                if member.lower().endswith(('.jks', '.keystore', '.pfx', '.p12', '.mv.db', 'signing.properties', 'kexu-data-dir.txt')):
                    raise ValueError('Private material in release')
            if name == config['windows']:
                executable = 'Kexu-Windows-x64/Kexu.exe'
                expected = next(entry for entry in manifest['artifacts'] if entry['path'] == executable)
                if sha256(archive.read(executable)) != expected['sha256']:
                    raise ValueError('Windows executable hash mismatch')
        assets[name] = data
    assets['RELEASE_MANIFEST.json'] = manifest_bytes
    assets['Kexu-Install.html'] = (ROOT / 'docs/install/index.html').read_bytes()
    assets['INSTALL.md'] = (ROOT / 'docs/install/README.md').read_bytes()
    if not (ROOT / config['notes']).is_file():
        raise ValueError('Missing release notes')
    destination = Path(destination).resolve()
    if destination.exists():
        raise ValueError('Existing staging directory preserved; choose a new directory')
    destination.mkdir(parents=True)
    for name, data in assets.items():
        (destination / name).write_bytes(data)
    (destination / 'SHA256SUMS.txt').write_text(
        ''.join(f'{sha256(data)}  {name}\n' for name, data in sorted(assets.items())),
        encoding='ascii', newline='\n')
    print(json.dumps({'tag': tag, 'assets': [*sorted(assets), 'SHA256SUMS.txt'],
                      'directory': str(destination)}, ensure_ascii=False))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('destination')
    parser.add_argument('--tag', required=True)
    args = parser.parse_args()
    prepare(args.destination, args.tag)
