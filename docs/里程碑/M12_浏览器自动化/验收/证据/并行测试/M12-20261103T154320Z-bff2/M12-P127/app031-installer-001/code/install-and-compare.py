from binding_guard import assert_bound
assert_bound()
import datetime
import hashlib
import json
import os
from pathlib import Path
import plistlib
import stat
import subprocess
import sys

ROOT = Path('/private/tmp/willyou-m12-app031-installer-001')
assert sys.argv[1:] == ['--execute']
assert os.environ['WILLYOU_TEST_CACHE_DIR'] == str(ROOT / 'cache')
PLAN = json.loads((ROOT / 'plan.json').read_text())

def sha(path):
    value = hashlib.sha256()
    with path.open('rb') as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b''):
            value.update(chunk)
    return value.hexdigest()

def save(name, value):
    path = ROOT / 'evidence' / name
    assert path.parent == ROOT / 'evidence'
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')

def inventory(app):
    result = {}
    for directory, dirs, files in os.walk(app, followlinks=False):
        for name in sorted(dirs + files):
            path = Path(directory) / name
            relative = path.relative_to(app).as_posix()
            mode = path.lstat().st_mode
            if stat.S_ISLNK(mode):
                result[relative] = {'kind': 'symlink', 'mode': stat.S_IMODE(mode), 'target': os.readlink(path)}
            elif stat.S_ISREG(mode):
                result[relative] = {'kind': 'file', 'mode': stat.S_IMODE(mode), 'bytes': path.stat().st_size, 'sha256': sha(path)}
            elif stat.S_ISDIR(mode):
                result[relative] = {'kind': 'directory', 'mode': stat.S_IMODE(mode)}
            else:
                raise AssertionError('Unexpected payload entry: ' + relative)
    return result

mounted = []
result = {'startedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'driverPid': os.getpid(),
          'scope': 'Own read-only DMG mounts and private install; never replace daily /Applications or follow its outer DMG alias.',
          'cleanup': [], 'formalCaseCredit': 0}

def mount(label, image, expected_sha):
    assert sha(image) == expected_sha, label + ' DMG trusted hash mismatch'
    point = ROOT / 'mounts' / label
    point.mkdir(mode=0o700)
    proc = subprocess.run(['/usr/bin/hdiutil', 'attach', '-readonly', '-nobrowse', '-noautoopen',
                           '-mountpoint', str(point), '-plist', str(image)], capture_output=True, timeout=120)
    (ROOT / 'evidence' / (label + '-mount.stdout.plist')).write_bytes(proc.stdout)
    (ROOT / 'evidence' / (label + '-mount.stderr')).write_bytes(proc.stderr)
    assert proc.returncode == 0, label + ' mount failed; original output retained'
    metadata = plistlib.loads(proc.stdout)
    entities = metadata['system-entities']
    roots = [x['dev-entry'] for x in entities if x.get('dev-entry')]
    assert roots
    # Only the device returned by this exact attach is eligible for later detach.
    owned = {'label': label, 'image': str(image), 'device': roots[0], 'mountPoint': str(point)}
    mounted.append(owned)
    assert [x.get('mount-point') for x in entities if x.get('mount-point')] == [str(point)]
    app = point / 'WillYou.app'
    assert app.is_dir() and not app.is_symlink()
    return app

