from binding_guard import assert_bound
assert_bound()
import datetime
import hashlib
import json
import os
from pathlib import Path
import struct
import subprocess
import sys

ROOT = Path('/private/tmp/willyou-m12-app058-installer-001')
APP = ROOT / 'Installed Applications/WillYou.app'
SOURCE = Path('/private/tmp/willyou-m12-menu-dark-source-069/source')
assert sys.argv[1:] == ['--execute']
assert os.environ['WILLYOU_TEST_CACHE_DIR'] == str(ROOT / 'cache')
installed = json.loads((ROOT / 'evidence/install-and-compare-result.json').read_text())
assert installed['inputEqualsDmgEqualsInstalled'] and installed['allOwnedMountsDetached']
assert installed['status'] == 'payload-installed-and-compared-not-startup-accepted'
home = ROOT / 'cache/native-home'
scratch = ROOT / 'cache/native-tmp'
home.mkdir(mode=0o700)
scratch.mkdir(mode=0o700)
env = {key: os.environ[key] for key in ['PATH', 'USER', 'LOGNAME', 'SHELL', 'LANG', '__CF_USER_TEXT_ENCODING'] if key in os.environ}
env.update(HOME=str(home), ZDOTDIR=str(home), TMPDIR=str(scratch))
resources = APP / 'Contents/Resources'
browser_root = resources / 'agent-browser'
source = json.loads((browser_root / 'SOURCE.json').read_text())
entry = next(x for x in source['files'] if x['arch'] == 'arm64')
binary = browser_root / entry['path']
assert binary.stat().st_size == entry['bytes']
assert hashlib.sha256(binary.read_bytes()).hexdigest() == entry['sha256']
magic, cpu = struct.unpack('<II', binary.read_bytes()[:8])
assert magic == 0xfeedfacf and cpu == 0x100000c

def run(name, command, seconds=30, extra=None):
    used = {**env, **(extra or {})}
    proc = subprocess.Popen(command, env=used, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    started = datetime.datetime.now(datetime.timezone.utc).isoformat()
    try:
        stdout, stderr = proc.communicate(timeout=seconds)
    except subprocess.TimeoutExpired:
        # Keep the current exact PID for diagnosis; do not silently restart a probe.
        (ROOT / 'evidence' / (name + '-timeout.json')).write_text(json.dumps({'pid': proc.pid, 'startedAt': started, 'stillRunning': proc.poll() is None}) + '\n')
        raise
    (ROOT / 'evidence' / (name + '.stdout')).write_bytes(stdout)
    (ROOT / 'evidence' / (name + '.stderr')).write_bytes(stderr)
    record = {'command': command, 'pid': proc.pid, 'startedAt': started,
              'finishedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'exitCode': proc.returncode}
    (ROOT / 'evidence' / (name + '-exit.json')).write_text(json.dumps(record, indent=2) + '\n')
    assert proc.returncode == 0, name + ' failed; original outputs retained'
    return stdout.decode()

signature = run('installed-helper-signature', ['/usr/bin/codesign', '--verify', '--strict', str(binary)])
version = run('installed-helper-version', [str(binary), '--version'])
assert source['version'] in version
stdout = run('installed-native-smoke', [str(APP / 'Contents/MacOS/WillYou'), str(SOURCE / 'scripts/release/native-smoke.cjs'),
                                      str(resources), '0.1.1', 'arm64'], extra={'ELECTRON_RUN_AS_NODE': '1'})
smoke = json.loads(stdout.strip().splitlines()[-1])
assert smoke['version'] == '0.1.1' and smoke['platform'] == 'darwin' and smoke['arch'] == 'arm64'
for field in ['sqlite', 'pty', 'voiceBridge', 'fileBroker', 'officeRenderer', 'fileWatcher']:
    assert smoke[field] == 'passed', field
result = {'at': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'actualInstalledApp': str(APP),
          'helperVersionOutput': version.strip(), 'helperSha256': entry['sha256'], 'helperBytes': entry['bytes'],
          'helperMachOArm64': True, 'helperSignatureVerified': True, 'actualSixNativeChecks': smoke,
          'realAppManagedCliStillRequired': True, 'formalCaseCredit': 0,
          'scope': 'Actual private install only; no model, user credential or daily app access. Preview ad-hoc, no notarization/x64/release claim.'}
(ROOT / 'evidence/installed-native-result.json').write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps(result), flush=True)
