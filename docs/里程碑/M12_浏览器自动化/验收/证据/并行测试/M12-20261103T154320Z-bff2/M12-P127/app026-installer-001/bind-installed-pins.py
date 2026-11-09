from binding_guard import assert_bound
assert_bound()
"""File-only final binding after the original current-root install/native steps.

No App, native executable, mount or tool is started here. The accepted P118
startup flow requires hashes of outputs which do not exist during preparation.
"""
from pathlib import Path
import datetime
import hashlib
import json
import os
import sys

ROOT = Path('/private/tmp/willyou-m12-app026-installer-001')
START = ROOT / 'installed-startup-001'
assert sys.argv[1:] == ['--execute']
assert os.environ.get('WILLYOU_M12_NATIVE_LEASE_CONFIRMED') == '1'
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
pin = json.loads((START / 'pin.template.json').read_text())
assert pin['finalReady'] is False and pin['role'] == 'App026-installed'
install = json.loads((ROOT / 'evidence/install-and-compare-result.json').read_text())
native = json.loads((ROOT / 'evidence/installed-native-result.json').read_text())
candidate = json.loads((ROOT / 'evidence/candidate-installer.json').read_text())
assert install['status'] == 'payload-installed-and-compared-not-startup-accepted'
assert install['inputEqualsDmgEqualsInstalled'] and install['allOwnedMountsDetached']
assert install['installedApp'] == pin['app'] == native['actualInstalledApp']
assert install['candidatePayloadEntries'] == install['identicalInstalledEntries']
assert native['helperMachOArm64'] and native['helperSignatureVerified']
smoke = native['actualSixNativeChecks']
assert (smoke['version'], smoke['platform'], smoke['arch']) == ('0.1.1', 'darwin', 'arm64')
for field in ['sqlite', 'pty', 'voiceBridge', 'fileBroker', 'officeRenderer', 'fileWatcher']:
    assert smoke[field] == 'passed'
app = Path(pin['app'])
assert sha(app / 'Contents/Resources/app.asar') == pin['asarSha256']
assert sha(app / 'Contents/MacOS/WillYou') == pin['executableSha256']
for row in pin['packageFiles']:
    assert sha(app / 'Contents/Resources' / row['path']) == row['sha256']
for row in pin['runtimeCoreFiles']:
    assert sha(app / row['path']) == row['sha256']
assert sha(Path(pin['sourceManifest'])) == pin['sourceManifestSha256']
assert candidate['published'] is False and candidate['prepackagedInputUnchanged']
assert len(candidate['artifacts']) == 1
artifact = candidate['artifacts'][0]
assert Path(artifact['path']).parent == ROOT / 'installer-output-002'
assert sha(Path(artifact['path'])) == artifact['sha256']
ready_path = START / 'execution-ready.json'
before = {'pinSha256': sha(START / 'pin.json'), 'readySha256': sha(ready_path)}
for key in ['buildGate', 'nativeGate']:
    pin[key]['sha256'] = sha(Path(pin[key]['path']))
pin.update(finalReady=True, pending=None,
           finalPinVerifiedAt=datetime.datetime.now(datetime.timezone.utc).isoformat())
(START / 'pin.json').write_text(json.dumps(pin, indent=2) + '\n')
ready = json.loads(ready_path.read_text())
for row in ready['inputs']:
    path = START / row['path']
    row['sha256'], row['mode'] = sha(path), path.stat().st_mode & 511
ready.update(status='READY-current-installed-App026-await-fresh-startup-lease',
             actualInstallationAndNativeBound=True, nativeExecuted=False,
             at=datetime.datetime.now(datetime.timezone.utc).isoformat())
ready_path.write_text(json.dumps(ready, indent=2) + '\n')
result = {'at': ready['at'], 'scope': 'Only actual current-root installed-output pin binding; no App execution',
          'before': before, 'after': {'pinSha256': sha(START / 'pin.json'),
                                    'readySha256': sha(ready_path)},
          'installedApp': pin['app'], 'candidatePayloadEntries': install['candidatePayloadEntries'],
          'AppStartedByBinder': False}
(ROOT / 'evidence/startup-pin-binding.json').write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps(result))
