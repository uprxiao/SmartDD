"""Verify the supplemental package, optionally unpack to a new directory."""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import shutil
import tarfile
import tempfile


def sha(path):
    with path.open('rb') as f:
        return hashlib.file_digest(f, 'sha256').hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--extract', type=Path, help='new destination; must not already exist')
    args = parser.parse_args()
    base = Path(__file__).resolve().parent
    index = json.loads((base / 'package-index.json').read_text())
    for row in index['files']:
        p = base / row['path']
        if p.stat().st_size != row['bytes'] or sha(p) != row['sha256']:
            raise ValueError('Package hash mismatch: ' + row['path'])
    manifest = json.loads((base / 'collection-manifest.json').read_text())
    expected = {row['path']: row for row in manifest['files']}
    with tempfile.TemporaryFile() as combined:
        for name in index['archive']['parts']:
            with (base / name).open('rb') as part:
                shutil.copyfileobj(part, combined)
        combined.seek(0)
        if hashlib.file_digest(combined, 'sha256').hexdigest() != index['archive']['sha256']:
            raise ValueError('Combined archive hash mismatch')
        combined.seek(0)
        seen = {}
        with tarfile.open(fileobj=combined, mode='r:gz') as archive:
            for member in archive:
                name = PurePosixPath(member.name)
                if name.is_absolute() or '..' in name.parts or name.parts[0] != 'tmp':
                    raise ValueError('Unsafe archive path')
                if member.name not in expected or member.name in seen:
                    raise ValueError('Unexpected or duplicate archive member: ' + member.name)
                if member.islnk():
                    if member.linkname not in seen:
                        raise ValueError('Invalid archive hardlink')
                    digest, size = seen[member.linkname]
                elif member.isfile():
                    with archive.extractfile(member) as data:
                        digest = hashlib.file_digest(data, 'sha256').hexdigest()
                    size = member.size
                else:
                    raise ValueError('Unsupported archive entry')
                row = expected[member.name]
                if digest != row['sha256'] or size != row['bytes'] or member.mode != int(row['mode'], 8):
                    raise ValueError('Member hash/size/mode mismatch: ' + member.name)
                seen[member.name] = (digest, size)
        if seen.keys() != expected.keys():
            raise ValueError('Missing archive members')
        if args.extract:
            destination = args.extract.resolve()
            destination.mkdir(parents=True, exist_ok=False)
            combined.seek(0)
            with tarfile.open(fileobj=combined, mode='r:gz') as archive:
                archive.extractall(destination, filter='data')
            for row in manifest['files']:
                p = destination / row['path']
                if sha(p) != row['sha256']:
                    raise ValueError('Extracted file mismatch: ' + row['path'])
            for directory in ['bin', 'deps']:
                shutil.copytree(base / directory, destination / directory)
            shutil.copy2(base / 'env.txt', destination / 'env.txt')
    print(json.dumps({'packageFilesVerified': len(index['files']), 'archiveFilesVerified': len(seen), 'extracted': str(args.extract) if args.extract else None}))


if __name__ == '__main__':
    main()
