import datetime
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys

ROOT = Path('/private/tmp/willyou-m12-p118-app022-installer-001')
SOURCE = Path('/private/tmp/willyou-m12-p114-source-026/source')
SHARED = Path('/private/tmp/willyou-m12-s2-package-022/mac-arm64/WillYou.app')
PRIVATE = ROOT / 'installer-input/WillYou.app'
NODE = Path('/Users/liubu/.hermes/node/bin/node')
BUILDER = Path('/Users/liubu/hx/4.uprxiao/SmartDD/node_modules/electron-builder/cli.js')

def digest(path):
    value = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            value.update(chunk)
    return value.hexdigest()

def save(name, value):
    path = ROOT / 'evidence/attempt-002' / name
    assert path.parent == ROOT / 'evidence/attempt-002'
    path.write_text(json.dumps(value, indent=2) + '\n')

assert sys.argv[1:] == ['--execute']
assert os.environ['WILLYOU_TEST_CACHE_DIR'] == str(ROOT / 'cache')
source_manifest = json.loads(Path('/private/tmp/willyou-m12-p114-source-026/source-inputs.json').read_text())
assert digest(SOURCE / 'electron-builder.config.cjs') == source_manifest['files']['electron-builder.config.cjs']
assert digest(PRIVATE / 'Contents/Resources/app.asar') == '52c21851a8b3475c2fb613eb0f3e49aced8dbbb0f59fba255c0a91f28eac755f'
pins = json.loads((ROOT / 'evidence/attempt-002/prepackaged-input-pins.json').read_text())['files']
for row in pins:
    assert digest(SHARED / row['path']) == row['sha256']
    assert digest(PRIVATE / row['path']) == row['sha256']
    assert (SHARED / row['path']).stat().st_ino != (PRIVATE / row['path']).stat().st_ino
signature = subprocess.run(['/usr/bin/codesign', '--verify', '--deep', '--strict', str(PRIVATE)],
                           capture_output=True, text=True)
save('prepackaged-signature-gate.json', {'exitCode': signature.returncode,
                                      'stdout': signature.stdout, 'stderr': signature.stderr})
assert signature.returncode == 0, 'Private prepackaged copy signature gate failed; no installer build'
for name in ['tmp', 'electron-builder']:
    (ROOT / 'cache' / name).mkdir(mode=0o700, exist_ok=True)
# No model, signing or repository credentials are needed to wrap a prepackaged preview.
keep = ['PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'LANG', 'LC_ALL', 'TERM', '__CF_USER_TEXT_ENCODING']
env = {key: os.environ[key] for key in keep if key in os.environ}
env.update(SMARTDD_SIGN='0', CSC_IDENTITY_AUTO_DISCOVERY='false',
           ELECTRON_BUILDER_CACHE=str(ROOT / 'cache/electron-builder'),
           TMPDIR=str(ROOT / 'cache/tmp'), WILLYOU_TEST_CACHE_DIR=str(ROOT / 'cache'),
           NODE_COMPILE_CACHE=str(ROOT / 'cache/node'),npm_config_cache=str(ROOT / 'cache/npm'))
command = [str(NODE), str(BUILDER), '--mac', 'dmg', '--arm64', '--prepackaged', str(PRIVATE),
           '--projectDir', str(SOURCE), '--config', str(SOURCE / 'electron-builder.config.cjs'),
           '--config.directories.output=' + str(ROOT / 'installer-output-002'), '--config.electronVersion=42.11.14', '--publish', 'never']
record = {'startedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
          'driverPid': os.getpid(), 'command': command, 'cwd': str(SOURCE),
          'scope': 'Local ad-hoc arm64 preview installer from private copy of exact tested App022; no source rebuild, publishing, daily app/data, model or credentials.',
          'envNames': sorted(env), 'nativeStarted': False}
save('installer-build-start.json', record)
with (ROOT / 'evidence/attempt-002/installer-build.stdout').open('wb') as stdout, (ROOT / 'evidence/attempt-002/installer-build.stderr').open('wb') as stderr:
    child = subprocess.Popen(command, cwd=SOURCE, env=env, stdout=stdout, stderr=stderr)
    record['builderPid'] = child.pid
    record['nativeStarted'] = True
    save('installer-build-start.json', record)
    print(json.dumps({'stage': 'installer-build-started', 'driverPid': os.getpid(), 'builderPid': child.pid}), flush=True)
    # A timeout is diagnostic, never a reason to restart a packaging attempt blindly.
    try:
        code = child.wait(timeout=600)
    except subprocess.TimeoutExpired:
        save('installer-build-observation-timeout.json', {**record, 'childStillRunning': child.poll() is None})
        raise
record.update(finishedAt=datetime.datetime.now(datetime.timezone.utc).isoformat(), exitCode=code)
save('installer-build-exit.json', record)
unchanged = []
for row in pins:
    unchanged.append({'path': row['path'], 'sharedUnchanged': digest(SHARED / row['path']) == row['sha256'],
                      'privateUnchanged': digest(PRIVATE / row['path']) == row['sha256']})
save('installer-build-input-preservation.json', {'files': unchanged, 'allUnchanged': all(x['sharedUnchanged'] and x['privateUnchanged'] for x in unchanged)})
assert all(x['sharedUnchanged'] and x['privateUnchanged'] for x in unchanged)
assert code == 0, f'Builder exit {code}; original stdout/stderr retained'
artifacts = [{'path': str(p), 'bytes': p.stat().st_size, 'sha256': digest(p)}
             for p in sorted((ROOT / 'installer-output-002').glob('*.dmg'))]
assert len(artifacts) == 1
save('candidate-installer.json', {'artifacts': artifacts, 'prepackagedInputUnchanged': True,
                                'published': False, 'installedOrAccepted': False})
print(json.dumps({'stage': 'installer-created-unjudged', 'artifacts': artifacts}), flush=True)
