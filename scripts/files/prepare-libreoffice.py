#!/usr/bin/env python3
"""Prepare the full, fixed LibreOffice bundle for the offline Office helper.

Build-time downloads only. Keep the original layout, signatures and licenses;
never use a user's installation or change a system security setting.
"""
import argparse
import fcntl
import hashlib
import json
import os
import pathlib
import platform
import plistlib
import shutil
import subprocess
import sys
import tempfile

REPO = pathlib.Path(__file__).resolve().parents[2]
VERSION = '26.2.4.2'
BUILD = '0229ac93fcf0d7cbc6376066c6f35021cef002dc'
BASE = f'https://downloadarchive.documentfoundation.org/libreoffice/old/{VERSION}/mac'
ASSETS = {
    'arm64': {'url': f'{BASE}/aarch64/LibreOffice_{VERSION}_MacOS_aarch64.dmg', 'bytes': 295019039,
              'sha256': '64e0ad05564554eeee639d49b08b20908a38d4722ec95f1620d05c99bcbe9fb1'},
    'x64': {'url': f'{BASE}/x86_64/LibreOffice_{VERSION}_MacOS_x86-64.dmg', 'bytes': 305573151,
            'sha256': 'f92ba40fdada173232fe929bf77973a1ffcccec55ae7971957a6de84d33f0f1e'},
}


