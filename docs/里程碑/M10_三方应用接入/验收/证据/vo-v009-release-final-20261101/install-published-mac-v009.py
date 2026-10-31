"""Install only the exact public Mac artifact already accepted by the asset audit."""
from pathlib import Path
import datetime
import hashlib
import json
import os
import plistlib
import re
import subprocess
import sys
import uuid

root = Path(__file__).resolve().parent
downloads, audit_file, expected_commit = Path(sys.argv[1]).resolve(), Path(sys.argv[2]).resolve(), sys.argv[3]
assert str(downloads).startswith('/private/tmp/willyou-m10-')
assert re.fullmatch('[a-f0-9]{40}', expected_commit)
audit = json.loads(audit_file.read_text())
assert audit['version'] == '0.0.9' and audit['commit'] == expected_commit
assert audit['totalAssets'] == 12 and audit['installationPackages'] == 7
assert audit['provenanceAndChecksums'] == 'passed' and audit['githubDigestAndSize'] == 'passed'
name = 'WillYou-0.0.9-mac-arm64.dmg'
entry = next(item for item in audit['files'] if item['name'] == name)
source = downloads / name

def sha(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for data in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(data)
    return h.hexdigest()

assert source.stat().st_size == entry['bytes'] and sha(source) == entry['sha256']
install = Path('/private/tmp') / ('willyou-m10-vf-install-' + uuid.uuid4().hex)
install.mkdir(mode=0o700)
mount = install / 'readonly-mount'
app = install / 'isolated Applications/WillYou.app'
mount.mkdir()
app.parent.mkdir()
home, temporary = install / 'native-home', install / 'native-tmp'
home.mkdir(mode=0o700)
temporary.mkdir(mode=0o700)
(install / 'dmg').mkdir()
dmg = install / 'dmg' / name
subprocess.run(['/bin/cp', '-c', str(source), str(dmg)], check=True, timeout=120)
assert sha(dmg) == entry['sha256']
receipt = {'schema': 'v009-published-mac-install-v1', 'startedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'root': str(install), 'sourceDmg': str(source), 'copiedDmg': str(dmg), 'dmgSha256': entry['sha256'], 'commit': expected_commit, 'app': str(app), 'status': 'running', 'boundary': 'Audited actual published artifact; own readonly mount and temporary Applications; no global installation/trust/quarantine/settings or daily data changes'}

def command(*args, env=None, timeout=120):
    return subprocess.check_output(list(args), text=True, stderr=subprocess.STDOUT, env=env, timeout=timeout)

attached = False
try:
    receipt['dmgVerification'] = command('/usr/bin/hdiutil', 'verify', str(dmg)).strip()
    raw = command('/usr/bin/hdiutil', 'attach', '-readonly', '-nobrowse', '-noautoopen', '-mountpoint', str(mount), '-plist', str(dmg))
    attached = True
    receipt['mountReceiptSha256'] = hashlib.sha256(raw.encode()).hexdigest()
    inventory_env = {key: value for key, value in os.environ.items() if key in {'PATH', 'LANG', 'LC_ALL'}}
    inventory_env.update(HOME=str(home), TMPDIR=str(temporary))
    inventory_script = str(root / 'tree-published-mac-inventory.mjs')
    source_inventory = install / 'source-bundle-tree.json'
    installed_inventory = install / 'installed-bundle-tree.json'
    command('node', inventory_script, str(mount / 'WillYou.app'), str(source_inventory), env=inventory_env)
    command('/usr/bin/ditto', str(mount / 'WillYou.app'), str(app))
    command('node', inventory_script, str(app), str(installed_inventory), env=inventory_env)
    original_tree = json.loads(source_inventory.read_text())
    assert json.loads(installed_inventory.read_text()) == original_tree
    receipt['bundleEntries'] = len(original_tree)
    receipt['fullBundleMatchesOriginalPublishedDmg'] = True
    receipt['sourceInventorySha256'] = sha(source_inventory)
    info = plistlib.loads((app / 'Contents/Info.plist').read_bytes())
    assert info['CFBundleShortVersionString'] == '0.0.9'
    executable = app / 'Contents/MacOS/WillYou'
    assert command('/usr/bin/lipo', '-archs', str(executable)).strip() == 'arm64'
    command('/usr/bin/codesign', '--verify', '--deep', '--strict', str(app), timeout=60)
    receipt['signatureVerified'] = True
    resources = app / 'Contents/Resources'
    receipt['asarSha256'] = sha(resources / 'app.asar')
    native_env = {key: value for key, value in os.environ.items() if key in {'PATH', 'LANG', 'LC_ALL'}}
    native_env.update(HOME=str(home), TMPDIR=str(temporary), ELECTRON_RUN_AS_NODE='1')
    native = json.loads(command(str(executable), str(root / 'worktree/scripts/release/native-smoke.cjs'), str(resources), '0.0.9', 'arm64', env=native_env, timeout=90))
    assert all(native[key] == 'passed' for key in ['sqlite', 'pty', 'voiceBridge', 'fileBroker', 'officeRenderer', 'fileWatcher'])
    receipt['native'] = native
    receipt['executable'] = str(executable)
    receipt['status'] = 'passed-installed-native-verified-ui-pending'
except Exception as error:
    receipt['status'] = 'failed'
    receipt['error'] = repr(error)
    raise
finally:
    if attached:
        try:
            command('/usr/bin/hdiutil', 'detach', str(mount), timeout=30)
            receipt['detached'] = True
        except Exception as error:
            receipt['status'] = 'cleanup-failed'
            receipt['cleanupError'] = repr(error)
    receipt['finishedAt'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    (install / 'installation-result.json').write_text(json.dumps(receipt, indent=2) + '\n')
    (root / 'evidence/published-mac-install-latest.json').write_text(json.dumps(receipt, indent=2) + '\n')
    print(json.dumps(receipt))