try:
    baseline = ROOT / 'baseline-download/stored-auth-attempt-002' / PLAN['baselineAsset']
    candidate_info = json.loads((ROOT / 'evidence/candidate-installer.json').read_text())['artifacts'][0]
    baseline_app = mount('baseline', baseline, PLAN['baselineDmgSha256'])
    candidate_app = mount('candidate', Path(candidate_info['path']), candidate_info['sha256'])
    assert sha(baseline_app / 'Contents/Resources/app.asar') == PLAN['baselineAsarSha256']
    assert sha(candidate_app / 'Contents/Resources/app.asar') == PLAN['currentAsarSha256']
    before = inventory(ROOT / 'installer-input/WillYou.app')
    payload = inventory(candidate_app)
    assert payload == before, 'DMG payload differs from exact tested private App031 input'
    destination = ROOT / 'Installed Applications'
    destination.mkdir(mode=0o700)
    installed = destination / 'WillYou.app'
    assert not installed.exists()
    copy = subprocess.run(['/bin/cp', '-Rp', str(candidate_app), str(installed)], capture_output=True, timeout=180)
    save('private-install-copy.json', {'exitCode': copy.returncode, 'stdout': copy.stdout.decode(),
                                     'stderr': copy.stderr.decode(), 'source': str(candidate_app), 'destination': str(installed)})
    assert copy.returncode == 0
    actual = inventory(installed)
    assert actual == payload
    signature = subprocess.run(['/usr/bin/codesign', '--verify', '--deep', '--strict', str(installed)], capture_output=True, text=True, timeout=90)
    save('installed-signature.json', {'exitCode': signature.returncode, 'stdout': signature.stdout, 'stderr': signature.stderr})
    assert signature.returncode == 0
    previous = inventory(baseline_app)
    save('previous-payload-inventory.json', previous)
    save('candidate-payload-inventory.json', payload)
    size = lambda rows: sum(x['bytes'] for x in rows.values() if x['kind'] == 'file')
    changed = []
    for name in sorted(set(previous) | set(payload)):
        old = previous.get(name)
        new = payload.get(name)
        if old != new:
            old_size = old.get('bytes', 0) if old else 0
            new_size = new.get('bytes', 0) if new else 0
            changed.append({'path': name, 'kind': 'added' if old is None else 'removed' if new is None else 'changed',
                            'beforeBytes': old_size, 'afterBytes': new_size, 'deltaBytes': new_size - old_size})
    delta = size(payload) - size(previous)
    assert sum(x['deltaBytes'] for x in changed) == delta
    engine = 'Contents/Resources/agent-browser/arm64/agent-browser'
    assert engine in payload and engine not in previous
    helper_delta = sum(x['deltaBytes'] for x in changed if x['path'].startswith('Contents/Resources/agent-browser/'))
    report = {'baselineTag': PLAN['baselineTag'], 'baselineAsar': PLAN['baselineAsarSha256'],
              'candidateAsar': PLAN['currentAsarSha256'], 'baselineDmgBytes': baseline.stat().st_size,
              'candidateDmgBytes': Path(candidate_info['path']).stat().st_size,
              'baselineLogicalRegularFileBytes': size(previous), 'candidateLogicalRegularFileBytes': size(payload),
              'logicalPayloadDeltaBytes': delta, 'engineBinaryBytes': payload[engine]['bytes'],
              'allAgentBrowserResourceDeltaBytes': helper_delta, 'otherResourceDeltaBytes': delta - helper_delta,
              'changedEntries': changed, 'basis': 'Uncompressed logical regular-file bytes, no followed symlinks, matched format/platform. DMG compression sizes recorded separately.',
              'versionBoundary': 'Last published M11 baseline and unreleased M12 candidate both display 0.1.1; distinguish source/ASAR hashes. No new release claimed.'}
    save('size-comparison.json', report)
    result.update(status='payload-installed-and-compared-not-startup-accepted', baselinePayloadEntries=len(previous),
                  candidatePayloadEntries=len(payload), identicalInstalledEntries=len(actual), installedApp=str(installed),
                  inputEqualsDmgEqualsInstalled=True, signatureExitCode=signature.returncode,
                  logicalPayloadDeltaBytes=delta, engineBinaryBytes=payload[engine]['bytes'])
except Exception as error:
    result.update(status='failed-or-partial', error=repr(error))
    raise
finally:
    for owned in reversed(mounted):
        proc = subprocess.run(['/usr/bin/hdiutil', 'detach', owned['device']], capture_output=True, text=True, timeout=90)
        result['cleanup'].append({**owned, 'detachExitCode': proc.returncode, 'stdout': proc.stdout, 'stderr': proc.stderr})
    result['allOwnedMountsDetached'] = all(x['detachExitCode'] == 0 for x in result['cleanup'])
    result['finishedAt'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    save('install-and-compare-result.json', result)
    print(json.dumps(result, ensure_ascii=False), flush=True)