def sha(path):
    digest = hashlib.sha256()
    with path.open('rb') as source:
        for block in iter(lambda: source.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def inventory(root):
    if root.is_symlink() or not root.is_dir() or root.stat().st_mode & 0o022:
        raise RuntimeError('LibreOffice bundle root has unsafe type or permissions')
    entries = []
    total = 0
    for path in sorted(root.rglob('*')):
        name = path.relative_to(root).as_posix()
        if len(name) > 1024 or ':' in name or '\\' in name or any(ord(char) < 32 for char in name):
            raise RuntimeError('Unexpected LibreOffice resource path')
        if path.is_symlink():
            if not path.resolve(strict=True).is_relative_to(root.resolve()):
                raise RuntimeError(f'LibreOffice link escapes its full bundle: {name}')
            entries.append({'path': name, 'link': os.readlink(path)})
        elif path.is_file():
            info = path.stat()
            if info.st_mode & 0o022 or info.st_size > 256 * 1024 * 1024:
                raise RuntimeError(f'LibreOffice resource has unsafe mode or size: {name}')
            total += info.st_size
            entries.append({'path': name, 'bytes': info.st_size, 'sha256': sha(path)})
        elif path.is_dir():
            if path.stat().st_mode & 0o022:
                raise RuntimeError(f'LibreOffice directory has unsafe permissions: {name}')
        else:
            raise RuntimeError(f'Unsupported LibreOffice resource type: {name}')
        if len(entries) > 32768 or total > 1024 * 1024 * 1024:
            raise RuntimeError('Full LibreOffice resources exceed the fixed budget')
    if len(entries) < 10000:
        raise RuntimeError('LibreOffice bundle is incomplete')
    return entries, total


def validate_bundle(app, arch):
    with (app / 'Contents/Info.plist').open('rb') as source:
        metadata = plistlib.load(source)
    if metadata.get('CFBundleShortVersionString') != VERSION or metadata.get('CFBundleVersion') != VERSION:
        raise RuntimeError('LibreOffice bundle does not match the locked version')
    executable = app / 'Contents/MacOS/soffice'
    actual = subprocess.run(['/usr/bin/lipo', '-archs', str(executable)], check=True, capture_output=True, text=True).stdout.split()
    if actual != ['arm64' if arch == 'arm64' else 'x86_64']:
        raise RuntimeError('LibreOffice executable architecture does not match the build target')
    subprocess.run(['/usr/bin/codesign', '--verify', '--deep', '--strict', str(app)], check=True, timeout=60)
    if not all((app / 'Contents/Resources' / name).is_file() for name in ['LICENSE', 'LICENSE.html', 'NOTICE']):
        raise RuntimeError('LibreOffice original licenses are missing')
    with tempfile.TemporaryDirectory(prefix='willyou-lo-version-') as temporary:
        result = subprocess.run([str(executable), '-env:UserInstallation=' + pathlib.Path(temporary, 'profile').as_uri(), '--headless', '--version'], check=True, capture_output=True, text=True, timeout=15)
    if f'LibreOffice {VERSION} {BUILD}' not in result.stdout:
        raise RuntimeError('LibreOffice runtime build identity does not match the lock')
    return result.stdout.strip()


def prepare(args):
    if platform.system() != 'Darwin' or args.arch != ('arm64' if platform.machine() == 'arm64' else 'x64'):
        raise RuntimeError('Prepare LibreOffice on a matching native macOS runner')
    # Test the supplied leaf before resolve(), which would hide a symlink.
    if args.output.is_symlink() or args.cache.is_symlink():
        raise RuntimeError('LibreOffice output and cache roots cannot be symlinks')
    cache, output = args.cache.resolve(), args.output.resolve()
    cache.mkdir(parents=True, exist_ok=True)
    output.parent.mkdir(parents=True, exist_ok=True)
    asset = ASSETS[args.arch]
    archive = cache / asset['url'].rsplit('/', 1)[1]
    with (cache / f'.prepare-{args.arch}.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        if not archive.is_file() or archive.stat().st_size != asset['bytes'] or sha(archive) != asset['sha256']:
            if args.offline:
                raise RuntimeError('Pinned LibreOffice DMG is absent or corrupt; run pnpm files:prepare-libreoffice')
            partial = archive.with_suffix('.dmg.part')
            subprocess.run(['/usr/bin/curl', '--fail', '--silent', '--show-error', '--location', '--proto', '=https', '--proto-redir', '=https', '--retry', '2', '--max-time', '300', '--output', str(partial), asset['url']], check=True)
            if partial.stat().st_size != asset['bytes'] or sha(partial) != asset['sha256']:
                raise RuntimeError('LibreOffice download size or SHA-256 does not match the lock')
            partial.replace(archive)
        print(f'LibreOffice official DMG verified: {archive.name}', flush=True)
        receipt = output / 'resources.json'
        if output.exists():
            if not output.is_dir() or output.stat().st_mode & 0o022 or receipt.is_symlink() or not receipt.is_file() or receipt.stat().st_size > 16 * 1024 * 1024:
                raise RuntimeError('Refusing to replace an unrecognised LibreOffice resource directory')
            if {path.name for path in output.iterdir()} != {'LibreOffice.app', 'resources.json'}:
                raise RuntimeError('LibreOffice resource directory contains unregistered objects; retained for inspection')
            previous = json.loads(receipt.read_text())
            if previous.get('component') != 'willyou-office-libreoffice':
                raise RuntimeError('Refusing to replace another component resource directory')
            if previous.get('arch') == args.arch and previous.get('version') == VERSION and previous.get('source') == asset:
                files, size = inventory(output / 'LibreOffice.app')
                if files == previous.get('files') and size == previous.get('totalBytes'):
                    validate_bundle(output / 'LibreOffice.app', args.arch)
                    print(f'LibreOffice prepared resources verified: {len(files)} entries, {size} bytes', flush=True)
                    return
        work = pathlib.Path(tempfile.mkdtemp(prefix='.libreoffice-building-', dir=output.parent))
        mount = pathlib.Path(tempfile.mkdtemp(prefix='willyou-lo-mount-'))
        attached = False
        try:
            subprocess.run(['/usr/bin/hdiutil', 'attach', '-readonly', '-nobrowse', '-mountpoint', str(mount), str(archive)], check=True, capture_output=True, timeout=60)
            attached = True
            source = mount / 'LibreOffice.app'
            validate_bundle(source, args.arch)
            subprocess.run(['/usr/bin/ditto', str(source), str(work / 'LibreOffice.app')], check=True, timeout=120)
            version = validate_bundle(work / 'LibreOffice.app', args.arch)
            files, size = inventory(work / 'LibreOffice.app')
            manifest = {'schema': 1, 'component': 'willyou-office-libreoffice', 'platform': 'darwin', 'arch': args.arch,
                        'version': VERSION, 'build': BUILD, 'source': asset, 'runtimeVersion': version,
                        'totalBytes': size, 'files': files}
            (work / 'resources.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
            work.chmod(0o755)
            # All fallible preparation finishes before replacing the previous component.
            backup = output.with_name(output.name + '.previous')
            if backup.exists() or backup.is_symlink():
                raise RuntimeError('An earlier LibreOffice replacement needs inspection; previous resources retained')
            if output.exists():
                output.rename(backup)
            try:
                work.rename(output)
            except Exception:
                if backup.exists():
                    backup.rename(output)
                raise
            if backup.exists():
                shutil.rmtree(backup)
            print(f'LibreOffice prepared: {len(files)} entries, {size} bytes', flush=True)
        finally:
            primary_error = sys.exc_info()[0] is not None
            detach_error = None
            if attached:
                try:
                    subprocess.run(['/usr/bin/hdiutil', 'detach', str(mount)], check=True, capture_output=True, timeout=30)
                except (subprocess.SubprocessError, OSError) as error:
                    detach_error = error
                    print(f'LibreOffice read-only mount retained after detach failure: {mount}: {error}', file=sys.stderr)
            if detach_error is None:
                mount.rmdir()
            if work.exists():
                shutil.rmtree(work)
            if detach_error is not None and not primary_error:
                raise RuntimeError('LibreOffice preparation finished but its read-only mount could not be detached') from detach_error


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--cache', type=pathlib.Path, default=REPO / 'release/engine-cache/libreoffice')
    parser.add_argument('--output', type=pathlib.Path, default=REPO / 'out/native/libreoffice')
    parser.add_argument('--arch', choices=['arm64', 'x64'], default='arm64' if platform.machine() == 'arm64' else 'x64')
    parser.add_argument('--offline', action='store_true')
    try:
        prepare(parser.parse_args())
    except subprocess.CalledProcessError as error:
        if error.stderr:
            print(error.stderr.decode('utf-8', 'replace') if isinstance(error.stderr, bytes) else error.stderr)
        raise
