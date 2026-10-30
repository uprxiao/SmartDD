#!/usr/bin/env python3
"""Reproduce the reviewed, hash-locked TeX resources for an offline App helper.

This build-time preparation may download pinned public assets. The application
compiler never runs this script, downloads packages, or discovers a PATH engine.
"""
import argparse
import concurrent.futures
import hashlib
import json
import os
import pathlib
import platform
import shutil
import subprocess
import tarfile
import zipfile

REPO = pathlib.Path(__file__).resolve().parents[2]
EVIDENCE = REPO / 'docs/里程碑/M9_文件浏览工作区/验收/证据/predev-resources'
parser = argparse.ArgumentParser()
parser.add_argument('--cache', type=pathlib.Path, default=REPO / 'release/engine-cache/tex')
parser.add_argument('--output', type=pathlib.Path, default=REPO / 'out/native/tex')
parser.add_argument('--arch', choices=['arm64', 'x64'], default='arm64' if platform.machine() == 'arm64' else 'x64')
parser.add_argument('--offline', action='store_true')
args = parser.parse_args()
cache, output = args.cache.resolve(), args.output.resolve()
cache.mkdir(parents=True, exist_ok=True)
lock = json.loads((EVIDENCE / 'predev-tex-resource-manifest.json').read_text())
native = json.loads((EVIDENCE / 'predev-resources-native-sources.json').read_text())
arch = 'aarch64' if args.arch == 'arm64' else 'x86_64'
engine = next(item for item in native['tectonicOfficialAssets'] if item['name'] == f'tectonic-0.17.0-{arch}-apple-darwin.tar.gz')


def sha(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def fetch(url, path, size, expected=None, start=None):
    if path.exists() and path.stat().st_size == size and (expected is None or sha(path) == expected):
        return
    if args.offline:
        raise RuntimeError(f'Locked TeX resource missing or corrupt: {path.name}; run pnpm files:prepare-tex')
    partial = path.with_name(path.name + '.part')
    command = ['/usr/bin/curl', '--fail', '--silent', '--show-error', '--location', '--proto', '=https', '--proto-redir', '=https', '--retry', '2', '--max-time', '180']
    if start is not None:
        command += ['--range', f'{start}-{start + size - 1}']
    subprocess.run(command + ['--output', str(partial), url], check=True)
    if partial.stat().st_size != size or expected and sha(partial) != expected:
        raise RuntimeError(f'Locked resource verification failed: {path.name}')
    partial.replace(path)


archive = cache / engine['name']
fetch(engine['url'], archive, engine['bytes'], engine['digest'].removeprefix('sha256:'))
source = native['tectonicSource']
source_archive = cache / 'tectonic-source-8c0126a.tar.gz'
fetch(source['url'], source_archive, source['bytes'], source['sha256'])
bundle = cache / 'willyou-tex-v33-candidate.zip'
if not bundle.exists() or bundle.stat().st_size != lock['candidateArchiveBytes'] or sha(bundle) != lock['candidateArchiveSHA256']:
    # Replay the previously selected files directly from the committed manifest;
    # no rolling index/package database participates in a production build.
    ranges = []
    for item in sorted(lock['files'], key=lambda value: value['offset']):
        if '/' in item['name'] or '\\' in item['name'] or item['name'] in ['.', '..']:
            raise RuntimeError('Invalid locked resource name')
        start, end = item['offset'], item['offset'] + item['bytes'] - 1
        if ranges and start - ranges[-1]['end'] < 65536 and end - ranges[-1]['start'] < 12 * 1024 * 1024:
            ranges[-1]['end'] = end
            ranges[-1]['files'].append(item)
        else:
            ranges.append({'start': start, 'end': end, 'files': [item]})
    chunks, assets = cache / 'ranges', cache / 'assets'
    chunks.mkdir(exist_ok=True)
    assets.mkdir(exist_ok=True)
    print(json.dumps({'files': len(lock['files']), 'ranges': len(ranges), 'bytes': sum(value['end'] - value['start'] + 1 for value in ranges)}), flush=True)

    def materialize(value):
        chunk = chunks / f"{value['start']}-{value['end']}.bin"
        fetch(lock['sourceURL'], chunk, value['end'] - value['start'] + 1, start=value['start'])
        data = chunk.read_bytes()
        for item in value['files']:
            content = data[item['offset'] - value['start']:item['offset'] - value['start'] + item['bytes']]
            if hashlib.sha256(content).hexdigest() != item['sha256']:
                raise RuntimeError(f"Fixed upstream bytes changed: {item['name']}")
            (assets / item['name']).write_bytes(content)

    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        for index, _ in enumerate(pool.map(materialize, ranges)):
            if index % 20 == 0:
                print(f'Verified resource ranges: {index + 1}/{len(ranges)}', flush=True)
    (assets / 'SHA256SUM').write_text(lock['candidateIdentity'] + '\n')
    temporary = bundle.with_suffix('.building.zip')
    with zipfile.ZipFile(temporary, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as package:
        for name in sorted([item['name'] for item in lock['files']] + ['SHA256SUM']):
            info = zipfile.ZipInfo(name, date_time=(2026, 10, 17, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.create_system = 3
            info.external_attr = 0o100644 << 16
            package.writestr(info, (assets / name).read_bytes(), compresslevel=9)
    if sha(temporary) != lock['candidateArchiveSHA256']:
        raise RuntimeError('Reproduced TeX bundle does not match the approved lock')
    temporary.replace(bundle)

output.mkdir(parents=True, exist_ok=True)
with tarfile.open(archive) as package:
    member = package.getmember('tectonic')
    if not member.isfile() or member.size > 100 * 1024 * 1024:
        raise RuntimeError('Unexpected executable archive member')
    (output / 'tectonic').write_bytes(package.extractfile(member).read())
os.chmod(output / 'tectonic', 0o755)
shutil.copyfile(bundle, output / 'willyou-tex-v33.zip')
notices = output / 'licenses'
notices.mkdir(exist_ok=True)
for name in ['predev-tex-resource-manifest.json', 'predev-resources-tex-package-licenses.json', 'predev-resources-font-metadata.json', 'predev-resources-native-sources.json']:
    shutil.copyfile(EVIDENCE / name, notices / name)
shutil.copytree(EVIDENCE / 'licenses', notices / 'original', dirs_exist_ok=True)
shutil.copyfile(source_archive, notices / source_archive.name)
manifest = {'schema': 1, 'platform': 'darwin', 'arch': args.arch, 'engineVersion': '0.17.0', 'engine': {'path': 'tectonic', 'sha256': sha(output / 'tectonic'), 'sourceArchive': engine}, 'bundle': {'path': 'willyou-tex-v33.zip', 'sha256': sha(output / 'willyou-tex-v33.zip'), 'files': lock['fileCount'], 'sourceURL': lock['sourceURL']}, 'notice': 'Selected unchanged TeX Live v33 resources; not the entire TeX Live distribution. Compilation is offline. Original licenses and package/source provenance are in licenses/.'}
(output / 'resources.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'output': str(output), 'arch': args.arch, 'engineSha256': manifest['engine']['sha256'], 'bundleSha256': manifest['bundle']['sha256'], 'ready': True}), flush=True)
