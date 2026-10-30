#!/usr/bin/env python3
"""Build-time preparation of the reviewed Temurin/POI runtime.

No user Java installation is copied. Runtime helpers never download resources.
LibreOffice preparation is a separate remaining step, not implied by this pack.
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
import tempfile

REPO = pathlib.Path(__file__).resolve().parents[2]
STAGE = REPO / 'docs/里程碑/M9_文件浏览工作区'
COMPILER = {'file': 'ecj-3.43.0.jar', 'bytes': 3329190, 'sha256': 'c786468c65e906498e7e36ece4e0d04c6d3dd34c9a61b34a3a5b512801911a82', 'source': 'https://repo.maven.apache.org/maven2/org/eclipse/jdt/ecj/3.43.0/ecj-3.43.0.jar', 'officialSha1': '3217710cfc3c6c20c2921623d1566e97ce5aeb6c'}


def sha(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def prepare(args):
    cache, output = args.cache.resolve(), args.output.resolve()
    cache.mkdir(parents=True, exist_ok=True)
    jre_lock = json.loads((STAGE / '验收/证据/predev-resources/predev-resources-temurin-poi.json').read_text())
    poi_lock = json.loads((STAGE / '技研/实验/predev-office-dependencies.json').read_text())
    if jre_lock['version'] != 'Temurin 21.0.12.1+1' or poi_lock['engine'] != 'Apache POI 5.5.1':
        raise RuntimeError('Office runtime lock version changed; review required')
    arch = 'aarch64' if args.arch == 'arm64' else 'x64'
    asset = next(item for item in jre_lock['officialPlatformAssets'] if item['name'] == f'OpenJDK21U-jre_{arch}_mac_hotspot_21.0.12.1_1.tar.gz')

    def fetch(url, path, size, expected):
        if path.exists() and path.stat().st_size == size and sha(path) == expected:
            return path
        if args.offline:
            raise RuntimeError(f'Locked Office asset missing or corrupt: {path.name}')
        partial = path.with_name(path.name + '.part')
        subprocess.run(['/usr/bin/curl', '--fail', '--silent', '--show-error', '--location', '--proto', '=https', '--proto-redir', '=https', '--retry', '2', '--max-time', '300', '--output', str(partial), url], check=True)
        if partial.stat().st_size != size or sha(partial) != expected:
            raise RuntimeError(f'Office asset size/hash mismatch: {path.name}')
        partial.replace(path)
        return path

    tasks = [(asset['url'], cache / asset['name'], asset['size'], asset['digest'].removeprefix('sha256:'))]
    tasks += [(item['source'], cache / item['file'], item['bytes'], item['sha256']) for item in poi_lock['runtimeJars']]
    tasks.append((COMPILER['source'], cache / COMPILER['file'], COMPILER['bytes'], COMPILER['sha256']))
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        for done, path in enumerate(pool.map(lambda task: fetch(*task), tasks), 1):
            print(f'Office verified {done}/{len(tasks)}: {path.name}', flush=True)

    output.parent.mkdir(parents=True, exist_ok=True)
    work = pathlib.Path(tempfile.mkdtemp(prefix='.office-building-', dir=output.parent))
    try:
        unpack = work / 'unpack'
        unpack.mkdir()
        with tarfile.open(cache / asset['name']) as archive:
            # Python's data filter rejects escaping paths/links and device nodes.
            archive.extractall(unpack, filter='data')
        homes = list(unpack.glob('*/Contents/Home'))
        if len(homes) != 1 or not (homes[0] / 'bin/java').is_file():
            raise RuntimeError('Unexpected official JRE archive layout')
        shutil.move(str(homes[0]), work / 'jre')
        shutil.rmtree(unpack)
        libraries = work / 'lib'
        libraries.mkdir()
        for item in poi_lock['runtimeJars']:
            shutil.copy2(cache / item['file'], libraries / item['file'])
        notices = work / 'licenses'
        shutil.copytree(STAGE / '技研/实验/predev-office-dependency-notices', notices / 'poi', symlinks=True)
        shutil.copy2(STAGE / '技研/实验/predev-office-dependencies.json', notices / 'poi-dependencies.json')
        (notices / 'README.txt').write_text('WillYou Office runtime: unchanged Eclipse Temurin JRE 21.0.12.1+1 and Apache POI 5.5.1 dependency JARs. JRE original legal texts are under ../jre/legal. POI notices, original POMs and exact source URLs accompany this directory. The Java helper is WillYou code. This directory does not contain LibreOffice.\n', encoding='utf-8')
        classes = work / 'classes'
        classes.mkdir()
        # ECJ is a build tool only, outside the shipped runtime. Use the verified
        # JRE itself, disable processors, and pass an explicit jar classpath.
        classpath = os.pathsep.join(str(path) for path in sorted(libraries.glob('*.jar')))
        subprocess.run([str(work / 'jre/bin/java'), '-Xmx512m', '-jar', str(cache / COMPILER['file']), '-21', '-proc:none', '-encoding', 'UTF-8', '-cp', classpath, '-d', str(classes), str(REPO / 'native/files/office/WillYouOffice.java')], check=True, timeout=60, env={'PATH': '/usr/bin:/bin', 'LANG': 'en_US.UTF-8'})
        environment = {'PATH': '/usr/bin:/bin', 'LANG': 'en_US.UTF-8'}
        version = subprocess.run([str(work / 'jre/bin/java'), '-version'], capture_output=True, text=True, check=True, timeout=15, env=environment)
        if 'Temurin-21.0.12.1+1' not in version.stderr:
            raise RuntimeError('Prepared Java is not the locked Temurin runtime')
        files = []
        for path in sorted(work.rglob('*')):
            relative = path.relative_to(work).as_posix()
            if path.is_symlink():
                target = path.resolve()
                if not target.is_relative_to(work.resolve()):
                    raise RuntimeError(f'Runtime symlink escapes resource root: {relative}')
                files.append({'path': relative, 'link': os.readlink(path)})
            elif path.is_file():
                files.append({'path': relative, 'bytes': path.stat().st_size, 'sha256': sha(path)})
        manifest = {'schema': 1, 'component': 'willyou-office-jre-poi', 'platform': 'darwin', 'arch': args.arch, 'jreVersion': jre_lock['version'], 'poiVersion': poi_lock['engine'], 'jreSource': asset, 'buildCompiler': COMPILER, 'helperSourceSHA256': sha(REPO / 'native/files/office/WillYouOffice.java'), 'javaVersion': version.stderr.strip(), 'files': files}
        (work / 'resources.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
        if output.exists():
            previous = output / 'resources.json'
            if not previous.is_file() or json.loads(previous.read_text()).get('component') != 'willyou-office-jre-poi':
                raise RuntimeError('Refusing to replace an unrecognised Office resource directory')
            shutil.rmtree(output)
        work.chmod(0o755)
        work.replace(output)
        print(json.dumps({'output': str(output), 'files': len(files), 'bytes': sum(item.get('bytes', 0) for item in files), 'jre': jre_lock['version'], 'poi': poi_lock['engine']}, ensure_ascii=False), flush=True)
    finally:
        if work.exists():
            shutil.rmtree(work)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--cache', type=pathlib.Path, default=REPO / 'release/engine-cache/office')
    parser.add_argument('--output', type=pathlib.Path, default=REPO / 'out/native/office')
    parser.add_argument('--arch', choices=['arm64', 'x64'], default='arm64' if platform.machine() == 'arm64' else 'x64')
    parser.add_argument('--offline', action='store_true')
    prepare(parser.parse_args())
